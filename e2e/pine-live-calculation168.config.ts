import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = 45368;
export default defineConfig({
  ...catalog, testMatch: "pine-live-calculation168.spec.ts", timeout: 120_000,
  outputDir: "../.artifacts/pine-live-calculation168/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...catalog.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
