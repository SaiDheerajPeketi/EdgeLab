import {defineConfig} from "@playwright/test";
import runtime from "./pine-runtime.config";
export default defineConfig({
 testDir:".",testMatch:"pine-strategy-markers118.interaction.spec.ts",
 outputDir:"../.artifacts/pine-strategy-markers118/browser/results",reporter:"list",workers:1,timeout:45000,
 use:{...runtime.projects![0].use,serviceWorkers:"allow",trace:"off",screenshot:"off",video:"off"},
 projects:[{name:"desktop",use:{viewport:{width:1440,height:900},deviceScaleFactor:1}},{name:"mobile",use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}}],
});
