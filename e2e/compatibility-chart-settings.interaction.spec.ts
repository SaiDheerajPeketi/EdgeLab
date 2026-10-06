import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import axe from "axe-core";
import { betaSessionResponse, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

test.use({ video: "off" });
const keys = { presets: "chart-settings-presets.v1", active: "active-chart-settings-preset.v1", preferences: "settings-center.v1" } as const;
const labels = { timeHoursFormat: "Hours", dateFormat: "Date format", textSize: "Text size", gridMode: "Grid", backgroundColor: "Background", textColor: "Text color", gridColor: "Grid color", candleUpColor: "Up", candleDownColor: "Down" } as const;
type Field = keyof typeof labels;
type Draft = Record<Field, string>;
type Settings = Record<string, unknown>;
type Preset = { name: string; settings: Settings; updatedAt: string; [key: string]: unknown };
type Store = { presets: Preset[]; active: string | null; preferences: Settings };
type Write = { owner: number; body: Settings };
const initial: Draft = { timeHoursFormat: "12-hour", dateFormat: "MMM dd yyyy", textSize: "14", gridMode: "vertical", backgroundColor: "#102030", textColor: "#d1e2f3", gridColor: "#304050", candleUpColor: "#12ab34", candleDownColor: "#cd3456" };
const changed: Draft = { timeHoursFormat: "24-hour", dateFormat: "yyyy-MM-dd", textSize: "17", gridMode: "horizontal", backgroundColor: "#172839", textColor: "#e1f2ff", gridColor: "#456789", candleUpColor: "#23bc45", candleDownColor: "#de4567" };
const initialPreferences = { density: "comfortable", includeDiagnosticsByDefault: false, futurePreference: { private: ["keep", 23] } };
const control = (page: Page, field: Field) => page.getByLabel(labels[field], { exact: true });
const boundary = (page: Page) => page.locator('[data-route-group="settings"]');
const apply = (page: Page, category: string) => page.getByRole("button", { name: category === "chart" ? "Apply as active preset" : "Apply palette preset", exact: true });
const chartRow = (page: Page, category: string) => apply(page, category).locator('xpath=ancestor::*[@data-setting-control][1]');
const densityRow = (page: Page) => page.locator('[data-setting-control="settings-density"]');
const saved = (page: Page, category: string) => chartRow(page, category).getByRole("status").filter({ hasText: /^Saved$/ });
const retry = (page: Page, category: string) => chartRow(page, category).getByRole("button", { name: "Retry", exact: true });
const reset = (page: Page) => page.getByRole("button", { name: /^Reset section(?: · Unsaved)?$/ });
const undo = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const draftSettings = (draft: Draft): Settings => ({ ...draft, textSize: Number(draft.textSize) });
const aliases = (settings: Settings): Settings => ({ ...settings, ...(settings.candleUpColor ? { bodyUpColor: settings.candleUpColor } : {}), ...(settings.candleDownColor ? { bodyDownColor: settings.candleDownColor } : {}) });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function initialStore(): Store {
  const hidden = { bodyUpColor: "#12ab34", bodyDownColor: "#cd3456", borderUpColor: "#111122", borderDownColor: "#333344", wickUpColor: "#555566", wickDownColor: "#777788", crosshairColor: "#90a0b0", timeZone: "Asia/Kolkata", watermark: "text", watermarkText: "Private chart", footprintImbalanceRatio: 5, footprintStackedImbalanceCount: 4, tpoBracketMinutes: 15, tpoValueAreaPercent: 80, sessionBreakLineStyle: "dotted", sessionBreakLineWidth: 3, pricePrecision: 4, tradingHoursMode: "regular", futureSetting: { nested: ["untouched", 29] } };
  const presets = Array.from({ length: 30 }, (_, index) => ({ name: index === 14 ? "Settings default" : `Private ${index}`, settings: { ...draftSettings(initial), ...hidden, title: index % 2 === 0, futurePerPreset: index }, updatedAt: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`, futurePresetMetadata: { index } }));
  return { presets, active: "Settings default", preferences: clone(initialPreferences) };
}
function item(key: string, value: unknown) { return { namespace: "edgelab", key, value: clone(value), updated_at: "2026-09-15T10:30:00.000Z" }; }
function chartResponse(store: Store) { return { presets: item(keys.presets, store.presets), active: item(keys.active, store.active) }; }
function mergeChart(store: Store, changes: Settings) {
  let target = store.presets.find((preset) => preset.name === "Settings default");
  if (!target) {
    const active = store.presets.find((preset) => preset.name === store.active);
    target = { name: "Settings default", settings: clone(active?.settings ?? draftSettings(initial)), updatedAt: "2026-09-15T10:30:00.000Z" };
    store.presets.unshift(target);
  }
  target.settings = { ...target.settings, ...aliases(changes) };
  target.updatedAt = "2026-09-15T10:30:00.000Z";
  store.active = "Settings default";
}
async function fixture(page: Page, fallback: boolean, setup = true) {
  if (setup) { await installDeterminism(page, { rollout: fallback ? "fallback" : "enabled" }); await seedApprovedSession(page); }
  const state = { fallback, owner: betaSessionResponse.user.id as number, stores: new Map<number, Store>([[betaSessionResponse.user.id, initialStore()]]), chartReads: [] as number[], preferenceReads: [] as number[], writes: [] as Write[], preferenceWrites: [] as Write[], legacyWrites: [] as Array<{ owner: number; key: string; value: unknown }>, failChartRead: 0, failPreferenceRead: 0, failChartWrite: false, failPreferenceWrite: false, chartReadAck: undefined as unknown, chartAck: undefined as unknown, preferenceAck: undefined as unknown, gates: new Map<string, Promise<void>>() };
  const storeFor = (owner: number) => { if (!state.stores.has(owner)) state.stores.set(owner, initialStore()); return state.stores.get(owner)!; };
  await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: { revision: state.fallback ? "chart-appearance-fallback" : "chart-appearance-modern", kill_switch: state.fallback, flags: { shell: true, journal: true, settings: true, chart: true, public: true } } }));
  await page.route("**/api/settings/chart", async (route) => {
    const owner = state.owner, store = storeFor(owner);
    if (route.request().method() === "GET") {
      state.chartReads.push(owner);
      if (state.failChartRead) return route.fulfill({ status: state.failChartRead, json: { detail: "Strict chart read unavailable or corrupt" } });
      return route.fulfill({ json: state.chartReadAck !== undefined ? state.chartReadAck : chartResponse(store) });
    }
    expect(route.request().method()).toBe("PATCH");
    const body = route.request().postDataJSON() as Settings;
    expect(Object.keys(body).every((key) => key in labels)).toBe(true);
    if ("textSize" in body) { expect(typeof body.textSize).toBe("number"); expect(Number.isInteger(body.textSize)).toBe(true); }
    state.writes.push({ owner, body: clone(body) });
    const gate = state.gates.get("chart"); if (gate) await gate;
    if (state.failChartWrite) return route.fulfill({ status: 503, json: { detail: "Strict chart save unavailable" } });
    mergeChart(store, body);
    return route.fulfill({ json: state.chartAck !== undefined ? state.chartAck : chartResponse(store) });
  });
  await page.route(`**/api/app-storage/edgelab/${keys.preferences}`, async (route) => {
    expect(route.request().method()).toBe("GET");
    state.preferenceReads.push(state.owner);
    if (state.failPreferenceRead) return route.fulfill({ status: state.failPreferenceRead, json: { detail: "Strict preferences unavailable" } });
    return route.fulfill({ json: item(keys.preferences, storeFor(state.owner).preferences) });
  });
  await page.route("**/api/settings/preferences", async (route) => {
    expect(route.request().method()).toBe("PATCH");
    const owner = state.owner, store = storeFor(owner), body = route.request().postDataJSON() as Settings;
    expect(Object.keys(body).every((key) => key === "density" || key === "includeDiagnosticsByDefault")).toBe(true);
    state.preferenceWrites.push({ owner, body: clone(body) });
    const gate = state.gates.get("preferences"); if (gate) await gate;
    if (state.failPreferenceWrite) return route.fulfill({ status: 503, json: { detail: "Strict preference save unavailable" } });
    store.preferences = { ...store.preferences, ...body };
    return route.fulfill({ json: state.preferenceAck !== undefined ? state.preferenceAck : item(keys.preferences, store.preferences) });
  });
  for (const [key, field] of [[keys.presets, "presets"], [keys.active, "active"]] as const) {
    await page.route(`**/api/app-storage/edgelab/${key}`, async (route) => {
      const owner = state.owner, store = storeFor(owner);
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(Object.keys(body)).toEqual(["value"]);
        state.legacyWrites.push({ owner, key, value: clone(body.value) });
        const gate = state.gates.get(key); if (gate) await gate;
        if (field === "presets") store.presets = clone(body.value); else store.active = body.value;
      } else expect(route.request().method()).toBe("GET");
      return route.fulfill({ json: item(key, store[field]) });
    });
  }
  return state;
}
type State = Awaited<ReturnType<typeof fixture>>;
function hold(state: State, key = "chart") { let release!: () => void; state.gates.set(key, new Promise<void>((resolve) => { release = resolve; })); return () => { state.gates.delete(key); release(); }; }
async function expectValues(page: Page, values: Draft = initial) { for (const field of Object.keys(labels) as Field[]) await expect(control(page, field)).toHaveValue(values[field]); }
async function edit(page: Page, values: Partial<Draft>) { for (const [field, value] of Object.entries(values) as Array<[Field, string]>) { if (["timeHoursFormat", "dateFormat", "gridMode"].includes(field)) await control(page, field).selectOption(value); else await control(page, field).fill(value); } }
async function switchRenderer(page: Page, state: State, fallback: boolean, category: string, hot = false) {
  state.fallback = fallback;
  if (hot) await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); else await page.reload({ waitUntil: "domcontentloaded" });
  await expect(boundary(page)).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
  await expect(page).toHaveURL(new RegExp(`/app/settings/${category}$`));
}
async function cached(page: Page, key = keys.presets) { return page.evaluate(async (storageKey) => { const modulePath = "/src/lib/serverStorage.ts"; const module = await import(modulePath); return module.getCachedAppStorageItem(storageKey, "unconfirmed"); }, key); }
async function local(page: Page, key: string, owner = betaSessionResponse.user.id) { return page.evaluate(({ key, owner }) => { const raw = localStorage.getItem(`edgelab.${key}.user-${owner}`); try { return raw == null ? null : JSON.parse(raw); } catch { return raw; } }, { key, owner }); }
async function preferencesConsumer(page: Page) { return page.evaluate(async () => { const modulePath = "/src/lib/settingsPreferences.ts"; return (await import(modulePath)).loadSettingsPreferences(); }); }
async function chartConsumer(page: Page) { return page.evaluate(async () => { const modulePath = "/src/lib/chartSettings.ts"; return (await import(modulePath)).loadActiveChartSettingsPreset(); }); }
async function setOwner(page: Page, state: State, id: number) {
  state.owner = id;
  await page.evaluate(async (session) => { const modulePath = "/src/lib/authSession.ts"; (await import(modulePath)).setStoredAuthSession(session); }, { createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at, token: `chart-owner-${id}`, user: { approved: true, betaPosition: null, email: betaSessionResponse.user.email, id, isBetaUser: true, name: betaSessionResponse.user.name, plan: "beta", provider: "google" } });
}
async function auditPanel(page: Page, category: string) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: axe.source });
  const panel = chartRow(page, category);
  const violations = await panel.evaluate(async (node) => (await window.axe.run(node, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`));
  expect(violations, `${category} chart controls WCAG 2.2 AA`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "Horizontal overflow").toBeLessThanOrEqual(1);
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    const undersized = await panel.locator('button:visible, input:visible, select:visible').evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { height: rect.height, width: rect.width, label: node.getAttribute("aria-label") || node.textContent?.trim() }; }).filter(({ height, width }) => height < 44 || width < 44));
    expect(undersized, "Chart touch targets below 44px").toEqual([]);
  }
}
async function capture(page: Page, category: string, fallback: boolean, info: TestInfo, state?: "saving" | "invalid" | "error") {
  if (state ? process.env.EDGELAB_CHART_SETTINGS_STATE_CAPTURE !== "1" || info.project.name !== "desktop" || fallback || category !== "chart" : process.env.EDGELAB_CHART_SETTINGS_CAPTURE !== "1" || !["desktop", "tablet", "mobile"].includes(info.project.name)) return;
  const directory = ".impeccable/review/chart-appearance15";
  await mkdir(directory, { recursive: true });
  const sources = ["frontend/src/components/settings/ChartSettingsPanel.tsx", "frontend/src/components/settings/useChartSettings.ts", "frontend/src/components/settings/useSettingsPreferences.ts", "frontend/src/components/settings/SettingsCenter.tsx", "frontend/src/components/compatibility/CompatibilityRouteRenderer.tsx", "frontend/src/components/EdgeLabWorkspace.tsx"];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (source) => [source, createHash("sha256").update(await readFile(source)).digest("hex")])));
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); const workspace = document.querySelector<HTMLElement>("#workspace-content"); if (workspace) workspace.scrollTop = 0; });
  for (const view of state ? [state] : ["top", "controls"]) {
    if (state) await control(page, "textSize").scrollIntoViewIfNeeded(); else if (view !== "top") await apply(page, category).scrollIntoViewIfNeeded();
    const output = `${directory}/${fallback ? "fallback" : "modern"}-${category}-${info.project.name}-${view}.png`;
    const image = await page.screenshot({ path: output, animations: "disabled", fullPage: false });
    const geometry = await page.evaluate(() => { const workspace = document.querySelector<HTMLElement>("#workspace-content"); return { scrollY, fontsLoaded: document.fonts.status === "loaded", workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop } : null }; });
    await writeFile(`${output}.json`, JSON.stringify({ path: output, route: `/app/settings/${category}`, url: page.url(), renderer: fallback ? "fallback" : "modern", project: info.project.name, state: state ?? "loaded", captureMode: "native viewport", viewport: page.viewportSize(), width: image.readUInt32BE(16), height: image.readUInt32BE(20), ...geometry, sourceHashes, sourceVariant: "current primary checkout, including pre-existing user shell changes" }, null, 2));
  }
}

