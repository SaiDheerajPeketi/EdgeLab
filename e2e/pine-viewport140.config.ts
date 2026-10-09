import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = Number(process.env.EDGELAB_PINE_VIEWPORT140_PORT ?? 45340);
export default defineConfig({
  ...catalog, testMatch: "pine-viewport140.interaction.spec.ts", timeout: 120_000,
  outputDir: "../.artifacts/pine-viewport140/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...catalog.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
