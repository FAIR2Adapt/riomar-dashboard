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
import dayjs from "dayjs";
import debounce from "lodash.debounce";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { GRID_TYPES, type T_GRID_TYPES } from "@/lib/data/gridTypeDetector";
import {
  fetchTimeSeries,
  loadTimeAxis,
  type TRegion,
  type TSeriesResult,
} from "@/lib/data/timeSeries";
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
  Tooltip
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

// Full time axis (epoch ms) and the selected index range [timeLow, timeHigh].
const fullTimes = ref<number[]>([]);
const timeLow = ref(0);
const timeHigh = ref(0);

const hasTimeAxis = computed(() => fullTimes.value.length > 1);
const timeStart = computed(() => Math.round(timeLow.value));
const timeEnd = computed(() => Math.round(timeHigh.value));

// The dataset's time dimension may be unsorted, so the slider and graph work in
// time order. `sortOrder` maps a sorted position -> original time index.
const sortOrder = computed(() =>
  fullTimes.value
    .map((_, i) => i)
    .sort((a, b) => fullTimes.value[a] - fullTimes.value[b])
);
const sortedTimes = computed(() =>
  sortOrder.value.map((i) => fullTimes.value[i])
);

function fmtTime(ms: number | undefined): string {
  return ms === undefined ? "-" : dayjs(ms).format("YYYY-MM-DD HH:mm");
}
const timeStartLabel = computed(() =>
  fmtTime(sortedTimes.value[timeStart.value])
);
const timeEndLabel = computed(() => fmtTime(sortedTimes.value[timeEnd.value]));

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
    if (v.hidden) {
      return false;
    }
    const lower = name.toLowerCase();
    if (
      isLatitudeName(name) ||
      isLongitudeName(name) ||
      lower.includes("time") ||
      name === "crs"
    ) {
      return false;
    }
    return true;
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

function regionKey(): string | null {
  const t = `@${timeStart.value}-${timeEnd.value}`;
  if (mode.value === "point") {
    const p = pickedPoint.value;
    return p ? `pt:${p.lat},${p.lon}${t}` : null;
  }
  const b = pickedBbox.value;
  return b ? `bb:${b.latMin},${b.latMax},${b.lonMin},${b.lonMax}${t}` : null;
}

function currentRegion(): TRegion | null {
  if (mode.value === "point") {
    const p = pickedPoint.value;
    return p ? { mode: "point", lat: p.lat, lon: p.lon } : null;
  }
  const b = pickedBbox.value;
  return b ? { mode: "bbox", ...b } : null;
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

function colorFor(name: string): string {
  const idx = plottableVars.value.indexOf(name);
  return PALETTE[((idx % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

async function plot() {
  if (!props.datasources) {
    return;
  }
  const region = currentRegion();
  const key = regionKey();
  if (!region || !key) {
    return;
  }

  // Zero selected variables is valid — the chart simply renders empty.
  const selected = plottableVars.value.filter((n) => checked.value[n]);

  loading.value = true;
  errorMsg.value = null;
  varErrors.value = {};
  hasPlotted.value = true;

  const dims = otherDimSelections();

  // The selected time window (in sorted order) maps to a set of original
  // indices; fetch the contiguous original block that covers them.
  let fetchRange: { start: number; end: number } | undefined;
  if (hasTimeAxis.value) {
    const selOrig = sortOrder.value.slice(timeStart.value, timeEnd.value + 1);
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
        cache.value[cacheKey] = await fetchTimeSeries(
          props.datasources!,
          name,
          props.gridType,
          region,
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
  if (!key) {
    return;
  }
  const selected = plottableVars.value.filter(
    (n) => checked.value[n] && cache.value[`${key}::${n}`]
  );

  // Clip the fetched block to the selected window and sort points by time so
  // the line is drawn left-to-right even when the time dimension is unsorted.
  const tLo = sortedTimes.value[timeStart.value];
  const tHi = sortedTimes.value[timeEnd.value];

  const datasets = selected.map((name) => {
    const series = cache.value[`${key}::${name}`];
    const color = colorFor(name);
    const data = series.times
      .map((t, i) => ({ x: t, y: series.values[i] }))
      .filter(
        (p) =>
          (tLo === undefined || p.x >= tLo) && (tHi === undefined || p.x <= tHi)
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
          x: {
            type: "linear",
            min: xMin,
            max: xMax,
            ticks: {
              maxTicksLimit: 6,
              callback: (value) => dayjs(Number(value)).format("YYYY-MM-DD"),
            },
          },
          y: { beginAtZero: false },
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              title: (items) =>
                items.length
                  ? dayjs(Number(items[0].parsed.x)).format("YYYY-MM-DD HH:mm")
                  : "",
            },
          },
        },
      },
    });
  } else {
    const xScale = chart.options.scales!.x as { min?: number; max?: number };
    xScale.min = xMin;
    xScale.max = xMax;
    chart.data.datasets = datasets as unknown as typeof chart.data.datasets;
    chart.update();
  }
}

// Load the time axis (and reset the range to the full extent) when the dataset
// or reference variable changes.
watch(
  [() => props.datasources, varnameSelector, plottableVars],
  async () => {
    if (!props.datasources) {
      fullTimes.value = [];
      return;
    }
    const refVar =
      varnameSelector.value &&
      plottableVars.value.includes(varnameSelector.value)
        ? varnameSelector.value
        : plottableVars.value[0];
    if (!refVar) {
      return;
    }
    try {
      const times = await loadTimeAxis(props.datasources, refVar);
      fullTimes.value = times;
      timeLow.value = 0;
      timeHigh.value = Math.max(0, times.length - 1);
    } catch {
      fullTimes.value = [];
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

// Re-fetch (only the new range) when the time-range slider settles.
const debouncedPlot = debounce(() => {
  if (hasPlotted.value && hasSelection.value) {
    plot();
  }
}, 400);
watch([timeStart, timeEnd], debouncedPlot);

// Re-plot when variable toggles change (only after the first plot).
watch(
  checked,
  () => {
    if (hasPlotted.value && hasSelection.value) {
      plot();
    }
  },
  { deep: true }
);

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

      <p v-if="!canPick" class="ts-hint">
        Map picking is available on the HEALPix map view.
      </p>
      <p v-else-if="isPicking && mode === 'bbox'" class="ts-hint">
        Click two opposite corners on the map. Values are averaged over the box.
      </p>
      <p v-else-if="isPicking" class="ts-hint">
        Click a location on the map.
      </p>

      <!-- Time-range slider -->
      <div v-if="hasTimeAxis" class="ts-time">
        <div class="ts-time-head">
          <span>Time range</span>
        </div>
        <div class="ts-time-labels">
          <span>{{ timeStartLabel }}</span>
          <span>{{ timeEndLabel }}</span>
        </div>
        <RangeSlider
          :low="timeLow"
          :high="timeHigh"
          :min="0"
          :max="fullTimes.length - 1"
          @update:low="timeLow = $event"
          @update:high="timeHigh = $event"
        />
      </div>

      <!-- Variable checkboxes -->
      <div class="ts-vars">
        <label v-for="name in plottableVars" :key="name" class="ts-var">
          <input v-model="checked[name]" type="checkbox" />
          <span
            class="ts-swatch"
            :style="{ background: colorFor(name) }"
          ></span>
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
      <span class="ts-title">Time series</span>
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
  width: 40rem;
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

  .ts-time {
    margin-bottom: 0.8rem;
  }

  .ts-time-head {
    font-size: 0.78rem;
    font-weight: 600;
    margin-bottom: 0.2rem;
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

  .ts-swatch {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
    flex: none;
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
