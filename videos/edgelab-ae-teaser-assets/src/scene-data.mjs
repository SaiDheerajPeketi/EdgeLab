export const SCENE_WIDTH = 3840;
export const SCENE_HEIGHT = 2160;
export const FPS = 30;
export const DURATION_SECONDS = 7;

export const COLORS = {
  bg: "#05070a",
  bg2: "#071018",
  panel: "#08111b",
  panel2: "#0b1622",
  panel3: "#0d1f2a",
  stroke: "#1f3343",
  stroke2: "#294353",
  text: "#f8fbff",
  muted: "#8b9bb0",
  subtext: "#b8c7d9",
  cyan: "#67e8f9",
  cyan2: "#22d3ee",
  green: "#34d399",
  red: "#fb7185",
  amber: "#fbbf24",
  blue: "#60a5fa",
  violet: "#a78bfa",
};

const FONT = {
  body: "Inter, Arial, sans-serif",
  mono: "JetBrains Mono, Menlo, monospace",
  display: "Syne, Inter, Arial, sans-serif",
};

let layerCounter = 0;

function nextId(prefix) {
  layerCounter += 1;
  return `${prefix}-${String(layerCounter).padStart(3, "0")}`;
}

function layer(type, attrs) {
  return {
    id: attrs.id ?? nextId(type),
    type,
    ...attrs,
  };
}

function resetLayerIds() {
  layerCounter = 0;
}

function baseLayers(sceneTitle, sceneSubtitle) {
  return [
    layer("rect", { id: "background", role: "background", x: 0, y: 0, width: SCENE_WIDTH, height: SCENE_HEIGHT, fill: COLORS.bg }),
    layer("rect", { id: "top-glow", role: "background-accent", x: 0, y: 0, width: SCENE_WIDTH, height: 540, fill: "#071827", opacity: 0.8 }),
    layer("circle", { id: "cyan-radar", role: "background-accent", cx: 3060, cy: 300, r: 520, fill: COLORS.cyan, opacity: 0.05 }),
    layer("circle", { id: "amber-radar", role: "background-accent", cx: 390, cy: 1760, r: 420, fill: COLORS.amber, opacity: 0.04 }),
    layer("text", {
      id: "scene-kicker",
      role: "label",
      x: 180,
      y: 150,
      text: "EDGELAB TEASER COMPONENT",
      fill: COLORS.cyan,
      size: 34,
      weight: 800,
      tracking: 7,
      font: FONT.body,
    }),
    layer("text", {
      id: "scene-title",
      role: "title",
      x: 180,
      y: 240,
      text: sceneTitle,
      fill: COLORS.text,
      size: 94,
      weight: 800,
      font: FONT.display,
    }),
    layer("text", {
      id: "scene-subtitle",
      role: "subtitle",
      x: 184,
      y: 318,
      text: sceneSubtitle,
      fill: COLORS.muted,
      size: 36,
      weight: 500,
      font: FONT.body,
    }),
  ];
}

function panel(id, x, y, width, height, title, options = {}) {
  const titleLayer = title
    ? [
        layer("text", {
          id: `${id}-title`,
          role: "panel-title",
          x: x + 34,
          y: y + 62,
          text: title,
          fill: options.titleFill ?? COLORS.text,
          size: options.titleSize ?? 32,
          weight: 800,
          font: FONT.body,
        }),
      ]
    : [];
  return [
    layer("rect", {
      id,
      role: options.role ?? "panel",
      x,
      y,
      width,
      height,
      rx: options.rx ?? 26,
      fill: options.fill ?? COLORS.panel,
      stroke: options.stroke ?? COLORS.stroke,
      strokeWidth: options.strokeWidth ?? 2,
      opacity: options.opacity ?? 1,
    }),
    ...titleLayer,
  ];
}

function pill(id, x, y, width, text, tone = "cyan") {
  const fill = tone === "green" ? "#0d2a24" : tone === "amber" ? "#2a220d" : tone === "red" ? "#2a1118" : "#0d2631";
  const stroke = tone === "green" ? "#1f5f4c" : tone === "amber" ? "#6f531b" : tone === "red" ? "#6b2435" : "#1d5968";
  const color = tone === "green" ? COLORS.green : tone === "amber" ? COLORS.amber : tone === "red" ? COLORS.red : COLORS.cyan;
  return [
    layer("rect", { id, role: "badge", x, y, width, height: 58, rx: 29, fill, stroke, strokeWidth: 2 }),
    layer("text", { id: `${id}-text`, role: "badge-text", x: x + 28, y: y + 38, text, fill: color, size: 24, weight: 800, tracking: 2, font: FONT.body }),
  ];
}

