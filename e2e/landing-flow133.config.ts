import { defineConfig } from "@playwright/test";
import dimensional from "./landing-dimensional.config";

const port = Number(process.env.EDGELAB_LANDING_FLOW_PORT ?? 45335);
export default defineConfig({
  ...dimensional,
  testMatch: "landing-flow133.interaction.spec.ts",
  outputDir: "../.artifacts/landing-flow133/results",
  timeout: 90_000,
  use: { ...dimensional.use, baseURL: `http://127.0.0.1:${port}`, reducedMotion: "no-preference" },
  webServer: { ...dimensional.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [
    { name: "desktop1440", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "phone390", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
