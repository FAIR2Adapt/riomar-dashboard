<script lang="ts" setup>
// eslint-disable-next-line camelcase
import { cell_vertices_lonlat_nside } from "@eopf-dggs/healpix-geo";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { storeToRefs } from "pinia";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as zarr from "zarrita";

import { useGridDataAccess } from "./composables/useGridDataAccess.ts";

import { buildDimensionRangesAndIndices } from "@/lib/data/dimensionHandling.ts";
import { ZarrDataManager } from "@/lib/data/ZarrDataManager.ts";
import { getDataBounds } from "@/lib/data/zarrUtils.ts";
import { getColormapLut } from "@/lib/shaders/colormapLut.ts";
import type { TDimensionRange, TSources } from "@/lib/types/GlobeTypes.ts";
import { useUrlParameterStore } from "@/store/paramStore.ts";
import {
  PICK_MODE,
  UPDATE_MODE,
  useGlobeControlStore,
  type TUpdateMode,
} from "@/store/store.ts";
import {
  HISTOGRAM_SUMMARY_BINS,
  buildHistogramSummary,
  mergeHistogramSummaries,
  rebinHistogramSummary,
  type THistogramSummary,
} from "@/utils/histogram.ts";
import { useLog } from "@/utils/logging.ts";

const props = defineProps<{ datasources?: TSources }>();

const HEALPIX_UNSEEN = -1.6375e30;
const FALLBACK_COLOR = "rgb(128,128,128)";

const store = useGlobeControlStore();
const { logError } = useLog();
const {
  varnameSelector,
  dimSlidersValues,
  isInitializingVariable,
  varinfo,
  colormap,
  invertColormap,
  posterizeLevels,
  selection,
  pickMode,
} = storeToRefs(store);

const urlParameterStore = useUrlParameterStore();
const { paramDimIndices, paramDimMinBounds, paramDimMaxBounds } =
  storeToRefs(urlParameterStore);

const { resetDataVars, getDataVar, getTimeInfo, getDimensionInfo } =
  useGridDataAccess();

const mapContainer = ref<HTMLDivElement>();
let map: maplibregl.Map | undefined;
let cellIds: number[] = [];
let nside = 0;

// --- Map-pick state (location / bounding-box selection for the time series) ---
let pickMarker: maplibregl.Marker | undefined;
let bboxStartMarker: maplibregl.Marker | undefined;
let bboxFirstCorner: { lng: number; lat: number } | null = null;

function clearPickOverlays() {
  pickMarker?.remove();
  pickMarker = undefined;
  bboxStartMarker?.remove();
  bboxStartMarker = undefined;
  bboxFirstCorner = null;
  const src = map?.getSource("pick-bbox") as
    | maplibregl.GeoJSONSource
    | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: [],
  } as GeoJSON.FeatureCollection);
}

function drawPickBbox(
  lonMin: number,
  latMin: number,
  lonMax: number,
  latMax: number
) {
  const src = map?.getSource("pick-bbox") as
    | maplibregl.GeoJSONSource
    | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [lonMin, latMin],
              [lonMax, latMin],
              [lonMax, latMax],
              [lonMin, latMax],
              [lonMin, latMin],
            ],
          ],
        },
      },
    ],
  } as GeoJSON.FeatureCollection);
}

function onMapClick(e: maplibregl.MapMouseEvent) {
  if (!map || pickMode.value === PICK_MODE.NONE) {
    return;
  }
  const { lng, lat } = e.lngLat;

  if (pickMode.value === PICK_MODE.POINT) {
    clearPickOverlays();
    pickMarker = new maplibregl.Marker({ color: "#4a90d9" })
      .setLngLat([lng, lat])
      .addTo(map);
    store.setPickedPoint({ lat, lon: lng });
    return;
  }

  // Bounding-box mode: first click sets one corner, second click completes it.
  if (!bboxFirstCorner) {
    bboxFirstCorner = { lng, lat };
    bboxStartMarker = new maplibregl.Marker({ color: "#e8743b" })
      .setLngLat([lng, lat])
      .addTo(map);
    return;
  }
  const latMin = Math.min(bboxFirstCorner.lat, lat);
  const latMax = Math.max(bboxFirstCorner.lat, lat);
  const lonMin = Math.min(bboxFirstCorner.lng, lng);
  const lonMax = Math.max(bboxFirstCorner.lng, lng);
  drawPickBbox(lonMin, latMin, lonMax, latMax);
  bboxStartMarker?.remove();
  bboxStartMarker = undefined;
  bboxFirstCorner = null;
  store.setPickedBbox({ latMin, latMax, lonMin, lonMax });
}

