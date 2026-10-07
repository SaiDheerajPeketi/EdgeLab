import { defineConfig } from "@playwright/test";
import background from "./pine-background.config";

export default defineConfig({
  ...background,
  testMatch: "pine-numeric-plots.interaction.spec.ts",
  outputDir: "../.artifacts/pine-numeric42/browser/results",
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: "tablet", use: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, hasTouch: true } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
});
