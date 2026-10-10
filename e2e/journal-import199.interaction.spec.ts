import { expect, test, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";
import type { JournalImportCreate, JournalImportRun } from "../frontend/src/lib/journalApi";

const csv = "entry_time,side,entry_price,quantity,symbol\n2026-09-15T09:00:00Z,LONG,100,1,ES\n";
async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await installDeterminism(page);
  await seedApprovedSession(page);
  const runs: JournalImportRun[] = [], writes: JournalImportCreate[] = [], rollbacks: number[] = [];
  let release: (() => void) | undefined, fail = false;
  await page.route("**/api/journal/imports**", async route => {
    const request = route.request(), url = new URL(request.url());
    const rollback = url.pathname.match(/\/imports\/(\d+)\/rollback$/);
    if (rollback) {
      const id = Number(rollback[1]); rollbacks.push(id);
      const run = runs.find(run => run.id === id)!;
      run.status = "ROLLED_BACK"; run.rolled_back_at = "2026-09-15T10:31:00Z";
      return route.fulfill({ json: run });
    }
    if (request.method() === "GET") return route.fulfill({ json: runs });
    const payload = request.postDataJSON() as JournalImportCreate;
    writes.push(structuredClone(payload));
    if (payload.source_name === "A.csv") await new Promise<void>(resolve => { release = resolve; });
    if (fail) return route.fulfill({ status: 422, json: { detail: "CSV row could not be imported. Correct it and retry." } });
    const digest = createHash("sha256").update(payload.csv_text).digest("hex");
    const duplicate = runs.some(run => run.status === "COMPLETED" && run.source_digest === digest);
    const run: JournalImportRun = {
      id: 900 + runs.length, account_id: payload.destination_account_id ?? 81,
      source_name: payload.source_name, source_digest: digest, status: "COMPLETED",
      source_timezone: payload.source_timezone, currency: payload.currency, default_symbol: payload.default_symbol ?? null,
      column_mapping: payload.column_mapping ?? {}, grouping: payload.grouping ?? {}, detected_columns: csv.split("\n")[0].split(","),
      total_rows: 1, imported_rows: duplicate ? 0 : 1, skipped_rows: duplicate ? 1 : 0, duplicate_rows: duplicate ? 1 : 0,
      error_rows: 0, created_at: "2026-09-15T10:30:00Z", completed_at: "2026-09-15T10:30:00Z", rolled_back_at: null, rows: [], diagnostics: [],
    };
    runs.unshift(run);
    await route.fulfill({ json: { run, trades: [] } });
  });
  await gotoStable(page, "/app/journal/accounts", { waitForNetworkIdle: false });
  const flow = page.locator('section[aria-labelledby="journal-import-title"]');
  await expect(flow.getByRole("heading", { name: "CSV imports", exact: true })).toBeVisible();
  return { flow, runs, writes, rollbacks, errors, release: () => release!(), held: () => Boolean(release), setFail: (value: boolean) => { fail = value; } };
}
async function choose(flow: Locator, name: string, expectEnabled = true) {
  await flow.getByRole("button", { name: "Import CSV", exact: true }).click();
  await flow.getByLabel("CSV export file", { exact: true }).setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(flow.getByText("Step 2 of 4 · Destination", { exact: true })).toBeVisible();
  await flow.getByRole("button", { name: "Review mapping", exact: true }).click();
  await expect(flow.getByText("Step 3 of 4 · Map and review", { exact: true })).toBeVisible();
  await expect(flow.getByRole("combobox", { name: /^entry_time\b/ })).toHaveValue("entry_time");
  if (expectEnabled) await expect(flow.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
}
async function capture(page: Page, project: string, name: string, receipt: unknown) {
  const folder = path.resolve(".artifacts/journal-import199", project);
  fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify(receipt, null, 2));
}
for (const outcome of ["success", "failure"] as const) {
  test(`late import ${outcome} cannot replace a new CSV draft`, async ({ page }, info) => {
    const state = await setup(page);
    state.setFail(outcome === "failure");
    await choose(state.flow, "A.csv");
    await state.flow.getByRole("button", { name: "Import", exact: true }).click();
    await expect.poll(state.held).toBe(true);
    await state.flow.getByRole("button", { name: "Close", exact: true }).click();
    await choose(state.flow, "B.csv", false);
    const settled = page.waitForResponse(response => new URL(response.url()).pathname === "/api/journal/imports" && response.request().method() === "POST");
    state.release();
    await settled;
    await expect.poll(() => state.writes.length).toBe(1);
    if (outcome === "success") await expect(state.flow.getByRole("row").filter({ hasText: "A.csv" })).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await capture(page, info.project.name, `settled-${outcome}`, { writes: state.writes, runs: state.runs, visibleText: await state.flow.innerText(), errors: state.errors });
    await expect(state.flow.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await expect(state.flow.getByText("Step 3 of 4 · Map and review", { exact: true })).toBeVisible();
    await expect(state.flow.getByText("Import complete", { exact: true })).toBeHidden();
    await expect(state.flow.getByRole("alert")).toHaveCount(0);
    state.setFail(false);
    await state.flow.getByRole("button", { name: "Import", exact: true }).click();
    await expect(state.flow.getByText("Import complete", { exact: true })).toBeVisible();
    expect(state.writes.map(write => write.source_name)).toEqual(["A.csv", "B.csv"]);
    expect(state.writes.every(write => write.csv_text === csv)).toBe(true);
    expect(state.errors).toEqual([]);
    await capture(page, info.project.name, `late-${outcome}`, { writes: state.writes, runs: state.runs, errors: state.errors });
  });
}

test("CSV preview, current failure retry, duplicate result and explicit rollback remain usable", async ({ page }, info) => {
  const state = await setup(page);
  await choose(state.flow, "current.csv");
  state.setFail(true);
  await state.flow.getByRole("button", { name: "Import", exact: true }).click();
  await expect(state.flow.getByRole("alert")).toContainText("Correct it and retry");
  await expect(state.flow.getByRole("combobox", { name: /^entry_price\b/ })).toHaveValue("entry_price");
  state.setFail(false);
  await state.flow.getByRole("button", { name: "Import", exact: true }).click();
  await expect(state.flow.getByText("Import complete", { exact: true })).toBeVisible();
  await state.flow.getByRole("button", { name: "Done", exact: true }).click();
  await choose(state.flow, "duplicate.csv");
  await state.flow.getByRole("button", { name: "Import", exact: true }).click();
  await expect(state.flow.getByText("Import complete", { exact: true })).toBeVisible();
  expect(state.runs[0].duplicate_rows).toBe(1);
  expect(state.runs[0].imported_rows).toBe(0);
  await expect(state.flow.locator("dl").filter({ has: page.getByText("Duplicates", { exact: true }) })).toContainText("1");
  await state.flow.getByRole("button", { name: "Roll back this import", exact: true }).click();
  await state.flow.getByRole("button", { name: "Confirm rollback", exact: true }).click();
  await expect.poll(() => state.rollbacks).toEqual([state.runs[0].id]);
  await expect(state.flow.getByRole("button", { name: "Confirm rollback", exact: true })).toBeHidden();
  await expect(state.flow.getByRole("button", { name: "Roll back this import", exact: true })).toBeHidden();
  await expect(state.flow.getByRole("row").filter({ hasText: "duplicate.csv" })).toContainText("ROLLED_BACK");
  expect(state.writes[0]).toEqual(state.writes[1]);
  expect(state.writes[0].destination_account_id).toBe(81);
  expect(state.errors).toEqual([]);
  await capture(page, info.project.name, "import-results", { writes: state.writes, runs: state.runs, rollbacks: state.rollbacks, errors: state.errors,
    qualification: "Genuine production import UI and HTTP model boundary. Duplicate counts and rollback records are controlled server responses, not a claim of independent backend normalization proof." });
});


test("a slower native file read cannot replace a newer selected CSV", async ({ page }, info) => {
  await page.addInitScript(() => {
    const read = File.prototype.text;
    File.prototype.text = async function () {
      const contents = read.call(this);
      if (this.name === "slow.csv") await new Promise<void>(resolve => { (window as any).releaseCsv199 = resolve; });
      return await contents;
    };
  });
  const state = await setup(page);
  await state.flow.getByRole("button", { name: "Import CSV", exact: true }).click();
  const chooser = state.flow.getByLabel("CSV export file", { exact: true });
  await chooser.setInputFiles({ name: "slow.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseCsv199)).toBe("function");
  await chooser.setInputFiles({ name: "newer.csv", mimeType: "text/csv", buffer: Buffer.from(csv.replace(",ES", ",NQ")) });
  await expect(state.flow.getByText("Step 2 of 4 · Destination", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).releaseCsv199());
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await state.flow.getByRole("button", { name: "Review mapping", exact: true }).click();
  await state.flow.getByRole("button", { name: "Import", exact: true }).click();
  await expect(state.flow.getByText("Import complete", { exact: true })).toBeVisible();
  expect(state.writes[0].source_name).toBe("newer.csv");
  expect(state.writes[0].csv_text).toContain(",NQ");
  expect(state.errors).toEqual([]);
  await capture(page, info.project.name, "native-file-read", { writes: state.writes, errors: state.errors,
    qualification: "Original File.text contents retained; only native file-read completion timing is held. No component state or UI logic is replaced." });
});

test("changing the destination during an import retires its local feedback", async ({ page }, info) => {
  const state = await setup(page);
  await choose(state.flow, "A.csv");
  await state.flow.getByRole("button", { name: "Import", exact: true }).click();
  await expect.poll(state.held).toBe(true);
  await state.flow.getByRole("button", { name: "Back", exact: true }).click();
  await state.flow.getByRole("combobox", { name: /^Destination\b/ }).selectOption("new");
  await state.flow.getByLabel("New account name", { exact: true }).fill("New destination 199");
  const settled = page.waitForResponse(response => new URL(response.url()).pathname === "/api/journal/imports" && response.request().method() === "POST");
  state.release();
  await settled;
  await expect(state.flow.getByRole("row").filter({ hasText: "A.csv" })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(state.flow.getByText("Step 2 of 4 · Destination", { exact: true })).toBeVisible();
  await expect(state.flow.getByLabel("New account name", { exact: true })).toHaveValue("New destination 199");
  await expect(state.flow.getByText("Import complete", { exact: true })).toBeHidden();
  expect(state.writes[0].destination_account_id).toBe(81);
  expect(state.errors).toEqual([]);
  await capture(page, info.project.name, "changed-destination", { writes: state.writes, runs: state.runs, errors: state.errors });
});
