import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = 45366;
export default defineConfig({
  ...catalog, testMatch: "account-access166.spec.ts",
  outputDir: "../.artifacts/account-access166/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...catalog.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
