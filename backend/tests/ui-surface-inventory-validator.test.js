import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadUiSurfaceInventoryInputs,
  runUiSurfaceInventoryCheck,
  validateUiSurfaceInventory,
} from "../../scripts/check-ui-surface-inventory.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const inputs = loadUiSurfaceInventoryInputs(root);

function validateWithInventory(inventory) {
  return validateUiSurfaceInventory({ ...inputs, inventory });
}

test("surface inventory matches routes, decisions, responsive widths, sources, and stored baselines", () => {
  const result = validateWithInventory(structuredClone(inputs.inventory));
  assert.deepEqual(result.errors, []);
  assert.ok(result.stats.inventoriedRoutes >= result.stats.discoveredRoutes);
  assert.ok(result.gaps.some((gap) => gap.startsWith("viewport:tradingDesktop:")));
  assert.ok(result.gaps.some((gap) => gap.startsWith("route:/app/order-flow:")));
});

test("surface inventory validator rejects omitted evidence contracts", async (t) => {
  const cases = [
    {
      name: "route",
      mutate(inventory) {
        inventory.routes = inventory.routes.filter((route) => route.path !== "/app/order-flow");
      },
      expected: /Route definition is missing from the surface inventory: \/app\/order-flow/,
    },
    {
      name: "surface decision",
      mutate(inventory) {
        delete inventory.overlayDispositions["command palette"];
      },
      expected: /Overlay disposition keys must exactly match/,
    },
    {
      name: "responsive width",
      mutate(inventory) {
        inventory.routes.find((route) => route.path === "/app/live").responsiveWidths =
          ["tablet", "desktop", "tradingDesktop"];
      },
      expected: /Route "\/app\/live" is missing the mobile responsive width/,
    },
    {
      name: "critical states",
      mutate(inventory) {
        inventory.routes.find((route) => route.path === "/shared").criticalStates = [];
      },
      expected: /Route "\/shared" has no critical-state decision/,
    },
    {
      name: "claimed screenshot",
      mutate(inventory) {
        inventory.visualCoverage.baselines["/pricing"].push("pricing-does-not-exist");
      },
      expected: /claims missing snapshot "pricing-does-not-exist\.png"/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const inventory = structuredClone(inputs.inventory);
      fixture.mutate(inventory);
      assert.match(validateWithInventory(inventory).errors.join("\n"), fixture.expected);
    });
  }
});

test("strict completion mode keeps UIR-01 open while recorded gaps remain", () => {
  assert.throws(
    () => runUiSurfaceInventoryCheck({ requireComplete: true, root }),
    /structurally valid but incomplete/,
  );
});
