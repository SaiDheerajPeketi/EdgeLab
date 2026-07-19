# EdgeLab AE Teaser Assets

This folder generates 4K After Effects import assets for EdgeLab teaser editing. It is intentionally separate from `videos/edgelab-beta-launch`.

## Outputs

- `svg/*.svg`: 3840x2160 layered vector scenes.
- `html/*.html`: 3840x2160 browser-openable actual component compositions.
- `preview/*.png`: 3840x2160 raster references.
- `ae/edgelab-teaser-assets.jsx`: ExtendScript that creates AE folders, comps, shape layers, text layers, and timing placeholders.
- `manifest.json`: scene metadata, dimensions, colors, fonts, and layer roles.

## Commands

```bash
npm run export
npm run validate
npm run dev
```

The exporter renders actual EdgeLab React components through Vite SSR, inlines compiled app CSS, and writes SVG `foreignObject` compositions plus HTML compositions. macOS `sips` cannot fully rasterize `foreignObject`, so the HTML files are the authoritative visual reference when PNG previews are blank.

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
