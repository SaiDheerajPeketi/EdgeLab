import { db, parseJson } from "../db.js";
import { asOptionalText, asyncHandler, requireNumber } from "../utils/http.js";
import { createRouter } from "../utils/miniExpress.js";

const router = createRouter();

router.post(
  "/",
  asyncHandler((req, res) => {
    const sessionId = requireNumber(req.body.session_id, "session_id");
    const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
    if (!session) {
      res.status(400).json({ error: "invalid_session", message: "Session does not exist." });
      return;
    }

    const type = asOptionalText(req.body.type).trim();
    if (!type) {
      res.status(400).json({ error: "invalid_type", message: "Drawing type is required." });
      return;
    }

    const result = db
      .prepare(
        `
          INSERT INTO drawings (session_id, type, points, color, style, label)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        sessionId,
        type,
        JSON.stringify(req.body.points ?? []),
        asOptionalText(req.body.color, "#60a5fa"),
        asOptionalText(req.body.style, "solid"),
        asOptionalText(req.body.label),
      );

    res.status(201).json({ drawing: getDrawing(Number(result.lastInsertRowid)) });
  }),
);

router.get(
  "/",
  asyncHandler((req, res) => {
    const sessionId = requireNumber(req.query.session_id, "session_id");
    const drawings = db
      .prepare("SELECT * FROM drawings WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId)
      .map(mapDrawing);
    res.json({ drawings });
  }),
);

router.patch(
  "/:id",
  asyncHandler((req, res) => {
    const existing = getDrawing(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Drawing not found." });
      return;
    }

    db.prepare(
      `
        UPDATE drawings
        SET type = ?,
            points = ?,
            color = ?,
            style = ?,
            label = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `,
    ).run(
      req.body.type ?? existing.type,
      JSON.stringify(req.body.points ?? existing.points),
      req.body.color ?? existing.color,
      req.body.style ?? existing.style,
      req.body.label ?? existing.label,
      req.params.id,
    );

    res.json({ drawing: getDrawing(req.params.id) });
  }),
);

router.delete(
  "/:id",
  asyncHandler((req, res) => {
    const result = db.prepare("DELETE FROM drawings WHERE id = ?").run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found", message: "Drawing not found." });
      return;
    }
    res.json({ ok: true });
  }),
);

function getDrawing(id) {
  const row = db.prepare("SELECT * FROM drawings WHERE id = ?").get(id);
  return mapDrawing(row);
}

function mapDrawing(row) {
  if (!row) return null;
  return {
    ...row,
    points: parseJson(row.points, []),
  };
}

export default router;
