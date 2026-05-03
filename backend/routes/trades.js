import { db, mapTrade } from "../db.js";
import { asOptionalText, asyncHandler, parseList, requireNumber, toNumber } from "../utils/http.js";
import { createRouter } from "../utils/miniExpress.js";

const router = createRouter();

router.post(
  "/",
  asyncHandler((req, res) => {
    const trade = normalizeTradePayload(req.body);
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(trade.session_id);
    if (!session) {
      res.status(400).json({ error: "invalid_session", message: "Session does not exist." });
      return;
    }

    const instrumentId = trade.instrument_id ?? session.instrument_id;
    const instrument = db.prepare("SELECT id FROM instruments WHERE id = ?").get(instrumentId);
    if (!instrument) {
      res.status(400).json({ error: "invalid_instrument", message: "Instrument does not exist." });
      return;
    }

    const calculated = calculateTrade({
      ...trade,
      instrument_id: instrumentId,
      strategy_tag: trade.strategy_tag || session.strategy_tag,
      playbook_id: trade.playbook_id ?? session.playbook_id,
    });

    const result = db
      .prepare(
        `
          INSERT INTO trades (
            session_id, instrument_id, playbook_id, strategy_tag, direction,
            entry_price, exit_price, stop_loss, take_profit_1, take_profit_2,
            position_size, entry_timestamp, exit_timestamp, hold_duration_minutes,
            gross_pnl, net_pnl, commission, risk_amount, reward_amount,
            r_multiple, outcome, partial_closes, user_notes, tags,
            screenshot_path, entry_rating, exit_rating, emotional_state,
            pre_trade_notes, post_trade_notes, mistakes
          )
          VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?
          )
        `,
      )
      .run(
        calculated.session_id,
        calculated.instrument_id,
        calculated.playbook_id,
        calculated.strategy_tag,
        calculated.direction,
        calculated.entry_price,
        calculated.exit_price,
        calculated.stop_loss,
        calculated.take_profit_1,
        calculated.take_profit_2,
        calculated.position_size,
        calculated.entry_timestamp,
        calculated.exit_timestamp,
        calculated.hold_duration_minutes,
        calculated.gross_pnl,
        calculated.net_pnl,
        calculated.commission,
        calculated.risk_amount,
        calculated.reward_amount,
        calculated.r_multiple,
        calculated.outcome,
        JSON.stringify(calculated.partial_closes),
        calculated.user_notes,
        calculated.tags,
        calculated.screenshot_path,
        calculated.entry_rating,
        calculated.exit_rating,
        calculated.emotional_state,
        calculated.pre_trade_notes,
        calculated.post_trade_notes,
        calculated.mistakes,
      );

    res.status(201).json({ trade: getTrade(Number(result.lastInsertRowid)) });
  }),
);

router.get(
  "/",
  asyncHandler((req, res) => {
    const { where, params } = buildTradeFilter(req.query);
    const rows = db
      .prepare(
        `
          SELECT t.*, i.name AS instrument_name, p.name AS playbook_name
          FROM trades t
          JOIN instruments i ON i.id = t.instrument_id
          LEFT JOIN playbooks p ON p.id = t.playbook_id
          ${where}
          ORDER BY COALESCE(t.exit_timestamp, t.entry_timestamp) DESC, t.id DESC
        `,
      )
      .all(...params);
    res.json({ trades: rows.map(mapTrade) });
  }),
);

router.get(
  "/:id",
  asyncHandler((req, res) => {
    const trade = getTrade(req.params.id);
    if (!trade) {
      res.status(404).json({ error: "not_found", message: "Trade not found." });
      return;
    }
    res.json({ trade });
  }),
);

