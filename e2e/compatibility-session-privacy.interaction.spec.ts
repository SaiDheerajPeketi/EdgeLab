import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import axe from "axe-core";
import { AUTH_SESSION_KEY, betaSessionResponse, gotoStable, installDeterminism } from "./support/app";

test.use({ video: "off" });
const preferenceKey = "settings-center.v1";
const firstOwner = betaSessionResponse.user.id;
const initialPreferences = { density: "compact", includeDiagnosticsByDefault: false, futurePreference: { nested: ["private", 16] } };
const liveModel = { model_id: "live-review-model", display_name: "Live review model", provider: "approved-provider", operations: ["chart-analysis", "indicator-generation"], available: true, adapter_configured: true, credential_required: true, availability_reason: "Owner credential and provider adapter are configured" };
const offlineModel = { ...liveModel, model_id: "offline-review-fixture", display_name: "Deterministic review fixture", provider: "offline-ai-fixture", credential_required: false, availability_reason: "Deterministic fixture is available without a live provider" };
const unavailableModel = { ...liveModel, model_id: "unconfigured-review-model", display_name: "Unconfigured review model", available: false, adapter_configured: false, availability_reason: "No server adapter is configured for this provider" };
type Preferences = typeof initialPreferences;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const row = (page: Page, id: string) => page.locator(`[data-setting-control="${id}"]`);
const boundary = (page: Page) => page.locator('[data-route-group="settings"]');
const signOut = (page: Page) => page.getByRole("button", { name: "End session and sign out", exact: true });
const diagnostics = (page: Page) => page.getByRole("switch", { name: "Include diagnostics by default", exact: true });
const retry = (page: Page, id: string) => row(page, id).getByRole("button", { name: "Retry", exact: true });
const saved = (page: Page, id: string) => row(page, id).getByRole("status").filter({ hasText: /^Saved$/ });
const item = (value: unknown) => ({ namespace: "edgelab", key: preferenceKey, value: clone(value), updated_at: "2026-09-15T10:30:00.000Z" });
function session(owner: number, token = `session-privacy-${owner}`) {
  return { createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at, token, user: { approved: true, betaPosition: null, email: `owner-${owner}@example.com`, id: owner, isBetaUser: true, name: `Owner ${owner}`, plan: "beta", provider: "google" } };
}
async function fixture(page: Page, fallback: boolean) {
  await installDeterminism(page, { rollout: fallback ? "fallback" : "enabled" });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem("session-privacy-fixture-seeded")) {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem("session-privacy-fixture-seeded", "1");
    }
  }, { key: AUTH_SESSION_KEY, value: session(firstOwner) });
  const state = { fallback, owner: firstOwner as number, token: session(firstOwner).token, preferences: new Map<number, Preferences>([[firstOwner, clone(initialPreferences)]]), sessionWrites: [] as Array<{ owner: number; token: string }>, preferenceWrites: [] as Array<{ owner: number; body: Record<string, unknown> }>, preferenceReads: [] as number[], sessionStatus: 200, sessionAck: { ok: true } as unknown, failPreferenceRead: false, failPreferenceWrite: false, failPreferenceOwners: new Set<number>(), preferenceAck: undefined as unknown, gates: new Map<string, Promise<void>>(), preferenceFinished: [] as number[], sessionFinished: [] as string[], aiModels: new Map<number, unknown>([[firstOwner, [clone(liveModel), clone(offlineModel), clone(unavailableModel)]]]), aiStatus: 200, aiReads: [] as Array<{ owner: number; token: string }>, aiFinished: [] as string[] };
  const preferences = (owner: number) => { if (!state.preferences.has(owner)) state.preferences.set(owner, clone(initialPreferences)); return state.preferences.get(owner)!; };
  await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: { revision: state.fallback ? "session-privacy-fallback16" : "session-privacy-modern16", kill_switch: state.fallback, flags: { shell: true, journal: true, settings: true, chart: true, public: true } } }));
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "DELETE") return route.fulfill({ json: { ...betaSessionResponse, token: state.token, user: { ...betaSessionResponse.user, id: state.owner, email: `owner-${state.owner}@example.com`, name: `Owner ${state.owner}` } } });
    const owner = state.owner, authorization = route.request().headers().authorization ?? "";
    state.sessionWrites.push({ owner, token: authorization.replace(/^Bearer /, "") });
    const gate = state.gates.get("session"); if (gate) await gate;
    const result = await route.fulfill({ status: state.sessionStatus, json: state.sessionAck });
    state.sessionFinished.push(authorization.replace(/^Bearer /, ""));
    return result;
  });
  await page.route(`**/api/app-storage/edgelab/${preferenceKey}`, async (route) => {
    expect(route.request().method()).toBe("GET"); state.preferenceReads.push(state.owner);
    if (state.failPreferenceRead) return route.fulfill({ status: 503, json: { detail: "Preferences unavailable" } });
    return route.fulfill({ json: item(preferences(state.owner)) });
  });
  await page.route("**/api/settings/preferences", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const owner = state.owner, before = preferences(owner), body = route.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["includeDiagnosticsByDefault"]);
    state.preferenceWrites.push({ owner, body: clone(body) });
    const gate = state.gates.get("preferences"); if (gate) await gate;
    if (state.failPreferenceWrite || state.failPreferenceOwners.has(owner)) { state.preferenceFinished.push(owner); return route.fulfill({ status: 503, json: { detail: "Preferences could not be saved" } }); }
    const after = { ...before, ...body } as Preferences; state.preferences.set(owner, after);
    const result = await route.fulfill({ json: state.preferenceAck !== undefined ? state.preferenceAck : item(after) });
    state.preferenceFinished.push(owner); return result;
  });
  await page.route("**/api/quant/models", async (route) => {
    expect(route.request().method()).toBe("GET");
    const owner = state.owner, token = (route.request().headers().authorization ?? "").replace(/^Bearer /, ""), acknowledgment = clone(state.aiModels.has(owner) ? state.aiModels.get(owner) : []), status = state.aiStatus;
    state.aiReads.push({ owner, token });
    const gate = state.gates.get(`ai:${token}`); if (gate) await gate;
    const result = await route.fulfill({ status, json: status === 200 ? acknowledgment : { detail: "AI model availability unavailable" } });
    state.aiFinished.push(token); return result;
  });
  return state;
}
type State = Awaited<ReturnType<typeof fixture>>;
function hold(state: State, key: string) { let release!: () => void; state.gates.set(key, new Promise<void>((resolve) => { release = resolve; })); return () => { state.gates.delete(key); release(); }; }
async function auth(page: Page) { return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), AUTH_SESSION_KEY); }
async function consumer(page: Page) { return page.evaluate(async () => { const path = "/src/lib/settingsPreferences.ts"; return (await import(path)).loadSettingsPreferences(); }); }
async function localPreferences(page: Page, owner = firstOwner) { return page.evaluate(({ key, owner }) => JSON.parse(localStorage.getItem(`edgelab.${key}.user-${owner}`) ?? "null"), { key: preferenceKey, owner }); }
async function setOwner(page: Page, state: State, owner: number, token = `session-privacy-${owner}`) {
  state.owner = owner; state.token = token;
  await page.evaluate(async (value) => { const path = "/src/lib/authSession.ts"; (await import(path)).setStoredAuthSession(value); }, session(owner, token));
}
async function switchRenderer(page: Page, state: State, fallback: boolean) {
  state.fallback = fallback; await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(boundary(page)).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function audit(page: Page, ids: string[]) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: axe.source });
  for (const id of ids) {
    const target = row(page, id); await expect(target).toBeVisible();
    const violations = await target.evaluate(async (node) => (await window.axe.run(node, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`));
    expect(violations, `${id} WCAG 2.2 AA`).toEqual([]);
    if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
      const undersized = await target.locator("button:visible,input:visible,select:visible").evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height, label: node.getAttribute("aria-label") ?? node.textContent?.trim() }; }).filter((rect) => rect.width < 44 || rect.height < 44));
      expect(undersized, `${id} touch targets`).toEqual([]);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "Horizontal overflow").toBeLessThanOrEqual(1);
}
async function capture(page: Page, category: string, fallback: boolean, info: TestInfo, state = "loaded") {
  if (process.env.EDGELAB_SESSION_PRIVACY_CAPTURE !== "1") return;
  if (state !== "loaded" ? info.project.name !== "desktop" : ["global", "ai"].includes(category) ? !["desktop", "mobile"].includes(info.project.name) : !["desktop", "tablet", "mobile"].includes(info.project.name)) return;
  const directory = ".impeccable/review/session-privacy16"; await mkdir(directory, { recursive: true });
  const sources = ["frontend/src/components/settings/SessionPrivacyPanels.tsx", "frontend/src/components/settings/useAccountSession.ts", "frontend/src/components/settings/useAiAvailability.ts", "frontend/src/components/settings/SettingsCenter.tsx", "frontend/src/components/settings/useSettingsPreferences.ts", "frontend/src/components/compatibility/CompatibilitySessionPrivacySettings.tsx", "frontend/src/components/compatibility/CompatibilityRouteRenderer.tsx", "frontend/src/lib/api.ts", "frontend/src/lib/authSession.ts", "frontend/src/lib/settingsPreferences.ts", "frontend/src/lib/serverStorage.ts", "frontend/src/lib/locale.ts", "frontend/src/components/EdgeLabWorkspace.tsx"];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (source) => [source, createHash("sha256").update(await readFile(source)).digest("hex")])));
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); const workspace = document.querySelector<HTMLElement>("#workspace-content"); if (workspace) workspace.scrollTop = 0; });
  const views = state !== "loaded" ? [state] : ["privacy-security", "ai"].includes(category) || (category === "account" && info.project.name === "mobile") ? ["top", "details"] : ["top"];
  for (const view of views) {
    if (view !== "top") await (category === "ai" ? state === "loaded" ? row(page, "ai-routing").getByText("Quant stores server conversations and generated artifacts", { exact: false }) : row(page, "ai-routing").getByRole("button", { name: "Retry loading AI models", exact: true }) : row(page, category === "account" ? "current-session" : state === "loaded" ? "device-permissions" : "diagnostic-sharing")).scrollIntoViewIfNeeded();
    const output = `${directory}/${fallback ? "fallback" : "modern"}-${category}-${info.project.name}-${view}.png`;
    const image = await page.screenshot({ path: output, animations: "disabled", fullPage: false });
    const geometry = await page.evaluate(() => { const workspace = document.querySelector<HTMLElement>("#workspace-content"); return { scrollY, fontsLoaded: document.fonts.status === "loaded", workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop } : null }; });
    await writeFile(`${output}.json`, JSON.stringify({ path: output, route: new URL(page.url()).pathname, url: page.url(), renderer: fallback ? "fallback" : "modern", project: info.project.name, state, view, captureMode: "native viewport", viewport: page.viewportSize(), width: image.readUInt32BE(16), height: image.readUInt32BE(20), ...geometry, sourceHashes, sourceVariant: "primary checkout including pre-existing user shell changes" }, null, 2));
  }
}

async function captureSupplement(page: Page, category: "global" | "ai" | "privacy-security", fallback: boolean, info: TestInfo) {
  if (process.env.EDGELAB_SESSION_PRIVACY_SUPPLEMENT !== "1" || fallback || !["mobile", "tablet"].includes(info.project.name) || (category !== "privacy-security" && info.project.name !== "mobile")) return;
  const view = category === "global" ? "controls" : category === "ai" ? "models" : info.project.name === "mobile" ? "diagnostics" : "permissions";
  const start = category === "global" ? row(page, "regional-format").locator("dl") : category === "ai" ? row(page, "ai-routing") : info.project.name === "mobile" ? diagnostics(page).locator("xpath=ancestor::section[1]") : row(page, "device-permissions");
  const end = category === "ai" ? page.locator(`[data-ai-model="${liveModel.model_id}"]`) : category === "privacy-security" && info.project.name === "mobile" ? diagnostics(page) : start;
  await page.evaluate(async () => { await document.fonts.ready; });
  await start.evaluate((node) => node.scrollIntoView({ block: "start", behavior: "instant" }));
  await end.evaluate((node) => {
    const limit = innerHeight - 76, delta = node.getBoundingClientRect().bottom - limit;
    if (delta <= 0) return;
    let parent = node.parentElement;
    while (parent && !(parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY))) parent = parent.parentElement;
    if (parent) parent.scrollTop += delta + 8; else scrollBy(0, delta + 8);
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const content = { start: await start.boundingBox(), end: await end.boundingBox() };
  expect(content.start).not.toBeNull(); expect(content.end).not.toBeNull();
  expect(content.start!.y, "Supplement content starts inside the viewport").toBeGreaterThanOrEqual(0);
  expect(content.end!.y + content.end!.height, "Supplement content clears fixed bottom navigation").toBeLessThanOrEqual(page.viewportSize()!.height - 72);
  const directory = ".impeccable/review/session-privacy16", baseline = JSON.parse(await readFile(`${directory}/modern-${category}-${info.project.name}-top.png.json`, "utf8"));
  const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(baseline.sourceHashes).map(async (source) => [source, createHash("sha256").update(await readFile(source)).digest("hex")])));
  expect(sourceHashes, "Supplement uses the original frozen UI source").toEqual(baseline.sourceHashes);
  const output = `${directory}/modern-${category}-${info.project.name}-${view}.png`;
  const image = await page.screenshot({ path: output, animations: "disabled", fullPage: false });
  const geometry = await page.evaluate(() => { const workspace = document.querySelector<HTMLElement>("#workspace-content"); return { scrollY, fontsLoaded: document.fonts.status === "loaded", workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop } : null }; });
  await writeFile(`${output}.json`, JSON.stringify({ path: output, route: new URL(page.url()).pathname, url: page.url(), renderer: "modern", project: info.project.name, state: "loaded", view, captureMode: "native viewport", viewport: page.viewportSize(), width: image.readUInt32BE(16), height: image.readUInt32BE(20), ...geometry, content, sourceHashes, sourceVariant: baseline.sourceVariant, supplementReason: "Complete coverage obscured by the tall existing header or fixed bottom navigation in the original packet" }, null, 2));
}

for (const fallback of [true, false]) {
  const title = fallback ? "fallback" : "modern";
  test(`${title} Account preserves the exact token for failed and malformed revocations and retries only acknowledged sign-out`, async ({ page }, info) => {
    const state = await fixture(page, fallback); await gotoStable(page, "/app/settings/account", { waitForNetworkIdle: false });
    await expect(signOut(page)).toBeEnabled(); await expect(row(page, "account-identity")).toContainText(`owner-${firstOwner}@example.com`);
    await audit(page, ["account-identity", "current-session"]); await capture(page, "account", fallback, info);
    await signOut(page).focus(); await expect(signOut(page)).toBeFocused();
    for (const [status, acknowledgment] of [[503, { detail: "Revocation failed" }], [200, null], [200, { ok: false }], [200, { ok: "true" }]] as Array<[number, unknown]>) {
      state.sessionStatus = status; state.sessionAck = acknowledgment;
      if (state.sessionWrites.length) await retry(page, "current-session").click(); else await page.keyboard.press("Enter");
      await expect(retry(page, "current-session")).toBeVisible();
      expect((await auth(page)).token).toBe(state.token); await expect(page).toHaveURL(/\/app\/settings\/account$/);
      if (status === 503) await capture(page, "account", fallback, info, "failure");
    }
    state.sessionStatus = 200; state.sessionAck = { ok: true }; const release = hold(state, "session");
    await retry(page, "current-session").click(); await expect.poll(() => state.sessionWrites.length).toBe(5);
    await expect(signOut(page)).toBeDisabled(); expect((await auth(page)).token).toBe(state.token); await capture(page, "account", fallback, info, "pending");
    release(); await expect(page).toHaveURL(/\/(?:auth\/)?signin(?:\?|$)/); await page.waitForLoadState("domcontentloaded");
    await expect.poll(async () => { try { return await auth(page); } catch { return "Navigation pending"; } }).toBeNull();
    expect(state.sessionWrites).toEqual(Array.from({ length: 5 }, () => ({ owner: firstOwner, token: session(firstOwner).token })));
    expect(state.preferenceWrites).toEqual([]);
  });

  for (const replacement of ["same owner", "different owner"]) for (const outcome of ["success", "failure"]) {
    test(`${title} pending Account ${outcome} cannot clear or poison a ${replacement} replacement after hot switching`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop", "Exact-token and hot-switch races covered at desktop");
      const state = await fixture(page, fallback); await gotoStable(page, "/app/settings/account", { waitForNetworkIdle: false }); await expect(signOut(page)).toBeEnabled();
      const release = hold(state, "session"); state.sessionStatus = outcome === "success" ? 200 : 503;
      await signOut(page).click(); await expect.poll(() => state.sessionWrites.length).toBe(1); await expect(signOut(page)).toBeDisabled();
      await switchRenderer(page, state, !fallback); await expect(signOut(page)).toBeDisabled(); expect(state.sessionWrites).toHaveLength(1);
      const replacementOwner = replacement === "same owner" ? firstOwner : firstOwner + 1, replacementToken = `replacement-${replacementOwner}`;
      await setOwner(page, state, replacementOwner, replacementToken); await expect(signOut(page)).toBeEnabled();
      release(); await expect.poll(() => state.sessionFinished.length).toBe(1);
      await expect(signOut(page)).toBeEnabled(); await expect(retry(page, "current-session")).toHaveCount(0);
      expect((await auth(page)).token).toBe(replacementToken); await expect(page).toHaveURL(/\/app\/settings\/account$/);
      await switchRenderer(page, state, fallback); expect((await auth(page)).token).toBe(replacementToken); await expect(signOut(page)).toBeEnabled();
    });
  }

  test(`${title} Privacy uses confirmed diagnostics, preserves unknown fields and density, and supports failed reload Retry Reset Undo`, async ({ page }, info) => {
    const state = await fixture(page, fallback); state.failPreferenceRead = true;
    await gotoStable(page, "/app/settings/privacy-security#settings/privacy-security/diagnostic-sharing", { waitForNetworkIdle: false });
    const loadRetry = page.getByRole("button", { name: "Retry loading preferences", exact: true });
    await expect(loadRetry).toBeVisible(); await expect(diagnostics(page)).toBeDisabled(); expect(state.preferenceWrites).toEqual([]);
    await capture(page, "privacy-security", fallback, info, "load-failure");
    state.failPreferenceRead = false; await loadRetry.click(); await expect(diagnostics(page)).toBeEnabled(); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "false");
    await expect(row(page, "diagnostic-sharing")).toContainText("Excluded by default"); expect(await localPreferences(page)).toEqual(initialPreferences);
    await audit(page, ["diagnostic-sharing", "credential-vault", "workspace-sharing", "device-permissions"]); await capture(page, "privacy-security", fallback, info);
    await captureSupplement(page, "privacy-security", fallback, info);
    await expect(row(page, "device-permissions")).toContainText("Permission requested when using Dictate");
    await expect(row(page, "device-permissions")).toContainText("Restricted indicator language only");
    await expect(row(page, "device-permissions")).toContainText("Arbitrary generated JavaScript and Python execution is unavailable");
    await expect(row(page, "device-permissions")).toContainText("does not confirm a transcription service");
    await diagnostics(page).focus(); await expect(diagnostics(page)).toBeFocused();
    state.failPreferenceWrite = true; await page.keyboard.press("Space"); await expect(retry(page, "diagnostic-sharing")).toBeVisible();
    await expect(diagnostics(page)).toHaveAttribute("aria-checked", "true"); await expect(row(page, "diagnostic-sharing")).toContainText("Excluded by default");
    expect(await consumer(page)).toEqual({ density: "compact", includeDiagnosticsByDefault: false }); expect(await localPreferences(page)).toEqual(initialPreferences);
    await capture(page, "privacy-security", fallback, info, "save-failure");
    await switchRenderer(page, state, !fallback); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "true"); await expect(retry(page, "diagnostic-sharing")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" }); await expect(retry(page, "diagnostic-sharing")).toBeVisible(); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "true"); expect(state.preferenceWrites).toHaveLength(1);
    state.failPreferenceWrite = false; state.preferenceAck = item(initialPreferences); await retry(page, "diagnostic-sharing").click();
    await expect.poll(() => state.preferenceWrites.length).toBe(2); await expect(retry(page, "diagnostic-sharing")).toBeVisible(); expect(await consumer(page)).toEqual({ density: "compact", includeDiagnosticsByDefault: false });
    state.preferenceAck = undefined; const release = hold(state, "preferences"); await retry(page, "diagnostic-sharing").click(); await expect.poll(() => state.preferenceWrites.length).toBe(3);
    await expect(saved(page, "diagnostic-sharing")).toHaveCount(0); await expect(row(page, "diagnostic-sharing")).toContainText("Excluded by default"); expect(await consumer(page)).toEqual({ density: "compact", includeDiagnosticsByDefault: false });
    release(); await expect(saved(page, "diagnostic-sharing")).toBeVisible(); await expect(row(page, "diagnostic-sharing")).toContainText("Included by default");
    expect(await localPreferences(page)).toEqual({ ...initialPreferences, includeDiagnosticsByDefault: true });
    await diagnostics(page).click(); await expect.poll(() => state.preferenceWrites.length).toBe(4); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "false"); await expect(saved(page, "diagnostic-sharing")).toBeVisible();
    await page.getByRole("button", { name: /^Reset section(?: · Unsaved)?$/ }).click(); await expect.poll(() => state.preferenceWrites.length).toBe(5); await expect(saved(page, "diagnostic-sharing")).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click(); await expect.poll(() => state.preferenceWrites.length).toBe(6); await expect(saved(page, "diagnostic-sharing")).toBeVisible();
    expect(state.preferences.get(firstOwner)).toEqual(initialPreferences); expect(await localPreferences(page)).toEqual(initialPreferences);
    expect(state.preferenceWrites.map(({ body }) => body)).toEqual([true, true, true, false, true, false].map((includeDiagnosticsByDefault) => ({ includeDiagnosticsByDefault })));
    expect(state.sessionWrites).toEqual([]);
  });

  test(`${title} pending Privacy preserves return-to-original edits across renderers and isolates another owner's late acknowledgment`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Pending drafts and owner isolation covered at desktop");
    const state = await fixture(page, fallback); await gotoStable(page, "/app/settings/privacy-security", { waitForNetworkIdle: false }); await expect(diagnostics(page)).toBeEnabled();
    let release = hold(state, "preferences"); await diagnostics(page).click(); await expect.poll(() => state.preferenceWrites.length).toBe(1); await diagnostics(page).click();
    await switchRenderer(page, state, !fallback); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "false"); expect(state.preferenceWrites).toHaveLength(1);
    release(); await expect.poll(() => state.preferenceWrites.length).toBe(2); await expect(saved(page, "diagnostic-sharing")).toBeVisible(); expect(await consumer(page)).toEqual({ density: "compact", includeDiagnosticsByDefault: false });
    release = hold(state, "preferences"); await diagnostics(page).click(); await expect.poll(() => state.preferenceWrites.length).toBe(3);
    await setOwner(page, state, firstOwner + 1); await expect(diagnostics(page)).toBeEnabled(); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "false");
    state.failPreferenceOwners.add(firstOwner + 1); await diagnostics(page).click(); release();
    await expect(retry(page, "diagnostic-sharing")).toBeVisible(); expect(await consumer(page)).toEqual({ density: "compact", includeDiagnosticsByDefault: false });
    await expect(diagnostics(page)).toHaveAttribute("aria-checked", "true");
    await setOwner(page, state, firstOwner); await expect(diagnostics(page)).toBeEnabled(); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "true");
    await setOwner(page, state, firstOwner + 1); await expect(diagnostics(page)).toHaveAttribute("aria-checked", "true"); await expect(retry(page, "diagnostic-sharing")).toBeVisible();
    expect(state.preferenceWrites.map(({ owner }) => owner)).toEqual([firstOwner, firstOwner, firstOwner, firstOwner + 1]);
  });

  test(`${title} AI reports live, offline, unconfigured and empty server model readiness without offering mutation controls`, async ({ page }, info) => {
    const state = await fixture(page, fallback); await gotoStable(page, "/app/settings/ai#settings/ai/ai-routing", { waitForNetworkIdle: false });
    const panel = row(page, "ai-routing"), refresh = page.getByRole("button", { name: "Refresh model availability", exact: true });
    await expect(panel).toContainText("1 live model ready"); await expect.poll(() => panel.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    const live = page.locator(`[data-ai-model="${liveModel.model_id}"]`), offline = page.locator(`[data-ai-model="${offlineModel.model_id}"]`), unavailable = page.locator(`[data-ai-model="${unavailableModel.model_id}"]`);
    await expect(live).toContainText("Ready · live model"); await expect(live).toContainText("Required"); await expect(live).toContainText(liveModel.availability_reason); await expect(live).toContainText("chart-analysis, indicator-generation");
    await expect(offline).toContainText("deterministic offline fixture, not a live AI model"); await expect(offline).toContainText("Not required");
    await expect(unavailable).toContainText("Unavailable"); await expect(unavailable).toContainText("Not configured");
    expect(await panel.locator("input,select,textarea,[role=switch]").count()).toBe(0);
    await expect(panel).toContainText("explicit consent in Quant"); await expect(panel).toContainText("30 days");
    await audit(page, ["ai-routing"]); await capture(page, "ai", fallback, info);
    await captureSupplement(page, "ai", fallback, info);
    const keyboardReads = state.aiReads.length; await refresh.focus(); await page.keyboard.press("Space");
    await expect.poll(() => state.aiReads.length).toBeGreaterThan(keyboardReads); await expect(panel).toContainText("1 live model ready");
    for (const [models, effective] of [[[offlineModel], "Offline fixture only"], [[unavailableModel], "No models available"], [[], "No models available"]] as Array<[unknown, string]>) {
      state.aiModels.set(firstOwner, clone(models)); const reads = state.aiReads.length; await refresh.click();
      await expect.poll(() => state.aiReads.length).toBeGreaterThan(reads); await expect(panel).toContainText(effective);
      if (Array.isArray(models) && models.length === 0) await expect(panel).toContainText("The server returned no configured models");
    }
    await switchRenderer(page, state, !fallback); await expect(panel).toContainText("The server returned no configured models");
    await expect(page).toHaveURL(/\/app\/settings\/ai#settings\/ai\/ai-routing$/); expect(state.preferenceWrites).toEqual([]); expect(state.sessionWrites).toEqual([]);
  });

  test(`${title} AI strict loading and malformed schemas fail visibly and recover only on valid Retry`, async ({ page }, info) => {
    const state = await fixture(page, fallback); state.aiStatus = 503;
    await gotoStable(page, "/app/settings/ai", { waitForNetworkIdle: false });
    const panel = row(page, "ai-routing"), loadRetry = page.getByRole("button", { name: "Retry loading AI models", exact: true });
    await expect(loadRetry).toBeVisible(); await expect(panel).toContainText("Availability could not be verified");
    await capture(page, "ai", fallback, info, "load-failure");
    state.aiStatus = 200;
    for (const malformed of [null, { models: [] }, [{ ...liveModel, available: "yes" }], [{ ...liveModel, operations: [1] }], [liveModel, liveModel]]) {
      state.aiModels.set(firstOwner, malformed); const reads = state.aiReads.length, finished = state.aiFinished.length; await loadRetry.click();
      await expect.poll(() => state.aiReads.length).toBeGreaterThan(reads); await expect.poll(() => state.aiFinished.length).toBeGreaterThan(finished);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(loadRetry).toBeVisible(); await expect(panel.locator("[data-ai-model]")).toHaveCount(0);
    }
    state.aiModels.set(firstOwner, [clone(liveModel)]); await loadRetry.click(); await expect(panel).toContainText("1 live model ready"); await expect(loadRetry).toHaveCount(0);
    expect(state.preferenceWrites).toEqual([]); expect(state.sessionWrites).toEqual([]);
  });

  for (const outcome of ["success", "failure"]) test(`${title} AI late ${outcome} cannot publish another owner's model availability`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "AI owner cancellation covered at desktop");
    const state = await fixture(page, fallback), firstToken = state.token, release = hold(state, `ai:${firstToken}`);
    state.aiStatus = outcome === "success" ? 200 : 503;
    await gotoStable(page, "/app/settings/ai", { waitForNetworkIdle: false }); await expect(row(page, "ai-routing")).toContainText("Loading availability");
    await expect.poll(() => state.aiReads.length).toBeGreaterThanOrEqual(1);
    const secondModel = { ...liveModel, model_id: "second-owner-private-model", display_name: "Second owner private model" };
    state.aiStatus = 200; state.aiModels.set(firstOwner + 1, [secondModel]); await setOwner(page, state, firstOwner + 1);
    await expect(row(page, "ai-routing")).toContainText(secondModel.display_name); release(); await expect.poll(() => state.aiFinished).toContain(firstToken);
    await expect(page.locator(`[data-ai-model="${liveModel.model_id}"]`)).toHaveCount(0); await expect(row(page, "ai-routing")).toContainText(secondModel.display_name);
    await expect(page.getByRole("button", { name: "Retry loading AI models", exact: true })).toHaveCount(0);
    await switchRenderer(page, state, !fallback); await expect(row(page, "ai-routing")).toContainText(secondModel.display_name);
    expect((await auth(page)).token).toBe(state.token);
  });

  for (const [path, category, id] of [["/app/settings", "global", "regional-format"], ["/app/settings/global", "global", "regional-format"]]) {
    test(`${title} ${path} retains truthful read-only content, exact deep links and accessible regional or AI behavior`, async ({ page }, info) => {
      const state = await fixture(page, fallback);
      await gotoStable(page, `${path}#settings/${category}/${id}`, { waitForNetworkIdle: false });
      await expect(row(page, id)).toBeVisible(); await expect(page).toHaveURL(new RegExp(`${path}#settings/${category}/${id}$`));
      await expect(row(page, id)).toBeFocused();
      expect(await row(page, id).locator("input,select,textarea,[role=switch]").count()).toBe(0);
      await expect(row(page, id)).toContainText("Browser language"); await expect(row(page, id)).toContainText("Interface formatting locale");
      await expect(row(page, id)).toContainText("en-US"); await expect(row(page, id)).toContainText("UTC"); await expect(row(page, id)).toContainText("12,345.67");
      await audit(page, [id]); if (path !== "/app/settings") await capture(page, category, fallback, info);
      if (path !== "/app/settings") await captureSupplement(page, "global", fallback, info);
      await page.keyboard.press("Tab"); expect(state.preferenceWrites).toEqual([]); expect(state.sessionWrites).toEqual([]);
      await page.evaluate(() => { document.documentElement.lang = "de-DE"; });
      await switchRenderer(page, state, !fallback); await expect(row(page, id)).toBeVisible(); await expect(page).toHaveURL(new RegExp(`${path}#settings/${category}/${id}$`));
      await expect(row(page, id)).toContainText("en-US"); await expect(row(page, id)).toContainText("de-DE"); await expect(row(page, id)).toContainText("12.345,67");
      expect(state.preferenceWrites).toEqual([]); expect(state.sessionWrites).toEqual([]);
    });
  }
}
