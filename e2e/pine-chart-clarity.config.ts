import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "./pine-catalog.config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EDGELAB_PINE_CLARITY_PORT ?? 45338);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...catalog,
  testMatch: "pine-chart-clarity.interaction.spec.ts",
  outputDir: "../.artifacts/pine-clarity38/browser/results",
  use: { ...catalog.use, baseURL },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    cwd: path.join(root, "frontend"), url: baseURL,
    reuseExistingServer: false, timeout: 30_000,
  },
});
