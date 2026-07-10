# API Reference

## Overview
EdgeLab exposes two sets of APIs:
1. **Primary API (FastAPI)**: Serves all modern components, available under `/api/*` and optionally `/api/live/*`.
2. **Legacy API (Node.js/Express)**: Maintained for backward compatibility for some legacy components, available via port 3001 or the `legacy-node-api` Docker profile.

---

## Primary API (FastAPI)

These endpoints are handled by the modern Python backend.

### Observability & Health
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness probe returning basic system health. |
| `GET` | `/api/ready` | Readiness probe; validates dataset catalog connectivity. |
| `GET` | `/api/observability/metrics` | Prometheus-formatted metrics output. |

### Authentication (Beta Program)
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/beta/status` | Returns total seats and waitlist counts. |
| `GET` | `/api/auth/config` | Exposes public Google OAuth client ID and redirect URI. |
| `POST` | `/api/auth/beta/access` | Manual beta access/waitlist entry (if enabled). |
| `POST` | `/api/auth/google/exchange` | Exchanges a Google OAuth code for an EdgeLab session. |
| `GET` | `/api/auth/session` | Validates and returns current session details. |
| `DELETE`| `/api/auth/session` | Revokes the current session. |

### Market Data & Datasets
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/datasets` | Lists available dataset assets and timeframes. |
| `GET` | `/api/datasets/settings` | Gets current dataset catalog config. |
| `PATCH` | `/api/datasets/settings` | Updates dataset catalog config. |
| `PATCH` | `/api/datasets/assets/{asset_id}` | Updates visibility/metadata for a specific asset. |
| `POST` | `/api/datasets/refresh` | Triggers a scan/refresh of the dataset filesystem. |
| `GET` | `/api/datasets/refresh/status` | Polling endpoint for refresh progress. |
| `WS` | `/api/datasets/stream` | WebSocket for streaming refresh progress. |
| `GET` | `/api/market-data/meta` | Retrieves metadata (start/end dates) for a specific dataset. |
| `GET` | `/api/market-data/bars` | Retrieves candlestick data for a given backtest session or timeframe. |

### Live Feeds (Proxy)
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/live/dukascopy/instruments` | Proxy to fetch Dukascopy available instruments. |
| `GET` | `/api/live/dukascopy/candles` | Proxy to fetch raw Dukascopy historical candles. |
| `GET` | `/api/live/binance/instruments` | Proxy to fetch Binance exchange info. |
| `GET` | `/api/live/angelone/instruments` | Proxy to fetch Angel One instrument master. |
| `WS` | `/api/live/angelone/stream` | WebSocket for streaming Angel One live ticks. |

### Replay & Backtesting
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/backtests` | Lists all backtest sessions. |
| `GET` | `/api/backtests/summaries` | Paginated cursor for session summaries. |
| `GET` | `/api/backtests/strategy-summaries`| Aggregated metrics per strategy. |
| `GET` | `/api/backtests/latest` | Gets the most recently modified backtest state. |
| `POST` | `/api/backtests` | Creates a new backtest replay session. |
| `GET` | `/api/backtests/{session_id}` | Gets full state of a specific session. |
| `PATCH` | `/api/backtests/{session_id}` | Updates metadata of a session. |
| `DELETE`| `/api/backtests/{session_id}` | Deletes a session. |
| `POST` | `/api/backtests/{session_id}/advance`| Submits new orders and advances to the next candle. |
| `POST` | `/api/backtests/{session_id}/advance-compact` | Lightweight advance returning only deltas. |
| `POST` | `/api/backtests/{session_id}/jump`| Fast-forwards the replay to a specific timestamp. |
| `POST` | `/api/backtests/import-trades` | Imports historical trades from a CSV. |

### Trading Actions
| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/backtests/{session_id}/orders` | Places a limit or stop order. |
| `PATCH` | `/api/backtests/{session_id}/orders/{order_id}` | Modifies an existing pending order. |
| `DELETE`| `/api/backtests/{session_id}/orders/{order_id}` | Cancels a pending order. |
| `PATCH` | `/api/backtests/{session_id}/position` | Modifies stop-loss or take-profit of an open position. |

### Journaling & Playbooks
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/playbooks` | Lists user-defined strategies/playbooks. |
| `POST` | `/api/playbooks` | Creates a new playbook. |
| `PATCH` | `/api/playbooks/{playbook_id}`| Updates a playbook. |
| `DELETE`| `/api/playbooks/{playbook_id}`| Deletes a playbook. |
| `GET` | `/api/trades` | Lists historical trades (Legacy UI fallback). |
| `GET` | `/api/trades/page` | Cursor-based pagination for historical trades. |
| `GET` | `/api/trades/{trade_id}` | Gets details of a specific trade. |
| `PATCH` | `/api/trades/{trade_id}/strategy` | Assigns/updates a playbook strategy for a trade. |
| `PATCH` | `/api/journals/{trade_id}` | Updates subjective journal notes for a trade. |

### Analytics & Metrics
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/metrics` | Combined metrics payload (deprecated). |
| `GET` | `/api/metrics/summary` | Lightweight card-level aggregate metrics. |
| `GET` | `/api/metrics/curves` | Heavy equity/drawdown curve arrays. |

### Bootstrap & Sync
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/bootstrap-shell` | High-priority cacheable data for initial UI render. |
| `GET` | `/api/bootstrap` | Full payload including recent sessions/trades. |
| `GET` | `/api/app-data/export` | Generates a full JSON bundle of the user's data. |
| `POST` | `/api/app-data/import` | Imports a JSON bundle of user data. |
| `GET` | `/api/app-storage/{namespace}/{key}`| Reads arbitrary key-value app state (e.g. chart drawings). |
| `PUT` | `/api/app-storage/{namespace}/{key}`| Writes arbitrary key-value app state. |
| `DELETE`| `/api/app-storage/{namespace}/{key}`| Deletes arbitrary key-value app state. |

---

## Legacy Node.js API
*(Served via `backend/index.js` on port 3001 if enabled)*
- `GET /api/health`
- `/api/instruments`
- `/api/sessions`
- `/api/trades`
- `/api/analytics`
- `/api/playbooks`
- `/api/drawings`
