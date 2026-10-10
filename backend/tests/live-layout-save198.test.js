import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
Error.stackTraceLimit = 0;

// Extract actual Live handlers and their private sanitizer dependencies. Chart
// state is controlled; save feedback, storage and admission remain production.
const ts = createRequire(import.meta.url)(path.resolve("frontend/node_modules/typescript"));
const source = fs.readFileSync("frontend/src/components/EdgeLabWorkspace.tsx", "utf8");
const ast = ts.createSourceFile("EdgeLabWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let studio;
function findStudio(node) { if (ts.isFunctionExpression(node) && node.name?.text === "LiveChartStudio") studio = node; ts.forEachChild(node, findStudio); }
findStudio(ast); assert.ok(studio);
const roots = ["saveChartLayout", "buildLiveChartLayoutPayload", "loadNamedChartLayout", "deleteNamedChartLayout", "applyChartLayout", "markLayoutSaved"];
const handlers = studio.body.statements.filter(node => ts.isFunctionDeclaration(node) && roots.includes(node.name?.text));
assert.equal(handlers.length, roots.length);
const globals = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node]));
const variables = new Map();
for (const statement of ast.statements.filter(ts.isVariableStatement)) for (const declaration of statement.declarationList.declarations) {
  if (ts.isIdentifier(declaration.name)) variables.set(declaration.name.text, declaration);
}
const used = new Set(), selectedFunctions = new Map(), selectedConstants = new Map();
function dependencies(node) {
  if (ts.isIdentifier(node) && !used.has(node.text)) {
    used.add(node.text);
    if (globals.has(node.text)) { const definition = globals.get(node.text); selectedFunctions.set(node.text, definition); dependencies(definition); }
    else if (variables.has(node.text)) { const definition = variables.get(node.text); selectedConstants.set(node.text, definition); dependencies(definition); }
  }
  ts.forEachChild(node, dependencies);
}
handlers.forEach(dependencies);
const imports = [];
for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) continue;
  const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings)
    ? clause.namedBindings.elements.filter(element => used.has(element.name.text) && !element.isTypeOnly).map(element => element.getText(ast)) : [];
  const defaultName = clause.name && used.has(clause.name.text) ? clause.name.text : "";
  if (named.length || defaultName) imports.push(`import ${[defaultName, named.length ? `{${named.join(",")}}` : ""].filter(Boolean).join(",")} from ${statement.moduleSpecifier.getText(ast)};`);
}
// Bind the exact ref names used by the actual handlers to the real controller;
// no handler body or persistence return value is replaced.
const feedbackNames = [...used].filter(name => /(?:layout|save).*feedback/i.test(name) && !selectedFunctions.has(name));
const feedbackDeclaration = studio.body.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
  .find(node => node.name.getText(ast) === "liveLayoutSaveFeedback");
const failureCallback = feedbackDeclaration?.initializer?.arguments?.[0]?.arguments?.[1];
assert.ok(failureCallback, "actual Live failure feedback callback exists");
const moduleSource = `
  ${imports.join("\n")}
  import {createOwnedSaveFeedback as ownedFeedback198} from "../lib/saveFeedback.ts";
  export * from "../lib/serverStorage.ts";
  ${[...selectedConstants.values()].map(node => `const ${node.getText(ast)};`).join("\n")}
  ${[...selectedFunctions.values()].map(node => node.getText(ast)).join("\n")}
  export function liveHandlers198() {
    let layoutName="Morning", availableLayouts=[], chartLayoutStatus=null, chartLayoutError=null, saveError=null;
    let chartPaneLayout="single", chartSyncSettings={}, activeChartPaneId="live-chart-pane-1";
    let chartPanes=sanitizeLiveChartLayout({}).panes, activeChartPane=chartPanes[0];
    const setLayoutName=value=>{layoutName=value}, setAvailableLayouts=value=>{availableLayouts=value};
    const setChartLayoutStatus=value=>{chartLayoutStatus=value},setChartLayoutError=value=>{chartLayoutError=value};
    const setChartPaneLayout=value=>{chartPaneLayout=value};
    const setChartPanes=value=>{chartPanes=value;activeChartPane=chartPanes.find(p=>p.id===activeChartPaneId)??chartPanes[0]};
    const setChartSyncSettings=value=>{chartSyncSettings=value};
    const setActiveChartPaneId=value=>{activeChartPaneId=value;activeChartPane=chartPanes.find(p=>p.id===value)??chartPanes[0]};
    const setSelectedDrawingId=()=>{}, setDrawingUndoStack=()=>{};
    const feedback=ownedFeedback198(markLayoutSaved,error=>{saveError=error;(${failureCallback.getText(ast)})(error)});
    ${feedbackNames.map(name => `const ${name}={current:feedback};`).join("\n")}
    ${handlers.map(node => node.getText(ast)).join("\n")}
    return {save:saveChartLayout,load:loadNamedChartLayout,delete:deleteNamedChartLayout,feedback,
      name:value=>{layoutName=value},state:()=>({layoutName,availableLayouts,chartLayoutStatus,chartLayoutError,
        chartLayoutSavedAt:chartLayoutStatus?.at??null,saveError,chartPanes})};
  }
`;
const bundle = (await build({ bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  stdin: { contents: moduleSource, loader: "tsx", resolveDir: path.resolve("frontend/src/components") },
  plugins: [{ name: "live198-http-auth", setup(api) {
    api.onLoad({ filter: /[\\/]api\.ts$/ }, () => ({ loader: "js", contents: `
      export const getAppStorageItem=async(namespace,key)=>({namespace,key,value:null,updated_at:null});
      export const putAppStorageItem=(...args)=>globalThis.live198.put(...args);
    ` }));
    api.onLoad({ filter: /[\\/]authSession\.ts$/ }, () => ({ loader: "js", contents: "export const getStoredAuthSession=()=>globalThis.live198.owner;" }));
  } }] })).outputFiles[0].text;
