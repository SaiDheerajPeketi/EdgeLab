import { defineConfig } from "@playwright/test";
import viewport from "./chart-viewport128.config";
const port = 45354;
export default defineConfig({ ...viewport, testMatch: "native-history154.interaction.spec.ts", timeout: 90_000,
  outputDir: "../.artifacts/native-history154/results",
  projects: viewport.projects!.filter(project => ["desktop", "mobile"].includes(project.name!)),
  use: { ...viewport.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  webServer: { ...viewport.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
