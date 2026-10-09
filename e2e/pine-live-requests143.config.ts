import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = Number(process.env.EDGELAB_PINE_LIVE_REQUEST143_PORT ?? 45343);
export default defineConfig({
  ...catalog, testMatch: "pine-live-requests143.interaction.spec.ts", timeout: 120_000,
  outputDir: "../.artifacts/pine-live-requests143/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...catalog.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
