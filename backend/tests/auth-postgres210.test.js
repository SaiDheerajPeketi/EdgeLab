import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createEdgeLabAuth } from "../auth/auth.mjs";
import { createAuthServer } from "../auth/server.mjs";

const databaseURL = process.env.EDGELAB_TEST_AUTH_POSTGRES_URL;
const postgres = { skip: !databaseURL && "Set EDGELAB_TEST_AUTH_POSTGRES_URL to a direct PostgreSQL test writer", timeout: 30000 };
const config = () => ({ BETTER_AUTH_URL: "http://localhost:5173", BETTER_AUTH_DATABASE_PATH: ":memory:",
  BETTER_AUTH_DATABASE_URL: databaseURL, BETTER_AUTH_DATABASE_SCHEMA: `auth210_${randomUUID().replaceAll("-", "")}`,
  BETTER_AUTH_DATABASE_POOL_MAX: "3", BETTER_AUTH_SECRET: randomBytes(40).toString("hex"),
  EDGELAB_AUTH_SERVICE_KEY: randomBytes(40).toString("hex"), GOOGLE_CLIENT_ID: "replica-client", GOOGLE_CLIENT_SECRET: "replica-secret" });

async function fixture() {
  const { Client } = await import("pg");
  const env = config();
  const admin = new Client({ connectionString: databaseURL, connectionTimeoutMillis: 2000, statement_timeout: 5000, query_timeout: 6000 });
  await admin.connect();
  return { env, admin, async close() {
    try { await admin.query("ROLLBACK"); await admin.query(`DROP SCHEMA IF EXISTS "${env.BETTER_AUTH_DATABASE_SCHEMA}" CASCADE`); }
    finally { await admin.end(); }
  } };
}

async function serve(service) {
  const server = createAuthServer(service);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

function migrationKey(schema) {
  return createHash("sha256").update(`edgelab:better-auth:migrate:${schema}`).digest().readBigInt64BE();
}

async function waitForMigrationWaiters(admin, key, count) {
  const unsigned = BigInt.asUintN(64, key);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await admin.query("SELECT COUNT(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid AND NOT granted",
      [(unsigned >> 32n).toString(), (unsigned & 0xffffffffn).toString()]);
    if (rows[0].n === count) return;
    await delay(20);
  }
  assert.fail(`Expected ${count} waiting auth migrations`);
}

test("PostgreSQL configuration rejects shared system schemas, unsafe TLS and unbounded pools without exposing URLs", async () => {
  for (const overrides of [
    { BETTER_AUTH_DATABASE_URL: "not-a-url-private-password" },
    { BETTER_AUTH_DATABASE_URL: "postgres://fixture:private-password@localhost/test?options=-csearch_path%3Dpublic" },
    { BETTER_AUTH_DATABASE_URL: "postgres://fixture:private-password@localhost/test?sslmode=no-verify" },
    { BETTER_AUTH_DATABASE_URL: "postgres://fixture:private-password@localhost/test?sslmode=require&uselibpqcompat=true" },
    { BETTER_AUTH_DATABASE_URL: "postgres://fixture:private-password@localhost/test?statement_timeout=0" },
    { BETTER_AUTH_DATABASE_SCHEMA: "public" }, { BETTER_AUTH_DATABASE_SCHEMA: "pg_catalog" },
    { BETTER_AUTH_DATABASE_SCHEMA: "bad\"schema" }, { BETTER_AUTH_DATABASE_POOL_MAX: "0" },
    { BETTER_AUTH_DATABASE_POOL_MAX: "101" }, { BETTER_AUTH_DATABASE_TIMEOUT_MS: "Infinity" },
  ]) {
    const env = { ...config(), BETTER_AUTH_DATABASE_URL: "postgres://fixture:private-password@localhost/test", ...overrides };
    await assert.rejects(createEdgeLabAuth(env), error => {
      assert.equal(error.message.includes("private-password"), false);
      return /PostgreSQL|out of range/.test(error.message);
    });
  }
});

test("two cold replicas wait on one migration lock and create only the dedicated auth schema", postgres, async () => {
  const owned = await fixture();
  let launched, services = [];
  try {
    const key = migrationKey(owned.env.BETTER_AUTH_DATABASE_SCHEMA);
    await owned.admin.query("BEGIN");
    await owned.admin.query("SELECT pg_advisory_xact_lock($1::bigint)", [key.toString()]);
    launched = Promise.allSettled([createEdgeLabAuth(owned.env), createEdgeLabAuth(owned.env)]);
    await waitForMigrationWaiters(owned.admin, key, 2);
    assert.equal((await owned.admin.query("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1", [owned.env.BETTER_AUTH_DATABASE_SCHEMA])).rows[0].n, 0);
    await owned.admin.query("COMMIT");
    const results = await launched;
    services = results.filter(result => result.status === "fulfilled").map(result => result.value);
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "fulfilled"]);
    for (const service of services) {
      await service.checkDatabase();
      assert.equal(service.database.options.max, 3);
    }
    const tables = (await owned.admin.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [owned.env.BETTER_AUTH_DATABASE_SCHEMA])).rows.map(row => row.table_name);
    for (const table of ["user", "account", "session", "verification", "rateLimit"]) assert.ok(tables.includes(table));
  } finally {
    await owned.admin.query("ROLLBACK");
    if (launched) services = (await launched).filter(result => result.status === "fulfilled").map(result => result.value);
    await Promise.all(services.map(service => service.close()));
    await owned.close();
  }
});

