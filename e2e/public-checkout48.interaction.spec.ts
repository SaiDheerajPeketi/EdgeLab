import { expect, test, type Page } from "@playwright/test";
import { AUTH_SESSION_KEY, betaSessionResponse, FROZEN_TIME, expectStableScreenshot, gotoStable, installDeterminism } from "./support/app";

const catalog = () => ({ provider: "stripe", enabled: true, mode: "live", checkout_available: true, reason: null,
  plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }] });
const inactive = () => ({ provider: "stripe", mode: "live", configured: true, workspace_access: false, subscription_access: false,
  plan: null, status: "inactive", cadence: null, current_period_end: null, cancel_at_period_end: false, verified_at: null, refresh_required: false });
const paid = () => ({ ...inactive(), workspace_access: true, subscription_access: true, plan: "pro", status: "active", cadence: "monthly",
  current_period_end: "2027-09-15T10:00:00Z", verified_at: FROZEN_TIME });
const verifiedSession = () => ({ ...betaSessionResponse, user: { ...betaSessionResponse.user, approved: false, deployment_mode: "production",
  workspace_access: false, access_expires_at: null, is_beta_user: false, plan: "none" } });

async function fixture(page: Page, signedIn: boolean | "manual-beta" = false) {
  await installDeterminism(page);
  const state = { session: signedIn === "manual-beta" ? { ...betaSessionResponse, user: { ...betaSessionResponse.user, provider: "email" } } : signedIn ? verifiedSession() : null, catalog: catalog(), status: inactive(), catalogError: false, checkoutError: false,
    checkouts: [] as unknown[], statusReads: 0, stripeVisits: [] as string[], pageErrors: [] as string[], held: false, release: null as null | (() => void) };
  page.on("pageerror", error => state.pageErrors.push(error.message));
  await page.addInitScript(({ key, session }) => {
    if (window !== window.top) return;
    if (!session) { localStorage.removeItem(key); return; }
    const u = session.user;
    localStorage.setItem(key, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
      user: {id:u.id,email:u.email,name:u.name,provider:u.provider,approved:u.approved,betaPosition:u.beta_position,
        deploymentMode:u.deployment_mode,workspaceAccess:u.workspace_access,accessExpiresAt:u.access_expires_at,isBetaUser:u.is_beta_user,plan:u.plan} }));
  }, { key: AUTH_SESSION_KEY, session: state.session });
  await page.route("https://checkout.stripe.com/**", route => { if(route.request().isNavigationRequest())state.stripeVisits.push(route.request().url()); return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Stripe network boundary fixture</title><p>Hosted checkout boundary.</p>"}); });
  await page.route("**/api/**", async route => {
    const request=route.request(), endpoint=new URL(request.url()).pathname.replace(/^\/api/,"");
    if(endpoint==="/auth/config")return route.fulfill({json:{deployment_mode:"production",google_enabled:true,google_client_id:"public48.apps.googleusercontent.com",
      google_redirect_uri:new URL("/auth/callback/google",request.url()).href.replace("/api/", "/"),manual_access_enabled:false,dev_auth_bypass_enabled:false}});
    if(endpoint==="/auth/session")return route.fulfill(state.session?{json:state.session}:{status:401,json:{detail:"Sign in required"}});
    if(endpoint==="/auth/beta/status")return route.fulfill({json:{mode:"production",seats_total:500,seats_taken:0,seats_remaining:500,waitlist_count:0}});
    if(endpoint==="/billing/catalog")return route.fulfill(state.catalogError?{status:503,json:{detail:"Pricing provider unavailable"}}:{json:state.catalog});
    if(endpoint==="/billing/status") {
      expect(request.headers().authorization).toBe(`Bearer ${state.session!.token}`);state.statusReads++;
      return route.fulfill({json:state.status});
    }
    if(endpoint==="/billing/checkout") {
      expect(request.method()).toBe("POST");expect(request.headers().authorization).toBe(`Bearer ${state.session!.token}`);
      state.checkouts.push(request.postDataJSON());
      if(state.held)await new Promise<void>(resolve=>{state.release=resolve;});
      return route.fulfill(state.checkoutError?{status:503,json:{detail:"Checkout provider unavailable"}}:{json:{url:"https://checkout.stripe.com/c/pay/cs_live_exact_48"}});
    }
    if(endpoint==="/auth/google/exchange") {
      expect(request.postDataJSON()).toMatchObject({code:"verified-network-fixture"});
      state.session=verifiedSession();return route.fulfill({json:{session:state.session,program:{mode:"production",seats_total:500,seats_taken:0,seats_remaining:500,waitlist_count:0}}});
    }
    return route.fallback();
  });
  return state;
}
const pricing = (page: Page) => page.getByTestId("pro-pricing");
const selectYearly = async (page: Page) => { await pricing(page).getByRole("radio",{name:"Yearly"}).click(); await expect(pricing(page).getByRole("radio", {name:"Yearly"})).toBeChecked(); };

// API responses are provider/network boundary fixtures; production checkout, auth, owner guards and UI are unchanged.
test("Public prices and annual Google return require explicit purchase intent",async({page},info)=>{
  const state=await fixture(page);
  await gotoStable(page,"/pricing");
  await expect(pricing(page).getByText("$29",{exact:true})).toBeVisible();
  await expect(pricing(page).getByRole("radio",{name:"Monthly"})).toBeChecked();
  await expectStableScreenshot(page,"pricing-default");
  await selectYearly(page);
  await expect(pricing(page).getByText(/\$290 USD billed yearly/)).toBeVisible();
  if (info.project.name === "tablet") {
    await pricing(page).getByRole("radio", { name: "Yearly" }).focus();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
  await expectStableScreenshot(page,"pricing-annual");
  const signIn=pricing(page).getByRole("link",{name:"Sign in with Google"});
  const href=new URL((await signIn.getAttribute("href"))!,page.url());
  expect(href.pathname).toBe("/auth/signin");expect(href.searchParams.get("from")).toBe("/pricing?cadence=annual");
  expect(state.checkouts).toEqual([]);
  if(info.project.name==="desktop") {
    let oauthUrl="";
    await page.route("https://accounts.google.com/**",route=>{oauthUrl=route.request().url();return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Google network boundary fixture</title>"});});
    const origin=new URL(page.url()).origin;
    await signIn.click();await page.getByRole("button",{name:"Continue with Google",exact:true}).click();
    await expect.poll(()=>oauthUrl).not.toBe("");
    const oauth=new URL(oauthUrl);expect(oauth.searchParams.get("response_type")).toBe("code");
    await page.goto(`${origin}/auth/callback/google?code=verified-network-fixture&state=${encodeURIComponent(oauth.searchParams.get("state")!)}`);
    await expect(page).toHaveURL(`${origin}/pricing?cadence=annual`);
    await expect(pricing(page).getByRole("radio",{name:"Yearly"})).toBeChecked();
    await expect(pricing(page).getByRole("button",{name:"Continue to checkout",exact:true})).toBeEnabled();
    expect(state.checkouts).toEqual([]);
  }
  expect(state.pageErrors).toEqual([]);
});

test("Unavailable provider keeps announced prices honest and FAQ boundaries visible",async({page})=>{
  const state=await fixture(page,true);state.catalog={...catalog(),checkout_available:false,reason:"Stripe is not configured"};
  await gotoStable(page,"/pricing");
  await expect(pricing(page).getByText("$29",{exact:true})).toBeVisible();
  await expect(pricing(page).getByRole("button",{name:"Checkout unavailable",exact:true})).toBeDisabled();
  await expect(pricing(page).getByText(/Paid checkout is not available yet/)).toBeVisible();
  await expectStableScreenshot(page,"pricing-provider-limited");
  const faq=page.getByRole("button",{name:"Does Pro include live data and AI?"});
  await faq.click();await expect(faq).toHaveAttribute("aria-expanded","true");
  await expect(page.getByRole("region",{name:"Does Pro include live data and AI?"})).toBeVisible();
  await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
  await expectStableScreenshot(page,"pricing-faq-open");
  expect(state.checkouts).toEqual([]);expect(state.pageErrors).toEqual([]);
});

test("Explicit checkout submits cadence and provider errors can be retried",async({page})=>{
  const state=await fixture(page,true);state.checkoutError=true;
  await gotoStable(page,"/pricing?cadence=annual");
  const checkout=pricing(page).getByRole("button",{name:"Continue to checkout",exact:true});
  await expect(checkout).toBeEnabled();expect(state.checkouts).toEqual([]);
  await checkout.click();await expect(pricing(page).getByRole("alert")).toContainText("Checkout provider unavailable");
  expect(state.checkouts).toEqual([{plan:"pro",cadence:"annual"}]);expect(state.stripeVisits).toEqual([]);
  await pricing(page).getByRole("button",{name:"Refresh billing status",exact:true}).click();
  await expect(checkout).toBeEnabled();expect(state.checkouts.length).toBe(1);
  state.checkoutError=false;
  await pricing(page).getByRole("radio",{name:"Monthly"}).click();
  await expect(pricing(page).getByRole("radio",{name:"Monthly"})).toBeChecked();
  await expect(page).toHaveURL(/cadence=monthly/);
  await checkout.click();await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_live_exact_48");
  expect(state.checkouts).toEqual([{plan:"pro",cadence:"annual"},{plan:"pro",cadence:"monthly"}]);
  expect(state.stripeVisits).toEqual(["https://checkout.stripe.com/c/pay/cs_live_exact_48"]);expect(state.pageErrors).toEqual([]);
});

test("Existing paid subscription and return URLs use fresh server authority",async({page})=>{
  const state=await fixture(page,true);state.status=paid();
  await gotoStable(page,"/pricing");
  await expect(pricing(page).getByRole("link",{name:"Manage billing",exact:true})).toHaveAttribute("href","/account");
  await expect(pricing(page).getByRole("button",{name:/Continue to .*checkout/})).toHaveCount(0);
  state.status=inactive();await gotoStable(page,"/pricing?billing=success&cadence=annual");
  await expect(pricing(page).getByText(/Payment and access still need confirmation/)).toBeVisible();
  await expect(pricing(page).getByRole("link",{name:"Open workspace"})).toHaveCount(0);
  await expect(pricing(page).getByRole("button",{name:/Continue to .*checkout/})).toHaveCount(0);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).user.workspaceAccess,AUTH_SESSION_KEY)).toBe(false);
  state.status=paid();await pricing(page).getByRole("button",{name:"Refresh billing status",exact:true}).click();
  await expect(pricing(page).getByText("Your active paid subscription is confirmed.",{exact:true})).toBeVisible();
  expect(state.checkouts).toEqual([]);
  state.status=inactive();await gotoStable(page,"/pricing?billing=cancel");
  await expect(pricing(page).getByText(/does not confirm payment or cancellation/)).toBeVisible();
  expect(state.checkouts).toEqual([]);expect(state.pageErrors).toEqual([]);
});

test("Test billing is labeled and account switch aborts held checkout",async({page})=>{
  const state=await fixture(page,true);state.catalog={...catalog(),mode:"test"};state.status={...inactive(),mode:"test"};
  await gotoStable(page,"/pricing");
  await expect(pricing(page).getByText("Test billing. Test subscriptions do not grant paid workspace access.",{exact:true})).toBeVisible();
  await expect(pricing(page).getByRole("button",{name:"Continue to test checkout",exact:true})).toBeEnabled();
  state.catalog=catalog();state.status=inactive();await gotoStable(page,"/pricing");state.held=true;
  await pricing(page).getByRole("button",{name:"Continue to checkout",exact:true}).click();
  await expect.poll(()=>state.release!==null).toBe(true);
  await page.evaluate(key=>{
    const previous=localStorage.getItem(key)!,next=JSON.parse(previous);next.token="verified-second-owner";next.user.id=7002;
    const value=JSON.stringify(next);localStorage.setItem(key,value);
    dispatchEvent(new StorageEvent("storage",{key,oldValue:previous,newValue:value,storageArea:localStorage}));
  },AUTH_SESSION_KEY);
  state.session={...state.session!,token:"verified-second-owner",user:{...state.session!.user,id:7002}};
  state.release!();
  await expect(pricing(page).getByRole("button",{name:"Continue to checkout",exact:true})).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe("/pricing");expect(state.stripeVisits).toEqual([]);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).user.workspaceAccess,AUTH_SESSION_KEY)).toBe(false);
  expect(state.pageErrors).toEqual([]);
});

