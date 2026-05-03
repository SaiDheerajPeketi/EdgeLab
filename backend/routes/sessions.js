import { db, mapSession } from "../db.js";
import { asOptionalText, asyncHandler, requireNumber, toNumber } from "../utils/http.js";
import { createRouter } from "../utils/miniExpress.js";

const router = createRouter();

router.post(
  "/",
  asyncHandler((req, res) => {
    const instrumentId = requireNumber(req.body.instrument_id, "instrument_id");
    const instrument = db.prepare("SELECT id FROM instruments WHERE id = ?").get(instrumentId);
    if (!instrument) {
      res.status(400).json({ error: "invalid_instrument", message: "Instrument does not exist." });
      return;
    }

    const name = asOptionalText(req.body.name, "Untitled Backtest").trim() || "Untitled Backtest";
    const result = db
      .prepare(
        `
          INSERT INTO sessions
            (name, instrument_id, playbook_id, strategy_tag, starting_balance, currency, notes)
          VALUES
            (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        name,
        instrumentId,
        toNumber(req.body.playbook_id),
        asOptionalText(req.body.strategy_tag),
        toNumber(req.body.starting_balance, 10000),
        asOptionalText(req.body.currency, "USD"),
        asOptionalText(req.body.notes),
      );

    const row = getSession(Number(result.lastInsertRowid));
    res.status(201).json({ session: mapSession(row) });
  }),
);

router.get(
  "/",
  asyncHandler((_req, res) => {
    const rows = db
      .prepare(
        `
          SELECT
            s.*,
            i.name AS instrument_name,
            p.name AS playbook_name,
            COALESCE(SUM(CASE WHEN t.exit_timestamp IS NOT NULL THEN t.net_pnl ELSE 0 END), 0) AS pnl,
            SUM(CASE WHEN t.exit_timestamp IS NOT NULL THEN 1 ELSE 0 END) AS trade_count,
            COALESCE(
              1.0 * SUM(CASE WHEN t.exit_timestamp IS NOT NULL AND t.net_pnl > 0 THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN t.exit_timestamp IS NOT NULL THEN 1 ELSE 0 END), 0),
              0
            ) AS win_rate
          FROM sessions s
          JOIN instruments i ON i.id = s.instrument_id
          LEFT JOIN playbooks p ON p.id = s.playbook_id
          LEFT JOIN trades t ON t.session_id = s.id
          GROUP BY s.id
          ORDER BY s.created_at DESC, s.id DESC
        `,
      )
      .all();
    res.json({ sessions: rows.map(mapSession) });
  }),
);

router.get(
  "/:id",
  asyncHandler((req, res) => {
    const row = getSession(req.params.id);
    if (!row) {
      res.status(404).json({ error: "not_found", message: "Session not found." });
      return;
    }

    const instrument = db.prepare("SELECT * FROM instruments WHERE id = ?").get(row.instrument_id);
    res.json({ session: mapSession(row), instrument });
  }),
);

router.patch(
  "/:id",
  asyncHandler((req, res) => {
    const existing = getSession(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Session not found." });
      return;
    }

    const next = {
      name: req.body.name ?? existing.name,
      playbook_id: req.body.playbook_id === undefined ? existing.playbook_id : toNumber(req.body.playbook_id),
      strategy_tag: req.body.strategy_tag ?? existing.strategy_tag,
      starting_balance:
        req.body.starting_balance === undefined
          ? existing.starting_balance
          : toNumber(req.body.starting_balance, existing.starting_balance),
      currency: req.body.currency ?? existing.currency,
      status: req.body.status ?? existing.status,
      current_candle_index:
        req.body.current_candle_index === undefined
          ? existing.current_candle_index
          : Math.max(0, Math.floor(toNumber(req.body.current_candle_index, existing.current_candle_index))),
      notes: req.body.notes ?? existing.notes,
    };

    db.prepare(
      `
        UPDATE sessions
        SET name = ?,
            playbook_id = ?,
            strategy_tag = ?,
            starting_balance = ?,
            currency = ?,
            status = ?,
            current_candle_index = ?,
            notes = ?
        WHERE id = ?
      `,
    ).run(
      next.name,
      next.playbook_id,
      next.strategy_tag,
      next.starting_balance,
      next.currency,
      next.status,
      next.current_candle_index,
      next.notes,
      req.params.id,
    );

    res.json({ session: mapSession(getSession(req.params.id)) });
  }),
);

router.post(
  "/:id/duplicate",
  asyncHandler((req, res) => {
    const existing = getSession(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Session not found." });
      return;
    }

    const result = db
      .prepare(
        `
          INSERT INTO sessions
            (name, instrument_id, playbook_id, strategy_tag, starting_balance, currency, notes)
          VALUES
            (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        asOptionalText(req.body.name, `${existing.name} Copy`),
        existing.instrument_id,
        existing.playbook_id,
        existing.strategy_tag,
        existing.starting_balance,
        existing.currency,
        existing.notes,
      );

    res.status(201).json({ session: mapSession(getSession(Number(result.lastInsertRowid))) });
  }),
);

router.delete(
  "/:id",
  asyncHandler((req, res) => {
    const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found", message: "Session not found." });
      return;
    }
    res.json({ ok: true });
  }),
);

function getSession(id) {
  return db
    .prepare(
      `
        SELECT
          s.*,
          i.name AS instrument_name,
          p.name AS playbook_name,
          COALESCE(SUM(CASE WHEN t.exit_timestamp IS NOT NULL THEN t.net_pnl ELSE 0 END), 0) AS pnl,
          SUM(CASE WHEN t.exit_timestamp IS NOT NULL THEN 1 ELSE 0 END) AS trade_count,
          COALESCE(
            1.0 * SUM(CASE WHEN t.exit_timestamp IS NOT NULL AND t.net_pnl > 0 THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN t.exit_timestamp IS NOT NULL THEN 1 ELSE 0 END), 0),
            0
          ) AS win_rate
        FROM sessions s
        JOIN instruments i ON i.id = s.instrument_id
        LEFT JOIN playbooks p ON p.id = s.playbook_id
        LEFT JOIN trades t ON t.session_id = s.id
        WHERE s.id = ?
        GROUP BY s.id
      `,
    )
    .get(id);
}

export default router;
