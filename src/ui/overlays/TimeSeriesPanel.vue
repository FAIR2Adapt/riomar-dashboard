<script lang="ts" setup>
import {
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import Annotation from "chartjs-plugin-annotation";
import dayjs from "dayjs";
import debounce from "lodash.debounce";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { GRID_TYPES, type T_GRID_TYPES } from "@/lib/data/gridTypeDetector";
import {
  fetchSeries,
  loadDimensionAxis,
  type TRegion,
  type TSeriesResult,
} from "@/lib/data/timeSeries";
import { ZarrDataManager } from "@/lib/data/ZarrDataManager";
import { isLatitudeName, isLongitudeName } from "@/lib/data/zarrUtils";
import type { TModelInfo, TSources } from "@/lib/types/GlobeTypes";
import RangeSlider from "@/ui/common/RangeSlider.vue";
import { PICK_MODE, useGlobeControlStore } from "@/store/store";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Legend,
  Tooltip,
  // Registered globally by other chart components too; including it here ensures
  // the plugin is active before this chart is created (it initialises per-chart
  // state in beforeInit, and crashes on update if that was skipped).
  Annotation
);

const props = defineProps<{
  datasources?: TSources;
  modelInfo?: TModelInfo;
  gridType?: T_GRID_TYPES;
}>();

const store = useGlobeControlStore();
const {
  varnameSelector,
  varinfo,
  dimSlidersValues,
  pickMode,
  pickedPoint,
  pickedBbox,
} = storeToRefs(store);

const PALETTE = [
  "#4a90d9",
  "#e8743b",
  "#19a979",
  "#945ecf",
  "#e4b400",
  "#cc3b3b",
  "#13a4b4",
  "#f06292",
  "#8d6e63",
  "#5c6bc0",
];

const collapsed = ref(false);
const mode = ref<"point" | "bbox">("point");

const loading = ref(false);
const errorMsg = ref<string | null>(null);
const hasPlotted = ref(false);

// Per-variable enabled state (checkboxes).
const checked = ref<Record<string, boolean>>({});
// Cache of fetched series, keyed by `${regionKey}::${varname}`.
const cache = ref<Record<string, TSeriesResult>>({});
// Per-variable error notes from the last plot.
const varErrors = ref<Record<string, string>>({});

type TPoint = { x: number; y: number | null };
const canvasRef = ref<HTMLCanvasElement>();
let chart: Chart<"line", TPoint[]> | undefined;

/** A dimension name is treated as time if it contains "time". */
function isTimeName(name: string): boolean {
  return name.toLowerCase().includes("time");
}

/** True for a coordinate name that is spatial (lat/lon) or time. */
function isSpatialOrTime(name: string): boolean {
  return isLatitudeName(name) || isLongitudeName(name) || isTimeName(name);
}

/** True only on the map view that supports click-picking. */
const canPick = computed(() => props.gridType === GRID_TYPES.HEALPIX);
const isPicking = computed(() => pickMode.value !== PICK_MODE.NONE);

/** Data variables worth plotting (excludes hidden + coordinate variables). */
const plottableVars = computed(() => {
  if (!props.modelInfo) {
    return [] as string[];
  }
  return Object.keys(props.modelInfo.vars).filter((name) => {
    const v = props.modelInfo!.vars[name];
    return !v.hidden && !isSpatialOrTime(name) && name !== "crs";
  });
});

// Dimension names per variable, used to offer only matching variables.
const varDims = ref<Record<string, string[]>>({});
watch(
  [() => props.datasources, plottableVars],
  async ([ds, vars]) => {
    if (!ds) {
      varDims.value = {};
      return;
    }
    const next: Record<string, string[]> = {};
    await Promise.all(
      (vars as string[]).map(async (name) => {
        try {
          next[name] = await ZarrDataManager.getDimensionNames(ds, name);
        } catch {
          next[name] = [];
        }
      })
    );
    varDims.value = next;
  },
  { immediate: true }
);

// Non-spatial dimensions the chart can vary along (time, depth, level, …).
const dimOptions = computed(() => {
  const ranges = varinfo.value?.dimRanges;
  if (!ranges) {
    return [] as string[];
  }
  return ranges
    .filter(
      (r): r is NonNullable<typeof r> =>
        !!r &&
        r.maxBound > r.minBound &&
        !isLatitudeName(r.name) &&
        !isLongitudeName(r.name)
    )
    .map((r) => r.name);
});

