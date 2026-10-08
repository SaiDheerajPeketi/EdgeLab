import { defineConfig, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { pineWorkerPlugin } from "./pineWorkerPlugin";

function sourceOfferMiddleware(server: Pick<ViteDevServer, "middlewares" | "config">, preview = false) {
  const root = preview ? path.resolve(server.config.root, server.config.build.outDir) : server.config.publicDir;
  server.middlewares.use((request, response, next) => {
    const pathname = request.url?.split("?")[0];
    if (pathname === "/source" || pathname === "/source/") {
      response.statusCode = 302;
      response.setHeader("Location", "/source/index.html");
      response.end(); return;
    }
    const match = /^\/source\/(edgelab-[a-f0-9]{16}-source\.tar\.gz)$/.exec(pathname ?? "");
    if (!match) { next(); return; }
    const filename = path.join(root, "source", match[1]);
    if (!fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile()) { response.statusCode = 404; response.end(); return; }
    // Vite's generic static server treats .gz as HTTP content encoding, which
    // makes browsers decompress the archive and invalidate its checksum/name.
    response.setHeader("Content-Type", "application/gzip");
    response.setHeader("Content-Disposition", `attachment; filename="${match[1]}"`);
    response.setHeader("Cache-Control", "no-cache");
    response.end(fs.readFileSync(filename));
  });
}

export default defineConfig({
  plugins: [react(), pineWorkerPlugin(), { name: "edgelab-source-offer", configureServer(server) { sourceOfferMiddleware(server); }, configurePreviewServer(server) { sourceOfferMiddleware(server, true); } }],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          // Keep the lazy Three bridge separate from shared marketing components.
          if (normalizedId.endsWith("/src/components/marketing/marketSceneThree.ts")) {
            return "market-3d";
          }
          if (!normalizedId.includes("/node_modules/")) {
            return undefined;
          }
          if (normalizedId.includes("/node_modules/three/")) {
            return "market-3d";
          }
          if (
            /\/node_modules\/(?:motion|framer-motion|motion-dom|motion-utils)\//.test(normalizedId)
          ) {
            return "motion-vendor";
          }
          if (normalizedId.includes("/node_modules/lucide-react/")) {
            return "icon-vendor";
          }
          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          if (normalizedId.includes("/node_modules/lightweight-charts/")) {
            return "chart-vendor";
          }
          if (normalizedId.includes("/node_modules/html-to-image/")) {
            return "chart-capture-vendor";
          }
          if (
            normalizedId.includes("/node_modules/zustand/") ||
            normalizedId.includes("/node_modules/use-sync-external-store/")
          ) {
            return "state-vendor";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
