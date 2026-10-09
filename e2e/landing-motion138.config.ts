import { defineConfig } from "@playwright/test";
import dimensional from "./landing-dimensional.config";

const port = Number(process.env.EDGELAB_LANDING_MOTION138_PORT ?? 45338);
export default defineConfig({
  ...dimensional,
  testMatch: "landing-motion138.interaction.spec.ts",
  outputDir: "../.artifacts/landing-motion138/results",
  timeout: 120_000,
  use: { ...dimensional.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...dimensional.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [
    { name: "desktop1440", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "phone390", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