router.patch(
  "/:id",
  asyncHandler((req, res) => {
    const current = getTrade(req.params.id);
    if (!current) {
      res.status(404).json({ error: "not_found", message: "Trade not found." });
      return;
    }

    const merged = normalizeTradePayload({ ...current, ...req.body }, { partial: true });
    const calculated = calculateTrade({
      ...current,
      ...merged,
      partial_closes: merged.partial_closes ?? current.partial_closes,
    });

    db.prepare(
      `
        UPDATE trades
        SET playbook_id = ?,
            strategy_tag = ?,
            direction = ?,
            entry_price = ?,
            exit_price = ?,
            stop_loss = ?,
            take_profit_1 = ?,
            take_profit_2 = ?,
            position_size = ?,
            entry_timestamp = ?,
            exit_timestamp = ?,
            hold_duration_minutes = ?,
            gross_pnl = ?,
            net_pnl = ?,
            commission = ?,
            risk_amount = ?,
            reward_amount = ?,
            r_multiple = ?,
            outcome = ?,
            partial_closes = ?,
            user_notes = ?,
            tags = ?,
            screenshot_path = ?,
            entry_rating = ?,
            exit_rating = ?,
            emotional_state = ?,
            pre_trade_notes = ?,
            post_trade_notes = ?,
            mistakes = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `,
    ).run(
      calculated.playbook_id,
      calculated.strategy_tag,
      calculated.direction,
      calculated.entry_price,
      calculated.exit_price,
      calculated.stop_loss,
      calculated.take_profit_1,
      calculated.take_profit_2,
      calculated.position_size,
      calculated.entry_timestamp,
      calculated.exit_timestamp,
      calculated.hold_duration_minutes,
      calculated.gross_pnl,
      calculated.net_pnl,
      calculated.commission,
      calculated.risk_amount,
      calculated.reward_amount,
      calculated.r_multiple,
      calculated.outcome,
      JSON.stringify(calculated.partial_closes),
      calculated.user_notes,
      calculated.tags,
      calculated.screenshot_path,
      calculated.entry_rating,
      calculated.exit_rating,
      calculated.emotional_state,
      calculated.pre_trade_notes,
      calculated.post_trade_notes,
      calculated.mistakes,
      req.params.id,
    );

    res.json({ trade: getTrade(req.params.id) });
  }),
);

router.delete(
  "/:id",
  asyncHandler((req, res) => {
    const result = db.prepare("DELETE FROM trades WHERE id = ?").run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found", message: "Trade not found." });
      return;
    }
    res.json({ ok: true });
  }),
);

export function getTradesForAnalytics(query) {
  const { where, params } = buildTradeFilter(query);
  return db
    .prepare(
      `
        SELECT t.*, i.name AS instrument_name, p.name AS playbook_name
        FROM trades t
        JOIN instruments i ON i.id = t.instrument_id
        LEFT JOIN playbooks p ON p.id = t.playbook_id
        ${where}
        ORDER BY COALESCE(t.exit_timestamp, t.entry_timestamp) ASC, t.id ASC
      `,
    )
    .all(...params)
    .map(mapTrade);
}

function getTrade(id) {
  const row = db
    .prepare(
      `
        SELECT t.*, i.name AS instrument_name, p.name AS playbook_name
        FROM trades t
        JOIN instruments i ON i.id = t.instrument_id
        LEFT JOIN playbooks p ON p.id = t.playbook_id
        WHERE t.id = ?
      `,
    )
    .get(id);
  return mapTrade(row);
}

