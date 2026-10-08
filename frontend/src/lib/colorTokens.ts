export const CHART_COLOR = {
  amber: "#f59e0b",
  blue: "#60a5fa",
  cyan: "#32d3ee",
  down: "#fb7185",
  grid: "#334155",
  lime: "#84cc16",
  magenta: "#f472b6",
  muted: "#94a3b8",
  orange: "#fb923c",
  orangeStrong: "#f97316",
  sky: "#38bdf8",
  surface: "#0d1117",
  teal: "#2dd4bf",
  text: "#a8b3c7",
  up: "#22c55e",
  violet: "#a78bfa",
  violetSoft: "#c084fc",
  warm: "#fbbf24",
  white: "#f8fafc",
} as const;

/** Compose a drawing's own alpha with the requested fill opacity. */
export function colorWithOpacity(color: string, opacity: number) {
  if (!/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) return color;
  const hex = color.slice(1);
  const expanded = hex.length === 3 ? hex.split("").map(char => char + char).join("") : hex;
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha * Math.min(1, Math.max(0, opacity))})`;
}
