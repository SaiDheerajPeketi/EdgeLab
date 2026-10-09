import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = (await build({ banner: { js: `import {createRequire} from "node:module"; const require=createRequire(${JSON.stringify(import.meta.url)});` }, bundle: true, define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' }, format: "esm", platform: "node", target: "node22", write: false, logLevel: "silent",
  stdin: { contents: `export * from "./frontend/src/lib/billing.ts"; export * from "./frontend/src/lib/authSession.ts"; export * from "./frontend/src/lib/authJourney.ts";
    import React from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {MemoryRouter} from "react-router-dom";
    import {PricingSection} from "./frontend/src/components/marketing/PricingSection.tsx";
    export function betaPricingMarkup(){return renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:["/pricing"]},React.createElement(PricingSection,{mode:"beta",showComparison:true})));}`,
    loader: "tsx", resolveDir: root, sourcefile: "checkout-test-entry.tsx" },
})).outputFiles[0].text;
let instance = 0;
const fresh = () => import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}#${++instance}`);
const catalog = () => ({ provider: "stripe", enabled: true, mode: "live", checkout_available: true, reason: null,
  plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }] });
const inactive = () => ({ provider: "stripe", mode: "live", configured: true, workspace_access: false, subscription_access: false,
  plan: null, status: "inactive", cadence: null, current_period_end: null, cancel_at_period_end: false, verified_at: null, refresh_required: false });
const owner = () => ({ createdAt: new Date(Date.now()-1000).toISOString(), expiresAt: new Date(Date.now()+3600000).toISOString(), token: "verified-owner-A",
  user: { id: 42, email: "owner@example.test", name: "Owner", provider: "google", approved: false, betaPosition: null,
    deploymentMode: "production", workspaceAccess: false, accessExpiresAt: null, isBetaUser: false, plan: "none" } });

async function harness(run) {
  const saved = { window: globalThis.window, fetch: globalThis.fetch };
  const values = new Map(), transient = new Map(), calls = [], listeners = new Map();
  const state = { catalog: catalog(), status: inactive(), url: "https://checkout.stripe.com/c/pay/cs_live_authenticated_48", before: null };
  globalThis.window = { sessionStorage: {getItem:k=>transient.get(k)??null,setItem:(k,v)=>transient.set(k,String(v)),removeItem:k=>transient.delete(k)}, localStorage: {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},
    dispatchEvent:event=>{for(const fn of listeners.get(event.type)??[])fn(event);return true;}, addEventListener:(type,fn)=>listeners.set(type,[...(listeners.get(type)??[]),fn]),
    removeEventListener:(type,fn)=>listeners.set(type,(listeners.get(type)??[]).filter(x=>x!==fn)) };
  const module = await fresh();
  globalThis.fetch = async (url, init={}) => {
    const path = new URL(String(url),"http://fixture.test").pathname.replace(/^\/api/, "");
    const call = {path,method:init.method??"GET",authorization:new Headers(init.headers).get("authorization"),body:init.body?JSON.parse(init.body):null};
    calls.push(call); if(state.before) await state.before(call,module);
    if(path==="/billing/catalog")return Response.json(state.catalog);
    if(path==="/billing/status")return Response.json(state.status);
    if(path==="/billing/checkout")return Response.json({url:state.url});
    throw new Error(`Unexpected network boundary ${path}`);
  };
  try {await run({module,state,calls,values,transient});}
  finally {if(saved.window===undefined)delete globalThis.window;else globalThis.window=saved.window;globalThis.fetch=saved.fetch;}
}

