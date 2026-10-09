import { defineConfig } from "@playwright/test";
import base from "./chart-viewport151.config";
const port = 45360;
export default defineConfig({
  ...base, testMatch: "pine-market160.interaction.spec.ts", timeout: 90_000,
  outputDir: "../.artifacts/pine-market160/results",
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...base.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
