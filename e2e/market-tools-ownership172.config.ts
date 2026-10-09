import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport151.config";
const port = 45372;
export default defineConfig({
  ...viewport, testMatch: "market-tools-ownership172.interaction.spec.ts", timeout: 90_000,
  outputDir: "../.artifacts/market-tools-ownership172/results",
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  webServer: { ...viewport.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
