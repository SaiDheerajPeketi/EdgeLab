import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(currentDir, "../../frontend/src/lib/api.ts");

async function loadApi() {
  const output = buildSync({ bundle: true, entryPoints: [sourcePath], define: { "import.meta.env": "{}" }, format: "esm", platform: "node", write: false }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}#${Date.now()}`);
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
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
      "edgelab.auth.session.v1": JSON.stringify({ token: "session-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: 1, email: "user@example.test", approved: true } }),
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
