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

function fixtureInputs() {
  return {
    ...inputs,
    foundationContracts: structuredClone(inputs.foundationContracts),
    inventory: structuredClone(inputs.inventory),
    releaseMatrix: structuredClone(inputs.releaseMatrix),
    visualEvidence: structuredClone(inputs.visualEvidence),
  };
}

test("surface inventory matches routes, decisions, responsive widths, sources, and stored baselines", () => {
  const result = validateUiSurfaceInventory(fixtureInputs());
  assert.deepEqual(result.errors, []);
  assert.equal(result.stats.inventoriedRoutes, result.stats.discoveredRoutes);
  assert.ok(result.gaps.some((gap) => gap.startsWith("viewport:tradingDesktop:")));
  assert.ok(result.gaps.some((gap) => gap.startsWith("route:/app/order-flow:")));
  assert.ok(result.gaps.some((gap) => gap.startsWith("assertion:safe-area:")));
});

test("surface inventory validator rejects omitted evidence contracts", async (t) => {
  const cases = [
    {
      name: "missing route",
      mutate(fixture) {
        fixture.inventory.routes = fixture.inventory.routes.filter((route) => route.path !== "/app/order-flow");
      },
      expected: /Route definition is missing from the surface inventory: \/app\/order-flow/,
    },
    {
      name: "fabricated route",
      mutate(fixture) {
        fixture.inventory.routes.push({
          path: "/fabricated",
          surface: "Fabricated",
          auth: false,
          disposition: "retain",
          responsiveWidths: ["mobile", "tablet", "desktop"],
          states: ["default"],
          criticalStates: ["default"],
        });
      },
      expected: /Inventory route has no authoritative route definition: \/fabricated/,
    },
    {
      name: "authoritative panel omission",
      mutate(fixture) {
        fixture.inventory.panels = fixture.inventory.panels.filter((name) => name !== "Order Book");
        delete fixture.inventory.panelDispositions["Order Book"];
      },
      expected: /Panel source-evidence keys must exactly match/,
    },
    {
      name: "authoritative overlay omission",
      mutate(fixture) {
        fixture.inventory.overlays = fixture.inventory.overlays.filter((name) => name !== "command palette");
        delete fixture.inventory.overlayDispositions["command palette"];
      },
      expected: /Overlay source-evidence keys must exactly match/,
    },
    {
      name: "foundation route parity",
      mutate(fixture) {
        delete fixture.foundationContracts.routes["/pricing"];
      },
      expected: /Foundation route keys must exactly match/,
    },
    {
      name: "foundation route source",
      mutate(fixture) {
        fixture.foundationContracts.routes["/pricing"].source = "frontend/src/pages/DoesNotExist.tsx";
      },
      expected: /Foundation route "\/pricing" has a missing source/,
    },
    {
      name: "responsive width",
      mutate(fixture) {
        fixture.inventory.routes.find((route) => route.path === "/app/live").responsiveWidths =
          ["tablet", "desktop", "tradingDesktop"];
      },
      expected: /Route "\/app\/live" is missing the mobile responsive width/,
    },
    {
      name: "viewport dimensions and zoom",
      mutate(fixture) {
        fixture.inventory.viewportBaselines.mobile.height = 800;
        fixture.inventory.viewportBaselines.mobile.zoom = 2;
      },
      expected: /Playwright "mobile" uses 844[\s\S]*Playwright "mobile" uses 1/,
    },
    {
      name: "critical states",
      mutate(fixture) {
        fixture.inventory.routes.find((route) => route.path === "/shared").criticalStates = [];
      },
      expected: /Route "\/shared" has no critical-state decision/,
    },
    {
      name: "exact project snapshot",
      mutate(fixture) {
        fixture.visualEvidence.routes["/pricing"].default.mobile.snapshot = "pricing-does-not-exist.png";
      },
      expected: /missing exact mobile snapshot "pricing-does-not-exist\.png"/,
    },
    {
      name: "state viewport applicability",
      mutate(fixture) {
        fixture.visualEvidence.routes["/"]["mobile-menu"].tablet = {
          spec: "e2e/public-critical.states.visual.spec.ts",
          snapshot: "landing-mobile-menu.png",
          captureMode: "viewport",
        };
      },
      expected: /state "mobile-menu" uses project "tablet" outside its applicable viewport contract/,
    },
    {
      name: "state viewport schema",
      mutate(fixture) {
        fixture.inventory.routes.find((route) => route.path === "/").stateViewports["mobile-menu"] = ["watch"];
      },
      expected: /state "mobile-menu" references inapplicable viewport "watch"/,
    },
    {
      name: "ambiguous capture semantics",
      mutate(fixture) {
        delete fixture.visualEvidence.routes["/pricing"].annual.mobile.captureMode;
      },
      expected: /state "annual" mobile evidence has ambiguous capture semantics/,
    },
    {
      name: "capture mode",
      mutate(fixture) {
        fixture.visualEvidence.routes["/app"].error.mobile.captureMode = "cropped";
      },
      expected: /uses unsupported capture mode "cropped"/,
    },
    {
      name: "viewport snapshot dimensions",
      mutate(fixture) {
        fixture.inventory.viewportBaselines.mobile.height = 843;
      },
      expected: /mobile viewport capture is 390x844; expected 390x843/,
    },
    {
      name: "assertion evidence",
      mutate(fixture) {
        delete fixture.visualEvidence.assertions["zoom-200"];
      },
      expected: /Required assertion "zoom-200" has no executable evidence/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const candidate = fixtureInputs();
      fixture.mutate(candidate);
      assert.match(validateUiSurfaceInventory(candidate).errors.join("\n"), fixture.expected);
    });
  }
});

test("strict completion mode keeps UIR-01 open while recorded gaps remain", () => {
  assert.throws(
    () => runUiSurfaceInventoryCheck({ requireComplete: true, root }),
    /structurally valid but incomplete/,
  );
});
