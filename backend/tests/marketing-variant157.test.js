import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function load(mode) {
  const result = await build({ bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent",
    define: { "import.meta.env": JSON.stringify({ VITE_DEPLOYMENT_MODE: mode }) },
    stdin: { contents: 'export * from "./frontend/src/lib/marketingCta.ts"; export { deploymentMode } from "./frontend/src/lib/deploymentMode.ts";', loader: "ts", resolveDir: process.cwd() } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const beta = await load("beta"), production = await load("production");

test("launch presentation and explicit plan CTA ignore a beta runtime and exhausted beta seats", () => {
  assert.equal(beta.marketingPresentationFromSearch(""), "production");
  assert.deepEqual(beta.buildMarketingCta({ mode: "production", search: "?utm_source=journal", seatsRemaining: 0 }),
    { href: "/pricing?utm_source=journal", label: "View plans", waitlist: false });
  assert.equal(beta.deploymentMode, "beta");
});

test("only the explicit beta query selects the retained public presentation", () => {
  for (const api of [beta, production]) {
    assert.equal(api.marketingPresentationFromSearch("?variant=beta"), "beta");
    for (const query of ["", "?variant=unknown", "?variant=production", "?mode=beta", "?variant=BETA"]) {
      assert.equal(api.marketingPresentationFromSearch(query), "production");
    }
  }
  assert.equal(production.deploymentMode, "production");
});

test("beta navigation retains public route queries and section fragments", () => {
  assert.equal(beta.marketingPresentationHref("/", "beta"), "/?variant=beta");
  assert.equal(beta.marketingPresentationHref("/#product", "beta"), "/?variant=beta#product");
  assert.equal(beta.marketingPresentationHref("/pricing?cadence=annual#faq", "beta"), "/pricing?cadence=annual&variant=beta#faq");
  assert.equal(beta.marketingPresentationHref("/pricing?variant=beta&cadence=annual#faq", "production"), "/pricing?cadence=annual#faq");
  assert.equal(beta.marketingPresentationHref("#pricing", "beta"), "#pricing");
});

test("public variant navigation never rewrites private, auth, billing or external destinations", () => {
  for (const href of ["/auth/signin", "/app", "/account", "/api/billing/checkout", "/privacy", "//outside.test/pricing", "https://outside.test/", "/shared#private-capability"]) {
    assert.equal(beta.marketingPresentationHref(href, "beta"), href);
  }
});

test("pricing sign-in return retains safe attribution, selected cadence and beta preview only", () => {
  const result = beta.buildMarketingPricingHref("?variant=beta&utm_source=journal&utm_campaign=launch&cadence=monthly&from=%2Fshared%23secret&billing=success&session_id=secret&token=private", "annual");
  const url = new URL(result, "https://edgelab.invalid");
  assert.deepEqual(Object.fromEntries(url.searchParams), { utm_source: "journal", utm_campaign: "launch", cadence: "annual", variant: "beta" });
  assert.equal(url.pathname, "/pricing");
  assert.equal(url.hash, "");
});

test("pricing return rejects malformed attribution and unknown preview variants", () => {
  assert.equal(beta.buildMarketingPricingHref(`?variant=unknown&utm_source=%00secret&ref=${"a".repeat(161)}&billing=cancel`, "monthly"), "/pricing?cadence=monthly");
});

test("beta admission links carry safe attribution without changing deployment or granting access", () => {
  const cta = production.buildMarketingCta({ mode: "beta", search: "?variant=beta&utm_source=journal&token=private", seatsRemaining: 0 });
  const link = new URL(cta.href, "https://edgelab.invalid");
  assert.equal(cta.label, "Join waitlist");
  assert.equal(link.pathname, "/auth/signin");
  assert.equal(link.searchParams.get("waitlist"), "1");
  assert.equal(link.searchParams.get("from"), "/app?utm_source=journal");
  assert.equal(link.searchParams.has("variant"), false);
  assert.equal(production.deploymentMode, "production");
});
