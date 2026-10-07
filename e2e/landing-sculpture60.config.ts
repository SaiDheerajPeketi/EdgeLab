import { defineConfig } from "@playwright/test";
import dimensional from "./landing-dimensional.config";

const port = Number(process.env.EDGELAB_LANDING_SCULPTURE_PORT ?? 45360);

export default defineConfig({
  ...dimensional,
  testMatch: "landing-sculpture60.interaction.spec.ts",
  outputDir: "../.artifacts/landing-sculpture60/results",
  timeout: 60_000,
  use: { ...dimensional.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...dimensional.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [
    { name: "mobile390", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
    { name: "tablet834", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "user1280", use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } },
    { name: "desktop1440", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
  ],
});
