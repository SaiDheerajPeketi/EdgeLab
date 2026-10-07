import { defineConfig } from "@playwright/test";
import layering from "./pine-layering.config";

const port = Number(process.env.EDGELAB_PINE_LIVE_PORT ?? 45358);
export default defineConfig({
  ...layering,
  testMatch: "pine-live58.interaction.spec.ts",
  outputDir: "../.artifacts/pine-live58/browser/results",
  timeout: 90_000,
  use: { ...layering.use, baseURL: `http://127.0.0.1:${port}`, video: "off" },
  webServer: {
    ...layering.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
