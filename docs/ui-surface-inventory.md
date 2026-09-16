# EdgeLab UI surface inventory

This inventory is the release authority for route and state coverage. `retain` means behavior and information architecture are protected; `restyle` changes presentation; `restructure` changes composition while preserving behavior; `replace` is reserved for obsolete presentation.

| Route / surface | Mode | Decision | Required responsive baselines | Critical states |
|---|---|---|---|---|
| `/` landing | Persuade | restructure | 1440, 834, 390 | default, beta capacity, CTA pending/success/error |
| `/pricing` | Persuade | restructure | 1440, 834, 390 | monthly/annual, entitlement unavailable |
| `/privacy`, `/terms`, `*` | Read | restyle | 1440, 834, 390 | not found, maintenance |
| `/auth/signin`, callback | Operate | replace | 1440, 834, 390 | loading, denied, full beta, expired, retry |
| `/shared` | Operate | restructure | 1440, 834, 390 | loading, expired, revoked, forbidden, transport error, open-as-copy |
| `/app` gateway | Operate | replace | 1440, 834, 390 | recent, empty, loading, sample data, error |
| `/app/live`, `/app/order-flow` | Operate | restructure | 1920, 1440, 834, 390 covered | connecting, live, delayed, stale, offline, unsupported |
| `/app/replay` | Operate | restructure | 1920, 1440, 834, 390 covered | empty, loading, active, ended, save error |
| `/app/journal/*` | Operate | replace | 1440, 834, 390 | onboarding, sample, empty, loading, partial, error, success |
| `/app/reports` | Operate | restructure | 1440, 834, 390 | low sample, mixed currency, filtered empty |
| `/app/settings/*` | Operate | replace | 1440, 834, 390 | pristine, dirty, saving, saved, conflict, retry, validation |

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

`docs/ui-release-matrix.json` is the executable scenario inventory. Representative financial values, long Latin labels, Arabic user content, missing entitlements, and keyboard-only operation remain required release scenarios; the JSON inventory records the stored-baseline gaps rather than implying that every state is already captured.

## Baseline matrix

Desktop/tablet/mobile captures are required for every rendered route above. The maintained Playwright baselines are 1440×1000, 834×1112, and 390×844 at browser zoom 1, with a dedicated 1920×1080 project for trading surfaces. The separate 200% zoom assertion uses CDP page-scale emulation and is not misrepresented as the mobile project's baseline zoom. Live additionally requires compact, full-screen, 2-pane, 4-pane, and 4×4 variants. Journal requires empty, populated, filtered, review-drawer, and docked variants. Settings requires dirty/conflict/validation variants. Stored files live under `e2e/__snapshots__`; an absent file must be recorded as a gap, never treated as implicit approval.

## Executable audit

Run `npm run check:ui-inventory` to require exact bidirectional parity between router/workspace definitions, the inventory, and `docs/ui-foundation-contracts.json`; verify authoritative panel/overlay sources; confirm width, height, pointer, and baseline zoom against Playwright; and resolve the route → state → project records in `docs/ui-surface-evidence.json` to their exact spec and stored snapshot. `npm run check:ui-inventory -- --require-complete` additionally fails while any recorded viewport, assertion, or state-coverage gap remains.

UIR-01 remains partial: the inventory is structurally enforced across all four maintained viewports and critical route states, while non-critical states and overlay variants still require complete evidence before the item can be closed.