function metricCard(id, x, y, width, labelText, valueText, tone = "cyan") {
  const color = tone === "green" ? COLORS.green : tone === "amber" ? COLORS.amber : tone === "red" ? COLORS.red : tone === "blue" ? COLORS.blue : COLORS.cyan;
  return [
    ...panel(id, x, y, width, 190, "", { fill: COLORS.panel2, rx: 22 }),
    layer("text", { id: `${id}-label`, role: "metric-label", x: x + 28, y: y + 54, text: labelText, fill: COLORS.muted, size: 25, weight: 700, tracking: 3, font: FONT.body }),
    layer("text", { id: `${id}-value`, role: "metric-value", x: x + 28, y: y + 132, text: valueText, fill: color, size: 54, weight: 850, font: FONT.display }),
  ];
}

function lineChart(id, x, y, width, height, points, color = COLORS.cyan) {
  const coords = points.map(([px, py]) => [x + px * width, y + py * height]);
  const d = coords.map(([cx, cy], index) => `${index === 0 ? "M" : "L"} ${cx.toFixed(1)} ${cy.toFixed(1)}`).join(" ");
  return [
    layer("rect", { id: `${id}-plot-bg`, role: "chart-background", x, y, width, height, rx: 18, fill: "#06101a", stroke: COLORS.stroke, strokeWidth: 2 }),
    ...Array.from({ length: 5 }, (_, index) =>
      layer("line", { id: `${id}-grid-h-${index}`, role: "chart-grid", x1: x, y1: y + (index + 1) * (height / 6), x2: x + width, y2: y + (index + 1) * (height / 6), stroke: "#173040", strokeWidth: 1, opacity: 0.8 }),
    ),
    ...Array.from({ length: 6 }, (_, index) =>
      layer("line", { id: `${id}-grid-v-${index}`, role: "chart-grid", x1: x + (index + 1) * (width / 7), y1: y, x2: x + (index + 1) * (width / 7), y2: y + height, stroke: "#173040", strokeWidth: 1, opacity: 0.55 }),
    ),
    layer("path", { id: `${id}-line`, role: "chart-line", d, fill: "none", stroke: color, strokeWidth: 8, strokeLinecap: "round", strokeLinejoin: "round" }),
    layer("circle", { id: `${id}-terminal`, role: "chart-marker", cx: coords.at(-1)[0], cy: coords.at(-1)[1], r: 17, fill: color, stroke: COLORS.bg, strokeWidth: 8 }),
  ];
}

function candleChart(id, x, y, width, height, candles) {
  const layers = [
    layer("rect", { id: `${id}-plot-bg`, role: "chart-background", x, y, width, height, rx: 18, fill: "#050d15", stroke: COLORS.stroke, strokeWidth: 2 }),
  ];
  for (let index = 0; index < 8; index += 1) {
    layers.push(layer("line", { id: `${id}-grid-${index}`, role: "chart-grid", x1: x, y1: y + (index + 1) * height / 9, x2: x + width, y2: y + (index + 1) * height / 9, stroke: "#173040", strokeWidth: 1, opacity: 0.7 }));
  }
  candles.forEach((item, index) => {
    const cx = x + 42 + index * ((width - 84) / Math.max(1, candles.length - 1));
    const color = item.close >= item.open ? COLORS.green : COLORS.red;
    const highY = y + item.high * height;
    const lowY = y + item.low * height;
    const openY = y + item.open * height;
    const closeY = y + item.close * height;
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(12, Math.abs(closeY - openY));
    layers.push(layer("line", { id: `${id}-wick-${index}`, role: "candle-wick", x1: cx, y1: highY, x2: cx, y2: lowY, stroke: color, strokeWidth: 5 }));
    layers.push(layer("rect", { id: `${id}-body-${index}`, role: "candle-body", x: cx - 17, y: bodyY, width: 34, height: bodyHeight, rx: 4, fill: color, opacity: 0.92 }));
  });
  layers.push(layer("line", { id: `${id}-entry-line`, role: "order-line", x1: x + 130, y1: y + height * 0.48, x2: x + width - 90, y2: y + height * 0.48, stroke: COLORS.cyan, strokeWidth: 5, strokeDasharray: "18 18" }));
  layers.push(layer("line", { id: `${id}-risk-line`, role: "risk-line", x1: x + 260, y1: y + height * 0.67, x2: x + width - 260, y2: y + height * 0.67, stroke: COLORS.red, strokeWidth: 4, strokeDasharray: "14 18" }));
  layers.push(layer("line", { id: `${id}-target-line`, role: "target-line", x1: x + 420, y1: y + height * 0.31, x2: x + width - 160, y2: y + height * 0.31, stroke: COLORS.green, strokeWidth: 4, strokeDasharray: "14 18" }));
  return layers;
}

