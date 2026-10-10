import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkDocs, discoverMarkdown } from "../../scripts/check-docs.mjs";

const checker = fileURLToPath(new URL("../../scripts/check-docs.mjs", import.meta.url));

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-docs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  for (const [filename, contents] of Object.entries(files)) {
    const absolute = path.join(root, filename);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
  return root;
}

test("Git discovery includes maintained tracked/untracked docs and excludes private, vendor, generated and ignored files", t => {
  const root = fixture(t, {
    "README.md": "# Home",
    "docs/tracked.md": "# Tracked",
    "docs/new.md": "# New",
    ".github/PULL_REQUEST_TEMPLATE.md": "# Review",
    "backend/README.md": "# Backend",
    "frontend/DESIGN.md": "# Design",
    "scripts/README.md": "# Scripts",
    "deployment/README.md": "# Deploy",
    "docker/README.md": "# Docker",
    "benchmark/README.md": "# Benchmark",
    "benchmarks/README.md": "# Benchmarks",
    "CONTRIBUTING.md": "# Contribute",
    "SECURITY.md": "# Security",
    "AGENTS.md": "# Agents",
    "docs/ignored.md": "[bad](missing.md)",
    "frontend/vendor/tool/README.md": "[bad](missing.md)",
    "frontend/vendor/pinets/README.md": "# Maintained upgrade guide",
    "frontend/public/source/README.md": "[bad](missing.md)",
    "frontend/public/catalog/README.md": "[bad](missing.md)",
    "backend/data/private.md": "[bad](missing.md)",
    "backend/.venv/private.md": "[bad](missing.md)",
    "benchmark/results/generated.md": "[bad](missing.md)",
    ".artifacts/result.md": "[bad](missing.md)",
    ".impeccable/user.md": "[bad](missing.md)",
    "graphs/generated.md": "[bad](missing.md)",
    "notes/private.md": "[bad](missing.md)",
    "private.md": "[bad](missing.md)",
    ".gitignore": "docs/ignored.md\n.artifacts/\n"
  });
  execFileSync("git", ["-C", root, "add", "README.md", "docs/tracked.md"]);
  // Even a mistakenly tracked ignored file must not be read.
  execFileSync("git", ["-C", root, "add", "--force", "docs/ignored.md"]);
  assert.deepEqual(discoverMarkdown(root), [
    ".github/PULL_REQUEST_TEMPLATE.md", "AGENTS.md", "CONTRIBUTING.md", "README.md", "SECURITY.md",
    "backend/README.md", "benchmark/README.md", "benchmarks/README.md", "deployment/README.md",
    "docker/README.md", "docs/new.md", "docs/tracked.md", "frontend/DESIGN.md", "frontend/vendor/pinets/README.md", "scripts/README.md"
  ]);
  assert.deepEqual(checkDocs({ root }).errors, []);
});

test("local links support encoded/angle spaces, nested parentheses, images, directories and file query suffixes", t => {
  const root = fixture(t, {
    "README.md": [
      "[encoded](docs/My%20Guide.md#hello-world)",
      "[angle](<docs/My Guide.md#hello-world> \"Guide title\")",
      "[nested](docs/guide_(one).md#details)",
      "![image](docs/example.png)",
      "[directory](docs/)",
      "[query](docs/My%20Guide.md?raw=true#hello-world)",
      "[file](scripts/example.js)"
    ].join("\n"),
    "docs/My Guide.md": "# Hello world",
    "docs/guide_(one).md": "# Details",
    "docs/example.png": "synthetic image fixture",
    "scripts/example.js": "export const example = true;"
  });
  assert.deepEqual(checkDocs({ root }).errors, []);
});

test("generated anchors preserve Unicode/code text, duplicate suffixes, setext headings and explicit HTML IDs", t => {
  const root = fixture(t, {
    "README.md": [
      "[first](docs/guide.md#repeat)", "[second](docs/guide.md#repeat-1)",
      "[collision](docs/guide.md#repeat-1-1)", "[third](docs/guide.md#repeat-2)",
      "[setext](docs/guide.md#setext)", "[unicode](docs/guide.md#caf%C3%A9-%E6%9D%B1%E4%BA%AC)",
      "[code](docs/guide.md#use-api_v2)", "[id](docs/guide.md#Manual-ID)", "[legacy](docs/guide.md#old-anchor)"
    ].join("\n"),
    "docs/guide.md": "# Repeat\n# Repeat\n# Repeat-1\n# Repeat\nSetext\n===\n# Café 東京\n# Use \`API_v2\`\n<a id='Manual-ID'></a>\n<a name=\"old-anchor\"></a>"
  });
  assert.deepEqual(checkDocs({ root }).errors, []);
});

test("full, collapsed and shortcut references use normalized labels and validate their destinations", t => {
  const root = fixture(t, {
    "README.md": "[full][  GUIDE   REF ]\n[Guide ref][]\n[Guide ref]\n\n[guide ref]: <docs/My Guide.md#title> \"Guide\"\n",
    "docs/My Guide.md": "# Title"
  });
  assert.deepEqual(checkDocs({ root }).errors, []);
  fs.writeFileSync(path.join(root, "docs/My Guide.md"), "# Renamed");
  assert.match(checkDocs({ root }).errors[0].message, /Missing Markdown anchor/);
});

test("reference definitions may place destinations on the next line", t => {
  const root = fixture(t, { "README.md": "[guide][ref]\n\n[ref]:\n  docs/guide.md#title\n", "docs/guide.md": "# Title" });
  assert.deepEqual(checkDocs({ root }).errors, []);
});

