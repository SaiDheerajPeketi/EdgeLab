import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// Execute the actual callback and auth/state/destination helpers. Only React
// effect scheduling, router navigation and the exchange network are seams.
let fixture;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const react = {
  useState(initial) {
    const index = fixture.cursor++;
    if (!(index in fixture.slots)) fixture.slots[index] = initial;
    return [fixture.slots[index], next => { fixture.slots[index] = next; }];
  },
  useRef(initial) {
    const index = fixture.cursor++;
    return fixture.slots[index] ??= { current: initial };
  },
  useEffect(fn, deps) {
    const index = fixture.cursor++, previous = fixture.effects[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      fixture.pending.push(() => {
        previous?.cleanup?.();
        fixture.effects[index] = { fn, deps, cleanup: fn() };
      });
    }
  },
};
globalThis.__callback141 = {
  react,
  location: () => fixture.location,
  navigate: (href, options) => fixture.navigations.push({ href, ...options }),
  exchange: payload => {
    const exchange = { payload, ...deferred() };
    fixture.exchanges.push(exchange);
    return exchange.promise;
  },
};
const bundle = await build({
  bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  stdin: {
    contents: `export {AuthCallbackPage} from "./frontend/src/pages/AuthCallbackPage";
      export * from "./frontend/src/lib/authSession";
      export * from "./frontend/src/lib/googleAuth";
      export {ApiError} from "./frontend/src/lib/api";`,
    resolveDir: process.cwd(), loader: "ts",
  },
  plugins: [{ name: "callback-boundaries", setup(plugin) {
    plugin.onResolve({ filter: /^react$|^react\/jsx-runtime$|^react-router-dom$|\/api$|AuthTransitionScreen$/ }, args => ({ path: args.path.endsWith("/api") ? "api" : args.path, namespace: "callback141" }));
    plugin.onLoad({ filter: /.*/, namespace: "callback141" }, ({ path }) => ({ loader: "js", contents:
      path === "react" ? `const r=globalThis.__callback141.react;export const useEffect=r.useEffect,useRef=r.useRef,useState=r.useState;` :
      path === "react/jsx-runtime" ? `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;` :
      path === "react-router-dom" ? `export const useLocation=()=>globalThis.__callback141.location();export const useNavigate=()=>globalThis.__callback141.navigate;` :
      path === "api" ? `export class ApiError extends Error{constructor(message,status){super(message);this.status=status;}}export const exchangeGoogleAuthCode=x=>globalThis.__callback141.exchange(x);export const exchangeBetterAuthSession=()=>globalThis.__callback141.exchange({betterAuth:true});` :
      `export const AuthTransitionScreen=x=>x;`,
    }));
  } }],
});
const production = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const AUTH = "edgelab.auth.session.v1", STATE = "edgelab.google-auth.state.v1";
const realNow = Date.now;
let now = 1_900_000_000_000;
Date.now = () => now;
function storage() {
  const values = new Map();
  return {
    failAuthWrite: false,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (key === AUTH && this.failAuthWrite) throw new Error("Storage unavailable");
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
  };
}
function session(id = 1, token = `token-${id}`, access = true, mode = "production") {
  return {
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), token,
    user: { id, email: `${id}@test.invalid`, name: `User ${id}`, approved: true, betaPosition: 1,
      deploymentMode: mode, workspaceAccess: access, accessExpiresAt: new Date(now + 3_600_000).toISOString(),
      isBetaUser: mode === "beta", plan: access ? (mode === "beta" ? "beta" : "pro") : "none", provider: "google" },
  };
}
function response(value = session()) {
  const u = value.user;
  return { session: { created_at: value.createdAt, expires_at: value.expiresAt, token: value.token,
    user: { id: u.id, email: u.email, name: u.name, approved: u.approved, beta_position: u.betaPosition,
      deployment_mode: u.deploymentMode, workspace_access: u.workspaceAccess, access_expires_at: u.accessExpiresAt,
      is_beta_user: u.isBetaUser, plan: u.plan, provider: u.provider } } };
}
function harness(owner = null, destination = "/app", pricingDestination) {
  now = 1_900_000_000_000;
  const target = new EventTarget();
  const frames = new Map();
  let nextFrame = 0;
  globalThis.window = Object.assign(target, {
    localStorage: storage(), sessionStorage: storage(), location: { origin: "https://test.invalid" },
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  });
  production.setStoredAuthSession(owner);
  const f = fixture = { cursor: 0, slots: [], effects: [], pending: [], exchanges: [], navigations: [],
    location: { search: "?code=code-A&state=state-A" } };
  const seed = (state = "state-A", fromPath = destination) => {
    window.sessionStorage.setItem(STATE, JSON.stringify({ state, fromPath, pricingDestination,
      redirectUri: "https://test.invalid/auth/callback/google", issuedAt: now }));
  };
  seed();
  const render = () => {
    fixture = f; f.cursor = 0; f.pending = [];
    const result = production.AuthCallbackPage();
    f.pending.forEach(run => run());
    return result;
  };
  const dispose = () => { fixture = f; for (const effect of f.effects) effect?.cleanup?.(); };
  return { f, frames, seed, render, dispose,
    replay() { fixture = f; for (const effect of f.effects) if (effect) { effect.cleanup?.(); effect.cleanup = effect.fn(); } },
    remount() { dispose(); f.slots = []; f.effects = []; render(); },
    frame() { for (const [id, run] of [...frames]) { frames.delete(id); run(); } },
    owner: () => production.getStoredAuthSession(),
    transition: value => production.setStoredAuthSession(value, { notify: false }),
    storageEvent(key, oldValue, newValue) {
      const event = new Event("storage"); Object.assign(event, { key, oldValue, newValue }); window.dispatchEvent(event);
    },
  };
}
test.after(() => { Date.now = realNow; delete globalThis.window; delete globalThis.__callback141; });