function buildTradeFilter(query) {
  const clauses = [];
  const params = [];
  const sessionIds = parseList(query.session_id ?? query.session_ids);
  const instrumentIds = parseList(query.instrument_id ?? query.instrument_ids);
  const strategyTags = parseList(query.strategy_tag ?? query.strategy_tags);
  const tags = parseList(query.tags);

  if (sessionIds.length > 0) {
    clauses.push(`t.session_id IN (${sessionIds.map(() => "?").join(",")})`);
    params.push(...sessionIds);
  }
  if (instrumentIds.length > 0) {
    clauses.push(`t.instrument_id IN (${instrumentIds.map(() => "?").join(",")})`);
    params.push(...instrumentIds);
  }
  if (strategyTags.length > 0) {
    clauses.push(`t.strategy_tag IN (${strategyTags.map(() => "?").join(",")})`);
    params.push(...strategyTags);
  }
  if (query.direction && query.direction !== "both") {
    clauses.push("t.direction = ?");
    params.push(String(query.direction).toLowerCase());
  }
  if (query.from) {
    clauses.push("COALESCE(t.exit_timestamp, t.entry_timestamp) >= ?");
    params.push(Number(query.from));
  }
  if (query.to) {
    clauses.push("COALESCE(t.exit_timestamp, t.entry_timestamp) <= ?");
    params.push(Number(query.to));
  }
  for (const tag of tags) {
    clauses.push("t.tags LIKE ?");
    params.push(`%${tag}%`);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function normalizeTradePayload(body, options = {}) {
  const direction = asOptionalText(body.direction, "long").toLowerCase();
  if (!["long", "short"].includes(direction)) {
    const error = new Error("direction must be long or short.");
    error.status = 400;
    throw error;
  }

  return {
    session_id: options.partial ? toNumber(body.session_id) : requireNumber(body.session_id, "session_id"),
    instrument_id: toNumber(body.instrument_id),
    playbook_id: toNumber(body.playbook_id),
    strategy_tag: asOptionalText(body.strategy_tag),
    direction,
    entry_price: options.partial ? toNumber(body.entry_price) : requireNumber(body.entry_price, "entry_price"),
    exit_price: toNumber(body.exit_price),
    stop_loss: toNumber(body.stop_loss),
    take_profit_1: toNumber(body.take_profit_1),
    take_profit_2: toNumber(body.take_profit_2),
    position_size: toNumber(body.position_size, 0),
    entry_timestamp: options.partial
      ? toNumber(body.entry_timestamp)
      : requireNumber(body.entry_timestamp, "entry_timestamp"),
    exit_timestamp: toNumber(body.exit_timestamp),
    hold_duration_minutes: toNumber(body.hold_duration_minutes),
    gross_pnl: toNumber(body.gross_pnl, 0),
    net_pnl: toNumber(body.net_pnl, 0),
    commission: toNumber(body.commission, 0),
    risk_amount: toNumber(body.risk_amount, 0),
    reward_amount: toNumber(body.reward_amount, 0),
    r_multiple: toNumber(body.r_multiple, 0),
    outcome: asOptionalText(body.outcome, "open"),
    partial_closes: Array.isArray(body.partial_closes) ? body.partial_closes : [],
    user_notes: asOptionalText(body.user_notes),
    tags: asOptionalText(body.tags),
    screenshot_path: body.screenshot_path ? String(body.screenshot_path) : null,
    entry_rating: toNumber(body.entry_rating),
    exit_rating: toNumber(body.exit_rating),
    emotional_state: body.emotional_state ? String(body.emotional_state) : null,
    pre_trade_notes: asOptionalText(body.pre_trade_notes),
    post_trade_notes: asOptionalText(body.post_trade_notes),
    mistakes: asOptionalText(body.mistakes),
  };
}

function calculateTrade(trade) {
  const isClosed = Number.isFinite(trade.exit_price) && Number.isFinite(trade.exit_timestamp);
  const directionMultiplier = trade.direction === "long" ? 1 : -1;
  const grossPnl = isClosed
    ? (trade.exit_price - trade.entry_price) * trade.position_size * directionMultiplier
    : 0;
  const netPnl = grossPnl - (trade.commission ?? 0);
  const stopRisk =
    Number.isFinite(trade.stop_loss) && trade.position_size
      ? Math.abs(trade.entry_price - trade.stop_loss) * trade.position_size
      : 0;
  const riskAmount = trade.risk_amount || stopRisk;
  const target = trade.take_profit_1 ?? trade.take_profit_2;
  const rewardAmount =
    Number.isFinite(target) && trade.position_size
      ? Math.abs(target - trade.entry_price) * trade.position_size
      : trade.reward_amount ?? 0;
  const duration =
    trade.hold_duration_minutes ??
    (isClosed ? Math.max(0, (trade.exit_timestamp - trade.entry_timestamp) / 60000) : null);

  return {
    ...trade,
    gross_pnl: grossPnl,
    net_pnl: netPnl,
    risk_amount: riskAmount,
    reward_amount: rewardAmount,
    hold_duration_minutes: duration,
    r_multiple: riskAmount > 0 ? netPnl / riskAmount : 0,
    outcome: isClosed ? (netPnl > 0 ? "win" : netPnl < 0 ? "loss" : "breakeven") : "open",
  };
}

export default router;
