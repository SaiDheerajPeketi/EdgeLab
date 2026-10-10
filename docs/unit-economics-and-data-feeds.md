# Infrastructure economics and market-data options

Checked 10 October 2026. This is an internal planning analysis, not application copy, a vendor quotation, a deployment certificate or a promise of profit. Inputs are in [cost-model.json](cost-model.json); the complete 20-row output is [cost-scenarios.csv](cost-scenarios.csv). Read alongside [measured capacity](production-capacity.md), [architecture](architecture.md) and [observability](observability.md).

## Decision

Launch economics favor a focused software product using data with explicit usage rights, then a separately costed, limited commercial candle feed. A free endpoint is not a paid-product license. Current Binance archive and Dukascopy permissions are unresolved launch blockers; real exchange order flow is also unavailable.

Under the modeled redundant infrastructure, 1,000 paying users give 67.4% delivery gross margin for software with licensed user-owned data, or 44.3% with the illustrative bundled-feed reserve. After an assumed $5,000 monthly overhead and replacement acquisition, these become 36.7% and 13.6% operating margins. These are assumptions-based forecasts, not measured business results.

The bounded heavy-history case loses money even at 5,000 payers. The current SQL schema repeats historical candles per account and has multiple overlapping indexes. Storage, licensing and customer acquisition can dominate VM compute. Reducing those costs should preserve data quality, supported history and latency; any storage redesign still requires tenant, parity, retention and provider-rights validation.

## Revenue and margin definitions

The implemented plan in [billing.py](../backend/app/services/billing.py) and [browser billing](../frontend/src/lib/billing.ts) is $29 monthly or $290 annually in USD. Annual recurring revenue contributes $24.1667 per user per month; collecting $290 upfront does not create $290 of monthly revenue.

The reference mix is 50% monthly and 50% annual: $26.5833 per payer/month before refunds. Downside uses 100% annual. All amounts exclude customer-collected GST/VAT/sales tax. If tax is absorbed into the advertised price, divide revenue by the applicable tax factor before using this model; tax registration, export treatment and recoverable credits need accountant confirmation.

- Net revenue = gross recognized subscription revenue × (1 − refund rate).
- Delivery COGS = infrastructure reserve + feed + processing/dispute allowance + customer-support allowance + company-funded AI.
- Gross profit = net revenue − delivery COGS; gross margin = gross profit / net revenue.
- Operating profit = gross profit − assumed fixed operating overhead − replacement acquisition; operating margin = operating profit / net revenue. This excludes income tax, financing and new-growth acquisition.
- Replacement acquisition = payers × assumed monthly-equivalent attrition × CAC. Here 5% × $60 = $3/payer/month. Actual monthly and annual cohorts need separate retention measurements.
- For new growth, subtract new acquired customers × actual CAC as well. Acquiring 1,000 customers at $60 costs another $60,000; the table's steady-state margin does not pay that bill upfront.

