<script lang="ts" setup>
// eslint-disable-next-line camelcase
import { pixcoord2vec_nest_nside, bit_combine } from "@eopf-dggs/healpix-geo";
import { storeToRefs } from "pinia";
import * as THREE from "three";
import { computed, onBeforeMount, onMounted, ref, watch } from "vue";
import * as zarr from "zarrita";

import { useSharedGridLogic } from "./composables/useSharedGridLogic.ts";

import { buildDimensionRangesAndIndices } from "@/lib/data/dimensionHandling.ts";
import { ZarrDataManager } from "@/lib/data/ZarrDataManager.ts";
import { castDataVarToFloat32, getDataBounds } from "@/lib/data/zarrUtils.ts";
import {
  ProjectionHelper,
  authalicToGeodeticWGS84,
} from "@/lib/projection/projectionUtils.ts";
import {
  getColormapScaleOffset,
  makeGpuProjectedTextureMaterial,
  updateProjectionUniforms,
} from "@/lib/shaders/gridShaders.ts";
import type {
  TDimensionRange,
  TMultiscalesInfo,
  TSources,
} from "@/lib/types/GlobeTypes.ts";
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

const props = defineProps<{
  datasources?: TSources;
}>();

// By convention, HEALPIX uses -1.6375e+30 to mark invalid or unseen pixels.
const HEALPIX_UNSEEN = -1.6375e30;

const store = useGlobeControlStore();
const { logError } = useLog();
const {
  varnameSelector,
  colormap,
  invertColormap,
  posterizeLevels,
  selection,
  dimSlidersValues,
  isInitializingVariable,
  varinfo,
  projectionMode,
  projectionCenter,
} = storeToRefs(store);

const urlParameterStore = useUrlParameterStore();
const { paramDimIndices, paramDimMinBounds, paramDimMaxBounds } =
  storeToRefs(urlParameterStore);

const {
  getScene,
  getCamera,
  redraw,
  makeSnapshot,
  toggleRotate,
  resetDataVars,
  getDataVar,
  fetchDimensionDetails,
  registerUpdateLOD,
  updateLandSeaMask,
  updateColormap,
  updateHistogram,
  projectionHelper,
  canvas,
  box,
} = useSharedGridLogic();

const pendingUpdate = ref(false);
const updatingData = ref(false);
const healpixEllipsoid = ref<string | undefined>(undefined);

const HEALPIX_NUMCHUNKS = 12;

// Limited-area rendering: compact per-cell geometry + tiny texture
// instead of 12 full-sphere nside² textures (3 GB for nside=8192)
let limitedAreaMode = false;
let limitedAreaTexSize = 0;

// Multiscale pyramid: automatic level-of-detail selection based on camera zoom
let multiscalesInfo: TMultiscalesInfo | undefined = undefined;
let multiscalesCurrentIndex = 0;
let multiscalesSwitching = false;
let multiscalesDesiredIndex = 0;
let multiscalesDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const MULTISCALES_DEBOUNCE_MS = 400; // wait for zoom to settle before switching
// Active datasources: starts as props.datasources, rewritten on level switch
const activeDatasources = ref<TSources | undefined>(undefined);

let mainMeshes: THREE.Mesh<
  THREE.BufferGeometry<THREE.NormalBufferAttributes>,
  THREE.Material,
  THREE.Object3DEventMap
>[] = new Array(HEALPIX_NUMCHUNKS);

watch(
  () => varnameSelector.value,
  () => {
    getData();
  }
);

watch(
  () => dimSlidersValues.value,
  async () => {
    if (isInitializingVariable.value) {
      isInitializingVariable.value = false;
      return;
    }
    await getData(UPDATE_MODE.SLIDER_TOGGLE);
    updateColormap(mainMeshes);
  },
  { deep: true }
);

watch(
  () => props.datasources,
  () => {
    datasourceUpdate();
  }
);

const bounds = computed(() => {
  return selection.value;
});

watch(
  [
    () => bounds.value,
    () => invertColormap.value,
    () => colormap.value,
    () => posterizeLevels.value,
  ],
  () => {
    updateColormap(mainMeshes);
  }
);

// GPU projection: update shader uniforms instead of rebuilding geometry
watch(
  [() => projectionMode.value, () => projectionCenter.value],
  () => {
    updateMeshProjectionUniforms();
  },
  { deep: true }
);

/**
 * Update projection uniforms on all mesh materials.
 * This is the fast path - no geometry rebuild needed.
 */
