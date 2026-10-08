import assert from "node:assert/strict";
import fs from "node:fs";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {refreshPineCatalog} from "../../scripts/refresh-pine-catalog.mjs";

const A="1".repeat(40),B="2".repeat(40);
const repository="everget/tradingview-pinescript-indicators";
const collections=[["legacy-v1","pineCatalogManifest.json","everget"],["expanded-v2","pineCatalogManifestV2.json","everget-v2"]];
async function fixture(collection,seedName,assetRoot,work){
 const seed=JSON.parse(fs.readFileSync("frontend/src/lib/"+seedName,"utf8"));
 const sourceRoot=path.resolve("frontend/public/catalog/pine",assetRoot,seed.upstreamCommit);
 const outputDir=await mkdtemp(path.join(tmpdir(),"pine-refetch102-"));
 const requests=[];
 let head=A;
 const fetchImpl=async(url,options)=>{
  assert.equal(options.redirect,"error");
  requests.push(url);
  if(url===`https://api.github.com/repos/${repository}/git/ref/heads/master`)return new Response(JSON.stringify({object:{sha:head,type:"commit"}}));
  const prefix=`https://raw.githubusercontent.com/${repository}/`;
  assert.ok(url.startsWith(prefix));
  const relative=url.slice(prefix.length),commit=relative.slice(0,40),sourcePath=relative.slice(41);
  assert.ok([A,B,seed.upstreamCommit].includes(commit));
  let bytes=fs.readFileSync(path.join(sourceRoot,sourcePath==="LICENSE"?"LICENSE.txt":sourcePath));
  if(commit===B&&sourcePath===seed.entries[0].path)bytes=Buffer.concat([bytes,Buffer.from("\n// Distinct reviewed fixture revision B.\n")]);
  return new Response(bytes);
 };
 const refresh=options=>refreshPineCatalog({collection,outputDir,fetchImpl,...options});
 const index=async()=>JSON.parse(await readFile(path.join(outputDir,"index.json"),"utf8"));
 const snapshot=async commit=>{
  const result={};
  for(const file of ["manifest.json","LICENSE.txt",...seed.entries.map(entry=>entry.path)])result[file]=await readFile(path.join(outputDir,commit,file),"utf8");
  return result;
 };
 try{await work({seed,outputDir,requests,refresh,index,snapshot,setHead:value=>{head=value;}});}finally{await rm(outputDir,{recursive:true,force:true});}
}

test("refetch A→B→A selects the actual upstream head without reordering or rewriting either archive",async()=>{
 for(const collection of collections)await fixture(...collection,async f=>{
  const first=await f.refresh(),archiveA=await f.snapshot(A);
  f.setHead(B);const second=await f.refresh(),archiveB=await f.snapshot(B);
  assert.notEqual(first.entries[0].sourceSha256,second.entries[0].sourceSha256);
  f.setHead(A);const before=f.requests.length,result=await f.refresh();
  assert.equal(result.upstreamCommit,A);
  assert.deepEqual(await f.index(),{schemaVersion:1,repository,revisions:[A,B],currentRevision:A});
  assert.equal(f.requests.length-before,1,"Existing head requires only the branch-ref request.");
  assert.deepEqual(await f.snapshot(A),archiveA);
  assert.deepEqual(await f.snapshot(B),archiveB);
 });
});

test("explicit pin selects an archived revision and repeated identical pin performs no fetch or index rewrite",async()=>{
 for(const collection of collections)await fixture(...collection,async f=>{
  await f.refresh({commit:A});await f.refresh({commit:B});
  const archiveA=await f.snapshot(A),archiveB=await f.snapshot(B);
  const noFetch=()=>{throw new Error("An existing explicit pin must not fetch.");};
  await f.refresh({commit:A,fetchImpl:noFetch});
  const filename=path.join(f.outputDir,"index.json"),bytes=await readFile(filename,"utf8");
  assert.equal((await f.index()).currentRevision,A);
  const modifiedAt=fs.statSync(filename).mtimeMs;
  await f.refresh({commit:A,fetchImpl:noFetch});
  assert.equal(await readFile(filename,"utf8"),bytes);
  assert.equal(fs.statSync(filename).mtimeMs,modifiedAt);
  assert.deepEqual(await f.snapshot(A),archiveA);assert.deepEqual(await f.snapshot(B),archiveB);
 });
});

