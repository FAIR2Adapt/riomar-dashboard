import { fileURLToPath, URL } from "url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()],
  build: {
    sourcemap: true,
    target: "es2022",
  },
  server: {
    proxy: {
      // Proxy /datahub/ requests to EGI DataHub Oneprovider.
      // This avoids CORS preflight issues with the X-Auth-Token header.
      // Usage: set the Zarr URL to http://localhost:5173/datahub/data/<file_id>
      "/datahub": {
        target:
          "https://cesnet-oneprovider-01.datahub.egi.eu/api/v3/oneprovider",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/datahub/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const token = process.env.DATAHUB_TOKEN;
            if (token) {
              proxyReq.setHeader("X-Auth-Token", token);
            }
          });
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
  base: "./",
});
