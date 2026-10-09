import {expect,type Locator} from "@playwright/test";
export async function pineList(control:Locator){
 await control.click();const id=await control.getAttribute("aria-controls");if(!id)throw new Error("Pine dropdown must own its real portalled listbox");
 const list=control.page().locator('[id="'+id+'"]');await expect(list).toHaveAttribute("role","listbox");await expect(list).toBeVisible();return list;
}
export async function pineOptions(control:Locator,labels:string[]){const list=await pineList(control);await expect(list.getByRole("option")).toHaveText(labels);await control.press("Escape");await expect(list).toBeHidden();await expect(control).toBeFocused();}
export async function pineChoose(control:Locator,label:string,index=0){const list=await pineList(control);await list.getByRole("option",{name:label,exact:true}).nth(index).click();await expect(list).toBeHidden();await expect(control).toContainText(label);}
export async function pineLabel(control:Locator,label:string){await expect(control).toContainText(label);}
