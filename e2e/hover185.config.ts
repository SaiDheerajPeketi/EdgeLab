import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport151.config";
const port = 45385;
export default defineConfig({
  ...viewport, testMatch: "hover185.interaction.spec.ts", timeout: 45_000,
  outputDir: "../.artifacts/hover185/results", expect: { timeout: 5_000 },
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  projects: [{ name: "hybrid-desktop", use: { viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: false } }],
  webServer: { ...viewport.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
