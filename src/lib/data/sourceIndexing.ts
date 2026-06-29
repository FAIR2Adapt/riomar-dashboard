import * as zarr from "zarrita";

import {
  ZARR_FORMAT,
  type TDataSource,
  type TMultiscalesLevel,
  type TSources,
  type TZarrFormat,
  type TZarrV3RootMetadata,
} from "../types/GlobeTypes";

import { createFetchStore } from "./authStore";
import { lru } from "./lruStore";
import { ZarrDataManager } from "./ZarrDataManager";
import { isCellName } from "./zarrUtils";

import trim from "@/utils/trim";

function isValidVariable(
  varname: string,
  shape: number[],
  dimensions?: string[]
) {
  const EXCLUDED_VAR_PATTERNS = [
    "bnds",
    "bounds",
    "vertices",
    "latitude",
    "longitude",
    "cell_ids",
    "time_instant",
  ] as const;

  if (!Array.isArray(dimensions)) {
    return false;
  }

  const hasTime =
    dimensions.includes("time") || dimensions.includes("time_counter");
  const shapeValid = hasTime ? shape.length >= 2 : shape.length >= 1;

  const hasExcludedName = EXCLUDED_VAR_PATTERNS.some((pattern) =>
    varname.includes(pattern)
  );
  // The HEALPix cell index coordinate may be named "cell" or "cells"
  const isLatLon = varname === "lat" || varname === "lon";

  return shapeValid && !hasExcludedName && !isLatLon && !isCellName(varname);
}

/** A single array found while walking the Zarr group tree. */
type TArrayEntry = {
  /** Path relative to the root group, no leading slash (e.g. "sub/temp"). */
  path: string;
  shape: number[];
  dimensionNames?: string[];
  coordinates?: string;
  attrs: zarr.Attributes;
};

/** Parent group path of a node ("" for nodes in the root group). */
function parentGroupOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Local node name (the last path segment). */
function localNameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** Depth of a group path, with the root group at depth 0. */
function groupDepth(group: string): number {
  return group === "" ? 0 : group.split("/").length;
}

/** Collect every array in a Zarr V2 consolidated store, with full paths. */
async function collectZarrV2Entries(
  store: zarr.Listable<zarr.FetchStore>,
  root: zarr.Group<zarr.FetchStore>
): Promise<TArrayEntry[]> {
  const settled = await Promise.allSettled(
    store
      .contents()
      .map(async ({ path, kind }): Promise<TArrayEntry | null> => {
        if (kind !== "array") {
          return null;
        }
        const variable = await zarr.open(root.resolve(path), { kind: "array" });
        const arrayDimensions = variable.attrs?._ARRAY_DIMENSIONS;
        return {
          path: path.replace(/^\//, ""),
          shape: variable.shape as unknown as number[],
          dimensionNames: Array.isArray(arrayDimensions)
            ? (arrayDimensions as string[])
            : undefined,
          coordinates: variable.attrs?.coordinates as string | undefined,
          attrs: variable.attrs,
        };
      })
  );
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<TArrayEntry | null> =>
        r.status === "fulfilled"
    )
    .map((r) => r.value)
    .filter((e): e is TArrayEntry => e !== null);
}

