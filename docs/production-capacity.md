# Production capacity and deployment

Updated 10 October 2026. Cost reductions preserve indexed SQL chart reads, full configured history, Redis caching/admission, PgBouncer, API worker defaults and background ingestion/analytics. The new-install efficient overlay consolidates the two database servers into one PostgreSQL server; it does not impose lower CPU quotas or turn off product features. Consolidation is optional because database isolation can be valuable under heavy ingestion.

## Architecture and operating cost

Use Cloudflare in front of the existing same-origin frontend/API deployment. Cache fingerprinted assets; bypass every /api/* path, including authentication, billing, downloads and WebSockets. Keep HTML and source metadata fresh. API responses and proxy errors carry no-store headers. Cloudflare reduces static origin traffic and distance to assets; it cannot remove the round trip to the origin for private operations. Configure HTTPS at the origin/load balancer and Cloudflare Full (strict); the bundled Nginx container itself listens on HTTP behind that termination.

[Cloudflare Origin Cache Control](https://developers.cloudflare.com/cache/concepts/cache-control/) documents private/no-store behavior. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) distinguishes free static asset requests from billable Worker execution. Serving a separate Pages/Workers frontend also needs an authenticated API routing design; simply changing the API to another domain is insufficient for secure cookies and OAuth. The current same-origin route avoids that change.

For a new installation:

    docker compose -f docker-compose.yml -f docker-compose.efficient.yml up -d --build

Do not switch an existing split candle store by changing a hostname alone: back up, migrate/import candles, validate counts and chart parity, and retain rollback data. The ordinary PostgreSQL path uses the same indexed bounded chart windows. The existing Timescale setup does not establish a working hypertable because its unique keys omit the partition timestamp; no compression/hypertable savings are claimed.

| Example VM | Shared CPU / month | Dedicated CPU / month | Use |
| --- | ---: | ---: | --- |
| 2 vCPU, 4 GiB | $24 | $42 | Small pilot after backfill-memory validation |
| 4 vCPU, 8 GiB | $48 | $84 | Initial candidate for a paid launch |
| 8 vCPU, 16 GiB | $96 | $168 | Only when measured traffic or ingestion needs it |

These are [DigitalOcean list prices](https://www.digitalocean.com/pricing/droplets), checked 10 October 2026, for compute alone. They exclude backups, redundant databases, extra storage/egress, monitoring and taxes. Shared CPU has variable availability; select dedicated CPU when steady tail latency matters. The 4-vCPU candidate is an engineering starting point, not a certified capacity claim. No cloud resources were purchased or deployed.

A VM with Compose has fewer orchestration components to operate at launch. Kubernetes becomes useful for required availability and deployment automation after shared-state behavior is proven; it does not by itself increase request capacity. Better Auth supports optional shared PostgreSQL storage through BETTER_AUTH_DATABASE_URL with an isolated schema, bounded pools and serialized startup migrations. The default SQLite store is limited to one auth node; independent replicas use the same direct writer endpoint, signing/service keys and public origin. Switching existing SQLite storage requires an explicit migration or re-login. The local capacity sweep below uses the default SQLite auth profile; no PostgreSQL-auth or multi-node throughput is inferred from it. Add API replicas only within the database/pooler and auth-service capacity budgets.


## Redundancy and replicas

A second container on the same VM does not survive a VM or zone failure. A redundant deployment needs independent failure domains and an entry point that removes unhealthy nodes. Cloudflare can protect/cache the frontend, but the API load balancer, PostgreSQL, Redis and auth storage also need failover.

| Layer | Redundant deployment | Capacity and consistency rule |
| --- | --- | --- |
| Frontend/API/auth | Two application nodes in separate zones behind a health-checking load balancer | Each surviving node must carry the intended peak traffic during a node failure; do not halve instance size solely because two nodes exist. |
| PostgreSQL | One writer and a standby with automatic failover and fencing, preferably managed | A standby adds availability, not double write throughput. Use the writer for auth, billing, revocation and immediate read-after-write operations. |
| Redis | One shared writer with replica/failover, preferably managed | Every application node uses the same logical endpoint and key namespace. Lost disposable counters can reset admission windows after failover. Independent caches would break invalidation and quotas. |
| Dataset files and secrets | Identical read-only dataset snapshots on every node, or a supported shared durable store; shared auth/vault keys | A node-local dataset directory is another availability dependency. Never copy SQLite auth files among live replicas. |
| Background jobs | One scheduled ingestion owner; PostgreSQL-coordinated analytics/imports | Analytics/import ownership locks already coordinate SQL writes; the filesystem populator still needs one scheduler or external ownership. |

Keep primary and synchronous standby close enough that their acknowledgement latency fits the write budget. PostgreSQL streaming replication is asynchronous by default and may lose unreplicated transactions on failover; synchronous commits wait for the standby and therefore trade write latency for a smaller data-loss window. A remote asynchronous replica plus independent backups can serve disaster recovery, with an explicit recovery point. See [PostgreSQL replication](https://www.postgresql.org/docs/current/warm-standby.html). Replication does not protect against accidental deletion; keep tested backups.

No multi-node failover was provisioned or measured here. The VM cost table is a single-node compute reference; redundant application nodes, standby databases, Redis failover, load balancing and backups add cost. Cloud replica capacity must be measured again with one node deliberately removed; local CPU tiers cannot certify that survivor capacity.

## Measurement contract

The capacity results below measure an isolated Docker stack on an Apple M4 Pro host (12 logical CPUs, 48 GiB), in a Linux guest with 8 CPUs and about 9.7 GiB RAM. Shared CPU sets constrain PostgreSQL, PgBouncer, Redis, two primary API workers, two market API workers, Better Auth and Nginx together to 2, 4 or 8 guest CPUs. RAM is unchanged between tiers. These are not measurements on 2/4/8-vCPU cloud VMs.

The synthetic dataset contains 150 distinct identities, 100 replay sessions and 1,000 closed trades per identity; three assets with three timeframe CSVs of 2,000 bars each. One M1 chart series per user is imported into SQL (300,000 total candles). Full catalog density and large historical imports are not represented by this fixture. A single fixture import took 14.67 seconds; this is an observed setup duration, not an import-capacity guarantee.

Each user loops through frontend HTML, bootstrap shell/full bootstrap, catalog, session summaries, trades, metrics summary/curves, chart metadata and 300 bars, with a one-second pause per iteration. The initial sweep uses 30-second holds; conservative operating points receive separate 120-second confirmations. Endpoint and aggregate SLOs are P95 below 750ms, P99 below 1,500ms and errors below 1%. The Python histogram has 1% logarithmic buckets, so percentiles are approximate. No registered-user limit is inferred from concurrent request loops.

Native Better Auth signed tokens are verified through the actual internal HTTP session service and SQLite store on every protected request. Matching synthetic verified identities and short fresh paid leases exercise production access SQL. External Google login, expired-lease Stripe reconciliation, checkout and provider failures are excluded. API/auth have no external egress during these trials. Synthetic leases are created only in the isolated fixture, expire within 240 seconds, and add no application bypass.

The generator runs on the same physical host outside the guest. Container CPU/memory and generator CPU are sampled; an earlier pre-fix two-process comparison checked one generator constraint. A separate physical generator, real TLS/HTTP2 clients, geographical paths, packet loss, provider hardware and disk limits remain untested. Background ingestion, analytics sweeps, writes, exports, live sockets and broker/provider calls are excluded from the seven-service read sweep. Retain headroom and run those workloads before launch certification.

## Results

The final queued-admission runtime matches commit 7670530 exactly. All three 120-second confirmations below passed every endpoint SLO with zero errors, rejections or transport timeouts. Requests/s counts successful responses rather than inflating throughput with rejected attempts.

| Shared guest CPU budget | Concurrent test users | Successful requests/s | Aggregate P95 / P99 | Mean stack CPU |
| --- | ---: | ---: | ---: | ---: |
| 2 CPUs | 10 | 82.08 | 45.20 / 70.02 ms | 50.4% |
| 4 CPUs | 25 | 202.92 | 49.43 / 102.20 ms | 62.1% |
| 8 CPUs | 50 | 289.54 | 207.14 / 279.19 ms | 49.2% |

Against the same pre-admission-fix 120-second comparison points, successful throughput changed by -0.35%, -0.53% and +7.85%. No error or endpoint SLO regression was observed at these tested points. Single repeated holds are observations, not statistical proof of equivalent performance for all workloads. An earlier two-CPU 25-user point used 96.5% CPU and is excluded from the conservative operating points.

The API bounds active ordinary PostgreSQL HTTP requests using both actual per-worker SQL pool capacity and AnyIO thread tokens, before synchronous dependencies run. With 15 SQL slots and 40 thread tokens it permits 30 ordinary requests and two bounded probes, reserving eight tokens for validation/cleanup. A FIFO queue holds at most another 30 ordinary requests per worker for up to 250ms without borrowing worker threads. Queue overflow/timeouts return private 503/Retry-After; saturated probes reject immediately. Cancellation, timeout, streaming and exception tests verify slot release and FIFO transfer.

Earlier immediate-rejection candidates rejected normal 50-user bursts. The final queue eliminates those rejections in the measured normal holds while keeping overload finite:

| Eight-CPU probe | Duration | Successful requests/s | Errors | Aggregate P95 / P99 |
| --- | ---: | ---: | ---: | ---: |
| 100 test users | 30s | 341.57 | 133 controlled 503s / 10,443 attempts (1.274%) | 473.08 / 600.68 ms |
| Immediate return to 50 users | 30s | 271.68 | Zero on every endpoint | 263.01 / 340.66 ms |

There were no transport timeouts, OOMs or container restarts. The 100-user probe exceeds the error SLO and establishes overload behavior, not a supported operating capacity. Recovery followed without an intentional idle delay.

Across the final main and latency runs, peak seven-service working set was 1.743 GiB; raw container memory including file cache reached 2.252 GiB. Sampled stack CPU peaked at 5.200 cores. Guest OS memory is excluded, guest RAM remained 9.69 GiB at every tier, and no small-RAM/cloud capacity is certified. Normal identity-encoded response bodies consumed about 2.434/6.025/8.606 MB/s at the 2/4/8-CPU points; browser compression, real bandwidth and billing egress differ.

Final-image network modeling used a separate 30-second four-CPU, 25-user trial at each delay. All endpoints passed with zero errors:

| Added client-side delay per request | Successful requests/s | Aggregate P95 / P99 |
| --- | ---: | ---: |
| 0ms | 191.75 | 91.60 / 140.52 ms |
| 100ms | 109.33 | 169.76 / 231.10 ms |
| 200ms | 77.88 | 257.83 / 324.13 ms |

These simulate added request latency; they do not measure geographical paths, TLS/HTTP2, packet loss, bandwidth limits or CDN hit rates. Closed-loop users perform sequential requests, so added delay lowers offered load and throughput. Cloudflare can shorten static delivery, while authenticated API operations still need the origin round trip. Place the primary API/database near the main audience and measure real regional paths before assigning global latency targets.

The final generator peaked at 0.256 process-CPU core and 231 MiB RSS. An earlier passing pre-fix two-generator comparison differed by 2.46%; no final split-generator trial was performed, so low generator CPU alone is not certified generator headroom. CPU sets were restored, health checks passed and no load-generator process remained.

Before admission protection, an eight-CPU 100-user diagnostic produced 20.47% transport timeouts despite consuming only 1.11 CPU cores. PostgreSQL had no active queries at two snapshots, but 25 then 29 idle transactions remained held by application clients; PgBouncer had no waiting clients. This supports application thread/pool contention rather than a CPU-only limit. Exact Python stacks were unavailable, so the failure cause is an evidence-backed inference. The final queue and validation-thread reserve address this observed failure path; broader write/background/provider and HA behavior remain outside the read sweep.

Both final run provenance checks match the committed runtime digest 878b56e6c42c43920798ba34009ae021cbbe236301d813f63478594766b6538c. This fingerprint covers backend/app Python files, backend/auth top-level MJS files, start_api.sh and nginx.conf; the release frontend build separately verified its matching application source offer. Measured image IDs were API/market 02d2de304fb2, frontend 557fc5f8d5ec and auth d7b9618736ed. Private credential-free evidence retains endpoint tails, resource samples and exact immutable IDs; preceding checkout HEAD values are recorded as context, not mistaken for the later copied/committed runtime.

## Safety and recovery

Account, billing and journal data remain persistent SQL records. Redis contains disposable cache and admission counters, bounded to 256 MiB with noeviction; SQL data is not purged. A Redis restart resets admission windows. Do not use Redis for durable queues/session storage without changing this policy. Cache transport/OOM errors compute fresh uncached results, but shared invalidation and configured quota errors fail closed with retryable 503 responses. Monitor Redis memory/errors; an exhausted quota store requires remediation rather than bypass.

Pools retain five persistent connections plus up to ten overflow connections per engine/process, with a five-second pool wait and ten-second PostgreSQL connect deadline. The consolidated profile preserves the two default poolers' combined budget with 50 server connections plus ten reserve connections. Count coordinator/worker/exporter/admin connections before increasing replicas. Same-store metadata/candles share an engine and transaction; imports coordinate with PostgreSQL advisory locks. Schema migrations run before worker startup, including percent-escaped credentials, and container drain exceeds the graceful worker timeout.

Nightly backups alone can lose a day of paid records. Choose and document recovery point/time targets, use PostgreSQL WAL/PITR or a managed equivalent, back up the auth store and encrypted secret-vault keys, and prove a restore on another instance. Keep database/Redis/pooler ports private; expose only HTTPS through a trusted proxy. Configure real Google OAuth and Stripe credentials after merchant activation. Private caches must never be overridden by a cache-everything CDN rule.

The proxy image is upgraded from Nginx 1.27 to 1.30.5, which includes the [official map/regex security fix](https://nginx.org/en/security_advisories.html). This prevents shipping the affected old runtime; an application-level exploit was not demonstrated.

Astra reviewed the auth/access/export/tenant/import boundary and the final hardening changes. Import paths are now confined to configured dataset roots (including resolved symlinks), or the exact configured legacy CSV. Imported state cannot authorize arbitrary host CSV reads. This is a scoped security review, not a penetration-test certificate.

Market candles are still stored per account, so SQL candle storage scales with users times history; ordinary SQL consolidation does not remove that duplication. Imports use bounded mapping batches but still load a full CSV DataFrame. Size maximum-history imports and concurrent writes on the deployment host before selecting a small VM. A single VM is a single failure domain; uptime requirements may require separate/redundant database and application nodes.

## Verification

The clean release build, 1,331 Python tests, 2,283 JavaScript tests, Graphify and Docker configuration/image builds passed, with real PostgreSQL/PgBouncer and Redis integration checks. Six PostgreSQL auth tests cover concurrent cold migrations, Google callback transfer between replicas, signed-session sharing/revocation, failed logout without false success, readiness timeouts and migration recovery. Actual PostgreSQL/PgBouncer tests cover competing imports, shared uncommitted assets/rollback and analytics lock release. Actual Redis tests cover Lua expiry, recovery and real wire error behavior, without flushing unrelated keys. See [benchmark instructions](../benchmark/README.md) and [earlier hot-path measurements](production-performance.md) for reproduction and scope.
