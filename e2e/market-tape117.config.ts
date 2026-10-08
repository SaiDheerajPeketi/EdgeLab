import {defineConfig} from "@playwright/test";
import landing from "./landing-dimensional.config";
const port=Number(process.env.EDGELAB_MARKET_TAPE117_PORT??45317);
export default defineConfig({
 ...landing,testMatch:"market-tape117.interaction.spec.ts",
 outputDir:"../.artifacts/market-tape117/results",
 use:{...landing.use,baseURL:"http://127.0.0.1:"+port,reducedMotion:"no-preference",screenshot:"off"},
 webServer:{...landing.webServer,command:(process.env.CI?"":"rtk ")+"npm run preview -- --host 127.0.0.1 --port "+port+" --strictPort",url:"http://127.0.0.1:"+port},
});
