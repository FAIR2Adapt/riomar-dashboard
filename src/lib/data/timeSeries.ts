// eslint-disable-next-line camelcase
import { cell_lonlat_nside } from "@eopf-dggs/healpix-geo";
import * as zarr from "zarrita";

import { GRID_TYPES, type T_GRID_TYPES } from "./gridTypeDetector";
import { decodeTime } from "./timeHandling";
import { ZarrDataManager } from "./ZarrDataManager";
import {
  createMissingOrFillPredicate,
  getLatLonData,
  isLatitudeName,
  isLongitudeName,
} from "./zarrUtils";

import type { TSources } from "@/lib/types/GlobeTypes";

/** A geographic selection: either a single point or a bounding box. */
export type TRegion =
  | { mode: "point"; lat: number; lon: number }
  | {
      mode: "bbox";
      latMin: number;
      latMax: number;
      lonMin: number;
      lonMax: number;
    };

/** Result of extracting a time series for one variable. */
export type TSeriesResult = {
  /** Time axis as epoch milliseconds. */
  times: number[];
  /** One value per time step (null where all sampled cells were missing). */
  values: (number | null)[];
  /** Variable units, if known. */
  units?: string;
  /** Number of grid cells averaged per time step. */
  cellCount: number;
};

/** Smallest angular distance between two longitudes (degrees), handling wrap. */
function lonDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) {
    d = 360 - d;
  }
  return d;
}

/** Normalise a longitude to the [-180, 180) range for comparison. */
function normLon(lon: number): number {
  let l = ((lon + 180) % 360) - 180;
  if (l < -180) {
    l += 360;
  }
  return l;
}

function lonInRange(lon: number, lonMin: number, lonMax: number): boolean {
  const l = normLon(lon);
  const lo = normLon(lonMin);
  const hi = normLon(lonMax);
  if (lo <= hi) {
    return l >= lo && l <= hi;
  }
  // Range crosses the antimeridian.
  return l >= lo || l <= hi;
}

/**
 * Finds the time dimension. The dimension name is not hardcoded: we pick the
 * first dimension whose name contains "time" (case-insensitive).
 */
function findTimeAxis(dimNames: string[]): number {
  return dimNames.findIndex((n) => n.toLowerCase().includes("time"));
}

