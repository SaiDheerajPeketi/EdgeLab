import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const dataDir = path.join(__dirname, "data");
export const dbPath = path.join(dataDir, "trades.db");

export function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

ensureDataDir();

export const db = await openDatabase(dbPath);
setPragma("journal_mode = WAL");
setPragma("foreign_keys = ON");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instruments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      candle_count INTEGER NOT NULL DEFAULT 0,
      timeframe_detected TEXT,
      first_timestamp INTEGER,
      last_timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE,
      UNIQUE (instrument_id, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_candles_instrument_time
      ON candles (instrument_id, timestamp);

    CREATE TABLE IF NOT EXISTS playbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      entry_rules TEXT NOT NULL DEFAULT '',
      exit_rules TEXT NOT NULL DEFAULT '',
      risk_rules TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      instrument_id INTEGER NOT NULL,
      playbook_id INTEGER,
      strategy_tag TEXT NOT NULL DEFAULT '',
      starting_balance REAL NOT NULL DEFAULT 10000,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active',
      current_candle_index INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE,
      FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_instrument
      ON sessions (instrument_id);

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      instrument_id INTEGER NOT NULL,
      playbook_id INTEGER,
      strategy_tag TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
      entry_price REAL NOT NULL,
      exit_price REAL,
      stop_loss REAL,
      take_profit_1 REAL,
      take_profit_2 REAL,
      position_size REAL NOT NULL DEFAULT 0,
      entry_timestamp INTEGER NOT NULL,
      exit_timestamp INTEGER,
      hold_duration_minutes REAL,
      gross_pnl REAL NOT NULL DEFAULT 0,
      net_pnl REAL NOT NULL DEFAULT 0,
      commission REAL NOT NULL DEFAULT 0,
      risk_amount REAL NOT NULL DEFAULT 0,
      reward_amount REAL NOT NULL DEFAULT 0,
      r_multiple REAL NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'open',
      partial_closes TEXT NOT NULL DEFAULT '[]',
      user_notes TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      screenshot_path TEXT,
      entry_rating INTEGER,
      exit_rating INTEGER,
      emotional_state TEXT,
      pre_trade_notes TEXT NOT NULL DEFAULT '',
      post_trade_notes TEXT NOT NULL DEFAULT '',
      mistakes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE,
      FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trades_session
      ON trades (session_id);

    CREATE INDEX IF NOT EXISTS idx_trades_instrument
      ON trades (instrument_id);

    CREATE INDEX IF NOT EXISTS idx_trades_exit_time
      ON trades (exit_timestamp);

    CREATE TABLE IF NOT EXISTS drawings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      points TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#60a5fa',
      style TEXT NOT NULL DEFAULT 'solid',
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_drawings_session
      ON drawings (session_id);
  `);
}

export function mapInstrument(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    filename: row.filename,
    uploaded_at: row.uploaded_at,
    candle_count: row.candle_count,
    timeframe_detected: row.timeframe_detected,
    first_timestamp: row.first_timestamp,
    last_timestamp: row.last_timestamp,
  };
}

export function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    instrument_id: row.instrument_id,
    instrument_name: row.instrument_name,
    playbook_id: row.playbook_id,
    playbook_name: row.playbook_name,
    strategy_tag: row.strategy_tag,
    starting_balance: row.starting_balance,
    currency: row.currency,
    created_at: row.created_at,
    status: row.status,
    current_candle_index: row.current_candle_index,
    notes: row.notes,
    pnl: row.pnl ?? 0,
    trade_count: row.trade_count ?? 0,
    win_rate: row.win_rate ?? 0,
  };
}

export function mapTrade(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    instrument_id: row.instrument_id,
    instrument_name: row.instrument_name,
    playbook_id: row.playbook_id,
    playbook_name: row.playbook_name,
    strategy_tag: row.strategy_tag,
    direction: row.direction,
    entry_price: row.entry_price,
    exit_price: row.exit_price,
    stop_loss: row.stop_loss,
    take_profit_1: row.take_profit_1,
    take_profit_2: row.take_profit_2,
    position_size: row.position_size,
    entry_timestamp: row.entry_timestamp,
    exit_timestamp: row.exit_timestamp,
    hold_duration_minutes: row.hold_duration_minutes,
    gross_pnl: row.gross_pnl,
    net_pnl: row.net_pnl,
    commission: row.commission,
    risk_amount: row.risk_amount,
    reward_amount: row.reward_amount,
    r_multiple: row.r_multiple,
    outcome: row.outcome,
    partial_closes: parseJson(row.partial_closes, []),
    user_notes: row.user_notes,
    tags: row.tags,
    screenshot_path: row.screenshot_path,
    entry_rating: row.entry_rating,
    exit_rating: row.exit_rating,
    emotional_state: row.emotional_state,
    pre_trade_notes: row.pre_trade_notes,
    post_trade_notes: row.post_trade_notes,
    mistakes: row.mistakes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

initDb();

async function openDatabase(filename) {
  try {
    const { default: BetterSqliteDatabase } = await import("better-sqlite3");
    return new BetterSqliteDatabase(filename);
  } catch {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(filename);
    database.transaction = (fn) => {
      return (...args) => {
        database.exec("BEGIN");
        try {
          const value = fn(...args);
          database.exec("COMMIT");
          return value;
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      };
    };
    return database;
  }
}

function setPragma(value) {
  if (typeof db.pragma === "function") {
    db.pragma(value);
    return;
  }
  db.exec(`PRAGMA ${value}`);
}
