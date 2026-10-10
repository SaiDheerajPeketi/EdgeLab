import { defineConfig } from "@playwright/test";
import catalog from "./pine-catalog.config";
const port = 45419;
export default defineConfig({
  ...catalog, testMatch: "personal-workspace219.interaction.spec.ts", outputDir: "../.artifacts/personal-workspace219/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}` }, projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } }],
  webServer: { ...catalog.webServer, command: `rtk proxy env VITE_DEPLOYMENT_MODE=personal rtk npm run dev -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, timeout: 60_000 },
});
