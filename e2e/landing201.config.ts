import { defineConfig } from "@playwright/test";
import base from "./landing-dimensional.config";

const port = 45301;
export default defineConfig({
  ...base,
  testMatch: "landing201.interaction.spec.ts",
  outputDir: "../.artifacts/landing201/results",
  timeout: 90_000,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}`, reducedMotion: "no-preference" },
  webServer: {
    ...base.webServer,
    command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
