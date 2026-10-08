import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const root = new URL("../../", import.meta.url).pathname;
const bundled = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false,
  stdin: { contents: 'export * from "./frontend/src/lib/pineProtocol.ts";', loader: "ts", resolveDir: root } })).outputFiles[0].text;
const protocol = await import("data:text/javascript;base64," + Buffer.from(bundled).toString("base64"));
const source = '//@version=6\nindicator("Enums")\nplot(1)';
const request = { id: "enum93", action: "prepare", source };
const member = { enumVersion: 1, enumType: "Side", enumMembers: [{ id: "Side.a", label: "Same" }, { id: "Side.b", label: "Same" }] };
const input = () => ({ id: "in_0", name: "Choice", type: "enum", defval: "Side.a", options: ["Side.a", "Side.b"], ...structuredClone(member) });
const prepare = (definition) => ({ kind: "prepare", source, language: "pine", pineVersion: 6, declaration: "indicator", name: "Enums", overlay: false, behindChart: true, diagnostics: [], inputDefinitions: [definition] });
const validate = (definition) => protocol.validatePineResponse({ id: "enum93", status: "completed", result: prepare(definition) }, request);
test("duplicate labels retain distinct validated enum IDs and choice order", () => {
  assert.deepEqual(protocol.validatePineEnumMetadata(member), member);
  assert.deepEqual(validate(input()).inputDefinitions[0], input());
  const subset = input(); subset.options = ["Side.b"]; subset.defval = "Side.b";
  assert.deepEqual(validate(subset).inputDefinitions[0].enumMembers, member.enumMembers);
});
test("enum metadata rejects unknown versions types duplicate IDs foreign members and nonmembers", () => {
  for (const change of [
    { enumVersion: 2 }, { enumType: "constructor" }, { enumType: "Other" },
    { enumMembers: [] }, { enumMembers: [member.enumMembers[0], member.enumMembers[0]] },
    { enumMembers: [{ id: "Side.constructor", label: "Unsafe" }] },
    { enumMembers: [{ id: "Other.a", label: "Foreign" }] },
    { options: ["Same"] }, { options: [] },
    { defval: "Same" }, { defval: "Side.b", options: ["Side.a"] }, { type: "string" },
  ]) assert.throws(() => validate({ ...input(), ...change }), protocol.PineProtocolError);
});
test("legacy enum metadata is accepted as stored provenance without inventing member IDs", () => {
  const legacy = { id: "in_0", name: "Choice", type: "enum", defval: "Same", options: ["Same", "Same"] };
  assert.deepEqual(validate(legacy).inputDefinitions[0], legacy);
});
test("enum member bridge requires bounded ordinary data with no getters or extra fields", () => {
  let reads = 0;
  const getter = structuredClone(member);
  Object.defineProperty(getter.enumMembers[0], "label", { enumerable: true, get() { reads++; return "Same"; } });
  assert.throws(() => protocol.validatePineEnumMetadata(getter), protocol.PineProtocolError);
  assert.equal(reads, 0);
  for (const invalid of [
    { ...member, extra: true },
    { ...member, enumMembers: [{ id: "Side.a", label: "Same", extra: true }] },
    { ...member, enumMembers: Array.from({ length: 129 }, (_, index) => ({ id: "Side.m" + index, label: "Title" })) },
    { ...member, enumMembers: [{ id: "Side.a", label: "x".repeat(4097) }] },
  ]) assert.throws(() => protocol.validatePineEnumMetadata(invalid), protocol.PineProtocolError);
});
