# API guide

FastAPI's OpenAPI document is the authoritative endpoint reference. Run the backend directly and open <http://127.0.0.1:8000/docs> for searchable schemas and request examples, or fetch `/openapi.json` from the API service.

All product routes use the `/api` prefix. The main route families are:

| Prefix | Responsibility |
| --- | --- |
| `/api/auth` | Beta access, Google OAuth, development sign-in, and sessions |
| `/api/datasets` | Dataset catalog, settings, refresh, and refresh streaming |
| `/api/market-data` | Historical bars and dataset metadata |
| `/api/live` | Provider-backed live instruments, candles, and streams |
| `/api/backtests` | Replay sessions, orders, positions, imports, and advancement |
| `/api/journal` | Accounts, canonical trades, tags, notes, imports, and analytics |
| `/api/broker-*` | Provider catalog, connections, synchronization, and health |
| `/api/integration-secrets` | Encrypted provider credentials and rotation |
| `/api/playbooks` | Trading playbooks and strategy metadata |
| `/api/metrics` | Summary and curve data |
| `/api/app-storage` | User-scoped application state |
| `/api/app-data` | Account data transfer and durable operation receipts |
| `/api/workspace-shares` | Read-only workspace sharing |
| `/api/quant` | Quant conversations, captures, and generated artifacts |

Operational endpoints:

- `GET /api/health` checks the application database.
- `GET /api/ready` checks the database and reports the visible dataset catalog.
- `GET /api/observability/metrics` exposes Prometheus metrics on the private service network; the public Nginx entry point blocks it.
- `GET /api/ui/rollout` returns the active UI rollout policy without exposing secrets.

## Authentication

User routes expect the EdgeLab bearer token returned by the auth flow. `EDGELAB_API_TOKEN`, when configured, protects non-user operational routes. The browser can send the same value through `VITE_API_BEARER_TOKEN`, although production deployments should prefer user-scoped sessions.

The development bypass is accepted only when `EDGELAB_DEV_AUTH_BYPASS=1` and the request is loopback-local. Do not expose it through a public reverse proxy.

Authenticated WebSocket routes receive the user session token in their first message. Tokens are never placed in WebSocket query strings, which keeps them out of proxy access logs and browser URL diagnostics.

## Journal day review

`GET /api/journal/trades` accepts inclusive `start_date` and `end_date` filters in `YYYY-MM-DD` format. Bounds apply to the canonical UTC entry timestamp, independent of the source account's timezone. Combine them with `account_id`, `offset`, and `limit` (maximum 500) to page a complete day. Reversed date ranges return 422; account filters are restricted to the authenticated owner.

For a complete history scan, request `order=id&limit=500`, then continue with `before_id` equal to the smallest ID in the previous page until a page has fewer than 500 rows. IDs are strictly descending; changing entry times or deleting records does not shift the cursor. New IDs above the first page appear on the next scan. This is a traversal of live records, not a transaction snapshot of their field values. Default `order=entry` retains entry-time/ID descending offset pagination. `before_id` must be positive and requires `order=id`; ID paging requires `offset=0`. Invalid combinations return 422.

`PUT /api/journal/daily-notes/{note_date}` replaces the body for the exact date and `account_id` scope. A null account stores a shared note. Bodies preserve whitespace, may be empty, and allow up to 200,000 characters. An account note does not inherit or overwrite the shared note. `GET /api/journal/daily-notes` accepts the same inclusive date range and optional exact account filter.

## Account operation recovery

For requests that can write portable account data, opt-in clients first send `POST /api/app-data/operations/{uuid}/reserve` with `{"method":"PUT","path":"/app-storage/edgelab/example.v1"}`. Use a canonical version 4 UUID and the decoded API path without `/api` or query parameters. The method/path bind that UUID permanently within the authenticated account. Supported scope includes account import, storage/settings, datasets, Journal, replay, playbooks, trades, broker synchronization, and Quant backtests; dataset/bootstrap/replay discovery reads are included because they can commit account rows.

Send the actual request with the same bearer token and `X-EdgeLab-Operation-Id: {uuid}`. An absent, mismatched, canceled, running, or completed reservation returns 409 before invoking the handler. Repeating reservation may inspect an existing receipt; it never resets or re-executes that ID.

`POST /api/app-data/operations/{uuid}/recover` returns `canceled`, `running`, or `completed`. Recovery cancels a reserved ID or creates a canceled tombstone for an absent ID, preventing delayed reservations or requests from starting. It never cancels an already-running handler. `completed` proves the handler has ended; inspect `http_status`, and for successful account imports, the bounded `result` containing completion time and all table counts. HTTP failure or partial writes can still yield a completed receipt. A process crash or cancellation can leave `running` indefinitely; elapsed time is not evidence of completion. Stream/background work must also finish before the receipt becomes completed.

Both endpoints require an approved account, are owner-scoped and return `Cache-Control: no-store`. They share a 600-call limit per account per configured rate-limit window. Receipts do not contain request bodies and are retained across account imports. Browser use of this protocol is still pending; existing requests without an operation header retain their current behavior.

## Compatibility API

The Express API in `backend/index.js` exists for older clients and is available only when started directly or with the `legacy-node-api` Compose profile. New integrations should use FastAPI.
