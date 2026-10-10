import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { verifyProviderIdToken } from "better-auth/oauth2";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

function boundedInteger(value, fallback, maximum, name) {
  const number = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error(`${name} is out of range.`);
  return number;
}

async function openDatabase(env) {
  if (!env.BETTER_AUTH_DATABASE_URL) {
    const filename = env.BETTER_AUTH_DATABASE_PATH || "backend/data/better-auth.db";
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    const database = new DatabaseSync(filename);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    return { database, authDatabase: database, close: () => database.close(),
      checkDatabase: () => database.prepare('SELECT 1 FROM session LIMIT 0').all(),
      migrate: async options => { await (await getMigrations(options)).runMigrations(); } };
  }
  let url;
  try { url = new URL(env.BETTER_AUTH_DATABASE_URL); } catch { throw new Error("BETTER_AUTH_DATABASE_URL must be a PostgreSQL writer URL."); }
  const tlsParameters = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl", "sslnegotiation"]);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.hash ||
      [...url.searchParams.keys()].some(key => !tlsParameters.has(key)) ||
      (url.searchParams.has("sslmode") && !["disable", "verify-full"].includes(url.searchParams.get("sslmode")))) {
    throw new Error("BETTER_AUTH_DATABASE_URL must be a PostgreSQL writer URL with verified TLS when enabled and no connection overrides.");
  }
  const schemaName = env.BETTER_AUTH_DATABASE_SCHEMA || "edgelab_auth";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schemaName) || ["public", "information_schema"].includes(schemaName) || schemaName.startsWith("pg_")) {
    throw new Error("BETTER_AUTH_DATABASE_SCHEMA must be a dedicated PostgreSQL schema.");
  }
  const max = boundedInteger(env.BETTER_AUTH_DATABASE_POOL_MAX, 5, 100, "BETTER_AUTH_DATABASE_POOL_MAX");
  const timeout = boundedInteger(env.BETTER_AUTH_DATABASE_TIMEOUT_MS, 10000, 120000, "BETTER_AUTH_DATABASE_TIMEOUT_MS");
  const migrationTimeout = boundedInteger(env.BETTER_AUTH_DATABASE_MIGRATION_TIMEOUT_MS, 60000, 600000, "BETTER_AUTH_DATABASE_MIGRATION_TIMEOUT_MS");
  const [{ Pool, Client }, { PostgresDialect }] = await Promise.all([import("pg"), import("kysely")]);
  const connection = { connectionString: env.BETTER_AUTH_DATABASE_URL, connectionTimeoutMillis: 2000,
    statement_timeout: timeout, query_timeout: timeout + 1000, idle_in_transaction_session_timeout: timeout + 2000,
    application_name: "edgelab-auth" };
  const database = new Pool({ ...connection, max, idleTimeoutMillis: 30000 });
  database.on("error", () => console.error("Authentication database connection unavailable"));
  let closing;
  const close = () => closing ||= database.end();
  const authDatabase = { dialect: new PostgresDialect({ pool: database }), type: "postgres", schemaName, transaction: true };
  return { database, authDatabase, close,
    checkDatabase: () => database.query({ text: `SELECT 1 FROM "${schemaName}"."session" LIMIT 0`, query_timeout: 1000 }),
    async migrate(options) {
      // Use the direct writer endpoint. One connection owns both the lock and
      // every migration statement, releasing the transaction lock on all exits.
      const client = new Client({ ...connection, statement_timeout: migrationTimeout, query_timeout: migrationTimeout + 1000,
        lock_timeout: migrationTimeout, idle_in_transaction_session_timeout: migrationTimeout + 2000 });
      client.on("error", () => console.error("Authentication database migration connection unavailable"));
      const key = createHash("sha256").update(`edgelab:better-auth:migrate:${schemaName}`).digest().readBigInt64BE().toString();
      try {
        await client.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [key]);
        const pinnedPool = { connect: async () => ({ query: client.query.bind(client), release() {} }), end: async () => {} };
        const migrationDatabase = { dialect: new PostgresDialect({ pool: pinnedPool }), type: "postgres", schemaName, transaction: false };
        await (await getMigrations({ ...options, database: migrationDatabase })).runMigrations();
        await client.query("COMMIT");
      } finally { await client.end(); }
    },
  };
}

function googleCredentials(env) {
  let file = {};
  if (env.GOOGLE_CLIENT_SECRETS_FILE) {
    try {
      const contents = readFileSync(env.GOOGLE_CLIENT_SECRETS_FILE);
      if (contents.length <= 65536) {
        const parsed = JSON.parse(contents.toString("utf8"));
        file = parsed.web || parsed.installed || parsed;
      }
    } catch { /* An absent/unreadable operator file leaves Google unavailable. */ }
  }
  const clientId = env.GOOGLE_CLIENT_ID || file?.client_id;
  const clientSecret = env.GOOGLE_CLIENT_SECRET || file?.client_secret;
  return { clientId: typeof clientId === "string" ? clientId : "", clientSecret: typeof clientSecret === "string" ? clientSecret : "" };
}

