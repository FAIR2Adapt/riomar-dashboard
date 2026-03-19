# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GridLook is a WebGL-based viewer for Earth system model output that supports cloud-hosted Zarr datasets. It enables interactive, client-side visualization of climate science data (regular, HEALPix, triangular, curvilinear, Gaussian reduced, and irregular grids) on a 3D globe with multiple map projections.

**Stack**: Vue 3 (Composition API, `<script setup>`) + TypeScript + Vite + Three.js + Pinia + Zarrita

## Commands

```bash
npm run dev          # Dev server on localhost:3000
npm run build        # Type-check + production build
npm run typecheck    # Type-check only (vue-tsc --noEmit)
npm run lint         # ESLint (warnings allowed)
npm run lint-ci      # ESLint (zero warnings, used in CI)
npm run lint:fix     # ESLint auto-fix
```

## Architecture

### Layer Boundaries (enforced by eslint-plugin-boundaries)

```
views → ui, store, lib, utils
ui    → store, lib, ui, utils
store → lib, utils
lib   → assets, utils
utils → (no internal imports)
```

Violating these boundaries will cause lint errors.

### Key Directories

- **`src/lib/`** — Framework-agnostic core logic: Zarr data loading (`data/ZarrDataManager.ts`), grid type detection (`data/gridTypeDetector.ts`), dimension handling, map projections (`projection/`), GLSL shaders (`shaders/`), coastline/mask layers, camera controls
- **`src/store/`** — Pinia stores: `store.ts` (globe controls, colormap, bounds, dimensions), `paramStore.ts` (URL↔state sync via hash)
- **`src/ui/grids/`** — One Vue component per grid type (Regular, Healpix, Triangular, Curvilinear, Gaussian, Irregular, IrregularDelaunay). Shared rendering logic lives in `composables/useSharedGridLogic.ts`
- **`src/ui/overlays/`** — Control panel components (variable selector, colormap, bounds, projections, etc.)
- **`src/views/`** — Route-level views. `HashGlobeView.vue` parses URL hash; `GlobeView.vue` orchestrates grid detection and component selection

### Data Flow

1. URL hash (`#<ZARR_URI>::param=value`) parsed → Pinia store populated
2. `ZarrDataManager` fetches Zarr metadata/chunks; `gridTypeDetector` determines grid type
3. Appropriate grid component renders via Three.js with GLSL shaders (colormaps, projections)
4. Store changes sync back to URL hash (debounced) for shareable links

### Adding a New Grid Type

1. Add detection logic in `src/lib/data/gridTypeDetector.ts`
2. Create grid component in `src/ui/grids/` using `useSharedGridLogic()` composable
3. Register in `GlobeView.vue`'s grid type → component mapping

## Code Style

- Vue components must use `<script setup>` with TypeScript (`lang="ts"`)
- Block order in `.vue` files: `script`/`template` first, then `style`
- Functions should be ≤50 lines (ESLint warning)
- Imports must be alphabetically ordered with newlines between groups
- Prettier: double quotes, 2-space indent, trailing commas (ES5)
- Path alias: `@/` maps to `src/`

## CI

GitHub Actions and GitLab CI both run lint, typecheck, and build. Node 18+ required.
