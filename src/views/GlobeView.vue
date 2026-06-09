<script lang="ts" setup>
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch, type Ref } from "vue";

import type {
  TDataSource,
  TModelInfo,
  TSources,
} from "../lib/types/GlobeTypes";

import {
  getGridType,
  GRID_TYPES,
  type T_GRID_TYPES,
} from "@/lib/data/gridTypeDetector";
import { indexFromIndex, indexFromZarr } from "@/lib/data/sourceIndexing";
import { ZarrDataManager } from "@/lib/data/ZarrDataManager";
import {
  availableColormaps,
  type TColorMap,
} from "@/lib/shaders/colormapShaders";
import { useUrlParameterStore } from "@/store/paramStore";
import { useGlobeControlStore } from "@/store/store";
import { useUrlSync } from "@/store/useUrlSync";
import Toast from "@/ui/common/Toast.vue";
import GridCurvilinear from "@/ui/grids/Curvilinear.vue";
import GridGaussianReduced from "@/ui/grids/GaussianReduced.vue";
import GridHealpixMaplibre from "@/ui/grids/HealpixMaplibre.vue";
import GridIrregular from "@/ui/grids/Irregular.vue";
import GridIrregularDelaunay from "@/ui/grids/IrregularDelaunay.vue";
import GridRegular from "@/ui/grids/Regular.vue";
import GridTriangular from "@/ui/grids/Triangular.vue";
import AboutView from "@/ui/overlays/AboutModal.vue";
import GlobeControls from "@/ui/overlays/Controls.vue";
import InfoPanel from "@/ui/overlays/InfoPanel.vue";
import TimeSeriesPanel from "@/ui/overlays/TimeSeriesPanel.vue";
import { useLog } from "@/utils/logging";

const props = defineProps<{ src: string }>();

useUrlSync();
const { logError } = useLog();
const store = useGlobeControlStore();
const urlParameterStore = useUrlParameterStore();

const { varnameSelector, loading, colormap, invertColormap } =
  storeToRefs(store);

const { paramVarname, paramGridType } = storeToRefs(urlParameterStore);

const globe: Ref<typeof GridTriangular | null> = ref(null);
const globeKey = ref(0);
const globeControlKey = ref(0);
const isInitialized = ref(false);
const sourceValid = ref(false);
const datasources: Ref<TSources | undefined> = ref(undefined);
const detectedGridType: Ref<T_GRID_TYPES | undefined> = ref(undefined);
const infoPanelOpen = ref(false);

const activeGridType = computed(() => {
  const detected = detectedGridType.value;
  if (!detected) {
    return undefined;
  }
  if (paramGridType.value) {
    return paramGridType.value as T_GRID_TYPES;
  } else {
    return detected;
  }
});

// Formula variables turned into TDataSource entries. Each points at its
// reference operand's store/dataset so grid/CRS/cell lookups resolve, and is
// tagged with `derived` so ZarrDataManager routes it to the evaluator. Defs
// referencing missing variables (e.g. from another dataset) are skipped.
const derivedEntries = computed<Record<string, TDataSource>>(() => {
  const ds = datasources.value;
  if (!ds) {
    return {};
  }
  const realVars = ds.levels[0].datasources;
  const entries: Record<string, TDataSource> = {};
  for (const def of store.derivedVariables) {
    const ref = realVars[def.referenceVar];
    const allExist = ref && def.inputs.every((name) => realVars[name]);
    if (!allExist) {
      continue;
    }
    entries[def.name] = {
      store: ref.store,
      dataset: ref.dataset,
      attrs: {
        units: def.units ?? "",
        long_name: def.longName ?? def.name,
        standard_name: def.longName ?? def.name,
        dimensionNames: def.resultDims,
        _ARRAY_DIMENSIONS: def.resultDims,
      },
      derived: def,
    };
  }
  return entries;
});

const modelInfo = computed(() => {
  if (datasources.value === undefined) {
    return undefined;
  } else {
    return {
      title: datasources.value.name,
      vars: {
        ...datasources.value.levels[0].datasources,
        ...derivedEntries.value,
      },
      defaultVar: datasources.value.default_var,
      colormaps: Object.keys(availableColormaps) as TColorMap[],
    } as TModelInfo;
  }
});

// Keep ZarrDataManager's derived-variable registry in sync with the store and
// the current dataset so the evaluator can resolve operands.
watch(
  [() => store.derivedVariables, () => datasources.value],
  () => {
    if (datasources.value) {
      ZarrDataManager.setDerivedVariables(
        store.derivedVariables,
        datasources.value
      );
    }
  },
  { deep: true }
);

const currentGlobeComponent = computed(() => {
  const gridMapping = {
    [GRID_TYPES.HEALPIX]: GridHealpixMaplibre,
    [GRID_TYPES.REGULAR]: GridRegular,
    [GRID_TYPES.REGULAR_ROTATED]: GridRegular,
    [GRID_TYPES.TRIANGULAR]: GridTriangular,
    [GRID_TYPES.GAUSSIAN_REDUCED]: GridGaussianReduced,
    [GRID_TYPES.IRREGULAR]: GridIrregular,
    [GRID_TYPES.IRREGULAR_DELAUNAY]: GridIrregularDelaunay,
    [GRID_TYPES.CURVILINEAR]: GridCurvilinear,
  };

  return gridMapping[activeGridType.value as keyof typeof gridMapping];
});

