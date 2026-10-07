import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(currentDir, "../../frontend/src/lib/authJourney.ts");
const googleAuthSourcePath = path.resolve(currentDir, "../../frontend/src/lib/googleAuth.ts");

async function loadAuthJourney() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-auth-journey-"));
  const compiledPath = path.join(tempDir, "authJourney.mjs");
  fs.writeFileSync(compiledPath, output, "utf8");
  try {
    return await import(`${pathToFileURL(compiledPath).href}?v=${Date.now()}`);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

function loadGoogleAuth() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-google-auth-"));
  for (const [inputPath, outputName] of [
    [sourcePath, "authJourney.js"],
    [googleAuthSourcePath, "googleAuth.js"],
  ]) {
    const output = ts.transpileModule(fs.readFileSync(inputPath, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    fs.writeFileSync(path.join(tempDir, outputName), output, "utf8");
  }
  return {
    cleanup: () => fs.rmSync(tempDir, { force: true, recursive: true }),
    module: createRequire(import.meta.url)(path.join(tempDir, "googleAuth.js")),
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("signed-out share destination survives the authentication return pipeline", async () => {
  const { authDestinationFromLocation, buildAuthSignInHref } = await loadAuthJourney();
  const token = "A".repeat(43);
  const destination = `/shared#${token}`;
  const signInHref = buildAuthSignInHref({ fromPath: destination });
  const parsedSignIn = new URL(signInHref, "https://edgelab.invalid");

  assert.equal(parsedSignIn.searchParams.has("from"), false);
  assert.equal(signInHref.includes(token), false);
  assert.equal(
    authDestinationFromLocation({
      search: parsedSignIn.search,
      state: { fromPath: destination },
    }),
    destination,
  );
  assert.equal(
    authDestinationFromLocation({ search: parsedSignIn.search, state: null }),
    "/app",
  );
});

test("share return accepts only an exact token fragment", async () => {
  const { safeAuthDestination } = await loadAuthJourney();
  const token = "z".repeat(43);

  assert.equal(safeAuthDestination(`/shared#${token}`), `/shared#${token}`);
  assert.equal(safeAuthDestination(`/shared?token=${token}`), "/app");
  assert.equal(safeAuthDestination("/shared#short"), "/app");
  assert.equal(safeAuthDestination(`/shared#${token}%2Fescape`), "/app");
  assert.equal(safeAuthDestination(`/shared/#${token}`), "/app");
  assert.equal(safeAuthDestination(`//evil.example/shared#${token}`), "/app");
});

test("billing destinations preserve the selected cadence and account recovery", async () => {
  const { authDestinationFromLocation, buildAuthSignInHref, isBillingAuthDestination, safeAuthDestination } = await loadAuthJourney();
  for (const destination of ["/pricing", "/pricing?cadence=annual", "/account"]) {
    assert.equal(safeAuthDestination(destination), destination);
    assert.equal(isBillingAuthDestination(destination), true);
    const signin = new URL(buildAuthSignInHref({ fromPath: destination }), "https://edgelab.invalid");
    assert.equal(authDestinationFromLocation({ search: signin.search, state: null }), destination);
  }
  for (const destination of ["/account/other", "/pricing/checkout", "//evil.example/pricing", "/%2fpricing", "/pricing\\escape"]) {
    assert.equal(safeAuthDestination(destination), "/app");
    assert.equal(isBillingAuthDestination(destination), false);
  }
});

test("unpaid pricing handoff keeps share capabilities out of the URL", async () => {
  const { authDestinationFromLocation, buildPricingHref } = await loadAuthJourney();
  const destination = `/shared#${"C".repeat(43)}`;
  const href = buildPricingHref(destination);
  assert.equal(href, "/pricing");
  assert.equal(href.includes("C".repeat(43)), false);
  assert.equal(authDestinationFromLocation({ search: "", state: { fromPath: destination } }), destination);
  const replay = "/app/replay?session=42#trade-7";
  assert.equal(new URL(buildPricingHref(replay), "https://edgelab.invalid").searchParams.get("from"), replay);
});

test("OAuth handoff keeps share capabilities in session storage only", () => {
  const token = "S".repeat(43);
  const destination = `/shared#${token}`;
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://edgelab.test" },
    localStorage,
    sessionStorage,
  };
  const { module, cleanup } = loadGoogleAuth();

  try {
    const authorizeUrl = module.buildGoogleAuthorizeUrl(
      destination,
      "google-client",
      "https://edgelab.test/auth/callback/google",
    );
    const state = new URL(authorizeUrl).searchParams.get("state");

    assert.equal(authorizeUrl.includes(token), false);
    assert.equal(localStorage.getItem("edgelab.google-auth.state.v1"), null);
    assert.match(sessionStorage.getItem("edgelab.google-auth.state.v1"), new RegExp(token));
    assert.equal(module.consumeGoogleAuthState(state).fromPath, destination);
    assert.equal(sessionStorage.getItem("edgelab.google-auth.state.v1"), null);
  } finally {
    cleanup();
    globalThis.window = previousWindow;
  }
});

test("annual checkout sign-in carries its shared destination only in the OAuth session", () => {
  const destination = `/shared#${"P".repeat(43)}`;
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://edgelab.test" }, localStorage, sessionStorage };
  const { module, cleanup } = loadGoogleAuth();
  try {
    const url = module.buildGoogleAuthorizeUrl("/pricing?cadence=annual", "google-client", "https://edgelab.test/auth/callback/google", destination);
    assert.equal(url.includes("P".repeat(43)), false);
    assert.equal(localStorage.getItem("edgelab.google-auth.state.v1"), null);
    const state = module.consumeGoogleAuthState(new URL(url).searchParams.get("state"));
    assert.equal(state.fromPath, "/pricing?cadence=annual");
    assert.equal(state.pricingDestination, destination);
    assert.equal(sessionStorage.getItem("edgelab.google-auth.state.v1"), null);

    const second = module.buildGoogleAuthorizeUrl("/pricing", "google-client", null, "/app/replay");
    const raw = JSON.parse(sessionStorage.getItem("edgelab.google-auth.state.v1"));
    raw.pricingDestination = "//evil.example/app";
    sessionStorage.setItem("edgelab.google-auth.state.v1", JSON.stringify(raw));
    assert.equal(module.consumeGoogleAuthState(new URL(second).searchParams.get("state")), null);
  } finally {
    cleanup();
    globalThis.window = previousWindow;
  }
});
