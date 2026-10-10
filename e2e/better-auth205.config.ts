import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";

const port = Number(process.env.EDGELAB_BETTER_AUTH205_PORT ?? 45302);
export default defineConfig({
  ...catalog,
  testMatch: "better-auth205.interaction.spec.ts",
  outputDir: "../.artifacts/better-auth205/results",
  timeout: 60_000,
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...catalog.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
