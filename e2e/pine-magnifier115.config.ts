import { defineConfig } from "@playwright/test";
import runtime from "./pine-runtime.config";

const browser = runtime.projects![0].use;
export default defineConfig({
  testDir: ".",
  testMatch: "pine-magnifier115.interaction.spec.ts",
  outputDir: "../.artifacts/pine-magnifier115/browser/results",
  reporter: "list",
  workers: 1,
  timeout: 30_000,
  use: { ...browser, serviceWorkers: "allow", trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
