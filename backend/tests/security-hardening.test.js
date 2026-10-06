import assert from "node:assert/strict";
import test from "node:test";

import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
const apiBundle = buildSync({ bundle: true, entryPoints: [fileURLToPath(new URL("../../frontend/src/lib/api.ts", import.meta.url))], define: { "import.meta.env": "{}" }, format: "esm", platform: "node", write: false }).outputFiles[0].text;
const { getApiWebSocketUrl } = await import(`data:text/javascript;base64,${Buffer.from(apiBundle).toString("base64")}`);
import {
  isSafeRichTextHref,
  sanitizeRichTextHtml,
} from "../../frontend/src/lib/richText.ts";

test("rich text links reject redirect and protocol confusion", () => {
  assert.equal(isSafeRichTextHref("https://example.com/note"), true);
  assert.equal(isSafeRichTextHref("/app/journal"), true);
  assert.equal(isSafeRichTextHref("#entry"), true);
  assert.equal(isSafeRichTextHref("//attacker.example/path"), false);
  assert.equal(isSafeRichTextHref("/\\attacker.example/path"), false);
  assert.equal(isSafeRichTextHref("javascript:alert(1)"), false);
  assert.equal(isSafeRichTextHref("https:\n//attacker.example"), false);
});

test("server-side rich text sanitization fails closed", () => {
  const unsafe = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  assert.equal(
    sanitizeRichTextHtml(unsafe),
    "&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
  );
});

test("WebSocket URLs never contain bearer tokens", () => {
  const socketUrl = new URL(getApiWebSocketUrl("/datasets/stream"));
  assert.equal(socketUrl.search, "");
  assert.equal(socketUrl.protocol, "ws:");
});
