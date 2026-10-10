import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";
import { verifyProviderIdToken } from "better-auth/oauth2";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

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
  const filename = env.BETTER_AUTH_DATABASE_PATH || "backend/data/better-auth.db";
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const google = googleCredentials(env);
  const googleEnabled = Boolean(google.clientId && google.clientSecret);
  const options = {
    appName: "EdgeLab", baseURL: baseURL.origin, basePath: "/api/better-auth", secret, database,
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
    await (await getMigrations(migrationAuth.options)).runMigrations();
    const auth = betterAuth(options);
    const context = await auth.$context;
    await context.checkSchema?.();
    return { auth, database, serviceKey, googleEnabled, baseURL: baseURL.origin };
  } catch (error) { database.close(); throw error; }
}