function updateMeshProjectionUniforms() {
  const helper = projectionHelper.value;
  const center = projectionCenter.value;

  for (const mesh of mainMeshes) {
    const material = mesh.material as THREE.ShaderMaterial;
    if (material.uniforms?.projectionType) {
      updateProjectionUniforms(material, helper.type, center.lon, center.lat);
    }
  }
  redraw();
}

function initMultiscales() {
  if (!props.datasources?.multiscales) {
    multiscalesInfo = undefined;
    return;
  }
  multiscalesInfo = props.datasources.multiscales;

  // Pick the right level for current camera distance instead of always
  // starting at level 0 (finest), which wastes time when zoomed out
  const cam = getCamera();
  const distance = cam ? cam.position.length() : 30;
  const initialLevel = distanceToLevelIndex(distance);
  multiscalesCurrentIndex = initialLevel;

  if (initialLevel !== 0) {
    const levelAsset = multiscalesInfo.layout[initialLevel].asset;
    const levelUrl = multiscalesInfo.baseUrl + "/" + levelAsset;
    activeDatasources.value = rewriteDatasourcesUrl(
      props.datasources,
      levelUrl
    );
    ZarrDataManager.invalidateCache();
    console.log(
      `Multiscales: initial load at level ${initialLevel} (distance=${distance.toFixed(1)})`
    );
  }
}

async function setupLimitedArea(cellCoord: number[], nside: number) {
  limitedAreaMode = true;
  const { geometry, texSize } = buildLimitedAreaGeometry(
    cellCoord,
    nside,
    projectionHelper.value,
    healpixEllipsoid.value
  );
  limitedAreaTexSize = texSize;
  mainMeshes[0].geometry.dispose();
  mainMeshes[0].geometry = geometry;
  for (let i = 1; i < HEALPIX_NUMCHUNKS; i++) {
    mainMeshes[i].visible = false;
  }
  updateMeshProjectionUniforms();
  await getData();
}

async function datasourceUpdate() {
  resetDataVars();
  if (props.datasources !== undefined) {
    activeDatasources.value = props.datasources;
    initMultiscales();

    const crsInfo = await getHealpixCRSInfo();
    healpixEllipsoid.value = crsInfo.ellipsoid;
    const cellCoord = await getCells();

    if (cellCoord && cellCoord.length > 0) {
      await setupLimitedArea(cellCoord, crsInfo.nside);
    } else {
      limitedAreaMode = false;
      for (let i = 0; i < HEALPIX_NUMCHUNKS; i++) {
        mainMeshes[i].visible = true;
      }
      await Promise.all([fetchGrid(), getData()]);
    }

    updateLandSeaMask();
    updateColormap(mainMeshes);

    // Register LOD callback AFTER initial load to avoid race conditions
    if (multiscalesInfo) {
      multiscalesDesiredIndex = multiscalesCurrentIndex;
      registerUpdateLOD(checkLevelOfDetail);
    }
  }
}

function fetchGrid() {
  const gridStep = 64 + 1;
  try {
    for (let ipix = 0; ipix < HEALPIX_NUMCHUNKS; ipix++) {
      const { geometry } = makeHealpixGeometry(
        1,
        ipix,
        gridStep,
        projectionHelper.value,
        healpixEllipsoid.value
      );
      mainMeshes[ipix].geometry.dispose();
      mainMeshes[ipix].geometry = geometry;
    }
    // Update projection uniforms after geometry change
    updateMeshProjectionUniforms();
    redraw();
  } catch (error) {
    logError(error, "Could not fetch grid");
  }
}

async function getHealpixCRSInfo() {
  const crs = await ZarrDataManager.getCRSInfo(
    activeDatasources.value!,
    varnameSelector.value
  );
  // FIXME: could probably have other names
  const nside = crs.attrs["healpix_nside"] as number;
  // Check DGGS convention for ellipsoid, then CRS attrs, then cell coordinate attrs
  let ellipsoid: string | undefined;
  try {
    const source = ZarrDataManager.getDatasetSource(
      activeDatasources.value!,
      varnameSelector.value
    );
    const group = await ZarrDataManager.getDatasetGroup(source);
    const dggs = group.attrs?.dggs as Record<string, unknown> | undefined;
    if (dggs?.ellipsoid) {
      const ell = dggs.ellipsoid as Record<string, unknown>;
      ellipsoid = (ell.name as string)?.toUpperCase() || undefined;
    }
  } catch {
    // Fall through
  }
  if (!ellipsoid) {
    ellipsoid = (crs.attrs["healpix_ellipsoid"] as string) || undefined;
  }
  if (!ellipsoid) {
    try {
      const source = ZarrDataManager.getDatasetSource(
        activeDatasources.value!,
        varnameSelector.value
      );
      const coordName = await getCellCoordinateName();
      for (const name of [coordName, "cell", "cell_ids"]) {
        try {
          const cellInfo = await ZarrDataManager.getVariableInfo(source, name);
          ellipsoid = (cellInfo.attrs["ellipsoid"] as string) || undefined;
          if (ellipsoid) {
            break;
          }
        } catch {
          continue;
        }
      }
    } catch (e) {
      console.log("Could not read cell coordinate ellipsoid:", e);
    }
  }
  console.log("HEALPix CRS info: nside=", nside, "ellipsoid=", ellipsoid);
  return { nside, ellipsoid };
}

