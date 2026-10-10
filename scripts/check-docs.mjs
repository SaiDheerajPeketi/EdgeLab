import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCUMENT_DIRS = new Set(["docs", ".github", "backend", "frontend", "scripts", "docker", "deployment", "benchmark", "benchmarks"]);
const EXCLUDED_DIRS = new Set(["node_modules", "vendor", "dist", "data", "uploads", "results", "graphs", "artifacts"]);

function maintainedFile(filename) {
  if (filename === "frontend/vendor/pinets/README.md") return true;
  const parts = filename.split("/");
  if (!filename.endsWith(".md") || parts.some(part => EXCLUDED_DIRS.has(part) || (part.startsWith(".") && part !== ".github"))) return false;
  if (filename.startsWith("frontend/public/")) return false;
  return parts.length === 1
    ? /^(?:README(?:[.-].*)?|AGENTS|CONTRIBUTING|SECURITY|THIRD_PARTY_NOTICES)\.md$/i.test(filename)
    : DOCUMENT_DIRS.has(parts[0]);
}

export function discoverMarkdown(root = DEFAULT_ROOT) {
  const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
    { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).split("\0").filter(maintainedFile);
  if (!candidates.length) return [];
  // --no-index excludes ignored paths even if a generated file was once tracked.
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "-z", "--stdin"],
    { cwd: root, input: candidates.join("\0") + "\0", encoding: "utf8" });
  if (ignored.error || ![0, 1].includes(ignored.status)) throw new Error("Unable to inspect documentation ignore rules.");
  const excluded = new Set(ignored.stdout.split("\0"));
  return [...new Set(candidates)].filter(filename => !excluded.has(filename) && fs.existsSync(path.join(root, filename))).sort();
}

function blank(value) {
  return value.replace(/[^\n]/g, " ");
}

function escaped(text, position) {
  let count = 0;
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index--) count++;
  return count % 2 === 1;
}

function maskInlineCode(text) {
  let result = "", cursor = 0;
  for (let index = 0; index < text.length;) {
    if (text[index] !== "\`" || escaped(text, index)) { index++; continue; }
    const start = index;
    while (text[index] === "\`") index++;
    const marker = text.slice(start, index);
    let close = index;
    while ((close = text.indexOf(marker, close)) !== -1) {
      if (text[close - 1] !== "\`" && text[close + marker.length] !== "\`") break;
      close += marker.length;
    }
    if (close === -1) continue;
    result += text.slice(cursor, start) + blank(text.slice(start, close + marker.length));
    index = cursor = close + marker.length;
  }
  return result + text.slice(cursor);
}

function normalizeReference(label) {
  return label.replace(/\\([\\[\]])/g, "$1").trim().replace(/\s+/g, " ").toLowerCase();
}

function destination(text, position) {
  let index = position;
  while (index < text.length && /\s/.test(text[index])) index++;
  const start = index;
  if (text[index] === "<") {
    index++;
    while (index < text.length && (text[index] !== ">" || escaped(text, index))) index++;
    return index < text.length ? { target: text.slice(start + 1, index), end: index + 1 } : null;
  }
  let nesting = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length) { index += 2; continue; }
    if (/\s/.test(char) || (char === ")" && nesting === 0)) break;
    if (char === "(") nesting++;
    if (char === ")") nesting--;
    index++;
  }
  return index > start ? { target: text.slice(start, index), end: index } : null;
}

function closeBracket(text, start) {
  let nesting = 1;
  for (let index = start + 1; index < text.length; index++) {
    if (escaped(text, index)) continue;
    if (text[index] === "[") nesting++;
    if (text[index] === "]" && --nesting === 0) return index;
  }
  return -1;
}

function lineAt(text, position) {
  return text.slice(0, position).split("\n").length;
}