function tableRows(id, x, y, width, rows, columns) {
  const layers = [];
  const rowHeight = 72;
  rows.forEach((row, rowIndex) => {
    const rowY = y + rowIndex * rowHeight;
    layers.push(layer("rect", { id: `${id}-row-${rowIndex}`, role: "table-row", x, y: rowY, width, height: 58, rx: 12, fill: rowIndex % 2 === 0 ? "#0a1520" : "#08121b", stroke: "#172b3a", strokeWidth: 1 }));
    columns.forEach((column, columnIndex) => {
      layers.push(layer("text", { id: `${id}-r${rowIndex}-c${columnIndex}`, role: "table-text", x: x + column.x, y: rowY + 38, text: row[column.key], fill: column.fill?.(row) ?? COLORS.subtext, size: column.size ?? 25, weight: column.weight ?? 650, font: column.font ?? FONT.body }));
    });
  });
  return layers;
}

function sessionGatewayScene() {
  resetLayerIds();
  const layers = [
    ...baseLayers("Session gateway", "Dataset selection, replay setup, and strategy context staged for a cold open."),
    ...panel("gateway-shell", 180, 440, 3480, 1500, "New replay session"),
    ...pill("gateway-status", 2950, 480, 360, "REPLAY READY", "green"),
    ...panel("dataset-card", 260, 570, 980, 520, "Dataset root"),
    layer("text", { id: "dataset-symbol", role: "primary-value", x: 310, y: 720, text: "EURUSD", fill: COLORS.text, size: 86, weight: 850, font: FONT.display }),
    layer("text", { id: "dataset-meta", role: "metadata", x: 315, y: 795, text: "Dukascopy M1  |  7.2M candles", fill: COLORS.muted, size: 31, weight: 600, font: FONT.body }),
    ...lineChart("dataset-spark", 310, 850, 840, 170, [[0, 0.68], [0.12, 0.55], [0.22, 0.59], [0.36, 0.35], [0.49, 0.48], [0.64, 0.28], [0.78, 0.38], [1, 0.22]], COLORS.cyan),
    ...panel("session-config", 1300, 570, 1060, 520, "Replay configuration"),
    ...tableRows("config", 1350, 685, 960, [
      { label: "Timeframe", value: "M15" },
      { label: "Start balance", value: "$100,000" },
      { label: "Strategy", value: "London Break" },
      { label: "Replay speed", value: "1.5x" },
    ], [
      { key: "label", x: 22, fill: () => COLORS.muted },
      { key: "value", x: 530, fill: () => COLORS.text, weight: 800 },
    ]),
    ...panel("session-list", 2420, 570, 1120, 520, "Recent sessions"),
    ...tableRows("sessions", 2470, 685, 1020, [
      { name: "NY Reversal", pnl: "+$1,240", date: "Jul 18" },
      { name: "Asia Range", pnl: "-$320", date: "Jul 17" },
      { name: "London Break", pnl: "+$890", date: "Jul 16" },
      { name: "FVG Continuation", pnl: "+$460", date: "Jul 15" },
    ], [
      { key: "name", x: 22, fill: () => COLORS.subtext },
      { key: "pnl", x: 620, fill: (row) => row.pnl.startsWith("+") ? COLORS.green : COLORS.red, weight: 850 },
      { key: "date", x: 850, fill: () => COLORS.muted, size: 23 },
    ]),
    ...panel("gateway-footer", 260, 1160, 3280, 620, "Workflow handoff"),
    ...metricCard("metric-market", 320, 1280, 560, "MARKET", "FX Majors", "cyan"),
    ...metricCard("metric-spread", 930, 1280, 560, "SPREAD", "0.2 pip", "green"),
    ...metricCard("metric-bars", 1540, 1280, 560, "CONTEXT", "30 bars", "blue"),
    ...metricCard("metric-mode", 2150, 1280, 560, "MODE", "Manual", "amber"),
    ...metricCard("metric-state", 2760, 1280, 560, "STATUS", "Synced", "green"),
  ];
  return scene("session-gateway", "Session gateway", "Setup surface", layers);
}

