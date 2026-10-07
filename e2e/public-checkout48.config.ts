import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "./pine-catalog.config";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EDGELAB_PUBLIC_CHECKOUT_PORT ?? 45348);
export default defineConfig({
  ...catalog, testMatch: "public-checkout48.interaction.spec.ts", timeout: 90_000,
  outputDir: "../.artifacts/public-checkout48/browser/results",
  expect: { ...catalog.expect, toHaveScreenshot: { scale: "css" } },
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{platform}/{projectName}/{arg}{ext}",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}`, serviceWorkers: "allow" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "tablet", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: `npm run preview -- --port ${port} --strictPort`, cwd: path.join(root, "frontend"),
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
});
