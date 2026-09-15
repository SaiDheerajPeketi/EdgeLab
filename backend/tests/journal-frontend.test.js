import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tscBin = path.join(repoRoot, "frontend/node_modules/typescript/bin/tsc");

function loadJournalContracts() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-journal-ui-"));
  const sourceDir = path.join(tempDir, "src");
  const outDir = path.join(tempDir, "out");
  fs.mkdirSync(sourceDir, { recursive: true });
  for (const file of ["journalAnalytics.ts", "journalWorkspaceState.ts"]) fs.copyFileSync(path.join(repoRoot, "frontend/src/lib", file), path.join(sourceDir, file));
  fs.writeFileSync(path.join(sourceDir, "journalApi.ts"), "export type CanonicalTrade = any; export type JournalAccount = any; export type JournalTag = any;\n");
  fs.writeFileSync(path.join(sourceDir, "authSession.ts"), "export function getStoredAuthSession() { return { user: { id: 7, email: 'owner@example.com' } }; }\n");
  fs.writeFileSync(path.join(sourceDir, "serverStorage.ts"), "export async function loadAppStorageItem(_key: string, fallback: unknown) { return fallback; } export async function saveAppStorageItemConfirmed(_key: string, value: unknown) { return value; }\n");
  const compile = spawnSync(process.execPath, [tscBin, "--module", "commonjs", "--target", "es2022", "--lib", "es2022,dom", "--skipLibCheck", "--outDir", outDir, ...fs.readdirSync(sourceDir).map((file) => path.join(sourceDir, file))], { cwd: repoRoot, encoding: "utf8" });
  if (compile.status !== 0) { fs.rmSync(tempDir, { force: true, recursive: true }); throw new Error(compile.stderr || compile.stdout || "Journal contracts failed to compile"); }
  const require = createRequire(import.meta.url);
  return { analytics: require(path.join(outDir, "journalAnalytics.js")), workspace: require(path.join(outDir, "journalWorkspaceState.js")), cleanup: () => fs.rmSync(tempDir, { force: true, recursive: true }) };
}

function trade(id, overrides = {}) {
  return { id, account_id: 1, entry_type: "TAKEN", status: "CLOSED", symbol: "MES", currency: "USD", side: "LONG", entry_time: `2026-09-${String(10 + id).padStart(2, "0")}T14:00:00Z`, exit_time: `2026-09-${String(10 + id).padStart(2, "0")}T14:30:00Z`, entry_price: 100, exit_price: 110, quantity: 1, gross_pnl: 10, net_pnl: 8, commission: 1, fees: 1, stop_loss: 95, planned_stop_loss: 95, r_multiple: 1.6, strategy_name: "Opening range", rating: 4, setup_grade: "A", reviewed: true, tags: [{ id: 9, category: "POSITIVE", name: "Patient" }], notes: [], screenshots: [], executions: [], ...overrides };
}

test("Journal UI contracts preserve owner scope, deep links, costs, filters, and mixed-currency guards", () => {
  const { analytics, workspace, cleanup } = loadJournalContracts();
  try {
    assert.deepEqual(workspace.sanitizeJournalScope({ mode: "selected", accountIds: [1, 1, 999, "2"] }, [1, 2]), { mode: "selected", accountIds: [1] });
    assert.deepEqual(workspace.sanitizeJournalScope({ mode: "selected", accountIds: [999] }, [1, 2]), { mode: "all", accountIds: [] });
    const link = workspace.journalDeepLink({ surface: "trades", tradeId: 42, date: null, accountId: 1, segment: "strategy", returnTo: "dashboard" });
    assert.deepEqual(workspace.parseJournalDeepLink(link), { surface: "trades", tradeId: 42, date: null, accountId: 1, segment: "strategy", returnTo: "dashboard" });
    assert.equal(workspace.parseJournalDeepLink("#journal/trades?trade=not-a-number").tradeId, null);
    assert.equal(workspace.parseJournalDeepLink("#journal/admin?trade=1"), null);

    const rows = [trade(1), trade(2, { side: "SHORT", symbol: "BTCUSDT", net_pnl: -6, gross_pnl: -4, rating: 2, reviewed: false, tags: [{ id: 10, category: "MISTAKE", name: "Chase" }] })];
    const summary = analytics.summarizeJournalTrades(rows);
    assert.equal(summary.grossPnl, 6);
    assert.equal(summary.costs, 4);
    assert.equal(summary.netPnl, 2);
    assert.equal(summary.reviewedPercent, 50);
    const filtered = analytics.filterJournalTrades(rows, { ...analytics.DEFAULT_JOURNAL_FILTERS, direction: "SHORT", tagIds: [10] });
    assert.deepEqual(filtered.map((row) => row.id), [2]);
    const markets = analytics.buildJournalBreakdown(rows, "market", []);
    assert.deepEqual(new Set(markets.map((row) => row.label)), new Set(["Futures", "Crypto"]));
    assert.deepEqual(analytics.scopedCurrency([{ id: 1, status: "ACTIVE", currency: "USD" }, { id: 2, status: "ACTIVE", currency: "EUR" }], []), { combinable: false, currency: "USD", currencies: ["USD", "EUR"] });
    assert.equal(analytics.riskBehavior(rows).sampleSize, 2);
  } finally { cleanup(); }
});
