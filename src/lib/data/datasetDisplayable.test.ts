import { describe, expect, it } from "vitest";

import {
  GRID_TYPES,
  getGridType,
  type T_GRID_TYPES,
} from "./gridTypeDetector";
import { resolveHealpixNside } from "./healpixUtils";
import { indexFromZarr, indexMultiscaleLevel } from "./sourceIndexing";

import type { TSources } from "@/lib/types/GlobeTypes";

const SENTINEL2_URL =
  "https://data.grid4earth.eu/sentinel-2-l2a/S2B_MSIL2A_20250522T105619_N0511_R094_20250522T121018.zarr";

/** True for a positive power-of-two HEALPix nside. */
function isValidNside(nside: number): boolean {
  return (
    Number.isInteger(nside) && nside > 0 && Number.isInteger(Math.log2(nside))
  );
}

/**
 * Resolve a dataset the same way the app does for a Zarr source: build the
 * index, pick the default variable (explicit default, else the first
 * non-hidden variable) and detect the grid type. A dataset is "displayable"
 * when a non-hidden variable exists and the grid type is not ERROR.
 */
async function resolveDisplay(url: string): Promise<{
  index: TSources;
  varname: string | undefined;
  gridType: T_GRID_TYPES;
  errors: string[];
}> {
  const index = await indexFromZarr(url);
  const datasources = index.levels[0].datasources;
  const validVars = Object.keys(datasources).filter(
    (name) => !datasources[name].hidden
  );
  const varname = index.default_var ?? validVars[0];

  const errors: string[] = [];
  const logError = (maybeError: unknown, context?: string) => {
    errors.push(`${context ?? "error"}: ${String(maybeError)}`);
  };

  const gridType = varname
    ? await getGridType(true, varname, index, logError)
    : GRID_TYPES.ERROR;

  return { index, varname, gridType, errors };
}

describe("dataset displayability", () => {
  it("displays a flat HEALPix dataset with a CRS variable", async () => {
    const url =
      "https://pangeo-eosc-minioapi.vm.fedcloud.eu/afouilloux-riomar/small_test1_hp_fixed.zarr";
    const { index, varname, gridType, errors } = await resolveDisplay(url);

    expect(varname).toBeTruthy();
    expect(errors).toEqual([]);
    expect(gridType).not.toBe(GRID_TYPES.ERROR);
    expect(gridType).toBe(GRID_TYPES.HEALPIX);

    // nside comes from the CRS variable (healpix_nside = 8192).
    const nside = await resolveHealpixNside(index, varname!);
    expect(nside).toBe(8192);
  });

  it("displays a nested HEALPix dataset described only by a DGGS attribute", async () => {
    const url = SENTINEL2_URL;
    const { index, varname, gridType, errors } = await resolveDisplay(url);

    // Data lives in a nested subgroup, so the index must point there.
    expect(index.levels[0].datasources[varname!].dataset).not.toBe("");
    expect(varname).toBeTruthy();
    expect(errors).toEqual([]);
    expect(gridType).not.toBe(GRID_TYPES.ERROR);
    expect(gridType).toBe(GRID_TYPES.HEALPIX);

    // There is no CRS variable, so nside must come from the DGGS group
    // attribute (nside = 2 ** refinement_level).
    const nside = await resolveHealpixNside(index, varname!);
    expect(isValidNside(nside)).toBe(true);
  });

  it("exposes a multiscales layout and switches between levels", async () => {
    const index = await indexFromZarr(SENTINEL2_URL);
    const ms = index.multiscales;

    // The multiscales attribute lives on a subgroup, but must still be found.
    expect(ms).toBeDefined();
    expect(ms!.layout.length).toBeGreaterThan(1);
    expect(ms!.baseUrl).toBe(SENTINEL2_URL);

    // The default level is the coarsest (smallest refinement_level), which also
    // yields the smallest nside across the layout.
    const levels = ms!.layout;
    const nsides = await Promise.all(
      levels.map(async (_, i) => {
        const levelIndex = await indexMultiscaleLevel(ms!.baseUrl, i);
        const vars = levelIndex.levels[0].datasources;
        const varname = Object.keys(vars).find((v) => !vars[v].hidden)!;
        return resolveHealpixNside(levelIndex, varname);
      })
    );

    const defaultNside = nsides[ms!.activeLevel!];
    expect(defaultNside).toBe(Math.min(...nsides));

    // Each level is independently displayable and distinct in resolution.
    expect(new Set(nsides).size).toBe(levels.length);
    for (const nside of nsides) {
      expect(isValidNside(nside)).toBe(true);
    }
  });
});
