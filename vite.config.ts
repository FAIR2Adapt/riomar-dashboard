import { createReadStream, statSync } from "fs";
import { join, normalize } from "path";
import { fileURLToPath, URL } from "url";

import vue from "@vitejs/plugin-vue";
import { defineConfig, type PluginOption } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// Dev-only: serve raw files from a local directory under /local/ (same-origin,
// so no CORS). Used to view locally-downloaded Zarr stores that live outside
// the project root. Usage: set the Zarr URL to
// http://localhost:3000/local/<path>.zarr/
function serveLocalData(baseDir: string): PluginOption {
  return {
    name: "serve-local-data",
    configureServer(server) {
      // Every request here is ours, so a missing file must return a real 404 —
      // NOT next() (which hits Vite's SPA fallback and returns index.html with
      // status 200, breaking Zarr readers that probe for optional files/chunks).
      const notFound = (res: import("http").ServerResponse) => {
        res.statusCode = 404;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end("Not found");
      };
      server.middlewares.use("/local", (req, res) => {
        try {
          const urlPath = decodeURIComponent((req.url || "").split("?")[0]);
          const filePath = normalize(join(baseDir, urlPath));
          if (!filePath.startsWith(baseDir) || !statSync(filePath).isFile()) {
            notFound(res);
            return;
          }
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader(
            "Content-Type",
            filePath.endsWith(".json")
              ? "application/json"
              : "application/octet-stream"
          );
          createReadStream(filePath).pipe(res);
        } catch {
          notFound(res);
        }
      });
    },
  };
}

const localDataDir = fileURLToPath(new URL("../", import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait(), serveLocalData(localDataDir)],
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
