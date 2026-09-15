import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("market tools expose depth controls, provider states, and optional alert channels", () => {
  const source = fs.readFileSync(path.join(root, "frontend/src/components/chart/MarketToolsPanels.tsx"), "utf8");
  for (const contract of ["Aggregate ticks", "Depth", "ENTITLEMENT_REQUIRED", "STALE", "Browser on", "Enable browser", "Test sound", "Notification.requestPermission", "playAlertTone"]) {
    assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("journal account UI configures shipped providers without exposing credentials", () => {
  const source = fs.readFileSync(path.join(root, "frontend/src/components/journal/JournalAccountsSurface.tsx"), "utf8");
  for (const contract of ["access_token", "api_key", "fixture_token", "Connect and sync", "discovered accounts", "type=\"password\""]) {
    assert.match(source.toLowerCase(), new RegExp(contract.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
