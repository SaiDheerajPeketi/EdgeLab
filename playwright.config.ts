import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(rootDir, "frontend");
const backendDir = path.join(rootDir, "backend");
const uiPort = Number(process.env.EDGELAB_E2E_UI_PORT ?? 45173);
const apiPort = Number(process.env.EDGELAB_E2E_API_PORT ?? 48000);
const baseURL = `http://127.0.0.1:${uiPort}`;
const apiURL = `http://127.0.0.1:${apiPort}`;
const runPrefix = "edgelab-ui-regression-";
const systemTempRoot = fs.realpathSync(os.tmpdir());

function isWithinDirectory(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function resolveRunBase(override: string | undefined) {
  if (!override) return systemTempRoot;
  if (!path.isAbsolute(override)) {
    throw new Error("EDGELAB_E2E_RUN_ROOT must be an absolute, existing directory inside the system temp directory.");
  }

  let candidate: string;
  try {
    candidate = fs.realpathSync(override);
  } catch {
    throw new Error("EDGELAB_E2E_RUN_ROOT must be an absolute, existing directory inside the system temp directory.");
  }
  if (!fs.statSync(candidate).isDirectory() || !isWithinDirectory(systemTempRoot, candidate)) {
    throw new Error(`EDGELAB_E2E_RUN_ROOT must resolve inside ${systemTempRoot}.`);
  }
  return candidate;
}

const runBase = resolveRunBase(process.env.EDGELAB_E2E_RUN_ROOT);
const runRoot = fs.mkdtempSync(path.join(runBase, runPrefix));
const ownershipMarker = path.join(runRoot, ".edgelab-ui-regression-owned");
const ownershipValue = `${process.pid}\n`;
fs.writeFileSync(ownershipMarker, ownershipValue, { flag: "wx" });

process.once("exit", () => {
  try {
    const isOwnedChild = path.dirname(runRoot) === runBase
      && path.basename(runRoot).startsWith(runPrefix)
      && fs.readFileSync(ownershipMarker, "utf8") === ownershipValue;
    if (isOwnedChild) fs.rmSync(runRoot, { force: true, recursive: true });
  } catch (error) {
    console.error(`Unable to clean isolated UI regression directory ${runRoot}:`, error);
  }
});

const databasePath = path.join(runRoot, "ui-regression.db");
const datasetsRoot = path.join(runRoot, "datasets");
const localPython = path.join(backendDir, ".venv", "bin", "python");
const python = process.env.EDGELAB_E2E_PYTHON
  ?? (fs.existsSync(localPython) ? localPython : "python3");

fs.mkdirSync(datasetsRoot, { recursive: true });

const commonUse = {
  baseURL,
  colorScheme: "dark" as const,
  locale: "en-US",
  reducedMotion: "reduce" as const,
  serviceWorkers: "block" as const,
  timezoneId: "UTC",
  trace: "retain-on-failure" as const,
  screenshot: "only-on-failure" as const,
  video: "retain-on-failure" as const,
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : undefined,
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".artifacts/ui-results",
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{platform}/{projectName}/{arg}{ext}",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
      scale: "css",
      threshold: 0.18,
    },
  },
  updateSnapshots: "none",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".artifacts/ui-report" }],
  ],
  webServer: [
    {
      command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: backendDir,
      env: {
        ...process.env,
        CORS_ORIGINS: baseURL,
        DATABASE_URL: `sqlite:///${databasePath}`,
        EDGELAB_CACHE_MARKET_DATA: "0",
        EDGELAB_DATASET_AUTO_DISCOVERY_ENABLED: "0",
        EDGELAB_DATASETS_ROOT: datasetsRoot,
        EDGELAB_DEV_AUTH_BYPASS: "1",
        EDGELAB_DEPLOYMENT_MODE: "beta",
        EDGELAB_JWT_SECRET: "ui-regression-only-secret-not-for-production",
        EDGELAB_MARKET_DATA_DATABASE_URL: `sqlite:///${databasePath}`,
        EDGELAB_MARKET_DATA_IMPORT_ENABLED: "0",
        EDGELAB_OBSERVABILITY_JSON_LOGS: "0",
        EDGELAB_REDIS_URL: "",
        EDGELAB_RUN_MIGRATIONS: "1",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        GOOGLE_CLIENT_SECRETS_FILE: "",
        PYTHONPATH: backendDir,
      },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 120_000,
      url: `${apiURL}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${uiPort} --strictPort`,
      cwd: frontendDir,
      env: {
        ...process.env,
        VITE_API_BASE_URL: `${apiURL}/api`,
        VITE_BETA_SEATS_TAKEN: "137",
        VITE_BETA_SEATS_TOTAL: "500",
        VITE_DEPLOYMENT_MODE: "beta",
        VITE_E2E_STATE_FIXTURES: "1",
      },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 120_000,
      url: baseURL,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "desktop",
      use: {
        ...commonUse,
        deviceScaleFactor: 1,
        viewport: { height: 1000, width: 1440 },
      },
      testIgnore: [/performance\.spec\.ts/, /public-checkout48\.interaction\.spec\.ts/, /pine-layering\.interaction\.spec\.ts/, /pine-study-geometry51\.interaction\.spec\.ts/, /landing-continuity52\.interaction\.spec\.ts/, /pine-bars53\.interaction\.spec\.ts/, /pine-copy55\.interaction\.spec\.ts/, /pine-history56\.interaction\.spec\.ts/, /pine-live58\.interaction\.spec\.ts/, /pine-context59\.interaction\.spec\.ts/, /landing-sculpture60\.interaction\.spec\.ts/, /replay-session61\.interaction\.spec\.ts/, /pine-catalog62\.interaction\.spec\.ts/],
    },
    {
      name: "tablet",
      use: {
        ...commonUse,
        deviceScaleFactor: 1,
        hasTouch: true,
        viewport: { height: 1112, width: 834 },
      },
      testIgnore: [/performance\.spec\.ts/, /public-checkout48\.interaction\.spec\.ts/, /pine-layering\.interaction\.spec\.ts/, /pine-study-geometry51\.interaction\.spec\.ts/, /landing-continuity52\.interaction\.spec\.ts/, /pine-bars53\.interaction\.spec\.ts/, /pine-copy55\.interaction\.spec\.ts/, /pine-history56\.interaction\.spec\.ts/, /pine-live58\.interaction\.spec\.ts/, /pine-context59\.interaction\.spec\.ts/, /landing-sculpture60\.interaction\.spec\.ts/, /replay-session61\.interaction\.spec\.ts/, /pine-catalog62\.interaction\.spec\.ts/],
    },
    {
      name: "mobile",
      use: {
        ...commonUse,
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        viewport: { height: 844, width: 390 },
      },
      testIgnore: [/performance\.spec\.ts/, /public-checkout48\.interaction\.spec\.ts/, /pine-layering\.interaction\.spec\.ts/, /pine-study-geometry51\.interaction\.spec\.ts/, /landing-continuity52\.interaction\.spec\.ts/, /pine-bars53\.interaction\.spec\.ts/, /pine-copy55\.interaction\.spec\.ts/, /pine-history56\.interaction\.spec\.ts/, /pine-live58\.interaction\.spec\.ts/, /pine-context59\.interaction\.spec\.ts/, /landing-sculpture60\.interaction\.spec\.ts/, /replay-session61\.interaction\.spec\.ts/, /pine-catalog62\.interaction\.spec\.ts/],
    },
    {
      name: "tradingDesktop",
      testMatch: /(?:live-feed|live-tail|order-flow|replay)\.states\.visual\.spec\.ts|protected-workspace\.quality\.spec\.ts|compatibility-routes\.visual\.spec\.ts|compatibility-(?:journal(?:-drafts|-notes|-analytics|-dashboard|-settings)?|settings|backtest-settings|chart-settings|session-privacy)\.interaction\.spec\.ts|journal-history\.interaction\.spec\.ts|quant-recording\.interaction\.spec\.ts/,
      use: {
        ...commonUse,
        deviceScaleFactor: 1,
        viewport: { height: 1080, width: 1920 },
      },
    },
    {
      name: "low-power",
      testMatch: /(?:chart|page)-performance\.spec\.ts/,
      use: {
        ...commonUse,
        deviceScaleFactor: 1,
        screenshot: "off",
        trace: "off",
        video: "off",
        viewport: { height: 1000, width: 1440 },
      },
    },
  ],
});
