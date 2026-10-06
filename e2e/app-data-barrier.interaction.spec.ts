import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

type Api = typeof import("../frontend/src/lib/api");
type Navigation = typeof import("../frontend/src/lib/navigationState");
type Outcome = { ok: boolean; name?: string; message?: string; value?: unknown };
declare global {
  interface Window {
    barrierApi: Api;
    barrierNavigation: Navigation;
    barrierResults: Record<string, Outcome>;
    bodyReading: boolean;
    releaseBody: () => void;
  }
}

const owner = "user-7001";
const markerPrefix = `edgelab.app-data-uncertain.v1.${owner}.`;
const generationKey = `edgelab.app-data-generation.v1.${owner}`;
const authKey = "edgelab.auth.session.v1";
const lockName = `edgelab.app-data.${owner}`;
const bundle = { app: "edgelab", version: 1, tables: { app_storage: [{ id: 1, value: { theme: "restored" } }] } };
const nativeTest = test.extend({ video: "off", screenshot: "off", trace: "off" });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function prepare(context: BrowserContext) {
  await context.addInitScript(({ authKey }) => {
    localStorage.setItem(authKey, JSON.stringify({
      createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", token: "native-barrier-test-token",
      user: { approved: true, betaPosition: 1, email: "barrier@example.test", id: 7001, isBetaUser: true,
        name: "Browser Barrier", plan: "beta", provider: "email" },
    }));
  }, { authKey });
  // Keep both tabs on the same origin without mounting App or sending background saves.
  await context.route("**/barrier-proof", (route) => route.fulfill({
    contentType: "text/html", body: "<!doctype html><html><head><title>Barrier regression</title></head><body></body></html>",
  }));
}

async function openProof(context: BrowserContext, existing?: Page) {
  const page = existing ?? await context.newPage();
  await page.goto("/barrier-proof");
  await page.evaluate(async () => {
    const apiPath = "/src/lib/api.ts";
    window.barrierApi = await import(apiPath);
    window.barrierResults = {};
  });
  expect(await page.evaluate(() => typeof navigator.locks?.request)).toBe("function");
  return page;
}

type Receipt = {
  operation_id: string; method: string | null; path: string | null;
  status: "reserved" | "running" | "completed" | "canceled";
  http_status: number | null; result: import("../frontend/src/lib/api").AppDataImportResult | null;
  created_at: string; completed_at: string | null;
};