async function getCellCoordinateName(): Promise<string> {
  // Check DGGS convention metadata for the coordinate name
  try {
    const source = ZarrDataManager.getDatasetSource(
      activeDatasources.value!,
      varnameSelector.value
    );
    const group = await ZarrDataManager.getDatasetGroup(source);
    const dggs = group.attrs?.dggs as Record<string, unknown> | undefined;
    if (dggs?.coordinate && typeof dggs.coordinate === "string") {
      return dggs.coordinate;
    }
  } catch {
    // Fall through to defaults
  }
  return "cell";
}

async function getCells() {
  const source = ZarrDataManager.getDatasetSource(
    activeDatasources.value!,
    varnameSelector.value
  );
  const coordName = await getCellCoordinateName();
  // Try the DGGS coordinate name first, then common fallbacks
  const candidates =
    coordName === "cell"
      ? ["cell", "cell_ids"]
      : [coordName, "cell", "cell_ids"];
  for (const name of candidates) {
    try {
      let cells = (await ZarrDataManager.getVariableData(source, name)).data as
        | Int32Array
        | BigInt64Array
        | number[];
      if (typeof cells[0] === "bigint") {
        cells = Array.from(cells, Number) as number[];
      }
      return cells as number[];
    } catch {
      continue;
    }
  }
  return undefined;
}

function getHealpixChunkRange(ipix: number, numChunks: number, nside: number) {
  const chunksize = (12 * nside * nside) / numChunks;
  const pixelStart = ipix * chunksize;
  const pixelEnd = (ipix + 1) * chunksize;

  return { chunksize, pixelStart, pixelEnd };
}

async function fillGlobalHealpixChunkData(
  datavar: zarr.Array<zarr.DataType>,
  localDimensionIndices: (number | zarr.Slice | null)[],
  pixelStart: number,
  pixelEnd: number,
  dataSlice: Float32Array
) {
  localDimensionIndices[localDimensionIndices.length - 1] = zarr.slice(
    pixelStart,
    pixelEnd
  );
  const data = (
    await ZarrDataManager.getVariableDataFromArray(
      datavar,
      localDimensionIndices
    )
  ).data as Float32Array;

  dataSlice.set(data);
}

async function fillLimitedAreaHealpixChunkData(
  datavar: zarr.Array<zarr.DataType>,
  cellCoord: number[],
  localDimensionIndices: (number | zarr.Slice | null)[],
  pixelStart: number,
  pixelEnd: number,
  dataSlice: Float32Array
) {
  // Limited-area data case: need to map cellCoord to global positions
  dataSlice.fill(NaN);

  // Find which indices in cellCoord fall within this chunk's range
  const relevantIndices: number[] = [];
  const localPositions: number[] = [];

  for (let i = 0; i < cellCoord.length; i++) {
    const globalPixel = cellCoord[i];
    if (globalPixel >= pixelStart && globalPixel < pixelEnd) {
      relevantIndices.push(i); // Index in the data array
      localPositions.push(globalPixel - pixelStart); // Position in chunk
    }
  }

  // Only fetch data if this chunk has any relevant cells
  if (relevantIndices.length === 0) {
    return;
  }

  // Check if indices are contiguous for optimization
  const start = relevantIndices[0];
  const end = relevantIndices[relevantIndices.length - 1] + 1;
  localDimensionIndices[localDimensionIndices.length - 1] = zarr.slice(
    start,
    end
  );
  const data = (
    await ZarrDataManager.getVariableDataFromArray(
      datavar,
      localDimensionIndices
    )
  ).data as Float32Array;
  const isContiguous =
    relevantIndices.length > 1 &&
    relevantIndices[relevantIndices.length - 1] - relevantIndices[0] ===
      relevantIndices.length - 1;

  if (isContiguous) {
    // Contiguous: use slice for efficient fetching
    for (let i = 0; i < relevantIndices.length; i++) {
      dataSlice[localPositions[i]] = data[i];
    }
  } else {
    // Non-contiguous: fetch the entire range and skip what we don't need
    for (let i = 0; i < relevantIndices.length; i++) {
      const dataIdx = relevantIndices[i] - start;
      dataSlice[localPositions[i]] = data[dataIdx];
    }
  }
}

