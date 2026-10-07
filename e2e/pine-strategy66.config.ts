import { defineConfig } from "@playwright/test";
import runtime from "./pine-runtime.config";

const browser = runtime.projects![0].use;
export default defineConfig({
  testDir: ".",
  testMatch: "pine-strategy66.interaction.spec.ts",
  outputDir: "../.artifacts/pine-strategy66/browser/results",
  reporter: "list",
  workers: 1,
  timeout: 30_000,
  use: { ...browser, serviceWorkers: "allow", trace: "off", screenshot: "only-on-failure", video: "off" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
