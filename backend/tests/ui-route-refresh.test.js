import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("landing demo exposes the full, honestly labelled workflow", () => {
  const source = read("frontend/src/components/marketing/HeroDemo.tsx");
  assert.match(source, /Explore the trading workspace\./);
  assert.match(source, /Illustrative market data/);
  assert.match(source, /id: "replay",\s*label: "Replay"/);
  assert.match(source, /Journal \+ review/);
  assert.match(source, /aria-current=\{item\.id === selectedScenarioId \? "step"/);
});

test("session gateway makes resume primary and progressively discloses history", () => {
  const source = read("frontend/src/components/SessionGateway.tsx");
  assert.match(source, /Resume latest session/);
  assert.match(source, /Use sample setup/);
  assert.match(source, /Market data required/);
  assert.match(source, /aria-expanded=\{showHistory\}/);
  assert.match(source, /scrollIntoView/);
});
