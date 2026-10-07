import { defineConfig } from "@playwright/test";
import layering from "./pine-layering.config";

const port = Number(process.env.EDGELAB_PINE_BARS_PORT ?? 45353);

export default defineConfig({
  ...layering,
  testMatch: "pine-bars53.interaction.spec.ts",
  outputDir: "../.artifacts/pine-bars53/results",
  use: { ...layering.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...layering.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