// The dimension the chart varies along. Defaults to time when available.
const selectedDim = ref<string | null>(null);
watch(
  dimOptions,
  (dims) => {
    if (!selectedDim.value || !dims.includes(selectedDim.value)) {
      selectedDim.value = dims.find(isTimeName) ?? dims[0] ?? null;
    }
  },
  { immediate: true }
);

// Only variables that carry the selected dimension can be plotted.
const displayVars = computed(() => {
  if (!selectedDim.value) {
    return plottableVars.value;
  }
  return plottableVars.value.filter((name) => {
    const dims = varDims.value[name];
    // Optimistically include until the variable's dimensions are known.
    return !dims || dims.includes(selectedDim.value!);
  });
});

// Initialise the checkbox state, enabling the currently displayed variable.
watch(
  plottableVars,
  (vars) => {
    const next: Record<string, boolean> = {};
    for (const name of vars) {
      next[name] = checked.value[name] ?? name === varnameSelector.value;
    }
    checked.value = next;
  },
  { immediate: true }
);

// Full coordinate axis of the selected dimension and the chosen index range.
const fullCoords = ref<number[]>([]);
const axisIsTime = ref(false);
const axisUnits = ref<string | undefined>(undefined);
const rangeLow = ref(0);
const rangeHigh = ref(0);

const hasRange = computed(() => fullCoords.value.length > 1);
const rangeStart = computed(() => Math.round(rangeLow.value));
const rangeEnd = computed(() => Math.round(rangeHigh.value));

// The dimension may be unsorted, so the slider and graph work in sorted order.
// `sortOrder` maps a sorted position -> original index along the dimension.
const sortOrder = computed(() =>
  fullCoords.value
    .map((_, i) => i)
    .sort((a, b) => fullCoords.value[a] - fullCoords.value[b])
);
const sortedCoords = computed(() =>
  sortOrder.value.map((i) => fullCoords.value[i])
);
// Inverse of `sortOrder`: original index -> its position in sorted order.
const sortRank = computed(() => {
  const rank: number[] = new Array(fullCoords.value.length);
  sortOrder.value.forEach((origIdx, sortedPos) => {
    rank[origIdx] = sortedPos;
  });
  return rank;
});

// The globally selected position along the chart's dimension, taken from the
// shared dimension sliders. Used to mark "where we are" on the chart and slider.
const globalDimIndex = computed<number | null>(() => {
  const ranges = varinfo.value?.dimRanges;
  if (!ranges || !selectedDim.value) {
    return null;
  }
  const i = ranges.findIndex((r) => r?.name === selectedDim.value);
  if (i < 0) {
    return null;
  }
  const v = dimSlidersValues.value[i];
  return typeof v === "number" ? v : null;
});
// Coordinate value of the global selection (the chart's x position).
const globalDimCoord = computed<number | null>(() => {
  const idx = globalDimIndex.value;
  if (idx == null) {
    return null;
  }
  const c = fullCoords.value[idx];
  return typeof c === "number" ? c : null;
});
// Sorted slider position of the global selection (the slider's dot).
const globalSliderPos = computed<number | null>(() => {
  const idx = globalDimIndex.value;
  if (idx == null) {
    return null;
  }
  const pos = sortRank.value[idx];
  return typeof pos === "number" ? pos : null;
});

function fmtCoord(value: number | undefined): string {
  if (value === undefined) {
    return "-";
  }
  if (axisIsTime.value) {
    return dayjs(value).format("YYYY-MM-DD HH:mm");
  }
  return axisUnits.value ? `${value} ${axisUnits.value}` : String(value);
}
const rangeStartLabel = computed(() =>
  fmtCoord(sortedCoords.value[rangeStart.value])
);
const rangeEndLabel = computed(() =>
  fmtCoord(sortedCoords.value[rangeEnd.value])
);

const hasSelection = computed(() =>
  mode.value === "point" ? !!pickedPoint.value : !!pickedBbox.value
);

type TPickKind = "point" | "bbox";

/** Whether the given picker is mid-selection on the map right now. */
function isModePicking(kind: TPickKind): boolean {
  return isPicking.value && mode.value === kind;
}

