import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"docs/ui-accessibility-certification.json"),"utf8"));
const run=spawnSync(process.platform==="win32"?"npx.cmd":"npx",["playwright","test","e2e/accessibility-resilience.certification.spec.ts","--reporter=json"],{cwd:root,encoding:"utf8",maxBuffer:20*1024*1024});
if(!run.stdout.trim()){process.stderr.write(run.stderr);process.exit(run.status??1);}
const report=JSON.parse(run.stdout); const counts={passed:report.stats?.expected??0,skipped:report.stats?.skipped??0,failed:report.stats?.unexpected??0};
if(run.status!==0){process.stderr.write((report.errors??[]).map(error=>error.message??String(error)).join("\n")||`Focused suite failed: ${JSON.stringify(counts)}\n`);process.exit(run.status??1);}
const expected=manifest.boundedRun.expected; assert.deepEqual(counts,expected,`Observed accessibility results differ from manifest: ${JSON.stringify(counts)}`);
fs.mkdirSync(path.join(root,".artifacts"),{recursive:true}); fs.writeFileSync(path.join(root,".artifacts/accessibility-certification-results.json"),`${JSON.stringify({measuredAt:new Date().toISOString(),counts},null,2)}\n`);
process.stdout.write(`Accessibility certification observed: ${counts.passed} passed, ${counts.skipped} skipped, ${counts.failed} failed.\n`);
