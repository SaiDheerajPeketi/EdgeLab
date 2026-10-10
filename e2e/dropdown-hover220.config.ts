import { defineConfig } from "@playwright/test";
import base from "./chart-viewport128.config";
const port = 45320;
export default defineConfig({
  ...base,
  testMatch: "dropdown-hover220.interaction.spec.ts",
  outputDir: "../.artifacts/dropdown-hover220/results",
  timeout: 60_000,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    ...["dark", "light"].map(name => ({ name, grepInvert: /mobile touch/, use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } })),
    ...["mobile-dark", "mobile-light"].map(name => ({ name, grep: /mobile touch/, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } })),
  ],
  webServer: {
    ...base.webServer,
    command: `rtk npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    env: { VITE_API_BASE_URL: "/api", VITE_DEPLOYMENT_MODE: "beta", VITE_E2E_STATE_FIXTURES: "0" },
  },
});