function addPickLayers() {
  if (!map || map.getSource("pick-bbox")) {
    return;
  }
  map.addSource("pick-bbox", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "pick-bbox-fill",
    type: "fill",
    source: "pick-bbox",
    paint: { "fill-color": "#e8743b", "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "pick-bbox-line",
    type: "line",
    source: "pick-bbox",
    paint: { "line-color": "#e8743b", "line-width": 2 },
  });
}

// Update the cursor and reset any in-progress selection when picking starts.
watch(
  () => pickMode.value,
  (mode) => {
    if (!map) {
      return;
    }
    if (mode === PICK_MODE.NONE) {
      map.getCanvas().style.cursor = "";
      bboxStartMarker?.remove();
      bboxStartMarker = undefined;
      bboxFirstCorner = null;
      return;
    }
    clearPickOverlays();
    map.getCanvas().style.cursor = "crosshair";
  }
);

// Cache of the last fetched slice so colormap/bounds changes can re-color the
// existing GeoJSON without refetching from the store.
let lastValues: Float32Array | null = null;
let lastDataMin = 0;
let lastDataMax = 0;
let lastMissingValue = HEALPIX_UNSEEN;
let lastFillValue = HEALPIX_UNSEEN;

// Number of bars shown in the distribution plot (matches useSharedGridLogic).
const DISPLAY_BIN_COUNT = 50;
// High-resolution summary of the last fetched slice, kept so the selection-range
// histogram can be re-binned on bounds/posterize changes without refetching.
let lastHistogramSummary: THistogramSummary | null = null;

watch(
  () => varnameSelector.value,
  () => getData()
);

// Re-color (no refetch) when the colormap, inversion, or min/max range changes.
watch(
  [() => colormap.value, () => invertColormap.value, () => selection.value],
  () => recolor(),
  { deep: true }
);

// Re-bin the selection-range histogram when the bounds or posterize level change
// (no refetch — the cached summary covers the full data range).
watch(
  [() => selection.value, () => posterizeLevels.value],
  () => recomputeSelectionHistogram(selection.value.low, selection.value.high),
  { deep: true }
);

watch(
  () => dimSlidersValues.value,
  async () => {
    if (isInitializingVariable.value) {
      isInitializingVariable.value = false;
      return;
    }
    await getData(UPDATE_MODE.SLIDER_TOGGLE);
  },
  { deep: true }
);

watch(
  () => props.datasources,
  () => datasourceUpdate()
);

function cellToPolygon(cellId: number): number[][] {
  // Returns [lon0,lat0, lon1,lat1, ...] in degrees on WGS84 (ellipsoid-corrected)

  const v = cell_vertices_lonlat_nside(nside, BigInt(cellId));
  // Corners: S, E, N, W — form a closed ring
  return [
    [v[0], v[1]],
    [v[2], v[3]],
    [v[4], v[5]],
    [v[6], v[7]],
    [v[0], v[1]],
  ];
}

function valueToColor(
  val: number,
  low: number,
  high: number,
  lut: Uint8ClampedArray | null,
  invert: boolean
): string {
  if (isNaN(val)) {
    return "rgba(0,0,0,0)";
  }
  let t = high > low ? (val - low) / (high - low) : 0.5;
  t = Math.max(0, Math.min(1, t));
  if (invert) {
    t = 1 - t;
  }
  if (!lut) {
    return FALLBACK_COLOR;
  }
  const idx = Math.round(t * 255) * 3;
  return `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]})`;
}

// Color range from the store selection (set by the min/max sliders), falling
// back to the data range when no selection is set yet.
function getColorRange(dataMin: number, dataMax: number) {
  const sel = selection.value;
  const hasSel =
    sel && "low" in sel && "high" in sel && (sel.low !== 0 || sel.high !== 0);
  return hasSel
    ? { low: sel.low as number, high: sel.high as number }
    : { low: dataMin, high: dataMax };
}

async function getCells(): Promise<number[] | undefined> {
  const source = ZarrDataManager.getDatasetSource(
    props.datasources!,
    varnameSelector.value
  );
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
  return undefined;
}

async function getHealpixNside(): Promise<number> {
  const crs = await ZarrDataManager.getCRSInfo(
    props.datasources!,
    varnameSelector.value
  );
  return crs.attrs["healpix_nside"] as number;
}

async function datasourceUpdate() {
  resetDataVars();
  if (!props.datasources) {
    return;
  }
  store.startLoading();

  try {
    nside = await getHealpixNside();
    cellIds = (await getCells()) ?? [];
    await getData();
  } catch (error) {
    logError(error, "Could not load HEALPix data");
  } finally {
    store.stopLoading();
  }
}

