import {defineConfig} from "@playwright/test";
import fs from "node:fs";
const chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port=Number(process.env.EDGELAB_DRAWING95_PORT??45195);
export default defineConfig({
 testDir:".",testMatch:"drawing-settings95.interaction.spec.ts",
 outputDir:"../.artifacts/drawing-settings95/results",reporter:"list",workers:1,retries:0,timeout:45000,expect:{timeout:10000},
 use:{baseURL:`http://127.0.0.1:${port}`,browserName:"chromium",launchOptions:fs.existsSync(chrome)?{executablePath:chrome}:undefined,
 colorScheme:"dark",reducedMotion:"reduce",serviceWorkers:"allow",timezoneId:"UTC",locale:"en-US",video:"off",trace:"off",screenshot:"only-on-failure"},
 webServer:{command:`npm run preview -- --port ${port} --strictPort`,cwd:"../frontend",url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:30000},
 projects:[{name:"desktop",use:{viewport:{width:1440,height:1000},deviceScaleFactor:1}},{name:"mobile",use:{viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true}}]
});
