import { defineConfig } from "@playwright/test";
import dimensional from "./landing-dimensional.config";

const port = Number(process.env.EDGELAB_LANDING_CONTINUITY_PORT ?? 45352);

export default defineConfig({
  ...dimensional,
  testMatch: "landing-continuity52.interaction.spec.ts",
  outputDir: "../.artifacts/landing-continuity52/results",
  timeout: 90_000,
  use: {
    ...dimensional.use,
    baseURL: `http://127.0.0.1:${port}`,
    reducedMotion: "no-preference",
  },
  webServer: {
    ...dimensional.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [
    { name: "phone320", use: { viewport: { width: 320, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
    { name: "phone390", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
    { name: "tablet834", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "desktop1440", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
  ],
});
