import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createEdgeLabAuth } from "../auth/auth.mjs";
import { createAuthServer } from "../auth/server.mjs";

const config = () => ({ BETTER_AUTH_URL: "http://localhost:5173", BETTER_AUTH_DATABASE_PATH: ":memory:",
  BETTER_AUTH_SECRET: randomBytes(40).toString("hex"), EDGELAB_AUTH_SERVICE_KEY: randomBytes(40).toString("hex"),
  GOOGLE_CLIENT_ID: "owned-google-client", GOOGLE_CLIENT_SECRET: "owned-google-secret" });

test("native verified Google sign-in creates real signed cookies, persists and revokes the same session through the actual internal HTTP boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "edgelab-better-auth-"));
  const env = { ...config(), BETTER_AUTH_DATABASE_PATH: join(directory, "auth.db") };
  const originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "owned-provider-key", alg: "RS256", use: "sig" };
  const providerCalls = [];
  globalThis.fetch = async (input, options) => {
    const url = typeof input === "string" ? input : input.url ?? input.href;
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      providerCalls.push(url); return Response.json({ keys: [jwk] });
    }
    return originalFetch(input, options);
  };
  let service, server;
  try {
    service = await createEdgeLabAuth(env);
    const idToken = await new SignJWT({ sub: "owned_google_subject", email: "owner@gmail.com", email_verified: true, name: "Owned trader", hd: "owned.example" })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://accounts.google.com")
      .setAudience(env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const signIn = await service.auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/better-auth/sign-in/social`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: env.BETTER_AUTH_URL },
      body: JSON.stringify({ provider: "google", idToken: { token: idToken }, googleHostedDomain: "attacker.example", additionalData: { googleHostedDomain: "attacker.example" } }),
    }));
    assert.equal(signIn.status, 200, await signIn.clone().text());
    assert.equal(providerCalls.length, 2); // Native ID-token admission and mapped-profile verification.
    const signedToken = signIn.headers.get("set-auth-token");
    const cookies = signIn.headers.getSetCookie();
    const cookie = cookies.find(value => value.startsWith("edgelab.session_token=")).split(";")[0];
    assert.ok(signedToken?.includes("."));
    const rawToken = (await signIn.json()).token;
    assert.equal(typeof rawToken, "string");
    assert.notEqual(rawToken, signedToken);

    server = createAuthServer(service);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    let base = `http://127.0.0.1:${server.address().port}`;
    const call = (headers, path = "session") => originalFetch(`${base}/internal/${path}`, { method: "POST", headers: {
      "X-EdgeLab-Auth-Service-Key": env.EDGELAB_AUTH_SERVICE_KEY, ...headers,
    } });
    const bridged = await call({ Cookie: cookie });
    assert.equal(bridged.status, 200);
    const identity = await bridged.json();
    assert.equal(identity.sub, "owned_google_subject");
    assert.equal(identity.email_verified, true);
    assert.equal(identity.hd, "owned.example");
    assert.equal(identity.token, cookie.slice(cookie.indexOf("=") + 1));
    assert.equal((await call({ Authorization: `Bearer ${identity.token}` })).status, 200);
    assert.equal((await call({ Authorization: `Bearer ${rawToken}` })).status, 401);
    assert.equal((await call({ Authorization: `Bearer ${identity.token}bad` })).status, 401);
    assert.equal((await call({ Cookie: `${cookie}; ${cookie}` })).status, 401);
    assert.equal((await call({ Cookie: cookie, Authorization: `Bearer ${identity.token}` })).status, 401);
    assert.equal((await originalFetch(`${base}/internal/session`, { method: "POST", headers: { Cookie: cookie } })).status, 401);
    assert.equal((await originalFetch(`${base}/api/better-auth/update-user`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: env.BETTER_AUTH_URL }, body: JSON.stringify({ googleHostedDomain: "attacker.example" }) })).status, 404);
    assert.equal((await originalFetch(`${base}/api/better-auth/sign-in/social`, { method: "POST", headers: { "Content-Type": "application/json", Origin: env.BETTER_AUTH_URL }, body: JSON.stringify({ provider: "google", idToken: { token: idToken } }) })).status, 400);
    await new Promise(resolve => server.close(resolve)); server = undefined;
    service.database.close(); service = undefined;

    service = await createEdgeLabAuth(env);
    server = createAuthServer(service);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const restored = await call({ Authorization: `Bearer ${identity.token}` });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).session_id, identity.session_id);
    const signedOut = await call({ Authorization: `Bearer ${identity.token}` }, "sign-out");
    assert.equal(signedOut.status, 200);
    assert.deepEqual(await signedOut.json(), { ok: true });
    assert.equal((await call({ Cookie: cookie })).status, 401);
    assert.equal((await call({ Authorization: `Bearer ${identity.token}` })).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    service?.database.close(); globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing Google credentials are honestly unavailable and production requires safe explicit origins and secrets", async () => {
  const env = config(); delete env.GOOGLE_CLIENT_ID; delete env.GOOGLE_CLIENT_SECRET;
  const service = await createEdgeLabAuth(env);
  try {
    assert.equal(service.googleEnabled, false);
    const response = await service.auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/better-auth/sign-in/social`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: env.BETTER_AUTH_URL }, body: JSON.stringify({ provider: "google" }),
    }));
    assert.equal(response.ok, false);
  } finally { service.database.close(); }
  await assert.rejects(createEdgeLabAuth({ ...config(), NODE_ENV: "production" }), /HTTPS/);
  await assert.rejects(createEdgeLabAuth({ ...config(), BETTER_AUTH_SECRET: "short" }), /secrets/);
  await assert.rejects(createEdgeLabAuth({ ...config(), BETTER_AUTH_URL: "https://example.test/extra" }), /exact public origin/);
});

test("real Google redirect flow binds state and PKCE, consumes state once and rejects external callback URLs", async () => {
  const env = config(), originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "redirect-key", alg: "RS256", use: "sig" };
  let authorization, tokenCalls = 0, service, server, origin, invalidClaim;
  globalThis.fetch = async (input, options) => {
    const request = new Request(input, options);
    if (request.url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    if (request.url === "https://oauth2.googleapis.com/token") {
      tokenCalls += 1;
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("code"), "owned-code");
      assert.equal(body.get("redirect_uri"), `${env.BETTER_AUTH_URL}/api/better-auth/callback/google`);
      assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
      const token = await new SignJWT({ sub: "redirect_subject", email: "redirect@gmail.com", email_verified: true, name: "Redirect trader", hd: "provider.example",
        nonce: invalidClaim === "nonce" ? "wrong-attempt-nonce" : authorization.searchParams.get("nonce") })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer(invalidClaim === "issuer" ? "https://attacker.example" : "https://accounts.google.com")
        .setAudience(invalidClaim === "audience" ? "different-client" : env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return Response.json({ access_token: "owned-provider-token", token_type: "Bearer", expires_in: 300, id_token: token });
    }
    return originalFetch(input, options);
  };
  const launch = async () => {
    service = await createEdgeLabAuth(env);
    server = createAuthServer(service);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    server = undefined;
    service?.database.close(); service = undefined;
  };
  try {
    await launch();
    const begin = (callbackURL, errorCallbackURL = callbackURL) => originalFetch(`${origin}/api/better-auth/sign-in/social`, { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", Origin: env.BETTER_AUTH_URL },
      body: JSON.stringify({ provider: "google", callbackURL, errorCallbackURL, disableRedirect: true, additionalData: { googleHostedDomain: "attacker.example" } }) });
    const callbackURL = `${env.BETTER_AUTH_URL}/auth/callback/google?better_auth=1&state=owned-local-state`;
    assert.equal((await begin("https://attacker.example/callback")).status, 403);
    assert.equal((await begin(callbackURL, "https://attacker.example/error")).status, 403);
    const started = await begin(callbackURL);
    assert.equal(started.status, 200);
    authorization = new URL((await started.json()).url);
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorization.searchParams.get("nonce")?.length >= 16);
    const cookie = started.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const callback = state => originalFetch(`${origin}/api/better-auth/callback/google?code=owned-code&state=${state}`, { headers: { Cookie: cookie }, redirect: "manual" });
    const missing = await originalFetch(`${origin}/api/better-auth/callback/google?code=owned-code`, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(missing.status, 302);
    assert.equal(new URL(missing.headers.get("location")).pathname, "/auth/signin");
    assert.equal(new URL(missing.headers.get("location")).searchParams.get("error"), "state_not_found");
    assert.equal(missing.headers.getSetCookie().some(value => value.startsWith("edgelab.session_token=")), false);
    const wrong = await callback("unowned-state");
    assert.equal(wrong.status, 302); assert.match(wrong.headers.get("location"), /error=/); assert.equal(tokenCalls, 0);
    assert.equal(new URL(wrong.headers.get("location")).pathname, "/auth/signin");
    assert.equal(service.database.prepare('SELECT COUNT(*) AS n FROM session').get().n, 0);
    const completed = await callback(authorization.searchParams.get("state"));
    assert.equal(completed.status, 302); assert.equal(completed.headers.get("location"), callbackURL);
    assert.equal(tokenCalls, 1);
    const sessionCookie = completed.headers.getSetCookie().find(value => value.startsWith("edgelab.session_token=")).split(";")[0];
    const actual = await service.auth.api.getSession({ headers: new Headers({ Cookie: sessionCookie }) });
    assert.equal(actual.user.googleHostedDomain, "provider.example");
    const replay = await callback(authorization.searchParams.get("state"));
    assert.match(replay.headers.get("location"), /error=/); assert.equal(tokenCalls, 1);
    for (const claim of ["access_denied", "nonce", "issuer", "audience"]) {
      await stop(); await launch(); // Independent attempts retain native per-path admission.
      invalidClaim = claim;
      const start = await begin(callbackURL);
      assert.equal(start.status, 200, await start.clone().text());
      authorization = new URL((await start.json()).url);
      const callsBefore = tokenCalls;
      const query = new URLSearchParams({ state: authorization.searchParams.get("state"), ...(claim === "access_denied" ? { error: "access_denied" } : { code: "owned-code" }) });
      const rejected = await originalFetch(`${origin}/api/better-auth/callback/google?${query}`, {
        headers: { Cookie: start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") }, redirect: "manual" });
      assert.equal(rejected.status, 302);
      const retry = new URL(rejected.headers.get("location"));
      assert.equal(retry.origin, env.BETTER_AUTH_URL); assert.equal(retry.pathname, "/auth/callback/google");
      assert.equal(retry.searchParams.get("better_auth"), "1"); assert.equal(retry.searchParams.get("state"), "owned-local-state");
      assert.equal(retry.searchParams.get("error"), claim === "access_denied" ? "access_denied" : "unable_to_get_user_info");
      assert.equal(tokenCalls, callsBefore + (claim === "access_denied" ? 0 : 1));
      assert.equal(rejected.headers.getSetCookie().some(value => value.startsWith("edgelab.session_token=")), false);
      assert.equal(service.database.prepare('SELECT COUNT(*) AS n FROM session').get().n, 0);
      assert.equal(await service.auth.api.getSession({ headers: new Headers({ Cookie: start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") }) }), null);
    }
  } finally { await stop(); globalThis.fetch = originalFetch; }
});

test("operator Google credential files match existing deployment format and environment precedence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "edgelab-google-config-"));
  let service;
  try {
    const filename = join(directory, "google.json");
    writeFileSync(filename, JSON.stringify({ web: { client_id: "file-client", client_secret: "file-secret" } }));
    const env = { ...config(), GOOGLE_CLIENT_ID: "env-client", GOOGLE_CLIENT_SECRET: "", GOOGLE_CLIENT_SECRETS_FILE: filename };
    service = await createEdgeLabAuth(env);
    assert.equal(service.googleEnabled, true);
    const provider = (await service.auth.$context).socialProviders.find(value => value.id === "google");
    assert.equal(provider.options.clientId, "env-client"); assert.equal(provider.options.clientSecret, "file-secret");
    await service.auth.$context;
  } finally { service?.database.close(); rmSync(directory, { recursive: true, force: true }); }
});
