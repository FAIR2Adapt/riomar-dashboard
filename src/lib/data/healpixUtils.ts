import { ZarrDataManager } from "./ZarrDataManager";

import type { TSources } from "@/lib/types/GlobeTypes";

/**
 * Resolve the HEALPix `nside` for a variable. Prefers the CRS variable's
 * `healpix_nside`, falling back to the DGGS group attribute's
 * `refinement_level` (nside = 2 ** refinement_level) for datasets that carry no
 * CRS variable (e.g. the zarr-conventions DGGS layout).
 */
export async function resolveHealpixNside(
  datasources: TSources,
  varname: string
): Promise<number> {
  try {
    const crs = await ZarrDataManager.getCRSInfo(datasources, varname);
    const nside = crs.attrs["healpix_nside"];
    if (typeof nside === "number") {
      return nside;
    }
  } catch {
    // No CRS variable; fall back to the DGGS attribute below.
  }
  const source = ZarrDataManager.getDatasetSource(datasources, varname);
  const group = await ZarrDataManager.getDatasetGroup(source);
  const dggs = group.attrs?.dggs as { refinement_level?: number } | undefined;
  if (typeof dggs?.refinement_level === "number") {
    return 2 ** dggs.refinement_level;
  }
  throw new Error("Could not determine HEALPix nside");
}
