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
import { resolveHealpixNside } from "@/lib/data/healpixUtils.ts";
import { ZarrDataManager } from "@/lib/data/ZarrDataManager.ts";
import { getDataBounds, HEALPIX_CELL_NAMES } from "@/lib/data/zarrUtils.ts";
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

// --- Map-pick state (location / box / polygon selection for the time series) ---
let pickMarker: maplibregl.Marker | undefined;
// Corner where a bounding-box drag started, and whether a drag is in progress.
let bboxDragStart: { lng: number; lat: number } | null = null;
let bboxDragging = false;
// Vertices committed for the in-progress polygon, plus the live cursor position.
type TLngLat = { lng: number; lat: number };
let polygonPoints: TLngLat[] = [];
let polygonMouse: TLngLat | null = null;

// Pixel radius within which a click on the first vertex closes the polygon.
const POLYGON_CLOSE_PX = 12;
const PICK_COLOR = "#e8743b";

function setSourceData(id: string, features: GeoJSON.Feature[]) {
  const src = map?.getSource(id) as maplibregl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features });
}

function clearPickOverlays() {
  pickMarker?.remove();
  pickMarker = undefined;
  bboxDragStart = null;
  bboxDragging = false;
  polygonPoints = [];
  polygonMouse = null;
  setSourceData("pick-bbox", []);
  setSourceData("pick-polygon", []);
  setSourceData("pick-polygon-pts", []);
}

/** Shoelace area (deg²) of a polygon ring; orientation-independent. */
function polygonArea(pts: TLngLat[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].lng + pts[i].lng) * (pts[j].lat - pts[i].lat);
  }
  return Math.abs(a / 2);
}

/** Whether segments p1-p2 and p3-p4 properly cross. */
function segmentsCross(
  p1: TLngLat,
  p2: TLngLat,
  p3: TLngLat,
  p4: TLngLat
): boolean {
  const ccw = (a: TLngLat, b: TLngLat, c: TLngLat) =>
    (c.lat - a.lat) * (b.lng - a.lng) > (b.lat - a.lat) * (c.lng - a.lng);
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  );
}

/** A polygon is simple if no two non-adjacent edges cross. */
function isSimplePolygon(pts: TLngLat[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip edges that share a vertex (adjacent edges, incl. the closing wrap).
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        continue;
      }
      if (segmentsCross(a1, a2, pts[j], pts[(j + 1) % n])) {
        return false;
      }
    }
  }
  return true;
}

/** A polygon is valid (chartable) if it is a simple ring with a real area. */
function isValidPolygon(pts: TLngLat[]): boolean {
  return pts.length >= 3 && polygonArea(pts) > 1e-9 && isSimplePolygon(pts);
}

/**
 * Whether extending the open path with `next` keeps it simple: the new edge
 * (last vertex → next) must not cross any earlier edge. Adjacent edges that
 * share the last vertex are skipped.
 */
function edgeKeepsPathSimple(pts: TLngLat[], next: TLngLat): boolean {
  const n = pts.length;
  const a1 = pts[n - 1];
  for (let i = 0; i < n - 2; i++) {
    if (segmentsCross(a1, next, pts[i], pts[i + 1])) {
      return false;
    }
  }
  return true;
}

/**
 * Redraws the in-progress polygon: a faint fill, an outline (with a rubber-band
 * segment to the cursor unless `closed`), and highlighted vertices. The colour
 * turns red while the ring would be an invalid polygon.
 */
