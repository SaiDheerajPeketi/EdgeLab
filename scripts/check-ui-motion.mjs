import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const census = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-motion-census.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-surface-evidence.json"), "utf8"));
const sourceRoot = path.join(root, "frontend/src");
const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.(css|ts|tsx)$/.test(entry.name)) files.push(file);
  }
}
visit(sourceRoot);

const forbiddenKeyframeProperty = /(?:^|[;{])\s*(?:top|right|bottom|left|width|height|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:/m;
const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    const body = source.slice(match.index + match[0].length, cursor - 1);
    if (forbiddenKeyframeProperty.test(body)) failures.push(`${path.relative(root, file)}:${match[1]}`);
  }
}
assert.equal(failures.length, 0, `Layout-affecting keyframes found: ${failures.join(", ")}`);
const styles = fs.readFileSync(path.join(sourceRoot, "styles.css"), "utf8");
assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none\s*!important/);
assert.match(styles, /animation-delay:\s*0s\s*!important/);
assert.match(styles, /transition-delay:\s*0s\s*!important/);
assert.match(styles, /transition-duration:\s*0s\s*!important/);
const preferences = fs.readFileSync(path.join(sourceRoot, "lib/motionPreferences.ts"), "utf8");
assert.match(preferences, /matchMedia\(REDUCED_MOTION_QUERY\)/);
assert.match(preferences, /addEventListener\("change", listener\)/);
assert.match(preferences, /removeEventListener\("change", listener\)/);
const landing = fs.readFileSync(path.join(sourceRoot, "pages/LandingPage.tsx"), "utf8");
assert.match(landing, /if \(!isActive \|\| reducedMotion\)/);
assert.match(landing, /isActive && !reducedMotion/);
const hero = fs.readFileSync(path.join(sourceRoot, "components/marketing/HeroDemo.tsx"), "utf8");
assert.match(hero, /if \(reducedMotion\)\s*\{\s*return;/);
assert.match(hero, /stageTransitionRef\.current\?\.kill\(\)/);
assert.match(hero, /IntersectionObserver/);
const shell = fs.readFileSync(path.join(sourceRoot, "components/marketing/MarketingShell.tsx"), "utf8");
assert.match(shell, /if \(reducedMotion\)\s*\{\s*restoreRevealNodes\(\)/);
assert.match(landing, /IntersectionObserver/);
assert.match(styles, /\.edgelab-marquee-paused[\s\S]*animation:[^;]+paused/);
const shimmeringText = fs.readFileSync(path.join(sourceRoot, "components/shimmering-text.tsx"), "utf8");
assert.match(shimmeringText, /opacity:\s*\[0\.48, 1, 0\.48\][\s\S]*repeat:\s*Number\.POSITIVE_INFINITY/);
assert.doesNotMatch(shimmeringText, /color:\s*\[[^\]]+\][\s\S]*repeat:\s*Number\.POSITIVE_INFINITY/);
assert.equal(census.schemaVersion, 1, "Unsupported motion census schema");
assert.deepEqual(Object.keys(census.proof).sort(), ["authenticated-navigation-motion", "authenticated-radial-toolbox", "public-storytelling"]);
const assertPartition = (label, actual, partition) => {
  const covered = Object.keys(partition.covered);
  assert.equal(new Set([...covered, ...partition.residual]).size, actual.length, `${label} census contains duplicates or omissions`);
  assert.deepEqual([...new Set([...covered, ...partition.residual])].sort(), [...actual].sort(), `${label} census must classify every inventoried surface`);
  for (const [surface, proofIds] of Object.entries(partition.covered)) {
    assert.ok(proofIds.length > 0, `${label} ${surface} has no proof binding`);
    for (const proofId of proofIds) assert.ok(census.proof[proofId], `${label} ${surface} references unknown proof ${proofId}`);
  }
};
assertPartition("panel", Object.keys(evidence.panels), census.panels);
assertPartition("overlay", Object.keys(evidence.overlays), census.overlays);
assertPartition("route group", ["public", "shell", "journal", "settings", "chart"], census.routeGroups);
const requiredAssertions = ["compositor-properties", "offscreen-pause-resume", "observer-cleanup", "rapid-interruption-final-state", "layout-count-zero", "reduced-motion"];
const publicProof = census.proof["public-storytelling"];
assert.equal(publicProof.spec, "e2e/motion-preference.interaction.spec.ts");
for (const assertion of requiredAssertions) assert.ok(publicProof.assertions.includes(assertion), `Motion census is missing ${assertion}`);
const assertionMarkers = {
  "compositor-properties": "unsafeProperties",
  "offscreen-pause-resume": "pausedMotionCounts",
  "observer-cleanup": "__edgelabIntersectionDisconnects",
  "rapid-interruption-final-state": "stableStageStyle",
  "layout-count-zero": "LayoutCount",
  "reduced-motion": "prefers-reduced-motion: reduce",
  "focus-restoration": "toBeFocused",
  "overlay-unmount-cleanup": "closest('[role=\"dialog\"]')",
};
const referencedProofs = new Set(Object.values(census.routeGroups.covered).flat().concat(Object.values(census.panels.covered).flat(), Object.values(census.overlays.covered).flat()));
assert.deepEqual([...referencedProofs].sort(), Object.keys(census.proof).sort(), "Every proof must be referenced by a covered surface and vice versa");
for (const [proofId, proof] of Object.entries(census.proof)) {
  const proofPath = path.join(root, proof.spec);
  assert.ok(fs.existsSync(proofPath), `${proofId} spec does not exist`);
  const source = fs.readFileSync(proofPath, "utf8");
  assert.ok(source.includes(`test("${proof.testTitle}"`), `${proofId} test title is missing`);
  for (const assertionId of proof.assertions) {
    assert.ok(assertionMarkers[assertionId], `${proofId} has unknown assertion ${assertionId}`);
    assert.ok(source.includes(assertionMarkers[assertionId]), `${proofId} does not contain assertion marker ${assertionMarkers[assertionId]}`);
  }
}
assert.ok(census.panels.residual.length > 0 && census.overlays.residual.length > 0, "UIR-72 must remain partial until authenticated surface coverage is exhaustive");
console.log(`Motion policy passed across ${files.length} UI source files; census covers ${Object.keys(census.routeGroups.covered).length} route groups, ${Object.keys(census.panels.covered).length} panels, and ${Object.keys(census.overlays.covered).length} overlays with ${census.routeGroups.residual.length + census.panels.residual.length + census.overlays.residual.length} explicit residuals.`);
