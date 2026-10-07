import { defineConfig, firefox, webkit } from "@playwright/test";
import fs from "node:fs";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync(macChrome) ? macChrome : undefined);

export default defineConfig({
  testDir: ".",
  testMatch: "pine-runtime.interaction.spec.ts",
  outputDir: "../.artifacts/pine-runtime25/results",
  reporter: "list",
  workers: 1,
  timeout: 30_000,
  use: { trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "installed-chromium", use: { browserName: "chromium", launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined } },
    ...(fs.existsSync(firefox.executablePath()) ? [{ name: "firefox", use: { browserName: "firefox" as const } }] : []),
    ...(fs.existsSync(webkit.executablePath()) ? [{ name: "webkit", use: { browserName: "webkit" as const } }] : []),
  ],
});