function headingText(value) {
  return value.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, "$1")
    .replace(/<[^>]*>/g, "").replace(/[\`*~]/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" })[entity])
    .trim();
}

export function parseMarkdown(source) {
  const errors = [], lines = source.replace(/\r\n/g, "\n").split("\n");
  let fence = null;
  const visible = lines.map((line, index) => {
    // Blockquote containers may wrap fenced examples.
    const content = line.replace(/^(?: {0,3}> ?)+/, "");
    const match = content.match(/^ {0,3}(\`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (match && match[1][0] === fence.character && match[1].length >= fence.length && !match[2].trim()) fence = null;
      return blank(line);
    }
    if (match && (match[1][0] !== "\`" || !match[2].includes("\`"))) {
      fence = { character: match[1][0], length: match[1].length, line: index + 1 };
      return blank(line);
    }
    return line;
  }).join("\n").replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
  if (fence) errors.push({ line: fence.line, message: "Unclosed code fence." });

  const anchors = new Set(), usedSlugs = new Set();
  const headingLines = visible.split("\n");
  function addHeading(value) {
    const base = headingText(value).toLowerCase().replace(/[^\p{L}\p{N}\p{M}\p{Pc} -]/gu, "").replace(/ /g, "-");
    let slug = base, suffix = 0;
    while (usedSlugs.has(slug)) slug = base + "-" + ++suffix;
    usedSlugs.add(slug);
    anchors.add(slug);
  }
  headingLines.forEach((line, index) => {
    const heading = line.match(/^ {0,3}#{1,6}(?:[ \t]+(.*)|$)/);
    if (heading) addHeading((heading[1] ?? "").replace(/[ \t]+#+[ \t]*$/, ""));
    else if (index && /^ {0,3}(?:=+|-+)[ \t]*$/.test(line) && headingLines[index - 1].trim()) addHeading(headingLines[index - 1]);
  });
  // IDs in code spans are examples, not rendered HTML anchors.
  for (const match of maskInlineCode(visible).matchAll(/<[a-z][^>]*\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)) anchors.add(match[1] ?? match[2]);

  const references = new Map(), links = [];
  const text = maskInlineCode(visible)
    .replace(/^[ \t]*(?:[-*+]|[0-9]+[.)])\s+\[[ xX]\]/gm, blank)
    .replace(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:\n[ \t]*)?(.+)$/gm, (definition, label, rest, offset) => {
      const parsed = destination(rest, 0);
      if (parsed) {
        references.set(normalizeReference(label), parsed.target);
        links.push({ target: parsed.target, line: lineAt(visible, offset) });
      }
      return blank(definition);
    });
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "[" || escaped(text, index)) continue;
    const close = closeBracket(text, index);
    if (close === -1) continue;
    const label = text.slice(index + 1, close);
    let end = close + 1;
    if (text[end] === "(") {
      const parsed = destination(text, end + 1);
      if (parsed) {
        links.push({ target: parsed.target, line: lineAt(text, index) });
        end = parsed.end;
      }
    } else {
      while (end < text.length && /\s/.test(text[end])) end++;
      if (text[end] === "[") {
        const refClose = closeBracket(text, end);
        if (refClose !== -1) {
          const reference = normalizeReference(text.slice(end + 1, refClose) || label);
          if (!references.has(reference)) errors.push({ line: lineAt(text, index), message: "Undefined link reference: " + reference });
          end = refClose + 1;
        }
      } else end = close + 1; // Shortcut references are validated through their definitions.
    }
    index = end - 1;
  }
  return { anchors, links, errors };
}

export function checkDocs({ root = DEFAULT_ROOT, files = discoverMarkdown(root) } = {}) {
  root = fs.realpathSync(root);
  const documents = new Map(), errors = [];
  for (const file of files) {
    const absolute = path.resolve(root, file);
    const real = fs.realpathSync(absolute);
    if (real !== root && !real.startsWith(root + path.sep)) {
      errors.push({ file, line: 1, message: "Document resolves outside the repository." });
      continue;
    }
    const parsed = parseMarkdown(fs.readFileSync(real, "utf8"));
    documents.set(absolute, parsed);
    errors.push(...parsed.errors.map(error => ({ file, ...error })));
  }
  const linkedAnchors = new Map([...documents].map(([filename, document]) => [filename, document.anchors]));
  let linkCount = 0;
  for (const [absolute, document] of documents) {
    const file = path.relative(root, absolute).split(path.sep).join("/");
    for (const link of document.links) {
      const raw = link.target.replace(/\\([\\()<>[\] #])/g, "$1");
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(raw)) continue;
      linkCount++;
      let filename, anchor;
      try {
        const hash = raw.indexOf("#");
        filename = decodeURIComponent((hash === -1 ? raw : raw.slice(0, hash)).split("?")[0]);
        anchor = hash === -1 ? "" : decodeURIComponent(raw.slice(hash + 1));
      } catch {
        errors.push({ file, line: link.line, message: "Invalid URL encoding in local link: " + raw });
        continue;
      }
      const target = filename ? path.resolve(path.dirname(absolute), filename) : absolute;
      if (!target.startsWith(root + path.sep) && target !== root) {
        errors.push({ file, line: link.line, message: "Local link escapes the repository: " + raw });
      } else if (!fs.existsSync(target)) {
        errors.push({ file, line: link.line, message: "Missing local target: " + raw });
      } else if (anchor && target.toLowerCase().endsWith(".md")) {
        const real = fs.realpathSync(target);
        if (!real.startsWith(root + path.sep)) {
          errors.push({ file, line: link.line, message: "Local link resolves outside the repository: " + raw });
          continue;
        }
        // Linked vendor/ignored documents still define real anchors. Discovery
        // exclusions limit whole-document checks, not local-link correctness.
        if (!linkedAnchors.has(target)) linkedAnchors.set(target, parseMarkdown(fs.readFileSync(real, "utf8")).anchors);
        if (!linkedAnchors.get(target).has(anchor)) errors.push({ file, line: link.line, message: "Missing Markdown anchor: " + raw });
      }
    }
  }
  return { errors, stats: { documents: documents.size, links: linkCount } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--root")) throw new Error("Usage: node scripts/check-docs.mjs [--root repository]");
    const result = checkDocs({ root: args[1] ? path.resolve(args[1]) : DEFAULT_ROOT });
    if (result.errors.length) {
      for (const error of result.errors) console.error(error.file + ":" + error.line + ": " + error.message);
      console.error("Documentation check failed: " + result.errors.length + " problem(s).");
      process.exitCode = 1;
    } else console.log("Documentation check passed: " + result.stats.documents + " Markdown files, " + result.stats.links + " local links.");
  } catch (error) {
    console.error("Documentation check failed: " + error.message);
    process.exitCode = 1;
  }
}