async function mockApi(context: BrowserContext, hooks: {
  put?: (route: Route) => Promise<void>; replacement?: () => Promise<void>;
  importResponse?: "lost"; leaveImportRunning?: boolean;
} = {}) {
  const receipts = new Map<string, Receipt>();
  const pendingImports = new Map<string, { result: Receipt["result"]; value: { theme: string } }>();
  const server = {
    value: { theme: "old" }, puts: 0, imports: 0, reserves: 0, recoveries: 0, receipts,
    completeImports() {
      for (const [id, pending] of pendingImports) {
        Object.assign(receipts.get(id)!, { status: "completed", http_status: 200,
          result: pending.result, completed_at: "2026-10-07T00:00:01Z" });
        server.value = pending.value;
        pendingImports.delete(id);
      }
    },
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-EdgeLab-Operation-Id", "Access-Control-Allow-Methods": "GET, PUT, POST" } });
      return;
    }
    expect(request.headers().authorization).toBe("Bearer native-barrier-test-token");
    const metadata = path.match(/\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (metadata) {
      expect(request.method()).toBe("POST");
      expect(request.headers()["x-edgelab-operation-id"]).toBeUndefined();
      const [, id, action] = metadata;
      if (action === "reserve") {
        server.reserves += 1;
        expect(receipts.has(id)).toBe(false);
        const { method, path: operationPath } = request.postDataJSON();
        receipts.set(id, { operation_id: id, method, path: operationPath, status: "reserved",
          http_status: null, result: null, created_at: "2026-10-07T00:00:00Z", completed_at: null });
      } else {
        server.recoveries += 1;
        const receipt = receipts.get(id);
        expect(receipt).toBeDefined();
        // Recover atomically cancels a reservation that never dispatched its mutation.
        if (receipt?.status === "reserved") Object.assign(receipt, { status: "canceled", completed_at: "2026-10-07T00:00:01Z" });
      }
      await route.fulfill({ json: receipts.get(id) });
      return;
    }
    const mutation = request.method() !== "GET";
    const id = request.headers()["x-edgelab-operation-id"];
    const receipt = id ? receipts.get(id) : undefined;
    if (mutation) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(receipt).toMatchObject({ status: "reserved", method: request.method(), path: path.replace(/^\/api/, "") });
      receipt!.status = "running";
    } else expect(id).toBeUndefined();
    if (path.endsWith("/app-data/import")) {
      const payload = request.postDataJSON();
      const tableNames = await request.frame().evaluate(() => [...window.barrierApi.APP_DATA_TABLE_NAMES]);
      expect(tableNames).toHaveLength(23);
      pendingImports.set(id, { value: payload.tables.app_storage[0].value,
        result: { ok: true, imported_at: "2026-10-07T00:00:01Z",
          summary: Object.fromEntries(tableNames.map((table) => [table, payload.tables[table]?.length ?? 0])) } });
      server.imports += 1;
      await hooks.replacement?.();
      if (!hooks.leaveImportRunning) server.completeImports();
      try {
        if (hooks.importResponse === "lost") await route.abort("failed");
        else await route.fulfill({ json: receipts.get(id)!.result });
      } catch { /* A closed importing tab cannot consume its completed response. */ }
      return;
    }
    expect(path).toContain("/app-storage/");
    if (request.method() === "PUT") {
      server.puts += 1;
      if (hooks.put) { await hooks.put(route); return; }
      server.value = request.postDataJSON().value;
      Object.assign(receipt!, { status: "completed", http_status: 200, completed_at: "2026-10-07T00:00:01Z" });
    }
    await route.fulfill({ json: { namespace: "workspace", key: "preferences", value: server.value, updated_at: "2026-10-07T00:00:01Z" } });
  });
  return server;
}

async function startSave(page: Page, resultKey = "save") {
  await page.evaluate((key) => {
    void window.barrierApi.putAppStorageItem("workspace", "preferences", { theme: "stale" }).then(
      (value) => { window.barrierResults[key] = { ok: true, value }; },
      (error) => { window.barrierResults[key] = { ok: false, name: error.name, message: error.message }; },
    );
  }, resultKey);
}

async function startImport(page: Page) {
  await page.evaluate((payload) => {
    delete window.barrierResults.import;
    void window.barrierApi.importAppDataBundle(payload as Parameters<Api["importAppDataBundle"]>[0]).then(
      (value) => { window.barrierResults.import = { ok: true, value }; },
      (error) => { window.barrierResults.import = { ok: false, name: error.name, message: error.message }; },
    );
  }, bundle);
}

async function outcome(page: Page, key: string) {
  await expect.poll(() => page.evaluate((key) => window.barrierResults[key] ?? null, key)).not.toBeNull();
  return page.evaluate((key) => window.barrierResults[key], key);
}

async function markers(page: Page) {
  return page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)).map((key) => JSON.parse(localStorage.getItem(key)!)), markerPrefix);
}

