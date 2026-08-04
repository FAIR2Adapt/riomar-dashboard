<script lang="ts" setup>
import { computed, ref, watch } from "vue";

import {
  compileExpression,
  computeResultDims,
  isValidIdentifier,
} from "@/lib/data/derivedVariables";
import { ZarrDataManager } from "@/lib/data/ZarrDataManager";
import {
  isCellName,
  isLatitudeName,
  isLongitudeName,
} from "@/lib/data/zarrUtils";
import type {
  TDerivedVariable,
  TModelInfo,
  TSources,
} from "@/lib/types/GlobeTypes";
import { useGlobeControlStore } from "@/store/store";

const props = defineProps<{
  open: boolean;
  modelInfo: TModelInfo;
  datasources?: TSources;
  currentSource: string;
  /** When set, the modal edits this formula instead of creating a new one. */
  editDef?: TDerivedVariable | null;
}>();

const emit = defineEmits<{
  "update:open": [boolean];
  saved: [string];
}>();

const store = useGlobeControlStore();

const name = ref("");
const expression = ref("");
const selectedInputs = ref<string[]>([]);
const units = ref("");
const longName = ref("");

const error = ref<string | null>(null);
const resultDimsPreview = ref<string[] | null>(null);
const validating = ref(false);

// Real (non-derived, non-coordinate) variables that can be used as operands.
const candidateVars = computed(() => {
  return Object.keys(props.modelInfo.vars).filter((varname) => {
    const v = props.modelInfo.vars[varname];
    return (
      !v.derived &&
      !v.hidden &&
      varname !== "crs" &&
      !isCellName(varname) &&
      !isLatitudeName(varname) &&
      !isLongitudeName(varname)
    );
  });
});

const isEditing = computed(() => !!props.editDef);

function reset() {
  const def = props.editDef;
  if (def) {
    name.value = def.name;
    expression.value = def.expression;
    selectedInputs.value = [...def.inputs];
    units.value = def.units ?? "";
    longName.value = def.longName ?? "";
  } else {
    name.value = "";
    expression.value = "";
    selectedInputs.value = [];
    units.value = "";
    longName.value = "";
  }
  error.value = null;
  resultDimsPreview.value = null;
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      reset();
    }
  }
);

function toggleInput(varname: string) {
  const idx = selectedInputs.value.indexOf(varname);
  if (idx === -1) {
    selectedInputs.value = [...selectedInputs.value, varname];
  } else {
    selectedInputs.value = selectedInputs.value.filter((n) => n !== varname);
  }
  resultDimsPreview.value = null;
  error.value = null;
}

function close() {
  emit("update:open", false);
}

/**
 * Validates the formula: name uniqueness, operand identifiers, dimension
 * compatibility (broadcasting), expression compilation and a sample evaluation.
 * Returns the resolved definition, or null (with `error` set) on failure.
 */
async function validate(): Promise<TDerivedVariable | null> {
  error.value = null;
  resultDimsPreview.value = null;

  const trimmedName = name.value.trim();
  if (!trimmedName) {
    error.value = "Please enter a name for the new variable.";
    return null;
  }
  const existing = props.modelInfo.vars[trimmedName];
  const clashesWithReal = existing && !existing.derived;
  const clashesWithOther =
    existing && existing.derived && trimmedName !== props.editDef?.name;
  if (clashesWithReal || clashesWithOther) {
    error.value = `A variable named "${trimmedName}" already exists.`;
    return null;
  }
  if (!expression.value.trim()) {
    error.value = "Please enter an expression.";
    return null;
  }
  const inputs = selectedInputs.value;
  if (inputs.length === 0) {
    error.value = "Select at least one input variable.";
    return null;
  }
  const badName = inputs.find((n) => !isValidIdentifier(n));
  if (badName) {
    error.value = `Input "${badName}" cannot be used in a formula (not a valid identifier).`;
    return null;
  }
  if (!props.datasources) {
    error.value = "Dataset is not ready yet.";
    return null;
  }

  try {
    const operandDims: Record<string, string[]> = {};
    for (const input of inputs) {
      operandDims[input] = await ZarrDataManager.getDimensionNames(
        props.datasources,
        input
      );
    }
    const { resultDims, referenceVar } = computeResultDims(operandDims);
    resultDimsPreview.value = resultDims;

    const compiled = compileExpression(expression.value, inputs);
    // Smoke-test the expression so syntax / unknown-name errors surface now.
    const sample = compiled(...inputs.map(() => 1));
    if (typeof sample !== "number") {
      error.value = "The expression must evaluate to a number.";
      return null;
    }

    return {
      name: trimmedName,
      expression: expression.value,
      inputs,
      referenceVar,
      resultDims,
      units: units.value.trim() || undefined,
      longName: longName.value.trim() || undefined,
    };
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return null;
  }
}

