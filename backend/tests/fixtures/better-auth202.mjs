// Real native service fixture. Only the upstream Google certificate transport is owned.
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { randomBytes } from "node:crypto";
import { createEdgeLabAuth } from "../../auth/auth.mjs";
import { createAuthServer } from "../../auth/server.mjs";
const originalFetch = globalThis.fetch;
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "cross-boundary", alg: "RS256", use: "sig" };
globalThis.fetch = (input, options) => {
  const url = typeof input === "string" ? input : input.url ?? input.href;
  return url === "https://www.googleapis.com/oauth2/v3/certs" ? Promise.resolve(Response.json({ keys: [jwk] })) : originalFetch(input, options);
};
const key = randomBytes(40).toString("hex");
const service = await createEdgeLabAuth({ BETTER_AUTH_URL: "https://edgelab.example", BETTER_AUTH_DATABASE_PATH: ":memory:",
  BETTER_AUTH_SECRET: randomBytes(40).toString("hex"), EDGELAB_AUTH_SERVICE_KEY: key,
  GOOGLE_CLIENT_ID: "cross-boundary-client", GOOGLE_CLIENT_SECRET: "cross-boundary-secret" });
const token = await new SignJWT({ sub: "stable_google_202", email: "owner202@gmail.com", email_verified: true, name: "Owner 202" })
  .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://accounts.google.com")
  .setAudience("cross-boundary-client").setIssuedAt().setExpirationTime("5m").sign(privateKey);
// Programmatic native sign-in is not the public HTTP route, which is redirect-only.
const signedIn = await service.auth.handler(new Request("https://edgelab.example/api/better-auth/sign-in/social", { method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://edgelab.example" }, body: JSON.stringify({ provider: "google", idToken: { token } }) }));
if (signedIn.status !== 200) throw new Error("Native fixture sign-in failed");
const cookie = signedIn.headers.getSetCookie().find(value => value.startsWith("__Secure-edgelab.session_token=")).split(";")[0];
const server = createAuthServer(service);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.stdout.write(JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, key, cookie }) + "\n");
process.on("SIGTERM", () => server.close(() => { service.database.close(); process.exit(0); }));
