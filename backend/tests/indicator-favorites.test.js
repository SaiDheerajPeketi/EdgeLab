import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const bundle = (await build({
  bundle: true,
  define: { "import.meta.env": "{}" },
  format: "esm",
  logLevel: "silent",
  platform: "node",
  plugins: [{
    name: "favorite-storage-api-fixture",
    setup(build) {
      build.onLoad({ filter: /\/api\.ts$/ }, () => ({
        contents: [
          "export async function getAppStorageItem() { return { value: null, updated_at: null }; }",
          "export async function putAppStorageItem(_namespace, _key, value) { return { value, updated_at: Date.now() }; }",
        ].join("\n"),
        loader: "ts",
      }));
      build.onLoad({ filter: /\/authSession\.ts$/ }, () => ({
        contents: "export function getStoredAuthSession() { return { user: { id: 7 } }; }",
        loader: "ts",
      }));
    },
  }],
  stdin: {
    contents: 'export * from "./frontend/src/lib/indicatorFavorites.ts";',
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "indicator-favorites-entry.ts",
  },
  target: "node22",
  write: false,
})).outputFiles[0].text;
const favorites = await import(
  `data:text/javascript;base64,${Buffer.from(bundle + "\n//# sourceURL=indicator-favorites-bundle.js").toString("base64")}`,
);

test("existing native v1 favorites migrate to scoped storage and retain script favorites", async () => {
  const values = new Map([["edgelab.indicator-favorites.v1", JSON.stringify(["rsi", "ema", "vwap"])]]);
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    assert.equal(favorites.INDICATOR_FAVORITES_STORAGE_KEY, "indicator-favorites.v1");
    assert.deepEqual(await favorites.hydrateIndicatorFavorites(), ["rsi", "ema", "vwap"]);
    assert.deepEqual(
      JSON.parse(values.get("edgelab.indicator-favorites.v1.user-7")),
      ["rsi", "ema", "vwap"],
    );
    await new Promise((resolve) => setImmediate(resolve));
    const mixed = ["rsi", "script:first-party:adx", "script:user-study-17"];
    await favorites.persistIndicatorFavorites(mixed);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(favorites.loadCachedIndicatorFavorites(), mixed);
    assert.deepEqual(await favorites.hydrateIndicatorFavorites(), mixed);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("native, first-party, and user favorites keep distinct reversible identities", () => {
  const firstParty = favorites.scriptIndicatorFavorite("first-party:adx");
  const custom = favorites.scriptIndicatorFavorite("user-study-17");
  assert.equal(firstParty, "script:first-party:adx");
  assert.equal(custom, "script:user-study-17");
  assert.equal(favorites.favoriteIndicatorScriptId(firstParty), "first-party:adx");
  assert.equal(favorites.favoriteIndicatorScriptId(custom), "user-study-17");
  assert.equal(favorites.favoriteIndicatorScriptId("ema"), null);
  assert.deepEqual(
    favorites.sanitizeIndicatorFavorites(["ema", firstParty, custom, firstParty]),
    ["ema", firstParty, custom],
  );
});

test("mixed favorites share one six-item limit without reordering the saved list", () => {
  const original = ["ema", "script:first-party:adx", "rsi", "script:user-17", "vwap", "atr"];
  const snapshot = [...original];
  assert.deepEqual(favorites.sanitizeIndicatorFavorites([...original, "sma"]), original);
  assert.deepEqual(favorites.toggleIndicatorFavorite(original, "sma"), original);
  assert.deepEqual(favorites.toggleIndicatorFavorite(original, "script:user-17"), [
    "ema", "script:first-party:adx", "rsi", "vwap", "atr",
  ]);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(favorites.toggleIndicatorFavorite(original.slice(0, 5), "sma"), [
    ...original.slice(0, 5), "sma",
  ]);
});

test("unavailable scripts retain removable favorites and malformed identities are discarded", () => {
  const unavailable = "script:deleted-study";
  assert.deepEqual(favorites.sanitizeIndicatorFavorites(["ema", unavailable]), ["ema", unavailable]);
  assert.deepEqual(favorites.toggleIndicatorFavorite(["ema", unavailable], unavailable), ["ema"]);
  assert.deepEqual(
    favorites.sanitizeIndicatorFavorites([
      "invalid", "script:", "script:unsafe/path", "script:<markup>",
      "script:" + "a".repeat(97), null, 17, "script:valid_user-17", "rsi",
    ]),
    ["script:valid_user-17", "rsi"],
  );
  assert.deepEqual(favorites.sanitizeIndicatorFavorites([]), []);
  assert.deepEqual(favorites.sanitizeIndicatorFavorites(null), favorites.DEFAULT_INDICATOR_FAVORITES);
});