function buildGeoJSON(
  values: Float32Array,
  dataMin: number,
  dataMax: number,
  missingValue: number,
  fillValue: number
) {
  const { low, high } = getColorRange(dataMin, dataMax);
  const lut = getColormapLut(colormap.value);
  const invert = invertColormap.value;
  const features = [];
  for (let i = 0; i < cellIds.length; i++) {
    const v = values[i];
    if (isNaN(v) || v === missingValue || v === fillValue) {
      continue;
    }
    features.push({
      type: "Feature" as const,
      properties: { color: valueToColor(v, low, high, lut, invert), value: v },
      geometry: {
        type: "Polygon" as const,
        coordinates: [cellToPolygon(cellIds[i])],
      },
    });
  }
  return { type: "FeatureCollection" as const, features };
}

// Rebuild the GeoJSON from the cached slice using the current colormap/range.
function recolor() {
  if (!map || !lastValues) {
    return;
  }
  const source = map.getSource("healpix") as
    | maplibregl.GeoJSONSource
    | undefined;
  if (!source) {
    return;
  }
  source.setData(
    buildGeoJSON(
      lastValues,
      lastDataMin,
      lastDataMax,
      lastMissingValue,
      lastFillValue
    )
  );
}

async function fetchSlice(
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  updateMode: TUpdateMode
) {
  const dimensionNames = await ZarrDataManager.getDimensionNames(
    props.datasources!,
    varnameSelector.value
  );
  const { dimensionRanges, indices } = buildDimensionRangesAndIndices(
    datavar,
    dimensionNames,
    paramDimIndices.value,
    paramDimMinBounds.value,
    paramDimMaxBounds.value,
    dimSlidersValues.value.length > 0 ? dimSlidersValues.value : null,
    [datavar.shape.length - 1],
    varinfo.value?.dimRanges,
    updateMode === UPDATE_MODE.SLIDER_TOGGLE
  );

  const localIndices = indices.slice();
  localIndices[localIndices.length - 1] = zarr.slice(0, cellIds.length);
  const rawData = (
    await ZarrDataManager.getVariableDataFromArray(datavar, localIndices)
  ).data;
  const values = new Float32Array(cellIds.length);
  for (let i = 0; i < cellIds.length; i++) {
    values[i] = Number((rawData as ArrayLike<number | bigint>)[i]);
  }
  return { values, dimensionRanges, indices };
}

// eslint-disable-next-line max-lines-per-function
async function getData(updateMode: TUpdateMode = UPDATE_MODE.INITIAL_LOAD) {
  if (!props.datasources || !map || cellIds.length === 0) {
    return;
  }
  store.startLoading();

  try {
    const datavar = await getDataVar(varnameSelector.value, props.datasources);
    if (!datavar) {
      return;
    }

    const { values, dimensionRanges, indices } = await fetchSlice(
      datavar,
      updateMode
    );

    let { min, max, missingValue, fillValue } = getDataBounds(datavar, values);
    if (isNaN(missingValue)) missingValue = HEALPIX_UNSEEN; // eslint-disable-line curly
    if (isNaN(fillValue)) fillValue = HEALPIX_UNSEEN; // eslint-disable-line curly

    // Cache for recolor() so colormap/bounds changes don't refetch.
    lastValues = values;
    lastDataMin = min;
    lastDataMax = max;
    lastMissingValue = missingValue;
    lastFillValue = fillValue;

    const geojson = buildGeoJSON(values, min, max, missingValue, fillValue);
    const source = map.getSource("healpix") as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(geojson);
      // Fit map to data bounds on first load
      if (
        geojson.features.length > 0 &&
        updateMode === UPDATE_MODE.INITIAL_LOAD
      ) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of geojson.features) {
          for (const coord of (f.geometry as GeoJSON.Polygon).coordinates[0]) {
            bounds.extend(coord as [number, number]);
          }
        }
        map.fitBounds(bounds, { padding: 20 });
      }
    }

    const histSummary = buildHistogramSummary(
      values,
      min,
      max,
      HISTOGRAM_SUMMARY_BINS,
      fillValue,
      missingValue
    );
    updateHistogram([histSummary], min, max);
    updateVarInfo(
      datavar,
      [histSummary],
      min,
      max,
      dimensionRanges,
      indices,
      updateMode
    );
  } catch (error) {
    logError(error, "Could not fetch data");
  } finally {
    store.stopLoading();
  }
}

