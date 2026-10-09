import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = Number(process.env.EDGELAB_PINE_INPUT_FOCUS137_PORT ?? 45337);
export default defineConfig({
  testDir: ".", testMatch: "pine-input-focus137.interaction.spec.ts", workers: 1, retries: 0,
  outputDir: "../.artifacts/pine-input-focus137/results", reporter: "list",
  timeout: 90_000, expect: { timeout: 12_000 },
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync(chrome) ? chrome : undefined) },
    colorScheme: "dark", reducedMotion: "reduce", timezoneId: "UTC", locale: "en-US", screenshot: "only-on-failure" },
  webServer: { command: `rtk npm run preview -- --port ${port} --strictPort`, cwd: path.resolve("frontend"),
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