test("public catalog exposes exact verified Pro amounts without a session or purchase",()=>harness(async({module,calls})=>{
  const value=await module.getBillingCatalog(); assert.deepEqual(value,catalog());
  assert.deepEqual(calls.map(c=>[c.path,c.method,c.authorization]),[["/billing/catalog","GET",null]]);
}));
for(const cadence of ["monthly","annual"]) test(`explicit ${cadence} checkout uses original owner and allowlisted payload`,()=>harness(async({module,calls})=>{
  module.setStoredAuthSession(owner());
  assert.equal(await module.createBillingCheckout(cadence),"https://checkout.stripe.com/c/pay/cs_live_authenticated_48");
  assert.deepEqual(calls.map(c=>[c.path,c.method]),[["/billing/catalog","GET"],["/billing/status","GET"],["/billing/checkout","POST"]]);
  assert.deepEqual(calls.at(-1).body,{plan:"pro",cadence});
  assert.equal(calls.at(-1).authorization,"Bearer verified-owner-A");
  assert.equal(module.getStoredAuthSession().user.workspaceAccess,false);
}));
for(const patch of [{enabled:false,checkout_available:false},{checkout_available:false,reason:"Stripe is not configured"}])test(`unavailable catalog prevents POST ${JSON.stringify(patch)}`,()=>harness(async({module,state,calls})=>{
  module.setStoredAuthSession(owner());state.catalog={...catalog(),...patch};
  await assert.rejects(module.createBillingCheckout("monthly"));assert.equal(calls.some(c=>c.method==="POST"),false);
}));
for(const patch of [{plans:[]},{plans:[{...catalog().plans[0],currency:"inr"}]},{plans:[{...catalog().plans[0],monthly_amount:1}]},{checkout_available:"yes"},{mode:"unknown"}])test(`malformed catalog fails closed ${JSON.stringify(patch)}`,()=>harness(async({module,state})=>{
  state.catalog={...catalog(),...patch};await assert.rejects(module.getBillingCatalog());
}));
for(const status of ["active","trialing","past_due","unpaid","incomplete","paused"])test(`existing ${status} subscription prevents another checkout`,()=>harness(async({module,state,calls})=>{
  module.setStoredAuthSession(owner());state.status={...inactive(),status,cadence:"annual"};
  await assert.rejects(module.createBillingCheckout("annual"));assert.equal(calls.some(c=>c.method==="POST"),false);
}));
for(const url of ["javascript:alert(1)","http://checkout.stripe.com/x","https://checkout.stripe.com.attacker.test/x","https://attacker.test/checkout.stripe.com","https://user:pass@checkout.stripe.com/x","https://checkout.stripe.com:8443/x","//checkout.stripe.com/x","https://checkout.stripe.com/x\n"])test(`malicious checkout redirect rejected ${JSON.stringify(url)}`,()=>harness(async({module,state})=>{
  module.setStoredAuthSession(owner());state.url=url;await assert.rejects(module.createBillingCheckout("monthly"));
  assert.equal(module.getStoredAuthSession().user.workspaceAccess,false);
}));
for(const boundary of ["/billing/catalog","/billing/status","/billing/checkout"])test(`owner change during ${boundary} aborts before navigation or grant`,()=>harness(async({module,state,calls})=>{
  module.setStoredAuthSession(owner());state.before=async(call)=>{if(call.path===boundary)module.setStoredAuthSession({...owner(),token:"verified-owner-B",user:{...owner().user,id:43}});};
  await assert.rejects(module.createBillingCheckout("annual"),error=>error.name==="AbortError");
  if(boundary!=="/billing/checkout")assert.equal(calls.some(c=>c.method==="POST"),false);
  assert.equal(module.getStoredAuthSession().user.workspaceAccess,false);
}));
test("provider status failure prevents purchase and grants nothing",()=>harness(async({module,state,calls})=>{
  module.setStoredAuthSession(owner());state.before=async(call)=>{if(call.path==="/billing/status")throw new Error("Provider unavailable");};
  await assert.rejects(module.createBillingCheckout("monthly"),/Provider unavailable/);assert.equal(calls.some(c=>c.method==="POST"),false);
  assert.equal(module.getStoredAuthSession().user.workspaceAccess,false);
}));
test("a missing or expired Google session cannot create checkout",()=>harness(async({module,calls})=>{
  await assert.rejects(module.createBillingCheckout("monthly"));
  module.setStoredAuthSession({...owner(),expiresAt:new Date(Date.now()-1).toISOString()});
  await assert.rejects(module.createBillingCheckout("annual"));assert.equal(calls.some(c=>c.method==="POST"),false);
}));
test("beta pricing waits for actual availability without advertising admission or granting access",()=>harness(async({module,calls})=>{
  const before=module.getStoredAuthSession();const html=module.betaPricingMarkup();
  assert.ok(html.includes("Checking beta access"));assert.ok(html.includes('data-testid="pro-pricing"'));assert.ok(html.includes("Sign in with Google"));
  assert.ok(!html.includes("Test the core workflow free."));assert.ok(!html.includes("Temporary beta workspace"));assert.ok(!html.includes("Join beta"));assert.ok(!html.includes("Continue to checkout"));
  assert.equal(calls.length,0);assert.deepEqual(module.getStoredAuthSession(),before);
}));

test("checkout destination retains original workspace only for its owner, without durable share leakage",()=>harness(async({module,values,transient})=>{
  const A=owner();module.setStoredAuthSession(A);
  const share="/shared#"+"a".repeat(64);module.rememberBillingDestination(share);
  assert.equal(module.getBillingDestination(),share);
  assert.equal([...values.values()].some(v=>v.includes(share)),false);
  module.setStoredAuthSession({...A,token:"verified-owner-B",user:{...A.user,id:43}});
  assert.equal(module.getBillingDestination(),null);module.clearBillingDestination();assert.equal(transient.size,1);
  module.setStoredAuthSession(A);assert.equal(module.getBillingDestination(),share);
  module.clearBillingDestination();assert.equal(module.getBillingDestination(),null);
  module.rememberBillingDestination("/app/journal/trades?account=7");assert.equal(module.getBillingDestination(),"/app/journal/trades?account=7");
}));
for(const value of ["/app.evil/x","//attacker.test/app","/pricing?from=/app","/account","/app%2f..%2fpricing","https://attacker.test/app"])test(`unsafe or billing return is not a workspace capability ${value}`,()=>harness(async({module})=>{
  module.setStoredAuthSession(owner());module.rememberBillingDestination(value);
  const destination=module.getBillingDestination();assert.ok(destination===null||destination==="/app");
  assert.equal(module.safeAuthDestination(value),value.startsWith("/pricing")||value==="/account"?value:"/app");
}));
