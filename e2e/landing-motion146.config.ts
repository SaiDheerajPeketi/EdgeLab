import { defineConfig } from "@playwright/test";
import dimensional from "./landing-dimensional.config";

const port = 45347;
export default defineConfig({
  ...dimensional,
  testMatch: "motion-preference.interaction.spec.ts",
  outputDir: "../.artifacts/landing-motion146legacy/results",
  retries: 0,
  timeout: 90_000,
  use: { ...dimensional.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...dimensional.webServer,
    command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
  ],
});
