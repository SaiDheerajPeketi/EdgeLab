import { defineConfig } from "@playwright/test";
import base from "./navigation191.config";

const port = 45395;

export default defineConfig({
  ...base,
  testMatch: "keyboard195.interaction.spec.ts",
  outputDir: "../.artifacts/keyboard195/results",
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...base.webServer,
    command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
  projects: base.projects!.filter(project => project.name !== "tablet"),
});
