import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import axe from "axe-core";
import { betaSessionResponse, gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

test.use({ video: "off" });
const path = "/app/settings/backtest";
const keys = {
  sizingMode: "order-sizing-mode.v1", quantity: "order-default-quantity.v1", riskPercent: "order-default-risk-percent.v1",
  riskBase: "order-risk-base.v1", commissionMode: "order-commission-mode.v1", commissionFixed: "order-commission-fixed.v1",
  commissionPercent: "order-commission-percent.v1", feeMode: "order-fee-mode.v1", feeFixed: "order-fee-fixed.v1",
  feePercent: "order-fee-percent.v1", lineConfirmation: "order-line-modification-confirmation.v1",
} as const;
type Field = keyof typeof keys;
type Values = Record<Field, string | boolean>;
const initial: Values = {
  sizingMode: "risk", quantity: "25000", riskPercent: "2.5", riskBase: "INITIAL_BALANCE",
  commissionMode: "FIXED", commissionFixed: "7.25", commissionPercent: "0.35",
  feeMode: "PERCENT", feeFixed: "3.75", feePercent: "0.15", lineConfirmation: false,
};
const defaults: Values = {
  sizingMode: "quantity", quantity: "100000", riskPercent: "1", riskBase: "CURRENT_BALANCE",
  commissionMode: "NONE", commissionFixed: "0", commissionPercent: "0",
  feeMode: "NONE", feeFixed: "0", feePercent: "0", lineConfirmation: true,
};
const names: Record<Field, string> = {
  sizingMode: "Sizing mode", quantity: "Default quantity", riskPercent: "Default risk percentage", riskBase: "Risk basis",
  commissionMode: "Commission mode", commissionFixed: "Commission fixed amount", commissionPercent: "Commission percentage",
  feeMode: "Fee mode", feeFixed: "Fee fixed amount", feePercent: "Fee percentage", lineConfirmation: "Require chart-line confirmation",
};
type Write = { owner: number; key: string; body: { value: unknown } };
const control = (page: Page, field: Field) => page.getByLabel(names[field], { exact: true });
const boundary = (page: Page) => page.locator('[data-route-group="settings"]');
const rowIds: Record<Field, string> = {
  sizingMode: "sizing-mode", quantity: "default-quantity", riskPercent: "default-risk", riskBase: "risk-basis",
  commissionMode: "trading-costs", commissionFixed: "trading-costs", commissionPercent: "trading-costs",
  feeMode: "trading-costs", feeFixed: "trading-costs", feePercent: "trading-costs", lineConfirmation: "line-confirmation",
};
const row = (page: Page, field: Field) => page.locator(`[data-setting-control="${rowIds[field]}"]`);
const saved = (page: Page, field: Field = "quantity") => row(page, field).getByRole("status").filter({ hasText: /^Saved$/ });
const retry = (page: Page, field: Field = "quantity") => row(page, field).getByRole("button", { name: "Retry", exact: true });
const reset = (page: Page) => page.getByRole("button", { name: /^Reset section(?: · Unsaved)?$/ });
const undo = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const storageValues = (values: Values) => Object.fromEntries(Object.entries(keys).map(([field, key]) => [key, values[field as Field]]));

async function fixture(page: Page, fallback = true, setup = true) {
  if (setup) {
    await installDeterminism(page, { rollout: fallback ? "fallback" : "enabled" });
    await seedApprovedSession(page);
  }
  const unknownKey = "order-future-private-setting.v9";
  const state = {
    fallback, owner: betaSessionResponse.user.id,
    failReads: new Set<string>(), failWrites: new Set<string>(),
    acknowledgments: new Map<string, unknown>(),
    gates: new Map<string, Promise<void>>(), reads: [] as Array<{ owner: number; key: string }>, writes: [] as Write[],
    stores: new Map<number, Record<string, unknown>>([[betaSessionResponse.user.id, { ...storageValues(initial), [unknownKey]: { keep: ["untouched", 19] } }]]),
  };
  await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: {
    revision: state.fallback ? "backtest-defaults-fallback" : "backtest-defaults-modern", kill_switch: state.fallback,
    flags: { shell: true, journal: true, settings: true, chart: true, public: true },
  } }));
  // Exact per-key endpoints: an unrelated journal/settings route must never
  // accidentally acknowledge or rewrite these independent defaults.
  for (const key of [...Object.values(keys), unknownKey]) {
    await page.route(`**/api/app-storage/edgelab/${key}`, async (route) => {
      const owner = state.owner;
      const store = state.stores.get(owner) ?? { ...storageValues(initial), [unknownKey]: { keep: ["untouched", 19] } };
      state.stores.set(owner, store);
      if (route.request().method() === "GET") {
        state.reads.push({ owner, key });
        if (state.failReads.has(key)) return route.fulfill({ status: 503, json: { detail: "Strict defaults read unavailable" } });
      } else {
        expect(route.request().method()).toBe("PUT");
        expect(Object.values(keys)).toContain(key);
        const body = route.request().postDataJSON() as { value: unknown };
        expect(Object.keys(body)).toEqual(["value"]);
        state.writes.push({ owner, key, body });
        const gate = state.gates.get(key);
        if (gate) await gate;
        if (state.failWrites.has(key)) return route.fulfill({ status: 503, json: { detail: `Strict ${key} save unavailable` } });
        store[key] = state.acknowledgments.has(key) ? state.acknowledgments.get(key) : body.value;
      }
      return route.fulfill({ json: { namespace: "edgelab", key, value: store[key] ?? null, updated_at: "2026-09-15T10:30:00.000Z" } });
    });
  }
  return state;
}
type State = Awaited<ReturnType<typeof fixture>>;

