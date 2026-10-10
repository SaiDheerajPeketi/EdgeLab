# Maintenance, upgrades and releases

Use this playbook with the [architecture](architecture.md), [configuration](configuration.md), [setup guide](setup-and-deployment.md), and [security policy](../SECURITY.md). Commands describe repository-supported tools; provider access, actual production backups and independent-zone failover still need real deployment verification.

## Change map

| Change | Owning sources | Keep synchronized | Minimum relevant evidence |
| --- | --- | --- | --- |
| Business behavior / HTTP shape | `backend/app/api`, `services`, `schemas`; browser `lib/api.ts` | API guide, client types and owned error/paging behavior | Domain regression + real route/ownership check |
| Durable schema / indexes | `models.py`, Alembic; separate candle/auth schema paths | Migration history, backup/backfill/rollback instructions | Fresh install + representative upgrade/restore on isolated store |
| Auth / access / exports | Python auth/access/billing; `backend/auth`; browser auth journey | Provider client/server, public origin, proxy, deployment modes | Expiry/revocation/identity-switch/denied-access and real shared-auth-store gates |
| Provider / live feed | Provider service + chart feed/runtime ownership | Provenance, units, credential transport and entitlement states | Recorded controlled events + genuine provider check when claiming availability |
| Chart / Pine / UI | Browser component/runtime/worker or reviewed override | Engine manifest, namespace inventory, source offer, design/UI evidence | Independent calculation/bridge check + actual worker/chart/interaction gate |
| Cache / admission / summaries | Read models, rate limits, workers | Runtime controls, metric labels and capacity assumptions | Real Redis/PG contention, invalidation failure and bounded-work checks |
| Build / proxy / deployment | Compose, Dockerfiles, Nginx, startup, package/lock files | `.env.example`, source-release inputs, component READMEs and AGENTS | Build, rendered configs, binary/startup/private-cache checks |
| Observability | `observability.py`, Gunicorn hooks, `docker/observability` | Bounds, redaction, image pins, rules, dashboards and docs | Multiworker lifecycle, full streaming timing, exporter failure/shutdown and live collector checks |
| Documentation / comments | Canonical guide and owning boundary | Related links and source evidence | Local link/anchor/fence check; no behavioral regression invented for prose |

Avoid unrelated refactors and duplicate authorities. API/runtime behavior wins over a stale README; correct the guide in the same iteration. A meaningful boundary change should include a short [architecture decision](decisions/README.md).

## Dependency upgrades

1. Identify the requirement or advisory and read the pinned dependency's official release notes. Confirm runtime support and license implications before selecting a version.
2. Upgrade a bounded family of related packages. Use the package manager to update manifests/locks; do not manually fabricate integrity hashes or silently edit installed packages.
3. Check API changes, serialization, storage/migration and failure behavior in source. Preserve old data and supported compatibility paths.
4. Run family-specific regression checks and the applicable release gates below. Audit the actual resulting dependency set and build images from the reviewed checkout.
5. Record the concrete behavior/compatibility change and retain an image/commit/data recovery point. Do not combine a dependency experiment with an irreversible production migration.

| Family | Upgrade-sensitive contract |
| --- | --- |
| Node / Better Auth | Node 22.13+ native SQLite support; align browser/server Better Auth versions; validate native public CSRF/origin flow, SQLite and direct-PG migration, expiry and confirmed cross-replica revocation |
| Python / SQLAlchemy / psycopg | Connection options, bounded pools, transaction semantics, pooler compatibility, UTC values, migrations and SQLite compatibility |
| PostgreSQL / Timescale / PgBouncer | Supported image/database format, extensions, driver preparation policy and total pool budget; major database upgrades need a documented migration, not a changed image tag |
| OpenTelemetry | Core/exporter/SDK/instrumentation versions form a family; custom exporter and batch shutdown use pinned SDK lifecycle internals. Revalidate one-attempt failure, timeout/redirect, bounded shutdown, remote sampling and query/SQL/resource redaction |
| PineTS / engine dependencies | `scripts/pine-engine.mjs` verifies package/source-map/declaration/original/override hashes and namespace provenance. Review readable sources and manifest together, keep upstream unchanged, run genuine minified-worker/bridge/source-offer checks |
| React / router / Zustand / chart library | Async account ownership, route remounting/callback lifetime, stored presets, drawing/indicator placement, autoscale/viewport, theme/focus and bundle budgets |
| Nginx / monitoring images | Binary config compatibility, proxy routing/cache/security semantics, collector labels, volume ownership, retention and private ports; monitor image overrides are controlled upgrades |