const turn = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let instance = 0;

async function fixture(run) {
  const old = { window: globalThis.window, live198: globalThis.live198 }, storage = new Map(), requests = [], unhandled = [];
  let full = false;
  globalThis.window = { localStorage: { get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null,
    getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key),
    setItem(key,value) { if(full) throw Error("Browser storage full");storage.set(key,String(value)); } }, dispatchEvent() {} };
  const transport = { owner: { token: "owner-7", user: { id: 7 } }, put(namespace,key,value) {
    requests.push({namespace,key,value});return Promise.resolve({namespace,key,value,updated_at:"2026-10-10T00:00:00Z"});
  } };globalThis.live198=transport;
  const listener = error=>unhandled.push(error);process.on("unhandledRejection",listener);
  try {
    const api=await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}#${++instance}`), handlers=api.liveHandlers198();
    await run({api,handlers,transport,storage,requests,full:value=>{full=value}});await turn();assert.deepEqual(unhandled,[]);
  }catch(error){if(error.stack)error.stack=error.stack.replace(/data:text\/javascript;base64,[^\s)]+/g,"production-live-layout");throw error;
  }finally{process.off("unhandledRejection",listener);for(const[key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}

test("Live Save marks accepted local storage only after all actual writes, without claiming a server acknowledgment",()=>fixture(async h=>{
  const held=deferred();h.transport.put=async(namespace,key,value)=>{h.requests.push({namespace,key,value});await held.promise;return{namespace,key,value,updated_at:"2026-10-10T00:00:00Z"}};
  try {
    h.handlers.save();assert.equal(h.handlers.state().chartLayoutSavedAt,null);await turn();
    assert.equal(typeof h.handlers.state().chartLayoutSavedAt,"number");assert.equal(h.handlers.state().saveError,null);
    assert.equal(JSON.parse(h.storage.get("edgelab.live-chart-layouts.v1.user-7"))[0].name,"Morning");
    assert.equal(h.storage.get("edgelab.active-live-chart-layout.v1.user-7"),"Morning");
  } finally { held.resolve();await turn(); }
}));

test("blocked admission and failed browser writes never publish Saved or hide the barrier",()=>fixture(async h=>{
  const marker="edgelab.app-data-uncertain.v1.user-7.interrupted";h.storage.set(marker,"u");h.handlers.save();await turn();
  assert.equal(h.handlers.state().chartLayoutSavedAt,null);assert.equal(h.handlers.state().saveError?.requiresReload,true);
  assert.match(h.handlers.state().chartLayoutError,/Layout saves are paused.*Storage.*reload/);
  assert.equal(h.requests.length,0);assert.equal(h.storage.get(marker),"u");
  await assert.rejects(h.api.saveAppStorageItem("live-chart-layout.v1",{}),error=>error.requiresReload===true);
  h.storage.delete(marker);h.full(true);h.handlers.save();await turn();assert.equal(h.handlers.state().chartLayoutSavedAt,null);
  assert.match(h.handlers.state().saveError?.message??"",/storage full/i);
  h.full(false);h.handlers.save();await turn();assert.equal(typeof h.handlers.state().chartLayoutSavedAt,"number");
}));

test("actual named Live Load and Delete retain records and handle failed active-name persistence",()=>fixture(async h=>{
  h.handlers.save();await turn();h.handlers.name("Second");h.handlers.save();await turn();
  h.handlers.load("Morning");await turn();assert.equal(h.handlers.state().layoutName,"Morning");
  assert.equal(h.handlers.state().chartLayoutStatus.action,"loaded");
  assert.equal(h.storage.get("edgelab.active-live-chart-layout.v1.user-7"),"Morning");
  h.full(true);h.handlers.load("Second");await turn();assert.equal(h.handlers.state().chartLayoutSavedAt,null);
  assert.match(h.handlers.state().saveError?.message??"",/storage full/i);h.full(false);
  h.handlers.delete("Second");await turn();assert.deepEqual(h.handlers.state().availableLayouts,["Morning"]);
  assert.equal(JSON.parse(h.storage.get("edgelab.live-chart-layouts.v1.user-7")).length,1);
  h.full(true);h.handlers.delete("Morning");await turn();assert.match(h.handlers.state().saveError?.message??"",/storage full/i);
}));

test("accepted local Live layout remains usable when its best-effort server write fails",()=>fixture(async h=>{
  h.transport.put=async()=>{throw Error("Server unavailable")};h.handlers.save();await turn();
  assert.equal(typeof h.handlers.state().chartLayoutSavedAt,"number");assert.equal(h.handlers.state().saveError,null);
  assert.equal(h.api.getCachedAppStorageItem("live-chart-layouts.v1",[])[0].name,"Morning");
  assert.equal(JSON.parse(h.storage.get("edgelab.live-chart-layouts.v1.user-7"))[0].name,"Morning");
}));

test("actual Save success cannot overwrite a newer failed attempt",()=>fixture(async h=>{
  h.handlers.save();
  h.handlers.name("Latest");h.full(true);h.handlers.save();await turn();
  assert.equal(h.handlers.state().layoutName,"Latest");
  assert.equal(h.handlers.state().chartLayoutStatus,null);
  assert.match(h.handlers.state().chartLayoutError,/Could not finish saving/);
  assert.deepEqual(h.handlers.state().availableLayouts,[]);
}));

test("actual Save callbacks cannot publish after account changes or retirement",async()=>{
  for(const kind of["account","token","epoch","aba","unmount"])await fixture(async h=>{
    h.handlers.name("Unowned");h.handlers.save();
    if(kind==="account")h.transport.owner={token:"owner-8",user:{id:8}};
    if(kind==="token")h.transport.owner={token:"rotated",user:{id:7}};
    if(kind==="epoch")h.storage.set("edgelab.app-data-generation.v1.user-7",JSON.stringify({revision:"replacement",phase:"ready"}));
    if(kind==="aba"){h.transport.owner={token:"owner-8",user:{id:8}};h.handlers.feedback.invalidate();h.transport.owner={token:"owner-7",user:{id:7}};}
    if(kind==="unmount")h.handlers.feedback.dispose();await turn();
    assert.equal(h.handlers.state().chartLayoutStatus,null,kind);
    assert.equal(h.handlers.state().chartLayoutError,null,kind);
    assert.deepEqual(h.handlers.state().availableLayouts,[],kind);
  });
});

test("current controller owns late publication across account, token, epoch, ABA and unmount",async()=>{
  for(const kind of["account","token","epoch","aba","unmount"])await fixture(async h=>{
    const held=deferred();const pending=h.handlers.feedback.run(async()=>{await h.api.saveAppStorageItem("live-chart-layout.v1",{});await held.promise});await turn();
    if(kind==="account")h.transport.owner={token:"owner-8",user:{id:8}};
    if(kind==="token")h.transport.owner={token:"rotated",user:{id:7}};
    if(kind==="epoch")h.storage.set("edgelab.app-data-generation.v1.user-7",JSON.stringify({revision:"replacement",phase:"ready"}));
    if(kind==="aba"){h.transport.owner={token:"owner-8",user:{id:8}};h.handlers.feedback.invalidate();h.transport.owner={token:"owner-7",user:{id:7}};}
    if(kind==="unmount")h.handlers.feedback.dispose();held.resolve();await pending;
    assert.equal(h.handlers.state().chartLayoutSavedAt,null,kind);assert.equal(h.handlers.state().saveError,null,kind);
  });
});
