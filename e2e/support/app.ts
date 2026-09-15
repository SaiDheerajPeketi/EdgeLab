import { expect, type Locator, type Page, type Route } from "@playwright/test";

export const FROZEN_TIME = "2026-09-15T10:30:00.000Z";
export const GOOGLE_STATE_KEY = "edgelab.google-auth.state.v1";
export const AUTH_SESSION_KEY = "edgelab.auth.session.v1";

type DeterminismOptions = {
  devAuth?: boolean;
  motionLock?: boolean;
  seatsRemaining?: number;
  rollout?: "enabled" | "fallback" | "unavailable";
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
  { devAuth = false, motionLock = true, seatsRemaining = 363, rollout = "enabled" }: DeterminismOptions = {},
) {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(({ datasetCatalog, frozenEpoch, lockMotion }) => {
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

    // The authenticated dataset stream is deliberately kept in-process for UI
    // tests. The seeded browser token is not a production JWT, and allowing the
    // real socket to reject it creates an endless reconnect cycle that makes
    // visual settling depend on machine timing.
    const NativeWebSocket = globalThis.WebSocket;
    class DatasetFixtureWebSocket extends EventTarget {
      static readonly CONNECTING = NativeWebSocket.CONNECTING;
      static readonly OPEN = NativeWebSocket.OPEN;
      static readonly CLOSING = NativeWebSocket.CLOSING;
      static readonly CLOSED = NativeWebSocket.CLOSED;

      readonly CONNECTING = NativeWebSocket.CONNECTING;
      readonly OPEN = NativeWebSocket.OPEN;
      readonly CLOSING = NativeWebSocket.CLOSING;
      readonly CLOSED = NativeWebSocket.CLOSED;
      readonly url: string;
      readonly protocol = "";
      readonly extensions = "";
      readonly binaryType: BinaryType = "blob";
      bufferedAmount = 0;
      readyState = NativeWebSocket.CONNECTING;
      onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
      onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
      onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
      onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;

      constructor(url: string | URL, protocols?: string | string[]) {
        const resolved = String(url);
        if (!new URL(resolved, window.location.href).pathname.endsWith("/api/datasets/stream")) {
          return new NativeWebSocket(resolved, protocols) as unknown as DatasetFixtureWebSocket;
        }
        super();
        this.url = resolved;
        queueMicrotask(() => {
          if (this.readyState !== NativeWebSocket.CONNECTING) return;
          this.readyState = NativeWebSocket.OPEN;
          const opened = new Event("open");
          this.dispatchEvent(opened);
          this.onopen?.call(this as unknown as WebSocket, opened);
          const message = new MessageEvent("message", {
            data: JSON.stringify({ catalog: datasetCatalog, type: "catalog" }),
          });
          this.dispatchEvent(message);
          this.onmessage?.call(this as unknown as WebSocket, message);
        });
      }

      send() {}

      close(code = 1000, reason = "fixture closed") {
        if (this.readyState === NativeWebSocket.CLOSED) return;
        this.readyState = NativeWebSocket.CLOSED;
        const closed = new CloseEvent("close", { code, reason, wasClean: true });
        this.dispatchEvent(closed);
        this.onclose?.call(this as unknown as WebSocket, closed);
      }
    }
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: DatasetFixtureWebSocket as unknown as typeof WebSocket,
    });

    (globalThis as typeof globalThis & { __edgeLayoutShifts?: number[] }).__edgeLayoutShifts = [];
    if ("PerformanceObserver" in globalThis && PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput && typeof shift.value === "number") {
            (globalThis as typeof globalThis & { __edgeLayoutShifts: number[] }).__edgeLayoutShifts.push(shift.value);
          }
        }
      }).observe({ buffered: true, type: "layout-shift" });
    }

    let seed = 0x2f6e2b1;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    if (lockMotion) {
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
    }
  }, { datasetCatalog: seedDatasets, frozenEpoch: Date.parse(FROZEN_TIME), lockMotion: motionLock });

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
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace(/^\/api/, "");
    if (endpoint === "/ui/rollout") {
      if (rollout === "unavailable") return route.abort("failed");
      return route.fulfill({
        body: JSON.stringify({
          revision: "ui-regression-v2",
          kill_switch: rollout === "fallback",
          flags: { shell: true, journal: true, settings: true, chart: true, public: true },
        }),
        contentType: "application/json",
        status: 200,
      });
    }
    if (endpoint === "/bootstrap-shell") {
      return fulfillJson(route, {
        active_session_id: 4101,
        dashboard_summary: null,
        playbooks: [{ id: 31, name: "Opening range", description: "Wait for the retest.", rules: "Risk 0.5R", created_at: FROZEN_TIME, updated_at: FROZEN_TIME }],
        recent_session_limit: 25,
        recent_sessions: [seedSession],
        recent_sessions_has_more: false,
        recent_sessions_next_cursor: null,
        recent_sessions_next_offset: 1,
        strategy_summaries: [],
      });
    }
    if (endpoint === "/datasets") return fulfillJson(route, seedDatasets);
    if (endpoint.startsWith("/app-storage/")) {
      return fulfillJson(route, { namespace: "edgelab", key: endpoint.split("/").at(-1), value: null, updated_at: FROZEN_TIME });
    }
    if (endpoint === "/journal/accounts") return fulfillJson(route, seedAccounts);
    if (endpoint === "/journal/tags") return fulfillJson(route, seedTags);
    if (endpoint === "/journal/trades") return fulfillJson(route, seedTrades);
    if (endpoint === "/journal/daily-notes") return fulfillJson(route, seedNotes);
    if (endpoint === "/journal/imports") return fulfillJson(route, []);
    if (endpoint === "/backtests" || endpoint === "/backtests/summaries") return fulfillJson(route, []);
    if (endpoint === "/backtests/strategy-summaries" || endpoint === "/trades" || endpoint === "/playbooks") return fulfillJson(route, []);
    if (endpoint === "/market-data/instruments") return fulfillJson(route, []);
    if (endpoint === "/market-data/alerts" || endpoint === "/market-data/alert-events") return fulfillJson(route, []);
    if (endpoint === "/broker-providers" || endpoint === "/broker-connections") return fulfillJson(route, []);
    if (endpoint === "/quant/models") return fulfillJson(route, { models: [] });
    return fulfillJson(route, {});
  });
  await page.route("https://api.binance.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ticker/24hr")) return fulfillJson(route, { lastPrice: "68124.50", priceChangePercent: "1.82" });
    return fulfillJson(route, seedKlines);
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

