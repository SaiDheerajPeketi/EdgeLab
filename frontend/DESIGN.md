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

Workspace themes support dark, light and system preference through semantic tokens. The dark material is the default visual direction, not permission to hardcode dark colors in theme-aware controls. Apply the same layout, contrast, focus and financial meaning in each theme.

- Background: `--ui-canvas`; operating surface: `--ui-surface`; inset data well: `--ui-inset`; floating and modal layers use their named elevation tokens.
- Accent roles are interaction, selection, information, profit, loss, warning, and neutral. Purple is excluded. Strong destructive actions use `--danger-action`, `--danger-action-hover`, and `--on-danger-action`; their labels and confirmation remain explicit.
- Instrument Sans is the interface voice. JetBrains Mono is limited to data, code, timestamps, and measurement.
- Spacing follows a 4px base. Interactive touch targets are at least 44px on coarse pointers. The pane grid supports one through sixteen charts without changing the control language.
- Radius reflects role: 6–10px for operating controls, 12–16px for bounded surfaces, pills only for compact status or segmented controls.
- Motion uses `--motion-*` tokens, is interruption-safe, and collapses to effectively immediate state changes under reduced motion.

## Data visualization

Use cyan as the primary series, blue for comparison, green plus `+`/up semantics for profit, rose plus `−`/down semantics for loss, amber plus warning icon/text for degraded data, and hatch/low-opacity treatment plus sample label for low-confidence results. Every essential chart has a textual or tabular summary.

## Route intent

- `/`: persuade through the chart → replay → journal → insight loop.
- `/pricing`: choose monthly or yearly Pro billing from the validated server catalog; show the recurring amount, checkout availability, and separate provider requirements before purchase. Return from Stripe checks current status and offers recovery without granting access from a query string.
- `/account`: manage billing and sign-out independently of workspace access; explain the active paid subscription required for JSON, CSV and chart-image exports.
- `/auth/*`: communicate secure progress, recovery, and return destination.
- `/app`: operate from one persistent shell; no route should become a legacy island.
- `/shared`: explain snapshot scope, ownership, expiry, and open-as-copy.

Public pages lead with the working product. The landing page places a full-width, past-only candle demonstration directly below the headline and actions. Candles use approximately nine pixels of plot width and a taller field, with responsive history filling both edges. On mobile, the chart precedes the dimensional study. Functional scenario controls carry the preview; repeated captions, badges and workflow links yield to the visuals. The preview uses synthetic data and does not represent an external live feed.

Landing chapters move into and out of view with scoped, reversible scroll timelines. Animate children of stable triggers, refresh after deferred content changes, keep horizontal movement within reserved space, and use vertical movement on narrow screens. Focused controls and reduced-motion content remain fully visible. Pricing links focus their local destinations; provider-dependent tools disclose their requirements separately from planned work.

The EdgeLab mark is a forward-cut cyan E beside a grounded white L. Use the same 64-unit geometry in the interface, transparent SVG export, monochrome export and favicon. Keep the wordmark in Instrument Sans and retain the established cyan/white roles. The verified Black and Blue monogram accompanies the public footer's studio link; it remains distinct from EdgeLab's identity.

The public hero's dimensional study uses 96 fixed synthetic OHLC candles, with Price, Decisions and Review views over the same data. Perspective changes the view, never the prices. The desktop sculpture shares the introduction; on mobile it follows the working chart in both reading and visual order. Three.js loads near the scene, renders on demand, pauses offscreen and releases its resources on exit. A software-projected view of the same measured OHLC geometry appears immediately; WebGL replaces it only after a successful frame. Loading, unsupported devices and context loss retain shaded bodies, wicks, volume, numbered entry/exit markers and the same usable rotation controls. Keyboard rotation remains available without autoplay. The chart runs continuously while visible, retaining historical candles as new ones arrive. Replay transport is absent from the public preview; Journal trade selection and Results remain interactive. Reduced motion pauses the chart and scene, and the footer motion preference allows an explicit override.

The indicator editor's community catalog extends the existing operating layout as a collapsible source browser. Original author, licence, Pine version, revision and source identity stay readable beside the draft; edited copies retain their upstream base. Preview before importing, distinguish experimental native execution from legacy migration, and keep catalog reload separate from replacing a saved script. Catalog controls and source links have 44px targets, visible focus, contained mobile widths and readable loading/error recovery. Downloads use the verified original bytes.

Chart Objects uses explicit in-flow settings disclosures for indicators, with separate 44px visibility controls that stay unobstructed. Native Pine settings expose validated source inputs and distinguish source version from saved revision. Closing returns focus to the opening control; removal keeps focus in the same panel. Resizing the chart for a panel preserves its established visible time interval within chart spacing limits.

Active studies presents native Pine through its source identity and a contained Inputs disclosure. Declared inputs use the same validated definitions and current values as Objects; generic period and plot-color controls apply only to other study types. Long input lists scroll within the disclosure, names and version metadata wrap, and closing restores the connected trigger. Empty or unprepared input definitions explain the next action without inventing settings.

Public startup must defer private compatibility surfaces and the dimensional scene. Keep the explicit Three.js bridge in its own deferred engine chunk so shared marketing content cannot pull it into the first page load. Compatibility navigation remains available while its selected lazy surface loads, with an accessible status message. Loading improvements preserve rollout fallback, deep links, existing visual baselines and the current performance budgets.

## Non-goals

No LuxAlgo visual clone, decorative glass everywhere, novelty motion in repeated workflows, invented proof, or replacement of expert tools with simplified substitutes.
