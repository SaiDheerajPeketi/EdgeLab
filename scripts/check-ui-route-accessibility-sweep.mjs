import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const inventory=JSON.parse(fs.readFileSync(path.join(root,"docs/ui-surface-inventory.json"),"utf8"));
const ledger=JSON.parse(fs.readFileSync(path.join(root,"docs/ui-route-accessibility-sweep.json"),"utf8"));
assert.equal(ledger.schemaVersion,1); assert.deepEqual(ledger.viewports,["mobile","tablet","desktop"]);
assert.deepEqual(Object.keys(ledger.routes).sort(),inventory.routes.map(route=>route.path).sort(),"Sweep ledger must exactly match route inventory.");
const kinds=new Set(["alias","redirect","boundary"]); let tested=0; let exempt=0;
for(const [route,entry] of Object.entries(ledger.routes)){if(entry.mode==="test"){tested++;assert.ok(entry.path,`${route} needs an executable path.`);}else{exempt++;assert.equal(entry.mode,"exempt",`${route} has invalid mode.`);assert.ok(kinds.has(entry.kind),`${route} has invalid exemption kind.`);assert.ok(entry.target&&entry.reason?.trim(),`${route} exemption needs target and reason.`);}}
const spec=fs.readFileSync(path.join(root,"e2e/route-accessibility-sweep.spec.ts"),"utf8"); assert.match(spec,/ui-route-accessibility-sweep\.json/); assert.match(spec,/critical.*serious/); assert.match(spec,/horizontalOverflow/); assert.match(spec,/skipTarget/);
console.log(`Route accessibility sweep: ${tested} executable routes × 3 viewports; ${exempt} typed exemptions; 28 inventoried routes.`);
