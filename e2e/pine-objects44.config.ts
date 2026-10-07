import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "./pine-catalog.config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EDGELAB_PINE_OBJECTS_PORT ?? 45344);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...catalog,
  testMatch: "pine-objects44.interaction.spec.ts",
  outputDir: "../.artifacts/pine-objects44/browser/results",
  use: { ...catalog.use, baseURL, serviceWorkers: "allow", actionTimeout: 10_000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "tablet", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    cwd: path.join(root, "frontend"), url: baseURL,
    reuseExistingServer: false, timeout: 30_000,
  },
});