async function fillHealpixChunkData(
  datavar: zarr.Array<zarr.DataType>,
  cellCoord: number[] | undefined,
  localDimensionIndices: (number | zarr.Slice | null)[],
  pixelStart: number,
  pixelEnd: number,
  dataSlice: Float32Array
) {
  if (cellCoord === undefined) {
    await fillGlobalHealpixChunkData(
      datavar,
      localDimensionIndices,
      pixelStart,
      pixelEnd,
      dataSlice
    );
  } else {
    await fillLimitedAreaHealpixChunkData(
      datavar,
      cellCoord,
      localDimensionIndices,
      pixelStart,
      pixelEnd,
      dataSlice
    );
  }
}

async function getHealpixData(
  datavar: zarr.Array<zarr.DataType>,
  cellCoord: number[] | undefined, // Optional - undefined for global data
  ipix: number,
  numChunks: number,
  nside: number,
  dimensionIndices: (number | zarr.Slice | null)[]
) {
  const localDimensionIndices = dimensionIndices.slice();
  const { chunksize, pixelStart, pixelEnd } = getHealpixChunkRange(
    ipix,
    numChunks,
    nside
  );
  const dataSlice = new Float32Array(chunksize);

  await fillHealpixChunkData(
    datavar,
    cellCoord,
    localDimensionIndices,
    pixelStart,
    pixelEnd,
    dataSlice
  );

  let { min, max, missingValue, fillValue } = getDataBounds(datavar, dataSlice);
  if (isNaN(missingValue)) {
    missingValue = HEALPIX_UNSEEN;
  } else if (isNaN(fillValue)) {
    fillValue = HEALPIX_UNSEEN;
  }

  // Filter out missing and fill values before building histogram
  return {
    texture: data2texture(dataSlice, {}),
    histogramSummary: buildHistogramSummary(
      dataSlice,
      min,
      max,
      HISTOGRAM_SUMMARY_BINS,
      fillValue,
      missingValue
    ),
    min,
    max,
    missingValue,
    fillValue,
  };
}

function distanceSquared(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number
): number {
  return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1) + (z2 - z1) * (z2 - z1);
}

function createGeometry(
  positionValues: Float32Array,
  uv: Float32Array,
  latLonValues: Float32Array,
  indices: number[]
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positionValues, 3)
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  // Add latLon attribute for GPU projection
  geometry.setAttribute(
    "latLon",
    new THREE.Float32BufferAttribute(latLonValues, 2)
  );
  return geometry;
}

