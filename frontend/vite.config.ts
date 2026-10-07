import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { pineWorkerPlugin } from "./pineWorkerPlugin";

export default defineConfig({
  plugins: [react(), pineWorkerPlugin()],
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