/** Reads a 1-D coordinate array, trying the time / variable / grid sources. */
async function readCoordArray(
  datasources: TSources,
  variableSource: { store: string; dataset: string },
  name: string
): Promise<{ values: ArrayLike<number | bigint>; attrs: zarr.Attributes }> {
  const candidates = [
    datasources.levels[0].time,
    variableSource,
    datasources.levels[0].grid,
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const arr = await ZarrDataManager.getVariableInfo(candidate, name);
      const chunk = await ZarrDataManager.getVariableDataFromArray(arr, [null]);
      return {
        values: chunk.data as ArrayLike<number | bigint>,
        attrs: arr.attrs,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Could not read coordinate "${name}"`);
}

/** Reads the HEALPix cell-id list for a variable's dataset. */
async function getHealpixCells(source: {
  store: string;
  dataset: string;
}): Promise<number[]> {
  for (const name of ["cell", "cell_ids"]) {
    try {
      const raw = (await ZarrDataManager.getVariableData(source, name)).data;
      const ids: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        ids.push(Number((raw as ArrayLike<number | bigint>)[i]));
      }
      return ids;
    } catch {
      continue;
    }
  }
  throw new Error("No HEALPix cell index found");
}

/** Index of the value in `coords` nearest to `target` (plain scalar coord). */
function nearestIndex(coords: ArrayLike<number | bigint>, target: number) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dist = Math.abs(Number(coords[i]) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Index of the longitude in `coords` nearest to `target`, handling wrap. */
function nearestLonIndex(coords: ArrayLike<number | bigint>, target: number) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dist = lonDelta(Number(coords[i]), target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Inclusive [min, max] index range of coords falling within [lo, hi]. */
function indexRange(
  coords: ArrayLike<number | bigint>,
  lo: number,
  hi: number
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    const v = Number(coords[i]);
    if (v >= lo && v <= hi) {
      min = Math.min(min, i);
      max = Math.max(max, i);
    }
  }
  if (min === Infinity) {
    return null;
  }
  return [min, max];
}

/**
 * Averages a fetched chunk over every kept axis except time, producing one
 * value per time step. `keptAxes` lists the original axis indices that survived
 * the selection (i.e. those selected with a slice), in order.
 */
function averageOverSpace(
  chunk: zarr.Chunk<zarr.DataType>,
  keptAxes: number[],
  timeAxis: number,
  isMissing: (v: number) => boolean
): (number | null)[] {
  const data = chunk.data as ArrayLike<number | bigint>;
  const shape = chunk.shape;
  const stride = chunk.stride;
  const tPos = keptAxes.indexOf(timeAxis);
  const ntime = shape[tPos];
  const tStride = stride[tPos];

  const otherPos = keptAxes.map((_, i) => i).filter((i) => i !== tPos);
  const result: (number | null)[] = [];

  for (let t = 0; t < ntime; t++) {
    let sum = 0;
    let count = 0;
    const idx = otherPos.map(() => 0);
    // Iterate every combination of the non-time kept axes (odometer).
    for (;;) {
      let offset = t * tStride;
      for (let k = 0; k < otherPos.length; k++) {
        offset += idx[k] * stride[otherPos[k]];
      }
      const v = Number(data[offset]);
      if (!isMissing(v)) {
        sum += v;
        count += 1;
      }
      let k = otherPos.length - 1;
      while (k >= 0) {
        idx[k] += 1;
        if (idx[k] < shape[otherPos[k]]) {
          break;
        }
        idx[k] = 0;
        k -= 1;
      }
      if (k < 0) {
        break;
      }
    }
    result.push(count > 0 ? sum / count : null);
  }
  return result;
}

/** Builds the epoch-ms time axis for the inclusive index range [start, end]. */
async function buildTimeAxis(
  datasources: TSources,
  variableSource: { store: string; dataset: string },
  timeName: string,
  start: number,
  end: number
): Promise<number[]> {
  const { values, attrs } = await readCoordArray(
    datasources,
    variableSource,
    timeName
  );
  const times: number[] = [];
  const lo = Math.max(0, start);
  const hi = Math.min(end, values.length - 1);
  for (let i = lo; i <= hi; i++) {
    times.push(decodeTime(Number(values[i]), attrs).valueOf());
  }
  return times;
}

/**
 * Loads the full time axis (epoch milliseconds) for a dataset, using `varname`
 * as the reference variable. Used to populate the time-range slider.
 */
export async function loadTimeAxis(
  datasources: TSources,
  varname: string
): Promise<number[]> {
  const variableSource = ZarrDataManager.getDatasetSource(datasources, varname);
  const dimNames = await ZarrDataManager.getDimensionNames(datasources, varname);
  const timeAxis = findTimeAxis(dimNames);
  if (timeAxis === -1) {
    return [];
  }
  const { values, attrs } = await readCoordArray(
    datasources,
    variableSource,
    dimNames[timeAxis]
  );
  const times: number[] = [];
  for (let i = 0; i < values.length; i++) {
    times.push(decodeTime(Number(values[i]), attrs).valueOf());
  }
  return times;
}

/**
 * Sets the non-spatial, non-time dimensions of `selection` to a fixed index,
 * reusing the current slider position (by dimension name) when available.
 */
function fixOtherDimensions(
  selection: (number | null | zarr.Slice)[],
  dimNames: string[],
  shape: readonly number[],
  spatialAxes: Set<number>,
  timeAxis: number,
  otherDimSelections: Record<string, number>
) {
  for (let i = 0; i < dimNames.length; i++) {
    if (i === timeAxis || spatialAxes.has(i)) {
      continue;
    }
    const requested = otherDimSelections[dimNames[i]];
    const clamped =
      requested === undefined
        ? 0
        : Math.max(0, Math.min(shape[i] - 1, Math.round(requested)));
    selection[i] = clamped;
  }
}

async function extractHealpixSeries(
  datasources: TSources,
  variableSource: { store: string; dataset: string },
  varname: string,
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  region: TRegion,
  timeAxis: number,
  ntime: number,
  selection: (number | null | zarr.Slice)[],
  isMissing: (v: number) => boolean
): Promise<(number | null)[]> {
  const nside = (await ZarrDataManager.getCRSInfo(datasources, varname)).attrs
    .healpix_nside as number;
  const cellIds = await getHealpixCells(variableSource);
  const cellAxis = datavar.shape.length - 1;

  // Cell centres as [lon, lat] in degrees.
  const centres = cellIds.map((id) =>
    cell_lonlat_nside(nside, BigInt(id), 0.5, 0.5)
  );

  if (region.mode === "point") {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < centres.length; i++) {
      const dLat = centres[i][1] - region.lat;
      const dLon = lonDelta(centres[i][0], region.lon);
      const dist = dLat * dLat + dLon * dLon;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    selection[cellAxis] = best;
    const chunk = await ZarrDataManager.getVariableDataFromArray(
      datavar,
      selection
    );
    return averageOverSpace(chunk, [timeAxis], timeAxis, isMissing);
  }

  // Bounding box: collect every cell whose centre falls inside it.
  const cellIdxs: number[] = [];
  for (let i = 0; i < centres.length; i++) {
    const [lon, lat] = centres[i];
    if (
      lat >= region.latMin &&
      lat <= region.latMax &&
      lonInRange(lon, region.lonMin, region.lonMax)
    ) {
      cellIdxs.push(i);
    }
  }
  if (cellIdxs.length === 0) {
    throw new Error("No HEALPix cells fall within the bounding box");
  }

  // Cells aren't contiguous, so fetch the whole cell axis and average the subset.
  selection[cellAxis] = zarr.slice(0, cellIds.length);
  const chunk = await ZarrDataManager.getVariableDataFromArray(
    datavar,
    selection
  );
  const data = chunk.data as ArrayLike<number | bigint>;
  const tPos = [timeAxis, cellAxis].indexOf(timeAxis) === 0 ? 0 : 1;
  const tStride = chunk.stride[tPos];
  const cStride = chunk.stride[tPos === 0 ? 1 : 0];
  const result: (number | null)[] = [];
  for (let t = 0; t < ntime; t++) {
    let sum = 0;
    let count = 0;
    for (const ci of cellIdxs) {
      const v = Number(data[t * tStride + ci * cStride]);
      if (!isMissing(v)) {
        sum += v;
        count += 1;
      }
    }
    result.push(count > 0 ? sum / count : null);
  }
  return result;
}

async function extractGriddedSeries(
  datasources: TSources,
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  dimNames: string[],
  region: TRegion,
  timeAxis: number,
  selection: (number | null | zarr.Slice)[],
  isMissing: (v: number) => boolean
): Promise<(number | null)[]> {
  const latAxis = dimNames.findIndex((n) => isLatitudeName(n));
  const lonAxis = dimNames.findIndex((n) => isLongitudeName(n));
  if (latAxis === -1 || lonAxis === -1) {
    throw new Error("Variable has no latitude/longitude dimensions");
  }

  const { latitudes, longitudes } = await getLatLonData(datavar, datasources);
  if (!longitudes || latitudes.shape.length !== 1) {
    throw new Error("Only 1-D latitude/longitude grids are supported here");
  }
  const latData = latitudes.data as ArrayLike<number | bigint>;
  const lonData = longitudes.data as ArrayLike<number | bigint>;

  const keptAxes = [timeAxis];
  if (region.mode === "point") {
    selection[latAxis] = nearestIndex(latData, region.lat);
    selection[lonAxis] = nearestLonIndex(lonData, region.lon);
  } else {
    const latRange = indexRange(latData, region.latMin, region.latMax);
    const lonRange = indexRange(lonData, region.lonMin, region.lonMax);
    if (!latRange || !lonRange) {
      throw new Error("Bounding box does not overlap the data grid");
    }
    selection[latAxis] = zarr.slice(latRange[0], latRange[1] + 1);
    selection[lonAxis] = zarr.slice(lonRange[0], lonRange[1] + 1);
    keptAxes.push(latAxis, lonAxis);
  }
  keptAxes.sort((a, b) => a - b);

  const chunk = await ZarrDataManager.getVariableDataFromArray(
    datavar,
    selection
  );
  return averageOverSpace(chunk, keptAxes, timeAxis, isMissing);
}

/**
 * Extracts a per-time-step series for one variable at a point or averaged over
 * a bounding box.
 */
export async function fetchTimeSeries(
  datasources: TSources,
  varname: string,
  gridType: T_GRID_TYPES | undefined,
  region: TRegion,
  otherDimSelections: Record<string, number> = {},
  timeRange?: { start: number; end: number }
): Promise<TSeriesResult> {
  const variableSource = ZarrDataManager.getDatasetSource(datasources, varname);
  const datavar = await ZarrDataManager.getVariableInfo(
    variableSource,
    varname
  );
  const dimNames = await ZarrDataManager.getDimensionNames(
    datasources,
    varname
  );
  const shape = datavar.shape;
  const isMissing = createMissingOrFillPredicate(datavar);

  const timeAxis = findTimeAxis(dimNames);
  if (timeAxis === -1) {
    throw new Error(`Variable "${varname}" has no time dimension`);
  }
  const ntimeFull = shape[timeAxis];

  // Clamp the requested time-index range; fetch only that subset.
  let start = 0;
  let end = ntimeFull - 1;
  if (timeRange) {
    start = Math.max(0, Math.min(ntimeFull - 1, Math.round(timeRange.start)));
    end = Math.max(start, Math.min(ntimeFull - 1, Math.round(timeRange.end)));
  }
  const ntime = end - start + 1;

  const times = await buildTimeAxis(
    datasources,
    variableSource,
    dimNames[timeAxis],
    start,
    end
  );

  const selection: (number | null | zarr.Slice)[] = new Array(
    shape.length
  ).fill(0);
  selection[timeAxis] = zarr.slice(start, end + 1);

  const isHealpix = gridType === GRID_TYPES.HEALPIX;

  // Determine spatial axes so the remaining dimensions can be fixed.
  const spatialAxes = new Set<number>();
  if (isHealpix) {
    spatialAxes.add(shape.length - 1);
  } else {
    const latAxis = dimNames.findIndex((n) => isLatitudeName(n));
    const lonAxis = dimNames.findIndex((n) => isLongitudeName(n));
    if (latAxis !== -1) {
      spatialAxes.add(latAxis);
    }
    if (lonAxis !== -1) {
      spatialAxes.add(lonAxis);
    }
  }
  fixOtherDimensions(
    selection,
    dimNames,
    shape,
    spatialAxes,
    timeAxis,
    otherDimSelections
  );

  const values = isHealpix
    ? await extractHealpixSeries(
        datasources,
        variableSource,
        varname,
        datavar,
        region,
        timeAxis,
        ntime,
        selection,
        isMissing
      )
    : await extractGriddedSeries(
        datasources,
        datavar,
        dimNames,
        region,
        timeAxis,
        selection,
        isMissing
      );

  const cellCount = values.length > 0 ? 1 : 0;
  return {
    times,
    values,
    units: datavar.attrs.units as string | undefined,
    cellCount,
  };
}