nativeTest.describe("native cross-tab account replacement barrier", () => {
  nativeTest.beforeEach(async ({ context }) => prepare(context));

  nativeTest("import waits through save response consumption and rejects the old tab before fetch", async ({ context, page }) => {
    const server = await mockApi(context);
    const old = await openProof(context, page);
    const importer = await openProof(context);
    await old.evaluate(() => {
      const originalText = Response.prototype.text;
      const bodyGate = new Promise<void>((done) => { window.releaseBody = done; });
      // Delay consumption after native fetch has returned headers, not just before the response arrives.
      Response.prototype.text = async function () {
        if (this.url.includes("/app-storage/")) {
          window.bodyReading = true;
          await bodyGate;
        }
        return originalText.call(this);
      };
    });
    await startSave(old);
    await expect.poll(() => old.evaluate(() => window.bodyReading)).toBe(true);
    await startImport(importer);
    await expect.poll(() => importer.evaluate(async (name) => {
      const locks = await navigator.locks.query();
      return { held: locks.held?.filter((lock) => lock.name === name).map((lock) => lock.mode),
        pending: locks.pending?.filter((lock) => lock.name === name).map((lock) => lock.mode) };
    }, lockName)).toEqual({ held: ["shared"], pending: ["exclusive"] });
    expect(server.imports).toBe(0);
    expect(await markers(old)).toEqual([expect.objectContaining({ version: 2, method: "PUT", path: "/app-storage/workspace/preferences", phase: "pending" })]);
    await old.evaluate(() => window.releaseBody());
    expect((await outcome(old, "save")).ok).toBe(true);
    expect((await outcome(importer, "import")).ok).toBe(true);
    expect(server.imports).toBe(1);
    expect(await markers(importer)).toEqual([]);
    await startSave(old, "stale");
    expect(await outcome(old, "stale")).toMatchObject({ ok: false, name: "AppDataReloadRequiredError" });
    expect(server.puts).toBe(1);
    expect(server.value).toEqual({ theme: "restored" });
  });

  nativeTest("mid-import tabs must reload; owner mirrors purge and old session drafts stay retired after navigation", async ({ context, page }) => {
    const gate = deferred();
    const server = await mockApi(context, { replacement: () => gate.promise });
    const old = await openProof(context, page);
    const importer = await openProof(context);
    const navigationKey = `edgelab.navigation-surfaces.v3.${owner}`;
    await old.evaluate(async (key) => {
      const navigationPath = "/src/lib/navigationState.ts";
      window.barrierNavigation = await import(navigationPath);
      window.barrierNavigation.rememberNavigationState("journal:notes", { scrollLeft: 0, scrollTop: 55, draft: { text: "old private draft" } });
      if (!sessionStorage.getItem(key)) throw new Error("Draft did not persist");
    }, navigationKey);
    const purged = [`edgelab.preferences.v1.${owner}`, `edgelab.preferences.v1.${owner}.__updatedAt`, `edgelab.preferences.v1.${owner}.data-older`];
    const preserved = ["edgelab.preferences.v1.user-8002", "edgelab.preferences.v1", "edgelab.ui.rollout.v1", "unrelated.user-7001"];
    await importer.evaluate(({ purged, preserved }) => {
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of [...purged, ...preserved]) storage.setItem(key, "keep-or-purge");
      }
    }, { purged, preserved });
    await startImport(importer);
    await expect.poll(() => server.imports).toBe(1);
    const during = await openProof(context);
    const replacing = await during.evaluate((key) => JSON.parse(localStorage.getItem(key)!), generationKey);
    expect(replacing.phase).toBe("replacing");
    gate.resolve();
    expect((await outcome(importer, "import")).ok).toBe(true);
    const ready = await importer.evaluate((key) => JSON.parse(localStorage.getItem(key)!), generationKey);
    expect(ready.phase).toBe("ready");
    expect(ready.revision).not.toBe(replacing.revision);
    await startSave(during);
    expect(await outcome(during, "save")).toMatchObject({ ok: false, name: "AppDataReloadRequiredError" });
    expect(server.puts).toBe(0);
    expect(await importer.evaluate(({ purged, preserved, authKey }) => ({
      purged: [localStorage, sessionStorage].flatMap((storage) => purged.map((key) => storage.getItem(key))),
      preserved: [localStorage, sessionStorage].flatMap((storage) => preserved.map((key) => storage.getItem(key))),
      auth: Boolean(localStorage.getItem(authKey)),
    }), { purged, preserved, authKey })).toEqual({ purged: Array(6).fill(null), preserved: Array(8).fill("keep-or-purge"), auth: true });
    // The import tab cannot purge another tab's sessionStorage. A cold document must ignore that generation.
    expect(await old.evaluate((key) => sessionStorage.getItem(key), navigationKey)).toContain("old private draft");
    expect(await old.evaluate(() => window.barrierNavigation.navigationStateFor("journal:notes"))).toBeNull();
    await openProof(context, old);
    expect(await old.evaluate(async () => {
      const navigationPath = "/src/lib/navigationState.ts";
      window.barrierNavigation = await import(navigationPath);
      return window.barrierNavigation.navigationStateFor("journal:notes");
    })).toBeNull();
    const fresh = await openProof(context);
    expect(await fresh.evaluate(async () => (await window.barrierApi.getAppStorageItem("workspace", "preferences")).value)).toEqual({ theme: "restored" });
    await fresh.evaluate(async () => { await window.barrierApi.putAppStorageItem("workspace", "preferences", { theme: "fresh" }); });
    expect(server.puts).toBe(1);
    expect(server.value).toEqual({ theme: "fresh" });
  });

  nativeTest("failed save transport retains a durable marker and pauses a second tab import", async ({ context, page }) => {
    const server = await mockApi(context, { put: async (route) => { await route.abort("failed"); } });
    const old = await openProof(context, page);
    const importer = await openProof(context);
    await startSave(old);
    expect((await outcome(old, "save")).ok).toBe(false);
    expect(await markers(importer)).toEqual([expect.objectContaining({ version: 2, method: "PUT", path: "/app-storage/workspace/preferences", phase: "uncertain" })]);
    await startImport(importer);
    expect(await outcome(importer, "import")).toMatchObject({ ok: false, name: "AppDataReloadRequiredError" });
    expect(server.imports).toBe(0);
    expect(await importer.evaluate((key) => localStorage.getItem(key), generationKey)).toBeNull();
    expect([...server.receipts.values()]).toEqual([expect.objectContaining({ status: "running" })]);
  });

  nativeTest("closing the saving tab releases its native lock but never admits import over the pending save", async ({ context, page }) => {
    const gate = deferred();
    const server = await mockApi(context, { put: async (route) => {
      await gate.promise;
      try { await route.fulfill({ json: { value: { theme: "late" } } }); } catch { /* The saving tab is already closed. */ }
    } });
    const old = await openProof(context, page);
    const importer = await openProof(context);
    try {
      await startSave(old);
      await expect.poll(() => server.puts).toBe(1);
      expect(await markers(importer)).toEqual([expect.objectContaining({ version: 2, method: "PUT", path: "/app-storage/workspace/preferences", phase: "pending" })]);
      await startImport(importer);
      await expect.poll(() => importer.evaluate(async (name) => (await navigator.locks.query()).pending?.filter((lock) => lock.name === name).map((lock) => lock.mode), lockName)).toEqual(["exclusive"]);
      await old.close();
      expect(await outcome(importer, "import")).toMatchObject({ ok: false, name: "AppDataReloadRequiredError" });
      expect(server.imports).toBe(0);
      expect(await markers(importer)).toEqual([expect.objectContaining({ version: 2, method: "PUT", path: "/app-storage/workspace/preferences", phase: "pending" })]);
      expect(await importer.evaluate(async (name) => (await navigator.locks.query()).held?.filter((lock) => lock.name === name), lockName)).toEqual([]);
    } finally { gate.resolve(); }
  });

  nativeTest("closing an importing tab retains its operation until a terminal server receipt is recovered", async ({ context, page }) => {
    const gate = deferred();
    const server = await mockApi(context, { replacement: () => gate.promise });
    const old = await openProof(context, page);
    const importer = await openProof(context);
    await startImport(importer);
    await expect.poll(() => server.imports).toBe(1);
    const replacing = await old.evaluate((key) => JSON.parse(localStorage.getItem(key)!), generationKey);
    expect(replacing).toMatchObject({ phase: "replacing", operation: { version: 2, method: "POST", path: "/app-data/import" } });
    expect(Object.keys(replacing.operation.expected)).toHaveLength(23);
    await importer.close();
    const recovery = await openProof(context);
    const retained = await recovery.evaluate((key) => localStorage.getItem(key), generationKey);
    await expect(recovery.evaluate(() => window.barrierApi.recoverAccountDataOperations())).rejects.toThrow("still running");
    expect(await recovery.evaluate((key) => localStorage.getItem(key), generationKey)).toBe(retained);
    expect(server.imports).toBe(1);
    server.completeImports();
    const result = await recovery.evaluate(() => window.barrierApi.recoverAccountDataOperations());
    expect(result).toMatchObject({ requiresReload: true, results: [{ status: "completed", http_status: 200,
      result: { ok: true, summary: { app_storage: 1 } } }] });
    expect(Object.keys(result.results[0].result!.summary)).toHaveLength(23);
    expect(await recovery.evaluate((key) => JSON.parse(localStorage.getItem(key)!).phase, generationKey)).toBe("ready");
    await startSave(old);
    expect(await outcome(old, "save")).toMatchObject({ ok: false, name: "AppDataReloadRequiredError" });
    expect(server.puts).toBe(0);
    const fresh = await openProof(context);
    expect(await fresh.evaluate(async () => (await window.barrierApi.getAppStorageItem("workspace", "preferences")).value)).toEqual({ theme: "restored" });
    gate.resolve();
  });

  nativeTest("a lost import response succeeds from the completed exact 23-table receipt without replay", async ({ context, page }) => {
    const server = await mockApi(context, { importResponse: "lost" });
    const importer = await openProof(context, page);
    await startImport(importer);
    const result = await outcome(importer, "import");
    expect(result).toMatchObject({ ok: true, value: { ok: true, summary: { app_storage: 1 } } });
    const summary = (result.value as import("../frontend/src/lib/api").AppDataImportResult).summary;
    const tables = await importer.evaluate(() => [...window.barrierApi.APP_DATA_TABLE_NAMES]);
    expect(summary).toEqual(Object.fromEntries(tables.map((table) => [table, table === "app_storage" ? 1 : 0])));
    expect(server.imports).toBe(1);
    expect(server.reserves).toBe(1);
    expect(server.recoveries).toBe(1);
    expect(await importer.evaluate((key) => JSON.parse(localStorage.getItem(key)!).phase, generationKey)).toBe("ready");
    expect(await markers(importer)).toEqual([]);
    await startImport(importer);
    expect((await outcome(importer, "import")).ok).toBe(false);
    expect(server.imports).toBe(1);
  });

  nativeTest("a lost response with a running receipt retains the import marker and blocks saves until completion", async ({ context, page }) => {
    const server = await mockApi(context, { importResponse: "lost", leaveImportRunning: true });
    const importer = await openProof(context, page);
    await startImport(importer);
    expect(await outcome(importer, "import")).toMatchObject({ ok: false, name: "AppDataImportUncertainError" });
    const uncertain = await importer.evaluate((key) => localStorage.getItem(key), generationKey);
    expect(JSON.parse(uncertain!)).toMatchObject({ phase: "uncertain", operation: { path: "/app-data/import" } });
    const recovery = await openProof(context);
    await expect(recovery.evaluate(() => window.barrierApi.recoverAccountDataOperations())).rejects.toThrow("still running");
    expect(await recovery.evaluate((key) => localStorage.getItem(key), generationKey)).toBe(uncertain);
    await startSave(recovery);
    expect(await outcome(recovery, "save")).toMatchObject({ ok: false, name: "AppDataReloadRequiredError" });
    expect(server.puts).toBe(0);
    expect(server.value).toEqual({ theme: "old" });
    server.completeImports();
    expect(await recovery.evaluate(() => window.barrierApi.recoverAccountDataOperations())).toMatchObject({ requiresReload: true });
    const fresh = await openProof(context);
    await startSave(fresh);
    expect((await outcome(fresh, "save")).ok).toBe(true);
    expect(server.puts).toBe(1);
    expect(server.imports).toBe(1);
  });
});
