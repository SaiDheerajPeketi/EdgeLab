import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";

const port = Number(process.env.EDGELAB_AUTH_CALLBACK141_PORT ?? 45341);
export default defineConfig({
  ...catalog,
  testMatch: "auth-callback141.interaction.spec.ts",
  outputDir: "../.artifacts/auth-callback141/results",
  timeout: 90_000,
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...catalog.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
