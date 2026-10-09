import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport128.config";
const port = 45355;
export default defineConfig({
  ...viewport, testMatch: "custom-history155.interaction.spec.ts", timeout: 90_000,
  outputDir: "../.artifacts/custom-history155/results",
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  projects: viewport.projects!.filter(project => ["desktop", "mobile"].includes(project.name!)),
  webServer: { ...viewport.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