function fulfillJson(route: Route, value: unknown) {
  return route.fulfill({ body: JSON.stringify(value), contentType: "application/json", status: 200 });
}

const seedSession = {
  id: 4101, name: "BTC morning review", symbol: "BTCUSDT", instrument: "BTC / Tether", timeframe: "5m",
  csv_path: null, currency: "USD", timezone: "UTC", pnl_multiplier: 1, strategy_name: "Opening range",
  playbook_id: 31, start_at: "2026-09-15T08:00:00.000Z", end_at: null, start_offset: 0, end_offset: 240,
  status: "ACTIVE", current_offset: 96, replay_ready: true, initial_balance: 25000, realized_pnl: 384.75,
  default_commission_mode: "FIXED", default_commission_value: 2.5, default_fee_mode: "NONE", default_fee_value: 0,
  created_at: FROZEN_TIME, updated_at: FROZEN_TIME,
};

const seedDatasets = {
  root: "/fixtures/markets",
  instruments: [{
    id: "btc-usdt", name: "Bitcoin / Tether", symbol: "BTCUSDT", currency: "USD", timezone: "UTC",
    pnl_multiplier: 1, folder_path: null, updated_at: FROZEN_TIME,
    timeframes: [{ timeframe: "5m", csv_path: "fixture.csv", rows: 240, first_timestamp: "2026-09-15T00:00:00Z", last_timestamp: FROZEN_TIME, imported: true, imported_at: FROZEN_TIME }],
  }],
};

const seedAccounts = [{ id: 81, broker_account_id: null, source_type: "MANUAL", source_key: "visual-primary", name: "Primary Futures — Frankfurt Desk", provider: "EdgeLab", currency: "USD", timezone: "Europe/Berlin", initial_balance: "25000", color: "#22d3ee", notes: "Deterministic visual fixture", status: "ACTIVE", created_at: FROZEN_TIME, updated_at: FROZEN_TIME }];
const seedTags = [{ id: 91, category: "SETUP", name: "Opening range retest", color: "#22d3ee", archived_at: null, created_at: FROZEN_TIME }];
const seedTrades = [{
  id: 101, account_id: 81, import_run_id: null, source_type: "MANUAL", source_ref: "visual-trade-101", duplicate_key: "visual-101", entry_type: "TAKEN", status: "CLOSED", symbol: "BTCUSDT", source_symbol: "BTCUSDT", currency: "USD", source_timezone: "Europe/Berlin", side: "LONG", entry_time: "2026-09-15T09:05:00Z", exit_time: "2026-09-15T09:42:00Z", entry_price: "67920.25", exit_price: "68118.50", quantity: "2", remaining_quantity: "0", gross_pnl: "396.50", net_pnl: "384.75", commission: "5", fees: "6.75", stop_loss: "67840", take_profit: "68120", planned_entry_price: "67900", planned_exit_price: "68120", planned_stop_loss: "67830", planned_take_profit: "68120", r_multiple: "2.35", strategy_name: "Opening range", emotional_state: "Patient", missed_reason: null, rating: 5, setup_grade: "A", reviewed: true, reviewed_at: FROZEN_TIME, created_at: FROZEN_TIME, updated_at: FROZEN_TIME, tags: seedTags, notes: [{ id: 111, kind: "REVIEW", body: "Held the retest and followed the planned exit.", created_at: FROZEN_TIME }], screenshots: [], executions: [],
}];
const seedNotes = [{ id: 121, account_id: 81, note_date: "2026-09-15", body: "Wait for confirmation at the opening range before adding risk.", created_at: FROZEN_TIME, updated_at: FROZEN_TIME }];
const seedKlines = Array.from({ length: 120 }, (_, index) => {
  const open = 67500 + index * 5 + Math.sin(index / 5) * 80;
  const close = open + Math.cos(index / 4) * 32;
  return [Date.parse("2026-09-15T00:00:00Z") + index * 300_000, open.toFixed(2), (Math.max(open, close) + 24).toFixed(2), (Math.min(open, close) - 21).toFixed(2), close.toFixed(2), String(80 + index), 0, 0, 0, 0, 0, 0];
});

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

export async function seedChartLayout(page: Page, paneLayout: "single" | "vertical-2" | "horizontal-2" | "grid-4" | "grid-6" | "grid-9" | "grid-12" | "grid-16") {
  await page.addInitScript(({ layout }) => {
    const value = JSON.stringify({
      chartStyle: "candles",
      drawings: [],
      indicatorInstances: [],
      magnetMode: "off",
      paneLayout: layout,
      schemaVersion: 2,
      settingsDefaultsVersion: 2,
      showOrderOverlays: true,
      smoothCandles: false,
      timeframe: "5m",
    });
    for (const key of ["edgelab.chart-layout.v1.user-7001", "edgelab.live-chart-layout.v1.user-7001"]) {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem(`${key}.__updatedAt`, String(Date.now()));
    }
  }, { layout: paneLayout });
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
