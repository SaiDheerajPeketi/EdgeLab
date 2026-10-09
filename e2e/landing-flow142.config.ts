import { defineConfig } from "@playwright/test";
import dimensional from "./landing-dimensional.config";

const port = Number(process.env.EDGELAB_LANDING_FLOW142_PORT ?? 45342);
export default defineConfig({
  ...dimensional,
  testMatch: "landing-flow142.interaction.spec.ts",
  outputDir: "../.artifacts/landing-flow142/results",
  timeout: 180_000,
  use: { ...dimensional.use, baseURL: `http://127.0.0.1:${port}`, reducedMotion: "no-preference" },
  webServer: { ...dimensional.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