test("undefined full and collapsed references are actionable failures", t => {
  const root = fixture(t, { "README.md": "[full][missing]\n[collapsed][]\n" });
  assert.deepEqual(checkDocs({ root }).errors.map(error => [error.line, error.message]), [
    [1, "Undefined link reference: missing"], [2, "Undefined link reference: collapsed"]
  ]);
});

test("code fences, multi-backtick inline code, comments, escaped brackets and task boxes do not create false links", t => {
  const root = fixture(t, { "README.md": [
    "# Actual", "\`\`\`\`markdown", "[bad](missing.md)", "# Not an anchor", "\`\`\`", "\`\`\`\`\`",
    "~~~", "[bad](missing.md)", "~~~",
    "> \`\`\`", "> [bad](missing.md)", "> \`\`\`",
    "\`[bad](missing.md)\` and \`\`[bad](also-missing.md) \` example\`\`",
    "<!-- [bad](missing.md) -->", "\\[literal](missing.md)",
    "- [ ] [valid](#actual)", "- [x] [valid](#actual)",
    "https://example.test/remote", "[remote](https://example.test/missing.md#missing)",
    "[email](mailto:example@example.test)", "[app](app://connector)",
    "[route](/app/journal#review)", "[protocol](//example.test/)",
    "[valid](#actual)"
  ].join("\n") });
  assert.deepEqual(checkDocs({ root }).errors, []);
  fs.appendFileSync(path.join(root, "README.md"), "\n[missing](#not-an-anchor)");
  assert.match(checkDocs({ root }).errors[0].message, /Missing Markdown anchor/);
});

test("missing files, Markdown anchors, invalid encoding and repository escapes report exact source lines", t => {
  const root = fixture(t, { "README.md": [
    "# Home", "[file](docs/missing.md)", "[anchor](#absent)",
    "[encoding](docs/%ZZ.md)", "[escape](../outside.md)"
  ].join("\n") });
  assert.deepEqual(checkDocs({ root }).errors.map(error => [error.line, error.message.split(":")[0]]), [
    [2, "Missing local target"], [3, "Missing Markdown anchor"],
    [4, "Invalid URL encoding in local link"], [5, "Local link escapes the repository"]
  ]);
});

test("unclosed and mismatched/short fences fail at the opening line", t => {
  const root = fixture(t, { "README.md": "# Home\n\`\`\`\`js\nexample\n\`\`\`\n~~~\n" });
  assert.deepEqual(checkDocs({ root }).errors, [{ file: "README.md", line: 2, message: "Unclosed code fence." }]);
});

test("Markdown symlinks outside the repository are rejected without reading their content", t => {
  const root = fixture(t, { "README.md": "# Home" });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-private-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "private.md"), "PRIVATE-FIXTURE [bad](private-value.md)");
  fs.mkdirSync(path.join(root, "docs"));
  fs.symlinkSync(path.join(outside, "private.md"), path.join(root, "docs/private-link.md"));
  const result = checkDocs({ root });
  assert.deepEqual(result.errors, [{ file: "docs/private-link.md", line: 1, message: "Document resolves outside the repository." }]);
  assert.equal(JSON.stringify(result).includes("PRIVATE-FIXTURE"), false);
});

test("CLI returns a concise success or nonzero actionable failure without dependencies", t => {
  const root = fixture(t, { "README.md": "# Home\n[home](#home)" });
  const passed = spawnSync(process.execPath, [checker, "--root", root], { encoding: "utf8" });
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /^Documentation check passed: 1 Markdown files, 1 local links\.\n$/);
  fs.appendFileSync(path.join(root, "README.md"), "\n[missing](docs/absent.md)");
  const failed = spawnSync(process.execPath, [checker, "--root", root], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /README\.md:3: Missing local target: docs\/absent\.md/);
  assert.match(failed.stderr, /Documentation check failed: 1 problem/);
});

test("excluded vendor/ignored Markdown targets still validate linked anchors without scanning their other links", t => {
  const root = fixture(t, {
    "README.md": "[ignored](docs/ignored.md#existing)\n[vendor](frontend/vendor/tool/README.md#present)",
    "docs/ignored.md": "# Existing\n[unchecked](absent.md)",
    "frontend/vendor/tool/README.md": "# Present\n[unchecked](absent.md)",
    ".gitignore": "docs/ignored.md\n"
  });
  assert.equal(checkDocs({ root }).stats.documents, 1);
  assert.deepEqual(checkDocs({ root }).errors, []);
  fs.writeFileSync(path.join(root, "README.md"),
    "[ignored](docs/ignored.md#missing)\n[vendor](frontend/vendor/tool/README.md#missing)");
  assert.deepEqual(checkDocs({ root }).errors.map(error => error.message), [
    "Missing Markdown anchor: docs/ignored.md#missing",
    "Missing Markdown anchor: frontend/vendor/tool/README.md#missing"
  ]);
});

test("links to excluded Markdown symlinks cannot read outside the repository", t => {
  const root = fixture(t, { "README.md": "[outside](docs/ignored.md#secret)", ".gitignore": "docs/ignored.md\n" });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-private-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "private.md"), "# secret\nPRIVATE-FIXTURE");
  fs.mkdirSync(path.join(root, "docs"));
  fs.symlinkSync(path.join(outside, "private.md"), path.join(root, "docs/ignored.md"));
  assert.deepEqual(checkDocs({ root }).errors, [{
    file: "README.md", line: 1, message: "Local link resolves outside the repository: docs/ignored.md#secret"
  }]);
});
