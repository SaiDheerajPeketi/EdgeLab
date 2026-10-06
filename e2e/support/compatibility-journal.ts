import { expect, type Page } from "@playwright/test";
import type { CanonicalTrade, CanonicalTradeReviewUpdate, JournalAccount, JournalAccountCreate, JournalDailyNote, JournalTag } from "../../frontend/src/lib/journalApi";
import { installDeterminism, seedApprovedSession } from "./app";

const timestamp = "2026-09-15T10:30:00.000Z";
export const tradeId = 83_101;
export const tradePath = `/app/journal/trades#journal/trades?trade=${tradeId}`;
export const accountsPath = "/app/journal/accounts";
export const noteDate = "2026-09-15";
export const noteCanary = "  UTC daily reflection\nKeep the trailing space.  \n";
export const seedNotes: JournalDailyNote[] = [
  { id: 83_301, account_id: null, note_date: noteDate, body: "Seed shared day note", created_at: timestamp, updated_at: timestamp },
  { id: 83_302, account_id: 83_081, note_date: noteDate, body: "Seed account day note", created_at: timestamp, updated_at: timestamp },
];
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
    backfills: 0,
    failReview: false,
    failAccount: false,
    failAccountRead: false,
    failNote: false,
    failNoteRead: false,
    noteGate: null as Promise<void> | null,
    notes: structuredClone(seedNotes),
    notePage: null as JournalDailyNote[] | null,
    noteWrites: [] as Array<{ method: string; path: string; body: { account_id?: number | null; body: string } }>,
    tradeReads: [] as Array<{ start: string | null; end: string | null; account: string | null; offset: number; limit: number }>,
    tags: [] as JournalTag[],
    historyGate: null as Promise<void> | null,
    historyGateBefore: null as number | null,
    failHistoryLater: false,
    historyReads: [] as Array<{ before: number | null; ids: number[] }>,
    tradeGate: null as Promise<void> | null,
    tradeGateOffset: null as number | null,
    tradeGateDate: null as string | null,
    pointTrade: null as CanonicalTrade | null,
    pointTradeGate: null as Promise<void> | null,
    reviewGate: null as Promise<void> | null,
    accountGate: null as Promise<void> | null,
    trade: structuredClone(seedTrade),
    tradePage: null as CanonicalTrade[] | null,
    accountReads: [] as Array<string | null>,
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
      const trade = structuredClone(id === state.trade.id ? state.pointTrade ?? state.trade : state.tradePage?.find((item) => item.id === id));
      if (state.pointTradeGate) await state.pointTradeGate;
      await route.fulfill(trade ? { json: trade } : { json: { detail: "Trade not found" }, status: 404 });
    } else if (path === "/api/journal/trades") {
      expect(method).toBe("GET");
      const accountId = url.searchParams.get("account_id");
      const start = url.searchParams.get("start_date");
      const end = url.searchParams.get("end_date");
      const trades = (state.tradePage ?? [state.trade]).map((trade) => trade.id === state.trade.id ? state.trade : trade).filter((trade) => {
        const day = new Date(trade.entry_time).toISOString().slice(0, 10);
        return (!accountId || trade.account_id === Number(accountId)) && (!start || day >= start) && (!end || day <= end);
      });
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 500);
      state.tradeReads.push({ start, end, account: accountId, offset, limit });
      const order = url.searchParams.get("order");
      const before = url.searchParams.has("before_id") ? Number(url.searchParams.get("before_id")) : null;
      const ordered = order === "id" ? trades.filter((trade) => before == null || trade.id < before).sort((a, b) => b.id - a.id) : trades;
      const response = structuredClone(ordered.slice(offset, offset + limit));
      if (order === "id") {
        state.historyReads.push({ before, ids: response.map((trade) => trade.id) });
        if (state.historyGate && before === state.historyGateBefore) await state.historyGate;
        if (state.failHistoryLater && before != null) {
          await route.fulfill({ json: { detail: "Complete history page unavailable" }, status: 500 });
          return;
        }
      }
      if (state.tradeGate && offset === state.tradeGateOffset && start === state.tradeGateDate && end === start) await state.tradeGate;
      await route.fulfill({ json: response });
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
        state.accountReads.push(url.searchParams.get("include_archived"));
        await route.fulfill(state.failAccountRead ? { json: { detail: "Account list unavailable" }, status: 500 } : { json: state.accountPage ?? state.accounts });
      }
    } else if (path === "/api/journal/backfill") {
      state.backfills += 1;
      await route.fulfill({ json: {
        accounts_created: 0, trades_created: 0, executions_created: 0, notes_created: 0,
        screenshots_created: 0, tags_created: 0, sources_unchanged: 1, diagnostics: [],
      } });
    } else if (/^\/api\/journal\/daily-notes\/\d{4}-\d{2}-\d{2}$/.test(path)) {
      expect(method).toBe("PUT");
      const body = route.request().postDataJSON() as { account_id?: number | null; body: string };
      state.noteWrites.push({ method, path, body });
      if (state.noteGate) await state.noteGate;
      if (state.failNote) { await route.fulfill({ json: { detail: "Daily note storage unavailable" }, status: 500 }); return; }
      const date = path.split("/").at(-1)!;
      const index = state.notes.findIndex((note) => note.note_date === date && note.account_id === (body.account_id ?? null));
      const saved: JournalDailyNote = {
        id: index < 0 ? 83_301 + state.notes.length : state.notes[index].id,
        account_id: body.account_id ?? null, note_date: date, body: body.body,
        created_at: index < 0 ? timestamp : state.notes[index].created_at, updated_at: timestamp,
      };
      if (index < 0) state.notes.push(saved); else state.notes[index] = saved;
      await route.fulfill({ json: saved });
    } else if (path === "/api/journal/daily-notes") {
      expect(method).toBe("GET");
      if (state.failNoteRead) { await route.fulfill({ json: { detail: "Daily note list unavailable" }, status: 500 }); return; }
      const start = url.searchParams.get("start_date");
      const end = url.searchParams.get("end_date");
      const account = url.searchParams.get("account_id");
      await route.fulfill({ json: (state.notePage ?? state.notes).filter((note) =>
        (!start || note.note_date >= start) && (!end || note.note_date <= end) && (!account || note.account_id === Number(account)),
      ) });
    } else if (path === "/api/journal/tags") {
      if (method === "POST") {
        const body = route.request().postDataJSON() as { category: JournalTag["category"]; name: string };
        const tag: JournalTag = { id: 83401 + state.tags.length, ...body, color: null, archived_at: null, created_at: timestamp };
        state.tags.push(tag);
        await route.fulfill({ json: tag, status: 201 });
      } else await route.fulfill({ json: state.tags });
    } else if (path === "/api/journal/imports") {
      await route.fulfill({ json: [] });
    } else {
      await route.fallback();
    }
  });
  return state;
}