test("StrictMode replays share only pending exchange and commit once", async () => {
  const h = harness(); h.render(); h.replay();
  assert.equal(h.f.exchanges.length, 1);
  h.f.exchanges[0].resolve(response()); await flush(); h.frame();
  assert.equal(h.owner().token, "token-1");
  assert.deepEqual(h.f.navigations, [{ href: "/app", replace: true, state: undefined }]);
  h.dispose();
});

test("successful callback revisit cannot recover consumed state or settled token", async () => {
  const h = harness(); h.render(); h.f.exchanges[0].resolve(response()); await flush(); h.frame();
  h.transition(null); h.remount();
  assert.equal(h.owner(), null); assert.equal(h.f.exchanges.length, 1);
  assert.match(h.f.navigations.at(-1).href, /oauth-state-expired/);
  h.dispose();
});

test("failed and unmounted callbacks cannot reuse settled or held responses", async () => {
  const h = harness(); h.render(); h.f.exchanges[0].reject(new Error("Network")); await flush();
  h.remount(); assert.equal(h.f.exchanges.length, 1); assert.match(h.f.navigations.at(-1).href, /oauth-state-expired/);
  h.seed("state-B"); h.f.location.search = "?code=code-B&state=state-B"; h.render();
  const held = h.f.exchanges[1]; h.remount(); held.resolve(response()); await flush(); h.frame();
  assert.equal(h.owner(), null); assert.equal(h.f.exchanges.length, 2);
  h.dispose();
});

test("held A cannot overwrite B and cancellation discards old share/billing destinations", async () => {
  const h = harness(null, `/shared#${"A".repeat(43)}`, "/app/replay"); h.render();
  h.transition(session(2)); h.f.exchanges[0].resolve(response()); await flush(); h.frame();
  assert.equal(h.owner().token, "token-2");
  assert.deepEqual(h.f.navigations, [{ href: "/account", replace: true }]);
  h.dispose();
});

test("same-tab account and token ABA transitions invalidate permanently", async () => {
  for (const original of [null, session(1)]) {
    const h = harness(original); h.render();
    h.transition(session(2)); h.transition(null); h.transition(original);
    h.f.exchanges[0].resolve(response(session(3))); await flush(); h.frame();
    assert.equal(h.owner()?.token ?? null, original?.token ?? null);
    assert.deepEqual(h.f.navigations, [{ href: "/account", replace: true }]);
    h.dispose();
  }
  const h = harness(session(1)); h.render(); h.transition(session(1, "renewed"));
  h.f.exchanges[0].resolve(response()); await flush(); h.frame();
  assert.equal(h.owner().token, "renewed"); assert.equal(h.f.navigations[0].href, "/account"); h.dispose();
});

test("cross-tab queued ABA and clear events cannot hide behind restored identity", async () => {
  for (const clear of [false, true]) {
    const original = session(1), h = harness(original); h.render();
    h.storageEvent(clear ? null : AUTH, clear ? null : JSON.stringify(original), clear ? null : JSON.stringify(session(2)));
    h.f.exchanges[0].resolve(response(session(3))); await flush(); h.frame();
    assert.equal(h.owner().token, original.token); assert.equal(h.f.navigations[0].href, "/account"); h.dispose();
  }
});

