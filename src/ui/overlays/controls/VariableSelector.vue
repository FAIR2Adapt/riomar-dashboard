<script lang="ts" setup>
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";

import FormulaEditorModal from "./FormulaEditorModal.vue";

import { ZarrDataManager } from "@/lib/data/ZarrDataManager";
import type {
  TDerivedVariable,
  TModelInfo,
  TSources,
} from "@/lib/types/GlobeTypes.js";
import { useGlobeControlStore } from "@/store/store";

const model = defineModel<string>({ required: true });

const props = defineProps<{
  modelInfo: TModelInfo;
  datasources?: TSources;
  currentSource: string;
}>();

const store = useGlobeControlStore();
const { loading } = storeToRefs(store);

const variableOptions = computed(() => {
  const visibleVars = Object.keys(props.modelInfo.vars).filter((varname) => {
    const varinfo = props.modelInfo.vars[varname];
    return !varinfo.hidden;
  });
  return visibleVars;
});

// Build the dropdown label for a variable, appending its long name and units
// (when available) so this metadata lives inside the option itself.
function variableLabel(varname: string): string {
  const attrs = props.modelInfo.vars[varname]?.attrs;
  const longName = attrs?.long_name as string | undefined;
  const units = attrs?.units as string | undefined;
  const prefix = props.modelInfo.vars[varname]?.derived ? "ƒ " : "";
  let label = `${prefix}${varname}`;
  if (longName !== undefined && String(longName).trim() !== "") {
    label += ` - ${longName}`;
  }
  if (units !== undefined && String(units).trim() !== "") {
    label += ` / ${units}`;
  }
  return label;
}

// Whether the currently selected variable is a formula variable.
const selectedDerived = computed<TDerivedVariable | null>(() => {
  return props.modelInfo.vars[model.value]?.derived ?? null;
});

const editorOpen = ref(false);
const editDef = ref<TDerivedVariable | null>(null);

function openCreate() {
  editDef.value = null;
  editorOpen.value = true;
}

function openEdit() {
  editDef.value = selectedDerived.value;
  editorOpen.value = true;
}

function onSaved(name: string) {
  model.value = name;
}

function onDelete() {
  const def = selectedDerived.value;
  if (!def) {
    return;
  }
  store.removeDerivedVariable(props.currentSource, def.name);
  if (props.datasources) {
    ZarrDataManager.setDerivedVariables(
      store.derivedVariables,
      props.datasources
    );
  }
  // Fall back to the first remaining visible variable.
  const next = variableOptions.value.find((name) => name !== def.name);
  if (next) {
    model.value = next;
  }
}
</script>

<template>
  <div class="panel-block is-block">
    <div class="control">
      <div class="select is-fullwidth mb-2" :class="{ 'is-loading': loading }">
        <select v-model="model" class="form-control">
          <option
            v-for="varname in variableOptions"
            :key="varname"
            :value="varname"
          >
            {{ variableLabel(varname) }}
          </option>
        </select>
      </div>
      <div v-if="selectedDerived" class="var-info-row">
        <button
          type="button"
          class="button is-small is-light"
          title="Edit this formula"
          @click="openEdit"
        >
          <i class="fa-solid fa-pen"></i>
        </button>
        <button
          type="button"
          class="button is-small is-light"
          title="Delete this formula"
          @click="onDelete"
        >
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
      <div class="formula-actions">
        <button
          type="button"
          class="button is-small is-light"
          title="Create a formula variable"
          @click="openCreate"
        >
          <i class="fa-solid fa-plus mr-1"></i> Add formula
        </button>
      </div>
    </div>
    <FormulaEditorModal
      v-model:open="editorOpen"
      :model-info="modelInfo"
      :datasources="datasources"
      :current-source="currentSource"
      :edit-def="editDef"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.var-info-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
}

.var-info-text {
  flex: 1;
  min-width: 0;
  text-align: right;
}

.formula-actions {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.5rem;
}
</style>
