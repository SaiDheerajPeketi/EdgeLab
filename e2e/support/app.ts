import { expect, type Locator, type Page } from "@playwright/test";

export const FROZEN_TIME = "2026-09-15T10:30:00.000Z";
export const GOOGLE_STATE_KEY = "edgelab.google-auth.state.v1";
export const AUTH_SESSION_KEY = "edgelab.auth.session.v1";

type DeterminismOptions = {
  devAuth?: boolean;
  seatsRemaining?: number;
};

const betaUser = {
  approved: true,
  beta_position: null,
  email: "visual@example.com",
  id: 7001,
  is_beta_user: true,
  name: "Visual Reviewer",
  plan: "beta",
  provider: "google",
} as const;

export const betaSessionResponse = {
  created_at: "2026-09-15T10:00:00.000Z",
  expires_at: "2027-09-15T10:00:00.000Z",
  token: "ui-regression-token",
  user: betaUser,
};

export async function installDeterminism(
  page: Page,
  { devAuth = false, seatsRemaining = 363 }: DeterminismOptions = {},
) {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(({ frozenEpoch }) => {
    const NativeDate = Date;
    class FrozenDate extends NativeDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length > 0 ? args : [frozenEpoch]));
      }
      static now() {
        return frozenEpoch;
      }
    }
    Object.setPrototypeOf(FrozenDate, NativeDate);
    Object.defineProperty(globalThis, "Date", { configurable: true, value: FrozenDate });

    let seed = 0x2f6e2b1;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    const installStyle = () => {
      if (document.getElementById("edgelab-e2e-motion-lock")) return;
      const style = document.createElement("style");
      style.id = "edgelab-e2e-motion-lock";
      style.textContent = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          caret-color: transparent !important;
          scroll-behavior: auto !important;
          transition-delay: 0s !important;
          transition-duration: 0s !important;
        }
      `;
      document.head.append(style);
    };
    if (document.head) installStyle();
    else document.addEventListener("DOMContentLoaded", installStyle, { once: true });
  }, { frozenEpoch: Date.parse(FROZEN_TIME) });

  const total = 500;
  const remaining = Math.max(0, seatsRemaining);
  const program = {
    mode: "beta",
    seats_remaining: remaining,
    seats_taken: total - remaining,
    seats_total: total,
    waitlist_count: 27,
  };

  await page.route("**/api/**", async (route) => {
    await route.fulfill({ body: JSON.stringify({}), contentType: "application/json", status: 200 });
  });
  await page.route("**/api/auth/google/exchange", async (route) => {
    await route.fulfill({ body: JSON.stringify({ program, session: betaSessionResponse }), contentType: "application/json", status: 200 });
  });
  await page.route("**/api/auth/dev/bypass", async (route) => {
    await route.fulfill({ body: JSON.stringify({ program, session: betaSessionResponse }), contentType: "application/json", status: 200 });
  });
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({ body: JSON.stringify(betaSessionResponse), contentType: "application/json", status: 200 });
  });
  await page.route("**/api/auth/config", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        dev_auth_bypass_enabled: devAuth,
        google_client_id: "visual-client.apps.googleusercontent.com",
        google_enabled: true,
        google_redirect_uri: "http://127.0.0.1/auth/callback/google",
        manual_access_enabled: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/beta/status", async (route) => {
    await route.fulfill({ body: JSON.stringify(program), contentType: "application/json", status: 200 });
  });
}

export async function gotoStable(
  page: Page,
  path: string,
  { waitForNetworkIdle = true }: { waitForNetworkIdle?: boolean } = {},
) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await settlePage(page, { waitForNetworkIdle });
}

export async function settlePage(
  page: Page,
  { waitForNetworkIdle = true }: { waitForNetworkIdle?: boolean } = {},
) {
  if (waitForNetworkIdle) await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((image) =>
      image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
    ));
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.locator("body")).toBeVisible();
}

export async function seedApprovedSession(page: Page) {
  await page.addInitScript(({ key, session }) => {
    window.localStorage.setItem(key, JSON.stringify({
      createdAt: session.created_at,
      expiresAt: session.expires_at,
      token: session.token,
      user: {
        approved: session.user.approved,
        betaPosition: session.user.beta_position,
        email: session.user.email,
        id: session.user.id,
        isBetaUser: true,
        name: session.user.name,
        plan: "beta",
        provider: session.user.provider,
      },
    }));
  }, { key: AUTH_SESSION_KEY, session: betaSessionResponse });
}

export async function seedGoogleCallback(page: Page, fromPath = "/app") {
  await page.addInitScript(({ frozenEpoch, from, key }) => {
    const state = {
      fromPath: from,
      issuedAt: frozenEpoch,
      redirectUri: `${window.location.origin}/auth/callback/google`,
      state: "visual-oauth-state",
    };
    window.sessionStorage.setItem(key, JSON.stringify(state));
  }, { frozenEpoch: Date.parse(FROZEN_TIME), from: fromPath, key: GOOGLE_STATE_KEY });
}

export async function expectStableScreenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean; mask?: Locator[] } = {},
) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: options.fullPage ?? true,
    mask: options.mask,
    maskColor: "#0B1118",
  });
}