test("same identity billing refresh preserves exchange and post-write handoff", async () => {
  const h = harness(session(1)); h.render();
  const previous = h.owner();
  h.transition({ ...h.owner(), user: { ...h.owner().user, workspaceAccess: false } });
  h.storageEvent(AUTH, JSON.stringify(previous), JSON.stringify(h.owner()));
  h.f.exchanges[0].resolve(response()); await flush();
  h.transition({ ...h.owner(), user: { ...h.owner().user, name: "Refreshed" } }); h.frame();
  assert.equal(h.f.navigations[0].href, "/app"); assert.equal(h.f.navigations.length, 1); h.dispose();
});

test("auth change after own session write cancels RAF handoff", async () => {
  const h = harness(); h.render(); h.f.exchanges[0].resolve(response()); await flush();
  assert.equal(h.frames.size, 1); h.transition(session(2)); h.frame();
  assert.equal(h.owner().token, "token-2"); assert.deepEqual(h.f.navigations, [{ href: "/account", replace: true }]); h.dispose();
});

test("reentrant session listener transition cannot be accepted as own write", async () => {
  const h = harness(); let changed = false;
  window.addEventListener("edgelab:auth-session-change", () => {
    if (!changed) { changed = true; h.transition(session(2)); }
  });
  h.render(); h.f.exchanges[0].resolve(response()); await flush(); h.frame();
  assert.equal(h.owner().token, "token-2"); assert.equal(h.f.navigations[0].href, "/account"); h.dispose();
});

test("expired exchange cannot store credentials; expired RAF cannot forward old share destination", async () => {
  const h = harness(); h.render(); now += 900_001;
  h.f.exchanges[0].resolve(response()); await flush(); h.frame();
  assert.equal(h.owner(), null); assert.match(h.f.navigations[0].href, /oauth-state-expired/); h.dispose();
  const second = harness(null, `/shared#${"S".repeat(43)}`); second.render();
  second.f.exchanges[0].resolve(response()); await flush(); now += 900_001; second.frame();
  assert.equal(second.owner().token, "token-1"); assert.deepEqual(second.f.navigations, [{ href: "/account", replace: true, state: undefined }]); second.dispose();
});

test("search replacement owns new state and suppresses previous exchange", async () => {
  const h = harness(); h.render(); h.seed("state-B", "/app/new");
  h.f.location.search = "?state=state-B&code=code-B"; h.render();
  h.f.exchanges[0].resolve(response(session(1))); await flush(); assert.equal(h.owner(), null);
  h.f.exchanges[1].resolve(response(session(2))); await flush(); h.frame();
  assert.equal(h.owner().token, "token-2"); assert.equal(h.f.navigations[0].href, "/app/new"); h.dispose();
});

test("provider error, access denial, production pricing, beta waitlist and billing context stay intact", async () => {
  const h = harness(null, "/app/replay"); h.f.location.search = "?error=access_denied&state=state-A"; h.render(); h.replay();
  assert.equal(h.f.exchanges.length, 0); assert.equal(h.f.navigations.length, 1);
  assert.match(h.f.navigations[0].href, /access_denied/); h.dispose();
  const denied = harness(null, "/app/replay"); denied.render();
  denied.f.exchanges[0].reject(new production.ApiError("Not approved", 403)); await flush();
  assert.match(denied.f.navigations[0].href, /reason=access-denied/);
  assert.deepEqual(denied.f.navigations[0].state, { fromPath: "/app/replay", pricingDestination: undefined }); denied.dispose();
  const share = harness(null, `/shared#${"S".repeat(43)}`); share.render();
  share.f.exchanges[0].resolve(response()); await flush(); share.frame();
  assert.equal(share.f.navigations[0].href, `/shared#${"S".repeat(43)}`); share.dispose();
  for (const [mode, access, destination, expected] of [
    ["production", false, "/app/replay", "/pricing?from=%2Fapp%2Freplay"],
    ["beta", false, "/app/replay", "waitlist=1"],
    ["beta", false, "/pricing", "/pricing"],
  ]) {
    const current = harness(null, destination, "/app/saved"); current.render();
    current.f.exchanges[0].resolve(response(session(1, "token-1", access, mode))); await flush(); current.frame();
    assert.ok(current.f.navigations[0].href.includes(expected));
    if (destination === "/pricing") assert.deepEqual(current.f.navigations[0].state, { fromPath: "/app/saved" });
    current.dispose();
  }
});

test("blocked storage and invalid exchange response retain an owned retry path", async () => {
  for (const malformed of [false, true]) {
    const h = harness(); h.render(); window.localStorage.failAuthWrite = !malformed;
    h.f.exchanges[0].resolve(malformed ? { session: null } : response()); await flush(); h.frame();
    assert.equal(h.owner(), null); assert.match(h.f.navigations[0].href, /beta-auth-error/); h.dispose();
  }
});
