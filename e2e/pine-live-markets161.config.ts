import { defineConfig } from "@playwright/test";
import base from "./chart-viewport151.config";

export default defineConfig({
  testDir: ".", testMatch: "pine-live-markets161.interaction.spec.ts", fullyParallel: false, workers: 1,
  timeout: 30000, retries: 0, outputDir: "../.artifacts/pine-live-markets161/browser",
  use: { ...base.use, baseURL: "http://127.0.0.1:45361", viewport: { width: 1440, height: 1000 } },
  webServer: { command: "rtk npm run preview -- --host 127.0.0.1 --port 45361 --strictPort", cwd: new URL("../frontend", import.meta.url).pathname,
    url: "http://127.0.0.1:45361", reuseExistingServer: false, timeout: 30000 },
});
