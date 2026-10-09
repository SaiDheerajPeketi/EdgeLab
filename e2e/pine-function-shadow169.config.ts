import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = 45369;
export default defineConfig({
  ...catalog, testMatch: "pine-function-shadow169.interaction.spec.ts", timeout: 120_000,
  outputDir: "../.artifacts/pine-function-shadow169/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...catalog.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