/** Collect every array listed in a Zarr V3 group's consolidated metadata. */
function collectZarrV3Entries(
  group: zarr.Group<zarr.FetchStore>
): TArrayEntry[] {
  const attributes = group.attrs as TZarrV3RootMetadata;
  const metadata = attributes.consolidated_metadata?.metadata;
  const entries: TArrayEntry[] = [];
  for (const [name, node] of Object.entries(metadata || {})) {
    if (node.node_type !== "array") {
      continue;
    }
    const arrayNode = node as zarr.ArrayMetadata;
    const nodeAttrs = (node.attributes ?? {}) as zarr.Attributes;
    entries.push({
      path: name.replace(/^\//, ""),
      shape: arrayNode.shape as unknown as number[],
      dimensionNames: arrayNode.dimension_names
        ? (arrayNode.dimension_names as string[])
        : undefined,
      coordinates: nodeAttrs.coordinates as string | undefined,
      attrs: nodeAttrs,
    });
  }
  return entries;
}

/** Map each group to the set of dimension/coordinate names used within it. */
function dimensionsByGroup(entries: TArrayEntry[]): Map<string, Set<string>> {
  const byGroup = new Map<string, Set<string>>();
  for (const entry of entries) {
    const group = parentGroupOf(entry.path);
    if (!byGroup.has(group)) {
      byGroup.set(group, new Set());
    }
    const dims = byGroup.get(group)!;
    for (const dim of entry.dimensionNames ?? []) {
      dims.add(dim);
    }
    for (const coord of entry.coordinates?.split(" ") ?? []) {
      dims.add(coord);
    }
  }
  return byGroup;
}

/**
 * Pick the group that holds the data to display. The data may live in the root
 * group or in a (possibly nested) subgroup, so we walk the tree and select the
 * shallowest group that contains at least one displayable variable. Coordinate
 * variables are expected to live alongside the data in the same group. Falls
 * back to the root group when nothing displayable is found.
 */
function pickDataGroup(
  entries: TArrayEntry[],
  dimsByGroup: Map<string, Set<string>>
): string {
  const groups = [...new Set(entries.map((e) => parentGroupOf(e.path)))];
  const displayableGroups = groups.filter((group) =>
    entries.some((entry) => {
      if (parentGroupOf(entry.path) !== group) {
        return false;
      }
      const name = localNameOf(entry.path);
      return (
        !dimsByGroup.get(group)?.has(name) &&
        isValidVariable(name, entry.shape, entry.dimensionNames)
      );
    })
  );
  displayableGroups.sort(
    (a, b) => groupDepth(a) - groupDepth(b) || a.localeCompare(b)
  );
  return displayableGroups[0] ?? "";
}

/**
 * Build the datasources map from the arrays discovered in the tree, restricted
 * to the chosen data group. Returns the group path so that the grid/time
 * sources can be pointed at the same subgroup.
 */
function buildDatasources(
  entries: TArrayEntry[],
  src: string,
  forcedDataset?: string
): { datasources: Record<string, TDataSource>; dataset: string } {
  const dimsByGroup = dimensionsByGroup(entries);
  const dataset = forcedDataset ?? pickDataGroup(entries, dimsByGroup);
  const dims = dimsByGroup.get(dataset) ?? new Set<string>();

  const datasources: Record<string, TDataSource> = {};
  for (const entry of entries) {
    if (parentGroupOf(entry.path) !== dataset) {
      continue;
    }
    const name = localNameOf(entry.path);
    datasources[name] = {
      store: src,
      dataset,
      hidden:
        dims.has(name) ||
        !isValidVariable(name, entry.shape, entry.dimensionNames),
      attrs: { ...entry.attrs, dimensionNames: entry.dimensionNames },
    };
  }
  return { datasources, dataset };
}

function createIndex(
  title: string,
  datasources: Record<string, TDataSource>,
  src: string,
  zarrFormat: TZarrFormat,
  dataset: string
): TSources {
  return {
    name: title,
    zarr_format: zarrFormat, // eslint-disable-line camelcase
    levels: [
      {
        time: {
          store: src,
          dataset,
        },
        grid: {
          store: src,
          dataset,
        },
        datasources,
      },
    ],
  };
}

/**
 * Find a multiscales `layout` declared anywhere in a Zarr V3 tree. The
 * convention places a `multiscales` attribute on a group; it may be the root
 * group or a (nested) subgroup, e.g. the DGGS pyramid puts it on
 * `measurements/reflectance`.
 */
function findMultiscalesLayout(
  group: zarr.Group<zarr.FetchStore>
): TMultiscalesLevel[] | null {
  const readLayout = (attrs: Record<string, unknown> | undefined) =>
    (attrs?.multiscales as { layout?: TMultiscalesLevel[] } | undefined)
      ?.layout;

  // openZarrV3Metadata stores the full zarr.json as group.attrs, so the real
  // root attributes are nested under group.attrs.attributes.
  const rootMetadata = group.attrs as TZarrV3RootMetadata;
  const rootLayout = readLayout(rootMetadata?.attributes);
  if (rootLayout?.length) {
    return rootLayout;
  }
  const metadata = rootMetadata.consolidated_metadata?.metadata;
  for (const node of Object.values(metadata || {})) {
    if (node.node_type === "group") {
      const layout = readLayout(node.attributes as Record<string, unknown>);
      if (layout?.length) {
        return layout;
      }
    }
  }
  return null;
}

/**
 * Index of the coarsest level in a multiscales layout (smallest DGGS
 * refinement_level). Falls back to the last entry when refinement levels are
 * not declared. The coarsest level loads fastest, so it is the default.
 */
function coarsestLevelIndex(layout: TMultiscalesLevel[]): number {
  let bestIndex = layout.length - 1;
  let bestLevel = Infinity;
  layout.forEach((level, i) => {
    const dggs = level.dggs as { refinement_level?: number } | undefined;
    if (typeof dggs?.refinement_level === "number" && dggs.refinement_level < bestLevel) {
      bestLevel = dggs.refinement_level;
      bestIndex = i;
    }
  });
  return bestIndex;
}

/** Index a single Zarr V3 store, honouring a multiscales layout if present. */
async function indexV3(src: string, levelOverride?: number): Promise<TSources> {
  const group = await ZarrDataManager.openZarrV3Metadata(createFetchStore(src));
  const entries = collectZarrV3Entries(group);
  const layout = findMultiscalesLayout(group);

  if (layout?.length) {
    const baseUrl = src.replace(/\/$/, "");
    const levelIndex = levelOverride ?? coarsestLevelIndex(layout);
    const dataset = layout[levelIndex].asset.replace(/^\/+|\/+$/g, "");
    // Preferred: the level's arrays are consolidated at the root, so build them
    // directly with the level subgroup as their `dataset`.
    const { datasources } = buildDatasources(entries, baseUrl, dataset);
    const hasVisible = Object.values(datasources).some((d) => !d.hidden);
    if (hasVisible) {
      const index = createIndex(
        group.attrs?.title as string,
        datasources,
        baseUrl,
        ZARR_FORMAT.V3,
        dataset
      );
      index.multiscales = { baseUrl, layout, activeLevel: levelIndex };
      return index;
    }
    // Fallback: the level is its own consolidated store; open it directly.
    const index = await indexFromZarr(baseUrl + "/" + layout[levelIndex].asset);
    index.multiscales = { baseUrl, layout, activeLevel: levelIndex };
    return index;
  }

  const { datasources, dataset } = buildDatasources(entries, src);
  return createIndex(
    group.attrs?.title as string,
    datasources,
    src,
    ZARR_FORMAT.V3,
    dataset
  );
}

export async function indexFromZarr(src: string): Promise<TSources> {
  try {
    const store = await zarr.withConsolidated(lru(createFetchStore(src)));
    const root = await zarr.open(store, { kind: "group" });
    const entries = await collectZarrV2Entries(store, root);
    const { datasources, dataset } = buildDatasources(entries, src);
    return createIndex(
      root.attrs?.title as string,
      datasources,
      src,
      ZARR_FORMAT.V2,
      dataset
    );
  } catch {
    return indexV3(src);
  }
}

/**
 * Re-index a multiscales dataset at a specific level. Used to switch the
 * displayed resolution. `baseUrl` is `TMultiscalesInfo.baseUrl`.
 */
export async function indexMultiscaleLevel(
  baseUrl: string,
  levelIndex: number
): Promise<TSources> {
  return indexV3(baseUrl, levelIndex);
}

/**
 * JSON-based index may contain variables which belong to different dataset.
 * This function collects variable names by their dataset combination, so
 * that we can fetch metadata for each store only once.
 */
function collectStores(
  datasources: Record<string, TDataSource>
): Record<string, Set<string>> {
  const stores: Record<string, Set<string>> = {};
  for (const varname in datasources) {
    const variable = datasources[varname];
    const store = trim(variable.store, "/") + "/" + trim(variable.dataset, "/");
    if (!stores[store]) {
      stores[store] = new Set();
    }
    stores[store].add(varname);
  }
  return stores;
}

/**
 * Enrich the index with dimension names and attributes from Zarr V2
 * consolidated metadata.
 */
async function enrichMetadataWithZarrV2(
  stores: Record<string, Set<string>>,
  datasources: Record<string, TDataSource>
) {
  for (const [store, vars] of Object.entries(stores)) {
    const zarrStore = await zarr.withConsolidated(lru(createFetchStore(store)));
    const root = await zarr.open(zarrStore, { kind: "group" });

    for (const varname of vars) {
      try {
        const variable = await zarr.open(root.resolve(`/${varname}`), {
          kind: "array",
        });
        const arrayDimensions = variable.attrs?._ARRAY_DIMENSIONS;
        datasources[varname].attrs = {
          ...datasources[varname].attrs,
          ...variable.attrs,
          dimensionNames: arrayDimensions,
        } as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Zarrita does not provide a proper way to get dimension names for Zarr V3
 * arrays, so we need to fetch metadata for each store and enrich the index with
 * dimension names and attributes.
 */
async function enrichMetadataWithZarrV3(
  stores: Record<string, Set<string>>,
  datasources: Record<string, TDataSource>
) {
  for (const [store, vars] of Object.entries(stores)) {
    const group = await ZarrDataManager.openZarrV3Metadata(
      createFetchStore(store)
    );
    if (group.attrs) {
      const rootMetadata = group.attrs as TZarrV3RootMetadata;
      const metadata = rootMetadata.consolidated_metadata?.metadata;
      if (metadata) {
        for (const varname of vars) {
          const node = metadata[varname];
          if (node && node.node_type === "array") {
            const arrayNode = node as zarr.ArrayMetadata;
            datasources[varname].attrs = {
              ...datasources[varname].attrs,
              ...arrayNode.attributes,
              dimensionNames: arrayNode.dimension_names,
            } as Record<string, unknown>;
          }
        }
      }
    }
  }
}

export async function indexFromIndex(src: string): Promise<TSources> {
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`Failed to fetch index from ${src}: ${res.statusText}`);
  } else if (res.status >= 400) {
    throw new Error(`Index not found at ${src}`);
  }
  const sources = (await res.json()) as TSources;
  const datasources = sources.levels[0].datasources;
  const stores = collectStores(datasources);
  try {
    await enrichMetadataWithZarrV3(stores, datasources);
    sources.zarr_format = ZARR_FORMAT.V3; // eslint-disable-line camelcase
  } catch {
    await enrichMetadataWithZarrV2(stores, datasources);
    sources.zarr_format = ZARR_FORMAT.V2; // eslint-disable-line camelcase
  }
  return sources;
}
