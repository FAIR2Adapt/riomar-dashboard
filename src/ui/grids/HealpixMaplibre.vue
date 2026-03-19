<script lang="ts" setup>
// eslint-disable-next-line camelcase, boundaries/no-unknown
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
import type { TDimensionRange, TSources } from "@/lib/types/GlobeTypes.ts";
import { useUrlParameterStore } from "@/store/paramStore.ts";
import {
  UPDATE_MODE,
  useGlobeControlStore,
  type TUpdateMode,
} from "@/store/store.ts";
import {
  HISTOGRAM_SUMMARY_BINS,
  buildHistogramSummary,
  type THistogramSummary,
} from "@/utils/histogram.ts";
import { useLog } from "@/utils/logging.ts";

const props = defineProps<{ datasources?: TSources }>();

const HEALPIX_UNSEEN = -1.6375e30;

// Colormap: RdYlBu reversed
const COLORMAP = [
  [0.647, 0.0, 0.149],
  [0.843, 0.188, 0.153],
  [0.957, 0.427, 0.263],
  [0.992, 0.682, 0.38],
  [0.996, 0.878, 0.565],
  [1.0, 1.0, 0.749],
  [0.878, 0.953, 0.973],
  [0.671, 0.851, 0.914],
  [0.455, 0.678, 0.82],
  [0.271, 0.459, 0.706],
  [0.192, 0.212, 0.584],
];

const store = useGlobeControlStore();
const { logError } = useLog();
const { varnameSelector, dimSlidersValues, isInitializingVariable, varinfo } =
  storeToRefs(store);

const urlParameterStore = useUrlParameterStore();
const { paramDimIndices, paramDimMinBounds, paramDimMaxBounds } =
  storeToRefs(urlParameterStore);

const { resetDataVars, getDataVar, getTimeInfo, getDimensionInfo } =
  useGridDataAccess();

const mapContainer = ref<HTMLDivElement>();
let map: maplibregl.Map | undefined;
let cellIds: number[] = [];
let nside = 0;

watch(
  () => varnameSelector.value,
  () => getData()
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

function valueToColor(val: number, min: number, max: number): string {
  if (isNaN(val)) {
    return "rgba(0,0,0,0)";
  }
  const t = Math.max(0, Math.min(1, (val - min) / (max - min || 1)));
  const idx = t * (COLORMAP.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COLORMAP.length - 1);
  const f = idx - lo;
  const r = Math.round((COLORMAP[lo][0] * (1 - f) + COLORMAP[hi][0] * f) * 255);
  const g = Math.round((COLORMAP[lo][1] * (1 - f) + COLORMAP[hi][1] * f) * 255);
  const b = Math.round((COLORMAP[lo][2] * (1 - f) + COLORMAP[hi][2] * f) * 255);
  return `rgb(${r},${g},${b})`;
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
  min: number,
  max: number,
  missingValue: number,
  fillValue: number
) {
  const features = [];
  for (let i = 0; i < cellIds.length; i++) {
    const v = values[i];
    if (isNaN(v) || v === missingValue || v === fillValue) {
      continue;
    }
    features.push({
      type: "Feature" as const,
      properties: { color: valueToColor(v, min, max), value: v },
      geometry: {
        type: "Polygon" as const,
        coordinates: [cellToPolygon(cellIds[i])],
      },
    });
  }
  return { type: "FeatureCollection" as const, features };
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

    const geojson = buildGeoJSON(values, min, max, missingValue, fillValue);
    // Debug: log first cell coordinates
    if (geojson.features.length > 0) {
      const coords = (geojson.features[0].geometry as GeoJSON.Polygon)
        .coordinates[0];
      console.log("First cell coords:", JSON.stringify(coords));
    }
    console.log(
      `MapLibre: ${geojson.features.length} features, range ${min}-${max}`
    );
    const source = map.getSource("healpix") as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(geojson);
      // Fit map to data bounds on first load
      if (geojson.features.length > 0 && updateMode === UPDATE_MODE.INITIAL_LOAD) {
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

    // Load data after map is ready
    if (props.datasources) {
      datasourceUpdate();
    }
  });
});

onBeforeUnmount(() => {
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
        v-for="(label, key) in { osm: 'OSM', emodnet: 'Bathymetry', satellite: 'Satellite' }"
        :key="key"
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
