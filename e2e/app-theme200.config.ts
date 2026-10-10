import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const port = 45300, chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({ testDir: ".", testMatch: ["app-theme200.interaction.spec.ts", "dark-palette200.interaction.spec.ts"],
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{platform}/{projectName}/{arg}{ext}",
  outputDir: "../.artifacts/app-theme200/results", reporter: [["list"], ["json", { outputFile: path.resolve(".artifacts/app-theme200/report.json") }]], workers: 1, retries: 0, timeout: 90_000,
  expect: { timeout: 10_000 }, use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium",
    launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : undefined, reducedMotion: "reduce",
    serviceWorkers: "block", timezoneId: "UTC", colorScheme: "light", screenshot: "only-on-failure" },
  webServer: { command: `rtk npm run preview -- --port ${port} --strictPort`, cwd: path.resolve("frontend"),
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }]
});