JavaScript exact installation versions are in the root lockfile even where package ranges exist. Python runtime requirements are pinned; audit-tool development requirements intentionally have a bounded range. Never remove license/provenance notices to make a build pass.

## Schema and storage changes

Application migrations live in `backend/alembic`. Auth uses its native migration adapter; candle initialization has a separate schema path. They must be reviewed together when a storage boundary changes. Startup `create_all` does not migrate an existing application's changed columns/indexes.

For compatibility-sensitive deployments prefer **expand → backfill → switch reads/writes → contract**. Keep old/new code compatible during overlap, bound backfill transactions and resource use, record completion, then remove old fields only after the rollback window. Review tenant scope, unique/index keys, lock ordering and idempotency. Rehearse against representative full history, not an empty database.

Switching to the efficient overlay does not transfer an existing candle store. Preserve dataset/account identities and validate row counts, representative chronological windows, source hashes and replay results before directing reads to the new writer. Switching Better Auth SQLite to PostgreSQL does not transfer sessions automatically; migrate explicitly or require re-login, preserving application accounts and entitlements.

## Backup and restore

Inventory the actual configured stores and mounts, including application SQL, candle SQL, auth sessions, datasets/manifests, uploads/capture files, and the vault/signing keys required to read or authenticate restored data. Store sensitive backups encrypted with limited access, retention and a recovery copy outside the failure domain.

A PostgreSQL logical dump is transaction-consistent for its database; it is not a coordinated snapshot across separate writers and files. Quiesce dependent writes or use an appropriate coordinated snapshot/recovery plan when consistency spans stores. Use SQLite's online backup mechanism or stop the writer before copying its database; copying just a live `.db` without WAL/transaction handling is unsafe. Do not assume a Docker volume is backed up because it survives a restart.

Restore into an isolated environment. Check schema revision, tenant counts, representative trade/journal/replay windows, encrypted-secret readability, auth behavior and paid-access boundaries. Point callbacks/providers at test destinations and keep external billing/broker work disabled during rehearsal. Measure actual recovery time and acceptable recovery point; there is no repo-wide certified RTO/RPO.

The deployment instance snapshot utility copies a configured checkout and can include history/configuration containing credentials. It is neither a sanitized source offer nor an application data backup. Restrict its access and inspect it before sharing. The `/source/` archive is a public matching build-source offer and must never include backups, secrets, datasets or internal planning records.

## Validation tiers

Use the smallest check that proves the affected behavior, then run required release gates for code/deployment changes. A passing suite with skipped integration tests is not equivalent to real-store verification.

| Tier | Command / evidence | What it establishes |
| --- | --- | --- |
| Docs | `npm run check:docs` | Maintained local link/anchor targets and fenced blocks; not external URL availability or semantic truth |
| Baseline | `npm run build`; `PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests`; `npm test` | Production TS/bundle/source-offer build and Python/JS regression suite for the supplied environment |
| Real stores | Supply `EDGELAB_TEST_REDIS_URL`, `EDGELAB_TEST_POSTGRES_URL`, `EDGELAB_TEST_AUTH_POSTGRES_URL` to the relevant suites | Real cache Lua/error behavior, SQL contention/locks and auth PG migration/revocation; use isolated disposable stores |
| UI | Existing `quality:ui`, Playwright and feature-specific configs | Actual interaction, chart/worker rendering, accessibility, motion, source placement and owned state |
| Deployment | Default/local/efficient/profile Compose render; image builds; proxy/collector validators; health/private-route checks | The exact configuration/image starts and routes correctly in the tested environment |
| Providers | Real Google, Stripe, broker/feed/AI checks with authorized test credentials | The specific configured provider boundary; fixtures alone cannot certify it |
| Performance/recovery | Distinct-user representative load, full-wall endpoint SLOs, resource and generator headroom, network/failure/restore measurements | The recorded hardware/data/identity topology and recovery scenario, not arbitrary customer counts |