function replayEngineScene() {
  resetLayerIds();
  const candles = Array.from({ length: 58 }, (_, index) => {
    const wave = Math.sin(index * 0.46);
    const trend = 0.62 - index * 0.004;
    return {
      high: Math.max(0.08, trend - 0.12 - wave * 0.035),
      low: Math.min(0.92, trend + 0.16 + wave * 0.04),
      open: trend + Math.sin(index * 0.7) * 0.045,
      close: trend + Math.cos(index * 0.52) * 0.055,
    };
  });
  const layers = [
    ...baseLayers("Replay engine workspace", "Candles, order flow, and execution controls rebuilt as editable vector layers."),
    ...panel("workspace-shell", 150, 420, 3540, 1540, ""),
    ...panel("left-toolbar", 190, 470, 130, 1420, ""),
    ...["Cursor", "Trend", "Fib", "Long", "Short", "Note", "Risk"].flatMap((label, index) => [
      layer("rect", { id: `tool-${index}`, role: "tool-button", x: 224, y: 535 + index * 142, width: 62, height: 62, rx: 16, fill: index === 3 ? "#0d2631" : "#0b1721", stroke: index === 3 ? COLORS.cyan : COLORS.stroke2, strokeWidth: 2 }),
      layer("text", { id: `tool-${index}-label`, role: "tool-label", x: 208, y: 625 + index * 142, text: label, fill: COLORS.muted, size: 20, weight: 700, font: FONT.body }),
    ]),
    ...panel("main-chart", 360, 470, 2160, 1120, "EURUSD M15"),
    ...candleChart("replay-candles", 410, 565, 2060, 875, candles),
    ...pill("order-entry-pill", 1830, 970, 300, "ENTRY 1.0886", "cyan"),
    ...pill("target-pill", 2110, 775, 300, "TARGET +2.4R", "green"),
    ...pill("risk-pill", 1780, 1210, 300, "STOP -0.8R", "red"),
    ...panel("right-ticket", 2580, 470, 980, 650, "Order ticket"),
    ...tableRows("ticket", 2635, 585, 870, [
      { label: "Side", value: "LONG" },
      { label: "Risk", value: "0.75%" },
      { label: "Entry", value: "1.08862" },
      { label: "Quantity", value: "2.40 lots" },
      { label: "R multiple", value: "2.4R" },
    ], [
      { key: "label", x: 18, fill: () => COLORS.muted },
      { key: "value", x: 480, fill: () => COLORS.text, weight: 800 },
    ]),
    ...panel("execution-tape", 2580, 1160, 980, 430, "Execution tape"),
    ...tableRows("tape", 2635, 1278, 870, [
      { time: "09:35:12", event: "Limit placed", tone: "READY" },
      { time: "09:40:03", event: "Partial fill", tone: "LIVE" },
      { time: "09:48:44", event: "Target hit", tone: "WIN" },
    ], [
      { key: "time", x: 18, fill: () => COLORS.muted, font: FONT.mono },
      { key: "event", x: 250, fill: () => COLORS.subtext },
      { key: "tone", x: 700, fill: (row) => row.tone === "WIN" ? COLORS.green : COLORS.cyan, weight: 800 },
    ]),
    ...panel("replay-control", 360, 1640, 3200, 250, "Replay controller"),
    layer("rect", { id: "timeline-track", role: "timeline", x: 520, y: 1788, width: 2320, height: 16, rx: 8, fill: "#163040" }),
    layer("rect", { id: "timeline-progress", role: "timeline-progress", x: 520, y: 1788, width: 1480, height: 16, rx: 8, fill: COLORS.cyan }),
    layer("circle", { id: "timeline-head", role: "timeline-head", cx: 2000, cy: 1796, r: 34, fill: COLORS.cyan, stroke: COLORS.bg, strokeWidth: 10 }),
    layer("text", { id: "timeline-time", role: "timecode", x: 2960, y: 1810, text: "09:48:44 / 12:30:00", fill: COLORS.text, size: 34, weight: 800, font: FONT.mono }),
  ];
  return scene("replay-engine-workspace", "Replay engine workspace", "Replay surface", layers);
}

