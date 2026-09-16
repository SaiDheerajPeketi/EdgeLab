import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const MODULE_PATH=fileURLToPath(import.meta.url); const DEFAULT_ROOT=path.resolve(path.dirname(MODULE_PATH),"..");
const ITEMS=["UIR-73","UIR-74","UIR-75","UIR-76","UIR-77","UIR-78"];
const readJson=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),"utf8"));
export function findRawCaptures(source) {return [...source.matchAll(/\.toHaveScreenshot\s*\(|\bpage\.screenshot\s*\(/g)].map(match=>source.slice(0,match.index).split("\n").length);}
export function hasCertifiedCaptureHelper(source) {
 const match=/export async function expectCertifiedScreenshot\([^\n]*\) \{\n([\s\S]*?)\n\}/.exec(source); if(!match)return false;
 const body=match[1].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,"").trim().replace(/\s+/g," ");
 return body==="await certifyUiState(page); await expect(target as Page).toHaveScreenshot(name, options);";
}
function exactTestBody(source,title){const start=source.indexOf(`test("${title}"`);if(start<0)return "";const candidates=[source.indexOf("\n  test(\"",start+1),source.indexOf("\ntest(\"",start+1)].filter(index=>index>=0);const end=candidates.length?Math.min(...candidates):source.length;return source.slice(start,end);}
function hasExecutableCriterion(criterion,body){
 if(criterion==="keyboard-open")return /\.press\("(?:Enter|ArrowDown)"\)|keyboard\.down\("Alt"\)|keyboard\.press\("(?:Control|Meta|Alt|Shift)\+/.test(body);
 if(criterion==="initial-focus")return /toBeFocused\(\)/.test(body);
 if(criterion==="tab-containment")return /assertFocusTrap\(page,/.test(body);
 if(criterion==="escape-dismiss")return /press\("Escape"\)/.test(body);
 if(criterion==="focus-return")return /press\("Escape"\)[\s\S]*toBeFocused\(\)/.test(body);
 if(criterion==="role-name")return /getByRole\(/.test(body);
 if(criterion==="coarse-target")return /expectStableScreenshot|expectCertifiedScreenshot|certifyUiState|captureState|expectReplayScreenshot|expectStateScreenshot/.test(body);
 if(criterion==="viewport-containment")return /expectContained|assertContained|expectNoHorizontalOverflow|expectOverflowSafe|revealAndExpectRouteGeometry|expectStateGeometry|expectReplayScreenshot|expectCertifiedScreenshot|certifyUiState|captureState/.test(body);
 return false;
}
export function validateAccessibilityCertification({certification,bindings,inventory,evidence,interaction,routeSweep,root=DEFAULT_ROOT}) {
 const errors=[]; if(certification.schemaVersion!==2) errors.push("Certification schemaVersion must be 2.");
 if(certification.coverage!=="exhaustive") errors.push("Coverage must be exhaustive.");
 const families={routes:inventory.routes.map(x=>x.path),panels:inventory.panels,overlays:inventory.overlays};
 for(const [family,values] of Object.entries(families)){if(certification.surfaceCounts?.[family]!==values.length) errors.push(`${family} count must match inventory (${values.length}).`); for(const value of certification.representatives?.[family]??[]) if(!values.includes(value)) errors.push(`Unknown ${family} representative: ${value}.`); if(!(certification.representatives?.[family]?.length>0)) errors.push(`${family} must have a representative.`);}
 if(Object.keys(evidence.routeGaps??{}).length) errors.push("Source evidence still has route gaps.");
 for(const family of ["panels","overlays"]) for(const entry of Object.values(evidence[family]??{})) for(const state of Object.values(entry.states??{})) if(state.gap) errors.push(`Source evidence still has a ${family} gap.`);
 for(const item of ITEMS){const c=certification.workItems?.[item]; if(c?.status!=="Complete") errors.push(`${item} must be Complete after exhaustive certification.`); if(!Array.isArray(c?.checks)||!c.checks.length) errors.push(`${item} must declare checks.`);}
 const requiredBindings=ITEMS.flatMap(item=>(certification.workItems?.[item]?.checks??[]).map(check=>`${item}:${check}`));
 for(const key of requiredBindings){const binding=bindings.bindings?.[key]; if(!binding){errors.push(`Missing executable binding: ${key}.`);continue;} const sourcePath=path.join(root,binding.spec??""); if(!fs.existsSync(sourcePath)){errors.push(`Binding ${key} has missing spec.`);continue;} if(!fs.readFileSync(sourcePath,"utf8").includes(binding.marker??"")) errors.push(`Binding ${key} marker is absent from ${binding.spec}.`); const surface=binding.surface??{}; const values=families[surface.family]??[]; if(!values.includes(surface.name)) errors.push(`Binding ${key} references unknown surface.`); const catalog=surface.family==="routes"?inventory.routes.find(x=>x.path===surface.name)?.states:surface.family==="panels"?inventory.panelStates?.[surface.name]:inventory.overlayStates?.[surface.name]; if(!catalog?.includes(surface.state)) errors.push(`Binding ${key} references unknown state ${surface.state}.`); for(const viewport of surface.viewports??[]) if(!inventory.viewportBaselines?.[viewport]) errors.push(`Binding ${key} references unknown viewport ${viewport}.`);}
 for(const key of Object.keys(bindings.bindings??{})) if(!requiredBindings.includes(key)&&key!=="viewport:tablet") errors.push(`Undeclared accessibility binding: ${key}.`);
 if(!bindings.bindings?.["viewport:tablet"]) errors.push("A tablet execution binding is required.");
 for(const item of certification.executableEvidence??[]){const file=path.join(root,item.source??""); if(!item.source||!fs.existsSync(file)){errors.push(`Missing evidence source: ${item.source??"(none)"}.`);continue;} const source=fs.readFileSync(file,"utf8").toLowerCase(); for(const pattern of item.patterns??[]) if(!source.includes(pattern.toLowerCase())) errors.push(`Evidence pattern missing from ${item.source}: ${pattern}.`);}
 const expected=certification.boundedRun?.expected; if(![expected?.passed,expected?.skipped,expected?.failed].every(Number.isInteger)) errors.push("Bounded run must declare integer pass/skip/fail counts.");
 if(!Array.isArray(certification.gaps)||certification.gaps.length) errors.push("Exhaustive certification must have zero residual gaps.");
 const stateContract=certification.stateCertification??{};
 if(stateContract.helper!=="certifyUiState"||stateContract.scope?.includes("every non-exempt")!==true) errors.push("State certification must bind every non-exempt surface state to certifyUiState.");
 for(const standard of ["wcag2a","wcag2aa","wcag21aa","wcag22aa"]) if(!stateContract.standards?.includes(standard)) errors.push(`State certification is missing ${standard}.`);
 if(JSON.stringify(stateContract.themes)!==JSON.stringify(["dark"])) errors.push("State certification must declare the supported dark theme.");
 if(JSON.stringify([...(stateContract.densities??[])].sort())!==JSON.stringify(["comfortable","compact"])) errors.push("State certification must cover comfortable and compact densities.");
 const evidenceSpecs=new Set();
 for(const states of Object.values(evidence.routes??{})) for(const state of Object.values(states??{})) for(const item of Object.values(state??{})) if(item?.spec) evidenceSpecs.add(item.spec);
 for(const family of [evidence.panels??{},evidence.overlays??{}]) for(const entry of Object.values(family)) for(const state of Object.values(entry.states??{})) for(const item of Object.values(state.evidence??{})) if(item?.spec) evidenceSpecs.add(item.spec);
 const captureHelperPath=path.join(root,"e2e/support/app.ts"); const captureHelperSource=fs.existsSync(captureHelperPath)?fs.readFileSync(captureHelperPath,"utf8"):"";
 if(!hasCertifiedCaptureHelper(captureHelperSource)) errors.push("expectCertifiedScreenshot must audit the UI immediately before its only raw capture.");
 for(const spec of evidenceSpecs){const sourcePath=path.join(root,spec); const source=fs.existsSync(sourcePath)?fs.readFileSync(sourcePath,"utf8"):""; if(!source.includes("expectStableScreenshot")&&!source.includes("expectCertifiedScreenshot")) errors.push(`Visual evidence spec does not use the certified capture wrapper: ${spec}.`); for(const line of findRawCaptures(source)) errors.push(`Visual evidence spec uses a raw capture instead of expectCertifiedScreenshot: ${spec}:${line}.`);}
 const exhaustive=certification.exhaustiveRun??{}; const workflowPath=path.join(root,exhaustive.workflow??"");
 if(exhaustive.command!=="npm run test:ui"||!fs.existsSync(workflowPath)||!fs.readFileSync(workflowPath,"utf8").includes(exhaustive.command??"__missing__")) errors.push("Exhaustive state certification must run npm run test:ui in the UI regression workflow.");
 if(interaction?.schemaVersion!==2) errors.push("Interaction certification is missing or invalid.");
 const interactionCriteria=interaction?.criteria??[];
 for(const [family,names] of [["panels",inventory.panels],["overlays",inventory.overlays]]) for(const name of names){const [kind,spec,title]=interaction?.[family]?.[name]??[]; const exemptions=interaction?.typedExemptions?.[kind]??[]; const required=interactionCriteria.filter(item=>!exemptions.includes(item)).sort(); const proved=[...(interaction?.proofs?.[family]?.[name]??[])].sort(); if(JSON.stringify(required)!==JSON.stringify(proved)) errors.push(`Interaction proof criteria are incomplete for ${family} ${name}.`); if(spec?.startsWith("e2e/")){const sourcePath=path.join(root,spec);const source=fs.existsSync(sourcePath)?fs.readFileSync(sourcePath,"utf8"):"";const body=exactTestBody(source,title);for(const criterion of required)if(!hasExecutableCriterion(criterion,body))errors.push(`Interaction criterion ${criterion} lacks an executable assertion for ${family} ${name}.`);}}
 if(JSON.stringify(Object.keys(interaction?.panels??{}).sort())!==JSON.stringify(inventory.panels.slice().sort())) errors.push("Interaction certification must cover every panel.");
 if(JSON.stringify(Object.keys(interaction?.overlays??{}).sort())!==JSON.stringify(inventory.overlays.slice().sort())) errors.push("Interaction certification must cover every overlay.");
 if(routeSweep?.schemaVersion!==1||JSON.stringify(Object.keys(routeSweep.routes??{}).sort())!==JSON.stringify(inventory.routes.map(item=>item.path).sort())) errors.push("Route accessibility sweep must classify every route.");
 return {errors,stats:{...certification.surfaceCounts,gaps:certification.gaps?.length??0,...expected}};
}
export function runAccessibilityCertificationCheck(root=DEFAULT_ROOT){const certification=readJson(root,"docs/ui-accessibility-certification.json"); const result=validateAccessibilityCertification({certification,bindings:readJson(root,"docs/ui-accessibility-check-bindings.json"),inventory:readJson(root,certification.inventory),evidence:readJson(root,certification.evidence),interaction:readJson(root,certification.interactionCertification),routeSweep:readJson(root,certification.routeSweep),root}); if(result.errors.length) throw new Error(`UI accessibility certification invalid:\n- ${result.errors.join("\n- ")}`); return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===MODULE_PATH){try{const {stats}=runAccessibilityCertificationCheck(); console.log(`UI accessibility certification: ${stats.routes} routes, ${stats.panels} panels, ${stats.overlays} overlays; bounded run ${stats.passed} passed, ${stats.skipped} skipped, ${stats.failed} failed; ${stats.gaps} explicit gaps.`);}catch(error){console.error(error.message);process.exitCode=1;}}
