import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EDGELAB_PINE_LOWER_EDITOR112_PORT ?? 45314);
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync(macChrome) ? macChrome : undefined);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "pine-lower-editor112.interaction.spec.ts",
  outputDir: "../.artifacts/pine-lower-editor112/results",
  reporter: "list",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "allow",
    timezoneId: "UTC",
    locale: "en-US",
    video: "off",
    trace: "off",
    screenshot: "off",
  },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    cwd: path.join(root, "frontend"),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
