import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { AUTH_SESSION_KEY, FROZEN_TIME, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

// Recording bytes, microphone permission, and transcription responses remain
// entirely in browser fixtures. These tests never access hardware or a provider.
const offlineModel = {
  available: true,
  display_name: "Deterministic offline research",
  input_token_cost_micros: 0,
  model_id: "offline-research-v1",
  operations: ["CHART_ANALYSIS"],
  output_token_cost_micros: 0,
  provider: "offline-ai-fixture",
};

type MediaOptions = { permission?: "deferred" | "denied"; failure?: "constructor" | "start"; deferEncoding?: boolean };
type MediaFixture = {
  permissionCalls: number;
  trackStops: number;
  recorderStarts: number;
  recorderStops: number;
  encodingCalls: number;
  encodingFinished: number;
  grant: () => void;
  releaseEncoding: () => void;
  emit: (bytes: number) => void;
};

declare global {
  interface Window { __quantRecordingFixture: MediaFixture }
}

test.describe("Quant recording lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page);
    await seedApprovedSession(page);
    await page.route("**/api/quant/models", (route) => fulfillJson(route, [offlineModel]));
  });

  test("late permission after closing stops the returned tracks without transcription", async ({ page }) => {
    const flow = await installRecording(page, { permission: "deferred" });
    const panel = await openQuant(page);
    await panel.getByRole("button", { name: "Dictate", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Requesting…", exact: true })).toBeDisabled();
    await closeQuant(panel);
    await page.evaluate(() => window.__quantRecordingFixture.grant());
    await expect.poll(() => mediaCount(page, "trackStops")).toBe(1);
    expect(await mediaCount(page, "recorderStarts")).toBe(0);
    await expectNoTranscription(page, flow);
  });

  test("cancel recording discards queued recorder callbacks and permits a fresh attempt", async ({ page }) => {
    const flow = await installRecording(page);
    const panel = await openQuant(page);
    await startRecording(panel);
    await emitAudio(page);
    await panel.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => mediaCount(page, "trackStops")).toBe(1);
    await expect(panel.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
    await expectNoTranscription(page, flow);
    await startRecording(panel);
    await closeQuant(panel);
    await expect.poll(() => mediaCount(page, "trackStops")).toBe(2);
    await expectNoTranscription(page, flow);
  });

  for (const failure of ["constructor", "start"] as const) {
    test(`${failure} failure releases microphone tracks without transcription`, async ({ page }) => {
      const flow = await installRecording(page, { failure });
      const panel = await openQuant(page);
      await panel.getByRole("button", { name: "Dictate", exact: true }).click();
      await expect(panel.getByRole("alert")).toContainText("The microphone could not be started.");
      await expect.poll(() => mediaCount(page, "trackStops")).toBe(1);
      await expect(panel.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
      await expectNoTranscription(page, flow);
    });
  }

  test("permission denial reports recovery without creating a recorder", async ({ page }) => {
    const flow = await installRecording(page, { permission: "denied" });
    const panel = await openQuant(page);
    await panel.getByRole("button", { name: "Dictate", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Microphone permission was denied.");
    expect(await mediaCount(page, "recorderStarts")).toBe(0);
    await expectNoTranscription(page, flow);
  });

  test("closing during encoding suppresses the later upload and audit", async ({ page }) => {
    const flow = await installRecording(page, { deferEncoding: true });
    const panel = await openQuant(page);
    await startRecording(panel);
    await emitAudio(page);
    await panel.getByRole("button", { name: "Stop & transcribe", exact: true }).click();
    await expect.poll(() => mediaCount(page, "encodingCalls")).toBe(1);
    await expect(panel.getByRole("button", { name: "Transcribing…", exact: true })).toBeDisabled();
    await closeQuant(panel);
    await page.evaluate(() => window.__quantRecordingFixture.releaseEncoding());
    await expectNoTranscription(page, flow);
    expect(await mediaCount(page, "trackStops")).toBe(1);
  });

  test("closing while a transcription is pending suppresses late text and audit", async ({ page }) => {
    const flow = await installRecording(page);
    const response = await holdTranscription(page, flow);
    const panel = await openQuant(page);
    await startRecording(panel);
    await emitAudio(page);
    await panel.getByRole("button", { name: "Stop & transcribe", exact: true }).click();
    await expect.poll(() => flow.requests.length).toBe(1);
    const aborted = page.waitForEvent("requestfailed", { predicate: (request) => request.url().endsWith("/api/quant/transcriptions") });
    await closeQuant(panel);
    expect((await aborted).failure()?.errorText).toContain("ERR_ABORTED");
    response.release();
    await response.finished;
    await settle(page);
    expect(flow.transcriptionAudits()).toEqual([]);
    expect(await mediaCount(page, "trackStops")).toBe(1);
    await expect(page.getByLabel("Message Quant")).toHaveCount(0);
  });

  for (const change of ["refresh-token", "change-owner", "silent-signout"] as const) {
    test(`${change} invalidates pending audio before it can cross identities`, async ({ page }) => {
      const flow = await installRecording(page, { deferEncoding: true });
      const panel = await openQuant(page);
      await panel.getByLabel("Message Quant").fill("Keep this draft.");
      await startRecording(panel);
      await emitAudio(page);
      await panel.getByRole("button", { name: "Stop & transcribe", exact: true }).click();
      await expect.poll(() => mediaCount(page, "encodingCalls")).toBe(1);
      await changeSession(page, change);
      await page.evaluate(() => window.__quantRecordingFixture.releaseEncoding());
      await expectNoTranscription(page, flow);
      expect(await mediaCount(page, "trackStops")).toBe(1);
      await expect(page.getByLabel("Message Quant")).toHaveValue(change === "change-owner" ? "" : "Keep this draft.");
    });
  }

  test("owner changes while recording immediately release tracks", async ({ page }) => {
    const flow = await installRecording(page);
    const panel = await openQuant(page);
    await startRecording(panel);
    await emitAudio(page);
    await changeSession(page, "refresh-token");
    await expect.poll(() => mediaCount(page, "trackStops")).toBe(1);
    await expect(panel.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
    await expectNoTranscription(page, flow);
  });

  test("token refresh aborts an in-flight transcription without replacing the draft", async ({ page }) => {
    const flow = await installRecording(page);
    const response = await holdTranscription(page, flow);
    const panel = await openQuant(page);
    await panel.getByLabel("Message Quant").fill("Current draft");
    await startRecording(panel);
    await emitAudio(page);
    await panel.getByRole("button", { name: "Stop & transcribe", exact: true }).click();
    await expect.poll(() => flow.requests.length).toBe(1);
    const aborted = page.waitForEvent("requestfailed", { predicate: (request) => request.url().endsWith("/api/quant/transcriptions") });
    await changeSession(page, "refresh-token");
    expect((await aborted).failure()?.errorText).toContain("ERR_ABORTED");
    response.release();
    await response.finished;
    await settle(page);
    expect(flow.transcriptionAudits()).toEqual([]);
    await expect(panel.getByLabel("Message Quant")).toHaveValue("Current draft");
    await expect(panel.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
  });

  for (const boundary of ["permission", "chunk", "timer"] as const) {
    test(`silent session expiry at the ${boundary} boundary releases tracks and resets dictation`, async ({ page }) => {
      const flow = await installRecording(page, boundary === "permission" ? { permission: "deferred" } : {});
      const panel = await openQuant(page);
      if (boundary === "timer") await pauseClock(page);
      await panel.getByRole("button", { name: "Dictate", exact: true }).click();
      if (boundary !== "permission") await expect(panel.getByRole("button", { name: "Stop & transcribe", exact: true })).toBeVisible();
      await page.evaluate(({ key, expiredAt }) => {
        const session = JSON.parse(localStorage.getItem(key)!);
        session.expiresAt = expiredAt;
        localStorage.setItem(key, JSON.stringify(session));
      }, { key: AUTH_SESSION_KEY, expiredAt: "2026-09-15T09:00:00.000Z" });
      if (boundary === "permission") await page.evaluate(() => window.__quantRecordingFixture.grant());
      else if (boundary === "chunk") await emitAudio(page);
      else await page.clock.fastForward(60_000);
      await expect.poll(() => mediaCount(page, "trackStops")).toBe(1);
      await expect(panel.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
      await expectNoTranscription(page, flow);
    });
  }

  test("oversized accumulated chunks stop recording before any request", async ({ page }) => {
    const flow = await installRecording(page);
    const panel = await openQuant(page);
    await startRecording(panel);
    await emitAudio(page, 3_000_000);
    await emitAudio(page, 2_000_001);
    await expect(panel.getByRole("alert")).toContainText("Recording exceeds the 5 MB transcription limit.");
    await expect.poll(() => mediaCount(page, "trackStops")).toBe(1);
    await expectNoTranscription(page, flow);
  });

  test("empty recording releases tracks and asks the user to record again", async ({ page }) => {
    const flow = await installRecording(page);
    const panel = await openQuant(page);
    await startRecording(panel);
    await panel.getByRole("button", { name: "Stop & transcribe", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("No audio was recorded. Try recording again.");
    await expect.poll(() => mediaCount(page, "trackStops")).toBe(1);
    await expectNoTranscription(page, flow);
  });

  test("successful transcription appends to the latest editable prompt and records completion", async ({ page }) => {
    const flow = await installRecording(page);
    const response = await holdTranscription(page, flow);
    const panel = await openQuant(page);
    await panel.getByLabel("Message Quant").fill("Original draft");
    await startRecording(panel);
    await emitAudio(page);
    await panel.getByRole("button", { name: "Stop & transcribe", exact: true }).click();
    await expect.poll(() => flow.requests.length).toBe(1);
    await panel.getByLabel("Message Quant").fill("Edited while waiting");
    response.release();
    await expect(panel.getByLabel("Message Quant")).toHaveValue("Edited while waiting fixture transcript");
    await expect(panel.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
    await expect.poll(() => flow.transcriptionAudits().length).toBe(1);
    expect(flow.transcriptionAudits()[0]).toMatchObject({ action: "transcribe", contextFields: ["audio"], status: "completed" });
    expect(flow.requests[0]).toMatchObject({ body: { audioBase64: "YWJj", mimeType: "audio/webm" }, method: "POST", authorization: "Bearer ui-regression-token" });
    expect(await mediaCount(page, "trackStops")).toBe(1);
  });

  test("the 60 second recording limit automatically stops and transcribes once", async ({ page }) => {
    const flow = await installRecording(page);
    const panel = await openQuant(page);
    await pauseClock(page);
    await startRecording(panel);
    await emitAudio(page);
    await page.clock.fastForward(59_999);
    await expect(panel.getByRole("button", { name: "Stop & transcribe", exact: true })).toBeVisible();
    expect(flow.requests).toEqual([]);
    await page.clock.fastForward(1);
    await expect(panel.getByLabel("Message Quant")).toHaveValue("fixture transcript");
    expect(flow.requests).toHaveLength(1);
    expect(await mediaCount(page, "recorderStops")).toBe(1);
    expect(await mediaCount(page, "trackStops")).toBe(1);
  });
});

async function openQuant(page: Page) {
  await gotoStable(page, "/app/quant", { waitForNetworkIdle: false });
  const panel = page.getByRole("complementary", { name: "Quant assistant" });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-quant-state="provider-loading"]')).toHaveCount(0);
  await expect(page.getByText("Opening workspace", { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Dictate", exact: true })).toBeEnabled();
  return panel;
}

async function startRecording(panel: Locator) {
  await panel.getByRole("button", { name: "Dictate", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Stop & transcribe", exact: true })).toBeVisible();
}

async function closeQuant(panel: Locator) {
  await panel.getByRole("button", { name: "Close Quant", exact: true }).click();
  await expect(panel).toHaveCount(0);
}

async function emitAudio(page: Page, bytes = 3) {
  await page.evaluate((size) => window.__quantRecordingFixture.emit(size), bytes);
}

async function mediaCount(page: Page, key: "trackStops" | "recorderStarts" | "recorderStops" | "encodingCalls") {
  return page.evaluate((name) => window.__quantRecordingFixture[name], key);
}

async function changeSession(page: Page, change: "refresh-token" | "change-owner" | "silent-signout") {
  await page.evaluate(({ key, kind }) => {
    const oldValue = localStorage.getItem(key)!;
    const session = JSON.parse(oldValue);
    if (kind === "silent-signout") localStorage.removeItem(key);
    else {
      if (kind === "refresh-token") session.token = "refreshed-fixture-token";
      else session.user.id += 1;
      localStorage.setItem(key, JSON.stringify(session));
    }
    if (kind === "silent-signout") window.dispatchEvent(new Event("edgelab:auth-session-change"));
    else window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key), oldValue, storageArea: localStorage }));
  }, { key: AUTH_SESSION_KEY, kind: change });
}

async function pauseClock(page: Page) {
  await page.clock.install({ time: new Date(FROZEN_TIME) });
  await page.clock.pauseAt(new Date(Date.parse(FROZEN_TIME) + 1_000));
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(() => resolve()))));
}

type RecordingFlow = Awaited<ReturnType<typeof installRecording>>;
async function expectNoTranscription(page: Page, flow: RecordingFlow) {
  await expect.poll(() => page.evaluate(() => {
    const fixture = window.__quantRecordingFixture;
    return fixture.encodingFinished === fixture.encodingCalls;
  })).toBe(true);
  await settle(page);
  expect(flow.requests).toEqual([]);
  expect(flow.transcriptionAudits()).toEqual([]);
}

async function holdTranscription(page: Page, flow: RecordingFlow) {
  let release!: () => void;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/quant/transcriptions", async (route) => {
    flow.captureRequest(route);
    await gate;
    try { await fulfillJson(route, { text: "fixture transcript" }); }
    finally { finish(); }
  });
  return { finished, release };
}

async function installRecording(page: Page, options: MediaOptions = {}) {
  const requests: Array<{ body: unknown; method: string; authorization: string | undefined }> = [];
  const audits: Array<{ action: string; status: string; contextFields: string[] }> = [];
  const captureRequest = (route: Route) => requests.push({
    authorization: route.request().headers().authorization,
    body: route.request().postDataJSON(),
    method: route.request().method(),
  });
  await page.route("**/api/quant/transcriptions", async (route) => {
    captureRequest(route);
    await fulfillJson(route, { text: "fixture transcript" });
  });
  await page.route("**/api/app-storage/edgelab/quant-audit.v1", async (route) => {
    const value = route.request().method() === "PUT" ? route.request().postDataJSON().value : [];
    if (route.request().method() === "PUT") {
      // Each save contains the entire audit history, so keep only its latest
      // entry to detect writes without counting the same history repeatedly.
      if (value[0]) audits.push(value[0]);
    }
    await fulfillJson(route, { key: "quant-audit.v1", namespace: "edgelab", updated_at: FROZEN_TIME, value });
  });
  await page.addInitScript((config) => {
    let permissionResolve!: (stream: MediaStream) => void;
    let encodingResolve!: () => void;
    let recorder: FixtureRecorder | null = null;
    const stream = {
      getTracks: () => [{ stop: () => { state.trackStops += 1; } }],
    } as unknown as MediaStream;
    const state: MediaFixture = {
      encodingCalls: 0,
      encodingFinished: 0,
      permissionCalls: 0,
      recorderStarts: 0,
      recorderStops: 0,
      trackStops: 0,
      grant: () => permissionResolve(stream),
      releaseEncoding: () => encodingResolve(),
      emit: (size) => {
        const bytes = size === 3 ? "abc" : new Uint8Array(size);
        recorder?.ondataavailable?.({ data: new Blob([bytes], { type: "audio/webm" }) } as BlobEvent);
      },
    };
    window.__quantRecordingFixture = state;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => {
        state.permissionCalls += 1;
        if (config.permission === "denied") return Promise.reject(new DOMException("Fixture denied permission", "NotAllowedError"));
        if (config.permission === "deferred") return new Promise<MediaStream>((resolve) => { permissionResolve = resolve; });
        return Promise.resolve(stream);
      } },
    });
    class FixtureRecorder {
      mimeType = "audio/webm";
      state: RecordingState = "inactive";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        if (config.failure === "constructor") throw new Error("Fixture recorder constructor failure");
        recorder = this;
      }
      start() {
        state.recorderStarts += 1;
        if (config.failure === "start") throw new Error("Fixture recorder start failure");
        this.state = "recording";
      }
      stop() {
        state.recorderStops += 1;
        this.state = "inactive";
        const stopped = this.onstop;
        // Native recorder stop events can already be queued during cleanup.
        queueMicrotask(() => stopped?.());
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FixtureRecorder });
    const nativeArrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      if (this.type === "audio/webm") {
        state.encodingCalls += 1;
        if (config.deferEncoding) await new Promise<void>((resolve) => { encodingResolve = resolve; });
      }
      const buffer = await nativeArrayBuffer.call(this);
      if (this.type === "audio/webm") state.encodingFinished += 1;
      return buffer;
    };
  }, options);
  return { audits, captureRequest, requests, transcriptionAudits: () => audits.filter((entry) => entry.action === "transcribe") };
}

async function fulfillJson(route: Route, value: unknown) {
  await route.fulfill({ body: JSON.stringify(value), contentType: "application/json", status: 200 });
}
