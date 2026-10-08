import { defineConfig } from "@playwright/test";
import fs from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: ".", testMatch: "theme-controls110.interaction.spec.ts", outputDir: "../.artifacts/theme-controls110/results",
  reporter: "list", workers: 1, retries: 0, timeout: 30_000, expect: { timeout: 10_000 },
  use: { browserName: "chromium", launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : undefined,
    colorScheme: "dark", reducedMotion: "reduce", timezoneId: "UTC", locale: "en-US", video: "off", trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
