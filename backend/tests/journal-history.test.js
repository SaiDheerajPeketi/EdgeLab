import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({
  bundle: true, define: { "import.meta.env": "{}" }, format: "esm", logLevel: "silent",
  platform: "node", target: "node22", write: false,
  stdin: { contents: 'export * from "./frontend/src/lib/journalApi.ts"; export { setStoredAuthSession } from "./frontend/src/lib/authSession.ts"; export { loadAppStorageItem, getCachedAppStorageItem } from "./frontend/src/lib/serverStorage.ts"; export { hydrateJournalScope } from "./frontend/src/lib/journalWorkspaceState.ts";', loader: "ts", resolveDir: repoRoot, sourcefile: "journal-history-entry.ts" },
}).outputFiles[0].text;
const journal = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const ownerSession = (id) => ({
  createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token: `owner-${id}`,
  user: { approved: true, email: `owner-${id}@example.com`, id, name: `Owner ${id}`, isBetaUser: true, plan: "beta", provider: "google", betaPosition: null },
});
const trades = (count) => Array.from({ length: count }, (_, index) => ({
  id: 7 + index * 3, entry_time: new Date(Date.UTC(2026, 8, 15, 0, index % 17)).toISOString(), updated_at: "2026-09-15T12:00:00Z",
}));
const response = (rows, status = 200) => new Response(JSON.stringify(rows), { status, headers: { "Content-Type": "application/json" } });

async function withHarness(run) {
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const storage = new Map();
  const requests = [];
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, dispatchEvent() {}, addEventListener() {} };
  journal.setStoredAuthSession(ownerSession(1));
  const harness = {
    requests, storage,
    fetch: (handler) => { globalThis.fetch = async (path, init) => {
      const url = new URL(path, "http://fixture");
      requests.push({ url, init });
      assert.equal(init.headers.get("Authorization"), "Bearer owner-1");
      return handler(url, init, requests.length);
    }; },
  };
  try { await run(harness); }
  finally { globalThis.fetch = previous.fetch; if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window; }
}

function pageOf(rows, url) {
  const cursor = url.searchParams.has("before_id") ? Number(url.searchParams.get("before_id")) : Infinity;
  assert.equal(url.searchParams.get("order"), "id");
  assert.equal(url.searchParams.get("offset"), "0");
  assert.equal(url.searchParams.get("limit"), "500");
  return rows.filter((row) => row.id < cursor).sort((a, b) => b.id - a.id).slice(0, 500);
}

for (const count of [0, 500, 1051, 1500]) test(`complete sparse history of ${count} records terminates and restores entry-time ordering`, async () => {
  await withHarness(async ({ fetch, requests }) => {
    const source = trades(count);
    fetch((url) => response(pageOf(source, url)));
    const loaded = await journal.listAllCanonicalTrades();
    assert.equal(loaded.length, count);
    assert.deepEqual(new Set(loaded.map((row) => row.id)), new Set(source.map((row) => row.id)));
    assert.equal(requests.length, Math.floor(count / 500) + 1);
    assert.equal(requests[0].url.searchParams.has("before_id"), false);
    for (let index = 1; index < requests.length; index++) {
      const prior = pageOf(source, requests[index - 1].url);
      assert.equal(requests[index].url.searchParams.get("before_id"), String(prior.at(-1).id));
    }
    for (let index = 1; index < loaded.length; index++) {
      assert.ok(Date.parse(loaded[index - 1].entry_time) >= Date.parse(loaded[index].entry_time));
      if (loaded[index - 1].entry_time === loaded[index].entry_time) assert.ok(loaded[index - 1].id > loaded[index].id);
    }
  });
});

test("timestamp edits and deletion cannot shift the cursor, and new higher IDs wait for refresh", async () => {
  await withHarness(async ({ fetch }) => {
    let source = trades(1051);
    const removedId = source[10].id;
    const initialIds = source.map((row) => row.id);
    fetch((url, _init, request) => {
      const page = structuredClone(pageOf(source, url));
      if (request === 1) {
        source[0].entry_time = "2030-01-01T00:00:00Z";
        source.at(-1).entry_time = "2020-01-01T00:00:00Z";
        source = source.filter((row) => row.id !== removedId);
        source.push({ ...source[0], id: 99_999 });
      }
      return response(page);
    });
    const loaded = await journal.listAllCanonicalTrades();
    assert.equal(loaded.length, 1050);
    assert.deepEqual(new Set(loaded.map((row) => row.id)), new Set(initialIds.filter((id) => id !== removedId)));
    assert.equal(loaded.some((row) => row.id === 99_999), false);
  });
});

