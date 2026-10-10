import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = buildSync({ bundle: true, format: "cjs", platform: "node", packages: "external", write: false, logLevel: "silent", jsx: "automatic", stdin: {
  contents: 'export * from "./frontend/src/components/ThemedSelect.tsx";',
  loader: "tsx", resolveDir: fileURLToPath(new URL("../..", import.meta.url)), sourcefile: "themed-option-select220.tsx",
} }).outputFiles[0].text;
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle)(createRequire(new URL("../../frontend/package.json", import.meta.url)), loaded, loaded.exports);
const { selectOptions, ThemedOptionSelect } = loaded.exports;

test("journal choices preserve explicit, implicit and numeric values and omit absent choices", () => {
  assert.deepEqual(selectOptions([
    h("option", { key: "empty", value: "" }, "All accounts"),
    null,
    false,
    h("option", { key: "number", value: 31 }, "Primary account"),
    h("option", { key: "implicit" }, "entry", "_", "time"),
    h("option", { key: "label", value: "hidden", label: "Visible label", disabled: true }, "Unused text"),
  ]), [
    { value: "", label: "All accounts", disabled: false },
    { value: "31", label: "Primary account", disabled: false },
    { value: "entry_time", label: "entry_time", disabled: false },
    { value: "hidden", label: "Visible label", disabled: true },
  ]);
});

test("fragment and group choices retain disabled groups and descriptive labels", () => {
  const choices = h(Fragment, null,
    h("optgroup", { label: "Templates", disabled: true }, h("option", { value: "template" }, "Built in")),
    h("optgroup", { label: "My scripts" }, [h("option", { key: "a", value: "a" }, "Custom"), h("option", { key: "b", value: "b", disabled: true }, "Unavailable")]),
  );
  assert.deepEqual(selectOptions(choices), [
    { value: "template", label: "Built in", disabled: true, sublabel: "Templates" },
    { value: "a", label: "Custom", disabled: false, sublabel: "My scripts" },
    { value: "b", label: "Unavailable", disabled: true, sublabel: "My scripts" },
  ]);
});

test("numeric account ids select their actual label and keep form label association", () => {
  const html = renderToStaticMarkup(h(ThemedOptionSelect, { id: "import-account", ariaLabel: "Account", value: 31, disabled: true },
    h("option", { value: 30 }, "Other account"), h("option", { value: 31 }, "Primary account"),
  ));
  assert.match(html, /id="import-account"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="Account"/);
  assert.match(html, /disabled/);
  assert.match(html, /Primary account/);
  assert.doesNotMatch(html, /<select|<option|Other account/);
});