/** Whether the given picker already has a selection. */
function isModePicked(kind: TPickKind): boolean {
  return kind === "point" ? !!pickedPoint.value : !!pickedBbox.value;
}

/** Bulma colour class encoding the three button states. */
function pickBtnClass(kind: TPickKind): string {
  if (isModePicking(kind)) {
    return "is-warning";
  }
  if (isModePicked(kind)) {
    return "is-success";
  }
  return "is-light";
}

/** Icon encoding the three button states. */
function pickBtnIcon(kind: TPickKind): string {
  if (isModePicking(kind)) {
    return "fa-crosshairs fa-fade";
  }
  if (isModePicked(kind)) {
    return "fa-check";
  }
  return kind === "point" ? "fa-location-dot" : "fa-vector-square";
}

function onPickButton(kind: TPickKind) {
  // Clicking the picker that is currently active cancels it.
  if (isModePicking(kind)) {
    store.cancelPick();
    return;
  }
  mode.value = kind;
  // Using one picker resets the other selection.
  if (kind === "point") {
    store.clearPickedBbox();
  } else {
    store.clearPickedPoint();
  }
  store.startPick(kind === "point" ? PICK_MODE.POINT : PICK_MODE.BBOX);
}

/** Spatial part of a cache key (point or bbox), or null if nothing is picked. */
function spatialKey(): string | null {
  if (mode.value === "point") {
    const p = pickedPoint.value;
    return p ? `pt:${p.lat},${p.lon}` : null;
  }
  const b = pickedBbox.value;
  return b ? `bb:${b.latMin},${b.latMax},${b.lonMin},${b.lonMax}` : null;
}

/** Current non-spatial dimension positions (e.g. depth), keyed by name. */
function otherDimSelections(): Record<string, number> {
  const out: Record<string, number> = {};
  const ranges = varinfo.value?.dimRanges;
  if (!ranges) {
    return out;
  }
  ranges.forEach((range, i) => {
    const value = dimSlidersValues.value[i];
    if (range?.name && typeof value === "number") {
      out[range.name] = value;
    }
  });
  return out;
}

/** Signature of the fixed dimension positions, excluding the varying one. */
function fixedDimsSignature(): string {
  const dims = otherDimSelections();
  return Object.keys(dims)
    .filter((k) => k !== selectedDim.value)
    .sort()
    .map((k) => `${k}=${dims[k]}`)
    .join(",");
}

/** Cache key: spatial + dimension + index range + fixed (other) dimensions. */
function regionKey(): string | null {
  const s = spatialKey();
  if (!s || !selectedDim.value) {
    return null;
  }
  const r = `${selectedDim.value}@${rangeStart.value}-${rangeEnd.value}`;
  return `${s}::${r}::${fixedDimsSignature()}`;
}

function currentRegion(): TRegion | null {
  if (mode.value === "point") {
    const p = pickedPoint.value;
    return p ? { mode: "point", lat: p.lat, lon: p.lon } : null;
  }
  const b = pickedBbox.value;
  return b ? { mode: "bbox", ...b } : null;
}