test("a later HTTP failure rejects the complete load rather than returning page one", async () => {
  await withHarness(async ({ fetch, requests }) => {
    const source = trades(1051);
    fetch((url, _init, request) => request === 1 ? response(pageOf(source, url)) : response({ detail: "History storage unavailable" }, 500));
    await assert.rejects(journal.listAllCanonicalTrades(), /History storage unavailable/);
    assert.equal(requests.length, 2);
  });
});

for (const [label, page] of [
  ["non-array", {}], ["oversized", trades(501).reverse()],
  ["duplicate", [{ id: 5 }, { id: 5 }]], ["ascending", [{ id: 4 }, { id: 5 }]],
  ["zero", [{ id: 0 }]], ["negative", [{ id: -1 }]], ["fractional", [{ id: 1.5 }]],
  ["unsafe", [{ id: Number.MAX_SAFE_INTEGER + 1 }]], ["missing ID", [{}]],
]) test(`malformed ${label} page is rejected even when shorter than500`, async () => {
  await withHarness(async ({ fetch, requests }) => {
    fetch(() => response(page));
    await assert.rejects(journal.listAllCanonicalTrades(), /history.*(verified|advance)/);
    assert.equal(requests.length, 1);
  });
});

test("a later page may not repeat or move above its previous ID cursor", async () => {
  await withHarness(async ({ fetch, requests }) => {
    const source = trades(500);
    const first = source.toReversed();
    fetch((_url, _init, request) => response(request === 1 ? first : [first.at(-1)]));
    await assert.rejects(journal.listAllCanonicalTrades(), /paging did not advance/);
    assert.equal(requests.length, 2);
  });
});

test("an already aborted signal prevents the first request", async () => {
  await withHarness(async ({ fetch, requests }) => {
    fetch(() => { throw new Error("must not request"); });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(journal.listAllCanonicalTrades({ signal: controller.signal }), { name: "AbortError" });
    assert.equal(requests.length, 0);
  });
});

test("abort is passed to the active fetch and stops subsequent page requests", async () => {
  await withHarness(async ({ fetch, requests }) => {
    const controller = new AbortController();
    let started;
    const active = new Promise((resolve) => { started = resolve; });
    fetch((url, init, request) => {
      assert.equal(init.signal, controller.signal);
      if (request === 1) return response(pageOf(trades(1051), url));
      started();
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true }));
    });
    const pending = journal.listAllCanonicalTrades({ signal: controller.signal });
    await active;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(requests.length, 2);
  });
});

test("late response after cancellation is discarded even if fetch ignores abort", async () => {
  await withHarness(async ({ fetch, requests }) => {
    const controller = new AbortController();
    fetch((url) => { controller.abort(); return response(pageOf(trades(1051), url)); });
    await assert.rejects(journal.listAllCanonicalTrades({ signal: controller.signal }), { name: "AbortError" });
    assert.equal(requests.length, 1);
  });
});

test("changing the signed-in owner while a page resolves discards all records", async () => {
  await withHarness(async ({ fetch, requests }) => {
    fetch((url) => { journal.setStoredAuthSession(ownerSession(2)); return response(pageOf(trades(1051), url)); });
    await assert.rejects(journal.listAllCanonicalTrades(), { name: "AbortError" });
    assert.equal(requests.length, 1);
  });
});


for (const failure of [false, true]) test(`owner switch during storage GET cannot populate another owner's scope/cache (HTTP failure=${failure})`, async () => {
  await withHarness(async ({ fetch, storage, requests }) => {
    fetch(() => {
      journal.setStoredAuthSession(ownerSession(2));
      return response(failure ? { detail: "Storage offline" } : {
        namespace: "edgelab", key: "journal-account-scope.v1",
        value: { mode: "selected", accountIds: [83199] }, updated_at: "2026-09-15T12:00:00Z",
      }, failure ? 500 : 200);
    });
    await assert.rejects(journal.hydrateJournalScope([83199]), { name: "AbortError" });
    assert.equal(requests.length, 1);
    const fallback = { mode: "all", accountIds: [] };
    assert.deepEqual(journal.getCachedAppStorageItem("journal-account-scope.v1", fallback), fallback);
    assert.equal([...storage.entries()].some(([key, value]) => key !== "edgelab.auth.session.v1" && value.includes("83199")), false);
  });
});
