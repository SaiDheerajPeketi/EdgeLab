import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const COMPONENTS = path.join(REPO_ROOT, "frontend", "src", "components");

function readComponent(relativePath) {
  return fs.readFileSync(path.join(COMPONENTS, relativePath), "utf8");
}

async function loadOverlayGeometry() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-overlays-"));
  const output = path.join(tempDir, "overlay.mjs");
  buildSync({
    bundle: true,
    entryPoints: [path.join(COMPONENTS, "overlays", "OverlaySurface.tsx")],
    format: "esm",
    outfile: output,
    platform: "node",
  });
  return {
    cleanup: () => fs.rmSync(tempDir, { force: true, recursive: true }),
    module: await import(pathToFileURL(output).href),
  };
}

test("overlay geometry stays visible at 390px and 200 percent zoom", async () => {
  const { cleanup, module } = await loadOverlayGeometry();
  try {
    const geometry = module.computeOverlayGeometry({
      align: "left",
      anchor: { bottom: 120, left: 170, right: 210, top: 80, width: 40 },
      gap: 8,
      measuredHeight: 320,
      minWidth: 180,
      preferredWidth: 320,
      viewport: { height: 320, left: 0, top: 0, width: 195 },
    });

    assert.equal(geometry.width, 179);
    assert.ok(geometry.left >= 8);
    assert.ok(geometry.left + geometry.width <= 187);
    assert.ok(geometry.top >= 8);
    assert.ok(geometry.top + geometry.maxHeight <= 312);
  } finally {
    cleanup();
  }
});

test("overlay geometry flips above its anchor when that side has more room", async () => {
  const { cleanup, module } = await loadOverlayGeometry();
  try {
    const geometry = module.computeOverlayGeometry({
      align: "right",
      anchor: { bottom: 590, left: 300, right: 380, top: 550, width: 80 },
      gap: 8,
      measuredHeight: 260,
      minWidth: 180,
      preferredWidth: 240,
      viewport: { height: 600, left: 0, top: 0, width: 390 },
    });

    assert.equal(geometry.placement, "above");
    assert.equal(geometry.left, 140);
    assert.ok(geometry.top + Math.min(260, geometry.maxHeight) <= 542);
  } finally {
    cleanup();
  }
});

test("all pickers use the shared dismissal and focus-safe overlay surface", () => {
  for (const file of ["ThemedSelect.tsx", "ThemedDatePicker.tsx", "ThemedColorPicker.tsx"]) {
    const source = readComponent(file);
    assert.match(source, /import \{ OverlaySurface \}/);
    assert.match(source, /<OverlaySurface/);
    assert.match(source, /motion-reduce:transition-none/);
    assert.match(source, /pointer:coarse/);
  }

  const dismiss = readComponent("overlays/useOverlayDismiss.ts");
  assert.match(dismiss, /overlayStack/);
  assert.match(dismiss, /event\.stopPropagation\(\)/);
  assert.match(dismiss, /"pointerdown", handlePointerDown, true/);
  assert.match(dismiss, /"focusin", handleFocusIn, true/);
  assert.match(dismiss, /event\.key === "Escape"/);
});

test("picker-specific keyboard and validation contracts remain explicit", () => {
  const select = readComponent("ThemedSelect.tsx");
  assert.match(select, /role="combobox"/);
  assert.match(select, /role="listbox"/);
  assert.match(select, /aria-activedescendant/);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]) {
    assert.match(select, new RegExp(`event\\.key === "${key}"|case "${key}"`));
  }
  assert.match(select, /findTypeaheadMatch/);
  assert.match(select, /onClick=\{handleTriggerClick\}/);
  assert.match(select, /event\.key === "Tab"/);
  assert.match(select, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.doesNotMatch(select, /onPointerDown=\{handleTriggerPointerDown\}/);

  const date = readComponent("ThemedDatePicker.tsx");
  assert.match(date, /role="grid"/);
  assert.match(date, /role="row"/);
  assert.match(date, /handleYearKeyDown/);
  assert.match(date, /tabIndex=\{year === focusedYear \? 0 : -1\}/);
  assert.match(date, /aria-live="polite"/);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]) {
    assert.match(date, new RegExp(`case "${key}"`));
  }

  const color = readComponent("ThemedColorPicker.tsx");
  assert.match(color, /type="range"/);
  assert.match(color, /aria-invalid/);
  assert.match(color, /3- or 6-digit hex color/);
  assert.match(color, /<output/);
  assert.match(color, /popoverHexRef\.current\?\.focus/);
});

test("nested overlays own Escape before their parent modal", () => {
  const primitives = readComponent("ui/Primitives.tsx");
  assert.match(primitives, /shouldDismissModalOnEscape\(event, document\)/);
  assert.match(primitives, /!event\.defaultPrevented/);
  assert.match(primitives, /!hasActiveOverlay\(ownerDocument\)/);
  assert.doesNotMatch(primitives, /dataset\.overlayActive !== "true"/);
  assert.match(primitives, /blocksModalEscape=\{false\}[\s\S]*?role="tooltip"/);

  const dismiss = readComponent("overlays/useOverlayDismiss.ts");
  assert.match(dismiss, /export function hasActiveOverlay/);
  assert.match(dismiss, /entry\.ownerDocument === ownerDocument/);
  assert.match(dismiss, /entry\.blocksModalEscape/);
  assert.match(dismiss, /if \(!isTopOverlay\(id, ownerDocument\)\)/);
  assert.match(dismiss, /event\.preventDefault\(\);\s*onDismissRef\.current\("escape"\)/);
});