test("Production landing contains public plans without beta seat or waitlist labels",async({page})=>{
  const state=await fixture(page);
  await gotoStable(page,"/",{waitForNetworkIdle:false});
  await expect(page.getByRole("link",{name:/Join beta|Join waitlist/i})).toHaveCount(0);
  await expect(page.getByText(/seats open|seats claimed|waitlist live|open now/i)).toHaveCount(0);
  await expect(page.getByRole("progressbar",{name:"Beta seat capacity"})).toHaveCount(0);
  await expectStableScreenshot(page,"landing-production");
  expect(state.checkouts).toEqual([]);expect(state.pageErrors).toEqual([]);
});


test("Manual beta identity can reach Google pricing sign-in without a redirect loop",async({page},info)=>{
  test.skip(info.project.name!=="desktop","One actual auth boundary journey is sufficient; responsive pricing runs in all three projects.");
  const state=await fixture(page,"manual-beta");
  await gotoStable(page,"/auth/signin?from=%2Fpricing%3Fcadence%3Dannual");
  await expect(page).toHaveURL(/\/auth\/signin\?from=/);
  await expect(page.getByRole("button",{name:"Continue with Google",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Continue with Google",exact:true})).toBeEnabled();
  expect(state.checkouts).toEqual([]);expect(state.pageErrors).toEqual([]);
});


test("Public privacy and terms disclose production billing and identity policy",async({page})=>{
  const state=await fixture(page);
  for(const route of ["privacy","terms"]){
    await gotoStable(page,`/${route}`);
    await expect(page.getByRole("heading",{level:1})).toBeVisible();
    await expect(page.getByText("Current private beta policy",{exact:true})).toHaveCount(0);
    await expect(page.getByText(/Stripe/).first()).toBeVisible();
    await expectStableScreenshot(page,`public-${route}`);
  }
  expect(state.checkouts).toEqual([]);expect(state.pageErrors).toEqual([]);
});


test("Production landing exposes published pricing and provider FAQ after actual scrolling", async ({ page }) => {
  const state = await fixture(page);
  await gotoStable(page, "/", { waitForNetworkIdle: false });
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  const pro = pricing(page);
  await expect(pro.getByText("$29", { exact: true })).toBeVisible();
  const monthly = pro.getByRole("radio", { name: "Monthly" });
  await monthly.scrollIntoViewIfNeeded();
  await expect(monthly).toBeInViewport();
  await expect(monthly).toBeChecked();
  await expect(pro.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  await expectStableScreenshot(page, "landing-pricing-visible48", { fullPage: false });
  await page.locator("#faq").scrollIntoViewIfNeeded();
  const question = page.getByRole("button", { name: "Does Pro include live data and AI?" });
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Does Pro include live data and AI?" })).toContainText("configured providers, credentials, permissions");
  expect(state.checkouts).toEqual([]);
  expect(state.pageErrors).toEqual([]);
});
