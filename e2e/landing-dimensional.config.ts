import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EDGELAB_LANDING_DIMENSIONAL_PORT ?? 45328);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync(chrome) ? chrome : undefined);

export default defineConfig({
  testDir: ".",
  testMatch: "landing-dimensional.interaction.spec.ts",
  outputDir: "../.artifacts/landing-dimensional28/results",
  reporter: "list",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
    reducedMotion: "reduce",
    colorScheme: "dark",
    serviceWorkers: "block",
    timezoneId: "UTC",
    locale: "en-US",
    video: "off",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    cwd: path.join(root, "frontend"),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
