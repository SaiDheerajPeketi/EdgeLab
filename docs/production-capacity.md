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

A VM with Compose has fewer orchestration components to operate at launch. Kubernetes becomes useful for required availability and deployment automation after shared-state behavior is proven; it does not by itself increase request capacity. Better Auth currently uses one persistent SQLite service and cannot be cloned across independent pods. Horizontal auth scaling requires a supported shared database and new session/revocation tests. Add API replicas only within the database/pooler and auth-service capacity budgets.


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

Each user loops through frontend HTML, bootstrap shell/full bootstrap, catalog, session summaries, trades, metrics summary/curves, chart metadata and 300 bars, with a one-second pause per iteration. Each load hold is 30 seconds. Endpoint and aggregate SLOs are P95 below 750ms, P99 below 1,500ms and errors below 1%. The Python histogram has 1% logarithmic buckets, so percentiles are approximate. No registered-user limit is inferred from concurrent request loops.

Native Better Auth signed tokens are verified through the actual internal HTTP session service and SQLite store on every protected request. Matching synthetic verified identities and short fresh paid leases exercise production access SQL. External Google login, expired-lease Stripe reconciliation, checkout and provider failures are excluded. API/auth have no external egress during these trials. Synthetic leases are created only in the isolated fixture, expire within 240 seconds, and add no application bypass.

The generator runs on the same physical host outside the guest. Container CPU/memory and generator CPU are sampled; a two-process comparison checks one generator constraint. A separate physical generator, real TLS/HTTP2 clients, geographical paths, packet loss, provider hardware and disk limits remain untested. Background ingestion, analytics sweeps, writes, exports, live sockets and broker/provider calls are excluded from the seven-service read sweep. Retain headroom and run those workloads before launch certification.

## Results

The final sweep is still running on the fixed Nginx 1.30.5 image. Short-hold observations so far are recorded below; they are not deployment capacity guarantees.

| Shared guest CPU budget | Short passing load | Throughput | Aggregate P95 / P99 | Higher-load result |
| --- | ---: | ---: | ---: | --- |
| 2 CPUs | 25 users | 159.60 requests/s | 158.34 / 252.75 ms | 50 passes once but fails repeated trials; 100 has 8.05% transport errors. |
| 4 CPUs | 50 users | 279.13 requests/s | 213.41 / 327.37 ms | 100 fails endpoint tails/errors despite aggregate errors below 1%. |

At these passing loads, mean stack CPU is already 94.2% and 87.9% of the two-/four-CPU budgets respectively. Repeated full-bootstrap traffic is intentionally heavy; sustained lower-load confirmations, eight-CPU and modeled-network trials are required before selecting an operating target. The earlier old-proxy baseline is a comparison of proxy releases on the same consolidated fixture, not a split-database/cloud/HA benchmark.


## Safety and recovery

Account, billing and journal data remain persistent SQL records. Redis contains disposable cache and admission counters, bounded to 256 MiB with noeviction; SQL data is not purged. A Redis restart resets admission windows. Do not use Redis for durable queues/session storage without changing this policy. Cache transport/OOM errors compute fresh uncached results, but shared invalidation and configured quota errors fail closed with retryable 503 responses. Monitor Redis memory/errors; an exhausted quota store requires remediation rather than bypass.

Pools retain five persistent connections plus up to ten overflow connections per engine/process, with a five-second pool wait and ten-second PostgreSQL connect deadline. The consolidated profile preserves the two default poolers' combined budget with 50 server connections plus ten reserve connections. Count coordinator/worker/exporter/admin connections before increasing replicas. Same-store metadata/candles share an engine and transaction; imports coordinate with PostgreSQL advisory locks. Schema migrations run before worker startup, including percent-escaped credentials, and container drain exceeds the graceful worker timeout.

Nightly backups alone can lose a day of paid records. Choose and document recovery point/time targets, use PostgreSQL WAL/PITR or a managed equivalent, back up the auth store and encrypted secret-vault keys, and prove a restore on another instance. Keep database/Redis/pooler ports private; expose only HTTPS through a trusted proxy. Configure real Google OAuth and Stripe credentials after merchant activation. Private caches must never be overridden by a cache-everything CDN rule.

The proxy image is upgraded from Nginx 1.27 to 1.30.5, which includes the [official map/regex security fix](https://nginx.org/en/security_advisories.html). This prevents shipping the affected old runtime; an application-level exploit was not demonstrated.

Astra reviewed the auth/access/export/tenant/import boundary and the final hardening changes. Import paths are now confined to configured dataset roots (including resolved symlinks), or the exact configured legacy CSV. Imported state cannot authorize arbitrary host CSV reads. This is a scoped security review, not a penetration-test certificate.

Market candles are still stored per account, so SQL candle storage scales with users times history; ordinary SQL consolidation does not remove that duplication. Imports use bounded mapping batches but still load a full CSV DataFrame. Size maximum-history imports and concurrent writes on the deployment host before selecting a small VM. A single VM is a single failure domain; uptime requirements may require separate/redundant database and application nodes.

## Verification

Required release build, Python/JavaScript tests, Graphify and Docker configuration/image builds passed. Actual PostgreSQL/PgBouncer tests cover competing imports, shared uncommitted assets/rollback and analytics lock release. Actual Redis tests cover Lua expiry, recovery and real wire error behavior, without flushing unrelated keys. See [benchmark instructions](../benchmark/README.md) and [earlier hot-path measurements](production-performance.md) for reproduction and scope.
