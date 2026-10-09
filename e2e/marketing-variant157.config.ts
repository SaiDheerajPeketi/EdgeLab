import { defineConfig } from "@playwright/test";
import landing from "./landing-dimensional.config";
const port = 45357;
export default defineConfig({
  ...landing, testMatch: "marketing-variant157.interaction.spec.ts", timeout: 60_000,
  outputDir: "../.artifacts/marketing-variant157/results",
  use: { ...landing.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { ...landing.webServer, command: `rtk npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}` },
});
