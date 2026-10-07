import { defineConfig } from "@playwright/test";
import layering from "./pine-layering.config";

export default defineConfig({
  ...layering,
  testMatch: "pine-study-geometry51.interaction.spec.ts",
  outputDir: "../.artifacts/pine-study-geometry51/results",
  timeout: 150_000,
  use: { ...layering.use, baseURL: "http://127.0.0.1:45351" },
  webServer: {
    ...layering.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port 45351 --strictPort`,
    url: "http://127.0.0.1:45351",
  },
  projects: [
    { name: "phone390", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
    { name: "phone320", use: { viewport: { width: 320, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
    { name: "tablet834", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "desktop1440", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
  ],
});
