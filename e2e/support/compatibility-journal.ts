import { expect, type Page } from "@playwright/test";
import type { CanonicalTrade, CanonicalTradeReviewUpdate, JournalAccount, JournalAccountCreate } from "../../frontend/src/lib/journalApi";
import { installDeterminism, seedApprovedSession } from "./app";

const timestamp = "2026-09-15T10:30:00.000Z";
export const tradeId = 83_101;
export const tradePath = `/app/journal/trades#journal/trades?trade=${tradeId}`;
export const accountsPath = "/app/journal/accounts";
export const reviewPath = `/api/journal/trades/${tradeId}/review`;
export const reviewCanary = {
  reviewed: true,
  rating: 4,
  setup_grade: "A+" as const,
  note: "Persisted review canary UIR-83",
};
export const accountCanary = {
  name: "UIR-83 persisted desk",
  provider: "Manual Canary",
  currency: "EUR",
  timezone: "Europe/Berlin",
  initial_balance: 23_456.78,
  notes: "Persisted account canary UIR-83",
};
export const seedAccount: JournalAccount = {
  id: 83_081,
  broker_account_id: null,
  source_type: "MANUAL",
  source_key: "uir-83-seed",
  name: "UIR-83 seed account",
  provider: "Seed broker",
  currency: "USD",
  timezone: "UTC",
  initial_balance: 25_000,
  color: null,
  notes: "Initial account fixture",
  status: "ACTIVE",
  created_at: timestamp,
  updated_at: timestamp,
};
export const seedTrade: CanonicalTrade = {
  id: tradeId,
  account_id: seedAccount.id,
  import_run_id: null,
  source_type: "MANUAL",
  source_ref: "uir-83-trade",
  duplicate_key: "uir-83-trade",
  entry_type: "TAKEN",
  status: "CLOSED",
  symbol: "BTCUSDT",
  source_symbol: "BTCUSDT",
  currency: "USD",
  source_timezone: "UTC",
  side: "LONG",
  entry_time: "2026-09-15T09:00:00.000Z",
  exit_time: "2026-09-15T10:00:00.000Z",
  entry_price: 100,
  exit_price: 200,
  quantity: 2,
  remaining_quantity: 0,
  gross_pnl: 200,
  net_pnl: 195,
  commission: 4,
  fees: 1,
  stop_loss: 50,
  take_profit: 200,
  planned_entry_price: null,
  planned_exit_price: null,
  planned_stop_loss: null,
  planned_take_profit: null,
  r_multiple: 2,
  strategy_name: "UIR-83 canary",
  emotional_state: "Patient",
  missed_reason: null,
  rating: null,
  setup_grade: null,
  reviewed: false,
  reviewed_at: null,
  created_at: timestamp,
  updated_at: timestamp,
  tags: [],
  notes: [],
  screenshots: [],
  executions: [],
};

export async function installJournalFixture(page: Page, { setup = true }: { setup?: boolean } = {}) {
  if (setup) {
    await installDeterminism(page, { rollout: "fallback" });
    await seedApprovedSession(page);
  }
  const state = {
    fallback: true,
    failReview: false,
    failAccount: false,
    failAccountRead: false,
    reviewGate: null as Promise<void> | null,
    accountGate: null as Promise<void> | null,
    trade: structuredClone(seedTrade),
    tradePage: null as CanonicalTrade[] | null,
    accounts: [structuredClone(seedAccount)],
    accountPage: null as JournalAccount[] | null,
    reads: [] as string[],
    reviews: [] as Array<{ method: string; path: string; body: CanonicalTradeReviewUpdate }>,
    creations: [] as Array<{ method: string; path: string; body: JournalAccountCreate }>,
  };
  await page.route("**/api/ui/rollout", (route) => route.fulfill({
    json: {
      revision: state.fallback ? "journal-canary-fallback" : "journal-canary-modern",
      kill_switch: state.fallback,
      flags: { shell: true, journal: true, settings: true, chart: true, public: true },
    },
  }));
  await page.route("**/api/journal/**", async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (method === "GET") state.reads.push(path);
    if (path === reviewPath) {
      expect(method).toBe("PATCH");
      const body = route.request().postDataJSON() as CanonicalTradeReviewUpdate;
      state.reviews.push({ method, path, body });
      if (state.reviewGate) await state.reviewGate;
      if (state.failReview) {
        await route.fulfill({ json: { detail: "Review storage unavailable" }, status: 500 });
        return;
      }
      const { note, tag_ids: _tagIds, screenshot_urls: _screenshotUrls, ...fields } = body;
      state.trade = {
        ...state.trade,
        ...fields,
        reviewed: body.reviewed ?? state.trade.reviewed,
        rating: body.rating === undefined ? state.trade.rating : body.rating,
        setup_grade: body.setup_grade === undefined ? state.trade.setup_grade : body.setup_grade,
        reviewed_at: body.reviewed === undefined ? state.trade.reviewed_at : body.reviewed ? timestamp : null,
        notes: note ? [...state.trade.notes, { id: 83_201 + state.trade.notes.length, kind: "REVIEW", body: note, created_at: timestamp }] : state.trade.notes,
        updated_at: timestamp,
      };
      await route.fulfill({ json: state.trade });
    } else if (/^\/api\/journal\/trades\/\d+$/.test(path)) {
      expect(method).toBe("GET");
      const id = Number(path.split("/").at(-1));
      const trade = id === state.trade.id ? state.trade : state.tradePage?.find((item) => item.id === id);
      await route.fulfill(trade ? { json: trade } : { json: { detail: "Trade not found" }, status: 404 });
    } else if (path === "/api/journal/trades") {
      expect(method).toBe("GET");
      const accountId = url.searchParams.get("account_id");
      const trades = (state.tradePage ?? [state.trade]).filter((trade) => !accountId || trade.account_id === Number(accountId));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 500);
      await route.fulfill({ json: trades.slice(offset, offset + limit) });
    } else if (path === "/api/journal/accounts") {
      if (method === "POST") {
        const body = route.request().postDataJSON() as JournalAccountCreate;
        state.creations.push({ method, path, body });
        if (state.accountGate) await state.accountGate;
        if (state.failAccount) {
          await route.fulfill({ json: { detail: "Account storage unavailable" }, status: 500 });
          return;
        }
        const created: JournalAccount = {
          ...seedAccount,
          ...body,
          id: 83_082,
          name: body.name,
          provider: body.provider ?? "Manual",
          currency: body.currency ?? "USD",
          timezone: body.timezone ?? "UTC",
          initial_balance: body.initial_balance ?? 0,
          color: body.color ?? null,
          notes: body.notes ?? null,
          source_key: "uir-83-created-account",
        };
        state.accounts.push(created);
        await route.fulfill({ json: created, status: 201 });
      } else {
        expect(method).toBe("GET");
        await route.fulfill(state.failAccountRead ? { json: { detail: "Account list unavailable" }, status: 500 } : { json: state.accountPage ?? state.accounts });
      }
    } else if (path === "/api/journal/backfill") {
      await route.fulfill({ json: {
        accounts_created: 0, trades_created: 0, executions_created: 0, notes_created: 0,
        screenshots_created: 0, tags_created: 0, sources_unchanged: 1, diagnostics: [],
      } });
    } else if (["/api/journal/tags", "/api/journal/daily-notes", "/api/journal/imports"].includes(path)) {
      await route.fulfill({ json: [] });
    } else {
      await route.fallback();
    }
  });
  return state;
}
