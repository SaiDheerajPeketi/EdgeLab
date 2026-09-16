import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const ledger=JSON.parse(fs.readFileSync(path.join(root,"docs/ui-route-accessibility-sweep.json"),"utf8"));
const routes=Object.entries(ledger.routes).filter(([,entry])=>(entry as {mode:string}).mode==="test") as Array<[string,{mode:"test";path:string}]>;
test.describe("inventory default-state route accessibility sweep",()=>{
 test.beforeEach(async({page})=>{await installDeterminism(page,{liveFeedState:"connecting"});await seedApprovedSession(page);await seedChartLayout(page,"single");});
 for(const [route,entry] of routes)test(route,async({page})=>{
  test.setTimeout(60_000); await gotoStable(page,entry.path,{waitForNetworkIdle:false});
  const mains=page.locator('main:not(main main), [role="main"]:not(main *)'); await expect(mains).toHaveCount(1);
  const main=mains.first(); await expect(main).toBeVisible();
  expect(await main.locator('h1,h2,[aria-label]').count()).toBeGreaterThan(0);
  await page.addScriptTag({content:axe.source});
  const severe=await page.evaluate(async()=> (await window.axe.run(document,{resultTypes:["violations"]})).violations.filter(item=>item.impact==="critical"||item.impact==="serious").map(item=>`${item.id}: ${item.nodes.map(node=>node.target.join(" ")).join(", ")}`)); expect(severe).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  const skip=page.locator('a[href^="#"]').first(); await expect(skip).toHaveCount(1); const skipTarget=await skip.getAttribute("href"); expect(skipTarget).toMatch(/^#.+/); await skip.focus(); await skip.press("Enter"); await expect(page.locator(skipTarget!)).toBeFocused();
 });
});
function horizontalOverflow(page:Page){return page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);}
declare global{interface Window{axe:typeof axe}}
