<script lang="ts" setup>
import type { Dayjs } from "dayjs";
import debounce from "lodash.debounce";
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { useGlobeControlStore } from "@/store/store";

const store = useGlobeControlStore();
const { varinfo, dimSlidersValues } = storeToRefs(store);

// Local copies for debounced updates (excluding time dimension)
const localSliders = ref<(number | null)[]>([]);
const debouncedUpdaters = ref<Array<(value: number) => void>>([]);

// Auto-play: per-dimension interval handles, keyed by dimension index.
const playTimers = ref<Record<number, ReturnType<typeof setInterval>>>({});
const PLAY_INTERVAL_MS = 500;

function isPlaying(index: number): boolean {
  return playTimers.value[index] !== undefined;
}

function stopPlaying(index: number) {
  const timer = playTimers.value[index];
  if (timer !== undefined) {
    clearInterval(timer);
    delete playTimers.value[index];
  }
}

function stopAllPlaying() {
  Object.keys(playTimers.value).forEach((index) => stopPlaying(Number(index)));
}

/** Advance one step, looping back to the start once past the end. */
function advanceDim(
  index: number,
  range: { minBound: number; maxBound: number }
) {
  const current = localSliders.value[index] ?? range.minBound;
  const next = current >= range.maxBound ? range.minBound : current + 1;
  localSliders.value[index] = next;
  // Bypass the debounced updater so the view keeps up at the play interval.
  if (dimSlidersValues.value[index] !== undefined) {
    dimSlidersValues.value[index] = next;
  }
}

function togglePlay(
  index: number,
  range: { minBound: number; maxBound: number }
) {
  if (isPlaying(index)) {
    stopPlaying(index);
  } else {
    playTimers.value[index] = setInterval(
      () => advanceDim(index, range),
      PLAY_INTERVAL_MS
    );
  }
}

onBeforeUnmount(stopAllPlaying);

const hasValidDimensions = computed(() => {
  return (
    varinfo.value &&
    varinfo.value.dimRanges.length > 1 &&
    varinfo.value.dimRanges.some(
      (range, idx) =>
        range &&
        (range.maxBound > 0 ||
          isTimeDimension(range.name, varinfo.value?.dimInfo[idx]))
    )
  );
});

/** Signature of the dimension structure, to detect real variable changes. */
function dimensionsSignature(): string {
  return (
    varinfo.value?.dimRanges
      ?.map((r) => `${r?.name}:${r?.minBound}-${r?.maxBound}`)
      .join("|") ?? ""
  );
}
let lastDimensionsSignature = dimensionsSignature();

// Watch for changes in varinfo to update local state
watch(
  () => varinfo.value,
  () => {
    // varinfo is reassigned on every dim change (it reloads data). Only stop
    // playback when the dimension *structure* changes (a real variable switch),
    // otherwise auto-play would cancel itself after a single step.
    const signature = dimensionsSignature();
    if (signature !== lastDimensionsSignature) {
      stopAllPlaying();
      lastDimensionsSignature = signature;
    }
    const newRanges = varinfo.value?.dimRanges;
    if (newRanges) {
      // Initialize local sliders fordimensions (skip index 0 which is time)
      localSliders.value = newRanges.map(
        (range, index) =>
          dimSlidersValues.value[index] ?? range?.startPos ?? null
      );

      // Create stable debounced functions for dimensions
      debouncedUpdaters.value = newRanges.map((_, index) => {
        return debounce((value: number) => {
          if (dimSlidersValues.value[index] !== undefined) {
            dimSlidersValues.value[index] = value;
          }
        }, 550);
      });
    }
  },
  { immediate: true }
);

// Watch for local changes and update store with debouncing
watch(
  localSliders,
  (newValues) => {
    newValues.forEach((value, index) => {
      if (
        value !== null &&
        value !== undefined &&
        value !== dimSlidersValues.value[index]
      ) {
        debouncedUpdaters.value[index](value);
      }
    });
  },
  { deep: true }
);

