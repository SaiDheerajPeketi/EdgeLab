# UI quality and rollout contract

## State contract

Every major surface implements: empty, loading/skeleton, partial data, offline, stale, permission denied, unsupported, error, retrying, and success. Each state names what happened, what remains safe/visible, and the next action. Critical information persists until acknowledged or resolved.

## Save contract

| Setting type | Contract | Feedback |
|---|---|---|
| Binary/local preference | immediate | optimistic only with rollback; Saving → Saved or Retry |
| Text, numeric, slider | 450ms debounced | effective value remains visible; invalid input is preserved |
| Credentials, provider, import, destructive scope | explicit submit | impact summary, progress, cancellation where safe, audit result |
| Concurrent workspace document | revision-checked autosave | conflict preserves both revisions and offers keep mine/use server/copy |

## Accessibility and resilience

- WCAG 2.2 AA contrast; visible focus; skip and navigation landmarks; logical DOM order.
- Keyboard parity for navigation, chart, replay, Journal, settings, menus, dialogs, drawers, imports, and radial-tool fallback.
- Semantic labels, descriptions, status/live regions, tables, headings, and dialog/menu patterns.
- Color is redundant with sign, text, icon, shape, pattern, or position.
- Support 200% zoom, large text, coarse pointer, safe-area insets, software keyboards, 44×44 touch targets, long names/numbers, locale formats, and bidirectional user content.

## Performance budgets

| Budget | Threshold |
|---|---|
| Public initial JS, gzip | ≤ 180 KB |
| Authenticated shell initial JS, gzip | ≤ 260 KB |
| Lazy route/tool chunk, gzip | ≤ 180 KB |
| Chart workspace dependency graph, gzip | ≤ 550 KB |
| Stylesheets, aggregate gzip | ≤ 70 KB |
| Fonts, aggregate raw / request count | ≤ 360 KB / 30 files |
| LCP / CLS on representative mid-tier device | ≤ 2.5s / ≤ 0.1; field/release measurement required, not enforced by the asset gate |
| INP | ≤ 200ms; field/release measurement required, not enforced by the asset gate |
| Route transition visible response | ≤ 100ms; release measurement required, not enforced by the asset gate |
| Long list | virtualize beyond 200 rows |
| 16-pane workspace | one normalized subscription per unique symbol/provider/timeframe; no duplicate stream |
| 16-pane steady-state frame P95 under 4× CPU throttling | ≤ 60ms |
| 16-pane final linked-crosshair convergence under 4× CPU throttling | ≤ 300ms, exact source candle on all panes |
| 16-pane bounded resize-stress P95 under 4× CPU throttling | ≤ 600ms for 20 alternating 4px grid resizes, with every chart consuming and restoring the size |

CI fails on the executable asset, font, media, motion, long-list, and 16-pane checks above. Field-only LCP, CLS, INP, and route-transition targets require dated release evidence; they are not claimed by the build-size gate. Any exception must name an owner, measurement, reason, and expiry.

The temporary 60ms frame and 600ms resize ceilings are governed by `docs/ui-performance-exceptions.json`; their owners, measured workloads, remediations, and expiries are executable release inputs rather than undocumented budget relaxations.

## Controlled rollout

Flags are scoped by route group: `ui.shell.v2`, `ui.journal.v2`, `ui.settings.v2`, `ui.chart.v2`, `ui.public.v2`. A route never mixes old and new primitives after migration. Rollout order is primitives → shell → settings/auth → Journal/reports → chart/live → public. Each flag has a server-controlled fallback until parity is verified; deep links and stored data use versioned migration adapters.

The executable source of truth is `frontend/src/lib/uiRollout.ts`. Server overrides take precedence over defaults and the global kill switch atomically marks every route group as fallback without rewriting a URL, unmounting the current route, or changing a stored document. Journal, settings, and chart groups cannot enable before the shared shell. Responses are refreshed while the app is open and cached for up to 24 hours so a transient configuration outage cannot silently undo an emergency fallback; malformed responses evict older enabled snapshots. Missing or malformed first-load configuration fails closed and disables route motion. Each of the 32 concrete route contracts declares its exact route identity, parity kind, shared saved-data source, primary action or read-only exemption, real draft key when applicable, and the four required viewport classes. The compatibility suite certifies both rollout directions on every route and viewport; the separate hot-rollback test proves same-page operator recovery. UIR-83 remains open until each route binds and asserts an exact data canary, executable modern evidence, and a persisted fallback action result or legitimate read-only exemption. `npm run quality:ui` validates the minimum release matrix before build artifacts are accepted.

## Automated quality matrix

`docs/ui-release-matrix.json` is the machine-readable matrix for authenticated and public captures. It covers desktop, tablet, mobile, 200% zoom, coarse pointers, RTL/long-label locales, color-vision simulations, compact/full-screen/4×4 chart layouts, settings conflict/validation, Journal dock/review states, landmarks, keyboard completion, focus return, reduced motion, color redundancy, overflow, touch targets, and performance budgets. A visual artifact is evidence only when its route, viewport, state, theme, locale, build SHA, and review result are recorded; a manifest entry is not a substitute for the capture.

## Route definition of done

A route is complete only when its approved direction is honored, protected behavior passes, no legacy island remains, required baseline screenshots are reviewed, critical states and primary interactions pass, keyboard and screen-reader checks pass, performance budgets pass, deep links survive, fallback is verified, and implementation changes are reflected in `DESIGN.md` and the catalog.
