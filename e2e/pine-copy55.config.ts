import { defineConfig } from "@playwright/test";
import layering from "./pine-layering.config";

const port = Number(process.env.EDGELAB_PINE_COPY_PORT ?? 45355);

export default defineConfig({
  ...layering,
  testMatch: "pine-copy55.interaction.spec.ts",
  outputDir: "../.artifacts/pine-copy55/browser/results",
  use: { ...layering.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...layering.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
