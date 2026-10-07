# EdgeLab visual system

## Direction

**Backlit Workbench** is the implemented cross-product direction: a near-black analytical work surface, crisp cyan interaction light, warm warning energy, and restrained elevation. Public pages use larger editorial scale and demonstrations; authenticated screens use the same materials at compact operating density.

The first viewport must show EdgeLab doing real work. Dense screens preserve the chart as the dominant field and attach tools from their spatial origin. Settings lead with decisions and recovery rather than dashboard ornament.

## Protected behavior

- Live/replay plot area and expert controls remain visible.
- Symbol, timeframe, account scope, chart viewport, filters, selected row, draft, and open panel survive relevant navigation.
- Profit/loss, feed health, selection, severity, and risk always include a sign, label, icon, pattern, or position in addition to color.
- Motion never delays input or animates price in a misleading way.
- Unsupported provider features show the requirement and next safe action.

## Foundations

- Background: `--ui-canvas`; operating surface: `--ui-surface`; inset data well: `--ui-inset`; floating and modal layers use their named elevation tokens.
- Accent roles are interaction, selection, information, profit, loss, warning, and neutral. Purple is excluded.
- Instrument Sans is the interface voice. JetBrains Mono is limited to data, code, timestamps, and measurement.
- Spacing follows a 4px base. Interactive touch targets are at least 44px on coarse pointers. The pane grid supports one through sixteen charts without changing the control language.
- Radius reflects role: 6–10px for operating controls, 12–16px for bounded surfaces, pills only for compact status or segmented controls.
- Motion uses `--motion-*` tokens, is interruption-safe, and collapses to effectively immediate state changes under reduced motion.

## Data visualization

Use cyan as the primary series, blue for comparison, green plus `+`/up semantics for profit, rose plus `−`/down semantics for loss, amber plus warning icon/text for degraded data, and hatch/low-opacity treatment plus sample label for low-confidence results. Every essential chart has a textual or tabular summary.

## Route intent

- `/`: persuade through the chart → replay → journal → insight loop.
- `/pricing`: explain entitlement boundaries honestly.
- `/auth/*`: communicate secure progress, recovery, and return destination.
- `/app`: operate from one persistent shell; no route should become a legacy island.
- `/shared`: explain snapshot scope, ownership, expiry, and open-as-copy.

Public pages lead with the working product. The landing page places a full-width, past-only candle demonstration directly below the headline and actions, before compact metric rows. On mobile, repeated access metadata yields to the chart; illustrative-data and temporary-beta-data labels remain visible.

Landing chapters move into and out of view with scoped, reversible scroll timelines. Animate children of stable triggers, refresh after deferred content changes, keep horizontal movement within reserved space, and use vertical movement on narrow screens. Focused controls and reduced-motion content remain fully visible. Pricing links focus their local destinations; provider-dependent tools disclose their requirements separately from planned work.

## Non-goals

No LuxAlgo visual clone, decorative glass everywhere, novelty motion in repeated workflows, invented proof, or replacement of expert tools with simplified substitutes.
