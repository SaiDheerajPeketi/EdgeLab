import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EDGELAB_CHART_NOTICES135_PORT ?? 45335);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync(chrome) ? chrome : undefined);
export default defineConfig({
  testDir: ".", testMatch: "chart-notices135.interaction.spec.ts", workers: 1,
  outputDir: "../.artifacts/chart-notices135/results", reporter: "list", retries: 0,
  timeout: 90_000, expect: { timeout: 12_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", launchOptions: executablePath ? { executablePath } : undefined,
    reducedMotion: "reduce", colorScheme: "dark", timezoneId: "UTC", locale: "en-US", screenshot: "only-on-failure" },
  webServer: { command: `rtk npm run preview -- --port ${port} --strictPort`, cwd: path.join(root, "frontend"),
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
