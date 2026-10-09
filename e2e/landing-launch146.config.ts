import { defineConfig } from "@playwright/test";
import dimensional from "./landing-dimensional.config";
const port = 45346;
export default defineConfig({
  ...dimensional, testMatch: "landing-launch146.interaction.spec.ts",
  outputDir: "../.artifacts/landing-launch146/results", timeout: 90_000,
  use: { ...dimensional.use, baseURL: `http://127.0.0.1:${port}`, reducedMotion: "no-preference" },
  webServer: { ...dimensional.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}` },
});
