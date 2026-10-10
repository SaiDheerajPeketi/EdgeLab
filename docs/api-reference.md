# API reference

The running FastAPI [OpenAPI document](../backend/app/main.py) is the authoritative schema reference. Access `/docs` or `/openapi.json` directly on the API service (native default <http://127.0.0.1:8000/docs>). The public Nginx frontend proxies `/api/*`, not those root-level documentation paths. Better Auth's restricted Node endpoints are described below and are outside FastAPI OpenAPI.

See [architecture](architecture.md) for routing/storage boundaries, [configuration](configuration.md) for defaults and limits, and [maintenance](maintenance.md) for contract and migration changes.

## Route families

| Prefix | Responsibility |
| --- | --- |
| `/api/auth` | Enrollment, Google exchange, account metadata, developer sign-in and revocation |
| `/api/better-auth` | Node-owned Google redirect/callback, session inspection and sign-out |
| `/api/billing` | Catalog, checkout, customer portal, verified status and signed webhook |
| `/api/datasets` | Owned catalog/settings, discovery, refresh and catalog WebSocket |
| `/api/market-data`, `/api/live` | Historical bars, provider instruments, normalized market infrastructure and live streams |
| `/api/backtests`, `/api/trades` | Replay sessions, simulated orders/positions, advancement and replay trades |
| `/api/journal` | Canonical accounts/trades, daily notes, tags, imports and analytics |
| `/api/settings`, `/api/app-storage` | Owned display/preferences and application state |
| `/api/app-data` | Portable account transfer and durable operation receipts |
| `/api/broker-*`, `/api/integration-secrets` | Provider connections, synchronization and encrypted credentials |
| `/api/playbooks`, `/api/metrics` | Strategy metadata and performance summaries/curves |
| `/api/workspace-shares`, `/api/feedback` | Snapshot sharing and feedback |
| `/api/quant` | Models, conversations, captures, jobs, artifacts and backtests |

The same Python route set runs in `api` and `market-api`; Nginx selects the service for workload isolation. Resource IDs and client-supplied `user_id` fields never select an owner. User services apply the authenticated numeric owner; unavailable owned resources commonly return 404. Public workspace snapshots use their separate validated share-token contract.

## Authentication and account access

User routes accept `Authorization: Bearer <EdgeLab session token>`. Compose selects Better Auth; direct Python defaults to legacy sessions unless configured. Production requires verified Google identity. Existing verified legacy JWT sessions remain supported. A configured static `EDGELAB_API_TOKEN` is only for endpoints that explicitly use that dependency; it cannot replace a user session or grant workspace/billing/export authority. Browser `VITE_*` values are public build inputs.

The Better Auth sign-in flow is:

1. `POST /api/better-auth/sign-in/social` selects Google redirect sign-in.
2. Google returns to `/api/better-auth/callback/google`; the auth service verifies native state/PKCE and the nonce-bound ID token.
3. `POST /api/auth/better-auth/exchange` presents the signed session cookie with the exact configured `Origin`. FastAPI validates it through the fixed internal auth service and returns a `ba:` bearer plus account metadata.
4. `GET /api/auth/session` inspects current account/session access. `DELETE /api/auth/session` revokes the session.

Public `GET /api/better-auth/get-session` and `POST /api/better-auth/sign-out` retain native cookie/signature and origin/CSRF validation. Logout confirms server-side revocation before success; auth database failure returns retryable 503. Password signup, linking, direct ID-token login and user updates are not exposed. Better Auth failures never fall back to an independent legacy identity.

Production enrollment is public, but protected workspace routes require a current live paid plan. Explicit beta mode requires approval within its seat cap. Exact identity-only exceptions preserve account/session inspection, recovery, billing and selected removal/revocation operations after access is lost; [`ACCESS_EXEMPT`](../backend/app/services/app_data_operations.py) defines the list. New product routes require workspace authority by default. Data export always requires verified Google identity and a live active subscription, including beta mode. A successful Stripe test purchase or developer sign-in does not grant that authority.

Legacy `POST /api/auth/google/exchange` remains available when configured. Manual beta access/developer bypass are disabled in production. Developer bypass requires its flag, beta mode, local origin/CORS and a loopback request.

## Errors, caching and retry behavior

All API responses forbid browser and shared-CDN caching. Existing exact `Cache-Control: no-store` contracts, including billing and receipts, remain intact. Return headers include a safe `X-Request-ID`; a recording trace can also supply `X-Trace-ID`. Incoming request IDs must use letters, digits, dot, underscore or hyphen and be at most 128 characters; others are regenerated.

| Status | Typical meaning | Client action |
| --- | --- | --- |
| 400 | Invalid domain input, cursor or import references | Correct the request |
| 401 | Missing, expired or revoked identity | Sign in again |
| 403 | Wrong origin, missing workspace authority or paid-export entitlement | Resolve the stated access condition |
| 404 | Unknown route or unavailable owned resource | Check the selected resource |
| 409 | Conflicting state, busy dataset refresh, malformed stored settings or receipt state | Re-read/recover before changing state |
| 413 | Body or account-transfer row limit exceeded | Reduce the submitted/exported data |
| 422 | FastAPI/schema/query validation failed | Use the OpenAPI field constraints |
| 429 | Route/auth/provider admission exhausted | Honor `Retry-After` |
| 503 | Bounded request/pool overload or unavailable required dependency | Honor `Retry-After`; recover uncertain writes |
| 500 / 502 | Internal failure / upstream provider failure | Preserve the request ID and assess operation state |

HTTP exceptions generally contain `detail` and an `error` object with numeric code/message; validation and some middleware errors use their specific `detail` schema. Clients should not assume one universal error envelope. Unhandled errors return a generic message; integration-secret validation removes submitted inputs and validation context.

Admission and SQL-pool overload use 503 with `Retry-After: 1`; configured shared quota-store failures use 503 rather than independent local quotas. Google exchange quota-store errors use `Retry-After: 5`. Nginx separately limits exchange socket addresses and returns JSON 429 with `Retry-After: 6`. Forwarded headers cannot choose those admission keys. A lost/error response is not evidence that a mutation never happened: use receipts where supported instead of blindly resending it.

## Paging and stream contracts

| Endpoint | Paging contract |
| --- | --- |
| `GET /api/backtests/summaries` | Default 50, maximum 200; `offset` or opaque `cursor`, optional `status`; returns `items`, `next_offset`, `next_cursor`, `has_more` |
| `GET /api/trades/page` | Default 100, maximum 500; optional owned `session_id`, `offset` or opaque `cursor`; same page metadata |
| `GET /api/trades` | Compatibility list; default 500, maximum 2,000, offset paging |
| `GET /api/journal/trades` | Default 100, maximum 500; entry-time offset order or stable descending ID traversal |
| `GET /api/market-data/bars` | Default 300, maximum 5,000; nonnegative `offset`, optional `warmup` (default 120, maximum 1,000), owned session/dataset/timeframe selection |

Treat returned cursors as opaque and retain the same filters. For cursor traversal, send `next_cursor` with `offset=0`; stop when `has_more` is false. These are traversals of live rows, not snapshots of immutable field values. The bars response carries `offset`, `limit`, `next_offset` and bars; use its schema rather than replay-trade page assumptions.

Authenticated WebSockets send the session token in their initial message, never a query string: dataset stream uses `authToken`, Angel One stream uses `apiToken` alongside its provider payload. Each stream rechecks session/workspace authority during delivery. Dataset stream reads the committed catalog without scanning CSV directories or creating account rows. HTTP catalog/bootstrap/replay reads can discover data and commit rows; explicit refresh scans and commits before returning. Quant SSE also rechecks access and can emit `access_revoked`. A disconnect does not authorize replaying a mutation.

## Journal and settings

Journal date filters use inclusive `YYYY-MM-DD` bounds against canonical UTC entry timestamps, independent of account timezone. Reversed ranges return 422. For a complete trade traversal, request `order=id&limit=500&offset=0`, then set `before_id` to the previous page's smallest ID until fewer than 500 rows are returned. `before_id` must be positive and requires ID order; ID order forbids a nonzero offset. Default `order=entry` sorts entry time/ID descending. New higher IDs appear in the next scan.

`GET /api/journal/trades/{trade_id}` restores the canonical review, notes, tags, screenshots and executions. `PUT /api/journal/daily-notes/{note_date}` replaces the exact date/account body; null account denotes the shared note, not inheritance. Bodies preserve whitespace, allow an empty value and have a 200,000-character bound.

Settings mutations preserve unrelated stored fields and retry conditional concurrent updates:

| Endpoint | Contract |
| --- | --- |
| `PATCH /api/journal/settings` | Merge capture defaults into `edgelab/live-journal.v1`; preserve records; return acknowledged storage |
| `GET/PATCH /api/settings/chart` | Read preset/active name together; merge validated partial edits into `Settings default` and activate atomically |
| `POST /api/settings/chart/templates` | Save, delete or activate an owned template; reject absent activation targets |
| `POST /api/settings/chart/presets` | Validated drawing/Fibonacci save/delete; maximum 36/24, with no automatic eviction |
| `PATCH /api/settings/preferences` | Merge only submitted density/diagnostic-sharing fields in `edgelab/settings-center.v1` |
| `/api/app-storage/{namespace}/{key}` | Owner-scoped generic storage; drawing/Fibonacci preset writes must use their dedicated endpoint |

Chart updates retain preset order, hidden settings and unknown metadata; candle body aliases stay synchronized without replacing independent border/wick colors. Malformed stored bundles return 409 rather than being overwritten. Notebook templates continue to use `edgelab/notebook-template.v1` through generic storage.

## Account data transfer

`GET /api/app-data/export` returns `app: "edgelab"`, `version: 1`, `exported_at` and supported owner-scoped tables. It checks the total row limit before materializing data and requires live paid export authority. It never claims a write receipt.

`POST /api/app-data/import` requires explicit `app`, `version` and `tables`; optional `exported_at` is metadata. It atomically replaces all 23 supported portable tables. Omitted tables become empty, so this is a full restore, not a partial merge. Supported records cover dataset catalog/settings, application storage, playbooks, replay sessions/orders/positions/trades/executions/notes, and canonical journal accounts/trades/executions/tags/notes/screenshots/import diagnostics/checkpoints/daily notes. The exact allowlist is [`APP_DATA_TABLES`](../backend/app/api/routes.py).

IDs are preserved after distinct-positive-ID, reference and cross-owner checks. The server overwrites submitted owner IDs; retained broker-account references must belong to that owner. Authentication, operation receipts, billing, broker/integration credentials, AI service tables, CSVs and SQL candle rows are excluded. Derived summaries are cleared; restored dataset timeframes are marked not imported until candles are rebuilt. Failed inserts roll back the replacement without logging submitted values.

The default body limit is 25 MiB and transfer limit is 100,000 rows. Before import, quiesce pending account writes; after acknowledgment, discard browser mirrors/drafts before rehydrating. Portable export is not an operational backup of every service or credential.

## Durable operation recovery

Opt-in clients reserve a version-4 UUID through `POST /api/app-data/operations/{uuid}/reserve`, for example:

```json
{"method":"PUT","path":"/app-storage/edgelab/example.v1"}
```

Use the decoded API path without `/api` or query parameters. Method/path bind the ID permanently within the account. Send the actual request with the same bearer and `X-EdgeLab-Operation-Id: <uuid>`. An absent, mismatched, canceled, running or completed reservation returns 409 before the handler runs; reserving again never resets or re-executes an ID. Reservation requires workspace access. Receipt admission checks authority before claiming protected work.

`POST /api/app-data/operations/{uuid}/recover` is owner-scoped and available for recovery after workspace access is lost. It returns:

| State | Meaning |
| --- | --- |
| `canceled` | Unstarted work is fenced; an absent ID receives a tombstone blocking delayed reserve/send |
| `running` | The handler or response/background work may still be active; recovery cannot cancel it |
| `completed` | Work has ended; inspect `http_status` to distinguish success/failure |

A canceled request/process crash can leave a running receipt indefinitely; elapsed time does not prove completion. Completed errors can include partial writes. Successful imports retain only completion time and table counts. Receipts/tombstones survive imports without time-based expiry and contain no request body.

Reservation/recovery share 600 calls per owner per configured rate window (default 60 seconds) and return `Cache-Control: no-store`. One reservation plus completion check therefore permits at most 300 such operations per window. The browser holds its shared account lock through body consumption and terminal verification; uncertain receipts retain recovery markers. Exact successful import counts are required for automatic import-success recovery. High-frequency replay `advance`/`advance-compact` keep legacy markers/locks without receipts to preserve playback throughput. Older clients, other devices and scheduled writers are not globally fenced; receipt lifecycle and broader writer coordination remain future work.

## Billing

Billing is disabled until configured. `GET /api/billing/catalog` reports availability. Verified-owner `POST /api/billing/checkout` accepts `{"plan":"pro","cadence":"monthly"}` or annual cadence; `POST /api/billing/portal` accepts no customer ID or return URL. `GET /api/billing/status` reconciles provider state. Prices must be active recurring USD 2,900 cents monthly or 29,000 cents annually, interval count one, without a trial.

`POST /api/billing/webhook` verifies the raw Stripe signature for the pinned `2026-09-30.endive` API version. Event IDs are durably deduplicated; account-locked reconciliation reads current provider subscriptions rather than trusting delivery order. Checkout success URLs confer no entitlement. Workspace/export access needs a live provider snapshot newer than five minutes; failed refreshes cannot extend it. Refunds require explicit coordination with cancellation.

Test/live keys, prices, objects and customers cannot cross modes. Anonymous sandbox `rkcs_` keys are accepted only in test mode; they do not unlock production workspace or exports. See [sandbox guide](stripe-sandbox.md). Billing admission uses shared configured Redis quotas and fails closed on its outage; process-local concurrency caps and owner/global window budgets return retry guidance without caching refusals.

## Operational endpoints

| Endpoint | What it proves |
| --- | --- |
| `GET /api/health` | Application SQL checkout and `SELECT 1` succeed; it is database-backed, not a dependency-free liveness check |
| `GET /api/ready` | Same SQL check plus visible dataset directory/CSV counts; it does not validate every file/provider |
| `GET /api/ui/rollout` | Effective public rollout policy, without secret configuration |
| `GET /api/observability/metrics` | Private Prometheus scrape; excluded from admission and request traffic metrics; 404 when disabled |
| Auth service `GET /health` | Auth session-table probe succeeds and the service is not draining |

Nginx blocks the public metrics endpoint. Keep API/collector ports private; the scrape endpoint does not implement user authentication. Health/readiness use separately bounded immediate admission, so a busy response can indicate overload. Neither health response certifies Google/Stripe/provider reachability, backup recovery or failover. See [observability](observability.md) and [maintenance](maintenance.md).

The compatibility Express API in `backend/index.js` is available only when started directly or through its explicit Compose profile. New integrations should use FastAPI.
