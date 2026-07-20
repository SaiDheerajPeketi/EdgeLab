# EdgeLab AE Teaser Editable Components

This folder generates 4K After Effects import assets for EdgeLab teaser editing. It is intentionally separate from `videos/edgelab-beta-launch`.

## Outputs

- `svg/*.svg`: 3840x2160 primitive vector component scenes. These use SVG shapes/text only, no HTML and no `foreignObject`.
- `preview/*.png`: 3840x2160 raster references.
- `ae/edgelab-teaser-assets.jsx`: plain ExtendScript that creates native AE comps with editable shape and text layers.
- `manifest.json`: component-scene metadata, dimensions, colors, fonts, layer roles, and animation handles.

## Commands

```bash
npm run export
npm run validate
npm run dev
```

The exporter uses structured vector layer definitions that match the EdgeLab app surfaces and visual language closely enough for teaser edits. Panels, tables, badges, candles, charts, calculator fields, calendar events, and metric cards are split into logical layers where practical.

## Component Scene Set

- Session gateway
- Replay engine workspace
- Trade journal / notes
- Playbooks
- Analytics / reports dashboard
- Position/order tools
- Position sizing calculator
- Economic calendar

Marketing/product and sign-in/beta screens are excluded. The exporter removes any old `html/` capture output so the pack stays AE-editable.
