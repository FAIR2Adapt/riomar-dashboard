<script lang="ts" setup>
import { storeToRefs } from "pinia";
import { computed } from "vue";

import type { TMultiscalesInfo } from "@/lib/types/GlobeTypes";
import { useGlobeControlStore } from "@/store/store";

const props = defineProps<{
  multiscales: TMultiscalesInfo;
}>();

const emit = defineEmits<{
  switchLevel: [levelIndex: number];
}>();

const store = useGlobeControlStore();
const { loading } = storeToRefs(store);

// One option per level, sorted coarse → fine for natural reading. The `value`
// is the index into the original layout so switching maps back correctly.
const levelOptions = computed(() => {
  return props.multiscales.layout
    .map((level, index) => {
      const dggs = level.dggs as { refinement_level?: number } | undefined;
      const refinement = dggs?.refinement_level;
      const label =
        typeof refinement === "number"
          ? `Level ${refinement}`
          : `Level ${index + 1}`;
      return { index, label, refinement: refinement ?? index };
    })
    .sort((a, b) => a.refinement - b.refinement);
});

const activeLevel = computed(() => props.multiscales.activeLevel ?? 0);

function onChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if (value !== activeLevel.value) {
    emit("switchLevel", value);
  }
}
</script>

<template>
  <div v-if="levelOptions.length > 1" class="panel-block is-block">
    <div class="control">
      <div class="select is-fullwidth" :class="{ 'is-loading': loading }">
        <select :value="activeLevel" class="form-control" @change="onChange">
          <option
            v-for="opt in levelOptions"
            :key="opt.index"
            :value="opt.index"
          >
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>
