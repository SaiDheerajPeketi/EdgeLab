import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import background from "./pine-background.config";

export default defineConfig({
  ...background,
  testMatch: "pine-layering.interaction.spec.ts",
  use: { ...background.use, baseURL: "http://127.0.0.1:45350", serviceWorkers: "allow" },
  outputDir: "../.artifacts/pine-layering50/browser/results",
  timeout: 90_000,
  webServer: {
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port 45350 --strictPort`,
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../frontend"),
    url: "http://127.0.0.1:45350",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "tablet", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
