import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport151.config";
const port = 45353;
export default defineConfig({
  ...viewport, testMatch: "sidebar-hover153.interaction.spec.ts", timeout: 90_000,
  outputDir: "../.artifacts/sidebar-hover153/results",
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  webServer: { ...viewport.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