function journalScene() {
  resetLayerIds();
  const layers = [
    ...baseLayers("Trade journal / notes", "Trade memory, screenshots, emotions, mistake tags, and review notes in one editorial frame."),
    ...panel("journal-shell", 180, 430, 3480, 1510, ""),
    ...panel("journal-list", 250, 520, 1000, 1320, "Trade log"),
    ...tableRows("journal-trades", 300, 640, 900, [
      { symbol: "EURUSD", outcome: "+2.4R", note: "Break + retest" },
      { symbol: "NQ", outcome: "-0.8R", note: "Late chase" },
      { symbol: "BTC", outcome: "+1.1R", note: "Range reclaim" },
      { symbol: "ES", outcome: "+0.6R", note: "Scaled partial" },
      { symbol: "CL", outcome: "-0.4R", note: "News drift" },
      { symbol: "GBPJPY", outcome: "+3.1R", note: "Session high sweep" },
    ], [
      { key: "symbol", x: 20, fill: () => COLORS.text, weight: 800 },
      { key: "outcome", x: 330, fill: (row) => row.outcome.startsWith("+") ? COLORS.green : COLORS.red, weight: 850 },
      { key: "note", x: 560, fill: () => COLORS.muted, size: 23 },
    ]),
    ...panel("note-editor", 1330, 520, 1320, 1320, "Selected trade note"),
    layer("text", { id: "note-title", role: "headline", x: 1390, y: 710, text: "London Break, clean continuation", fill: COLORS.text, size: 58, weight: 850, font: FONT.display }),
    layer("text", { id: "note-body-1", role: "note-text", x: 1395, y: 805, text: "Entry came after displacement, retest held above VWAP, and order tape confirmed pace.", fill: COLORS.subtext, size: 31, weight: 500, font: FONT.body }),
    layer("text", { id: "note-body-2", role: "note-text", x: 1395, y: 870, text: "Next review: avoid moving stop before the second impulse candle closes.", fill: COLORS.muted, size: 31, weight: 500, font: FONT.body }),
    ...pill("tag-discipline", 1390, 950, 250, "DISCIPLINE", "green"),
    ...pill("tag-retest", 1670, 950, 210, "RETEST", "cyan"),
    ...pill("tag-vwap", 1910, 950, 170, "VWAP", "amber"),
    ...lineChart("journal-equity", 1390, 1100, 1170, 430, [[0, 0.75], [0.1, 0.68], [0.22, 0.72], [0.34, 0.52], [0.48, 0.56], [0.62, 0.38], [0.78, 0.33], [1, 0.18]], COLORS.green),
    ...panel("snapshot-card", 2730, 520, 820, 1320, "Snapshot"),
    ...candleChart("journal-snapshot", 2785, 650, 710, 430, Array.from({ length: 22 }, (_, index) => ({ high: 0.2 + Math.sin(index) * 0.05, low: 0.78 + Math.cos(index) * 0.04, open: 0.58 - index * 0.008 + Math.sin(index * 0.4) * 0.07, close: 0.54 - index * 0.006 + Math.cos(index * 0.6) * 0.07 }))),
    ...metricCard("journal-metric-pnl", 2785, 1150, 330, "P&L", "+$1,240", "green"),
    ...metricCard("journal-metric-risk", 3165, 1150, 330, "RISK", "0.75%", "cyan"),
    ...metricCard("journal-metric-grade", 2785, 1390, 330, "GRADE", "A-", "amber"),
    ...metricCard("journal-metric-time", 3165, 1390, 330, "HOLD", "42m", "blue"),
  ];
  return scene("trade-journal-notes", "Trade journal / notes", "Journal surface", layers);
}

function playbooksScene() {
  resetLayerIds();
  const layers = [
    ...baseLayers("Playbooks", "Rules, evidence, and review loops arranged as editable boards."),
    ...panel("playbook-shell", 180, 430, 3480, 1510, ""),
    ...["London Break", "NY Reversal", "Trend Continuation"].flatMap((title, column) => {
      const x = 260 + column * 1135;
      const tone = column === 0 ? COLORS.cyan : column === 1 ? COLORS.violet : COLORS.green;
      return [
        ...panel(`playbook-column-${column}`, x, 540, 1040, 1260, title),
        ...pill(`playbook-score-${column}`, x + 680, 575, 260, column === 0 ? "68% WIN" : column === 1 ? "54% WIN" : "61% WIN", column === 1 ? "amber" : "green"),
        ...Array.from({ length: 4 }, (_, index) => [
          layer("rect", { id: `rule-${column}-${index}`, role: "playbook-rule-card", x: x + 52, y: 690 + index * 240, width: 930, height: 178, rx: 20, fill: "#0a1520", stroke: "#203848", strokeWidth: 2 }),
          layer("text", { id: `rule-${column}-${index}-label`, role: "rule-label", x: x + 90, y: 755 + index * 240, text: ["Setup", "Trigger", "Invalidation", "Review"][index], fill: tone, size: 26, weight: 850, tracking: 2, font: FONT.body }),
          layer("text", { id: `rule-${column}-${index}-copy`, role: "rule-copy", x: x + 90, y: 820 + index * 240, text: playbookCopy[column][index], fill: COLORS.subtext, size: 28, weight: 600, font: FONT.body }),
        ]).flat(),
      ];
    }),
  ];
  return scene("playbooks", "Playbooks", "Playbook board", layers);
}

const playbookCopy = [
  ["Compression at London open.", "Break, retest, displacement.", "Close below range midpoint.", "Compare pace to prior winners."],
  ["Liquidity sweep into NY.", "Reclaim after failed drive.", "Second sweep without reclaim.", "Check patience and entry timing."],
  ["Higher low above value.", "Momentum candle confirms.", "Loss of prior structure.", "Track scale-out discipline."],
];

