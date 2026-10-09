import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport151.config";

const port = 45383;
export default defineConfig({
  ...viewport,
  testMatch: "narrow-pane-hover183.interaction.spec.ts",
  outputDir: "../.artifacts/narrow-pane-hover183/results",
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  projects: [{ name: "mouse", use: { viewport: { width: 1000, height: 1100 } } }],
  webServer: { ...viewport.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
