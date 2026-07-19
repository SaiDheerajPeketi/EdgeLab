# EdgeLab AE Teaser Assets

This folder generates 4K After Effects import assets for EdgeLab teaser editing. It is intentionally separate from `videos/edgelab-beta-launch`.

## Outputs

- `svg/*.svg`: 3840x2160 layered vector scenes.
- `preview/*.png`: 3840x2160 raster references.
- `ae/edgelab-teaser-assets.jsx`: ExtendScript that creates AE folders, comps, shape layers, text layers, and timing placeholders.
- `manifest.json`: scene metadata, dimensions, colors, fonts, and layer roles.

## Commands

```bash
npm run export
npm run validate
npm run dev
```

The exporter is dependency-free Node. On macOS it uses `sips` to rasterize SVG previews; otherwise it writes a simple PNG fallback so validation still proves the pack is complete.

## Scene Set

- Session gateway
- Replay engine workspace
- Trade journal / notes
- Playbooks
- Analytics / reports dashboard
- Position/order tools
- Position sizing calculator
- Economic calendar

Marketing/product and sign-in/beta screens are excluded.