function analyticsScene() {
  resetLayerIds();
  const layers = [
    ...baseLayers("Analytics / reports dashboard", "Performance curves, heatmaps, and strategy breakdowns as AE-editable vectors."),
    ...panel("analytics-shell", 180, 430, 3480, 1510, ""),
    ...metricCard("analytics-net", 260, 540, 520, "NET P&L", "+$8,420", "green"),
    ...metricCard("analytics-win", 820, 540, 520, "WIN RATE", "62%", "cyan"),
    ...metricCard("analytics-pf", 1380, 540, 520, "PROFIT FACTOR", "1.84", "amber"),
    ...metricCard("analytics-dd", 1940, 540, 520, "MAX DD", "-$910", "red"),
    ...metricCard("analytics-r", 2500, 540, 520, "AVG R", "0.74R", "blue"),
    ...panel("equity-curve", 260, 800, 1560, 880, "Equity curve"),
    ...lineChart("equity", 325, 925, 1430, 620, [[0, 0.72], [0.08, 0.68], [0.18, 0.76], [0.29, 0.58], [0.4, 0.5], [0.52, 0.55], [0.62, 0.38], [0.75, 0.33], [0.88, 0.24], [1, 0.18]], COLORS.green),
    ...panel("strategy-breakdown", 1900, 800, 800, 880, "Strategy breakdown"),
    ...barSet("strategy-bars", 1995, 960, 620, [
      ["London", 0.92, COLORS.cyan],
      ["NY Rev", 0.64, COLORS.violet],
      ["Trend", 0.74, COLORS.green],
      ["Range", 0.42, COLORS.amber],
      ["News", 0.28, COLORS.red],
    ]),
    ...panel("calendar-heatmap", 2780, 800, 780, 880, "Review heatmap"),
    ...heatmap("analytics-heatmap", 2845, 940, 650, 560),
  ];
  return scene("analytics-reports-dashboard", "Analytics / reports dashboard", "Reports surface", layers);
}

function barSet(id, x, y, width, rows) {
  return rows.flatMap(([labelText, value, color], index) => {
    const rowY = y + index * 112;
    return [
      layer("text", { id: `${id}-${index}-label`, role: "bar-label", x, y: rowY + 35, text: labelText, fill: COLORS.subtext, size: 26, weight: 700, font: FONT.body }),
      layer("rect", { id: `${id}-${index}-track`, role: "bar-track", x: x + 170, y: rowY + 8, width: width - 170, height: 32, rx: 16, fill: "#132938" }),
      layer("rect", { id: `${id}-${index}-fill`, role: "bar-fill", x: x + 170, y: rowY + 8, width: (width - 170) * value, height: 32, rx: 16, fill: color }),
    ];
  });
}

function heatmap(id, x, y, width, height) {
  const cols = 10;
  const rows = 6;
  const gap = 12;
  const cell = Math.min((width - gap * (cols - 1)) / cols, (height - gap * (rows - 1)) / rows);
  const palette = ["#0b1721", "#134e4a", "#0f766e", "#22d3ee", "#67e8f9"];
  const layers = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const level = (row * 3 + col * 2) % palette.length;
      layers.push(layer("rect", { id: `${id}-${row}-${col}`, role: "heatmap-cell", x: x + col * (cell + gap), y: y + row * (cell + gap), width: cell, height: cell, rx: 10, fill: palette[level], opacity: 0.65 + level * 0.08 }));
    }
  }
  return layers;
}

function positionToolsScene() {
  resetLayerIds();
  const layers = [
    ...baseLayers("Position / order tools", "Order ticket, pending orders, position exposure, and execution state."),
    ...panel("position-shell", 180, 430, 3480, 1510, ""),
    ...panel("order-ticket-main", 260, 540, 930, 1230, "Order ticket"),
    ...pill("ticket-side", 930, 575, 170, "LONG", "green"),
    ...tableRows("order-fields", 315, 690, 820, [
      { label: "Instrument", value: "EURUSD" },
      { label: "Entry", value: "1.08862" },
      { label: "Stop", value: "1.08595" },
      { label: "Target", value: "1.09502" },
      { label: "Quantity", value: "2.40 lots" },
      { label: "Risk", value: "$750" },
    ], [
      { key: "label", x: 18, fill: () => COLORS.muted },
      { key: "value", x: 450, fill: () => COLORS.text, weight: 850 },
    ]),
    ...panel("position-chart", 1270, 540, 1400, 1230, "Risk / reward ladder"),
    ...candleChart("position-ladder", 1340, 675, 1260, 760, Array.from({ length: 36 }, (_, index) => ({ high: 0.16 + Math.sin(index * 0.5) * 0.05, low: 0.82 + Math.cos(index * 0.4) * 0.04, open: 0.58 - index * 0.006 + Math.sin(index * 0.38) * 0.05, close: 0.55 - index * 0.004 + Math.cos(index * 0.6) * 0.05 }))),
    ...metricCard("position-rr", 1360, 1500, 360, "R:R", "2.40", "green"),
    ...metricCard("position-fee", 1760, 1500, 360, "FEES", "$18", "amber"),
    ...metricCard("position-exp", 2160, 1500, 360, "EXPOSURE", "$261K", "cyan"),
    ...panel("pending-orders", 2750, 540, 790, 590, "Pending orders"),
    ...tableRows("pending", 2810, 665, 670, [
      { label: "Buy limit", value: "1.08862" },
      { label: "Stop loss", value: "1.08595" },
      { label: "Take profit", value: "1.09502" },
      { label: "Trail", value: "Off" },
    ], [
      { key: "label", x: 18, fill: () => COLORS.subtext },
      { key: "value", x: 410, fill: () => COLORS.text, weight: 800 },
    ]),
    ...panel("live-position", 2750, 1190, 790, 580, "Live position"),
    ...metricCard("live-pnl", 2810, 1310, 300, "OPEN P&L", "+$420", "green"),
    ...metricCard("live-r", 3180, 1310, 300, "OPEN R", "+0.56R", "green"),
    ...metricCard("live-fill", 2810, 1540, 300, "FILLED", "100%", "cyan"),
    ...metricCard("live-state", 3180, 1540, 300, "STATE", "Active", "blue"),
  ];
  return scene("position-order-tools", "Position / order tools", "Execution tools", layers);
}

