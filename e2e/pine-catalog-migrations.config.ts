import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "./pine-catalog.config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.EDGELAB_PINE_MIGRATIONS_PORT ?? 45337);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...catalog,
  testMatch: "pine-catalog-migrations.interaction.spec.ts",
  outputDir: "../.artifacts/catalog37/browser/results",
  use: { ...catalog.use, baseURL },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    cwd: path.join(root, "frontend"), url: baseURL,
    reuseExistingServer: false, timeout: 30_000,
  },
});
