import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(currentDir, "../../frontend/src/lib/api.ts");

async function loadApi() {
  const source = fs
    .readFileSync(sourcePath, "utf8")
    .replace("import.meta.env.VITE_API_BASE_URL", '"/api"')
    .replace("import.meta.env.VITE_API_BEARER_TOKEN", '""');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-api-request-"));
  const compiledPath = path.join(tempDir, "api.mjs");
  fs.writeFileSync(compiledPath, output, "utf8");
  try {
    return await import(`${pathToFileURL(compiledPath).href}?v=${Date.now()}`);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("workspace share open sends auth and capability headers without putting token in the URL", async () => {
  const token = "W".repeat(43);
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  let captured;
  globalThis.window = {
    localStorage: memoryStorage({
      "edgelab.auth.session.v1": JSON.stringify({ token: "session-token" }),
    }),
  };
  globalThis.fetch = async (url, init) => {
    captured = { init, url: String(url) };
    return new Response(JSON.stringify({
      created_at: "2026-09-15T10:00:00Z",
      expires_at: null,
      payload: { schemaVersion: 1 },
      schema_version: 1,
      scope: "panels-only",
      snapshot_version: 1,
      title: "Proof",
    }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };

  try {
    const api = await loadApi();
    await api.openWorkspaceShare(token);
    const headers = new Headers(captured.init.headers);

    assert.equal(captured.url, "/api/workspace-shares/open");
    assert.equal(captured.url.includes(token), false);
    assert.equal(headers.get("Authorization"), "Bearer session-token");
    assert.equal(headers.get("X-Workspace-Share-Token"), token);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