test("modal focus restoration survives callback-only rerenders", () => {
  const primitives = readComponent("ui/Primitives.tsx");
  assert.match(primitives, /const onCloseRef = useRef\(onClose\)/);
  assert.match(primitives, /onCloseRef\.current = onClose/);
  assert.match(primitives, /onCloseRef\.current\(\)/);
  assert.match(primitives, /window\.cancelAnimationFrame\(focusFrame\)/);
  assert.match(primitives, /previous\?\.isConnected\) previous\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(primitives, /\[dismissBlocked, initialFocusRef, onClose\]/);
});

test("replay date picker enters and restores the keyboard focus path", () => {
  const replay = readComponent("ReplayController.tsx");
  assert.match(replay, /import \{ OverlaySurface \}/);
  assert.match(replay, /aria-haspopup="dialog"/);
  assert.match(replay, /aria-controls=\{popoverId\}/);
  assert.match(replay, /data-replay-picker-initial-focus/);
  assert.match(replay, /querySelector<HTMLElement>\("\[data-replay-picker-initial-focus\]"\)\?\.focus\(\)/);
  assert.match(replay, /triggerRef=\{triggerRef\}/);
});

test("conditionally mounted chart overlays restore focus to a real trigger", () => {
  const focusReturn = readComponent("overlays/useFocusReturn.ts");
  assert.match(focusReturn, /return \(\) => \{/);
  assert.match(focusReturn, /requestAnimationFrame\(\(\) => \{/);
  assert.match(focusReturn, /trigger\?\.isConnected && trigger\.tabIndex >= 0/);
  assert.match(focusReturn, /previousFocus\?\.isConnected && previousFocus\.tabIndex >= 0/);

  const toolbar = readComponent("ChartToolbar.tsx");
  assert.match(toolbar, /triggerRef=\{commandInputRef\}/);
  assert.match(toolbar, /triggerRef=\{settingsTriggerRef\}/);
  assert.match(toolbar, /ref=\{settingsTriggerRef\}/);
});

test("chart command search exposes a labelled dialog and keyboard result navigation", () => {
  const toolbar = readComponent("ChartToolbar.tsx");
  for (const contract of [
    /aria-controls=\{commandMenuId\}/,
    /aria-expanded=\{commandOpen\}/,
    /aria-haspopup="dialog"/,
    /aria-label="Search chart commands"/,
    /role="dialog" ariaLabel="Chart command search results"/,
    /data-chart-command-result="true"/,
    /handleCommandInputKeyDown/,
    /handleCommandSurfaceKeyDown/,
  ]) assert.match(toolbar, contract);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    assert.match(toolbar, new RegExp(`event\\.key === "${key}"|\\[.*"${key}"`));
  }
  assert.doesNotMatch(toolbar, /role="listbox" ariaLabel="Chart command search"/);
});

test("mobile sheet geometry fills the visual viewport and tracks keyboard shrink and offsets", async () => {
  const { cleanup, module } = await loadOverlayGeometry();
  try {
    const base = {
      align: "left",
      anchor: { bottom: 445, left: 25, right: 153, top: 400, width: 128 },
      gap: 8,
      measuredHeight: 680,
      minWidth: 320,
      mobileSheet: true,
      preferredWidth: 760,
    };
    assert.deepEqual(module.computeOverlayGeometry({
      ...base,
      viewport: { height: 844, left: 0, top: 0, width: 390 },
    }), { left: 8, maxHeight: 828, placement: "below", top: 8, width: 374 });
    assert.deepEqual(module.computeOverlayGeometry({
      ...base,
      viewport: { height: 400, left: 14, top: 240, width: 320 },
    }), { left: 22, maxHeight: 384, placement: "below", top: 248, width: 304 });
    const desktop = {
      ...base,
      viewport: { height: 1_000, left: 0, top: 0, width: 1_440 },
    };
    assert.deepEqual(
      module.computeOverlayGeometry(desktop),
      module.computeOverlayGeometry({ ...desktop, mobileSheet: false }),
    );
  } finally {
    cleanup();
  }
});


test("resizing or scrolling an anchor outside the viewport keeps the entire popup visible", async () => {
  const { cleanup, module } = await loadOverlayGeometry();
  try {
    for (const viewport of [
      { height: 640, left: 0, top: 0, width: 360 },
      { height: 320, left: 14, top: 240, width: 195 },
    ]) for (const top of [-800, 1_500]) {
      const geometry = module.computeOverlayGeometry({
        align: "left", gap: 8, measuredHeight: 1_000, minWidth: 180,
        anchor: { top, bottom: top + 44, left: 320, right: 672, width: 352 },
        viewport,
      });
      assert.ok(geometry.maxHeight <= viewport.height - 16);
      assert.ok(geometry.top >= viewport.top + 8);
      assert.ok(geometry.top + Math.min(1_000, geometry.maxHeight) <= viewport.top + viewport.height - 8);
      assert.ok(geometry.left >= viewport.left + 8);
      assert.ok(geometry.left + geometry.width <= viewport.left + viewport.width - 8);
    }
  } finally { cleanup(); }
});
