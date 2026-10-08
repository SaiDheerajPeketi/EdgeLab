import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
declare global { interface Window { settingsAckFixture: any; } }
const root = path.resolve(import.meta.dirname, "..");
const seed = { schemaVersion: 1, settings: { default_broker: "Seed broker", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: true, unknown: "preserved" }, trades: [], unknown: { preserved: true } };
const seedNote = "Seed review\nEntry: {entry}";
const seedPreferences = { density: "comfortable", includeDiagnosticsByDefault: true };
type Harness = { origin: string };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const mocks = {
      useChartSettings: 'export function useChartSettings(){return {dirty:false,pending:false}}',
      useBacktestSettings: 'export function useBacktestSettings(){return {dirty:false,pending:false}}',
      "react-router-dom": 'export function useLocation(){return {pathname:"/app/settings/journal"}}',
      ChartSettingsPanel: 'export const ChartSettingsPanel=()=>null',
      BacktestSettingsPanel: 'export const BacktestSettingsPanel=()=>null',
      SettingsDataTransfer: 'export const SettingsDataTransfer=()=>null',
      SettingsIntegrations: 'export const SettingsIntegrations=()=>null',
      SettingsSearch: 'export const SettingsSearch=()=>null',
    };
    // Only unrelated panels are isolated. Hooks, controls, HTTP client, auth and cache stay genuine.
    const bundle = await build({ entryPoints: [path.join(root, "e2e/settings-ack87.fixture.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "import.meta.env": "{}" },
      plugins: [{ name: "unrelated-settings-panels", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => { const name = args.path.split("/").at(-1); if (mocks[name]) return { path: name, namespace: "ack87" }; });
        builder.onLoad({ filter: /.*/, namespace: "ack87" }, args => ({ contents: mocks[args.path], loader: "js" }));
      } }] });
    const assets = path.join(root, "frontend/dist/assets"), css = fs.readdirSync(assets).filter(name => name.endsWith(".css")).map(name => fs.readFileSync(path.join(assets, name))).join("\n");
    fs.mkdirSync(path.join(root, ".artifacts"), { recursive: true });
    fs.writeFileSync(path.join(root, ".artifacts/settings-ack87-frozen.txt"), createHash("sha256").update(bundle.outputFiles[0].contents).digest("hex"));
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1"); res.setHeader("Cache-Control", "no-store");
      if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'); }
      else if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
      else if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
      else { res.statusCode = 404; res.end(); }
    });
    await new Promise<void>(resolve => server.listen(45187, "127.0.0.1", resolve));
    try { await use({ origin: "http://127.0.0.1:45187" }); } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  }, { scope: "worker" }],
  harness: async ({ serverHarness }, use) => { await use(serverHarness); }
});
async function open(page, harness) {
  const state = { journal: structuredClone(seed), note: seedNote, preferences: { ...seedPreferences }, writes: [], reads: [], operations: new Map(),
    journalAck: "valid", noteAck: "valid", failPreferences: false, failRead: false,
    holdRead: null, holdNoteRead: null, holdJournal: null, holdNote: null, holdPreferences: null };
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  const item = (key, value) => ({ namespace: "edgelab", key, value, updated_at: "2026-10-08T10:00:00Z" });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method(), body = request.postData() ? request.postDataJSON() : null;
    const key = url.pathname.split("/").at(-1);
    const operationId = request.headers()["x-edgelab-operation-id"];
    const finish = async (status, json) => {
      if (operationId && state.operations.has(operationId)) state.operations.set(operationId, { ...state.operations.get(operationId), status: "completed", http_status: status, completed_at: "2026-10-08T10:00:01Z" });
      await route.fulfill({ status, json });
    };
    if (/^\/api\/app-data\/operations\/[^/]+\/reserve$/.test(url.pathname)) {
      const receipt = { operation_id: url.pathname.split("/").at(-2), method: body.method, path: body.path, status: "reserved", http_status: null, result: null, created_at: "2026-10-08T10:00:00Z", completed_at: null };
      state.operations.set(receipt.operation_id, receipt); await route.fulfill({ json: receipt }); return;
    }
    if (/^\/api\/app-data\/operations\/[^/]+\/recover$/.test(url.pathname)) { await route.fulfill({ json: state.operations.get(url.pathname.split("/").at(-2)) }); return; }
    if (method === "GET") {
      state.reads.push(url.pathname);
      if (key === "settings-center.v1" && state.holdRead) await state.holdRead;
      if (key === "notebook-template.v1" && state.holdNoteRead) await state.holdNoteRead;
      if (key === "settings-center.v1" && state.failRead) { await route.fulfill({ status: 503, json: { detail: "Preference reload unavailable" } }); return; }
      const value = key === "live-journal.v1" ? state.journal : key === "notebook-template.v1" ? state.note : key === "settings-center.v1" ? state.preferences : null;
      await route.fulfill({ json: item(key, value) }); return;
    }
    state.writes.push({ path: url.pathname, method, body, authorization: request.headers().authorization });
    if (url.pathname === "/api/journal/settings") {
      if (state.holdJournal) await state.holdJournal;
      const next = { ...state.journal, settings: { ...state.journal.settings, ...body, ...(body.default_broker === "" ? { default_broker: "Manual" } : {}) } };
      if (state.journalAck === "fail") { await finish(503, { detail: "Journal unavailable" }); return; }
      const value = state.journalAck === "null" ? null : state.journalAck === "wrong" ? state.journal : next;
      if (state.journalAck === "valid") state.journal = next;
      const response = item("live-journal.v1", value);
      if (state.journalAck === "wrong-key") response.key = "different-key";
      if (state.journalAck === "wrong-namespace") response.namespace = "different-namespace";
      await finish(200, response); return;
    }
    if (key === "notebook-template.v1") {
      if (state.holdNote) await state.holdNote;
      if (state.noteAck === "fail") { await finish(503, { detail: "Note unavailable" }); return; }
      const value = state.noteAck === "null" ? null : state.noteAck === "wrong" ? "Different response" : body.value;
      if (state.noteAck === "valid") state.note = body.value;
      const response = item(key, value);
      if (state.noteAck === "wrong-key") response.key = "different-key";
      if (state.noteAck === "wrong-namespace") response.namespace = "different-namespace";
      await finish(200, response); return;
    }
    if (url.pathname === "/api/settings/preferences") {
      if (state.holdPreferences) await state.holdPreferences;
      if (state.failPreferences) { await route.fulfill({ status: 503, json: { detail: "Preference unavailable" } }); return; }
      state.preferences = { ...state.preferences, ...body };
      await route.fulfill({ json: item("settings-center.v1", state.preferences) }); return;
    }
    await route.fulfill({ status: 404, json: { detail: "Unexpected mutation" } });
  });
  await page.goto(harness.origin);
  await expect(page.getByLabel("Currency", { exact: true })).toHaveValue("USD");
  await expect.poll(() => page.evaluate(() => window.settingsAckFixture.current?.preferences.ready)).toBe(true);
  return { state, errors };
}
const journalRow = page => page.locator('[data-setting-control="journal-defaults"]');
const noteRow = page => page.locator('[data-setting-control="note-template"]');
const diagRow = page => page.locator('[data-setting-control="diagnostic-sharing"]');
async function privacy(page) {
  if (page.viewportSize().width < 1024) await page.getByRole("combobox", { name: "Settings category", exact: true }).selectOption("privacy-security");
  else await page.getByRole("button", { name: /^Privacy & security/ }).click();
  await expect(page.getByRole("switch", { name: "Include diagnostics by default", exact: true })).toBeVisible();
}
const cache = (page, key) => page.evaluate(key => window.settingsAckFixture.cache(key), key);

