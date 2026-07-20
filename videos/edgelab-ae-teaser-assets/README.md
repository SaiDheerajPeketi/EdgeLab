# EdgeLab AE Teaser Actual App Components

This folder exports 4K After Effects assets from the actual EdgeLab frontend components. It is intentionally separate from `videos/edgelab-beta-launch`.

## Outputs

- `preview/*.png`: exact 3840x2160 screenshots from headless Chrome.
- `svg/*.svg`: vector captures generated from the live rendered DOM: computed rectangles, text, inline SVG fragments, and canvas image surfaces.
- `ae/edgelab-teaser-assets.jsx`: plain ExtendScript that creates exact SVG import comps plus editable native DOM layer comps.
- `manifest.json`: dimensions, source components, layer counts, layer types, and suggested animation handles.

## Commands

```bash
npm run export
npm run validate
npm run dev
```

The exporter starts Vite, renders the real React components at `3840x2160`, captures exact PNG references through headless Chrome, walks the computed browser DOM, and converts that captured structure into SVG and AE layer data. It does not use hand-drawn mock scenes, HTML exports, or `foreignObject`.

## Actual Component Scene Set

- `SessionGateway`
- `TradingChart`, `ReplayController`, `OrderTicket`, `PositionPanel`
- `JournalWorkspacePage`
- `PlaybookBoard`
- `ResultsPanel`
- `OrderTicket`, `PositionPanel`, `TradeLog`
- `PositionSizeCalculatorPage`
- `EconomicCalendarPage`

Marketing/product and sign-in/beta screens are excluded.
