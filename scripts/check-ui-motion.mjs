import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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
console.log(`Motion policy passed across ${files.length} UI source files.`);