for (const category of ["chart", "appearance"]) for (const fallback of [true, false]) {
  const title = `${fallback ? "fallback" : "modern"} ${category}`;
  const path = `/app/settings/${category}`;
  test(`${title} loads all nine controls and atomically applies only explicit changes without dropping hidden or excess presets`, async ({ page }, info) => {
    const state = await fixture(page, fallback), before = clone(state.stores.get(state.owner)!);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expectValues(page);
    await expect.poll(() => state.chartReads.length).toBeGreaterThan(0);
    for (const field of ["backgroundColor", "textColor", "gridColor", "candleUpColor", "candleDownColor"] as Field[]) { await expect(control(page, field)).toHaveAttribute("type", "color"); await expect(control(page, field)).toHaveValue(/^#[a-f0-9]{6}$/i); }
    await auditPanel(page, category);
    await capture(page, category, fallback, info);
    await edit(page, changed);
    expect(state.writes).toEqual([]);
    const release = hold(state);
    await apply(page, category).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(saved(page, category)).toHaveCount(0);
    expect(state.stores.get(state.owner)).toEqual(before);
    expect(await cached(page)).toEqual(before.presets);
    expect(await local(page, keys.presets)).toEqual(before.presets);
    await capture(page, category, fallback, info, "saving");
    release();
    await expect(saved(page, category)).toBeVisible();
    expect(state.writes).toEqual([{ owner: state.owner, body: draftSettings(changed) }]);
    expect(state.legacyWrites).toEqual([]);
    const after = clone(before); mergeChart(after, draftSettings(changed));
    expect(state.stores.get(state.owner)).toEqual(after);
    expect(after.presets).toHaveLength(30);
    expect(after.presets.map((preset) => preset.name)).toEqual(before.presets.map((preset) => preset.name));
    await expect.poll(() => cached(page)).toEqual(after.presets);
    await expect.poll(() => cached(page, keys.active)).toBe("Settings default");
    const consumer = await chartConsumer(page);
    expect(consumer.settings.bodyUpColor.toLowerCase()).toBe(changed.candleUpColor);
    expect(consumer.settings.bodyDownColor.toLowerCase()).toBe(changed.candleDownColor);
    for (const next of [!fallback, fallback]) { await switchRenderer(page, state, next, category); await expectValues(page, changed); }
    expect(state.writes).toHaveLength(1);
    await auditPanel(page, category);
  });

  test(`${title} new Settings default clones the active full settings and preserves every existing preset`, async ({ page }) => {
    const state = await fixture(page, fallback), store = state.stores.get(state.owner)!;
    store.presets = store.presets.filter((preset) => preset.name !== "Settings default"); store.active = "Private 27";
    const before = clone(store);
    await gotoStable(page, path, { waitForNetworkIdle: false }); await expectValues(page);
    await edit(page, { textSize: "16" }); await apply(page, category).click(); await expect(saved(page, category)).toBeVisible();
    expect(state.writes).toEqual([{ owner: state.owner, body: { textSize: 16 } }]);
    expect(store.presets.filter((preset) => preset.name !== "Settings default")).toEqual(before.presets);
    expect(store.presets.find((preset) => preset.name === "Settings default")?.settings).toEqual({ ...before.presets.find((preset) => preset.name === before.active)!.settings, textSize: 16 });
    expect(store.presets).toHaveLength(30); expect(store.active).toBe("Settings default");
    await switchRenderer(page, state, !fallback, category); await expectValues(page, { ...initial, textSize: "16" });
    store.active = "Private 27"; await page.reload({ waitUntil: "domcontentloaded" });
    await expectValues(page, { ...initial, textSize: "16" });
    await edit(page, { dateFormat: "yyyy-MM-dd" }); await apply(page, category).click(); await expect(saved(page, category)).toBeVisible();
    expect(state.writes[1]).toEqual({ owner: state.owner, body: { dateFormat: "yyyy-MM-dd" } });
    expect(store.presets.find((preset) => preset.name === "Settings default")?.settings).toEqual({ ...before.presets.find((preset) => preset.name === before.active)!.settings, textSize: 16, dateFormat: "yyyy-MM-dd" });
    expect(store.active).toBe("Settings default");
  });

  test(`${title} strict reads reject unavailable, corrupt and malformed data and keep raw invalid text-size drafts`, async ({ page }, info) => {
    const state = await fixture(page, fallback); state.failChartRead = 503;
    await gotoStable(page, path, { waitForNetworkIdle: false });
    const loadRetry = page.getByRole("button", { name: "Retry loading chart settings", exact: true });
    await expect(loadRetry).toBeVisible(); await expect(control(page, "textSize")).toBeDisabled(); expect(state.writes).toEqual([]);
    state.failChartRead = 409; const reads = state.chartReads.length; await loadRetry.click(); await expect.poll(() => state.chartReads.length).toBe(reads + 1); await expect(loadRetry).toBeVisible();
    state.failChartRead = 0; state.chartReadAck = { presets: item(keys.presets, "corrupt array"), active: item(keys.active, "Settings default") };
    const corruptReads = state.chartReads.length; await loadRetry.click(); await expect.poll(() => state.chartReads.length).toBe(corruptReads + 1); await expect(loadRetry).toBeVisible(); await expect(apply(page, category)).toBeDisabled();
    state.chartReadAck = undefined; await loadRetry.click(); await expectValues(page);
    for (const invalid of ["", "9", "19", "12.5", "not a size"]) {
      await control(page, "textSize").fill(invalid); await expect(control(page, "textSize")).toHaveValue(invalid); await expect(control(page, "textSize")).toHaveAttribute("aria-invalid", "true"); await expect(apply(page, category)).toBeDisabled(); expect(state.writes).toEqual([]);
    }
    await capture(page, category, fallback, info, "invalid");
    await switchRenderer(page, state, !fallback, category, true); await expect(control(page, "textSize")).toHaveValue("not a size");
    await page.reload({ waitUntil: "domcontentloaded" }); await expect(control(page, "textSize")).toHaveValue("not a size");
    await control(page, "textSize").fill(initial.textSize); await expect(apply(page, category)).toBeDisabled(); expect(state.writes).toEqual([]);
  });

  test(`${title} failed and malformed atomic acknowledgments retain draft, cache and Retry until both records acknowledge`, async ({ page }, info) => {
    const state = await fixture(page, fallback), before = clone(state.stores.get(state.owner)!);
    await gotoStable(page, path, { waitForNetworkIdle: false }); await expectValues(page);
    state.failChartWrite = true; await edit(page, { textSize: "16" }); await apply(page, category).click();
    await expect(retry(page, category)).toBeVisible(); await expect(saved(page, category)).toHaveCount(0); await capture(page, category, fallback, info, "error");
    expect(await cached(page)).toEqual(before.presets); expect(await local(page, keys.presets)).toEqual(before.presets);
    await switchRenderer(page, state, !fallback, category, true); await expect(control(page, "textSize")).toHaveValue("16"); await expect(retry(page, category)).toBeVisible();
    state.failChartWrite = false;
    for (const bad of [() => null, () => ({ presets: item(keys.presets, before.presets), active: item(keys.active, "Settings default") }), () => ({ presets: item(keys.presets, state.stores.get(state.owner)!.presets), active: item(keys.active, null) }), () => ({ presets: item("wrong-key", state.stores.get(state.owner)!.presets), active: item(keys.active, "Settings default") })]) {
      state.chartAck = bad(); const writes = state.writes.length; await retry(page, category).click(); await expect.poll(() => state.writes.length).toBe(writes + 1); await expect(retry(page, category)).toBeVisible(); await expect(saved(page, category)).toHaveCount(0); await expect(control(page, "textSize")).toHaveValue("16"); expect(await cached(page)).toEqual(before.presets); expect(await cached(page, keys.active)).toBe(before.active);
    }
    state.chartAck = undefined; await retry(page, category).click(); await expect(saved(page, category)).toBeVisible();
    expect(state.writes.map(({ body }) => body)).toEqual(Array.from({ length: 6 }, () => ({ textSize: 16 })));
    await expect.poll(() => cached(page)).toEqual(state.stores.get(state.owner)!.presets); expect(state.legacyWrites).toEqual([]);
    await switchRenderer(page, state, fallback, category); await expectValues(page, { ...initial, textSize: "16" });
  });

  test(`${title} reset has the route's exact scope and density Retry and Undo preserve diagnostics and staged chart fields`, async ({ page }) => {
    const state = await fixture(page, fallback);
    await gotoStable(page, path, { waitForNetworkIdle: false }); await expectValues(page);
    if (category === "chart") {
      const defaults = await page.evaluate(async () => { const modulePath = "/src/lib/chartSettings.ts"; return (await import(modulePath)).DEFAULT_CHART_VISUAL_SETTINGS; });
      await reset(page).click(); const expected = Object.fromEntries((Object.keys(labels) as Field[]).map((field) => [field, String(defaults[field]).toLowerCase().startsWith("#") ? String(defaults[field]).toLowerCase() : String(defaults[field])])) as Draft;
      await expectValues(page, expected); expect(state.writes).toEqual([]); expect(state.preferenceWrites).toEqual([]);
      await apply(page, category).click(); await expect(saved(page, category)).toBeVisible();
      const differences = Object.fromEntries((Object.keys(labels) as Field[]).map((field) => [field, field.endsWith("Color") ? String(defaults[field]).toUpperCase() : defaults[field]]).filter(([key, value]) => value !== draftSettings(initial)[String(key)]));
      expect(state.writes).toEqual([{ owner: state.owner, body: differences }]);
      return;
    }
    const density = page.getByLabel("Settings density", { exact: true });
    await expect(density).toHaveValue("comfortable"); await edit(page, { textSize: "16", candleUpColor: "#44bb88" });
    state.failPreferenceWrite = true; await density.selectOption("compact");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe("compact");
    await expect(densityRow(page).getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    expect(state.preferenceWrites).toEqual([{ owner: state.owner, body: { density: "compact" } }]); expect(state.writes).toEqual([]);
    expect(await preferencesConsumer(page)).toEqual({ density: "comfortable", includeDiagnosticsByDefault: false });
    state.failPreferenceWrite = false; state.preferenceAck = item(keys.preferences, { ...initialPreferences, density: "comfortable" });
    await densityRow(page).getByRole("button", { name: "Retry", exact: true }).click(); await expect(densityRow(page).getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    expect(await preferencesConsumer(page)).toEqual({ density: "comfortable", includeDiagnosticsByDefault: false });
    state.preferenceAck = undefined; await densityRow(page).getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => preferencesConsumer(page)).toEqual({ density: "compact", includeDiagnosticsByDefault: false });
    await reset(page).click(); await expect(density).toHaveValue("comfortable"); await expect.poll(() => state.stores.get(state.owner)?.preferences.density).toBe("comfortable");
    await expect(control(page, "textSize")).toHaveValue("16"); await expect(control(page, "candleUpColor")).toHaveValue("#44bb88"); expect(state.writes).toEqual([]);
    expect(state.stores.get(state.owner)?.preferences).toEqual(initialPreferences);
    await undo(page).click(); await expect(density).toHaveValue("compact"); await expect.poll(() => state.stores.get(state.owner)?.preferences.density).toBe("compact");
    expect(state.preferenceWrites.map(({ body }) => body)).toEqual([{ density: "compact" }, { density: "compact" }, { density: "compact" }, { density: "comfortable" }, { density: "compact" }]);
    await apply(page, category).click(); await expect(saved(page, category)).toBeVisible(); expect(state.writes).toEqual([{ owner: state.owner, body: { textSize: 16, candleUpColor: "#44bb88" } }]);
    expect(state.stores.get(state.owner)?.preferences).toEqual({ ...initialPreferences, density: "compact" });
  });

  test(`${title} density strict loading failure is independent from usable staged chart settings`, async ({ page }) => {
    test.skip(category !== "appearance", "Density belongs to appearance");
    const state = await fixture(page, fallback); state.failPreferenceRead = 503;
    await gotoStable(page, path, { waitForNetworkIdle: false }); await expectValues(page);
    const loadRetry = page.getByRole("button", { name: "Retry loading preferences", exact: true });
    await expect(loadRetry).toBeVisible(); await expect(page.getByLabel("Settings density", { exact: true })).toBeDisabled();
    await edit(page, { gridMode: "none" }); await apply(page, category).click(); await expect(saved(page, category)).toBeVisible();
    expect(state.preferenceWrites).toEqual([]); state.failPreferenceRead = 0; await loadRetry.click(); await expect(page.getByLabel("Settings density", { exact: true })).toHaveValue("comfortable");
    await expect(control(page, "gridMode")).toHaveValue("none"); expect(state.writes).toEqual([{ owner: state.owner, body: { gridMode: "none" } }]);
  });

  test(`${title} pending hot renderer switches preserve later edits and return-to-original until a separate apply`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Pending race covered at desktop");
    const state = await fixture(page, fallback);
    await gotoStable(page, path, { waitForNetworkIdle: false }); await expectValues(page);
    const release = hold(state); await edit(page, { textSize: "16" }); await apply(page, category).click(); await expect.poll(() => state.writes.length).toBe(1);
    await expect(apply(page, category)).toBeDisabled(); await edit(page, { textSize: initial.textSize, gridMode: "none" });
    await switchRenderer(page, state, !fallback, category, true); await expect(control(page, "textSize")).toHaveValue(initial.textSize); await expect(control(page, "gridMode")).toHaveValue("none"); await expect(apply(page, category)).toBeDisabled();
    expect(state.writes).toHaveLength(1); release(); await expect(apply(page, category)).toBeEnabled(); await expect(saved(page, category)).toHaveCount(0);
    await expect(control(page, "textSize")).toHaveValue(initial.textSize); await expect(control(page, "gridMode")).toHaveValue("none");
    await apply(page, category).click(); await expect(saved(page, category)).toBeVisible();
    expect(state.writes.map(({ body }) => body)).toEqual([{ textSize: 16 }, { textSize: 14, gridMode: "none" }]);
    await switchRenderer(page, state, fallback, category); await expectValues(page, { ...initial, gridMode: "none" });
    if (category === "appearance") {
      const density = page.getByLabel("Settings density", { exact: true }), releaseDensity = hold(state, "preferences");
      await density.selectOption("compact"); await expect.poll(() => state.preferenceWrites.length).toBe(1); await density.selectOption("comfortable"); await switchRenderer(page, state, !fallback, category, true);
      await expect(density).toHaveValue("comfortable"); expect(state.preferenceWrites).toHaveLength(1); releaseDensity();
      await expect.poll(() => state.preferenceWrites.length).toBe(2); await expect.poll(() => preferencesConsumer(page)).toEqual({ density: "comfortable", includeDiagnosticsByDefault: false });
      expect(state.preferenceWrites.map(({ body }) => body)).toEqual([{ density: "compact" }, { density: "comfortable" }]);
    }
  });

  test(`${title} private owner raw drafts survive another owner's late completion`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Owner isolation covered at desktop");
    await installDeterminism(page, { rollout: fallback ? "fallback" : "enabled" }); const state = await fixture(page, fallback, false);
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ...betaSessionResponse, token: `chart-owner-${state.owner}`, user: { ...betaSessionResponse.user, id: state.owner } } }));
    await gotoStable(page, "/", { waitForNetworkIdle: false }); const firstOwner = betaSessionResponse.user.id;
    await setOwner(page, state, firstOwner); await gotoStable(page, path, { waitForNetworkIdle: false }); await expectValues(page);
    const release = hold(state); await edit(page, { textSize: "16" }); await apply(page, category).click(); await expect.poll(() => state.writes.length).toBe(1);
    await control(page, "textSize").fill("Owner one private invalid draft"); await setOwner(page, state, firstOwner + 1); await expectValues(page);
    await control(page, "textSize").fill("Owner two private invalid draft"); release();
    await expect.poll(() => state.stores.get(firstOwner)?.presets.find((preset) => preset.name === "Settings default")?.settings.textSize).toBe(16);
    await expect(control(page, "textSize")).toHaveValue("Owner two private invalid draft"); expect((await cached(page) as Preset[]).find((preset) => preset.name === "Settings default")?.settings.textSize).toBe(14);
    await setOwner(page, state, firstOwner); await expect(control(page, "textSize")).toHaveValue("Owner one private invalid draft"); await expect(control(page, "textSize")).toBeEnabled();
    await control(page, "textSize").fill("17"); await apply(page, category).click(); await expect(saved(page, category)).toBeVisible();
    await setOwner(page, state, firstOwner + 1); await expect(control(page, "textSize")).toHaveValue("Owner two private invalid draft");
    expect(state.writes).toEqual([{ owner: firstOwner, body: { textSize: 16 } }, { owner: firstOwner, body: { textSize: 17 } }]);
    if (category === "appearance") {
      await control(page, "textSize").fill(initial.textSize); await setOwner(page, state, firstOwner);
      const releasePreference = hold(state, "preferences"); await page.getByLabel("Settings density", { exact: true }).selectOption("compact"); await expect.poll(() => state.preferenceWrites.length).toBe(1);
      await setOwner(page, state, firstOwner + 1); await expect(page.getByLabel("Settings density", { exact: true })).toHaveValue("comfortable"); releasePreference();
      await expect.poll(() => state.stores.get(firstOwner)?.preferences.density).toBe("compact"); expect(await preferencesConsumer(page)).toEqual({ density: "comfortable", includeDiagnosticsByDefault: false });
      await setOwner(page, state, firstOwner); await expect(page.getByLabel("Settings density", { exact: true })).toHaveValue("compact");
    }
  });

  test(`${title} held atomic save rebases later legacy exposed and hidden edits with other new and deleted presets`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Queued legacy merge covered at desktop");
    const state = await fixture(page, fallback); await gotoStable(page, path, { waitForNetworkIdle: false }); await expectValues(page);
    const before = clone(state.stores.get(state.owner)!), release = hold(state);
    await edit(page, { textSize: "16", candleUpColor: "#44bb88" }); await apply(page, category).click(); await expect.poll(() => state.writes.length).toBe(1);
    await page.evaluate(async () => {
      const modulePath = "/src/lib/chartSettings.ts", charts = await import(modulePath);
      const active = charts.loadActiveChartSettingsPreset();
      charts.saveChartSettingsPreset("Settings default", { ...active.settings, gridMode: "none", watermarkText: "Later hidden legacy edit" });
      charts.saveChartSettingsPreset("Other later preset", { ...active.settings, textSize: 18, watermarkText: "Other legacy private edit" });
      charts.deleteChartSettingsPreset("Private 29");
    });
    expect(state.legacyWrites).toEqual([]); release();
    await expect.poll(() => state.legacyWrites.filter(({ key }) => key === keys.presets).length).toBeGreaterThanOrEqual(3);
    await expect.poll(() => state.stores.get(state.owner)?.presets.some((preset) => preset.name === "Private 29")).toBe(false);
    const store = state.stores.get(state.owner)!, target = store.presets.find((preset) => preset.name === "Settings default")!;
    expect(target.settings).toMatchObject({ textSize: 16, candleUpColor: "#44bb88", bodyUpColor: "#44bb88", gridMode: "none", watermarkText: "Later hidden legacy edit", futureSetting: { nested: ["untouched", 29] } });
    expect(target.settings.borderUpColor).toBe(before.presets.find((preset) => preset.name === "Settings default")!.settings.borderUpColor);
    expect(target.settings.wickUpColor).toBe(before.presets.find((preset) => preset.name === "Settings default")!.settings.wickUpColor);
    expect(store.presets.find((preset) => preset.name === "Other later preset")?.settings).toMatchObject({ textSize: 18, watermarkText: "Other legacy private edit" });
    for (const preset of before.presets.filter((preset) => !["Settings default", "Private 29"].includes(preset.name))) expect(store.presets.find((item) => item.name === preset.name)).toEqual(preset);
    expect(store.presets).toHaveLength(30); expect(state.writes).toEqual([{ owner: state.owner, body: { textSize: 16, candleUpColor: "#44bb88" } }]);
    await switchRenderer(page, state, !fallback, category); await expectValues(page, { ...initial, textSize: "16", gridMode: "none", candleUpColor: "#44bb88" });
    const consumer = await chartConsumer(page); expect(consumer.name).toBe("Other later preset"); expect(consumer.settings.textSize).toBe(18);
  });
}