async function expectValues(page: Page, values: Values = initial) {
  for (const field of ["sizingMode", "quantity", "riskPercent", "riskBase", "commissionMode", "feeMode"] as Field[]) {
    await expect(control(page, field)).toHaveValue(String(values[field]));
  }
  for (const [mode, fixed, percent] of [["commissionMode", "commissionFixed", "commissionPercent"], ["feeMode", "feeFixed", "feePercent"]] as Field[][]) {
    if (values[mode] === "FIXED") await expect(control(page, fixed)).toHaveValue(String(values[fixed]));
    if (values[mode] === "PERCENT") await expect(control(page, percent)).toHaveValue(String(values[percent]));
  }
  if (values.lineConfirmation) await expect(control(page, "lineConfirmation")).toBeChecked();
  else await expect(control(page, "lineConfirmation")).not.toBeChecked();
}
async function switchRenderer(page: Page, state: State, fallback: boolean, hot = false) {
  state.fallback = fallback;
  if (hot) await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  else await page.reload({ waitUntil: "domcontentloaded" });
  await expect(boundary(page)).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}
async function cached(page: Page, field: Field) {
  return page.evaluate(async (key) => {
    const modulePath = "/src/lib/serverStorage.ts";
    const { getCachedAppStorageItem } = await import(modulePath);
    return getCachedAppStorageItem(key, "unconfirmed");
  }, keys[field]);
}
async function mirror(page: Page, field: Field, owner = betaSessionResponse.user.id) {
  return page.evaluate(({ key, owner }) => {
    const raw = localStorage.getItem(`edgelab.${key}.user-${owner}`);
    return key === "order-line-modification-confirmation.v1" && raw != null ? JSON.parse(raw) : raw;
  }, { key: keys[field], owner });
}
function hold(state: State, field: Field) {
  let release!: () => void;
  state.gates.set(keys[field], new Promise<void>((resolve) => { release = resolve; }));
  return () => { state.gates.delete(keys[field]); release(); };
}
function exactWrites(state: State, changes: Partial<Values>) {
  expect(state.writes).toEqual(Object.entries(changes).map(([field, value]) => ({
    owner: state.owner, key: keys[field as Field], body: { value },
  })));
}
async function freezeTimers(page: Page) {
  await page.clock.install({ time: new Date("2026-09-15T10:30:00.000Z") });
  await page.clock.pauseAt(new Date("2026-09-15T10:30:01.000Z"));
}
async function auditPanel(page: Page) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: axe.source });
  const panel = page.getByRole("region", { name: "Replay and order defaults", exact: true });
  const violations = await panel.evaluate(async (node) => (await window.axe.run(node, {
    resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
  })).violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`));
  expect(violations, "Backtest panel WCAG 2.2 AA violations").toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "Horizontal overflow").toBeLessThanOrEqual(1);
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
    const undersized = await panel.locator('button:visible, input:visible, select:visible').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { height: rect.height, width: rect.width, label: node.getAttribute("aria-label") || node.textContent?.trim() };
    }).filter(({ height, width }) => height < 44 || width < 44));
    expect(undersized, "Backtest touch targets below 44px").toEqual([]);
  }
}
async function capturePanel(page: Page, renderer: string, info: TestInfo) {
  if (process.env.EDGELAB_BACKTEST_SETTINGS_CAPTURE !== "1" || !["desktop", "tablet", "mobile"].includes(info.project.name)) return;
  const directory = ".impeccable/review/backtest-settings14";
  await mkdir(directory, { recursive: true });
  const sources = ["frontend/src/components/settings/BacktestSettingsPanel.tsx", "frontend/src/components/settings/useBacktestSettings.ts", "frontend/src/components/settings/SettingsCenter.tsx", "frontend/src/components/compatibility/CompatibilityRouteRenderer.tsx", "frontend/src/components/EdgeLabWorkspace.tsx"];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (source) => [source, createHash("sha256").update(await readFile(source)).digest("hex")])));
  await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); const workspace = document.querySelector<HTMLElement>("#workspace-content"); if (workspace) workspace.scrollTop = 0; });
  for (const view of ["top", "costs-confirmation"]) {
    if (view === "costs-confirmation") await control(page, "lineConfirmation").scrollIntoViewIfNeeded();
    const output = `${directory}/${renderer}-${info.project.name}-${view}.png`;
    const image = await page.screenshot({ path: output, animations: "disabled", fullPage: false });
    const geometry = await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>("#workspace-content");
      return { scrollY, fontsLoaded: document.fonts.status === "loaded", workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop } : null };
    });
    await writeFile(`${output}.json`, JSON.stringify({ path: output, route: path, url: page.url(), renderer, project: info.project.name,
      captureMode: "native viewport", viewport: page.viewportSize(), width: image.readUInt32BE(16), height: image.readUInt32BE(20),
      ...geometry, sourceHashes, sourceVariant: "current primary checkout, including pre-existing user shell changes" }, null, 2));
  }
}
async function captureState(page: Page, name: "saving" | "invalid" | "error", field: Field, fallback: boolean, info: TestInfo) {
  if (process.env.EDGELAB_BACKTEST_SETTINGS_STATE_CAPTURE !== "1" || info.project.name !== "desktop" || fallback) return;
  const directory = ".impeccable/review/backtest-settings14";
  await mkdir(directory, { recursive: true });
  await row(page, field).scrollIntoViewIfNeeded();
  await page.evaluate(async () => { await document.fonts.ready; });
  const output = `${directory}/modern-desktop-${name}.png`;
  const image = await page.screenshot({ path: output, animations: "disabled", fullPage: false });
  const sources = ["frontend/src/components/settings/BacktestSettingsPanel.tsx", "frontend/src/components/settings/useBacktestSettings.ts", "frontend/src/components/settings/SettingsCenter.tsx", "frontend/src/components/compatibility/CompatibilityRouteRenderer.tsx", "frontend/src/components/EdgeLabWorkspace.tsx"];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (source) => [source, createHash("sha256").update(await readFile(source)).digest("hex")])));
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>("#workspace-content");
    return { scrollY, fontsLoaded: document.fonts.status === "loaded", workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop } : null };
  });
  await writeFile(`${output}.json`, JSON.stringify({ path: output, route: path, url: page.url(), renderer: "modern", project: info.project.name,
    captureMode: "native viewport scrolled to state row", state: name, field: names[field], rowText: await row(page, field).innerText(),
    viewport: page.viewportSize(), width: image.readUInt32BE(16), height: image.readUInt32BE(20), ...geometry, sourceHashes,
    sourceVariant: "current primary checkout, including pre-existing user shell changes" }, null, 2));
}

for (const fallback of [true, false]) {
  const renderer = fallback ? "fallback" : "modern";
  test(`${renderer} backtest defaults read all eleven exact keys and retain acknowledged values through renderer reloads`, async ({ page }, info) => {
    const state = await fixture(page, fallback);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expectValues(page);
    await expect.poll(() => [...new Set(state.reads.map(({ key }) => key))].sort()).toEqual(Object.values(keys).sort());
    await expect(page.getByLabel("Settings density", { exact: true })).toHaveCount(0);
    await auditPanel(page);
    await capturePanel(page, renderer, info);
    const release = hold(state, "sizingMode");
    await control(page, "sizingMode").selectOption("quantity");
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(saved(page, "sizingMode")).toHaveCount(0);
    await captureState(page, "saving", "sizingMode", fallback, info);
    expect(state.stores.get(state.owner)?.[keys.sizingMode]).toBe(initial.sizingMode);
    expect(await cached(page, "sizingMode")).toBe(initial.sizingMode);
    expect(await mirror(page, "sizingMode")).toBe(initial.sizingMode);
    release();
    await expect(saved(page, "sizingMode")).toBeVisible();
    await expect.poll(() => cached(page, "sizingMode")).toBe("quantity");
    await expect.poll(() => mirror(page, "sizingMode")).toBe("quantity");
    exactWrites(state, { sizingMode: "quantity" });
    const expected = { ...initial, sizingMode: "quantity" };
    for (const next of [!fallback, fallback]) {
      const reads = state.reads.length;
      await switchRenderer(page, state, next);
      await expectValues(page, expected);
      await expect.poll(() => state.reads.length).toBeGreaterThanOrEqual(reads + 11);
      expect(state.stores.get(state.owner)).toEqual({ ...storageValues(expected), "order-future-private-setting.v9": { keep: ["untouched", 19] } });
    }
    expect(state.writes).toHaveLength(1);
    await auditPanel(page);
  });

  test(`${renderer} retries strict read failures and never saves invalid numeric drafts`, async ({ page }, info) => {
    const state = await fixture(page, fallback);
    state.failReads.add(keys.quantity);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    const loadRetry = page.getByRole("button", { name: "Retry loading settings", exact: true });
    await expect(loadRetry).toBeVisible();
    await expect(control(page, "quantity")).toBeDisabled();
    expect(state.writes).toEqual([]);
    state.failReads.clear();
    await loadRetry.click();
    await expectValues(page);
    await freezeTimers(page);
    for (const [field, invalid] of [["quantity", "0"], ["riskPercent", "101"], ["commissionFixed", "-1"], ["feePercent", "100.1"]] as Array<[Field, string]>) {
      await control(page, field).fill(invalid);
      await expect(control(page, field)).toHaveAttribute("aria-invalid", "true");
      await page.clock.runFor(900);
      expect(state.writes).toEqual([]);
      expect(await cached(page, field)).toBe(initial[field]);
      await control(page, field).fill(String(initial[field]));
    }
    await control(page, "quantity").fill("");
    await page.clock.runFor(900);
    expect(state.writes).toEqual([]);
    await captureState(page, "invalid", "quantity", fallback, info);
    await switchRenderer(page, state, !fallback, true);
    await expect(control(page, "quantity")).toHaveValue("");
    await expect(control(page, "quantity")).toHaveAttribute("aria-invalid", "true");
    await control(page, "quantity").fill(String(initial.quantity));
    await page.clock.runFor(900);
    expect(state.writes).toEqual([]);
  });

  test(`${renderer} numeric fields debounce for 600ms and write only changed active keys`, async ({ page }) => {
    const state = await fixture(page, fallback);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expectValues(page);
    await freezeTimers(page);
    await control(page, "quantity").fill("40000");
    await page.clock.runFor(450);
    expect(state.writes).toEqual([]);
    await control(page, "quantity").fill("45000");
    await page.clock.runFor(599);
    expect(state.writes).toEqual([]);
    await page.clock.runFor(1);
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(saved(page)).toBeVisible();
    exactWrites(state, { quantity: "45000" });
    await control(page, "commissionFixed").fill("8.75");
    await page.clock.runFor(600);
    await expect.poll(() => state.writes.length).toBe(2);
    await expect.poll(() => cached(page, "commissionFixed")).toBe("8.75");
    expect(state.writes[1]).toEqual({ owner: state.owner, key: keys.commissionFixed, body: { value: "8.75" } });
    expect(state.stores.get(state.owner)?.[keys.commissionPercent]).toBe(initial.commissionPercent);
    expect(state.stores.get(state.owner)?.[keys.feeFixed]).toBe(initial.feeFixed);
    for (const [field, value] of [["riskPercent", "4.5"], ["feePercent", "0.25"]] as Array<[Field, string]>) {
      await control(page, field).fill(value);
      await page.clock.runFor(600);
      await expect.poll(() => cached(page, field)).toBe(value);
    }
    await control(page, "commissionMode").selectOption("PERCENT");
    await page.clock.runFor(1);
    await expect(saved(page, "commissionMode")).toBeVisible();
    await expect(control(page, "commissionPercent")).toHaveValue(String(initial.commissionPercent));
    await control(page, "commissionPercent").fill("0.55");
    await page.clock.runFor(600);
    await expect.poll(() => cached(page, "commissionPercent")).toBe("0.55");
    await control(page, "feeMode").selectOption("FIXED");
    await page.clock.runFor(1);
    await expect(saved(page, "feeMode")).toBeVisible();
    await expect(control(page, "feeFixed")).toHaveValue(String(initial.feeFixed));
    await control(page, "feeFixed").fill("6.25");
    await page.clock.runFor(600);
    await expect.poll(() => cached(page, "feeFixed")).toBe("6.25");
    exactWrites(state, {
      quantity: "45000", commissionFixed: "8.75", riskPercent: "4.5", feePercent: "0.25",
      commissionMode: "PERCENT", commissionPercent: "0.55", feeMode: "FIXED", feeFixed: "6.25",
    });
    await page.clock.runFor(1000);
    expect(state.writes).toHaveLength(8);
  });

  test(`${renderer} immediate choice and chart-line saves support Undo without rewriting numeric defaults`, async ({ page }) => {
    const state = await fixture(page, fallback);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expectValues(page);
    await control(page, "riskBase").selectOption("CURRENT_BALANCE");
    await expect(saved(page, "riskBase")).toBeVisible();
    await undo(page).click();
    await expect(control(page, "riskBase")).toHaveValue("INITIAL_BALANCE");
    await expect.poll(() => state.writes.length).toBe(2);
    await expect(saved(page, "riskBase")).toBeVisible();
    await control(page, "lineConfirmation").setChecked(true);
    await expect.poll(() => state.writes.length).toBe(3);
    await expect(saved(page, "lineConfirmation")).toBeVisible();
    await undo(page).click();
    await expect(control(page, "lineConfirmation")).not.toBeChecked();
    await expect.poll(() => state.writes.length).toBe(4);
    await expect(saved(page, "lineConfirmation")).toBeVisible();
    expect(state.writes.map(({ key, body }) => ({ key, body }))).toEqual([
      { key: keys.riskBase, body: { value: "CURRENT_BALANCE" } }, { key: keys.riskBase, body: { value: "INITIAL_BALANCE" } },
      { key: keys.lineConfirmation, body: { value: true } }, { key: keys.lineConfirmation, body: { value: false } },
    ]);
    expect(state.stores.get(state.owner)).toEqual({ ...storageValues(initial), "order-future-private-setting.v9": { keep: ["untouched", 19] } });
  });

  test(`${renderer} rejected saves retain private drafts across remount and retry only failed changed keys`, async ({ page }, info) => {
    const state = await fixture(page, fallback);
    state.failWrites.add(keys.quantity);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expectValues(page);
    await control(page, "quantity").fill("62000");
    await expect(retry(page)).toBeVisible();
    await captureState(page, "error", "quantity", fallback, info);
    await expect(saved(page)).toHaveCount(0);
    exactWrites(state, { quantity: "62000" });
    expect(await cached(page, "quantity")).toBe(initial.quantity);
    expect(await mirror(page, "quantity")).toBe(initial.quantity);
    await control(page, "riskBase").selectOption("CURRENT_BALANCE");
    await expect.poll(() => state.stores.get(state.owner)?.[keys.riskBase]).toBe("CURRENT_BALANCE");
    await expect(retry(page)).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(control(page, "quantity")).toHaveValue("62000");
    await expect(control(page, "riskBase")).toHaveValue("CURRENT_BALANCE");
    await expect(retry(page)).toBeVisible();
    expect(state.writes).toHaveLength(2);
    state.failWrites.clear();
    await switchRenderer(page, state, !fallback, true);
    await retry(page).click();
    await expect(saved(page)).toBeVisible();
    expect(state.writes.map(({ key, body }) => ({ key, body }))).toEqual([
      { key: keys.quantity, body: { value: "62000" } }, { key: keys.riskBase, body: { value: "CURRENT_BALANCE" } },
      { key: keys.quantity, body: { value: "62000" } },
    ]);
    await expect.poll(() => mirror(page, "quantity")).toBe("62000");
  });

  test(`${renderer} rejects mismatched and null successful responses until the server acknowledges the exact value`, async ({ page }) => {
    const state = await fixture(page, fallback);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expectValues(page);
    let confirmed = String(initial.quantity);
    for (const [value, acknowledgment] of [["62000", "62500"], ["63000", null]] as const) {
      state.acknowledgments.set(keys.quantity, acknowledgment);
      const writes = state.writes.length;
      await control(page, "quantity").fill(value);
      await expect(retry(page)).toBeVisible();
      await expect(saved(page)).toHaveCount(0);
      await expect(control(page, "quantity")).toHaveValue(value);
      expect(state.writes).toHaveLength(writes + 1);
      expect(state.stores.get(state.owner)?.[keys.quantity]).toBe(acknowledgment);
      expect(await cached(page, "quantity")).toBe(confirmed);
      expect(await mirror(page, "quantity")).toBe(confirmed);
      state.acknowledgments.delete(keys.quantity);
      await retry(page).click();
      await expect(saved(page)).toBeVisible();
      expect(state.writes).toHaveLength(writes + 2);
      await expect.poll(() => cached(page, "quantity")).toBe(value);
      await expect.poll(() => mirror(page, "quantity")).toBe(value);
      confirmed = value;
    }
    expect(state.writes).toEqual(["62000", "62000", "63000", "63000"].map((value) => ({ owner: state.owner, key: keys.quantity, body: { value } })));
  });

  test(`${renderer} reset covers all eleven defaults and partial retry leaves acknowledged and unknown keys alone`, async ({ page }) => {
    const state = await fixture(page, fallback);
    state.failWrites.add(keys.feePercent);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expectValues(page);
    await reset(page).click();
    await expectValues(page, defaults);
    await expect(retry(page, "feePercent")).toBeVisible();
    await expect.poll(() => state.writes.length).toBe(11);
    expect([...state.writes].sort((a, b) => a.key.localeCompare(b.key))).toEqual(
      Object.entries(keys).map(([field, key]) => ({ owner: state.owner, key, body: { value: defaults[field as Field] } })).sort((a, b) => a.key.localeCompare(b.key)),
    );
    await expect(saved(page, "feePercent")).toHaveCount(0);
    expect(state.stores.get(state.owner)).toEqual({ ...storageValues(defaults), [keys.feePercent]: initial.feePercent, "order-future-private-setting.v9": { keep: ["untouched", 19] } });
    state.failWrites.clear();
    await retry(page, "feePercent").click();
    await expect(saved(page, "feePercent")).toBeVisible();
    expect(state.writes).toHaveLength(12);
    expect(state.writes[11]).toEqual({ owner: state.owner, key: keys.feePercent, body: { value: "0" } });
    await switchRenderer(page, state, !fallback);
    await expectValues(page, defaults);
    expect(state.stores.get(state.owner)).toEqual({ ...storageValues(defaults), "order-future-private-setting.v9": { keep: ["untouched", 19] } });
  });
}

test("backtest pending hot switches preserve later and return-to-original edits until separate acknowledgments", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Pending completion races covered once");
  const state = await fixture(page);
  await gotoStable(page, path, { waitForNetworkIdle: false });
  await expectValues(page);
  const release = hold(state, "quantity");
  await control(page, "quantity").fill("70000");
  await expect.poll(() => state.writes.length).toBe(1);
  await control(page, "quantity").fill(String(initial.quantity));
  await control(page, "riskPercent").fill("3.25");
  await switchRenderer(page, state, false, true);
  await expect(control(page, "quantity")).toBeEnabled();
  await expect(control(page, "quantity")).toHaveValue(String(initial.quantity));
  await expect(control(page, "riskPercent")).toHaveValue("3.25");
  await expect(saved(page)).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(state.writes.filter(({ key }) => key === keys.quantity)).toHaveLength(1);
  expect(await cached(page, "quantity")).toBe(initial.quantity);
  release();
  await expect.poll(() => state.stores.get(state.owner)?.[keys.quantity]).toBe(initial.quantity);
  await expect.poll(() => state.writes.filter(({ key }) => key === keys.quantity).length).toBe(2);
  await expect(saved(page)).toBeVisible();
  expect(state.writes.filter(({ key }) => key === keys.quantity).map(({ body }) => body.value)).toEqual(["70000", initial.quantity]);
  await expect(control(page, "quantity")).toHaveValue(String(initial.quantity));
  await expect(control(page, "riskPercent")).toHaveValue("3.25");
  await switchRenderer(page, state, true, true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(control(page, "quantity")).toHaveValue(String(initial.quantity));
  await expect(control(page, "riskPercent")).toHaveValue("3.25");
});

test("backtest acknowledged defaults notify existing replay consumers and private owner drafts survive another owner's completion", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Owner boundary and replay consumer subscriptions covered once");
  await installDeterminism(page, { rollout: "fallback" });
  const state = await fixture(page, true, false);
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    ...betaSessionResponse, token: `backtest-owner-${state.owner}`, user: { ...betaSessionResponse.user, id: state.owner },
  } }));
  await gotoStable(page, "/", { waitForNetworkIdle: false });
  async function owner(id: number) {
    state.owner = id;
    await page.evaluate(async (session) => {
      const modulePath = "/src/lib/authSession.ts";
      const { setStoredAuthSession } = await import(modulePath);
      setStoredAuthSession(session);
    }, { createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at, token: `backtest-owner-${id}`,
      user: { approved: true, betaPosition: null, email: betaSessionResponse.user.email, id, isBetaUser: true, name: betaSessionResponse.user.name, plan: "beta", provider: "google" } });
  }
  const firstOwner = betaSessionResponse.user.id;
  await owner(firstOwner);
  await gotoStable(page, path, { waitForNetworkIdle: false });
  await expectValues(page);
  await page.evaluate(async () => {
    const orderPath = "/src/lib/orderSettings.ts";
    const backtestPath = "/src/lib/backtestSettings.ts";
    const order = await import(orderPath);
    const backtest = await import(backtestPath);
    const target = window as typeof window & { __backtestConsumerEvents?: unknown[] };
    target.__backtestConsumerEvents = [];
    order.subscribeOrderDefaultQuantity((value: string) => target.__backtestConsumerEvents!.push({ quantity: value }));
    backtest.subscribeOrderLineModificationConfirmation((value: boolean) => target.__backtestConsumerEvents!.push({ lineConfirmation: value }));
  });
  const release = hold(state, "quantity");
  await control(page, "quantity").fill("81000");
  await expect.poll(() => state.writes.length).toBe(1);
  expect(await page.evaluate(() => (window as typeof window & { __backtestConsumerEvents?: unknown[] }).__backtestConsumerEvents)).toEqual([]);
  await control(page, "quantity").fill("Owner one invalid private draft");
  await owner(firstOwner + 1);
  await expectValues(page);
  await control(page, "quantity").fill("Owner two invalid private draft");
  await expect(control(page, "quantity")).toHaveAttribute("aria-invalid", "true");
  release();
  await expect.poll(() => state.stores.get(firstOwner)?.[keys.quantity]).toBe("81000");
  await expect(control(page, "quantity")).toHaveValue("Owner two invalid private draft");
  expect(await cached(page, "quantity")).toBe(initial.quantity);
  expect(await mirror(page, "quantity", firstOwner + 1)).toBe(initial.quantity);
  await owner(firstOwner);
  await expect(control(page, "quantity")).toHaveValue("Owner one invalid private draft");
  await expect(control(page, "quantity")).toBeEnabled();
  await control(page, "quantity").fill("82000");
  await expect.poll(() => state.stores.get(firstOwner)?.[keys.quantity]).toBe("82000");
  await expect(saved(page)).toBeVisible();
  await control(page, "lineConfirmation").setChecked(true);
  await expect(saved(page, "lineConfirmation")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __backtestConsumerEvents?: unknown[] }).__backtestConsumerEvents)).toEqual(
    expect.arrayContaining([{ quantity: "82000" }, { lineConfirmation: true }]),
  );
  await owner(firstOwner + 1);
  await expect(control(page, "quantity")).toHaveValue("Owner two invalid private draft");
  await expect(control(page, "lineConfirmation")).not.toBeChecked();
  expect(state.writes.map(({ owner: id, key, body }) => ({ owner: id, key, body }))).toEqual([
    { owner: firstOwner, key: keys.quantity, body: { value: "81000" } },
    { owner: firstOwner, key: keys.quantity, body: { value: "82000" } },
    { owner: firstOwner, key: keys.lineConfirmation, body: { value: true } },
  ]);
});