function drawPolygonPreview(closed = false) {
  const pts = polygonPoints;
  const color = PICK_COLOR;

  const features: GeoJSON.Feature[] = [];

  // Show the area fill only once the ring is a valid, closeable polygon.
  if (isValidPolygon(pts)) {
    const ring = [...pts.map((p) => [p.lng, p.lat]), [pts[0].lng, pts[0].lat]];
    features.push({
      type: "Feature",
      properties: { color },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  const line = pts.map((p) => [p.lng, p.lat]);
  if (closed && pts.length >= 2) {
    line.push([pts[0].lng, pts[0].lat]);
  } else if (polygonMouse) {
    line.push([polygonMouse.lng, polygonMouse.lat]);
  }
  if (line.length >= 2) {
    features.push({
      type: "Feature",
      properties: { color },
      geometry: { type: "LineString", coordinates: line },
    });
  }
  setSourceData("pick-polygon", features);

  // Highlight the first vertex (the close target) and the last one distinctly.
  const vertices: GeoJSON.Feature[] = pts.map((p, i) => ({
    type: "Feature",
    properties: {
      role: i === 0 ? "first" : i === pts.length - 1 ? "last" : "mid",
    },
    geometry: { type: "Point", coordinates: [p.lng, p.lat] },
  }));
  setSourceData("pick-polygon-pts", vertices);
}

function drawPickBbox(
  lonMin: number,
  latMin: number,
  lonMax: number,
  latMax: number
): void {
  setSourceData("pick-bbox", [
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
  ]);
}

function onMapClick(e: maplibregl.MapMouseEvent) {
  if (!map) {
    return;
  }
  if (pickMode.value === PICK_MODE.POINT) {
    const { lng, lat } = e.lngLat;
    clearPickOverlays();
    pickMarker = new maplibregl.Marker({ color: "#4a90d9" })
      .setLngLat([lng, lat])
      .addTo(map);
    store.setPickedPoint({ lat, lon: lng });
    return;
  }
  if (pickMode.value === PICK_MODE.POLYGON) {
    onPolygonClick(e);
  }
}

// Polygon mode: each click adds a vertex; clicking the first vertex again
// closes and completes the polygon. A click that would make the path cross
// itself is rejected, so the in-progress shape can never become invalid.
function onPolygonClick(e: maplibregl.MapMouseEvent) {
  if (!map) {
    return;
  }
  const { lng, lat } = e.lngLat;
  const next = { lng, lat };

  if (polygonPoints.length >= 3) {
    const first = map.project([polygonPoints[0].lng, polygonPoints[0].lat]);
    const here = map.project([lng, lat]);
    const closing = Math.hypot(first.x - here.x, first.y - here.y) <=
      POLYGON_CLOSE_PX;
    if (closing) {
      // Finish only if the closed ring is a valid polygon (simple + real area).
      if (isValidPolygon(polygonPoints)) {
        polygonMouse = null;
        drawPolygonPreview(true);
        store.setPickedPolygon({
          points: polygonPoints.map((p) => ({ lat: p.lat, lon: p.lng })),
        });
      }
      return;
    }
  }

  // Reject a vertex whose new edge would cross the existing path.
  if (!edgeKeepsPathSimple(polygonPoints, next)) {
    return;
  }
  polygonPoints.push(next);
  drawPolygonPreview();
}

function onPolygonMouseMove(e: maplibregl.MapMouseEvent) {
  if (
    !map ||
    pickMode.value !== PICK_MODE.POLYGON ||
    polygonPoints.length === 0
  ) {
    return;
  }
  polygonMouse = { lng: e.lngLat.lng, lat: e.lngLat.lat };
  drawPolygonPreview();
}

// Bounding-box mode: press to set one corner, drag for a live preview, release
// to complete. Panning is disabled while picking (see the pickMode watch).
function onBboxMouseDown(e: maplibregl.MapMouseEvent) {
  if (!map || pickMode.value !== PICK_MODE.BBOX) {
    return;
  }
  e.preventDefault();
  clearPickOverlays();
  bboxDragStart = { lng: e.lngLat.lng, lat: e.lngLat.lat };
  bboxDragging = true;
}

function onBboxMouseMove(e: maplibregl.MapMouseEvent) {
  if (!map || !bboxDragging || !bboxDragStart) {
    return;
  }
  const { lng, lat } = e.lngLat;
  drawPickBbox(
    Math.min(bboxDragStart.lng, lng),
    Math.min(bboxDragStart.lat, lat),
    Math.max(bboxDragStart.lng, lng),
    Math.max(bboxDragStart.lat, lat)
  );
}

function onBboxMouseUp(e: maplibregl.MapMouseEvent) {
  if (!map || !bboxDragging || !bboxDragStart) {
    return;
  }
  const { lng, lat } = e.lngLat;
  const start = bboxDragStart;
  bboxDragging = false;
  bboxDragStart = null;

  // Ignore a click with no real drag: keep picking so the user can try again.
  if (lng === start.lng && lat === start.lat) {
    clearPickOverlays();
    return;
  }

  const latMin = Math.min(start.lat, lat);
  const latMax = Math.max(start.lat, lat);
  const lonMin = Math.min(start.lng, lng);
  const lonMax = Math.max(start.lng, lng);
  drawPickBbox(lonMin, latMin, lonMax, latMax);
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

  // Polygon: fill + outline (colour is data-driven so it can turn red when the
  // ring is invalid), plus a vertex layer that highlights the first/last point.
  map.addSource("pick-polygon", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "pick-polygon-fill",
    type: "fill",
    source: "pick-polygon",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "pick-polygon-line",
    type: "line",
    source: "pick-polygon",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": ["get", "color"], "line-width": 2 },
  });
  map.addSource("pick-polygon-pts", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "pick-polygon-pts",
    type: "circle",
    source: "pick-polygon-pts",
    paint: {
      "circle-radius": ["match", ["get", "role"], "first", 7, "last", 6, 4],
      "circle-color": [
        "match",
        ["get", "role"],
        "first",
        "#19a979",
        "last",
        "#945ecf",
        "#ffffff",
      ],
      "circle-stroke-color": "#e8743b",
      "circle-stroke-width": 2,
    },
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
      map.dragPan.enable();
      bboxDragStart = null;
      bboxDragging = false;
      // Drop the in-progress polygon vertices but keep any completed overlay.
      polygonPoints = [];
      polygonMouse = null;
      return;
    }
    clearPickOverlays();
    map.getCanvas().style.cursor = "crosshair";
    // Disable panning during a box drag so the drag draws the box instead.
    if (mode === PICK_MODE.BBOX) {
      map.dragPan.disable();
    } else {
      map.dragPan.enable();
    }
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
  for (const name of HEALPIX_CELL_NAMES) {
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
  return resolveHealpixNside(props.datasources!, varnameSelector.value);
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
  map.on("mousedown", onBboxMouseDown);
  map.on("mousemove", onBboxMouseMove);
  map.on("mousemove", onPolygonMouseMove);
  map.on("mouseup", onBboxMouseUp);
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
