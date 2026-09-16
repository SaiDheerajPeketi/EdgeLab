import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

const route = "/app/quant";
const frozenTime = "2026-09-15T10:00:00.000Z";
const offlineModel = {
  available: true,
  availability_reason: "Deterministic offline fixture for reproducible workspace checks.",
  display_name: "Deterministic offline research",
  input_token_cost_micros: 0,
  model_id: "offline-research-v1",
  operations: ["CHART_ANALYSIS", "GENERATE_INDICATOR", "ANALYSIS_TO_INDICATOR"],
  output_token_cost_micros: 0,
  provider: "offline-ai-fixture",
};

test.describe("quant assistant state baselines", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
  });

  test("unavailable provider stays truthful and local", async ({ page }) => {
    await mockModels(page, []);
    const panel = await openQuant(page);

    const providerStatus = panel.getByRole("status", { name: "Quant provider status" });
    await expect(providerStatus).toHaveAttribute("data-quant-state", "unavailable");
    await expect(providerStatus).toContainText("no AI output is fabricated");
    await expect(panel.getByText(/send chart context and prior conversation/i)).toHaveCount(0);
    await expect(panel.getByRole("button", { exact: true, name: "Send" })).toBeDisabled();
    await revealAndExpectQuantGeometry(page, providerStatus);
    await expectStateScreenshot(page, "quant-unavailable");
  });

  test("empty offline workspace explains permissions without fabricating output", async ({ page }) => {
    await mockModels(page, [offlineModel]);
    const panel = await openQuant(page);

    const empty = panel.getByRole("status", { name: "Quant conversation empty state" });
    await expect(empty).toHaveAttribute("data-quant-state", "empty");
    await expect(panel.getByLabel("Quant model")).toHaveValue(offlineModel.model_id);
    await expect(panel.getByText(/Offline deterministic scaffold · no model inference/i)).toBeVisible();
    await expect(panel.getByText(/send chart context and prior conversation/i)).toHaveCount(0);
    await revealAndExpectQuantGeometry(page, empty);
    await expectStateScreenshot(page, "quant-empty");
  });

  test("streaming response is announced and cancellable", async ({ page }) => {
    await mockModels(page, [offlineModel]);
    const flow = await mockRunningGeneration(page);
    const panel = await openQuant(page);
    await submitPrompt(panel, "Summarize the visible BTC structure.");

    const status = panel.getByRole("status", { name: "Quant request status" });
    await expect(status).toHaveAttribute("data-quant-state", "running");
    await expect(status).toContainText("Generating");
    await expect(status).toContainText("Reading visible bars and validating context.");
    await expect(status.getByRole("button", { name: "Cancel" })).toBeVisible();
    await revealAndExpectQuantGeometry(page, status);
    await expectStateScreenshot(page, "quant-streaming");

    await status.getByRole("button", { name: "Cancel" }).click();
    flow.releaseRun();
    await expect(status).toHaveAttribute("data-quant-state", "cancelled");
  });

  test("cancelled request retains an honest recovery path", async ({ page }) => {
    await mockModels(page, [offlineModel]);
    const flow = await mockRunningGeneration(page);
    const panel = await openQuant(page);
    await submitPrompt(panel, "Check the current range for invalidation.");

    const status = panel.getByRole("status", { name: "Quant request status" });
    await status.getByRole("button", { name: "Cancel" }).click();
    await expect(status).toHaveAttribute("data-quant-state", "cancelled");
    await expect(status).toContainText("No new assistant response was saved.");
    await expect(status.getByRole("button", { name: "Retry request" })).toBeVisible();
    await revealAndExpectQuantGeometry(page, status);
    await expectStateScreenshot(page, "quant-cancelled");

    flow.releaseRun();
  });

  test("provider error names the failure and offers retry", async ({ page }) => {
    await mockModels(page, [offlineModel]);
    await mockFailedGeneration(page);
    const panel = await openQuant(page);
    await submitPrompt(panel, "Explain why momentum weakened.");

    const error = panel.getByRole("alert");
    const status = panel.getByRole("status", { name: "Quant request status" });
    await expect(status).toHaveAttribute("data-quant-state", "failed");
    await expect(error).toContainText("timed out before producing output");
    await expect(error.getByRole("button", { name: "Retry request" })).toBeVisible();
    await revealAndExpectQuantGeometry(page, error);
    await expectStateScreenshot(page, "quant-error");
  });

  test("retrying preserves the prior request without a duplicate user message", async ({ page }) => {
    await mockModels(page, [offlineModel]);
    const flow = await mockRetryingGeneration(page);
    const panel = await openQuant(page);
    const prompt = "Explain why momentum weakened.";
    await submitPrompt(panel, prompt);

    const error = panel.getByRole("alert");
    await expect(error).toContainText("timed out before producing output");
    await error.getByRole("button", { name: "Retry request" }).click();
    const status = panel.getByRole("status", { name: "Quant request status" });
    await expect(status).toHaveAttribute("data-quant-state", "retrying");
    await expect(status).toContainText("Reconnecting to the configured provider");
    await expect(panel.getByRole("article", { name: "User message" }).filter({ hasText: prompt })).toHaveCount(1);
    await revealAndExpectQuantGeometry(page, status);
    await expectStateScreenshot(page, "quant-retrying");

    flow.releaseRetry();
    await expect(status).toHaveAttribute("data-quant-state", "cancelled");
  });

  test("retained indicator artifact exposes provenance and explicit actions", async ({ page }) => {
    await mockModels(page, [offlineModel]);
    await mockWorkspace(page, artifactWorkspace);
    const panel = await openQuant(page);
    await panel.getByRole("tab", { name: "Build & backtest" }).click();

    const artifact = panel.getByRole("article", { name: "Quant message with generated indicator" });
    await expect(artifact).toContainText("Deterministic range score");
    await expect(artifact).toContainText("not model confidence");
    await expect(artifact.getByRole("button", { name: "Open source" })).toBeVisible();
    await expect(artifact.getByRole("button", { name: "Add to chart" })).toBeVisible();
    await revealAndExpectQuantGeometry(page, artifact);
    await expectStateScreenshot(page, "quant-artifact");
  });
});

