import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport128.config";
const port = 45356;
export default defineConfig({
  ...viewport, testMatch: "multi-symbol156.interaction.spec.ts", timeout: 90_000,
  outputDir: "../.artifacts/binance-panes156/results",
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  projects: viewport.projects!.filter(project => ["desktop", "mobile"].includes(project.name!)),
  webServer: { ...viewport.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
