import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const outputRoot = path.resolve(
  projectRoot,
  process.env.EDGELAB_SCREEN_EXPORT_DIR ?? "artifacts/after-effects-screens",
);
const svgDir = path.join(outputRoot, "svg");
const pngDir = path.join(outputRoot, "png-reference");
const baseUrl = (process.env.EDGELAB_SCREEN_EXPORT_URL ?? "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);
const chromePath =
  process.env.CHROME_EXECUTABLE_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viewport = { width: 1440, height: 900 };
const domToSvgBundle = (
  await build({
    bundle: true,
    entryPoints: [path.join(projectRoot, "node_modules/dom-to-svg/lib/index.js")],
    format: "iife",
    globalName: "EdgeLabDomToSvg",
    minify: false,
    platform: "browser",
    write: false,
  })
).outputFiles[0].text;

const captures = [];
let captureIndex = 0;

await rm(outputRoot, { force: true, recursive: true });
await mkdir(svgDir, { recursive: true });
await mkdir(pngDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});
const context = await browser.newContext({
  colorScheme: "dark",
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  viewport,
});
const page = await context.newPage();

page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().includes("Error inlining resource") &&
    !message.text().includes("No URL passed")
  ) {
    console.error(`[page] ${message.text()}`);
  }
});

async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    let style = document.querySelector("#edgelab-screen-export-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "edgelab-screen-export-style";
      style.textContent = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          caret-color: transparent !important;
          scroll-behavior: auto !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
        }
      `;
      document.head.append(style);
    }
  });
  await page.waitForTimeout(120);
}

async function goto(relativeUrl) {
  await page.goto(`${baseUrl}${relativeUrl}`, { waitUntil: "domcontentloaded" });
  await settle();
}

async function capture(slug, options = {}) {
  const { fullPage = false, notes = "", waitMs = 0 } = options;
  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
  await settle();

  const safeSlug = slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "");
  const number = String(++captureIndex).padStart(2, "0");
  const fileStem = `${number}-${safeSlug}`;
  if (!(await page.evaluate(() => Boolean(globalThis.EdgeLabDomToSvg)))) {
    await page.addScriptTag({ content: domToSvgBundle });
  }
  const dimensions = await page.evaluate((useFullPage) => {
    const root = document.documentElement;
    return useFullPage
      ? {
          height: Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0),
          width: Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0),
          x: 0,
          y: 0,
        }
      : {
          height: window.innerHeight,
          width: window.innerWidth,
          x: window.scrollX,
          y: window.scrollY,
        };
  }, fullPage);

  const svg = await page.evaluate(
    async (captureArea) => {
      const { documentToSVG, inlineResources } = globalThis.EdgeLabDomToSvg;
      const canvasSnapshots = Array.from(document.querySelectorAll("canvas"))
        .map((canvas) => ({
          bounds: canvas.getBoundingClientRect(),
          canvas,
          source: canvas.toDataURL("image/png"),
        }))
        .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0);

      for (const snapshot of canvasSnapshots) {
        const { bounds, canvas, source } = snapshot;
        const image = document.createElement("img");
        for (const attribute of canvas.attributes) {
          if (attribute.name !== "height" && attribute.name !== "width") {
            image.setAttribute(attribute.name, attribute.value);
          }
        }
        image.alt = "";
        image.src = source;
        image.style.width = `${bounds.width}px`;
        image.style.height = `${bounds.height}px`;
        image.width = Math.round(bounds.width);
        image.height = Math.round(bounds.height);
        canvas.replaceWith(image);
        snapshot.image = image;
      }

      try {
        const svgDocument = documentToSVG(document, {
          captureArea,
          keepLinks: false,
        });
        await inlineResources(svgDocument.documentElement);
        return new XMLSerializer().serializeToString(svgDocument);
      } finally {
        for (const { canvas, image } of canvasSnapshots) {
          image?.replaceWith(canvas);
        }
      }
    },
    dimensions,
  );

  const svgPath = path.join(svgDir, `${fileStem}.svg`);
  const pngPath = path.join(pngDir, `${fileStem}.png`);
  await writeFile(svgPath, svg, "utf8");
  await page.screenshot({
    animations: "disabled",
    fullPage,
    path: pngPath,
  });

  captures.push({
    file: `${fileStem}.svg`,
    fullPage,
    height: dimensions.height,
    notes,
    pngReference: `${fileStem}.png`,
    title: await page.title(),
    url: page.url(),
    width: dimensions.width,
  });
  console.log(`Captured ${fileStem}`);
}

async function exactButton(name, options = {}) {
  const { index = 0 } = options;
  const locator = page.getByRole("button", { exact: true, name });
  const count = await locator.count();
  if (count <= index) {
    throw new Error(`Button "${name}" index ${index} not found (count: ${count})`);
  }
  return locator.nth(index);
}

async function clickAndCapture(name, slug, options = {}) {
  const button = await exactButton(name, options);
  await button.click({ force: options.force === true });
  await settle();
  await capture(slug, options);
}

async function captureMarketingScreens() {
  await goto("/");
  await capture("landing-hero");
  await capture("landing-full-page", {
    fullPage: true,
    notes: "Full public landing page at desktop width.",
  });
  await clickAndCapture("Review", "landing-demo-review");
  await clickAndCapture("Results", "landing-demo-results");
  await clickAndCapture("Replay", "landing-demo-replay");

  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await capture("landing-pricing-section");

  await goto("/privacy");
  await capture("privacy");
  await capture("privacy-full-page", { fullPage: true });

  await goto("/terms");
  await capture("terms");
  await capture("terms-full-page", { fullPage: true });

  await goto("/auth/signin");
  await capture("auth-sign-in");

  await goto("/auth/callback/google");
  await capture("auth-callback", {
    notes: "Callback screen without an OAuth code, showing the local error/return state.",
    waitMs: 250,
  });

  await goto("/this-route-does-not-exist");
  await capture("not-found");
}

async function signInLocally() {
  await goto("/auth/signin");
  const localSignIn = page.getByRole("button", {
    exact: true,
    name: "Local development sign-in",
  });
  if ((await localSignIn.count()) !== 1) {
    throw new Error(
      "Local development sign-in is unavailable. Start FastAPI with EDGELAB_DEV_AUTH_BYPASS=1.",
    );
  }
  await localSignIn.click();
  await page.waitForURL(`${baseUrl}/app`, { timeout: 15_000 });
  await settle();
}

async function captureWorkspaceScreen(buttonName, slug, options = {}) {
  const button = await exactButton(buttonName, options);
  await button.click();
  await page.waitForTimeout(180);
  if (!options.keepSidebarExpanded) {
    await page.mouse.move(viewport.width - 8, viewport.height - 8);
  }
  await settle();
  await capture(slug, options);
}

async function captureResultsChildren(prefix) {
  const children = [
    ["Overview", "overview"],
    ["Metrics", "metrics"],
    ["Day View", "day-view"],
    ["Trades", "trades"],
    ["Notes", "notes"],
  ];
  for (const [label, slug] of children) {
    await page.mouse.move(24, 96);
    await page.waitForTimeout(180);
    await captureWorkspaceScreen(label, `${prefix}-${slug}`);
  }
}

async function captureWorkspaceScreens() {
  await signInLocally();
  await capture("workspace-sessions-gateway", {
    notes: "Session gateway with repository fixture dataset available.",
  });

  await captureWorkspaceScreen("App / Global Settings", "workspace-navigation-expanded", {
    keepSidebarExpanded: true,
    notes: "Expanded desktop navigation state.",
  });
  await page.mouse.move(viewport.width - 8, viewport.height - 8);
  await settle();
  await capture("workspace-global-settings");

  const directScreens = [
    ["App / Feedback", "workspace-feedback"],
    ["Live / Live Markets", "workspace-live-markets"],
    ["Live / Position Size", "workspace-position-size"],
    ["Live / Economic Calendar", "workspace-economic-calendar"],
    ["Backtesting / Strategies", "workspace-backtest-strategies"],
    ["Backtesting / Playbooks", "workspace-backtest-playbooks"],
    ["Backtesting / Backtest Accounts", "workspace-backtest-accounts"],
    ["Backtesting / Backtest Settings", "workspace-backtest-settings"],
    ["Journal / Journal Sessions", "workspace-journal-sessions"],
    ["Journal / Journal Strategies", "workspace-journal-strategies"],
    ["Journal / Journal Playbooks", "workspace-journal-playbooks"],
    ["Journal / Journal Accounts", "workspace-journal-accounts"],
    ["Journal / Income & Expenses", "workspace-finance-tracker"],
    ["Journal / Journal Settings", "workspace-journal-settings"],
  ];

  for (const [buttonName, slug] of directScreens) {
    await captureWorkspaceScreen(buttonName, slug);
  }

  await captureWorkspaceScreen("Backtesting / Results", "workspace-backtest-results-menu", {
    keepSidebarExpanded: true,
  });
  await captureResultsChildren("workspace-backtest-results");

  await captureWorkspaceScreen("Journal / Journal Results", "workspace-journal-results-menu", {
    keepSidebarExpanded: true,
  });
  await captureResultsChildren("workspace-journal-results");

  await captureWorkspaceScreen(
    "Backtesting / Sessions",
    "workspace-sessions-gateway-return",
  );
}

async function openReplayWorkspace() {
  const resume = page.getByRole("button", { exact: true, name: "Resume Session" });
  if ((await resume.count()) === 1 && (await resume.isEnabled())) {
    await resume.click();
    await page.waitForTimeout(900);
    await settle();
    return;
  }

  const strategyName = page.getByRole("textbox", { exact: true, name: "Strategy Name" });
  if ((await strategyName.count()) !== 1) {
    throw new Error("Could not find a resumable session or the new-session form.");
  }
  await strategyName.fill("Vector Capture Strategy");
  const createSession = page.getByRole("button", { exact: true, name: "Create Session" });
  if ((await createSession.count()) !== 1 || !(await createSession.isEnabled())) {
    throw new Error(
      "Create Session is unavailable. Start the API with a valid EDGELAB_DATASETS_ROOT.",
    );
  }
  await createSession.click();
  await page.waitForTimeout(1_200);
  await settle();
}

async function captureReplayStates() {
  await openReplayWorkspace();
  await capture("replay-workspace-chart", {
    notes: "Canvas chart is retained as an embedded image; surrounding UI and icons remain vectors.",
  });

  const stateButtons = [
    ["Ticket", "replay-order-ticket"],
    ["Objects", "replay-chart-objects"],
    ["Tools", "replay-tools"],
    ["Settings", "replay-chart-settings"],
    ["Orders Tape", "replay-orders-tape"],
    ["Review", "replay-trade-review"],
    ["Results", "replay-results"],
  ];
  for (const [buttonName, slug] of stateButtons) {
    await clickAndCapture(buttonName, slug, { force: true });
  }

  await clickAndCapture("Replay speed", "replay-speed-menu", { force: true });
  await clickAndCapture("Full Screen", "replay-full-screen", {
    force: true,
    notes: "Headless Chromium uses the app's fullscreen layout fallback.",
  });

  const exitFullScreen = page.getByRole("button", { exact: true, name: "Exit" });
  if ((await exitFullScreen.count()) === 1) {
    await exitFullScreen.click();
    await settle();
  }
}

try {
  await captureMarketingScreens();
  await captureWorkspaceScreens();
  await captureReplayStates();
} finally {
  await browser.close();
}

const manifest = {
  baseUrl,
  captures,
  generatedAt: new Date().toISOString(),
  notes: [
    "SVG files use native SVG elements generated from the live Chromium DOM; no foreignObject is used.",
    "PNG files are visual references for frame-by-frame comparison in After Effects.",
    "Canvas-rendered chart pixels are embedded raster images inside otherwise editable SVGs.",
    "Desktop viewport is 1440x900 at device scale factor 1.",
  ],
  viewport,
};

await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${captures.length} screen states to ${outputRoot}`);
