import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "./pine-catalog.config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 45367;

export default defineConfig({
  ...catalog,
  testMatch: "public-fallback67.interaction.spec.ts",
  timeout: 90_000,
  outputDir: "../.artifacts/public67/browser/results",
  use: { ...catalog.use, baseURL: `http://127.0.0.1:${port}`, serviceWorkers: "allow" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "tablet", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --port ${port} --strictPort`,
    cwd: path.join(root, "frontend"),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