function colorFor(name: string): string {
  const idx = plottableVars.value.indexOf(name);
  return PALETTE[((idx % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

// A muted dashed vertical line marking the globally selected coordinate, so the
// chart shows where the rest of the app is currently positioned on this axis.
function markerAnnotations(): Record<string, object> {
  const x = globalDimCoord.value;
  if (x == null) {
    return {};
  }
  return {
    globalPos: {
      type: "line",
      xMin: x,
      xMax: x,
      borderColor: "rgba(128, 128, 128, 0.6)",
      borderWidth: 1,
      borderDash: [4, 4],
    },
  };
}

/** Annotation plugin options on the chart, narrowed for assignment. */
function annotationOptions(): { annotations: Record<string, object> } {
  return (
    chart!.options.plugins as unknown as {
      annotation: { annotations: Record<string, object> };
    }
  ).annotation;
}

async function plot() {
  if (!props.datasources || !selectedDim.value) {
    return;
  }
  const region = currentRegion();
  const key = regionKey();
  if (!region || !key) {
    return;
  }

  // Zero selected variables is valid — the chart simply renders empty.
  const selected = displayVars.value.filter((n) => checked.value[n]);

  loading.value = true;
  errorMsg.value = null;
  varErrors.value = {};
  hasPlotted.value = true;

  const dims = otherDimSelections();

  // The selected window (in sorted order) maps to a set of original indices;
  // fetch the contiguous original block that covers them.
  let fetchRange: { start: number; end: number } | undefined;
  if (hasRange.value) {
    const selOrig = sortOrder.value.slice(rangeStart.value, rangeEnd.value + 1);
    fetchRange = {
      start: Math.min(...selOrig),
      end: Math.max(...selOrig),
    };
  }

  await Promise.all(
    selected.map(async (name) => {
      const cacheKey = `${key}::${name}`;
      if (cache.value[cacheKey]) {
        return;
      }
      try {
        cache.value[cacheKey] = await fetchSeries(
          props.datasources!,
          name,
          props.gridType,
          region,
          selectedDim.value!,
          dims,
          fetchRange
        );
      } catch (error) {
        varErrors.value[name] =
          error instanceof Error ? error.message : String(error);
      }
    })
  );

  loading.value = false;
  renderChart();
}

function renderChart() {
  if (!canvasRef.value) {
    return;
  }
  const key = regionKey();
  if (!key || !selectedDim.value) {
    return;
  }
  const selected = displayVars.value.filter(
    (n) => checked.value[n] && cache.value[`${key}::${n}`]
  );

  // Clip the fetched block to the selected window and sort points by coordinate
  // so the line is drawn in order even when the dimension is unsorted.
  const cLo = sortedCoords.value[rangeStart.value];
  const cHi = sortedCoords.value[rangeEnd.value];

  const datasets = selected.map((name) => {
    const series = cache.value[`${key}::${name}`];
    const color = colorFor(name);
    const data = series.coords
      .map((c, i) => ({ x: c, y: series.values[i] }))
      .filter(
        (p) =>
          (cLo === undefined || p.x >= cLo) && (cHi === undefined || p.x <= cHi)
      )
      .sort((a, b) => a.x - b.x);
    return {
      label: series.units ? `${name} (${series.units})` : name,
      data,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 1.5,
      pointRadius: 2,
      pointHoverRadius: 4,
      spanGaps: true,
    };
  });

  // Pin the x-axis to the min/max of the shown data, with a small 1% gap.
  let xMin: number | undefined;
  let xMax: number | undefined;
  for (const ds of datasets) {
    for (const p of ds.data) {
      if (xMin === undefined || p.x < xMin) {
        xMin = p.x;
      }
      if (xMax === undefined || p.x > xMax) {
        xMax = p.x;
      }
    }
  }
  if (xMin !== undefined && xMax !== undefined && xMax > xMin) {
    const pad = (xMax - xMin) * 0.01;
    xMin -= pad;
    xMax += pad;
  }

  const isTime = axisIsTime.value;
  // Depth-like coordinates grow downward, so invert the axis (surface first).
  const reverseX = !isTime && /depth|deptht|lev/i.test(selectedDim.value);
  const xTitle = isTime
    ? undefined
    : axisUnits.value
      ? `${selectedDim.value} (${axisUnits.value})`
      : selectedDim.value;

  const xScale = {
    type: "linear" as const,
    min: xMin,
    max: xMax,
    reverse: reverseX,
    title: { display: !!xTitle, text: xTitle ?? "" },
    ticks: {
      maxTicksLimit: 6,
      callback: (value: string | number) =>
        isTime ? dayjs(Number(value)).format("YYYY-MM-DD") : Number(value),
    },
  };

  if (!chart) {
    chart = new Chart<"line", TPoint[]>(canvasRef.value, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        parsing: false,
        scales: {
          x: xScale,
          y: { beginAtZero: false },
        },
        plugins: {
          annotation: { annotations: markerAnnotations() },
          legend: { position: "bottom", labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: (items) => {
                if (!items.length) {
                  return "";
                }
                const x = Number(items[0].parsed.x);
                return axisIsTime.value
                  ? dayjs(x).format("YYYY-MM-DD HH:mm")
                  : fmtCoord(x);
              },
            },
          },
        },
      },
    });
  } else {
    chart.options.scales!.x = xScale as unknown as NonNullable<
      typeof chart.options.scales
    >["x"];
    chart.data.datasets = datasets as unknown as typeof chart.data.datasets;
    annotationOptions().annotations = markerAnnotations();
    chart.update();
  }
}

// Reference variable used to read the dimension axis: prefer the displayed
// variable, else the first that carries the dimension.
function axisRefVar(): string | undefined {
  if (
    varnameSelector.value &&
    displayVars.value.includes(varnameSelector.value)
  ) {
    return varnameSelector.value;
  }
  return displayVars.value[0];
}

// Load the selected dimension's axis (and reset the range to full) whenever the
// dataset, variable list or selected dimension changes.
watch(
  [() => props.datasources, selectedDim, displayVars],
  async () => {
    if (!props.datasources || !selectedDim.value) {
      fullCoords.value = [];
      return;
    }
    const refVar = axisRefVar();
    if (!refVar) {
      return;
    }
    try {
      const axis = await loadDimensionAxis(
        props.datasources,
        refVar,
        selectedDim.value
      );
      fullCoords.value = axis.coords;
      axisIsTime.value = axis.isTime;
      axisUnits.value = axis.coordUnits;
      rangeLow.value = 0;
      rangeHigh.value = Math.max(0, axis.coords.length - 1);
    } catch {
      fullCoords.value = [];
    }
  },
  { immediate: true }
);

// Plot automatically once the map reports a picked location / box.
watch([pickedPoint, pickedBbox], () => {
  if (hasSelection.value) {
    collapsed.value = false;
    plot();
  }
});

// Re-fetch when the range slider settles.
const debouncedPlot = debounce(() => {
  if (hasPlotted.value && hasSelection.value) {
    plot();
  }
}, 400);

// Show the loading overlay immediately, before the debounce, so the chart
// reflects that a re-fetch is pending even while data is loading elsewhere.
function scheduleReplot() {
  if (hasPlotted.value && hasSelection.value) {
    loading.value = true;
    debouncedPlot();
  }
}
watch([rangeStart, rangeEnd], scheduleReplot);

// Re-plot when a non-spatial dimension is changed from outside this panel. The
// cache key encodes the fixed dimensions, so an unaffected chart hits the cache.
watch(dimSlidersValues, scheduleReplot, { deep: true });

// Move the global-position marker as it changes, without waiting for a re-fetch.
watch(globalDimCoord, () => {
  if (!chart) {
    return;
  }
  annotationOptions().annotations = markerAnnotations();
  chart.update("none");
});

// Re-plot when the selected dimension or variable toggles change.
watch([selectedDim, checked], () => {
  if (hasPlotted.value && hasSelection.value) {
    plot();
  }
}, { deep: true });

// A new dataset invalidates everything.
watch(
  () => props.datasources,
  () => {
    cache.value = {};
    varErrors.value = {};
    hasPlotted.value = false;
    chart?.destroy();
    chart = undefined;
  }
);

onBeforeUnmount(() => {
  debouncedPlot.cancel();
  store.cancelPick();
  chart?.destroy();
  chart = undefined;
});
</script>

<template>
  <div
    v-if="modelInfo"
    class="panel ts-panel"
    :class="{ 'ts-collapsed': collapsed }"
  >
    <div v-if="!collapsed" class="ts-body">
      <!-- Pickers: two buttons, each with normal / picking / picked states -->
      <div class="ts-pick">
        <button
          type="button"
          class="button is-small ts-pick-btn"
          :class="pickBtnClass('point')"
          :disabled="!canPick"
          @click="onPickButton('point')"
        >
          <i class="fa-solid mr-2" :class="pickBtnIcon('point')"></i>
          Location
        </button>
        <button
          type="button"
          class="button is-small ts-pick-btn"
          :class="pickBtnClass('bbox')"
          :disabled="!canPick"
          @click="onPickButton('bbox')"
        >
          <i class="fa-solid mr-2" :class="pickBtnIcon('bbox')"></i>
          Bounding box
        </button>
      </div>

      <!-- Dimension selector (the chart's x-axis) + range slider -->
      <div
        v-if="dimOptions.length > 1 || hasRange"
        class="ts-controls"
      >
        <div v-if="dimOptions.length > 1" class="ts-dim">
          <span class="ts-dim-label">Dimension</span>
          <div class="select is-small">
            <select v-model="selectedDim">
              <option v-for="name in dimOptions" :key="name" :value="name">
                {{ name }}
              </option>
            </select>
          </div>
        </div>

        <!-- Range slider over the selected dimension -->
        <div v-if="hasRange" class="ts-time">
          <div class="ts-time-labels">
            <span>{{ rangeStartLabel }}</span>
            <span>{{ rangeEndLabel }}</span>
          </div>
          <RangeSlider
            :low="rangeLow"
            :high="rangeHigh"
            :min="0"
            :max="fullCoords.length - 1"
            :marker="globalSliderPos"
            @update:low="rangeLow = $event"
            @update:high="rangeHigh = $event"
          />
        </div>
      </div>

      <!-- Variable checkboxes -->
      <div class="ts-vars">
        <label v-for="name in displayVars" :key="name" class="ts-var">
          <input v-model="checked[name]" type="checkbox" />
          <span class="ts-var-name" :title="name">{{ name }}</span>
          <i
            v-if="varErrors[name]"
            class="fa-solid fa-triangle-exclamation ts-warn"
            :title="varErrors[name]"
          ></i>
        </label>
      </div>

      <p v-if="errorMsg" class="ts-error">{{ errorMsg }}</p>

      <div v-show="hasPlotted" class="ts-chart">
        <canvas ref="canvasRef"></canvas>
        <div v-if="loading" class="ts-chart-loading">
          <span class="ts-spinner"></span>
          <span>Loading…</span>
        </div>
      </div>
    </div>

    <div class="ts-header" @click="collapsed = !collapsed">
      <i class="fa-solid fa-chart-line mr-2"></i>
      <span class="ts-title">Chart</span>
      <i
        class="fa-solid"
        :class="collapsed ? 'fa-angle-up' : 'fa-angle-down'"
      ></i>
    </div>
  </div>
</template>

<style lang="scss">
.ts-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 30rem;
  max-width: calc(100vw - 1rem);
  max-height: 70vh;
  margin-bottom: 0 !important;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bulma-scheme-main);
  border-radius: 0 8px 0 0;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.25);
  z-index: 9;

  .ts-header {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.6rem 0.9rem;
    cursor: pointer;
    font-weight: 600;
    background: var(--bulma-scheme-main-bis);
    border-top: 1px solid var(--bulma-border-weak);
  }

  .ts-title {
    flex: 1;
  }

  .ts-body {
    flex: 1;
    min-height: 0;
    padding: 0.75rem 0.9rem;
    overflow-y: auto;
  }

  .ts-var {
    cursor: pointer;
  }

  .ts-pick {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .ts-pick-btn {
    flex: 1;
  }

  .ts-hint {
    font-size: 0.72rem;
    color: var(--bulma-grey);
    margin: 0 0 0.5rem;
  }

  .ts-controls {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    margin: 0.4rem 0 0.8rem;
  }

  .ts-dim {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .ts-dim-label {
    font-size: 0.78rem;
    font-weight: 600;
  }

  .ts-time {
    flex: 1;
    min-width: 0;
    padding: 0 0.75rem;
  }

  .ts-time-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--bulma-grey);
    margin-bottom: 0.1rem;
  }

  .ts-vars {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.9rem;
    margin-bottom: 0.6rem;
    max-height: 7rem;
    overflow-y: auto;
  }

  .ts-var {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8rem;
    max-width: 100%;
  }

  .ts-var-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 9rem;
  }

  .ts-warn {
    color: var(--bulma-warning, #e4b400);
  }

  .ts-error {
    color: var(--bulma-danger, #cc3b3b);
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
  }

  .ts-chart {
    position: relative;
    height: 220px;
    width: 100%;
  }

  .ts-chart-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    font-size: 0.85rem;
    color: var(--bulma-grey);
    background: color-mix(in srgb, var(--bulma-scheme-main) 70%, transparent);
    backdrop-filter: blur(1px);
  }

  .ts-spinner {
    width: 1.2rem;
    height: 1.2rem;
    border: 2px solid var(--bulma-border);
    border-top-color: var(--bulma-link);
    border-radius: 50%;
    animation: ts-spin 0.8s linear infinite;
  }

  @keyframes ts-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media only screen and (max-width: 768px) {
    width: 100%;
    border-radius: 0;
  }
}
</style>