async function onSave() {
  validating.value = true;
  try {
    const def = await validate();
    if (!def) {
      return;
    }
    store.addDerivedVariable(props.currentSource, def);
    // Register immediately so a following selection change can resolve operands
    // before the grid component refetches.
    if (props.datasources) {
      ZarrDataManager.setDerivedVariables(
        store.derivedVariables,
        props.datasources
      );
    }
    emit("saved", def.name);
    close();
  } finally {
    validating.value = false;
  }
}

async function onValidateOnly() {
  validating.value = true;
  try {
    await validate();
  } finally {
    validating.value = false;
  }
}
</script>

<template>
  <div class="modal" :class="{ 'is-active': open }">
    <div class="modal-background" @click="close" />
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title">
          {{ isEditing ? "Edit formula variable" : "New formula variable" }}
        </p>
        <button
          type="button"
          class="delete"
          aria-label="close"
          @click="close"
        />
      </header>
      <section class="modal-card-body">
        <div class="field">
          <label class="label">Name</label>
          <div class="control">
            <input
              v-model="name"
              class="input"
              type="text"
              placeholder="e.g. sst_celsius"
              :disabled="isEditing"
            />
          </div>
        </div>

        <div class="field">
          <label class="label">Input variables</label>
          <p class="help mb-2">
            Tick the variables to combine. Reference them by name in the
            expression.
          </p>
          <div class="input-list">
            <label
              v-for="varname in candidateVars"
              :key="varname"
              class="input-chip"
              :class="{ selected: selectedInputs.includes(varname) }"
            >
              <input
                type="checkbox"
                :checked="selectedInputs.includes(varname)"
                @change="toggleInput(varname)"
              />
              {{ varname }}
            </label>
          </div>
        </div>

        <div class="field">
          <label class="label">Expression</label>
          <div class="control">
            <input
              v-model="expression"
              class="input is-family-monospace"
              type="text"
              placeholder="e.g. thetao - 273.15"
            />
          </div>
          <p class="help">
            JavaScript expression. Math functions are available unprefixed
            (e.g. <code>sqrt</code>, <code>abs</code>, <code>log</code>).
          </p>
        </div>

        <div class="field is-grouped">
          <div class="control is-expanded">
            <label class="label">Units (optional)</label>
            <input v-model="units" class="input" type="text" placeholder="°C" />
          </div>
          <div class="control is-expanded">
            <label class="label">Long name (optional)</label>
            <input
              v-model="longName"
              class="input"
              type="text"
              placeholder="Sea surface temperature (°C)"
            />
          </div>
        </div>

        <div v-if="resultDimsPreview" class="notification is-success is-light py-2">
          Dimensions: [{{ resultDimsPreview.join(", ") }}]
        </div>
        <div v-if="error" class="notification is-danger is-light py-2">
          {{ error }}
        </div>
      </section>
      <footer class="modal-card-foot is-justify-content-flex-end">
        <button
          type="button"
          class="button"
          :class="{ 'is-loading': validating }"
          @click="onValidateOnly"
        >
          Validate
        </button>
        <button
          type="button"
          class="button is-primary"
          :class="{ 'is-loading': validating }"
          @click="onSave"
        >
          {{ isEditing ? "Save" : "Create" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.input-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  max-height: 9rem;
  overflow-y: auto;
}

.input-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--bulma-border, #dbdbdb);
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.85rem;
  user-select: none;
}

.input-chip.selected {
  background: var(--bulma-primary, #3388ff);
  color: #fff;
  border-color: transparent;
}
</style>
