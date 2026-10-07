import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const census = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-motion-census.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-surface-evidence.json"), "utf8"));
const foundation = JSON.parse(fs.readFileSync(path.join(root, "docs/ui-foundation-contracts.json"), "utf8"));
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

const compositorKeyframeProperties = new Set(["opacity", "transform", "transform-origin"]);
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
    const properties = [...body.matchAll(/(?:^|[;{])\s*([a-z-]+)\s*:/gm)].map((entry) => entry[1]);
    const unsafe = properties.filter((property) => !compositorKeyframeProperties.has(property));
    if (unsafe.length) failures.push(`${path.relative(root, file)}:${match[1]} (${[...new Set(unsafe)].join(", ")})`);
  }
}
assert.equal(failures.length, 0, `Non-compositor keyframe properties found: ${failures.join(", ")}`);
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
assert.match(hero, /if \(reducedMotion(?: \|\| prefersReducedMotion\(\))?\)\s*\{\s*return;/);
assert.match(hero, /stageTransitionRef\.current\?\.kill\(\)/);
assert.match(hero, /IntersectionObserver/);
const shell = fs.readFileSync(path.join(sourceRoot, "components/marketing/MarketingShell.tsx"), "utf8");
assert.match(shell, /if \(reducedMotion\)\s*\{\s*restoreRevealNodes\(\)/);
assert.match(landing, /IntersectionObserver/);
assert.match(styles, /\.edgelab-marquee-paused[\s\S]*animation:[^;]+paused/);
const shimmeringText = fs.readFileSync(path.join(sourceRoot, "components/shimmering-text.tsx"), "utf8");
assert.match(shimmeringText, /opacity:\s*\[0\.48, 1, 0\.48\][\s\S]*repeat:\s*Number\.POSITIVE_INFINITY/);
assert.doesNotMatch(shimmeringText, /color:\s*\[[^\]]+\][\s\S]*repeat:\s*Number\.POSITIVE_INFINITY/);
const repeatedMotionPattern = /repeat:\s*(?:Number\.POSITIVE_INFINITY|Infinity)/;
const repeatedMotionOccurrences = files.flatMap((file) => {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(new RegExp(repeatedMotionPattern.source, "g"))].map((match) => ({ offset: match.index, source, sourcePath: path.relative(root, file) }));
});
const repeatedMotionSources = repeatedMotionOccurrences.map((entry) => entry.sourcePath).sort();
assert.deepEqual(repeatedMotionSources, census.repeatedMotion.map((entry) => entry.source).sort(), "Every repeated Motion/JS animation needs an explicit contract");
for (const contract of census.repeatedMotion) {
  assert.ok(["opacity", "transform", "x", "y", "scale"].includes(contract.property), `${contract.source} repeats a non-compositor property`);
  const occurrences = repeatedMotionOccurrences.filter((entry) => entry.sourcePath === contract.source);
  assert.equal(occurrences.length, 1, `${contract.source} must have one independently audited repeated animation`);
  const source = occurrences[0].source;
  const reducedMotionVariable = source.match(/const\s+(\w+)\s*=\s*useReducedMotion\(\)/)?.[1];
  assert.ok(reducedMotionVariable && source.match(new RegExp(`\\b${reducedMotionVariable}\\b`, "g"))?.length > 1, `${contract.source} must actively gate repetition with reduced motion`);
  let derivedProperty;
  if (contract.adapter === "declarative-motion") {
    derivedProperty = source.match(/<motion\.[a-z]+[\s\S]*?animate=\{\{\s*([a-z-]+)\s*:/)?.[1];
    assert.match(source, /<motion\.[a-z]+[\s\S]*?animate=/, `${contract.source} must use component-owned Motion cleanup`);
  } else if (contract.adapter === "variant-motion") {
    derivedProperty = source.match(/running:\s*\{\s*([a-z-]+)\s*:/)?.[1];
    assert.match(source, /animate=\{[^}]*stopped[^}]*running/, `${contract.source} must switch its repeated variant off`);
  } else if (contract.adapter === "motion-value-transform") {
    derivedProperty = source.match(/useTransform\([^)]*\)[\s\S]*?`(translate|scale|rotate)/)?.[1] === "translate" ? "transform" : undefined;
    assert.match(source, /return \(\) => controls\?\.stop\(\)/, `${contract.source} must stop its repeated Motion value`);
  } else {
    assert.fail(`${contract.source} has unknown repeated-motion adapter ${contract.adapter}`);
  }
  assert.equal(derivedProperty, contract.property, `${contract.source} repeated property must be derived from its animation`);
}
assert.equal(census.schemaVersion, 1, "Unsupported motion census schema");
assert.deepEqual(Object.keys(census.proof).sort(), ["authenticated-navigation-motion", "authenticated-radial-toolbox", "public-storytelling"]);
const SOURCE_AUDIT = "source-audit";
const auditedSources = new Set(files.map((file) => path.relative(root, file)));
const assertPartition = (label, actual, partition) => {
  const covered = Object.keys(partition.covered);
  assert.equal(new Set([...covered, ...partition.residual]).size, actual.length, `${label} census contains duplicates or omissions`);
  assert.deepEqual([...new Set([...covered, ...partition.residual])].sort(), [...actual].sort(), `${label} census must classify every inventoried surface`);
  for (const [surface, proofIds] of Object.entries(partition.covered)) {
    assert.ok(proofIds.length > 0, `${label} ${surface} has no proof binding`);
    for (const proofId of proofIds) assert.ok(proofId === SOURCE_AUDIT || census.proof[proofId], `${label} ${surface} references unknown proof ${proofId}`);
  }
};
assertPartition("panel", Object.keys(evidence.panels), census.panels);
assertPartition("overlay", Object.keys(evidence.overlays), census.overlays);
assertPartition("route group", ["public", "shell", "journal", "settings", "chart"], census.routeGroups);
const requiredProofAssertions = {
  "public-storytelling": ["compositor-properties", "offscreen-pause-resume", "observer-cleanup", "rapid-interruption-final-state", "layout-count-zero", "reduced-motion"],
  "authenticated-radial-toolbox": ["reduced-motion-css", "focus-restoration"],
  "authenticated-navigation-motion": ["compositor-repeated", "overlay-unmount-cleanup", "rapid-overlay-cycle", "layout-count-zero", "reduced-motion", "focus-restoration"],
};
assert.equal(census.proof["public-storytelling"].spec, "e2e/motion-preference.interaction.spec.ts");
for (const [proofId, assertions] of Object.entries(requiredProofAssertions)) assert.deepEqual(census.proof[proofId].assertions, assertions, `${proofId} assertion contract drifted`);
const assertionMarkers = {
  "compositor-properties": "unsafeProperties",
  "compositor-repeated": "unsafeRepeated",
  "offscreen-pause-resume": "pausedMotionCounts",
  "observer-cleanup": "__edgelabIntersectionDisconnects",
  "rapid-interruption-final-state": "stableStageStyle",
  "rapid-overlay-cycle": "index < 4",
  "layout-count-zero": "LayoutCount",
  "reduced-motion": "reducedMotion: \"reduce\"",
  "reduced-motion-css": "toHaveCSS(\"animation-name\", \"none\")",
  "focus-restoration": "toBeFocused",
  "overlay-unmount-cleanup": "closest('[role=\"dialog\"]')",
};
assert.deepEqual(Object.keys(census.routeGroupSources).sort(), Object.keys(census.routeGroups.covered).sort(), "Route-group source audit keys must be exhaustive");
for (const [group, sources] of Object.entries(census.routeGroupSources)) {
  assert.ok(census.routeGroups.covered[group]?.includes(SOURCE_AUDIT), `Route group ${group} must bind the source audit`);
  assert.ok(sources.length > 0, `Route group ${group} needs an audited source`);
  for (const source of sources) assert.ok(auditedSources.has(source), `Route group ${group} references unaudited source ${source}`);
}
for (const [family, contracts] of [["panel", foundation.panels], ["overlay", foundation.overlays]]) {
  const partition = family === "panel" ? census.panels : census.overlays;
  for (const [surface, sources] of Object.entries(contracts)) {
    assert.ok(partition.covered[surface]?.includes(SOURCE_AUDIT), `${family} ${surface} must bind the source audit`);
    for (const source of sources) assert.ok(auditedSources.has(source), `${family} ${surface} references unaudited source ${source}`);
  }
}
const referencedProofs = new Set(Object.values(census.routeGroups.covered).flat().concat(Object.values(census.panels.covered).flat(), Object.values(census.overlays.covered).flat()).filter((proofId) => proofId !== SOURCE_AUDIT));
assert.deepEqual([...referencedProofs].sort(), Object.keys(census.proof).sort(), "Every proof must be referenced by a covered surface and vice versa");
for (const [proofId, proof] of Object.entries(census.proof)) {
  const proofPath = path.join(root, proof.spec);
  assert.ok(fs.existsSync(proofPath), `${proofId} spec does not exist`);
  const source = fs.readFileSync(proofPath, "utf8");
  const testStart = source.indexOf(`test("${proof.testTitle}"`);
  assert.ok(testStart >= 0, `${proofId} test title is missing`);
  const nextTest = source.indexOf("\ntest(", testStart + 1);
  const testSource = source.slice(testStart, nextTest < 0 ? source.length : nextTest);
  for (const assertionId of proof.assertions) {
    assert.ok(assertionMarkers[assertionId], `${proofId} has unknown assertion ${assertionId}`);
    assert.ok(testSource.includes(assertionMarkers[assertionId]), `${proofId} test does not contain assertion marker ${assertionMarkers[assertionId]}`);
  }
}
assert.deepEqual(census.routeGroups.residual, [], "Motion route-group coverage must be exhaustive");
assert.deepEqual(census.panels.residual, [], "Motion panel coverage must be exhaustive");
assert.deepEqual(census.overlays.residual, [], "Motion overlay coverage must be exhaustive");
console.log(`Motion policy passed across ${files.length} UI source files; census covers ${Object.keys(census.routeGroups.covered).length} route groups, ${Object.keys(census.panels.covered).length} panels, and ${Object.keys(census.overlays.covered).length} overlays with ${census.routeGroups.residual.length + census.panels.residual.length + census.overlays.residual.length} explicit residuals.`);
