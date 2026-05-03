import { db } from "../db.js";
import { asOptionalText, asyncHandler } from "../utils/http.js";
import { createRouter } from "../utils/miniExpress.js";

const router = createRouter();

router.post(
  "/",
  asyncHandler((req, res) => {
    const name = asOptionalText(req.body.name).trim();
    if (!name) {
      res.status(400).json({ error: "invalid_name", message: "Playbook name is required." });
      return;
    }

    const result = db
      .prepare(
        `
          INSERT INTO playbooks
            (name, description, entry_rules, exit_rules, risk_rules, tags, notes)
          VALUES
            (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        name,
        asOptionalText(req.body.description),
        asOptionalText(req.body.entry_rules),
        asOptionalText(req.body.exit_rules),
        asOptionalText(req.body.risk_rules),
        asOptionalText(req.body.tags),
        asOptionalText(req.body.notes),
      );

    res.status(201).json({ playbook: getPlaybook(Number(result.lastInsertRowid)) });
  }),
);

router.get(
  "/",
  asyncHandler((_req, res) => {
    const playbooks = db
      .prepare("SELECT * FROM playbooks ORDER BY updated_at DESC, created_at DESC, id DESC")
      .all();
    res.json({ playbooks });
  }),
);

router.patch(
  "/:id",
  asyncHandler((req, res) => {
    const existing = getPlaybook(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not_found", message: "Playbook not found." });
      return;
    }

    db.prepare(
      `
        UPDATE playbooks
        SET name = ?,
            description = ?,
            entry_rules = ?,
            exit_rules = ?,
            risk_rules = ?,
            tags = ?,
            notes = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `,
    ).run(
      req.body.name ?? existing.name,
      req.body.description ?? existing.description,
      req.body.entry_rules ?? existing.entry_rules,
      req.body.exit_rules ?? existing.exit_rules,
      req.body.risk_rules ?? existing.risk_rules,
      req.body.tags ?? existing.tags,
      req.body.notes ?? existing.notes,
      req.params.id,
    );

    res.json({ playbook: getPlaybook(req.params.id) });
  }),
);

router.delete(
  "/:id",
  asyncHandler((req, res) => {
    const result = db.prepare("DELETE FROM playbooks WHERE id = ?").run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found", message: "Playbook not found." });
      return;
    }
    res.json({ ok: true });
  }),
);

function getPlaybook(id) {
  return db.prepare("SELECT * FROM playbooks WHERE id = ?").get(id);
}

export default router;