async function updateVarInfo(
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  _histogramSummaries: THistogramSummary[],
  dataMin: number,
  dataMax: number,
  dimensionRanges: TDimensionRange[],
  indices: (number | zarr.Slice | null)[],
  updateMode: TUpdateMode
) {
  const dimInfo = [];
  for (const dim of dimensionRanges) {
    if (
      dim?.name === "time" ||
      dim?.name === "time_counter" ||
      dim?.name?.startsWith("time")
    ) {
      dimInfo.push(
        await getTimeInfo(
          props.datasources!,
          dimensionRanges,
          indices[0] as number
        )
      );
    } else {
      dimInfo.push(
        await getDimensionInfo(
          props.datasources!.levels[0].datasources[varnameSelector.value],
          dim!,
          indices[dimensionRanges.indexOf(dim)] as number
        )
      );
    }
  }

  store.updateVarInfo(
    {
      attrs: datavar.attrs,
      dimInfo,
      bounds: { low: dataMin, high: dataMax },
      dimRanges: dimensionRanges,
    },
    indices as number[],
    updateMode
  );
}

// Re-bin the cached summary over the current selection range. Mirrors the
// selection-range logic in useSharedGridLogic so ColorBar's overlay matches.
function recomputeSelectionHistogram(low?: number, high?: number) {
  if (
    !lastHistogramSummary ||
    low === undefined ||
    high === undefined ||
    !isFinite(low) ||
    !isFinite(high)
  ) {
    store.updateHistogram(undefined);
    return;
  }
  const binCount =
    posterizeLevels.value > 1 ? posterizeLevels.value : DISPLAY_BIN_COUNT;
  store.updateHistogram(
    rebinHistogramSummary(lastHistogramSummary, binCount, low, high)
  );
}

// Populate the distribution plot from the loaded (visible) tiles. The
// full-range histogram is fixed over [min, max]; the selection-range histogram
// tracks the current bounds.
function updateHistogram(
  summaries: THistogramSummary[],
  min: number,
  max: number
) {
  if (!summaries.length || !isFinite(min) || !isFinite(max)) {
    store.updateHistogram(undefined);
    store.updateFullHistogram(undefined);
    lastHistogramSummary = null;
    return;
  }
  const summary = mergeHistogramSummaries(
    summaries,
    min,
    max,
    HISTOGRAM_SUMMARY_BINS
  );
  lastHistogramSummary = summary;
  store.updateFullHistogram(
    rebinHistogramSummary(summary, DISPLAY_BIN_COUNT, min, max)
  );
  recomputeSelectionHistogram(selection.value.low, selection.value.high);
}

const selectedBasemap = ref("osm");

const BASEMAP_STYLES: Record<string, maplibregl.StyleSpecification> = {
  osm: {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  },
  emodnet: {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          "https://tiles.emodnet-bathymetry.eu/v12/mean_atlas_land/web_mercator/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "&copy; EMODnet Bathymetry",
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  },
  satellite: {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "&copy; Esri World Imagery",
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  },
};

function switchBasemap(name: string) {
  if (!map) {
    return;
  }
  selectedBasemap.value = name;
  const style = BASEMAP_STYLES[name];
  map.setStyle(style);

  // Re-add healpix layers after style change
  map.once("styledata", () => {
    map!.addSource("healpix", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map!.addLayer({
      id: "healpix-fill",
      type: "fill",
      source: "healpix",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.9 },
    });
    addPickLayers();
    // Re-render current data
    getData();
  });
}

onMounted(() => {
  map = new maplibregl.Map({
    container: mapContainer.value!,
    style: BASEMAP_STYLES.osm,
    center: [-3, 46],
    zoom: 5,
  });

  map.on("load", () => {
    map!.addSource("healpix", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map!.addLayer({
      id: "healpix-fill",
      type: "fill",
      source: "healpix",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.9,
      },
    });

    addPickLayers();

    // Load data after map is ready
    if (props.datasources) {
      datasourceUpdate();
    }
  });

  map.on("click", onMapClick);
});

onBeforeUnmount(() => {
  clearPickOverlays();
  map?.remove();
  map = undefined;
});

function makeSnapshot() {
  // Not implemented for MapLibre yet
}

function toggleRotate() {
  // Not applicable for 2D map
}

defineExpose({ makeSnapshot, toggleRotate });
</script>

<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="globe_box" tabindex="0" autofocus />
    <div class="basemap-switcher">
      <button
        v-for="(label, key) in {
          osm: 'OSM',
          emodnet: 'Bathymetry',
          satellite: 'Satellite',
        }"
        :key="key"
        type="button"
        :class="{ active: selectedBasemap === key }"
        @click="switchBasemap(key as string)"
      >
        {{ label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.globe_box {
  width: 100%;
  height: 100%;
}

.basemap-switcher {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 10;
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.basemap-switcher button {
  border: none;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  background: white;
  color: #333;
}

.basemap-switcher button.active {
  background: #3388ff;
  color: white;
}
</style>
