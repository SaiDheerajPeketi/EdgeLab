import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath, initDb } from "./db.js";
import analyticsRouter from "./routes/analytics.js";
import drawingsRouter from "./routes/drawings.js";
import instrumentsRouter from "./routes/instruments.js";
import playbooksRouter from "./routes/playbooks.js";
import sessionsRouter from "./routes/sessions.js";
import tradesRouter from "./routes/trades.js";
import { createApp } from "./utils/miniExpress.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });
initDb();

const app = createApp();
const port = Number(process.env.PORT ?? 3001);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    stack: "express-sqlite",
    db: dbPath,
    time: new Date().toISOString(),
  });
});

app.use("/api/instruments", instrumentsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/trades", tradesRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/playbooks", playbooksRouter);
app.use("/api/drawings", drawingsRouter);

app.listen(port, () => {
  console.log(`Trade journal API listening on http://127.0.0.1:${port}`);
});
