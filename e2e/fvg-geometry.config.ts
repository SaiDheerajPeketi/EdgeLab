import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const port = 45307, chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: ".", testMatch: "fvg-geometry.interaction.spec.ts",
  outputDir: "../.artifacts/fvg-geometry/results", workers: 1, retries: 0,
  reporter: [["list"], ["json", { outputFile: ".artifacts/fvg-geometry/report.json" }]],
  timeout: 120_000, expect: { timeout: 10_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium",
    launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : undefined,
    reducedMotion: "reduce", timezoneId: "UTC",
    screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: `rtk npm run preview -- --port ${port} --strictPort`, cwd: path.resolve("frontend"),
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
});
