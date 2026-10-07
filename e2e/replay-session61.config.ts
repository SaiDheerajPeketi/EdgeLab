import { defineConfig } from "@playwright/test";
import layering from "./pine-layering.config";

const port = Number(process.env.EDGELAB_REPLAY_SESSION_PORT ?? 45361);

export default defineConfig({
  ...layering,
  testMatch: "replay-session61.interaction.spec.ts",
  outputDir: "../.artifacts/replay-session61/browser/results",
  timeout: 90_000,
  use: { ...layering.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...layering.webServer,
    command: `${process.env.CI ? "" : "rtk "}npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
