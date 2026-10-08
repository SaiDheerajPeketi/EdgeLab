import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

// Exercise the exact consumer sanitizers, including genuine Fib sorting/defaults.
const ts = createRequire(import.meta.url)(path.resolve("frontend/node_modules/typescript"));
const chartSource = fs.readFileSync("frontend/src/components/TradingChart.tsx", "utf8");
const chartAst = ts.createSourceFile("TradingChart.tsx", chartSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["sanitizeDrawingPresets", "sanitizeFibPresets", "isLabelableDrawingTool", "clamp"];
const declarations = chartAst.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(declarations.length, names.length, "All genuine consumer helpers must be present");
const source = (await build({ bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent", stdin: {
  contents: `export * from "./frontend/src/lib/chartPresetOperations.ts"; export * from "./frontend/src/lib/serverStorage.ts"; import { normalizeFibLevels } from "./frontend/src/lib/charting.ts"; const DEFAULT_LABEL_BACKGROUND_OPACITY = 0.92; ${declarations.map(node => node.getText(chartAst)).join("\n")} export { sanitizeDrawingPresets, sanitizeFibPresets };`,
  loader: "tsx", resolveDir: process.cwd(),
}, plugins: [{ name: "network-auth-boundary", setup(build) {
  build.onLoad({ filter: /[\\/]api\.ts$/ }, () => ({ loader: "ts", contents: `export const getAppStorageItem = (namespace,key) => globalThis.presetGet(namespace,key); export const putAppStorageItem = (namespace,key,value) => globalThis.presetPut(namespace,key,value); export const updateChartPreset = payload => globalThis.presetCommand(payload);` }));
  build.onLoad({ filter: /[\\/]authSession\.ts$/ }, () => ({ loader: "ts", contents: "export const getStoredAuthSession = () => globalThis.presetOwner;" }));
} }] })).outputFiles[0].text;
let instance = 0;
const stamp = "2026-10-08T12:00:00Z";
const key = kind => kind === "drawing" ? "drawing-presets.v1" : "fib-presets.v1";
const item = (kind, value) => ({ namespace: "edgelab", key: key(kind), value, updated_at: stamp });
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const drawing = (id="original", name="Original") => ({ id, name, updatedAt: stamp, tool: "horizontal", color: "#123456", label: name, lineStyle: "solid", lineWidth: 2, labelBackgroundOpacity: 0.92 });
const fib = (id="original", name="Original") => ({ id, name, updatedAt: stamp, extendLeft: false, extendRight: true, levels: [{ id: "lower", value: 0, color: "#123456" }, { id: "upper", value: 1, color: "#abcdef", label: "Top", visible: false, lineStyle: "dotted", backgroundOpacity: 0.12 }] });
const make = kind => kind === "drawing" ? drawing : fib;
const sanitize = (api, kind) => kind === "drawing" ? api.sanitizeDrawingPresets : api.sanitizeFibPresets;
const save = (preset) => ({ action: "save", preset, name: preset.name });
const remove = (preset) => ({ action: "delete", id: preset.id, name: preset.name });

