import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { toNodeHandler } from "better-auth/node";
import { createEdgeLabAuth } from "./auth.mjs";

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}

async function revokeSession(context, token) {
  await context.internalAdapter.deleteSession(token);
  if (await context.internalAdapter.findSession(token)) throw new Error("Session revocation unavailable");
}

export function createAuthServer(service) {
  const nativeHandler = toNodeHandler(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/better-auth/sign-in/social") {
      const reader = request.clone().body?.getReader();
      let size = 0, contents = "";
      const decoder = new TextDecoder();
      if (!reader) return Response.json({ detail: "Google redirect sign-in required" }, { status: 400 });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) { void reader.cancel(); return Response.json({ detail: "Sign-in request too large" }, { status: 413 }); }
          contents += decoder.decode(value, { stream: true });
        }
        contents += decoder.decode();
        const body = JSON.parse(contents);
        if (body.provider !== "google" || body.idToken !== undefined) return Response.json({ detail: "Google redirect sign-in required" }, { status: 400 });
      } catch { return Response.json({ detail: "Invalid sign-in request" }, { status: 400 }); }
    }
    const signOutSession = path === "/api/better-auth/sign-out" ? await service.auth.api.getSession({ headers: request.headers }) : null;
    const result = await service.auth.handler(request);
    if (result.status >= 500) return Response.json({ detail: "Sign-in is temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } });
    // Native origin/CSRF checks run before any custom deletion. Better Auth's
    // sign-out catches database delete failures, so confirm revocation before
    // forwarding its success or expired cookies to the browser.
    if (result.ok && signOutSession) await revokeSession(await service.auth.$context, signOutSession.session.token);
    return result;
  });
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url, service.baseURL).pathname;
      if (service.draining) { json(response, 503, { ready: false, detail: "Sign-in is temporarily unavailable" }, { "Retry-After": "1" }); return; }
      if (path === "/health" && request.method === "GET") {
        try { await service.checkDatabase(); }
        catch { json(response, 503, { ready: false, provider: "better-auth" }, { "Retry-After": "1" }); return; }
        json(response, 200, { ready: true, provider: "better-auth", google_enabled: service.googleEnabled }); return;
      }
      if (path.startsWith("/internal/")) {
        const given = Buffer.from(request.headers["x-edgelab-auth-service-key"] || "");
        const expected = Buffer.from(service.serviceKey);
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) { json(response, 401, { detail: "Authentication required" }); return; }
        if (!["/internal/session", "/internal/sign-out"].includes(path) || request.method !== "POST") { json(response, 404, { detail: "Not found" }); return; }
        const context = await service.auth.$context;
        const cookieName = context.authCookies.sessionToken.name;
        const cookies = (request.headers.cookie || "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
        const authorization = request.headers.authorization || "";
        if (cookies.length > 1 || (cookies.length && authorization)) { json(response, 401, { detail: "Ambiguous session" }); return; }
        const headers = new Headers();
        if (authorization) headers.set("Authorization", authorization);
        else if (cookies.length === 1) headers.set("Cookie", cookies[0]);
        const session = await service.auth.api.getSession({ headers });
        if (!session) { json(response, 401, { detail: "Session expired or revoked" }); return; }
        const accounts = await context.internalAdapter.findAccounts(session.user.id);
        const google = accounts.filter(account => account.providerId === "google");
        if (google.length !== 1 || !/^[A-Za-z0-9_-]{1,255}$/.test(google[0].accountId) || session.user.emailVerified !== true) {
          json(response, 403, { detail: "Verified Google identity required" }); return;
        }
        const signedToken = authorization ? authorization.replace(/^Bearer /i, "") : cookies[0].slice(cookieName.length + 1);
        if (!signedToken || signedToken.length > 4096 || !signedToken.includes(".")) { json(response, 401, { detail: "Signed session required" }); return; }
        if (path === "/internal/sign-out") {
          await revokeSession(context, session.session.token); json(response, 200, { ok: true }); return;
        }
        json(response, 200, {
          token: signedToken, session_id: session.session.id,
          created_at: session.session.createdAt, expires_at: session.session.expiresAt,
          sub: google[0].accountId, email: session.user.email,
          name: session.user.name?.trim().slice(0, 160) || session.user.email.split("@")[0].slice(0, 160),
          email_verified: true, hd: session.user.googleHostedDomain ?? null,
        }); return;
      }
      const publicMethods = {
        "/api/better-auth/sign-in/social": "POST", "/api/better-auth/callback/google": "GET",
        "/api/better-auth/get-session": "GET", "/api/better-auth/sign-out": "POST", "/api/better-auth/ok": "GET",
      };
      if (publicMethods[path] === request.method) { await nativeHandler(request, response); return; }
      json(response, 404, { detail: "Not found" });
    } catch { if (!response.headersSent) json(response, 503, { detail: "Sign-in is temporarily unavailable" }, { "Retry-After": "1" }); else response.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await createEdgeLabAuth();
  const server = createAuthServer(service);
  server.listen(Number(process.env.EDGELAB_AUTH_PORT || 3002), process.env.EDGELAB_AUTH_HOST || "127.0.0.1");
  const shutdown = () => {
    if (service.draining) return;
    service.draining = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 30000);
    deadline.unref();
    server.close(async () => {
      try { await service.close(); clearTimeout(deadline); process.exit(0); }
      catch { console.error("Authentication database shutdown unavailable"); process.exit(1); }
    });
  };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
