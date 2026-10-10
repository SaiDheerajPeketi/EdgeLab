import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";

const compiled = await build({ bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  stdin: { contents: `export * from './frontend/src/lib/betterAuthClient';export * from './frontend/src/lib/googleAuth';export * from './frontend/src/lib/authSession';export {authJourneyIssue} from './frontend/src/lib/authJourney';`,
    resolveDir: process.cwd(), loader: "ts" } });
const native = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) }; };
const originalFetch = globalThis.fetch;
const session = token => ({ token, expiresAt: new Date(Date.now()+600000).toISOString(), createdAt: new Date().toISOString(),
  user: { id: 202, email: "owner@example.test", name: "Owner", provider: "google", deploymentMode: "production", workspaceAccess: false } });
function fixture() {
  const redirects = [], requests = [], deferred = [];
  globalThis.window = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage(),
    location: { origin: "https://edgelab.example", replace: href => redirects.push(href) } });
  globalThis.fetch = async (input, options) => {
    requests.push(new Request(input, options));
    return new Promise(resolve => deferred.push(resolve));
  };
  return { redirects, requests, resolve(url = "https://accounts.google.com/o/oauth2/v2/auth?state=native") {
    deferred.shift()(Response.json({ url, redirect: false }));
  } };
}
test.after(() => { globalThis.fetch = originalFetch; delete globalThis.window; });

test("actual Better Auth client requests redirect-only Google sign-in and only the current pending attempt redirects", async () => {
  const f = fixture();
  const pending = native.beginBetterAuthSignIn("/app/live");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "https://edgelab.example/api/better-auth/sign-in/social");
  const body = await f.requests[0].json();
  assert.equal(body.provider, "google"); assert.equal(body.disableRedirect, true);
  const callback = new URL(body.callbackURL);
  assert.equal(body.errorCallbackURL, body.callbackURL);
  assert.equal(callback.pathname, "/auth/callback/google"); assert.equal(callback.searchParams.get("better_auth"), "1");
  f.resolve(); await pending;
  assert.equal(f.redirects.length, 1);
  assert.equal(native.consumeGoogleAuthState(callback.searchParams.get("state"), "").fromPath, "/app/live");
});

test("unmount/context cancellation and replacement attempts never redirect a held native response", async () => {
  const f = fixture(); let owns = true;
  const pending = native.beginBetterAuthSignIn("/shared#" + "A".repeat(43), undefined, () => owns);
  await new Promise(resolve => setImmediate(resolve));
  owns = false; f.resolve(); await pending; assert.deepEqual(f.redirects, []);
  const next = native.beginBetterAuthSignIn("/app/live");
  await new Promise(resolve => setImmediate(resolve));
  native.storeGoogleAuthAttempt("/account", "https://edgelab.example/auth/callback/google", undefined, "");
  f.resolve(); await next; assert.deepEqual(f.redirects, []);
});

test("new account while Google is pending or during full roundtrip cannot inherit old session/destination", async () => {
  const f = fixture();
  const pending = native.beginBetterAuthSignIn("/app/replay");
  await new Promise(resolve => setImmediate(resolve));
  const callback = new URL((await f.requests[0].json()).callbackURL);
  native.setStoredAuthSession(session("replacement202"));
  f.resolve(); await pending; assert.deepEqual(f.redirects, []);
  assert.equal(native.consumeGoogleAuthState(callback.searchParams.get("state"), JSON.stringify([202, "replacement202"])), null);
});

test("unexpected redirect origins are refused by actual client handoff", async () => {
  const f = fixture(); const pending = native.beginBetterAuthSignIn("/app");
  await new Promise(resolve => setImmediate(resolve)); f.resolve("https://accounts.google.com.attacker.example/steal");
  await assert.rejects(pending, /Invalid Google/); assert.deepEqual(f.redirects, []);
});

test("native Google error codes resolve to current sign-in retry messages", () => {
  // The source resolver is exercised by the genuine callback suite; this uses
  // its same compiled production module, not duplicated enum classifications.
  assert.equal(native.authJourneyIssue(new URLSearchParams("error=state_mismatch")).kind, "expired");
  assert.equal(native.authJourneyIssue(new URLSearchParams("error=state_not_found")).kind, "expired");
  assert.equal(native.authJourneyIssue(new URLSearchParams("error=access_denied")).kind, "cancelled");
  assert.equal(native.authJourneyIssue(new URLSearchParams("error=unable_to_get_user_info")).kind, "retryable");
});

test("service-ready Better Auth with no API client ID runs the actual sign-in handler; legacy remains unavailable", async () => {
  const config = { auth_provider: "better-auth", google_enabled: true, google_client_id: null };
  assert.equal(native.isGoogleAuthConfigured(config), true);
  assert.equal(native.isGoogleAuthConfigured({ ...config, google_enabled: false }), false);
  assert.equal(native.isGoogleAuthConfigured({ ...config, auth_provider: "legacy" }), false);
  const source = ts.createSourceFile("AuthSignInPage.tsx", readFileSync("frontend/src/pages/AuthSignInPage.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const find = node => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleGoogleSignIn") initializer = node.initializer.getText(source); ts.forEachChild(node, find); };
  find(source); assert.ok(initializer);
  const compiled = ts.transpileModule(`const handler = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const f = fixture(), errors = [];
  const handler = new Function("config", "googleReady", "setErrorMessage", "setIsSubmitting", "signInOwner", "getStoredAuthSession", "beginBetterAuthSignIn", "fromPath", "pricingDestination", "buildGoogleAuthorizeUrl", compiled + "return handler;")(
    config, native.isGoogleAuthConfigured(config), message => errors.push(message), () => {}, { current: { active: true, generation: 0 } },
    native.getStoredAuthSession, native.beginBetterAuthSignIn, "/app/live", undefined, native.buildGoogleAuthorizeUrl);
  const pending = handler();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, 1);
  f.resolve(); await pending; assert.deepEqual(errors, [null]); assert.equal(f.redirects.length, 1);
});
