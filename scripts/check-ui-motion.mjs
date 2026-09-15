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
    else if (/\.(css|tsx)$/.test(entry.name)) files.push(file);
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
assert.match(styles, /transition-duration:\s*0s\s*!important/);
console.log(`Motion policy passed across ${files.length} UI source files.`);
