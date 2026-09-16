import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const MODULE_PATH=fileURLToPath(import.meta.url); const DEFAULT_ROOT=path.resolve(path.dirname(MODULE_PATH),"..");
const ITEMS=["UIR-73","UIR-74","UIR-75","UIR-76","UIR-77","UIR-78"];
const readJson=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),"utf8"));
export function validateAccessibilityCertification({certification,inventory,evidence,root=DEFAULT_ROOT}) {
 const errors=[]; if(certification.schemaVersion!==1) errors.push("Certification schemaVersion must be 1.");
 if(certification.coverage!=="representative") errors.push("Coverage must remain truthfully marked representative.");
 const families={routes:inventory.routes.map(x=>x.path),panels:inventory.panels,overlays:inventory.overlays};
 for(const [family,values] of Object.entries(families)){if(certification.surfaceCounts?.[family]!==values.length) errors.push(`${family} count must match inventory (${values.length}).`); for(const value of certification.representatives?.[family]??[]) if(!values.includes(value)) errors.push(`Unknown ${family} representative: ${value}.`); if(!(certification.representatives?.[family]?.length>0)) errors.push(`${family} must have a representative.`);}
 if(Object.keys(evidence.routeGaps??{}).length) errors.push("Source evidence still has route gaps.");
 for(const family of ["panels","overlays"]) for(const entry of Object.values(evidence[family]??{})) for(const state of Object.values(entry.states??{})) if(state.gap) errors.push(`Source evidence still has a ${family} gap.`);
 for(const item of ITEMS){const c=certification.workItems?.[item]; if(c?.status!=="Partial") errors.push(`${item} must be Partial until exhaustive certification exists.`); if(!Array.isArray(c?.checks)||!c.checks.length) errors.push(`${item} must declare checks.`);}
 for(const item of certification.executableEvidence??[]){const file=path.join(root,item.source??""); if(!item.source||!fs.existsSync(file)){errors.push(`Missing evidence source: ${item.source??"(none)"}.`);continue;} const source=fs.readFileSync(file,"utf8").toLowerCase(); for(const pattern of item.patterns??[]) if(!source.includes(pattern.toLowerCase())) errors.push(`Evidence pattern missing from ${item.source}: ${pattern}.`);}
 const expected=certification.boundedRun?.expected; if(![expected?.passed,expected?.skipped,expected?.failed].every(Number.isInteger)) errors.push("Bounded run must declare integer pass/skip/fail counts.");
 if(!Array.isArray(certification.gaps)||!certification.gaps.length||certification.gaps.some(g=>typeof g!=="string"||!g.trim())) errors.push("Certification must enumerate nonblank residual gaps.");
 return {errors,stats:{...certification.surfaceCounts,gaps:certification.gaps?.length??0,...expected}};
}
export function runAccessibilityCertificationCheck(root=DEFAULT_ROOT){const certification=readJson(root,"docs/ui-accessibility-certification.json"); const result=validateAccessibilityCertification({certification,inventory:readJson(root,certification.inventory),evidence:readJson(root,certification.evidence),root}); if(result.errors.length) throw new Error(`UI accessibility certification invalid:\n- ${result.errors.join("\n- ")}`); return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===MODULE_PATH){try{const {stats}=runAccessibilityCertificationCheck(); console.log(`UI accessibility certification: ${stats.routes} routes, ${stats.panels} panels, ${stats.overlays} overlays; bounded run ${stats.passed} passed, ${stats.skipped} skipped, ${stats.failed} failed; ${stats.gaps} explicit gaps.`);}catch(error){console.error(error.message);process.exitCode=1;}}
