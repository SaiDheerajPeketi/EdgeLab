import { defineConfig } from "@playwright/test";
import base from "./navigation191.config";
const port = 45391;
export default defineConfig({ ...base, testMatch: "chart-space192.interaction.spec.ts",
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...base.webServer, command: `rtk npm run preview -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
  outputDir: "../.artifacts/chart-space192/results", projects: base.projects!.filter(project => project.name !== "tablet") });
