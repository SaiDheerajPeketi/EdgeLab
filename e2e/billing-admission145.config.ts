import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: ".", testMatch: "billing-admission145.interaction.spec.ts",
  outputDir: "../.artifacts/billing-admission145/results", reporter: "list", workers: 1,
  retries: 0, timeout: 60_000, expect: { timeout: 10_000 },
  use: { baseURL: "http://127.0.0.1:45345", browserName: "chromium",
    launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : undefined,
    reducedMotion: "reduce", serviceWorkers: "block", screenshot: "only-on-failure" },
  webServer: { command: "rtk env PYTHONPATH=backend backend/.venv/bin/python e2e/billing-admission145.fixture.py",
    cwd: path.resolve("."), url: "http://127.0.0.1:45345/api/health", reuseExistingServer: false, timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 } },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
