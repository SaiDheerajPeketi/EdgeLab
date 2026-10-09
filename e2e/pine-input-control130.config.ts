import { defineConfig } from "@playwright/test";
import fs from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: ".", testMatch: "pine-input-control130.interaction.spec.ts", outputDir: "../.artifacts/pine-input-control130-results", reporter: "list", workers: 1, timeout: 30000,
  use: { screenshot: "only-on-failure", launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : undefined },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
