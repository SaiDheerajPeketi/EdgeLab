import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, mapInstrument } from "../db.js";
import { streamCsvCandles } from "../utils/csvParser.js";
import { asyncHandler, asOptionalText, toNumber } from "../utils/http.js";
import { createRouter } from "../utils/miniExpress.js";
import { normalizeTimeframe, resampleCandles, timeframeToMs } from "../utils/resample.js";
import { resolveCsvUpload } from "../utils/upload.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "..", "uploads");

const router = createRouter();

router.post(
  "/upload",
  asyncHandler(async (req, res) => {
    const uploaded = await resolveCsvUpload(req, uploadsDir);

    const originalName = uploaded.originalname || "instrument.csv";
    const name = asOptionalText(req.body.name, path.basename(originalName, path.extname(originalName)));
    const insertInstrument = db.prepare(`
      INSERT INTO instruments (name, filename)
      VALUES (?, ?)
    `);
    const instrumentId = Number(insertInstrument.run(name, originalName).lastInsertRowid);

    const insertCandle = db.prepare(`
      INSERT OR REPLACE INTO candles
        (instrument_id, timestamp, open, high, low, close, volume)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBatch = db.transaction((candles) => {
      for (const candle of candles) {
        insertCandle.run(
          instrumentId,
          candle.timestamp,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
        );
      }
    });

    try {
      const stats = await streamCsvCandles(uploaded.path, insertBatch);
      if (stats.candle_count === 0) {
        throw new Error("CSV did not contain any valid candles.");
      }

      db.prepare(`
        UPDATE instruments
        SET candle_count = ?, timeframe_detected = ?, first_timestamp = ?, last_timestamp = ?
        WHERE id = ?
      `).run(
        stats.candle_count,
        stats.timeframe_detected,
        stats.first_timestamp,
        stats.last_timestamp,
        instrumentId,
      );

      const instrument = db.prepare("SELECT * FROM instruments WHERE id = ?").get(instrumentId);
      res.status(201).json({
        instrument: mapInstrument(instrument),
        preview: {
          name,
          date_range: {
            from: stats.first_timestamp,
            to: stats.last_timestamp,
          },
          candle_count: stats.candle_count,
          timeframe_detected: stats.timeframe_detected,
          sample: stats.sample,
        },
      });
    } catch (error) {
      db.prepare("DELETE FROM instruments WHERE id = ?").run(instrumentId);
      throw error;
    } finally {
      if (uploaded.cleanup) {
        await fs.unlink(uploaded.path).catch(() => {});
      }
    }
  }),
);

router.get(
  "/",
  asyncHandler((_req, res) => {
    const rows = db.prepare("SELECT * FROM instruments ORDER BY uploaded_at DESC, id DESC").all();
    res.json({ instruments: rows.map(mapInstrument) });
  }),
);

router.patch(
  "/:id",
  asyncHandler((req, res) => {
    const name = asOptionalText(req.body.name).trim();
    if (!name) {
      res.status(400).json({ error: "invalid_name", message: "Instrument name is required." });
      return;
    }

    const result = db.prepare("UPDATE instruments SET name = ? WHERE id = ?").run(name, req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found", message: "Instrument not found." });
      return;
    }

    const row = db.prepare("SELECT * FROM instruments WHERE id = ?").get(req.params.id);
    res.json({ instrument: mapInstrument(row) });
  }),
);

router.get(
  "/:id/candles",
  asyncHandler((req, res) => {
    const instrument = db.prepare("SELECT * FROM instruments WHERE id = ?").get(req.params.id);
    if (!instrument) {
      res.status(404).json({ error: "not_found", message: "Instrument not found." });
      return;
    }

    const timeframe = normalizeTimeframe(req.query.timeframe ?? instrument.timeframe_detected ?? "1m");
    const from = toNumber(req.query.from);
    const to = toNumber(req.query.to);
    const limit = Math.min(toNumber(req.query.limit, 5000), 100000);
    const bucketMs = timeframeToMs(timeframe);
    const rawLimit = timeframe === "1m" ? limit : Math.min(limit * Math.ceil(bucketMs / 60_000) + 500, 250000);

    const conditions = ["instrument_id = ?"];
    const params = [req.params.id];
    if (from !== null) {
      conditions.push("timestamp >= ?");
      params.push(from);
    }
    if (to !== null) {
      conditions.push("timestamp <= ?");
      params.push(to);
    }

    const rows = db
      .prepare(
        `
          SELECT timestamp, open, high, low, close, volume
          FROM candles
          WHERE ${conditions.join(" AND ")}
          ORDER BY timestamp ASC
          LIMIT ?
        `,
      )
      .all(...params, rawLimit);

    const candles = resampleCandles(rows, timeframe).slice(0, limit);
    res.json({
      instrument: mapInstrument(instrument),
      timeframe,
      candles,
    });
  }),
);

router.delete(
  "/:id",
  asyncHandler((req, res) => {
    const result = db.prepare("DELETE FROM instruments WHERE id = ?").run(req.params.id);
    if (result.changes === 0) {
      res.status(404).json({ error: "not_found", message: "Instrument not found." });
      return;
    }
    res.json({ ok: true });
  }),
);

export default router;
