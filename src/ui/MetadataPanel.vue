<script lang="ts" setup>
import { ref } from "vue";

import type { ROCrateMetadata } from "@/lib/data/rocrateResolver";

defineProps<{
  metadata: ROCrateMetadata;
}>();

const isOpen = ref(true);
</script>

<template>
  <div class="metadata-panel" :class="{ open: isOpen }">
    <button
      type="button"
      class="toggle-btn"
      :title="isOpen ? 'Hide metadata' : 'Show metadata'"
      @click="isOpen = !isOpen"
    >
      <span v-if="isOpen">&times;</span>
      <span v-else>&#9432;</span>
    </button>

    <div v-if="isOpen" class="panel-content">
      <h2 class="panel-title">{{ metadata.title }}</h2>

      <div v-if="metadata.pid" class="section">
        <a
          :href="metadata.pid"
          target="_blank"
          rel="noopener noreferrer"
          class="pid-link"
        >
          {{ metadata.pid }}
        </a>
      </div>

      <!-- Variables with I-ADOPT -->
      <div v-if="metadata.variables.length > 0" class="section">
        <h3>Variables (I-ADOPT)</h3>
        <div
          v-for="(v, i) in metadata.variables"
          :key="i"
          class="variable-card"
        >
          <div class="var-header">{{ v.name }}</div>
          <div v-if="v.property || v.objectOfInterest" class="iadopt-diagram">
            <div v-if="v.property" class="iadopt-box property">
              <div class="iadopt-label">hasProperty</div>
              <div class="iadopt-value">
                <a
                  v-if="v.propertyURI"
                  :href="v.propertyURI"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ v.property }}</a
                >
                <span v-else>{{ v.property }}</span>
              </div>
            </div>
            <div v-if="v.objectOfInterest" class="iadopt-box entity">
              <div class="iadopt-label">hasObjectOfInterest</div>
              <div class="iadopt-value">
                <a
                  v-if="v.objectOfInterestURI"
                  :href="v.objectOfInterestURI"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ v.objectOfInterest }}</a
                >
                <span v-else>{{ v.objectOfInterest }}</span>
              </div>
            </div>
            <div v-if="v.matrix" class="iadopt-box matrix">
              <div class="iadopt-label">hasMatrix</div>
              <div class="iadopt-value">{{ v.matrix }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Coverage -->
      <div
        v-if="
          metadata.temporalCoverage ||
          metadata.spatialCoverage ||
          metadata.spatialResolution
        "
        class="section"
      >
        <h3>Coverage</h3>
        <div v-if="metadata.spatialCoverage" class="meta-row">
          <span class="meta-label">Spatial</span>
          <span>{{ metadata.spatialCoverage }}</span>
        </div>
        <div v-if="metadata.temporalCoverage" class="meta-row">
          <span class="meta-label">Temporal</span>
          <span>{{ metadata.temporalCoverage }}</span>
        </div>
        <div v-if="metadata.spatialResolution" class="meta-row">
          <span class="meta-label">Resolution</span>
          <span>{{ metadata.spatialResolution }}</span>
        </div>
      </div>

      <!-- Claims -->
      <div v-if="metadata.claims.length > 0" class="section">
        <h3>Claims</h3>
        <div v-for="(c, i) in metadata.claims" :key="i" class="claim">
          <p>{{ c.text }}</p>
          <a
            v-if="c.nanopubURI"
            :href="c.nanopubURI"
            target="_blank"
            rel="noopener noreferrer"
            class="nanopub-link"
            >nanopub</a
          >
        </div>
      </div>

      <!-- License -->
      <div v-if="metadata.license" class="section">
        <h3>License</h3>
        <a :href="metadata.license" target="_blank" rel="noopener noreferrer">{{
          metadata.license.includes("creativecommons")
            ? "CC-BY 4.0"
            : metadata.license
        }}</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metadata-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  z-index: 1000;
  display: flex;
  flex-direction: row-reverse;
  pointer-events: none;
}

.metadata-panel > * {
  pointer-events: auto;
}

.toggle-btn {
  position: relative;
  top: 10px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 6px 0 0 6px;
  background: rgba(30, 30, 30, 0.9);
  color: white;
  font-size: 1.3rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: flex-start;
}

.toggle-btn:hover {
  background: rgba(60, 60, 60, 0.95);
}

.panel-content {
  width: 450px;
  max-width: 90vw;
  height: 100vh;
  overflow-y: auto;
  background: rgba(20, 20, 20, 0.92);
  color: #e0e0e0;
  padding: 1.2rem;
  font-size: 0.95rem;
  backdrop-filter: blur(10px);
}

.panel-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  color: white;
  line-height: 1.3;
}

.pid-link {
  font-size: 0.8rem;
  color: #7cb3ff;
  word-break: break-all;
}

.section {
  margin-top: 1.2rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

h3 {
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #999;
  margin-bottom: 0.6rem;
}

.variable-card {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 0.7rem 0.8rem;
  margin-bottom: 0.6rem;
}

.var-header {
  font-weight: 700;
  font-size: 1rem;
  color: white;
  margin-bottom: 0.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.iadopt-diagram {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.iadopt-box {
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  border: 1px solid;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.iadopt-box.property {
  background: rgba(156, 120, 200, 0.2);
  border-color: rgba(156, 120, 200, 0.5);
}

.iadopt-box.entity {
  background: rgba(100, 160, 220, 0.2);
  border-color: rgba(100, 160, 220, 0.5);
}

.iadopt-box.matrix {
  background: rgba(255, 193, 7, 0.15);
  border-color: rgba(255, 193, 7, 0.4);
}

.iadopt-label {
  font-size: 0.75rem;
  font-family: monospace;
  opacity: 0.8;
  flex-shrink: 0;
  min-width: 140px;
}

.iadopt-box.property .iadopt-label {
  color: #c9a0dc;
}

.iadopt-box.entity .iadopt-label {
  color: #7cb8e8;
}

.iadopt-box.matrix .iadopt-label {
  color: #ffd54f;
}

.iadopt-value {
  font-weight: 600;
  font-size: 0.95rem;
  color: white;
}

.iadopt-value a {
  color: inherit;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.iadopt-value a:hover {
  text-decoration-style: solid;
}

.iadopt-label {
  flex-shrink: 0;
  min-width: 140px;
}

.meta-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
  font-size: 0.95rem;
}

.meta-label {
  color: #999;
  min-width: 80px;
  flex-shrink: 0;
}

.claim {
  background: rgba(255, 255, 255, 0.03);
  border-left: 3px solid rgba(74, 144, 217, 0.5);
  padding: 0.5rem 0.7rem;
  margin-bottom: 0.6rem;
  font-size: 0.9rem;
  line-height: 1.45;
}

.claim p {
  margin: 0;
}

.nanopub-link {
  display: inline-block;
  margin-top: 0.3rem;
  font-size: 0.8rem;
  color: #7cb3ff;
  text-decoration: none;
}

.nanopub-link:hover {
  text-decoration: underline;
}
</style>
