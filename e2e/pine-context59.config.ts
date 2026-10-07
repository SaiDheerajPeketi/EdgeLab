import { defineConfig } from "@playwright/test";
import layering from "./pine-layering.config";

const port = Number(process.env.EDGELAB_PINE_CONTEXT_PORT ?? 45359);

export default defineConfig({
  ...layering,
  testMatch: "pine-context59.interaction.spec.ts",
  outputDir: "../.artifacts/pine-context59/browser/results",
  timeout: 150_000,
  use: { ...layering.use, baseURL: `http://127.0.0.1:${port}`, video: "off" },
  webServer: {
    ...layering.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