// Keep native OAuth state/PKCE/session handling, and bind Google's verified ID
// token to the nonce generated and persisted by that same native attempt.
function verifiedGoogleRedirect() {
  return { id: "edgelab-verified-google-redirect", init(context) {
    return { context: { socialProviders: context.socialProviders.map(provider => {
      if (provider.id !== "google") return provider;
      const verified = { ...provider, idToken: { ...provider.idToken, algorithms: ["RS256"] } };
      return { ...verified, requiresIdTokenNonce: true,
        async createAuthorizationURL(input) {
          if (typeof input.idTokenNonce !== "string" || input.idTokenNonce.length < 16) throw new Error("Google sign-in nonce required");
          const url = await provider.createAuthorizationURL(input);
          // Native Google excludes reserved additionalParams, including nonce.
          // Only the server-generated attempt nonce is appended to its URL.
          url.searchParams.set("nonce", input.idTokenNonce);
          return url;
        },
        async getUserInfo(tokens) {
          if (typeof tokens.idToken !== "string" || !await verifyProviderIdToken(verified, tokens.idToken, tokens.expectedIdTokenNonce)) return null;
          return provider.getUserInfo(tokens);
        },
      };
    }) } };
  } };
}

export async function createEdgeLabAuth(env = process.env) {
  const baseURL = new URL(env.BETTER_AUTH_URL || "http://localhost:5173");
  const production = env.NODE_ENV === "production";
  if (baseURL.username || baseURL.password || baseURL.search || baseURL.hash || baseURL.pathname !== "/" ||
      !["http:", "https:"].includes(baseURL.protocol) || (production && baseURL.protocol !== "https:")) {
    throw new Error("BETTER_AUTH_URL must be the exact public origin (HTTPS in production).");
  }
  const secret = env.BETTER_AUTH_SECRET || "";
  const serviceKey = env.EDGELAB_AUTH_SERVICE_KEY || "";
  if (secret.length < 32 || serviceKey.length < 32 || secret === serviceKey) throw new Error("Distinct authentication secrets of at least 32 characters are required.");
  const store = await openDatabase(env);
  const google = googleCredentials(env);
  const googleEnabled = Boolean(google.clientId && google.clientSecret);
  const options = {
    appName: "EdgeLab", baseURL: baseURL.origin, basePath: "/api/better-auth", secret, database: store.authDatabase,
    ...(env.BETTER_AUTH_DATABASE_URL ? { logger: { level: "warn", log: level => {
      if (level === "error") console.error("Authentication provider operation unavailable");
      else console.warn("Authentication provider configuration requires attention");
    } } } : {}),
    trustedOrigins: [baseURL.origin],
    onAPIError: { errorURL: `${baseURL.origin}/auth/signin` },
    advanced: { cookiePrefix: "edgelab", useSecureCookies: baseURL.protocol === "https:" },
    session: { cookieCache: { enabled: false }, disableSessionRefresh: true, expiresIn: 7 * 24 * 60 * 60 },
    account: { accountLinking: { enabled: false } },
    // Provider mapping needs input-enabled additional fields in Better Auth.
    // The HTTP server therefore does not expose update-user/link-account routes.
    user: { additionalFields: { googleHostedDomain: { type: "string", required: false } } },
    socialProviders: googleEnabled ? { google: {
      clientId: google.clientId, clientSecret: google.clientSecret,
      prompt: "select_account", overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile) => ({ googleHostedDomain: typeof profile.hd === "string" ? profile.hd : null }),
    } } : {},
    plugins: [verifiedGoogleRedirect(), bearer({ requireSignature: true })],
    rateLimit: { enabled: true, window: 60, max: 30, storage: "database" },
  };
  try {
    const migrationAuth = betterAuth({ ...options, advanced: { ...options.advanced, database: { validateSchema: false } } });
    await store.migrate(migrationAuth.options);
    const auth = betterAuth(options);
    const context = await auth.$context;
    await context.checkSchema?.();
    return { auth, database: store.database, close: store.close, checkDatabase: store.checkDatabase,
      serviceKey, googleEnabled, baseURL: baseURL.origin };
  } catch (error) {
    await store.close();
    if (env.BETTER_AUTH_DATABASE_URL) throw new Error("Authentication database initialization unavailable.");
    throw error;
  }
}
