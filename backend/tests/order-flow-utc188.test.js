import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Exercise the actual route's pure selection/clock logic. Network access is
// unused and isolated; browser timezone is varied without changing its data.
const bundle = (await build({ bundle: true, format: "cjs", platform: "node", write: false,
  external: ["react", "lucide-react"], logLevel: "silent", jsx: "automatic",
  plugins: [{ name: "order-flow-api-isolation", setup(api) {
    api.onResolve({ filter: /^@\/lib\/marketInfrastructure$/ }, () => ({ path: "api", namespace: "isolated188" }));
    api.onLoad({ filter: /.*/, namespace: "isolated188" }, () => ({ contents:
      'export const listMarketFootprints=()=>{throw Error("Unexpected network");};export const listMarketInstruments=listMarketFootprints;' }));
  } }], stdin: { loader: "ts", resolveDir: process.cwd(), contents:
    'export {orderFlowUtcTimestamp,latestOrderFlowFootprint} from "./frontend/src/components/OrderFlowWorkspace.tsx";' },
})).outputFiles[0].text;
const module = { exports: {} };
new Function("require", "module", "exports", bundle)(createRequire(new URL("../../frontend/package.json", import.meta.url)), module, module.exports);
const { orderFlowUtcTimestamp: parse, latestOrderFlowFootprint: latest } = module.exports;
const row = (end, start = "2026-10-10T00:25:00") => ({ start_at: start, end_at: end });

test("UTC-naive API footprints remain fresh across browser timezones and preserve explicit offsets", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Asia/Calcutta", "America/Los_Angeles", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(parse("2026-10-10T00:26:00"), Date.parse("2026-10-10T00:26:00Z"), zone);
      assert.equal(parse("2026-10-10T05:56:00+05:30"), Date.parse("2026-10-10T00:26:00Z"), zone);
      assert.equal(parse("2026-10-10T00:26:00.123456"), Date.parse("2026-10-10T00:26:00.123Z"));
      const footprint = row("2026-10-10T00:26:00");
      assert.deepEqual(latest([footprint], Date.parse("2026-10-10T00:35:00Z")), { footprint, stale: false }, zone);
      assert.equal(latest([footprint], Date.parse("2026-10-10T00:36:00Z")).stale, false);
      assert.equal(latest([footprint], Date.parse("2026-10-10T00:36:00.001Z")).stale, true);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("latest footprint selection compares instants rather than local or textual clock order", () => {
  const older = row("2026-10-10T06:05:00+06:00", "2026-10-10T06:04:00+06:00");
  const newer = row("2026-10-10T00:26:00");
  assert.equal(latest([older, newer], Date.parse("2026-10-10T00:27:00Z")).footprint, newer);
  assert.equal(latest([newer, older], Date.parse("2026-10-10T00:27:00Z")).footprint, newer);
  assert.equal(latest([], Date.now()).footprint, null);
});

test("malformed, impossible or reversed timestamps fail closed instead of showing current data", () => {
  for (const value of [null, 42, "", "2026-02-30T00:26:00", "2026-13-10T00:26:00",
    "2026-10-10T24:26:00", "2026-10-10T00:60:00", "2026-10-10T00:26:60",
    "2026-10-10T00:26:00+99:00", "2026-10-10T00:26:00junk", "2026-10-10"]) {
    assert.equal(parse(value), undefined, String(value));
    assert.throws(() => latest([row(value)], Date.now()), /invalid UTC timestamp/);
  }
  assert.throws(() => latest([row("2026-10-10T00:26:00", "invalid")], Date.now()), /invalid UTC timestamp/);
  assert.throws(() => latest([row("2026-10-10T00:26:00", "2026-10-10T00:26:00Z")], Date.now()), /invalid UTC timestamp/);
  assert.equal(parse("2024-02-29T00:00:00"), Date.parse("2024-02-29T00:00:00Z"));
  assert.equal(parse("2026-02-29T00:00:00"), undefined);
  assert.equal(latest([row("2026-10-10T00:26:00")], NaN).stale, true);
});
