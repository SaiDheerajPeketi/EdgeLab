# EdgeLab UI surface inventory

This inventory is the release authority for route and state coverage. `retain` means behavior and information architecture are protected; `restyle` changes presentation; `restructure` changes composition while preserving behavior; `replace` is reserved for obsolete presentation.

| Route / surface | Mode | Decision | Required responsive baselines | Critical states |
|---|---|---|---|---|
| `/` landing | Persuade | restructure | 1440, 1024, 390 | default, beta capacity, CTA pending/success/error |
| `/pricing` | Persuade | restyle | 1440, 1024, 390 | monthly/annual, entitlement unavailable |
| `/privacy`, `/terms`, `*` | Read | restyle | 1440, 768, 390 | not found, maintenance |
| `/auth/signin`, callback | Operate | restructure | 1280, 768, 390 | loading, denied, full beta, expired, retry |
| `/shared` | Operate | restructure | 1440, 1024, 390 | loading, expired, revoked, forbidden, open-as-copy |
| `/app/live` | Operate | restructure | 1920, 1440, 1024, 390 | connecting, live, delayed, stale, offline, unsupported |
| `/app/replay` | Operate | restructure | 1920, 1440, 1024, 390 | empty, loading, active, ended, save error |
| `/app/journal/*` | Operate | restructure | 1440, 1024, 390 | onboarding, sample, empty, loading, partial, error, success |
| `/app/reports` | Operate | restyle | 1440, 1024, 390 | low sample, mixed currency, filtered empty |
| `/app/settings/*` | Operate | replace | 1440, 768, 390 | pristine, dirty, saving, saved, conflict, retry, validation |

## Panels and overlays

Right-panel manager: Journal, Watchlist, Quant, Data Window, Objects, Indicator Editor, Order Book, Alerts. Persistent width, one close/back contract, 320px minimum, viewport collision rules.

Overlays: command palette, account/system menu, symbol and indicator search, settings pickers, chart context/radial menus, import and connection flows, review drawer, share dialog, confirmations, banners and toasts. All require Escape handling, focus return, safe outside dismissal, zoom collision handling, and non-vanishing critical messages.

| Surface family | Includes | Decision | Release states |
|---|---|---|---|
| Persistent app chrome | sidebar, mobile navigation, contextual header, connection status, account menu | restructure | expanded, collapsed, compact, offline, keyboard-only |
| Chart tools | top toolbar, drawing rail, radial toolbox, pane header, replay transport, order ticket | restyle | default, selected, disabled, compact, 4×4, unsupported |
| Right panels | Journal, Quant, Watchlist, Data Window, Objects, Indicators, Order Book, Alerts | restructure | closed, opening, resized, minimum-width, collision, restored |
| Menus/popovers | symbol search, indicator search, context menu, color/date/select controls | retain + restyle | empty, results, no results, keyboard active, zoom collision |
| Protected overlays | connection, import, share, destructive confirmation, trade review | restructure | pristine, invalid, pending, failure, success, focus returned |
| Inline system states | empty, skeleton, partial, offline, stale, denied, unsupported, error, retrying, success | replace | action available, no safe action, timestamped, persistent critical message |

Every row is exercised with representative financial values, a long Latin label, Arabic user content, a missing entitlement, and keyboard-only operation. `docs/ui-release-matrix.json` is the executable scenario inventory.

## Baseline matrix

Desktop/tablet/mobile captures are required for every route above. Live additionally requires compact, full-screen, 2-pane, 4-pane, and 4×4 variants. Journal requires empty, populated, filtered, review-drawer, and docked variants. Settings requires dirty/conflict/validation variants. File locations are `.impeccable/baselines/<route>/<width>-<state>.png`; the absence of a file is a failing release condition, never implicit approval.