test("failed newer-version reload preserves the private preference draft and conflict for recovery", async ({ page, harness }) => {
  const { state, errors } = await open(page, harness); await privacy(page);
  state.failPreferences = true; await page.getByRole("switch", { name: "Include diagnostics by default" }).click();
  await expect(diagRow(page).getByRole("alert")).toBeVisible();
  await page.evaluate(() => window.settingsAckFixture.conflict()); await expect(page.getByRole("button", { name: "Use newer version" })).toBeVisible();
  state.failRead = true; await page.getByRole("button", { name: "Use newer version" }).click();
  await expect(page.getByText("Preferences could not be loaded. Your draft is kept.", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Include diagnostics by default" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "Use newer version" })).toBeVisible();
  expect(await cache(page, "settings-center.v1")).toEqual(seedPreferences); expect(errors).toEqual([]);
});

test("new journal and note edits after valid saves show unapplied state instead of saved feedback", async ({ page, harness }) => {
  const { errors } = await open(page, harness);
  await journalRow(page).getByLabel("Currency", { exact: true }).fill("EUR"); await journalRow(page).getByRole("button", { name: "Apply journal defaults" }).click();
  await expect(journalRow(page).getByText("Journal defaults saved", { exact: true })).toBeVisible();
  await journalRow(page).getByLabel("Broker label", { exact: true }).fill("Later unsaved broker");
  await expect(journalRow(page).getByText("Journal defaults saved", { exact: true })).toBeHidden();
  await noteRow(page).getByLabel("Review note template").fill("Saved note\n{entry}"); await noteRow(page).getByRole("button", { name: "Save note template" }).click();
  await expect(noteRow(page).getByText("Note template saved", { exact: true })).toBeVisible();
  await noteRow(page).getByLabel("Review note template").fill("Later unsaved note");
  await expect(noteRow(page).getByText("Note template saved", { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});

for (const field of ["journal", "note"]) test(field + " malformed and mismatched HTTP200 acknowledgement retains draft and cache until a valid retry", async ({ page, harness }) => {
  const { state, errors } = await open(page, harness), row = field === "journal" ? journalRow(page) : noteRow(page);
  const input = field === "journal" ? row.getByLabel("Currency", { exact: true }) : row.getByLabel("Review note template");
  const value = field === "journal" ? "EUR" : "  Exact note\n{entry}\n ";
  const button = row.getByRole("button", { name: field === "journal" ? "Apply journal defaults" : "Save note template", exact: true });
  const key = field === "journal" ? "live-journal.v1" : "notebook-template.v1";
  await input.fill(value);
  for (const [index, mode] of ["null", "wrong", "wrong-key", "wrong-namespace"].entries()) {
    state[field + "Ack"] = mode;
    if (index === 0) await button.click(); else await row.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(index + 1);
    await expect(row.getByRole("alert")).toBeVisible(); await expect(input).toHaveValue(value);
    expect(await cache(page, key)).toEqual(field === "journal" ? seed : seedNote);
  }
  state[field + "Ack"] = "valid"; await row.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(row.getByText(field === "journal" ? "Journal defaults saved" : "Note template saved", { exact: true })).toBeVisible();
  await expect(row.getByRole("alert")).toBeHidden(); await expect(button).toBeDisabled(); await expect(input).toHaveValue(value);
  expect(await cache(page, key)).toEqual(field === "journal" ? state.journal : value); expect(errors).toEqual([]);
});

test("a held newer-version reload preserves edits made during the read and admits only one reload", async ({ page, harness }) => {
  const { state, errors } = await open(page, harness); await privacy(page);
  state.failPreferences = true;
  await page.getByRole("switch", { name: "Include diagnostics by default" }).click();
  await expect(diagRow(page).getByRole("alert")).toBeVisible();
  await page.evaluate(() => window.settingsAckFixture.conflict());
  let release; state.holdRead = new Promise(resolve => { release = resolve; });
  state.preferences = { density: "compact", includeDiagnosticsByDefault: false };
  const beforeReads = state.reads.filter(key => key.endsWith("settings-center.v1")).length;
  await page.getByRole("button", { name: "Use newer version" }).click();
  await expect.poll(() => state.reads.filter(key => key.endsWith("settings-center.v1")).length).toBe(beforeReads + 1);
  await page.evaluate(() => window.settingsAckFixture.current.preferences.useNewer());
  expect(state.reads.filter(key => key.endsWith("settings-center.v1")).length).toBe(beforeReads + 1);
  await page.getByRole("switch", { name: "Include diagnostics by default" }).click();
  await expect(page.getByRole("switch", { name: "Include diagnostics by default" })).toHaveAttribute("aria-checked", "true");
  release();
  await expect.poll(() => page.evaluate(() => window.settingsAckFixture.current.preferences.loading)).toBe(false);
  await expect(page.getByRole("switch", { name: "Include diagnostics by default" })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => window.settingsAckFixture.current.preferences.defaults.includeDiagnosticsByDefault)).toBe(false);
  expect(await page.evaluate(() => window.settingsAckFixture.current.preferences.dirty)).toBe(true);
  expect(errors).toEqual([]);
});

test("held journal and note acknowledgements preserve later edits including returns to the old baseline", async ({ page, harness }) => {
  const { state, errors } = await open(page, harness);
  let releaseJournal, releaseNote;
  state.holdJournal = new Promise(resolve => { releaseJournal = resolve; });
  state.holdNote = new Promise(resolve => { releaseNote = resolve; });
  await journalRow(page).getByLabel("Currency", { exact: true }).fill("EUR");
  await journalRow(page).getByRole("button", { name: "Apply journal defaults" }).click();
  await expect.poll(() => state.writes.filter(write => write.path === "/api/journal/settings").length).toBe(1);
  await journalRow(page).getByLabel("Currency", { exact: true }).fill("USD");
  await journalRow(page).getByLabel("Broker label", { exact: true }).fill("Later broker");
  await noteRow(page).getByLabel("Review note template").fill("Submitted note");
  await noteRow(page).getByRole("button", { name: "Save note template" }).click();
  await expect.poll(() => state.writes.filter(write => write.path.endsWith("notebook-template.v1")).length).toBe(1);
  await noteRow(page).getByLabel("Review note template").fill(seedNote);
  releaseJournal(); releaseNote();
  await expect.poll(() => page.evaluate(() => window.settingsAckFixture.current.journal.journalPending || window.settingsAckFixture.current.journal.notePending)).toBe(false);
  await expect(journalRow(page).getByLabel("Currency", { exact: true })).toHaveValue("USD");
  await expect(journalRow(page).getByLabel("Broker label", { exact: true })).toHaveValue("Later broker");
  await expect(noteRow(page).getByLabel("Review note template")).toHaveValue(seedNote);
  await expect(journalRow(page).getByText("Journal defaults saved", { exact: true })).toBeHidden();
  await expect(noteRow(page).getByText("Note template saved", { exact: true })).toBeHidden();
  await expect(journalRow(page).getByRole("button", { name: "Apply journal defaults" })).toBeEnabled();
  await expect(noteRow(page).getByRole("button", { name: "Save note template" })).toBeEnabled();
  expect(state.journal.settings.default_currency).toBe("EUR"); expect(state.note).toBe("Submitted note"); expect(errors).toEqual([]);
});

test("journal failure stays independent from a successful note save and canonical blank broker retry", async ({ page, harness }) => {
  const { state, errors } = await open(page, harness);
  state.journalAck = "wrong";
  await journalRow(page).getByLabel("Broker label", { exact: true }).fill("");
  await journalRow(page).getByRole("button", { name: "Apply journal defaults" }).click();
  await expect(journalRow(page).getByRole("alert")).toBeVisible();
  await noteRow(page).getByLabel("Review note template").fill("Independent note\n{exit}");
  await noteRow(page).getByRole("button", { name: "Save note template" }).click();
  await expect(noteRow(page).getByText("Note template saved", { exact: true })).toBeVisible();
  await expect(journalRow(page).getByRole("alert")).toBeVisible();
  await expect(journalRow(page).getByLabel("Broker label", { exact: true })).toHaveValue("");
  state.journalAck = "valid"; await journalRow(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(journalRow(page).getByRole("alert")).toBeHidden();
  await expect(journalRow(page).getByLabel("Broker label", { exact: true })).toHaveValue("Manual");
  expect(state.note).toBe("Independent note\n{exit}"); expect(errors).toEqual([]);
});

test("callbacks captured for the previous owner cannot issue settings writes or preference reads", async ({ page, harness }) => {
  const { state, errors } = await open(page, harness);
  await journalRow(page).getByLabel("Currency", { exact: true }).fill("EUR");
  await noteRow(page).getByLabel("Review note template").fill("Previous owner's draft");
  await privacy(page); state.failPreferences = true;
  await page.getByRole("switch", { name: "Include diagnostics by default" }).click();
  await expect(diagRow(page).getByRole("alert")).toBeVisible();
  await page.evaluate(() => { window.settingsAckFixture.capture(); window.settingsAckFixture.switchOwner(8702); });
  await expect.poll(() => page.evaluate(() => window.settingsAckFixture.current.journal.ready && window.settingsAckFixture.current.preferences.ready)).toBe(true);
  const writes = state.writes.length, reads = state.reads.length;
  await page.evaluate(async () => {
    for (const key of ["journal", "note", "preference", "newer"]) await window.settingsAckFixture.invokeCaptured(key);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(state.writes.length).toBe(writes); expect(state.reads.length).toBe(reads);
  expect(await page.evaluate(() => window.settingsAckFixture.current.journal.journalDraft.default_currency)).toBe("USD");
  expect(errors).toEqual([]);
});

test("a journal reload waiting for the note read cannot overwrite a newer confirmed journal save", async ({ page, harness }) => {
  const { state, errors } = await open(page, harness);
  let release; state.holdNoteRead = new Promise(resolve => { release = resolve; });
  const noteReads = state.reads.filter(key => key.endsWith("notebook-template.v1")).length;
  await page.evaluate(() => { void window.settingsAckFixture.current.journal.reload(); });
  await expect.poll(() => state.reads.filter(key => key.endsWith("notebook-template.v1")).length).toBe(noteReads + 1);
  await journalRow(page).getByLabel("Currency", { exact: true }).fill("EUR");
  await journalRow(page).getByRole("button", { name: "Apply journal defaults" }).click();
  await expect(journalRow(page).getByText("Journal defaults saved", { exact: true })).toBeVisible();
  release();
  await expect.poll(() => page.evaluate(() => window.settingsAckFixture.current.journal.loading)).toBe(false);
  await expect(journalRow(page).getByLabel("Currency", { exact: true })).toHaveValue("EUR");
  await expect(journalRow(page).getByRole("button", { name: "Apply journal defaults" })).toBeDisabled();
  expect(await cache(page, "live-journal.v1")).toEqual(state.journal); expect(errors).toEqual([]);
});