async function fixture(run) {
  const globals = ["window", "presetOwner", "presetGet", "presetPut", "presetCommand"];
  const previous = Object.fromEntries(globals.map(name => [name,globalThis[name]]));
  const local = new Map();
  globalThis.window = { localStorage: { get length(){return local.size;}, key: i => [...local.keys()][i] ?? null, getItem: name => local.get(name) ?? null, setItem: (name,value) => local.set(name,String(value)), removeItem: name => local.delete(name) }, dispatchEvent(){}, addEventListener(){}, removeEventListener(){} };
  globalThis.presetOwner = { token: "original-token", user: { id: 1 } };
  globalThis.presetGet = async (_namespace,k) => item(k === key("drawing") ? "drawing" : "fib", []);
  globalThis.presetPut = async (_namespace,k,value) => ({ namespace:"edgelab",key:k,value,updated_at:stamp });
  globalThis.presetCommand = async () => { throw new Error("Unconfigured command boundary"); };
  try {
    const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${++instance}`);
    await run(api, local);
  } catch (error) {
    if (error instanceof Error && error.stack) error.stack = error.stack.replace(/data:text\/javascript;base64,[^\s)]+/g, "bundled-production-module");
    throw error;
  } finally { for (const [name,value] of Object.entries(previous)) { if(value === undefined) delete globalThis[name]; else globalThis[name]=value; } }
}
async function seed(api, kind) {
  const original = make(kind)();
  globalThis.presetGet = async () => item(kind,[original]);
  await api.readChartPresets(kind,sanitize(api,kind));
  return original;
}
const cached = (api,kind) => api.getCachedAppStorageItem(key(kind),null);

for (const kind of ["drawing","fib"]) {
  test(`${kind} save holds acknowledged cache until exact command response`, async () => fixture(async api => {
    const original=await seed(api,kind), pending=deferred(), requests=[], publications=[];
    const submitted=make(kind)("saved","Saved");
    api.subscribeAppStorageItem(key(kind), value => publications.push(value));
    globalThis.presetCommand = payload => { requests.push(payload); return pending.promise; };
    const operation=api.confirmChartPreset(kind,save(submitted),sanitize(api,kind));
    await turn();
    assert.deepEqual(requests,[{kind,action:"save",preset:submitted}]);
    assert.deepEqual(cached(api,kind),[original]); assert.deepEqual(publications,[]);
    pending.resolve(item(kind,[submitted,original]));
    const result=await operation;
    assert.equal(result[0].id,"saved"); assert.deepEqual(cached(api,kind),[submitted,original]);
    assert.deepEqual(publications,[[submitted,original]]);
  }));

  test(`${kind} failed save/delete and explicit retry retain acknowledged records`, async () => fixture(async api => {
    const original=await seed(api,kind), submitted=make(kind)("retry","Retry"), publications=[];
    api.subscribeAppStorageItem(key(kind), value => publications.push(value));
    globalThis.presetCommand = async () => { throw new Error("Service unavailable"); };
    for(const intent of [save(submitted),remove(original)]) await assert.rejects(api.confirmChartPreset(kind,intent,sanitize(api,kind)),/unavailable/);
    assert.deepEqual(cached(api,kind),[original]); assert.deepEqual(publications,[]);
    globalThis.presetCommand = async payload => item(kind,payload.action === "save" ? [payload.preset,original] : []);
    await api.confirmChartPreset(kind,save(submitted),sanitize(api,kind));
    await api.confirmChartPreset(kind,remove(original),sanitize(api,kind));
    assert.deepEqual(cached(api,kind),[]);
  }));

  test(`${kind} null/wrong-key/wrong-namespace/wrong-value acknowledgments never publish`, async () => fixture(async api => {
    const original=await seed(api,kind), submitted=make(kind)("saved","Saved"), publications=[];
    api.subscribeAppStorageItem(key(kind),value=>publications.push(value));
    const invalid=[null,item(kind,null),{...item(kind,[submitted]),key:"wrong"},{...item(kind,[submitted]),namespace:"foreign"},{...item(kind,[submitted]),updated_at:"not-a-date"},item(kind,[{...submitted,name:"Changed"}]),item(kind,[original])];
    for(const response of invalid){globalThis.presetCommand=async()=>response;await assert.rejects(api.confirmChartPreset(kind,save(submitted),sanitize(api,kind)));}
    for(const response of [null,item(kind,null),item(kind,[original])]){globalThis.presetCommand=async()=>response;await assert.rejects(api.confirmChartPreset(kind,remove(original),sanitize(api,kind)));}
    assert.deepEqual(cached(api,kind),[original]);assert.deepEqual(publications,[]);
  }));
}

test("strict empty read accepts absent initial storage but malformed reads preserve prior cache", async () => fixture(async(api,local)=>{
  for(const kind of ["drawing","fib"]){
    globalThis.presetGet=async()=>({...item(kind,null),updated_at:null});
    assert.deepEqual(await api.readChartPresets(kind,sanitize(api,kind)),[]);assert.deepEqual(cached(api,kind),[]);
    const original=await seed(api,kind), publications=[];api.subscribeAppStorageItem(key(kind),value=>publications.push(value));
    for(const response of [null,{...item(kind,[]),key:"wrong"},item(kind,{}),{...item(kind,[]),updated_at:"bad"}]){globalThis.presetGet=async()=>response;await assert.rejects(api.readChartPresets(kind,sanitize(api,kind)));}
    assert.deepEqual(cached(api,kind),[original]);assert.deepEqual(publications,[]);
  }
  assert.ok(local.size>0);
}));

test("strict consumer validation rejects colors, numeric coercion, lossy fields and duplicate identities", async()=>fixture(async api=>{
  const d=drawing(), f=fib();
  const invalidDrawing=[{...d,color:"rgba(0,0,0,1)"},{...d,lineWidth:0},{...d,lineWidth:"2"},{...d,fillOpacity:.61},{...d,labelBackgroundOpacity:1.1},{...d,tool:"unknown"},{...d,lineStyle:"invalid"},{...d,extra:"lost"},{...d,updatedAt:"2026-10-08T12:00:00"}];
  for(const value of invalidDrawing)assert.throws(()=>api.validatedChartPresets("drawing",[value],api.sanitizeDrawingPresets));
  const invalidLevels=[{...f.levels[0],value:-2.1},{...f.levels[0],value:NaN},{...f.levels[0],value:"0"},{...f.levels[0],color:"invalid"},{...f.levels[0],backgroundOpacity:.25},{...f.levels[0],visible:"true"},{...f.levels[0],extra:true}];
  for(const level of invalidLevels)assert.throws(()=>api.validatedChartPresets("fib",[{...f,levels:[level]}],api.sanitizeFibPresets));
  for(const kind of ["drawing","fib"]){const value=make(kind)();for(const entries of [[value,value],[value,{...value,id:"other",name:"  ORIGINAL  "}]])assert.throws(()=>api.validatedChartPresets(kind,entries,sanitize(api,kind)));}
  assert.throws(()=>api.validatedChartPresets("fib",[{...f,levels:[f.levels[0],{...f.levels[1],id:"lower"}]}],api.sanitizeFibPresets));
}));

test("optional Fib fields and unsorted IDs normalize for display without altering authored payload",async()=>fixture(async api=>{
  const raw=fib("unsorted","Unsorted");raw.levels.reverse();const before=structuredClone(raw);
  const values=api.validatedChartPresets("fib",[raw],api.sanitizeFibPresets);
  assert.deepEqual(values[0].levels.map(level=>level.id),["lower","upper"]);
  assert.equal(values[0].levels[0].lineStyle,"solid");assert.equal(values[0].levels[0].visible,true);
  assert.deepEqual(raw,before);
  globalThis.presetCommand=async payload=>{assert.deepEqual(payload.preset,before);return item("fib",[payload.preset]);};
  assert.equal((await api.confirmChartPreset("fib",save(raw),api.sanitizeFibPresets))[0].id,"unsorted");
}));

test("save captures immutable submitted intent before waiting for preceding queue",async()=>fixture(async api=>{
  const legacy=deferred(), requests=[];globalThis.presetPut=()=>legacy.promise;
  await api.saveAppStorageItem(key("drawing"),[drawing()]);
  const submitted=drawing("saved","Saved");globalThis.presetCommand=async payload=>{requests.push(payload);return item("drawing",[payload.preset]);};
  const operation=api.confirmChartPreset("drawing",save(submitted),api.sanitizeDrawingPresets);
  submitted.label="Newer draft";await turn();assert.deepEqual(requests,[]);
  legacy.resolve(item("drawing",[drawing()]));await operation;
  assert.equal(requests[0].preset.label,"Saved");assert.equal(cached(api,"drawing")[0].label,"Saved");
}));

test("changed account/token drops queued command before sending and rejects late acknowledgment",async()=>{
  for(const replacement of [{token:"original-token",user:{id:2}},{token:"new-token",user:{id:1}}]){
    await fixture(async api=>{
      const held=deferred();let requests=0;globalThis.presetPut=()=>held.promise;
      await api.saveAppStorageItem(key("drawing"),[drawing()]);
      globalThis.presetCommand=async payload=>{requests++;return item("drawing",[payload.preset]);};
      const operation=api.confirmChartPreset("drawing",save(drawing("saved","Saved")),api.sanitizeDrawingPresets);const rejected=assert.rejects(operation,{name:"AbortError"});await turn();
      globalThis.presetOwner=replacement;held.resolve(item("drawing",[drawing()]));await rejected;assert.equal(requests,0);assert.deepEqual(cached(api,"drawing"),replacement.user.id === 1 ? [drawing()] : null);
    });
    await fixture(async(api,local)=>{
      await seed(api,"drawing");const held=deferred(), publications=[];api.subscribeAppStorageItem(key("drawing"),value=>publications.push(value));globalThis.presetCommand=()=>held.promise;
      const submitted=drawing("saved","Saved"), operation=api.confirmChartPreset("drawing",save(submitted),api.sanitizeDrawingPresets), rejected=assert.rejects(operation,{name:"AbortError"});await turn();
      globalThis.presetOwner=replacement;held.resolve(item("drawing",[submitted]));await rejected;assert.deepEqual(publications,[]);assert.deepEqual(cached(api,"drawing"),replacement.user.id === 1 ? [drawing()] : null);
      globalThis.presetOwner={token:"original-token",user:{id:1}};assert.deepEqual(cached(api,"drawing"),[drawing()]);
      assert.equal(local.get("edgelab.drawing-presets.v1.user-2"),undefined);
    });
  }
});

test("account-data replacement rejects held preset acknowledgment without publication",async()=>fixture(async(api,local)=>{
  await seed(api,"fib");const held=deferred(), submitted=fib("saved","Saved"), publications=[];api.subscribeAppStorageItem(key("fib"),value=>publications.push(value));globalThis.presetCommand=()=>held.promise;
  const operation=api.confirmChartPreset("fib",save(submitted),api.sanitizeFibPresets), rejected=assert.rejects(operation,error=>error.requiresReload===true);await turn();
  local.set("edgelab.app-data-generation.v1.user-1",JSON.stringify({revision:"replacement",phase:"ready"}));held.resolve(item("fib",[submitted]));await rejected;assert.deepEqual(publications,[]);
}));


test("queued strict commands publish each latest acknowledgment, not only the first",async()=>fixture(async api=>{
  const original=await seed(api,"drawing"), first=deferred(), publications=[], requests=[];
  const a=drawing("a","First"), b=drawing("b","Second");
  api.subscribeAppStorageItem(key("drawing"),value=>publications.push(value));
  globalThis.presetCommand=payload=>{requests.push(payload);return requests.length===1 ? first.promise : Promise.resolve(item("drawing",[b,a,original]));};
  const one=api.confirmChartPreset("drawing",save(a),api.sanitizeDrawingPresets);
  const two=api.confirmChartPreset("drawing",save(b),api.sanitizeDrawingPresets);
  await turn();assert.equal(requests.length,1);first.resolve(item("drawing",[a,original]));
  await Promise.all([one,two]);assert.equal(requests.length,2);
  assert.deepEqual(cached(api,"drawing"),[b,a,original]);
  assert.deepEqual(publications,[[a,original],[b,a,original]]);
}));