Run `graphify update .` after code changes to refresh the local code graph. Its output is analysis/generated material, not a substitute for tests or committed source.

The existing GitHub UI workflow runs baseline and focused browser gates; the security workflow audits npm dependencies and Python runtime requirements. Default CI does not supply the three real-store URLs and can skip those integration gates. Audits do not cover all image/OS or Python development dependencies. Preserve private CI artifacts and report actual test counts/skips from the run, not a fixed number copied from a previous release.

## Release procedure

1. Choose a reviewed commit and inspect the working tree; preserve user edits and private data. Confirm supported runtime versions, dependency/engine integrity and license/source-offer inputs.
2. Review configuration diff with secrets redacted. Match browser/API deployment mode and public origin; validate distinct signing/service/vault keys, live/test billing separation, mount paths and total pool budgets.
3. Build immutable API/browser/auth images from the same checkout and run the applicable gates. Preserve the prior images and their configuration. Building should precede interrupting a running service.
4. Back up and rehearse migrations/restore. Verify old/new compatibility or plan an explicit controlled maintenance interval. Run initialization in the designed order, with dependent services waiting for readiness.
5. Deploy through the operator's configured mechanism. Check health/readiness, sign-in/session revocation, representative owned reads/writes, subscription/export decisions, cache invalidation, private/no-store routes and telemetry. A started container is not sufficient evidence of a successful release.
6. Measure errors/latency/resources through the acceptance window. Record the commit/configuration/schema, evidence and rollback decision. Independent replicas must pass survivor/failover checks before HA claims.

The existing `Jenkinsfile` is a legacy host-specific path: it hard-resets a deployment checkout, stops Compose, performs daemon-wide pruning, omits auth from its explicit build list, and lacks a complete backup/QA/readiness/rollback gate. Do not treat it as the approved production release playbook or run it on a shared Docker host. Replacing that pipeline requires a separately reviewed/tested deployment change; these documentation changes do not activate a new production deployment.

## Rollback and incidents

An image rollback is safe only if the current schema/configuration remains compatible. Destructive migrations may require restoring a coordinated backup or a forward fix; blindly running an Alembic downgrade is not a rollback plan. Reconcile external Stripe/provider events that arrived after the backup point before re-enabling affected work.

During overload retain validation/probe reserves, inspect admission and SQL/cache pressure, and reduce nonessential background work only through tested controls. Queue enlargement increases wait, not capacity. During telemetry failure preserve authorization and privacy; requests must not wait for collectors. Use the [observability runbook](observability.md) and the recorded [capacity/recovery limits](production-capacity.md).

Cleanup must target the owned Compose project/profile and intentionally preserve durable volumes. Avoid daemon-wide prune, `down -v`, hard reset of user changes, arbitrary metrics-directory deletion or copying private fixtures into source offers. Temporary resource coordination must be honored: do not restart another project's stopped VM or run reserved native workloads until resources are released.

## Documentation and comments

Root/component READMEs are entrypoints; detailed contracts live in `docs/`. Keep [the index](README.md) current and use links rather than duplicate defaults. Feature/reference notes should describe current behavior with tests/source references and explicit compatibility limits, not accumulate unreviewed launch promises.

Add comments at ownership, transaction, ordering, units and security boundaries. Explain why a seemingly simpler change is unsafe, and link the canonical guide when useful. Remove an obsolete comment when behavior changes. Do not add noisy line-by-line narration or make comments a second configuration authority.

When editing Mermaid, parse and render every changed diagram with the actual renderer before committing. The documentation checker validates Markdown fences and links, not Mermaid syntax. Sequence message text must avoid raw semicolons or encode them as `#59;`; see the [Mermaid sequence syntax](https://mermaid.js.org/syntax/sequenceDiagram.html#entity-codes-to-escape-characters).
