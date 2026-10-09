import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";

const port = Number(process.env.EDGELAB_BILLING_RECOVERY139_PORT ?? 45339);
export default defineConfig({
  ...catalog,
  testMatch: "billing-recovery139.interaction.spec.ts",
  outputDir: "../.artifacts/billing-recovery139/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...catalog.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