function generateHealpixIndices(positionValues: Float32Array, steps: number) {
  const indices = [];
  for (let i = 0; i < steps - 1; ++i) {
    for (let j = 0; j < steps - 1; ++j) {
      const a = i * steps + (j + 1);
      const b = i * steps + j;
      const c = (i + 1) * steps + j;
      const d = (i + 1) * steps + (j + 1);
      const dac2 = distanceSquared(
        positionValues[3 * a + 0],
        positionValues[3 * a + 1],
        positionValues[3 * a + 2],
        positionValues[3 * c + 0],
        positionValues[3 * c + 1],
        positionValues[3 * c + 2]
      );
      const dbd2 = distanceSquared(
        positionValues[3 * b + 0],
        positionValues[3 * b + 1],
        positionValues[3 * b + 2],
        positionValues[3 * d + 0],
        positionValues[3 * d + 1],
        positionValues[3 * d + 2]
      );
      if (dac2 < dbd2) {
        indices.push(a, c, d);
        indices.push(b, c, a);
      } else {
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
  }
  return indices;
}

function makeHealpixGeometry(
  nside: number,
  ipix: number,
  steps: number,
  helper: ProjectionHelper,
  ellipsoid?: string
) {
  const vertexCount = steps * steps;
  const positionValues = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const latitudes = new Float32Array(vertexCount);
  const longitudes = new Float32Array(vertexCount);
  const latLonValues = new Float32Array(vertexCount * 2);
  let vertexIndex = 0;

  for (let i = 0; i < steps; ++i) {
    const u = i / (steps - 1);
    for (let j = 0; j < steps; ++j) {
      const v = j / (steps - 1);
      const vec = pixcoord2vec_nest_nside(nside, BigInt(ipix), u, v);
      let { lat, lon } = ProjectionHelper.cartesianToLatLon(
        vec[0],
        vec[1],
        vec[2]
      );
      // When HEALPix is on an ellipsoid, the library gives authalic latitude;
      // convert to geodetic latitude for correct geographic positioning.
      if (ellipsoid === "WGS84") {
        lat = authalicToGeodeticWGS84(lat);
      }
      latitudes[vertexIndex] = lat;
      longitudes[vertexIndex] = lon;
      const positionOffset = vertexIndex * 3;
      helper.projectLatLonToArrays(
        lat,
        lon,
        positionValues,
        positionOffset,
        latLonValues,
        vertexIndex * 2
      );
      const uvIndex = vertexIndex * 2;
      uv[uvIndex] = u;
      uv[uvIndex + 1] = v;
      vertexIndex++;
    }
  }

  const indices = generateHealpixIndices(positionValues, steps);
  const geometry = createGeometry(positionValues, uv, latLonValues, indices);
  return { geometry, latitudes, longitudes };
}

/** Build vertices for a single HEALPix cell quad. */
function buildCellQuad(
  ci: number,
  cellId: number,
  nside: number,
  texSize: number,
  helper: ProjectionHelper,
  ellipsoid: string | undefined,
  positionValues: Float32Array,
  uvValues: Float32Array,
  latLonValues: Float32Array,
  indices: number[]
) {
  const baseVertex = ci * 4;
  const texU = ((ci % texSize) + 0.5) / texSize;
  const texV = (Math.floor(ci / texSize) + 0.5) / texSize;
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  for (let vi = 0; vi < 4; vi++) {
    const [cu, cv] = corners[vi];
    const vec = pixcoord2vec_nest_nside(nside, BigInt(cellId), cu, cv);
    let { lat, lon } = ProjectionHelper.cartesianToLatLon(
      vec[0],
      vec[1],
      vec[2]
    );
    if (ellipsoid === "WGS84") {
      lat = authalicToGeodeticWGS84(lat);
    }
    const vertIdx = baseVertex + vi;
    helper.projectLatLonToArrays(
      lat,
      lon,
      positionValues,
      vertIdx * 3,
      latLonValues,
      vertIdx * 2
    );
    uvValues[vertIdx * 2] = texU;
    uvValues[vertIdx * 2 + 1] = texV;
  }
  indices.push(baseVertex, baseVertex + 1, baseVertex + 2);
  indices.push(baseVertex, baseVertex + 2, baseVertex + 3);
}

/**
 * Build compact per-cell geometry for limited-area HEALPix data.
 * Creates one quad (2 triangles) per cell with UV mapped to a compact texture.
 */
function buildLimitedAreaGeometry(
  cellCoord: number[],
  nside: number,
  helper: ProjectionHelper,
  ellipsoid?: string
) {
  const nCells = cellCoord.length;
  const texSize = Math.ceil(Math.sqrt(nCells));
  const vertexCount = nCells * 4;
  const positionValues = new Float32Array(vertexCount * 3);
  const uvValues = new Float32Array(vertexCount * 2);
  const latLonValues = new Float32Array(vertexCount * 2);
  const indices: number[] = [];

  for (let ci = 0; ci < nCells; ci++) {
    buildCellQuad(
      ci,
      cellCoord[ci],
      nside,
      texSize,
      helper,
      ellipsoid,
      positionValues,
      uvValues,
      latLonValues,
      indices
    );
  }

  const geometry = createGeometry(
    positionValues,
    uvValues,
    latLonValues,
    indices
  );
  return { geometry, texSize };
}

function getUnshuffleIndex(
  size: number,
  unshuffleIndex: { [key: number]: Uint32Array }
): Uint32Array {
  if (unshuffleIndex[size] === undefined) {
    const len = size * size;
    const temp = new Uint32Array(len);
    let idx = 0;

    for (let i = 0; i < size; ++i) {
      for (let j = 0; j < size; ++j) {
        temp[idx++] = Number(bit_combine(j, i));
      }
    }
    unshuffleIndex[size] = temp;
  }
  return unshuffleIndex[size];
}

function unshuffleMortonArray(
  arr: Float32Array,
  unshuffleIndex: { [key: number]: Uint32Array }
): Float32Array {
  const out = arr.slice(); // makes a copy
  const size = Math.floor(Math.sqrt(arr.length));
  const uidx = getUnshuffleIndex(size, unshuffleIndex);
  for (let i = 0; i < out.length; ++i) {
    out[i] = arr[uidx[i]];
  }
  return out;
}

function data2texture(
  arr: Float32Array,
  unshuffleIndex: { [key: number]: Uint32Array }
) {
  const size = Math.floor(Math.sqrt(arr.length));
  arr = castDataVarToFloat32(arr);
  const mortonArr = unshuffleMortonArray(arr, unshuffleIndex);
  const texture = new THREE.DataTexture(
    mortonArr,
    size,
    size,
    THREE.RedFormat,
    THREE.FloatType,
    THREE.UVMapping
  );
  texture.needsUpdate = true;
  return texture;
}

async function getData(updateMode: TUpdateMode = UPDATE_MODE.INITIAL_LOAD) {
  store.startLoading();
  if (updatingData.value) {
    pendingUpdate.value = true;
    return;
  }

  updatingData.value = true;
  try {
    do {
      pendingUpdate.value = false;
      const datavar = await getDataVar(
        varnameSelector.value,
        activeDatasources.value!
      );
      if (datavar) {
        await fetchAndRenderData(datavar, updateMode);
      }
      updatingData.value = false;
    } while (pendingUpdate.value);
  } catch (error) {
    logError(error, "Could not fetch data");
    updatingData.value = false;
  } finally {
    store.stopLoading();
  }
}

async function prepareDimensionData(
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  updateMode: TUpdateMode
) {
  const dimensionNames = await ZarrDataManager.getDimensionNames(
    activeDatasources.value!,
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

  return { dimensionRanges, indices };
}

async function getDimensionValues(
  dimensionRanges: TDimensionRange[],
  indices: (number | zarr.Slice | null)[]
) {
  const dimValues = await fetchDimensionDetails(
    varnameSelector.value,
    activeDatasources.value!,
    dimensionRanges,
    indices
  );
  return dimValues;
}

async function processHealpixChunks(
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  cellCoord: number[] | undefined,
  nside: number,
  indices: (number | zarr.Slice | null)[]
): Promise<{
  dataMin: number;
  dataMax: number;
  histogramSummaries: THistogramSummary[];
}> {
  let dataMin = Number.POSITIVE_INFINITY;
  let dataMax = Number.NEGATIVE_INFINITY;
  const histogramSummaries: THistogramSummary[] = [];

  await Promise.all(
    [...Array(HEALPIX_NUMCHUNKS).keys()].map(async (ipix) => {
      const texData = await getHealpixData(
        datavar,
        cellCoord,
        ipix,
        HEALPIX_NUMCHUNKS,
        nside,
        indices
      );
      if (texData === undefined) {
        const material = mainMeshes[ipix].material as THREE.ShaderMaterial;
        material.uniforms.data.value.dispose();
        return;
      }

      histogramSummaries.push(texData.histogramSummary);
      dataMin = dataMin > texData.min ? texData.min : dataMin;
      dataMax = dataMax < texData.max ? texData.max : dataMax;

      const material = mainMeshes[ipix].material as THREE.ShaderMaterial;
      material.uniforms.missingValue.value = texData.missingValue;
      material.uniforms.fillValue.value = texData.fillValue;
      material.uniforms.data.value.dispose();
      material.uniforms.data.value = texData.texture;

      redraw();
    })
  );

  return { dataMin, dataMax, histogramSummaries };
}

/** Create a compact square texture from cell data. */
function createCompactTexture(
  data: ArrayLike<number>,
  nCells: number,
  texSize: number
) {
  const texData = new Float32Array(texSize * texSize);
  texData.fill(NaN);
  for (let i = 0; i < nCells; i++) {
    texData[i] = Number(data[i]);
  }
  const texture = new THREE.DataTexture(
    texData,
    texSize,
    texSize,
    THREE.RedFormat,
    THREE.FloatType,
    THREE.UVMapping
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Fast path for limited-area data: fetch all cells at once, pack into
 * a tiny compact texture (e.g. 68×68 for 4544 cells instead of 12× 8192×8192).
 */
async function processLimitedAreaData(
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  nCells: number,
  texSize: number,
  indices: (number | zarr.Slice | null)[]
): Promise<{
  dataMin: number;
  dataMax: number;
  histogramSummaries: THistogramSummary[];
}> {
  const localIndices = indices.slice();
  localIndices[localIndices.length - 1] = zarr.slice(0, nCells);
  const rawData = (
    await ZarrDataManager.getVariableDataFromArray(datavar, localIndices)
  ).data;
  // Always convert to Float32Array — zarrita may return Float64Array or
  // cross-realm typed arrays where instanceof checks fail
  const numericData = rawData as ArrayLike<number | bigint>;
  const data = new Float32Array(numericData.length);
  for (let i = 0; i < numericData.length; i++) {
    data[i] = Number(numericData[i]);
  }
  const texture = createCompactTexture(data, nCells, texSize);

  let { min, max, missingValue, fillValue } = getDataBounds(datavar, data);
  if (isNaN(missingValue)) {
    missingValue = HEALPIX_UNSEEN;
  }
  if (isNaN(fillValue)) {
    fillValue = HEALPIX_UNSEEN;
  }

  const material = mainMeshes[0].material as THREE.ShaderMaterial;
  material.uniforms.missingValue.value = missingValue;
  material.uniforms.fillValue.value = fillValue;
  material.uniforms.data.value.dispose();
  material.uniforms.data.value = texture;
  redraw();

  return {
    dataMin: min,
    dataMax: max,
    histogramSummaries: [
      buildHistogramSummary(
        data,
        min,
        max,
        HISTOGRAM_SUMMARY_BINS,
        fillValue,
        missingValue
      ),
    ],
  };
}

/**
 * Rewrite all store URLs in a TSources to point to a different level subgroup.
 */
function rewriteDatasourcesUrl(sources: TSources, newUrl: string): TSources {
  const rewritten = JSON.parse(JSON.stringify(sources)) as TSources;
  for (const level of rewritten.levels) {
    level.grid.store = newUrl;
    level.time.store = newUrl;
    for (const ds of Object.values(level.datasources)) {
      ds.store = newUrl;
    }
  }
  return rewritten;
}

/**
 * Map camera distance to the best pyramid level index.
 * Closer camera → finer resolution (lower index).
 * Globe radius ≈ 1, camera distance ranges ~1.1 (close) to ~30+ (far).
 * Skips levels with more cells than the browser can handle.
 */
function distanceToLevelIndex(distance: number): number {
  if (!multiscalesInfo) {
    return 0;
  }
  const layout = multiscalesInfo.layout;
  const numLevels = layout.length;

  // Cap the finest usable level. Levels are ordered finest-first (index 0 =
  // highest resolution). For large pyramids, the finest levels may have too
  // many cells for the browser. Allow at most 7 usable levels (matching the
  // 5-level RIOMAR pyramid + some margin). For a pyramid with 11 levels,
  // this skips levels 0–3 (the finest) and uses levels 4–10.
  const MAX_USABLE_LEVELS = 7;
  const finestAllowed = Math.max(0, numLevels - MAX_USABLE_LEVELS);
  const usableLevels = numLevels - finestAllowed;

  // Logarithmic scale: distance 1.5→20 maps across usable levels
  const minDist = 1.5;
  const maxDist = 20;
  const clamped = Math.max(minDist, Math.min(maxDist, distance));
  const t = Math.log(clamped / minDist) / Math.log(maxDist / minDist);
  const index = Math.floor(t * usableLevels) + finestAllowed;
  return Math.max(finestAllowed, Math.min(numLevels - 1, index));
}

/**
 * LOD callback: runs every frame during interaction, checks if camera
 * distance warrants a different pyramid level. Uses debouncing so the
 * switch only fires once the zoom has settled for MULTISCALES_DEBOUNCE_MS.
 */
function checkLevelOfDetail() {
  if (!multiscalesInfo || multiscalesSwitching) {
    return;
  }
  const cam = getCamera();
  if (!cam) {
    return;
  }

  const distance = cam.position.length();
  const newIndex = distanceToLevelIndex(distance);

  if (newIndex !== multiscalesDesiredIndex) {
    multiscalesDesiredIndex = newIndex;
    // Reset debounce timer: only switch once zoom settles
    if (multiscalesDebounceTimer) {
      clearTimeout(multiscalesDebounceTimer);
    }
    multiscalesDebounceTimer = setTimeout(() => {
      multiscalesDebounceTimer = null;
      if (
        multiscalesDesiredIndex !== multiscalesCurrentIndex &&
        !multiscalesSwitching
      ) {
        console.log(
          `LOD: switching from level ${multiscalesCurrentIndex} to ${multiscalesDesiredIndex}`
        );
        multiscalesCurrentIndex = multiscalesDesiredIndex;
        void switchMultiscaleLevel(multiscalesDesiredIndex);
      }
    }, MULTISCALES_DEBOUNCE_MS);
  }
}

/**
 * Switch to a different pyramid level: update datasource URLs, rebuild
 * geometry, and re-fetch data.
 */
async function switchMultiscaleLevel(levelIndex: number) {
  if (!multiscalesInfo || !props.datasources) {
    return;
  }
  multiscalesSwitching = true;
  store.startLoading();

  try {
    const levelAsset = multiscalesInfo.layout[levelIndex].asset;
    const levelUrl = multiscalesInfo.baseUrl + "/" + levelAsset;
    activeDatasources.value = rewriteDatasourcesUrl(
      props.datasources,
      levelUrl
    );
    // Invalidate cached store so ZarrDataManager fetches from the new URL
    ZarrDataManager.invalidateCache();

    // Re-read CRS and cells from the new level
    const crsInfo = await getHealpixCRSInfo();
    healpixEllipsoid.value = crsInfo.ellipsoid;
    const cellCoord = await getCells();

    if (cellCoord && cellCoord.length > 0) {
      limitedAreaMode = true;
      const { geometry, texSize } = buildLimitedAreaGeometry(
        cellCoord,
        crsInfo.nside,
        projectionHelper.value,
        healpixEllipsoid.value
      );
      limitedAreaTexSize = texSize;
      mainMeshes[0].geometry.dispose();
      mainMeshes[0].geometry = geometry;
      for (let i = 1; i < HEALPIX_NUMCHUNKS; i++) {
        mainMeshes[i].visible = false;
      }
      updateMeshProjectionUniforms();
    }

    // Re-fetch data for the new level
    await getData();
    updateColormap(mainMeshes);
    console.log(
      `LOD: level ${levelIndex} loaded (nside=${crsInfo.nside}, cells=${cellCoord?.length ?? "global"})`
    );
  } catch (error) {
    console.error("LOD: switchMultiscaleLevel FAILED", error);
    throw error;
  } finally {
    multiscalesSwitching = false;
    store.stopLoading();
  }
}

async function fetchAndRenderData(
  datavar: zarr.Array<zarr.DataType, zarr.FetchStore>,
  updateMode: TUpdateMode
) {
  const { dimensionRanges, indices } = await prepareDimensionData(
    datavar,
    updateMode
  );

  let dataMin: number, dataMax: number;
  let histogramSummaries: THistogramSummary[];

  if (limitedAreaMode) {
    // Fast path: single fetch + tiny texture (~18 KB vs 3 GB)
    const cellCoord = await getCells();
    ({ dataMin, dataMax, histogramSummaries } = await processLimitedAreaData(
      datavar,
      cellCoord!.length,
      limitedAreaTexSize,
      indices
    ));
  } else {
    // Standard path: 12 full-sphere chunks
    const cellCoord = await getCells();
    const crsInfo = await getHealpixCRSInfo();
    const nside = crsInfo.nside;
    healpixEllipsoid.value = crsInfo.ellipsoid;
    ({ dataMin, dataMax, histogramSummaries } = await processHealpixChunks(
      datavar,
      cellCoord,
      nside,
      indices
    ));
  }

  updateHistogram(histogramSummaries, dataMin, dataMax);

  const dimInfo = await getDimensionValues(dimensionRanges, indices);

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

onMounted(() => {
  for (let ipix = 0; ipix < HEALPIX_NUMCHUNKS; ++ipix) {
    getScene()!.add(mainMeshes[ipix]);
  }
});

onBeforeMount(async () => {
  const low = bounds.value?.low as number;
  const high = bounds.value?.high as number;
  const { addOffset, scaleFactor } = getColormapScaleOffset(
    low,
    high,
    invertColormap.value
  );

  const gridStep = 64 + 1;
  for (let ipix = 0; ipix < HEALPIX_NUMCHUNKS; ++ipix) {
    // Use GPU-projected material for instant projection center changes
    const material = makeGpuProjectedTextureMaterial(
      new THREE.Texture(),
      colormap.value,
      addOffset,
      scaleFactor
    );
    // Set initial projection uniforms
    const helper = projectionHelper.value;
    const center = projectionCenter.value;
    updateProjectionUniforms(material, helper.type, center.lon, center.lat);

    const { geometry } = makeHealpixGeometry(
      1,
      ipix,
      gridStep,
      projectionHelper.value,
      healpixEllipsoid.value
    );
    mainMeshes[ipix] = new THREE.Mesh(geometry, material);
    // Disable frustum culling - GPU projection changes actual positions
    mainMeshes[ipix].frustumCulled = false;
  }
  await datasourceUpdate();
});

defineExpose({ makeSnapshot, toggleRotate });
</script>

<template>
  <div ref="box" class="globe_box" tabindex="0" autofocus>
    <canvas ref="canvas" class="globe_canvas"> </canvas>
  </div>
</template>
