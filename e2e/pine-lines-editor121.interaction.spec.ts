import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";

async function observed(page: Page, source: string, count: number) {
  await expect.poll(()=>page.evaluate(({source,count})=>(window as any).__layerResults.some((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source&&r.result.inputs.in_0===count),{source,count})).toBe(true);
  return page.evaluate(({source,count})=>[...(window as any).__layerResults].reverse().find((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source&&r.result.inputs.in_0===count).result,{source,count});
}
async function pixels(page: Page) {
  return page.locator(".chart-stage").first().evaluate(stage=>{
    let ink=0,layers=0;
    for(const canvas of stage.querySelectorAll("canvas")) {
      if(canvas.getBoundingClientRect().height<80)continue;
      layers++;const bytes=canvas.getContext("2d")!.getImageData(0,0,canvas.width,canvas.height).data;
      for(let i=0;i<bytes.length;i+=4)if(bytes[i]===255&&bytes[i+1]===0&&bytes[i+2]===255&&bytes[i+3]>0)ink++;
    }
    return {ink,layers};
  });
}

test("actual editor adds saved Pine line guides, reruns custom inputs, and cleans real chart ink on Hide Show Remove",async({page},info)=>{
  test.setTimeout(120_000);const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const state=await productSetup(page);
  const source='//@version=6\nindicator("Saved line guides",overlay=true,behind_chart=false)\ncount=input.int(2,"Guides",minval=1,maxval=5)\nif barstate.islast\n    for i=0 to count-1\n        line.new(0,close+i*15,bar_index,close+i*15,color=#ff00ff,width=3)';
  let dialog=await editor(page);await dialog.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source",{exact:true}).fill(source);await checkedRun(dialog);
  const preview=await observed(page,source,2);expect(preview.lines).toHaveLength(2);expect(preview.lines.every(l=>l.overlay&&l.color.toLowerCase()==="#ff00ff")).toBe(true);
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
  await expect.poll(()=>state.storage.get("custom-indicator-scripts.v1")?.some((s:any)=>s.source===source)).toBe(true);
  const saved=structuredClone(state.storage.get("custom-indicator-scripts.v1").find((s:any)=>s.source===source));
  await page.reload();dialog=await editor(page);await dialog.getByLabel("Script library",{exact:true}).selectOption(saved.id);await expect(dialog.getByLabel("EdgeLab indicator source",{exact:true})).toHaveValue(source);await checkedRun(dialog);
  const before=await page.evaluate(source=>(window as any).__layerResults.filter((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source);
  await dialog.getByRole("button",{name:"Add to chart",exact:true}).click();
  await expect.poll(()=>page.evaluate(source=>(window as any).__layerResults.filter((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,source)).toBeGreaterThan(before);
  await dialog.getByRole("button",{name:"Close indicator editor",exact:true}).click();
  const row=page.locator(".native-study-chip").filter({hasText:"Saved line guides"}).first();await expect(row).toBeVisible();
  await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(0);const originalPixels=await pixels(page);
  await row.getByRole("button",{name:"Inputs for Saved line guides",exact:true}).click();
  await row.getByLabel("Guides",{exact:true}).fill("3");const rerun=await observed(page,source,3);expect(rerun.lines).toHaveLength(3);expect(rerun.plots).toEqual([]);
  await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(originalPixels.ink);const rerunPixels=await pixels(page);
  await row.getByRole("button",{name:"Close inputs for Saved line guides",exact:true}).click();
  await page.getByRole("button",{name:"Objects",exact:true}).first().click();const object=page.locator(".indicator-object-row").filter({hasText:saved.name}).first();
  await object.getByRole("button",{name:/^On: Hide /}).click();await expect.poll(async()=>(await pixels(page)).ink).toBe(0);
  await object.getByRole("button",{name:/^Off: Show /}).click();await expect.poll(async()=>(await pixels(page)).ink).toBeGreaterThan(0);
  await page.getByRole("button",{name:"Collapse chart objects",exact:true}).click();await row.getByRole("button",{name:"Remove Saved line guides",exact:true}).click();await expect(row).toHaveCount(0);await expect.poll(async()=>(await pixels(page)).ink).toBe(0);
  expect(state.storage.get("custom-indicator-scripts.v1").find((s:any)=>s.id===saved.id)).toEqual(saved);
  const workerName=fs.readdirSync("frontend/dist/assets").find(n=>/^pine-native-worker.*\.js$/.test(n))!,worker=fs.readFileSync(path.join("frontend/dist/assets",workerName)),sha256=createHash("sha256").update(worker).digest("hex");
  expect(state.workerReceipts.length).toBeGreaterThan(0);expect(state.workerReceipts.every(r=>r.sha256===sha256&&r.bytes===worker.length)).toBe(true);expect(errors).toEqual([]);
  const output=path.resolve(".artifacts/pine-lines-editor121",info.project.name);fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,"receipt.json"),JSON.stringify({workerName,sha256,preview,rerun,originalPixels,rerunPixels,workerReceipts:state.workerReceipts,errors},null,2));
});