/** Detect time dimension from CF metadata or name fallback. */
function isTimeDimension(
  name: string | undefined,
  dimInfo?: { attrs?: Record<string, unknown> }
): boolean {
  const attrs = dimInfo?.attrs ?? {};
  if (attrs.axis === "T") {
    return true;
  }
  if (attrs.standard_name === "time") {
    return true;
  }
  if (typeof attrs.units === "string" && attrs.units.includes(" since ")) {
    return true;
  }
  return name === "time" || name === "time_counter";
}

/** Detect vertical/depth dimension from CF metadata or name fallback. */
function isDepthDimension(
  name: string | undefined,
  dimInfo?: { attrs?: Record<string, unknown> }
): boolean {
  const attrs = dimInfo?.attrs ?? {};
  if (attrs.axis === "Z") {
    return true;
  }
  if (attrs.positive === "up" || attrs.positive === "down") {
    return true;
  }
  return name === "s_rho" || name === "depth" || name === "lev";
}

function formatDepthLabel(
  index: number | null | undefined,
  maxBound: number
): string {
  if (index === null || index === undefined) {
    return "-";
  }
  if (index === maxBound) {
    return `Surface (level ${index})`;
  }
  if (index === 0) {
    return `Bottom (level ${index})`;
  }
  return `Level ${index}`;
}

/** Display label: use long_name from metadata, else format the name. */
function dimensionLabel(name: string, dimInfo?: { longName?: string }): string {
  if (dimInfo?.longName) {
    return dimInfo.longName;
  }
  return String(name[0]).toUpperCase() + String(name).slice(1);
}
</script>

<template>
  <div
    v-if="varinfo && hasValidDimensions"
    class="panel-block is-flex-direction-column"
    style="gap: 1.5em"
  >
    <template v-for="(range, index) in varinfo!.dimRanges" :key="index">
      <div
        v-if="
          range &&
          (range.maxBound > 0 ||
            isTimeDimension(range.name, varinfo.dimInfo[index]))
        "
        class="control"
      >
        <div class="">
          <div
            v-if="range"
            class="mb-2 w-100 is-flex is-justify-content-space-between"
          >
            <div class="has-text-weight-semibold">
              {{ dimensionLabel(range.name, varinfo.dimInfo[index]) }}
            </div>
            <div class="has-text-right">
              <span
                v-if="
                  isTimeDimension(
                    varinfo.dimRanges[index]?.name,
                    varinfo.dimInfo[index]
                  )
                "
              >
                {{
                  (varinfo.dimInfo[index]?.current as Dayjs)?.format?.(
                    "YYYY-MM-DD HH:mm"
                  ) ?? "-"
                }}
              </span>
              <span
                v-else-if="
                  isDepthDimension(
                    varinfo.dimRanges[index]?.name,
                    varinfo.dimInfo[index]
                  )
                "
              >
                {{
                  formatDepthLabel(localSliders[index], range?.maxBound ?? 0)
                }}
              </span>
              <span v-else>{{ varinfo.dimInfo[index]?.current ?? "-" }}</span>
            </div>
          </div>

          <div class="is-flex is-align-items-center dim-slider-row">
            <button
              type="button"
              class="play-button"
              :title="isPlaying(index) ? 'Pause' : 'Play'"
              :aria-label="isPlaying(index) ? 'Pause' : 'Play'"
              @click="togglePlay(index, range)"
            >
              <i
                class="fa-solid"
                :class="isPlaying(index) ? 'fa-pause' : 'fa-play'"
              ></i>
            </button>
            <input
              v-model.number="localSliders[index]"
              class="w-100"
              type="range"
              :min="range.minBound"
              :max="range.maxBound"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
  <div v-else></div>
</template>

<style lang="scss" scoped>
.dim-slider-row {
  gap: 0.6em;
}

.play-button {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 1px solid var(--bulma-border, #dbdbdb);
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: 0.7rem;
  line-height: 1;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--bulma-background, rgba(0, 0, 0, 0.05));
  }
}
</style>