function sizingScene() {
  resetLayerIds();
  const layers = [
    ...baseLayers("Position sizing calculator", "Risk budget, stops, pip value, and computed quantity as AE-native components."),
    ...panel("sizing-shell", 180, 430, 3480, 1510, ""),
    ...panel("sizing-form", 260, 540, 1260, 1230, "Inputs"),
    ...tableRows("sizing-inputs", 330, 690, 1120, [
      { label: "Account balance", value: "$100,000" },
      { label: "Risk percent", value: "0.75%" },
      { label: "Entry price", value: "1.08862" },
      { label: "Stop price", value: "1.08595" },
      { label: "Pip value", value: "$10.00" },
      { label: "Commission", value: "$18.00" },
    ], [
      { key: "label", x: 18, fill: () => COLORS.muted },
      { key: "value", x: 700, fill: () => COLORS.text, weight: 850 },
    ]),
    ...panel("sizing-output", 1600, 540, 930, 1230, "Calculated size"),
    layer("text", { id: "sizing-result", role: "hero-number", x: 1690, y: 820, text: "2.40", fill: COLORS.cyan, size: 210, weight: 900, font: FONT.display }),
    layer("text", { id: "sizing-result-unit", role: "hero-label", x: 1720, y: 930, text: "standard lots", fill: COLORS.subtext, size: 44, weight: 750, font: FONT.body }),
    ...metricCard("sizing-risk", 1680, 1080, 330, "RISK", "$750", "red"),
    ...metricCard("sizing-pips", 2070, 1080, 330, "STOP", "26.7", "amber"),
    ...metricCard("sizing-notional", 1680, 1320, 720, "NOTIONAL", "$261,268", "green"),
    ...panel("sizing-ladder", 2610, 540, 930, 1230, "Risk ladder"),
    ...lineChart("sizing-curve", 2670, 700, 800, 480, [[0, 0.82], [0.16, 0.72], [0.32, 0.62], [0.48, 0.5], [0.64, 0.36], [0.8, 0.26], [1, 0.16]], COLORS.cyan),
    ...barSet("sizing-bars", 2700, 1260, 720, [
      ["0.25%", 0.32, COLORS.green],
      ["0.50%", 0.55, COLORS.cyan],
      ["0.75%", 0.78, COLORS.amber],
      ["1.00%", 1, COLORS.red],
    ]),
  ];
  return scene("position-sizing-calculator", "Position sizing calculator", "Risk calculator", layers);
}

