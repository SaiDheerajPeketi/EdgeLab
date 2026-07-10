# EdgeLab Frame Brief

## Product truth

EdgeLab is a dark, data-dense trading workspace that combines historical replay, execution simulation, journaling, review analytics, live market context, and beta feedback loops in one product surface.

## Visual language pulled from the app

### Palette

- `--bg-base`: `#090b0f`
- `--bg-surface`: `#111318`
- `--bg-surface-2`: `#181c23`
- `--bg-border`: `#1e232d`
- `--accent-primary`: `#32d3ee`
- `--accent-primary-glow`: `rgba(50, 211, 238, 0.45)`
- `--profit`: `#22c55e`
- `--loss`: `#ef4444`
- `--warning`: `#f59e0b`
- `--text-primary`: `#f0f2f5`
- `--text-secondary`: `#8b95a5`
- `--text-muted`: `#4a5360`

### Typography

- Display: `Syne Variable`
- Body: `Inter Variable`
- Data / tabular numbers: `JetBrains Mono`

### Shape, depth, and spacing

- Radii: `6px`, `10px`, `16px`, `24px`
- Shadow language: deep black panels with soft cyan glow accents
- Surfaces: near-black with subtle gradients, glass blur only where the app already uses it
- Rhythm: tight data layouts inside large, calm outer padding

### Chart signature

- Candle up: `#22c55e`
- Candle down: `#fb7185`
- Chart background: `rgba(7, 11, 16, 0.96)`
- Grid: `rgba(139, 149, 165, 0.16)`
- Crosshair: `rgba(50, 211, 238, 0.72)`
- Labels: `#748094`
- Tooltip background: `rgba(7, 11, 16, 0.95)`

These values are the visual spine of the cold open and every chart-led transition.

## Brand assets

- Wordmark and mark live in `frontend/src/components/brand/EdgeLabBrand.tsx`
- Title tag in `frontend/index.html`: `EdgeLab | Your Edge Engineered`
- Beta CTA path confirmed in repo: use `edgelab.co.in` as the primary outro URL; the repo confirms `/auth/signin` and `?waitlist=1` flows, but no cleaner public `/beta` route is defined

## Motion tone

- Precise, confident, and low-latency
- Ease rules from app tokens:
  - `--ease-out`: `cubic-bezier(0.16, 1, 0.3, 1)`
  - `--ease-spring`: `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Reference in-app motion: `edgelab-stage-enter`, `edgelab-word-rise`, chart-progress fills, pulsing beta/live status pills
- Avoid flashy hype motion; favor guided reveals, panel lifts, chart redraws, and subtle parallax

## Story tone

“Trading terminal discipline, but presented with keynote clarity.”

The video should feel like:
- Price action first
- Process before hype
- Metrics as proof after replay
- Beta but already serious

## Scene design rules

- Use real EdgeLab layout DNA: dark shells, cyan accents, mono numerics, dense but legible tables
- Keep screens alive: candles tick, watchlists update, orders fill, rows appear, metrics count up
- Prefer a premium device-frame or terminal-panel framing instead of flat full-screen crops
- Never put infrastructure, backend, or code terms on screen
- Closing line should favor the existing brand line: `Your Edge Engineered`
