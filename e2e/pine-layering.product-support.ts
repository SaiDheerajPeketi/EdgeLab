import { createHash } from "node:crypto";
import { expect, type Page, type Locator } from "@playwright/test";
import { AUTH_SESSION_KEY, betaSessionResponse, FROZEN_TIME, gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";
import { prepare, fulfillReplayContext } from "./support/replay-context";

export async function productSetup(page: Page, options: { target?: "/app/replay" | "/app/live"; keepBinanceWebSocket?: boolean; beforeNavigate?: (context: { receipts: Map<string, any> }) => Promise<void> } = {}) {
  if (options.keepBinanceWebSocket) {
    await installDeterminism(page, { keepBinanceWebSocket: true });
    await seedApprovedSession(page);
    await seedChartLayout(page, "single");
  } else {
    await prepare(page);
  }
  await fulfillReplayContext(page);
  const accessExpiry = new Date(Date.parse(FROZEN_TIME) + 300_000).toISOString();
  const session = { ...betaSessionResponse, user: { ...betaSessionResponse.user, provider: "google", deployment_mode: "production", workspace_access: true, access_expires_at: accessExpiry, is_beta_user: false, plan: "pro" } };
  const storage = new Map<string, any>();
  const receipts = new Map<string, any>();
  const workerReceipts: any[] = [];
  await page.route("**/assets/pine-native-worker*.js", async (route) => {
    const response = await route.fetch();
    const bytes = await response.body();
    workerReceipts.push({ url: route.request().url(), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    await route.fulfill({ response, body: bytes });
  });
  await page.addInitScript(({ session, key }) => {
    if (window !== window.top) return;
    const user = session.user;
    localStorage.setItem(key, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token, user: {
      id: user.id, email: user.email, name: user.name, provider: user.provider, approved: user.approved, betaPosition: user.beta_position,
      deploymentMode: user.deployment_mode, workspaceAccess: user.workspace_access, accessExpiresAt: user.access_expires_at, isBetaUser: user.is_beta_user, plan: user.plan,
    } }));
    (window as any).__layerResults = [];
    addEventListener("message", (event) => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find((item) => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__layerResults.push(event.data.payload);
    }, true);
  }, { session, key: AUTH_SESSION_KEY });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") return route.fulfill({ json: session });
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: "production", google_enabled: true, manual_access_enabled: false, dev_auth_bypass_enabled: false } });
    if (endpoint === "/billing/status") return route.fulfill({ json: { provider: "stripe", mode: "live", configured: true, workspace_access: true, subscription_access: true, plan: "pro", status: "active", cadence: "monthly", current_period_end: "2027-09-15T10:00:00Z", verified_at: FROZEN_TIME, refresh_required: false, cancel_at_period_end: false } });
    const operation = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (operation) {
      expect(request.headers().authorization).toBe(`Bearer ${session.token}`);
      const [, id, action] = operation;
      if (action === "reserve") receipts.set(id, { operation_id: id, ...request.postDataJSON(), status: "reserved", http_status: null, result: null, created_at: FROZEN_TIME, completed_at: null });
      expect(receipts.has(id)).toBe(true);
      return route.fulfill({ json: receipts.get(id) });
    }
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound) {
      expect(receipts.get(bound)).toMatchObject({ method: request.method(), path: endpoint, status: "reserved" });
      Object.assign(receipts.get(bound), { status: "completed", http_status: 200, completed_at: FROZEN_TIME });
    }
    const encoded = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (encoded) {
      const key = decodeURIComponent(encoded);
      if (request.method() === "PUT") storage.set(key, structuredClone(request.postDataJSON().value));
      return route.fulfill({ json: { namespace: "edgelab", key, value: storage.get(key) ?? null, updated_at: FROZEN_TIME } });
    }
    return route.fallback();
  });
  await options.beforeNavigate?.({ receipts });
  await gotoStable(page, options.target ?? "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  return { storage, workerReceipts, receipts };
}
export async function editor(page: Page) {
  const trigger = page.getByRole("button", { name: "Editor", exact: true });
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await trigger.click();
  return page.getByRole("dialog", { name: "EdgeLab indicator editor" });
}
export async function checkedRun(dialog: Locator) {
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
}
export async function observed(page: Page, source: string, color: string) {
  await expect.poll(() => page.evaluate(({ source, color }) => (window as any).__layerResults.some((response: any) => response.status === "completed" && response.result.kind === "run" && response.result.source === source && response.result.inputs.in_0 === color), { source, color })).toBe(true);
  return page.evaluate(({ source, color }) => [...(window as any).__layerResults].reverse().find((response: any) => response.status === "completed" && response.result.kind === "run" && response.result.source === source && response.result.inputs.in_0 === color).result, { source, color });
}