async function setGridType() {
  if (!isInitialized.value) {
    return;
  }
  const localGridType = await getGridType(
    sourceValid.value,
    varnameSelector.value,
    datasources.value,
    logError
  );
  detectedGridType.value = localGridType;
  if (localGridType === GRID_TYPES.ERROR) {
    store.stopLoading();
  }
}

watch(
  () => props.src,
  async () => {
    // Rerender controls and globe and reset store
    // if new data is provided
    detectedGridType.value = undefined;
    globeKey.value += 1;
    globeControlKey.value += 1;
    store.$reset();
    // stop loading is handled in the grid components after data load
    store.startLoading();
    await updateSrc();
  }
);

watch(
  () => varnameSelector.value,
  async () => {
    if (!varnameSelector.value || varnameSelector.value === "-") {
      return;
    }
    await setGridType();
  }
);

function prepareDefaults(src: string, index: TSources) {
  if (src === props.src) {
    datasources.value = index;
  }
  const validVars = Object.keys(modelInfo.value!.vars).filter((varname) => {
    const varinfo = modelInfo.value!.vars[varname];
    return !varinfo.hidden;
  });
  varnameSelector.value =
    paramVarname.value ?? modelInfo.value!.defaultVar ?? validVars[0];

  if (
    datasources.value &&
    varnameSelector.value in datasources.value.levels[0].datasources
  ) {
    const variableDefaults =
      datasources.value.levels[0].datasources[varnameSelector.value];
    if (variableDefaults.default_colormap) {
      colormap.value = variableDefaults.default_colormap.name;
      if (Object.hasOwn(variableDefaults.default_colormap, "inverted")) {
        invertColormap.value = variableDefaults.default_colormap.inverted;
      }
    }
    if (variableDefaults.default_range) {
      store.updateBounds(variableDefaults.default_range);
    }
  }
}

const updateSrc = async () => {
  const src = props.src;
  ZarrDataManager.invalidateCache();
  // Restore this dataset's formula variables (cleared by $reset / invalidateCache).
  store.loadDerivedVariables(src);
  // FIXME: Trying zarr and json-index in parallel and picking the first that
  // works. If both fail, we log the last error which is from the json-index.
  // This leads to confusing error messages if the zarr source is supposed to
  // work but fails for some reason.
  const indices = await Promise.allSettled([
    indexFromZarr(src),
    indexFromIndex(src),
  ]);
  let lastError = null;
  store.isInitializingVariable = true;
  sourceValid.value = false;
  for (const index of indices) {
    if (index.status === "fulfilled") {
      sourceValid.value = true;
      prepareDefaults(src, index.value);
      break;
    } else {
      lastError = index.reason;
    }
  }
  if (!sourceValid.value && lastError) {
    store.stopLoading();
    logError(lastError, "Failed to fetch data");
    setGridType();
  }
};

const makeSnapshot = () => {
  if (globe.value) {
    globe.value.makeSnapshot();
  }
};

const toggleRotate = () => {
  if (globe.value) {
    globe.value.toggleRotate();
  }
};

const selectGridType = (gridType: T_GRID_TYPES) => {
  const detected = detectedGridType.value;
  if (!detected) {
    return;
  }
  // If selecting the detected type, clear the param override
  paramGridType.value = gridType === detected ? undefined : gridType;
};

const toggleInfoPanel = () => {
  infoPanelOpen.value = !infoPanelOpen.value;
};

onMounted(async () => {
  // stop loading is handled in the grid components after data load
  store.startLoading();
  await updateSrc();
  isInitialized.value = true;
  await setGridType();
});
</script>

<template>
  <main>
    <Toast />
    <GlobeControls
      :key="globeControlKey"
      :model-info="modelInfo"
      :datasources="datasources"
      :current-source="props.src"
      :grid-type="detectedGridType"
      @on-snapshot="makeSnapshot"
      @on-rotate="toggleRotate"
    />

    <div v-if="loading" class="top-right-loader loader" />
    <section
      v-if="detectedGridType === GRID_TYPES.ERROR"
      class="hero is-fullheight"
      style="background: linear-gradient(135deg, #f8fafc 60%, #ffe5e5 100%)"
    >
      <div class="hero-body">
        <div class="container has-text-centered">
          <p class="title pb-4">Error</p>
          <p class="subtitle" style="color: #333">
            Sorry, we couldn't load your data. Please check the source and try
            again.
          </p>
        </div>
      </div>
    </section>
    <currentGlobeComponent
      v-else-if="detectedGridType !== undefined"
      ref="globe"
      :key="globeKey"
      :datasources="datasources"
      :is-rotated="detectedGridType === GRID_TYPES.REGULAR_ROTATED"
    />
    <TimeSeriesPanel
      v-if="detectedGridType !== undefined && detectedGridType !== GRID_TYPES.ERROR"
      :datasources="datasources"
      :model-info="modelInfo"
      :grid-type="detectedGridType"
    />
    <div class="buttons about-corner-link">
      <InfoPanel
        :datasources="datasources"
        :grid-type="detectedGridType"
        :is-open="infoPanelOpen"
        @close="infoPanelOpen = false"
        @toggle="toggleInfoPanel"
        @select-grid-type="selectGridType"
      />
      <AboutView />
    </div>
  </main>
</template>

<style lang="scss">
main {
  overflow: hidden;
}

div.top-right-loader {
  position: absolute;
  top: 10px;
  right: 10px;
  height: 40px;
  width: 40px;
  z-index: 1000;
}

.about-corner-link {
  position: absolute;
  bottom: 18px;
  right: 18px;
}
</style>
