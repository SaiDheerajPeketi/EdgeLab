import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport151.config";
const port = 45393;
export default defineConfig({
  ...viewport,
  testMatch: "journal-theme193.interaction.spec.ts",
  timeout: 60_000,
  outputDir: "../.artifacts/journal-theme193/results",
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  webServer: {
    ...viewport.webServer,
    command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
