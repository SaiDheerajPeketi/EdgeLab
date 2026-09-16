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
  assert.equal(result.gaps.length, 18);
  assert.ok(result.gaps.includes("route:/app/live:empty: Live empty-state baseline has not been captured."));
  assert.ok(result.gaps.includes("route:/app/live:skeleton: Live skeleton baseline has not been captured."));
  assert.ok(result.gaps.some((gap) => gap.startsWith("panel:Journal:default:")));
  assert.ok(result.gaps.some((gap) => gap.startsWith("overlay:command palette:open:")));
});

test("panel evidence resolves an authoritative source, spec, and exact snapshot", () => {
  const fixture = fixtureInputs();
  fixture.visualEvidence.panels.Journal.states.default = {
    viewports: ["mobile"],
    evidence: { mobile: structuredClone(fixture.visualEvidence.routes["/pricing"].default.mobile) },
  };
  assert.deepEqual(validateUiSurfaceInventory(fixture).errors, []);
});

test("surface inventory validator rejects omitted evidence contracts", async (t) => {
  const cases = [
    {
      name: "missing panel visual evidence",
      mutate(fixture) {
        delete fixture.visualEvidence.panels.Journal;
      },
      expected: /Panel visual-evidence keys must exactly match/,
    },
    {
      name: "fabricated overlay visual evidence",
      mutate(fixture) {
        fixture.visualEvidence.overlays.fabricated = { states: { open: { viewports: ["mobile"], gap: "not real" } } };
      },
      expected: /Overlay visual-evidence keys must exactly match/,
    },
    {
      name: "surface viewport applicability",
      mutate(fixture) {
        fixture.visualEvidence.panels.Journal.states.default.viewports = ["watch"];
      },
      expected: /Panel "Journal" state "default" references unknown viewport "watch"/,
    },
    {
      name: "surface evidence missing spec",
      mutate(fixture) {
        fixture.visualEvidence.panels.Journal.states.default = {
          viewports: ["mobile"],
          evidence: { mobile: { spec: "e2e/does-not-exist.spec.ts", snapshot: "journal.png", captureMode: "element" } },
        };
      },
      expected: /Panel "Journal" state "default" references missing spec/,
    },
    {
      name: "surface evidence missing exact snapshot",
      mutate(fixture) {
        fixture.visualEvidence.panels.Journal.states.default = {
          viewports: ["mobile"],
          evidence: { mobile: { spec: "e2e/public-auth.visual.spec.ts", snapshot: "missing-panel.png", captureMode: "element" } },
        };
      },
      expected: /Panel "Journal" state "default" is missing exact mobile snapshot "missing-panel\.png"/,
    },
    {
      name: "surface exemption contract",
      mutate(fixture) {
        delete fixture.visualEvidence.overlays.toast.states.transient.exemption.source;
      },
      expected: /exemption must declare an allowed kind, nonblank reason, and source/,
    },
    {
      name: "fabricated panel state",
      mutate(fixture) {
        fixture.visualEvidence.panels.Journal.states.fabricated = { viewports: ["mobile"], gap: "not real" };
      },
      expected: /Panel "Journal" evidence states must exactly match its intended-state catalog/,
    },
    {
      name: "omitted overlay state",
      mutate(fixture) {
        delete fixture.visualEvidence.overlays.toast.states.transient;
      },
      expected: /Overlay "toast" evidence states must exactly match its intended-state catalog/,
    },
    {
      name: "non-authoritative exemption source",
      mutate(fixture) {
        fixture.visualEvidence.overlays.toast.states.transient.exemption.source = "frontend/src/App.tsx";
      },
      expected: /exemption source is not authoritative for toast/,
    },
    {
      name: "route state gap parity",
      mutate(fixture) {
        fixture.visualEvidence.routeGaps["/app/live"].fabricated = "not real";
      },
      expected: /Route-state gap references undeclared state "fabricated"/,
    },
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
      name: "route-owned state evidence",
      mutate(fixture) {
        fixture.visualEvidence.routes["/"]["dev-bypass-error"] =
          fixture.visualEvidence.routes["/auth/signin"]["dev-bypass-error"];
      },
      expected: /Route "\/" evidence uses undeclared state "dev-bypass-error"/,
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

test("strict completion mode precisely rejects recorded evidence gaps", () => {
  assert.throws(
    () => runUiSurfaceInventoryCheck({ requireComplete: true, root }),
    /panel:Journal:default:[\s\S]*overlay:command palette:open:[\s\S]*route:\/app\/live:empty:[\s\S]*route:\/app\/live:skeleton:/,
  );
});