test("Google redirect, signed identity and revocation cross real PostgreSQL replicas", postgres, async () => {
  const owned = await fixture();
  const originalFetch = globalThis.fetch;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "auth210-replica-key", alg: "RS256", use: "sig" };
  let authorization, services = [], servers = [];
  globalThis.fetch = async (input, options) => {
    const request = new Request(input, options);
    if (request.url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    if (request.url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("redirect_uri"), `${owned.env.BETTER_AUTH_URL}/api/better-auth/callback/google`);
      assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
      const idToken = await new SignJWT({ sub: "replica_google_subject", email: "replica@gmail.com", email_verified: true,
        name: "Replica trader", hd: "provider.example", nonce: authorization.searchParams.get("nonce") })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://accounts.google.com")
        .setAudience(owned.env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime("5m").sign(privateKey);
      return Response.json({ access_token: "replica-provider-token", token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    return originalFetch(input, options);
  };
  try {
    services.push(await createEdgeLabAuth(owned.env));
    services.push(await createEdgeLabAuth(owned.env));
    servers = await Promise.all(services.map(serve));
    const callbackURL = `${owned.env.BETTER_AUTH_URL}/auth/callback/google?better_auth=1`;
    const start = await originalFetch(`${servers[0].origin}/api/better-auth/sign-in/social`, { method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", Origin: owned.env.BETTER_AUTH_URL },
      body: JSON.stringify({ provider: "google", callbackURL, disableRedirect: true, additionalData: { googleHostedDomain: "attacker.example" } }) });
    assert.equal(start.status, 200, await start.clone().text());
    authorization = new URL((await start.json()).url);
    const completed = await originalFetch(`${servers[1].origin}/api/better-auth/callback/google?code=replica-code&state=${authorization.searchParams.get("state")}`, {
      headers: { Cookie: start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") }, redirect: "manual" });
    assert.equal(completed.status, 302);
    assert.equal(completed.headers.get("location"), callbackURL);
    const cookie = completed.headers.getSetCookie().find(value => value.startsWith("edgelab.session_token=")).split(";")[0];
    const call = (index, headers, path = "session") => originalFetch(`${servers[index].origin}/internal/${path}`, { method: "POST",
      headers: { "X-EdgeLab-Auth-Service-Key": owned.env.EDGELAB_AUTH_SERVICE_KEY, ...headers } });
    const identityResponse = await call(0, { Cookie: cookie });
    assert.equal(identityResponse.status, 200);
    const identity = await identityResponse.json();
    assert.equal(identity.sub, "replica_google_subject");
    assert.equal(identity.hd, "provider.example");
    assert.equal(identity.email_verified, true);
    assert.ok(identity.token.includes("."));
    const shared = await call(1, { Authorization: `Bearer ${identity.token}` });
    assert.equal(shared.status, 200);
    assert.equal((await shared.json()).session_id, identity.session_id);
    assert.equal((await call(1, { Authorization: `Bearer ${identity.token}tampered` })).status, 401);
    assert.equal((await originalFetch(`${servers[1].origin}/internal/session`, { method: "POST", headers: { Cookie: cookie } })).status, 401);
    assert.equal((await call(0, { Authorization: `Bearer ${identity.token}` }, "sign-out")).status, 200);
    assert.equal((await call(1, { Cookie: cookie })).status, 401);
    assert.equal((await call(1, { Authorization: `Bearer ${identity.token}` })).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all(servers.map(server => server.close()));
    await Promise.all(services.map(service => service.close()));
    await owned.close();
  }
});

test("database readiness times out safely on a locked auth table and recovers", postgres, async () => {
  const owned = await fixture();
  let service, server;
  try {
    service = await createEdgeLabAuth(owned.env);
    server = await serve(service);
    assert.equal((await fetch(`${server.origin}/health`)).status, 200);
    await owned.admin.query("BEGIN");
    await owned.admin.query(`LOCK TABLE "${owned.env.BETTER_AUTH_DATABASE_SCHEMA}"."session" IN ACCESS EXCLUSIVE MODE`);
    const started = performance.now();
    const unavailable = await fetch(`${server.origin}/health`);
    assert.equal(unavailable.status, 503);
    assert.ok(performance.now() - started < 4000);
    assert.deepEqual(await unavailable.json(), { ready: false, provider: "better-auth" });
    assert.equal(unavailable.headers.get("retry-after"), "1");
    assert.equal(unavailable.headers.get("cache-control"), "no-store");
    await owned.admin.query("ROLLBACK");
    assert.equal((await fetch(`${server.origin}/health`)).status, 200);
    await service.close();
    assert.equal((await fetch(`${server.origin}/health`)).status, 503);
  } finally {
    await owned.admin.query("ROLLBACK");
    await server?.close();
    await service?.close();
    await owned.close();
  }
});

test("failed internal and public sign-out never claim revocation while PostgreSQL DELETE is blocked", postgres, async () => {
  const owned = await fixture();
  let services = [], servers = [];
  try {
    const env = { ...owned.env, BETTER_AUTH_DATABASE_TIMEOUT_MS: "100" };
    services.push(await createEdgeLabAuth(env));
    services.push(await createEdgeLabAuth(env));
    servers = await Promise.all(services.map(serve));
    const context = await services[0].auth.$context;
    const user = await context.internalAdapter.createUser({ name: "Revocation trader", email: "revocation@gmail.com", emailVerified: true });
    await context.internalAdapter.createAccount({ userId: user.id, providerId: "google", accountId: "revocation_subject" });
    for (const path of ["/internal/sign-out", "/api/better-auth/sign-out"]) {
      const session = await context.internalAdapter.createSession(user.id);
      const signedToken = encodeURIComponent(`${session.token}.${createHmac("sha256", env.BETTER_AUTH_SECRET).update(session.token).digest("base64")}`);
      const cookie = `${context.authCookies.sessionToken.name}=${signedToken}`;
      const headers = { Cookie: cookie, Origin: env.BETTER_AUTH_URL, "X-EdgeLab-Auth-Service-Key": env.EDGELAB_AUTH_SERVICE_KEY };
      const identity = () => fetch(`${servers[1].origin}/internal/session`, { method: "POST", headers });
      assert.equal((await identity()).status, 200);
      if (path.startsWith("/api/")) {
        const rejected = await fetch(`${servers[0].origin}${path}`, { method: "POST", headers: { ...headers, Origin: "https://attacker.example" } });
        assert.equal(rejected.status, 403);
        assert.equal((await identity()).status, 200);
      }
      await owned.admin.query("BEGIN");
      await owned.admin.query(`LOCK TABLE "${env.BETTER_AUTH_DATABASE_SCHEMA}"."session" IN SHARE MODE`);
      // The actual adapter propagates DELETE errors; only native signOut hides them.
      await assert.rejects(context.internalAdapter.deleteSession(session.token));
      const failed = await fetch(`${servers[0].origin}${path}`, { method: "POST", headers });
      assert.equal(failed.status, 503);
      assert.equal(failed.headers.get("retry-after"), "1");
      assert.equal(failed.headers.get("cache-control"), "no-store");
      assert.equal(failed.headers.getSetCookie().length, 0);
      assert.deepEqual(await failed.json(), { detail: "Sign-in is temporarily unavailable" });
      assert.equal((await identity()).status, 200);
      await owned.admin.query("ROLLBACK");
      const retried = await fetch(`${servers[0].origin}${path}`, { method: "POST", headers });
      assert.equal(retried.status, 200);
      if (path.startsWith("/api/")) assert.ok(retried.headers.getSetCookie().some(value => value.startsWith(`${context.authCookies.sessionToken.name}=`)));
      assert.equal((await identity()).status, 401);
      assert.equal(await context.internalAdapter.findSession(session.token), null);
    }
  } finally {
    await owned.admin.query("ROLLBACK");
    await Promise.all(servers.map(server => server.close()));
    await Promise.all(services.map(service => service.close()));
    await owned.close();
  }
});

test("migration timeout releases its connection and advisory lock before a retry", postgres, async () => {
  const owned = await fixture();
  let service;
  try {
    const key = migrationKey(owned.env.BETTER_AUTH_DATABASE_SCHEMA);
    await owned.admin.query("BEGIN");
    await owned.admin.query("SELECT pg_advisory_xact_lock($1::bigint)", [key.toString()]);
    await assert.rejects(createEdgeLabAuth({ ...owned.env, BETTER_AUTH_DATABASE_MIGRATION_TIMEOUT_MS: "50" }),
      error => error.message === "Authentication database initialization unavailable.");
    await owned.admin.query("COMMIT");
    service = await createEdgeLabAuth(owned.env);
    await service.checkDatabase();
  } finally {
    await owned.admin.query("ROLLBACK");
    await service?.close();
    await owned.close();
  }
});
