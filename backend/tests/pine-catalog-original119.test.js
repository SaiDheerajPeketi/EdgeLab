import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {build} from "esbuild";
const root=new URL("../../",import.meta.url).pathname;
const bundle=(await build({bundle:true,minify:true,format:"esm",platform:"browser",write:false,logLevel:"silent",define:{"import.meta.env":"{}"},stdin:{contents:'export * from "./frontend/src/lib/pineCatalog.ts";',resolveDir:root,loader:"ts",sourcefile:"pine-catalog-original119.ts"}})).outputFiles[0].text;
const lib=await import("data:text/javascript;base64,"+Buffer.from(bundle).toString("base64"));
const expanded=JSON.parse(fs.readFileSync(path.join(root,"frontend/src/lib/pineCatalogManifestV2.json"))),legacy=JSON.parse(fs.readFileSync(path.join(root,"frontend/src/lib/pineCatalogManifest.json")));
const base="/catalog/pine/everget-v2",oldBase="/catalog/pine/everget",A="a".repeat(40),B="b".repeat(40);
const text=(entry,catalog=expanded)=>fs.readFileSync(path.join(root,"frontend/public",catalog===legacy?oldBase:base,catalog.upstreamCommit,entry.path),"utf8");
const origin=(entry,catalog=expanded)=>({catalogId:entry.id,repository:catalog.repository,path:entry.path,...(catalog===legacy?{}:{collection:"expanded-v2"}),upstreamCommit:catalog.upstreamCommit,upstreamBlobSha1:entry.upstreamBlobSha1,sourceSha256:entry.sourceSha256,originalPineVersion:entry.pineVersion,author:entry.author,license:entry.license,originUrl:entry.originUrl,lastFetchedAt:catalog.lastFetchedAt});
const revision=(catalog,commit)=>({...structuredClone(catalog),upstreamCommit:commit,entries:catalog.entries.map(e=>({...e,originUrl:"https://github.com/"+catalog.repository+"/blob/"+commit+"/"+e.path}))});
function boundary(t,catalog=expanded,entry=catalog.entries[0]){
 const selectedBase=catalog===legacy?oldBase:base,manifestUrl=selectedBase+"/"+catalog.upstreamCommit+"/manifest.json",sourceUrl=selectedBase+"/"+catalog.upstreamCommit+"/"+entry.path;
 const responses=new Map([[manifestUrl,JSON.stringify(catalog)],[sourceUrl,text(entry,catalog)]]),requests=[];
 t.mock.method(globalThis,"fetch",async(url,options)=>{
  requests.push({url,signal:options.signal});assert.equal(options.credentials,"omit");assert.equal(options.redirect,"error");assert.equal(options.cache,"no-cache");
  if(options.signal?.aborted)throw new DOMException("Aborted","AbortError");
  const body=responses.get(url);return body instanceof Response?body:new Response(body??"missing",{status:body===undefined?404:200});
 });
 return {responses,requests,manifestUrl,sourceUrl};
}
test("expanded original recovery verifies exact packaged bytes and ignores the current catalog",async t=>{
 const entry=expanded.entries[0],fetch=boundary(t),saved=origin(entry),before=structuredClone(saved),result=await lib.loadPineCatalogOriginal(saved);
 assert.equal(result.source,text(entry));assert.equal(createHash("sha256").update(result.source).digest("hex"),entry.sourceSha256);
 const bytes=Buffer.from(result.source);assert.equal(createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex"),entry.upstreamBlobSha1);
 assert.deepEqual(result.provenance,saved);assert.deepEqual(saved,before);
 assert.deepEqual(fetch.requests.map(r=>r.url),[fetch.manifestUrl,fetch.sourceUrl]);
});
test("saved older archived revision recovers even when absent from the selected current index",async t=>{
 const catalog=revision(expanded,A),entry=catalog.entries[0],fetch=boundary(t);
 fetch.responses.clear();fetch.responses.set(base+"/"+A+"/manifest.json",JSON.stringify(catalog));fetch.responses.set(base+"/"+A+"/"+entry.path,text(expanded.entries[0]));
 fetch.responses.set(base+"/index.json",JSON.stringify({schemaVersion:1,repository:expanded.repository,revisions:[B],currentRevision:B}));
 const provenance={...origin(expanded.entries[0]),upstreamCommit:A,originUrl:entry.originUrl};
 const result=await lib.loadPineCatalogOriginal(provenance);
 assert.equal(result.source,text(expanded.entries[0]));assert.equal(result.provenance.upstreamCommit,A);
 assert.deepEqual(fetch.requests.map(r=>r.url),[base+"/"+A+"/manifest.json",base+"/"+A+"/"+entry.path]);
});
test("legacy v1-v4 recovery returns raw original bytes without silently migrating them",async t=>{
 const entry=legacy.entries.find(e=>e.pineVersion<5),fetch=boundary(t,legacy,entry),saved=origin(entry,legacy);
 const migration=lib.pineCatalogMigration(legacy,entry.id);assert.ok(migration);
 saved.migration={id:migration.id,version:5,sourceSha256:migration.sourceSha256};
 const before=structuredClone(saved),result=await lib.loadPineCatalogOriginal(saved);
 assert.equal(result.source,text(entry,legacy));assert.match(result.source,new RegExp("//@version="+entry.pineVersion));
 assert.equal(result.provenance.migration,undefined);assert.deepEqual(saved,before);
 assert.ok(fetch.requests.every(r=>r.url.startsWith(oldBase+"/")));assert.ok(!fetch.requests.some(r=>r.url.includes("/migrations/")));
});
test("saved SHA, upstream blob and version must match the archived manifest before source download",async t=>{
 const catalog=revision(expanded,A),entry=catalog.entries[0],fetch=boundary(t);
 fetch.responses.set(base+"/"+A+"/manifest.json",JSON.stringify(catalog));
 fetch.responses.set(base+"/"+A+"/"+entry.path,text(expanded.entries[0]));
 const saved={...origin(expanded.entries[0]),upstreamCommit:A,originUrl:entry.originUrl};
 for(const patch of [{sourceSha256:"0".repeat(64)},{upstreamBlobSha1:"0".repeat(40)},{originalPineVersion:entry.pineVersion===6?5:6}]){
  const before=fetch.requests.length;
  await assert.rejects(lib.loadPineCatalogOriginal({...saved,...patch}));
  assert.deepEqual(fetch.requests.slice(before).map(r=>r.url),[base+"/"+A+"/manifest.json"]);
 }
});
test("unsafe provenance identities fail before network access",async t=>{
 const entry=expanded.entries.find(e=>!legacy.entries.some(l=>l.path===e.path)),fetch=boundary(t),saved=origin(entry);
 for(const patch of [{collection:undefined},{collection:"legacy"},{path:"../secret"},{catalogId:"other"},{repository:"foreign/repo"},{upstreamCommit:"../private"},{sourceSha256:"bad"},{upstreamBlobSha1:"bad"},{originalPineVersion:7},{originUrl:"https://evil.test"}]){
  const before=fetch.requests.length;await assert.rejects(lib.loadPineCatalogOriginal({...saved,...patch}));assert.equal(fetch.requests.length,before);
 }
});
test("collection and archive revision mismatches cannot redirect recovery to another valid collection",async t=>{
 const entry=expanded.entries[0],fetch=boundary(t);
 fetch.responses.set(fetch.manifestUrl,JSON.stringify(legacy));
 await assert.rejects(lib.loadPineCatalogOriginal(origin(entry)));
 assert.deepEqual(fetch.requests.map(r=>r.url),[fetch.manifestUrl]);
 fetch.responses.set(fetch.manifestUrl,JSON.stringify(revision(expanded,B)));
 await assert.rejects(lib.loadPineCatalogOriginal(origin(entry)));
 assert.ok(fetch.requests.every(r=>r.url===fetch.manifestUrl));
});
test("unavailable, tampered, oversized and invalid UTF-8 source responses leave the saved origin untouched",async t=>{
 const entry=expanded.entries[0],fetch=boundary(t),saved=origin(entry),before=structuredClone(saved);
 for(const response of [new Response("missing",{status:404}),text(entry)+"\n// altered",new Response("x".repeat(20001)),new Response(new Uint8Array([255,254]))]){
  fetch.responses.set(fetch.sourceUrl,response);await assert.rejects(lib.loadPineCatalogOriginal(saved));assert.deepEqual(saved,before);
 }
 fetch.responses.set(fetch.sourceUrl,text(entry));assert.equal((await lib.loadPineCatalogOriginal(saved)).source,text(entry));
});
test("abort signals are forwarded to every archive request and unavailable manifests fail closed",async t=>{
 const entry=expanded.entries[0],fetch=boundary(t),controller=new AbortController();
 await lib.loadPineCatalogOriginal(origin(entry),controller.signal);assert.ok(fetch.requests.every(r=>r.signal===controller.signal));
 controller.abort();await assert.rejects(lib.loadPineCatalogOriginal(origin(entry),controller.signal),{name:"AbortError"});
 fetch.responses.delete(fetch.manifestUrl);await assert.rejects(lib.loadPineCatalogOriginal(origin(entry)),/unavailable/i);
 assert.ok(fetch.requests.every(r=>r.url===fetch.manifestUrl||r.url===fetch.sourceUrl));
});
