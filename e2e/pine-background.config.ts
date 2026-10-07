import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync(macChrome) ? macChrome : undefined);

export default defineConfig({
  testDir: ".",
  testMatch: "pine-background.interaction.spec.ts",
  outputDir: "../.artifacts/pine-background39/browser/results",
  reporter: "list",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    timezoneId: "UTC",
    locale: "en-US",
    video: "off",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "tablet", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
