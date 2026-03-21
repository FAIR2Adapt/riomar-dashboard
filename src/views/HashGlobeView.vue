<script lang="ts" setup>
import { useEventListener } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { ref, onBeforeMount, type Ref } from "vue";

import GlobeView from "./GlobeView.vue";

import { setAuthToken } from "@/lib/data/authStore";
import { GRID_TYPES, type T_GRID_TYPES } from "@/lib/data/gridTypeDetector";
import { isROCratePID, resolveROCrate } from "@/lib/data/rocrateResolver";
import { STORE_PARAM_MAPPING, useUrlParameterStore } from "@/store/paramStore";
import { useGlobeControlStore } from "@/store/store";
import type { TURLParameterValues } from "@/utils/urlParams";

type TParams = Partial<Record<TURLParameterValues, string>>;

const DEFAULT_DATASET =
  "https://pangeo-eosc-minioapi.vm.fedcloud.eu/afouilloux-riomar/small_hp_pyramid.zarr";

const defaultSrc = ref(DEFAULT_DATASET);
const src = ref("");
const resolving = ref(true);
const ready = ref(false);
const params: Ref<TParams> = ref({});

const store = useGlobeControlStore();
const { userBoundsLow, userBoundsHigh } = storeToRefs(store);

const urlParameterStore = useUrlParameterStore();

const applyParams = (paramString: string) => {
  params.value = Object.fromEntries(new URLSearchParams(paramString));

  // Set auth token for authenticated Zarr stores (e.g. EGI DataHub)
  if (params.value.token) {
    setAuthToken(params.value.token as string);
  } else {
    setAuthToken(null);
  }

  if (
    params.value.boundlow !== undefined &&
    params.value.boundhigh !== undefined
  ) {
    userBoundsLow.value = parseFloat(params.value.boundlow);
    userBoundsHigh.value = parseFloat(params.value.boundhigh);
  }
  for (const [key, value] of Object.entries(params.value) as [
    keyof typeof STORE_PARAM_MAPPING,
    string,
  ][]) {
    if (key.startsWith("dimIndices_")) {
      urlParameterStore[STORE_PARAM_MAPPING.dimIndices][
        key.substring("dimIndices_".length)
      ] = value;
    } else if (key.startsWith("dimMinBounds_")) {
      urlParameterStore[STORE_PARAM_MAPPING.dimMinBounds][
        key.substring("dimMinBounds_".length)
      ] = value;
    } else if (key.startsWith("dimMaxBounds_")) {
      urlParameterStore[STORE_PARAM_MAPPING.dimMaxBounds][
        key.substring("dimMaxBounds_".length)
      ] = value;
    } else if (STORE_PARAM_MAPPING[key] === STORE_PARAM_MAPPING.gridtype) {
      // Simple input validation: Check if the provided gridtype is a real grid type
      if (!Object.values(GRID_TYPES).includes(value as T_GRID_TYPES)) {
        continue;
      }
    } else if (STORE_PARAM_MAPPING[key] === undefined) {
      continue;
    }
    const paramProperty = STORE_PARAM_MAPPING[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    urlParameterStore[paramProperty] = value as any;
  }
};

const onHashChange = async () => {
  console.log("[HashGlobeView] onHashChange called, hash:", location.hash, "ready:", ready.value);
  if (location.hash.length > 1) {
    urlParameterStore.$reset();
    // The hash is of the form "#resource::param1=value1::param2=value2::..."
    // We split on "::" to separate the resource from the parameters
    // and then parse the parameters and set the store values accordingly
    const [resource, ...paramArray] = location.hash.substring(1).split("::");
    const paramString = paramArray.join("&");

    applyParams(paramString);

    console.log("[HashGlobeView] resource:", resource, "isROCrate:", resource ? isROCratePID(resource) : false);
    // Check if the resource is an RO-Crate PID — if so, resolve the dataset URL
    if (resource && isROCratePID(resource)) {
      resolving.value = true;
      ready.value = false;
      try {
        const datasetUrl = await resolveROCrate(resource);
        src.value = datasetUrl || defaultSrc.value;
      } catch (e) {
        console.error("[RO-Crate] Resolution failed:", e);
        src.value = defaultSrc.value;
      } finally {
        resolving.value = false;
        ready.value = true;
      }
    } else {
      src.value = resource || defaultSrc.value;
      resolving.value = false;
      ready.value = true;
    }
  } else {
    src.value = defaultSrc.value;
    resolving.value = false;
    ready.value = true;
  }
};

useEventListener(window, "hashchange", onHashChange);

onBeforeMount(() => {
  onHashChange();
});
</script>

<template>
  <div v-if="!ready" class="ro-crate-loading">
    <span v-if="resolving">Resolving RO-Crate dataset...</span>
    <span v-else>Loading...</span>
  </div>
  <GlobeView v-else :src="src" />
</template>

<style scoped>
.ro-crate-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-size: 1.2rem;
  color: #666;
}
</style>
