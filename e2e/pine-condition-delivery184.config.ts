import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = 45384;
export default defineConfig({
  ...catalog, testMatch: "pine-condition-delivery184.interaction.spec.ts", timeout: 120_000,
  outputDir: "../.artifacts/pine-condition-delivery184/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...catalog.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