async function openQuant(page: Page) {
  await gotoStable(page, route, { waitForNetworkIdle: false });
  const panel = page.getByRole("complementary", { name: "Quant assistant" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Quant" })).toBeVisible();
  await expect(panel.locator('[data-quant-state="provider-loading"]')).toHaveCount(0);
  await expect(page.getByText("Opening workspace", { exact: true })).toHaveCount(0);
  await expect(page.locator(".chart-stage")).toHaveCount(1);
  return panel;
}

async function submitPrompt(panel: Locator, prompt: string) {
  await panel.getByLabel("Message Quant").fill(prompt);
  await panel.getByRole("button", { exact: true, name: "Send" }).click();
}

async function mockModels(page: Page, models: unknown[]) {
  await page.route("**/api/quant/models", (request) => fulfillJson(request, models));
}

async function mockWorkspace(page: Page, value: unknown) {
  await page.route("**/api/app-storage/edgelab/quant-workspace.v1", async (request) => {
    const nextValue = request.request().method() === "PUT"
      ? (request.request().postDataJSON() as { value?: unknown } | null)?.value ?? value
      : value;
    await fulfillJson(request, {
      key: "quant-workspace.v1",
      namespace: "edgelab",
      updated_at: frozenTime,
      value: nextValue,
    });
  });
}

async function mockRunningGeneration(page: Page) {
  let releaseRun!: () => void;
  const runGate = new Promise<void>((resolve) => { releaseRun = resolve; });
  await mockGenerationBase(page, 601);
  await page.route("**/api/quant/jobs/601/events/stream", (request) => request.fulfill({
    body: 'event: progress\ndata: {"status":"RUNNING"}\n\nevent: delta\ndata: {"delta":"Reading visible bars and validating context."}\n\n',
    contentType: "text/event-stream",
    status: 200,
  }));
  await page.route("**/api/quant/jobs/601/run", async (request) => {
    await runGate;
    await fulfillJson(request, { error_message: null, id: 601, status: "CANCELLED" });
  });
  await page.route("**/api/quant/jobs/601/cancel", (request) => fulfillJson(request, { id: 601, status: "CANCELLED" }));
  return { releaseRun };
}

async function mockFailedGeneration(page: Page) {
  await mockGenerationBase(page, 611);
  await page.route("**/api/quant/jobs/611/events/stream", (request) => request.fulfill({
    body: 'event: progress\ndata: {"status":"RUNNING"}\n\n',
    contentType: "text/event-stream",
    status: 200,
  }));
  await page.route("**/api/quant/jobs/611/run", (request) => fulfillJson(request, {
    error_message: "The deterministic provider timed out before producing output. No result was saved.",
    id: 611,
    status: "FAILED",
  }));
}

async function mockRetryingGeneration(page: Page) {
  let attempt = 0;
  let releaseRetry!: () => void;
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  await page.route("**/api/quant/conversations", (request) => fulfillJson(request, { id: 501 }));
  await page.route("**/api/quant/jobs", async (request) => {
    attempt += 1;
    if (attempt === 2) await retryGate;
    await fulfillJson(request, { id: attempt === 1 ? 621 : 622, status: "QUEUED" });
  });
  await page.route("**/api/quant/jobs/621/events/stream", (request) => request.fulfill({ body: "", contentType: "text/event-stream", status: 200 }));
  await page.route("**/api/quant/jobs/621/run", (request) => fulfillJson(request, {
    error_message: "The deterministic provider timed out before producing output. No result was saved.",
    id: 621,
    status: "FAILED",
  }));
  await page.route("**/api/quant/jobs/622/events/stream", (request) => request.fulfill({ body: "", contentType: "text/event-stream", status: 200 }));
  await page.route("**/api/quant/jobs/622/run", (request) => fulfillJson(request, { id: 622, status: "CANCELLED" }));
  return { releaseRetry };
}

async function mockGenerationBase(page: Page, jobId: number) {
  await page.route("**/api/quant/conversations", (request) => fulfillJson(request, { id: 501 }));
  await page.route("**/api/quant/jobs", (request) => fulfillJson(request, { id: jobId, status: "QUEUED" }));
}

async function fulfillJson(route: Route, value: unknown) {
  await route.fulfill({ body: JSON.stringify(value), contentType: "application/json", status: 200 });
}

async function revealAndExpectQuantGeometry(page: Page, subject: Locator) {
  await subject.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const panel = page.getByRole("complementary", { name: "Quant assistant" });
  const [panelBox, subjectBox, viewport] = await Promise.all([panel.boundingBox(), subject.boundingBox(), Promise.resolve(page.viewportSize())]);
  expect(panelBox).not.toBeNull();
  expect(subjectBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(0);
  expect(panelBox!.y).toBeGreaterThanOrEqual(0);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
  expect(subjectBox!.x).toBeGreaterThanOrEqual(panelBox!.x - 1);
  expect(subjectBox!.x + subjectBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
  expect(subjectBox!.y).toBeGreaterThanOrEqual(panelBox!.y - 1);
  expect(subjectBox!.y + subjectBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height + 1);
  const mobileNav = page.getByRole("navigation", { name: "Primary workspace" });
  if (await mobileNav.isVisible()) {
    const navBox = await mobileNav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectStateScreenshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    maxDiffPixelRatio: 0.0001,
    threshold: 0.05,
  });
}

const artifactWorkspace = {
  activeConversationByKind: { build: "quant-build-artifact" },
  conversations: [{
    createdAt: frozenTime,
    id: "quant-build-artifact",
    kind: "build",
    messages: [
      { content: "Build a deterministic score for the active range.", createdAt: frozenTime, id: "quant-user-artifact", role: "user" },
      {
        content: "Generated Deterministic range score from the retained offline fixture.",
        createdAt: frozenTime,
        generatedIndicator: {
          modelProvenance: "offline-ai-fixture · offline-research-v1",
          name: "Deterministic range score",
          probabilityCalibrated: false,
          probabilityLabel: "Outcome probability unavailable",
          probabilityPlotName: null,
          probabilitySemantics: "This offline fixture does not claim a calibrated outcome probability.",
          scoreLabel: "Range pressure score",
          scorePlotName: "pressure",
          scoreSemantics: "Deterministic study output; not model confidence.",
          source: 'indicator "Deterministic range score"\nplot pressure = close - open',
        },
        id: "quant-assistant-artifact",
        role: "assistant",
        usage: { cost: 0, credits: 0, inputTokens: 0, outputTokens: 0 },
      },
    ],
    title: "Deterministic range score",
    updatedAt: frozenTime,
  }],
  revision: 1,
};