function calendarScene() {
  resetLayerIds();
  const layers = [
    ...baseLayers("Economic calendar", "Macro events, impact filters, countdowns, and trading-session context."),
    ...panel("calendar-shell", 180, 430, 3480, 1510, ""),
    ...panel("calendar-list", 260, 540, 1580, 1230, "High impact events"),
    ...tableRows("events", 330, 680, 1440, [
      { time: "08:30", currency: "USD", event: "Core CPI m/m", impact: "HIGH" },
      { time: "10:00", currency: "USD", event: "Fed Chair Powell speaks", impact: "HIGH" },
      { time: "14:00", currency: "EUR", event: "ECB rate statement", impact: "MED" },
      { time: "18:45", currency: "JPY", event: "Tokyo CPI y/y", impact: "MED" },
      { time: "22:30", currency: "AUD", event: "Employment change", impact: "HIGH" },
    ], [
      { key: "time", x: 18, fill: () => COLORS.text, font: FONT.mono, weight: 850 },
      { key: "currency", x: 260, fill: () => COLORS.cyan, weight: 850 },
      { key: "event", x: 430, fill: () => COLORS.subtext },
      { key: "impact", x: 1160, fill: (row) => row.impact === "HIGH" ? COLORS.red : COLORS.amber, weight: 850 },
    ]),
    ...panel("calendar-impact", 1930, 540, 780, 1230, "Impact map"),
    ...heatmap("calendar-heatmap", 2000, 690, 640, 580),
    ...metricCard("calendar-next", 2020, 1350, 280, "NEXT", "08:30", "red"),
    ...metricCard("calendar-window", 2360, 1350, 280, "LOCKOUT", "15m", "amber"),
    ...panel("calendar-countdown", 2790, 540, 750, 1230, "Countdown"),
    layer("circle", { id: "countdown-ring-bg", role: "countdown-ring", cx: 3165, cy: 890, r: 230, fill: "none", stroke: "#142c3b", strokeWidth: 34 }),
    layer("path", { id: "countdown-ring-progress", role: "countdown-progress", d: "M 3165 660 A 230 230 0 1 1 2970 1010", fill: "none", stroke: COLORS.red, strokeWidth: 34, strokeLinecap: "round" }),
    layer("text", { id: "countdown-value", role: "hero-number", x: 3028, y: 925, text: "12:44", fill: COLORS.text, size: 78, weight: 900, font: FONT.mono }),
    layer("text", { id: "countdown-label", role: "hero-label", x: 3025, y: 1010, text: "until CPI", fill: COLORS.muted, size: 32, weight: 700, font: FONT.body }),
    ...metricCard("calendar-symbols", 2910, 1260, 500, "WATCHLIST", "EURUSD NQ GC", "cyan"),
    ...metricCard("calendar-bias", 2910, 1500, 500, "SESSION BIAS", "Risk off", "amber"),
  ];
  return scene("economic-calendar", "Economic calendar", "Macro calendar", layers);
}

function scene(id, title, shortTitle, layers) {
  return {
    id,
    title,
    shortTitle,
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    durationSeconds: DURATION_SECONDS,
    fps: FPS,
    fonts: [FONT.body, FONT.display, FONT.mono],
    colors: COLORS,
    layers,
  };
}

export function buildScenes() {
  return [
    sessionGatewayScene(),
    replayEngineScene(),
    journalScene(),
    playbooksScene(),
    analyticsScene(),
    positionToolsScene(),
    sizingScene(),
    calendarScene(),
  ];
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attrs(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(" ");
}

function renderLayer(item) {
  const common = {
    id: item.id,
    "data-role": item.role,
    opacity: item.opacity,
  };
  if (item.type === "rect") {
    return `<rect ${attrs({ ...common, x: item.x, y: item.y, width: item.width, height: item.height, rx: item.rx, fill: item.fill, stroke: item.stroke, "stroke-width": item.strokeWidth })} />`;
  }
  if (item.type === "circle") {
    return `<circle ${attrs({ ...common, cx: item.cx, cy: item.cy, r: item.r, fill: item.fill, stroke: item.stroke, "stroke-width": item.strokeWidth })} />`;
  }
  if (item.type === "line") {
    return `<line ${attrs({ ...common, x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2, stroke: item.stroke, "stroke-width": item.strokeWidth, "stroke-dasharray": item.strokeDasharray, "stroke-linecap": item.strokeLinecap })} />`;
  }
  if (item.type === "path") {
    return `<path ${attrs({ ...common, d: item.d, fill: item.fill, stroke: item.stroke, "stroke-width": item.strokeWidth, "stroke-linecap": item.strokeLinecap, "stroke-linejoin": item.strokeLinejoin, "stroke-dasharray": item.strokeDasharray })} />`;
  }
  if (item.type === "text") {
    return `<text ${attrs({ ...common, x: item.x, y: item.y, fill: item.fill, "font-family": item.font, "font-size": item.size, "font-weight": item.weight, "letter-spacing": item.tracking })}>${esc(item.text)}</text>`;
  }
  return "";
}

export function renderSceneSvg(scene) {
  const groups = scene.layers
    .map((item) => `<g id="layer-${esc(item.id)}" data-layer-type="${esc(item.type)}">${renderLayer(item)}</g>`)
    .join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT}" viewBox="0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}" role="img" aria-labelledby="${scene.id}-title">
  <title id="${scene.id}-title">${esc(scene.title)}</title>
  <metadata>${esc(JSON.stringify({ id: scene.id, title: scene.title, source: "EdgeLab AE Teaser Assets" }))}</metadata>
  ${groups}
</svg>
`;
}