[Stripe India pricing](https://stripe.com/in/pricing) lists 4.3% for international USD presentment plus 2% when currency conversion applies. [Billing](https://stripe.com/in/billing/pricing) adds 0.7%. Conservatively treating applicable [18% fee GST](https://support.stripe.com/questions/taxes-on-stripe-fees-for-india-based-businesses) as unrecovered gives (4.3% + 2% + 0.7%) × 1.18 = 8.26%. This is a scenario for an India merchant, not the rate for every customer; small-card exemptions, input credits and negotiated terms may differ. Original processing/FX fees remain on gross collections after refunds. The additional 0.5%/1% dispute reserve covers assumed non-overlapping lost principal/fees; it is not verified chargeback adequacy.

Company-funded AI is zero here because the current [Quant adapter](../backend/app/services/quant_ai.py) requires the user's stored provider credential. It is not an included free hosted service. If EdgeLab starts paying that bill, add the cost explicitly: $5/payer/month cuts the 1,000-user reference gross margin by about 19.2 percentage points. Current policy permits 200,000 tokens/day with output accounting at $8/million; its generous accounting bound can reach $48/user over 30 days before any provider-pricing mismatch. The separate $5/day cap is not a suitable subscription inclusion budget. Company-funded use requires an actually enforced monthly allowance and atomic reservations, not a spreadsheet assumption. Open beta/free users are excluded from the payer-only model: if beta access is enabled, add their traffic, storage and support separately while assigning them zero subscription revenue.

## Infrastructure comparison

Published prices are references for comparable resources; provider regions, taxes and availability still need checkout verification. Included credits are excluded from durable unit economics.

| Option | Monthly infrastructure reference | Availability and deployment limit |
| --- | ---: | --- |
| Small software-only pilot | About $200 budget: $84 dedicated 4-vCPU/8-GiB compute + $25.20 daily VM backup + $35 storage/egress reserve + $12 monitoring + $5 object storage + $5 registry/misc, then 20% contingency | One failure domain; roughly 25 payers at the modeled history size. Validate full-history RAM, SQL disk and WAL/restore cost. A backup is not live failover. |
| Redundant VM services | About $860 before customer-dependent storage; $1,075 at 100 reference payers | Two dedicated 4-vCPU/16-GiB app nodes, shared SQL writer/standby, shared cache pair, load balancer, backups and monitor budget. Requires a deployment redesign from single-VM Compose and verified failure placement. |
| Managed Kubernetes | Same worker/database/network costs plus $40/month HA control plane, or about $48 including the model reserve | Does not make SQL/auth/data files redundant or expand capacity. Extra platform labor and daemon resource usage are unpriced. Repository deploy manifests have not certified this topology. |

[DigitalOcean compute](https://www.digitalocean.com/pricing/droplets) currently lists 4-vCPU/8-GiB shared at $48, dedicated CPU-optimized at $84, and dedicated 4-vCPU/16-GiB general purpose at $126. The model uses the larger dedicated option for memory headroom and consistent CPU availability; this is not proof of cloud performance equivalence.

The redundant fixed budget starts with two $126 app nodes, $260 PostgreSQL writer/standby, $60 cache pair, $12 monitoring, $12 regional load balancer, $5 object storage, $5 registry, $30 dataset distribution and app backups at 30%, plus 20% contingency. [PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/) lists Advanced from $130 per node with same-price standby; new Standard standby creation is restricted from 15 October 2026 for qualifying new accounts and 30 November for all accounts. Therefore a future launch should not assume the older $60 Standard HA pair will be available. Larger SQL budgets in the JSON are placeholders requiring an actual SKU/storage quote.

[Managed Valkey HA](https://docs.digitalocean.com/products/databases/valkey/details/pricing/) starts at $30 primary plus $30 standby. It is a candidate Redis-compatible service; EdgeLab's Lua, expiry, invalidation, no-eviction/fail-closed behavior and failover must be tested against it. It is not a certified replacement. [Regional load balancing](https://docs.digitalocean.com/products/networking/load-balancers/details/pricing/) starts at $12; [Kubernetes HA control-plane pricing](https://docs.digitalocean.com/products/kubernetes/details/pricing/) is $40 in addition to workers.

Hetzner is another quote candidate, particularly for Europe. Its [15 June 2026 price update](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) lists shared CPX32 at $41.99 in Europe/$57.99 Singapore and dedicated CCX23 at $101.49/$127.99, excluding IPv4/tax; [CCX23 specifications](https://www.hetzner.com/cloud/general-purpose/) are 4 vCPU/16 GB. Do not extrapolate Europe's cheapest plan to India latency, Singapore egress or steady dedicated performance. Select after regional tests and a fresh price check.

## Paying users, cost and margins

Reference assumptions: 5% peak active users, 50% annual subscribers, 2% refunds, 0.5% dispute allowance, $2/payer support and no EdgeLab-funded AI. Each account retains five symbols × three years of 24/7 M1 candles plus derived timeframes. Hardware/storage assumptions below make this intentionally heavier than a journal-only customer.

The software row assumes legally licensed imports/BYO credentials and no bundled shared feed. It does not imply the current free sources are commercially approved. The bundled row uses an illustrative $1,000/month + $5/payer feed reserve, not a vendor quote.

| Paying users | Gross recognized MRR | Infrastructure/month | Software gross margin | Bundled-feed gross margin | Software operating profit/month | Bundled operating profit/month |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 25 | $665 | $915 | −57.1% | −229.9% | −$5,447 | −$6,572 |
| 100 | $2,658 | $1,075 | 42.1% | −15.4% | −$4,202 | −$5,702 |
| 250 | $6,646 | $1,590 | 59.0% | 24.4% | −$1,909 | −$4,159 |
| 1,000 | $26,583 | $4,173 | 67.4% | 44.3% | $9,550 | $3,550 |
| 5,000 | $132,917 | $16,620 | 70.6% | 50.7% | $71,995 | $45,995 |

Within this model's 1–5,000 payer sweep, delivery first breaks even at 44 software-only payers or 128 bundled-feed payers; operating first breaks even at 366 or 660, respectively. Those thresholds depend on every listed assumption and change at hardware budget steps. They are not sales targets certified by actual churn or cloud load.

A narrowly licensed candle package could cost less than the bundled reserve. At 1,000 reference payers, replacing $6,000 total feed cost with a hypothetical all-inclusive $500 commercial quote gives approximately 65.4% gross and 34.7% operating margin. Use this only if the vendor actually confirms the symbols, display, retention, replay, exports and user rights within that quote.

## Bounded worst case and cost sensitivity

There is no finite worst-case bill for unlimited retained history, unrestricted tick/depth ingestion, unlimited company-funded AI or a traffic attack. The following is a deliberately adverse bounded scenario: 100% annual subscribers, 10% simultaneous active users, 5% refunds, 1% disputes, 20 symbols × five years of 24/7 M1/derived history per account, larger indexed-row allowance, and $5,000 fixed + $10/payer commercial feed reserve.

| Payers | Gross recognized MRR | Infrastructure/month | Feed/month | Gross margin | Operating profit/month |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | $2,417 | $3,572 | $6,000 | −335.4% | −$13,000 |
| 250 | $6,042 | $8,090 | $7,500 | −190.1% | −$16,660 |
| 1,000 | $24,167 | $30,534 | $15,000 | −116.8% | −$34,814 |
| 5,000 | $120,833 | $149,042 | $55,000 | −96.2% | −$130,439 |

The loss is mostly duplicated indexed history, not just request CPU. At 1,000 downside payers the primary provisioned SQL estimate is 83,671 GiB (~81.7 TiB), with another live copy and two retained backup equivalents. This is a dimensional model, not a measured database size or a deployable managed-database purchase; large-volume provider limits and layout require separate design and quotation.

For a simultaneous all-users-online stress, the 1,000-payer example budgets 85 app nodes and 1,000 GiB/month egress per payer; total infrastructure becomes $53,966 and operating loss $58,246/month. Actual stress capacity and protection may differ substantially because the read benchmark excluded live traffic and background work.

For the same downside history, one canonical provider-authorized dataset plus separate tenant-specific annotations would reduce the modeled primary from 83,671 GiB to about 421 GiB including journals/headroom. The storage component's illustrative saving is about $26,973/month including reserve. **That shared dataset design is not implemented.** Rights to share/retain/export, tenant isolation, compatible candle semantics and migration/rollback must be established before changing storage. The current efficient Compose overlay consolidates servers but does not remove per-account duplication.

More generally, each extra $1/payer/month of support, licensing or hosted AI removes about 3.8 percentage points from reference gross margin. Every $1,000/month fixed expense removes about 3.8 points at 1,000 reference payers and 38.4 points at 100.

## Capacity, storage, replicas and latency assumptions

The measured local four-CPU operating point is 25 concurrent synthetic read users, not 25 paying subscribers and not a real cloud VM. It excludes writes, historical backfills, exports, analytics, broker/feed calls and live sockets. The model uses 12 benchmark-equivalent active users per app node to reserve roughly half that point; this is a planning conversion needing real mixed-workload validation. Peak activity of 5%/10% is assumed, not observed user behavior.

Node count = max(2, ceil(ceil(payers × peak fraction) / 12) + 1). The extra node budgets one app-node loss only. It does not cover an entire zone if several app nodes are placed there. For two zones each able to carry the whole workload, budget at least 2 × ceil(peak / 12) app nodes: 10 instead of six in the 1,000-user reference case, another $786.24/month including backups/reserve. Database/cache failure placement, fencing, direct-writer Better Auth storage, singleton jobs and dataset distribution still require a provider-supported design. No independent-zone failover is certified by these prices.

[MarketCandle](../backend/app/models.py) keys rows by user and includes multiple unique/composite/single-column indexes. Assumed heap-plus-index bytes are 512 per base candle and 1,024 downside, not measured sizes. Derived M5/M15/M30/H1/H4/Daily rows multiply M1 by 1.33, rounded up from the full-resolution interval ratios. An additional 1.25 provision factor covers assumed free space/WAL. Journal allocation is 0.25 GiB/payer plus a 20-GiB fixed SQL base. Longer retention, bloat, more indexes, ticks/depth and larger imports can exceed these assumptions. Measure pg_total_relation_size, WAL growth, peak memory and real retained backups before purchase.

The model conservatively charges all estimated SQL GiB at $0.115/GiB per live copy and two object-backup equivalents at $0.02/GiB, without subtracting included storage. SQL PITR/WAL backups, restore throughput, regional copies and dataset files need actual sizing. VM daily snapshots do not substitute for a consistent SQL/WAL recovery policy. [Spaces pricing](https://www.digitalocean.com/pricing/spaces-object-storage) supplies the object-storage reference.

Egress uses 10/100/1,000 GiB per payer/month across reference/downside/all-online. [DigitalOcean bandwidth](https://docs.digitalocean.com/platform/billing/bandwidth/) pools the selected app nodes' included transfer and charges $0.01/GiB excess. This excludes unexpected cross-region/public-interface replication and restore traffic. Binance browser-direct streams may reduce EdgeLab egress but do not solve licensing, regional accessibility or feed connection limits.

Cloudflare can reduce static delivery distance and origin traffic; private authenticated APIs, exports and sockets remain origin operations. Use a single primary region near the early audience, measure real India/EU/US paths, and keep writer/auth/standby latency within the consistency budget. CDN cache hits do not fix a slow broker/data endpoint or make a remote synchronous SQL standby inexpensive. Never cache private responses to improve this spreadsheet.

## Are the current feeds sufficient?

They support development and selected owner-connected workflows; they are insufficient as a verified paid global feed offering.

| Current source | Implemented behavior | Launch limitation |
| --- | --- | --- |
| Binance | Browser-direct spot candles/ticker and history; populator downloads Binance Vision archives with REST fallback | One spot exchange, no configured chart trade-aggressor/depth feed. Commercial archive use needs a separate agreement. Live REST/WS permissions and regional access need separate confirmation. |
| Dukascopy | BID broker candles, broad instrument labels, server history; selected chart polls every 30 seconds | Broker prices are not consolidated exchange prints. Public terms restrict commercial use; chart/json3 endpoint, retention, replay and redistribution need written approval. |
| Angel One | Owner credentials and one upstream quote socket per browser connection for Indian markets | Broker-account access is not a shared redistribution license. Current minute-candle conversion is incorrect; validate supported instruments and feed entitlement. |
| Normalized order flow | Offline fixture and unavailable licensed-futures adapter | No production licensed futures tick/depth adapter is configured. UI availability is not evidence of real feed coverage. |
| Imported CSV | Dataset-root ingestion and replay | Users/operators must possess the rights for commercial processing, retention, sharing and exports. |

[Binance Vision terms](https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md), updated 26 August 2026, license archives noncommercially and require a separate written enterprise agreement for commercial utilization. They expressly cover derived charts/analytics. This directly affects [the populator](../backend/app/services/data_populator.py); do not automatically apply archive terms to every live endpoint. [Dukascopy terms](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/) likewise restrict commercial use without written agreement. Free download access does not remove these restrictions. [Coinbase default market-data terms](https://www.coinbase.com/legal/market_data) also do not make it an automatic free paid-app substitute.

An additional correctness defect is identified, not repaired in this documentation iteration: the [Angel parser](../backend/app/api/routes.py) forwards provider daily high/low and cumulative day volume into [minute candle construction](../frontend/src/components/EdgeLabWorkspace.tsx). The official [SmartAPI SDK](https://github.com/angel-one/smartapi-python/blob/main/SmartApi/smartWebSocketV2.py) identifies these daily fields. Taking their maxima within minute buckets is not minute OHLCV. Currency price units also need validation against [instrument documentation](https://smartapi.angelone.in/docs/Instruments), because the current parser applies /100 universally. Do not treat that chart path as validated market data for indicators or tests.

Current delivery also multiplies by users: Dukascopy chart polling implies about two upstream calls/minute per active user (2,000/minute for 1,000 active users, excluding history). Angel creates one upstream socket per browser; Binance subscriptions multiply by browser and source-series contexts. Normalized fanout is bounded/process-local, not shared distributed ingestion. Vendor quotas, reconnect/backfill, staleness and regional reachability need authorized tests; no vendor SLA was independently measured here.

## Startup data-provider shortlist

| Provider | Suitable scope | Published offer and commercial boundary |
| --- | --- | --- |
| [Twelve Data Business](https://twelvedata.com/pricing-business) | First quote for a focused global candle product: forex, crypto and selected realtime/delayed/EOD equities | Venture from $149/month; startup FAQ advertises 20% and a 12-month program, potentially $119.20/month if eligible at that tier. External display is listed, but individual/free plans are not for paid external display. Exchange-specific approvals and redistribution/export scope remain separate. |
| [Databento](https://databento.com/pricing) | Genuine exchange history, futures trades/quotes/depth and replay | $125 signup credit for historical datasets; historical usage-based purchase. Live usage-based pricing is deprecated. Many datasets permit redistribution after 24 hours, but each publisher's license controls. Current live subscriptions and external display/retention permissions need a quote. |
| [Massive](https://massive.com/business), formerly Polygon | US equity history and derived fair-market-value/minute streaming | Stocks Business $2,499/month; qualifying startups advertise 25%+ off year one (at 25%, $1,874.25). That package lists no exchange approvals/fees; FMV is a derived price, not consolidated exchange ticks/NBBO. Real exchange add-ons and enterprise redistribution rights cost separately. |
| [EODHD commercial](https://eodhd.com/financial-apis/commercial-vs-personal-license-use) | Global EOD/delayed research/reference candidate | Startup/commercial licensing by quotation. Consumer subscription prices do not license public paid display. Some data is indicative OTC/market-maker aggregation; inspect sample provenance and [disclaimer](https://eodhd.com/about). |
| [Global Datafeeds](https://globaldatafeeds.in/apis/) / [TrueData](https://www.truedata.in/products/marketdataapi) | India-specific NSE/BSE/MCX data with fewer broker-account dependencies | Commercial distribution and exchange approvals by quotation. Both appear in the [NSE authorized-vendor list](https://nsearchives.nseindia.com/web/sites/default/files/inline-files/ListofAuthoizedVendors_NSEDATA.pdf). TrueData's published exclusions include virtual-trading/simulation use, so obtain written confirmation that EdgeLab replay is permitted before choosing it. |

Start with Twelve Data for the inexpensive candle scope, Databento for real futures/order flow, and Global Datafeeds for India-specific commercial display. Keep live/delayed/EOD, broker/indicative/exchange and trade/depth granularity explicit. A paid vendor's reliability or low latency still needs a trial with representative symbols; published pricing is not a reliability test. [Twelve Data usage rights](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage) distinguish external display from redistribution. Price data outside the US needs additional commercial approval, and external ASX use requires its own license regardless of tier; the $149 entry plan is not a blanket worldwide license.

Request a quote describing paid external display, countries, professional/nonprofessional users, realtime/delay, concurrent symbols, historical retention/replay, data exports, shared snapshots, indicators/derived analytics, optional AI processing and disaster recovery. Ask whether exchange fees and reporting obligations survive the startup discount. Do not buy a personal plan and infer commercial permission.

Useful infrastructure credits are separate from data rights: [Cloudflare for Startups](https://www.cloudflare.com/startups/) advertises $10,000 for eligible bootstrapped/early-stage applicants and larger funded tiers, subject to acceptance, caps and one-year expiry. [DigitalOcean Startups](https://www.digitalocean.com/startups) offers conditional credits for 12 months; amounts and covered services vary and third-party charges are excluded. Credits reduce runway spend temporarily, not enduring product COGS. No applications were submitted or vendors contacted.

## Recalculate and verify

Change the JSON assumptions, then run this documentation-only calculator from the repository root. It writes only the scenario CSV. It does not modify billing, quotas or deployment settings.

```bash
rtk proxy python3 - <<'PY'
from pathlib import Path
import csv,json,math
m=json.loads(Path("docs/cost-model.json").read_text())
i=m["infrastructure"]
def calculate(n,s):
    gross=n*((1-s["annual_share"])*m["monthly_price"]+s["annual_share"]*m["annual_price"]/12)
    net=gross*(1-s["refund_rate"])
    peak=math.ceil(n*s["peak_active_share"])
    nodes=max(i["minimum_app_nodes"],math.ceil(peak/i["planning_active_users_per_node"])+i["spare_app_nodes"])
    tier=next(b for b in i["resource_budgets"] if b["max_peak_active"] is None or peak<=b["max_peak_active"])
    rows=s["history_symbols"]*s["history_years"]*365*1440*i["derived_timeframe_factor"]
    sql=(n*(rows*s["bytes_per_candle_with_indexes"]/2**30+i["journal_gib_per_payer"])+i["sql_fixed_gib"])*i["sql_free_space_wal_factor"]
    compute=nodes*i["app_node_monthly"]
    storage=sql*i["sql_live_copies"]*i["sql_additional_storage_per_gib"]
    backups=i["object_storage_base"]+sql*i["retained_backup_equivalents"]*i["object_storage_per_gib"]
    egress=max(0,n*s["egress_gib_per_payer"]-nodes*i["included_egress_gib_per_app_node"])*i["egress_overage_per_gib"]
    infra=(compute*(1+i["daily_app_backup_rate"])+tier["sql_pair_monthly"]+tier["cache_pair_monthly"]+tier["monitoring_monthly"]+storage+backups+egress+i["load_balancer_monthly"]+i["registry_monthly"]+i["dataset_distribution_reserve_monthly"]+i["cdn_monthly"])*(1+i["contingency_rate"])
    fees=gross*((m["payment_processing_rate"]+m["fx_rate"]+m["billing_rate"])*(1+m["unrecovered_fee_tax_rate"])+s["dispute_reserve_rate"])
    feed=s["feed_fixed_monthly"]+n*s["feed_seat_monthly"]
    support=n*m["support_cost_per_payer"]
    ai=n*m["hosted_ai_cost_per_payer"]
    cogs=fees+infra+feed+support+ai
    gp=net-cogs
    acquisition=n*m["monthly_churn_assumption"]*m["replacement_cac"]
    op=gp-m["overhead_monthly"]-acquisition
    return dict(scenario=s["id"],payers=n,peak_active=peak,app_nodes=nodes,gross_mrr=gross,net_revenue=net,primary_sql_gib=sql,infra=infra,feed=feed,payment_and_dispute_cost=fees,support=support,hosted_ai=ai,cogs=cogs,gross_profit=gp,gross_margin=gp/net*100,overhead=m["overhead_monthly"],replacement_acquisition=acquisition,operating_profit=op,operating_margin=op/net*100)
rows=[calculate(n,s) for s in m["scenarios"] for n in m["payer_counts"]]
with Path("docs/cost-scenarios.csv").open("w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=rows[0].keys())
    w.writeheader()
    w.writerows({k:round(v,2) if isinstance(v,float) else v for k,v in r.items()} for r in rows)
print(f"Generated {len(rows)} documented scenarios")

PY
```

Validation for this iteration: compare all CSV totals/margins with independent decimal arithmetic, check monotonic storage/node sizing and worst-case sensitivity, run the documentation link/fence checker and its focused tests. Runtime, merchant approval, real vendor contracts, cloud load and independent-zone recovery are unchanged and unverified here.
