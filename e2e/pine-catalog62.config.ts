import { defineConfig } from "@playwright/test";
import layering from "./pine-layering.config";

const port = Number(process.env.EDGELAB_PINE_CATALOG62_PORT ?? 45362);

export default defineConfig({
  ...layering,
  testMatch: "pine-catalog62.interaction.spec.ts",
  outputDir: "../.artifacts/pine-catalog62/browser/results",
  timeout: 150_000,
  use: { ...layering.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...layering.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
