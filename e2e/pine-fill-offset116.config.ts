import { defineConfig } from "@playwright/test";
import runtime from "./pine-runtime.config";
export default defineConfig({
 testDir:".",testMatch:"pine-fill-offset116.interaction.spec.ts",
 outputDir:"../.artifacts/pine-fill-offset116/browser/results",reporter:"list",workers:1,timeout:45000,
 use:{...runtime.projects![0].use,serviceWorkers:"allow",trace:"off",screenshot:"off",video:"off"},
 projects:[{name:"desktop",use:{viewport:{width:1440,height:900}}},{name:"mobile",use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
});
