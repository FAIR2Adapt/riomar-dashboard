import { fileURLToPath, URL } from "url";

import { defineConfig } from "vitest/config";

// Standalone Vitest config (does not load the Vue/WASM Vite plugins). The data
// pipeline under test is plain TypeScript that only needs `fetch`, so it runs
// in the Node environment. Integration tests hit live Zarr endpoints, hence the
// generous timeout.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
