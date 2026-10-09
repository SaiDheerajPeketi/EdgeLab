import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = 45377;
export default defineConfig({
  ...catalog, testMatch: "pine-chart-alerts177.interaction.spec.ts", timeout: 120_000,
  outputDir: "../.artifacts/pine-chart-alerts177/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...catalog.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