test("legacy indexes without a selection pointer are upgraded only after successful source verification",async()=>{
 for(const collection of collections)await fixture(...collection,async f=>{
  await f.refresh({commit:A});await f.refresh({commit:B});
  const filename=path.join(f.outputDir,"index.json"),legacy={schemaVersion:1,repository,revisions:[A,B]};
  await writeFile(filename,JSON.stringify(legacy));
  await f.refresh({commit:A,fetchImpl:()=>{throw new Error("Legacy archived pin must not fetch.");}});
  assert.deepEqual(await f.index(),{...legacy,currentRevision:A});
 });
});

test("invalid current pointers fail closed before fetching assets or changing the index",async()=>{
 await fixture(...collections[1],async f=>{
  await f.refresh({commit:A});const filename=path.join(f.outputDir,"index.json"),archive=await f.snapshot(A);
  for(const currentRevision of [null,42,[],"bad","3".repeat(40)]){
   const bytes=JSON.stringify({schemaVersion:1,repository,revisions:[A],currentRevision});await writeFile(filename,bytes);
   await assert.rejects(f.refresh({commit:A,fetchImpl:()=>{throw new Error("Invalid index must not fetch.");}}),/Invalid existing catalog revision index/);
   assert.equal(await readFile(filename,"utf8"),bytes);assert.deepEqual(await f.snapshot(A),archive);
  }
 });
});

test("corrupt archived source cannot repoint the current selection",async()=>{
 await fixture(...collections[1],async f=>{
  await f.refresh({commit:A});await f.refresh({commit:B});
  const filename=path.join(f.outputDir,"index.json"),before=await readFile(filename,"utf8"),archiveB=await f.snapshot(B);
  const sourceFile=path.join(f.outputDir,A,f.seed.entries[0].path);
  await writeFile(sourceFile,(await readFile(sourceFile,"utf8"))+"\n// corrupted local archive\n");
  await assert.rejects(f.refresh({commit:A,fetchImpl:()=>{throw new Error("Archived validation must not fetch.");}}),/immutable source or metadata has changed/);
  assert.equal(await readFile(filename,"utf8"),before);
  assert.equal((await f.index()).currentRevision,B);assert.deepEqual(await f.snapshot(B),archiveB);
  assert.equal(fs.existsSync(path.join(f.outputDir,".refresh.lock")),false);
 });
});


test("inherited currentRevision never validates or suppresses an explicit own selection",async()=>{
 await fixture(...collections[1],async f=>{
  await f.refresh({commit:A});await f.refresh({commit:B});
  const filename=path.join(f.outputDir,"index.json"),legacy={schemaVersion:1,repository,revisions:[A,B]};
  const original=Object.getOwnPropertyDescriptor(Object.prototype,"currentRevision");
  try{
   for(const inherited of [A,"invalid inherited revision"]){
    await writeFile(filename,JSON.stringify(legacy));
    Object.defineProperty(Object.prototype,"currentRevision",{value:inherited,writable:true,configurable:true});
    await f.refresh({commit:A,fetchImpl:()=>{throw new Error("An archived pin must not fetch.");}});
    const selected=await f.index();
    assert.equal(Object.hasOwn(selected,"currentRevision"),true);
    assert.equal(selected.currentRevision,A);
    assert.deepEqual(selected.revisions,[A,B]);
   }
  }finally{
   if(original)Object.defineProperty(Object.prototype,"currentRevision",original);
   else delete Object.prototype.currentRevision;
  }
 });
});
