# After Effects screen export

EdgeLab includes a reproducible desktop screen exporter that walks the public pages, authentication
flow, every sidebar workspace, result sub-view, and the primary replay overlays.

## Output

```text
artifacts/after-effects-screens/
├── manifest.json
├── png-reference/
└── svg/
```

- `svg/` contains editable SVG screenshots generated from the live Chromium DOM. The exporter uses
  native SVG elements and does not use `foreignObject`.
- `png-reference/` contains pixel references with matching filenames.
- `manifest.json` records the URL, viewport, dimensions, and capture notes for every state.

The charting engine renders candles to HTML canvas. Those chart pixels remain a single embedded image
inside the SVG; all surrounding controls, text, borders, fills, and Lucide icons remain vector
elements.

## Run

Start the frontend and FastAPI backend, then run:

```bash
npm run export:screens
```

For protected workspace capture, enable EdgeLab's localhost-only development login:

```bash
EDGELAB_DEV_AUTH_BYPASS=1 npm run dev
```

The replay workspace also needs at least one dataset. Override paths when needed:

```bash
EDGELAB_SCREEN_EXPORT_URL=http://127.0.0.1:5173 \
EDGELAB_SCREEN_EXPORT_DIR=artifacts/after-effects-screens \
CHROME_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
npm run export:screens
```

## After Effects

Use a recent After Effects version and import the SVG as
`Composition - Retain Layer Sizes` when individual editable elements are needed. Keep the matching
PNG on a guide layer above the SVG composition and use Difference blending mode to check alignment.
Fonts used by EdgeLab are Inter Variable and JetBrains Mono Variable.
