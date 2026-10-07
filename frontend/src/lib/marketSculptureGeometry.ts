import { createDemoMarket, generateDemoBars } from "./demoMarket";

export type MarketSculptureChapter = "price" | "decisions" | "review";
export type SculpturePoint = { x: number; y: number; z: number };
export type SculptureProjectionPoint = { x: number; y: number; depth: number };

// Fixed synthetic data shared by both renderers. Camera/chapter changes never resample it.
const exampleBars = generateDemoBars(createDemoMarket({ seed: 81 }), 96).bars;
const maxVolume = Math.max(...exampleBars.map(bar => bar.volume));
export const CANDLES = Object.freeze(exampleBars.map(bar => Object.freeze({ ...bar, volume: bar.volume / maxVolume })));
export const PRICE_LOW = Math.min(...CANDLES.map(bar => bar.low));
export const PRICE_HIGH = Math.max(...CANDLES.map(bar => bar.high));
export const PRICE_SCALE = 8 / (PRICE_HIGH - PRICE_LOW);
export const PRICE_CENTER = (PRICE_LOW + PRICE_HIGH) / 2;
export const FLOOR_Y = -4.35;
export const ENTRY_INDEX = 43;
export const EXIT_INDEX = 81;
export const STOP_PRICE = CANDLES[ENTRY_INDEX].low - 0.3 / PRICE_SCALE;
export const WORLD_YAW = -0.08;
export const CAMERA_FOV = 36;

export function candlePosition(index: number) {
  return { x: (index - 47.5) * 0.18, z: Math.sin(index * 0.055) * 1.75 };
}

export function priceY(price: number) { return (price - PRICE_CENTER) * PRICE_SCALE; }

const add = (a: SculpturePoint, b: SculpturePoint): SculpturePoint => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a: SculpturePoint, b: SculpturePoint): SculpturePoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: SculpturePoint, b: SculpturePoint) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: SculpturePoint, b: SculpturePoint): SculpturePoint => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = (value: SculpturePoint): SculpturePoint => {
  const length = Math.hypot(value.x, value.y, value.z);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};
const worldPoint = (value: SculpturePoint): SculpturePoint => ({
  x: value.x * Math.cos(WORLD_YAW) + value.z * Math.sin(WORLD_YAW), y: value.y,
  z: -value.x * Math.sin(WORLD_YAW) + value.z * Math.cos(WORLD_YAW),
});
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export type SculptureFaceName = "front" | "back" | "left" | "right" | "top" | "bottom";
export type SculptureFace = {
  kind: "face"; layer: "body" | "volume"; index: number; face: SculptureFaceName;
  points: SculptureProjectionPoint[]; depth: number; tone: "up" | "down";
};
export type SculptureWick = {
  kind: "wick"; layer: "wick"; index: number; points: [SculptureProjectionPoint, SculptureProjectionPoint];
  depth: number; tone: "up" | "down";
};
export type SculpturePrimitive = SculptureFace | SculptureWick;
const faces: { name: SculptureFaceName; corners: number[]; normal: SculpturePoint }[] = [
  { name: "front", corners: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
  { name: "back", corners: [0, 3, 2, 1], normal: { x: 0, y: 0, z: -1 } },
  { name: "left", corners: [0, 4, 7, 3], normal: { x: -1, y: 0, z: 0 } },
  { name: "right", corners: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
  { name: "top", corners: [3, 7, 6, 2], normal: { x: 0, y: 1, z: 0 } },
  { name: "bottom", corners: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
];
const cornerSigns = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];

export type MarketSculptureProjectionOptions = {
  width: number; height: number; yaw?: number; pitch?: number; chapter?: MarketSculptureChapter;
};

/** Software perspective projection of the same scene coordinates as the WebGL study. */
export function projectMarketSculpture(options: MarketSculptureProjectionOptions) {
  const width = Number.isFinite(options.width) ? Math.max(1, options.width) : 1000;
  const height = Number.isFinite(options.height) ? Math.max(1, options.height) : 600;
  const yaw = Number.isFinite(options.yaw) ? options.yaw! : 0;
  const pitch = Number.isFinite(options.pitch) ? options.pitch! : 0;
  const aspect = width / height;
  const distance = Math.max(20, 29 / aspect);
  const angle = 0.28 + yaw;
  const camera: SculpturePoint = { x: Math.sin(angle) * distance, y: distance * 0.34 + pitch * 6, z: Math.cos(angle) * distance };
  const target: SculpturePoint = { x: 0, y: -0.8, z: 0 };
  const forward = normalize(subtract(target, camera));
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const focal = height / (2 * Math.tan(CAMERA_FOV * Math.PI / 360));
  const project = (point: SculpturePoint): SculptureProjectionPoint => {
    const relative = subtract(worldPoint(point), camera);
    const depth = dot(relative, forward);
    return { x: width / 2 + dot(relative, right) * focal / depth,
      y: height / 2 - dot(relative, up) * focal / depth, depth };
  };
  const primitives: SculpturePrimitive[] = [];
  const box = (index: number, center: SculpturePoint, size: SculpturePoint, layer: SculptureFace["layer"], tone: SculptureFace["tone"]) => {
    const corners = cornerSigns.map(([x, y, z]) => add(center, { x: x * size.x / 2, y: y * size.y / 2, z: z * size.z / 2 }));
    const towardCamera = subtract(camera, worldPoint(center));
    for (const face of faces) {
      if (dot(worldPoint(face.normal), towardCamera) <= 0) continue;
      const points = face.corners.map(index => project(corners[index]));
      primitives.push({ kind: "face", layer, index, face: face.name, points,
        depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length, tone });
    }
  };
  CANDLES.forEach((bar, index) => {
    const { x, z } = candlePosition(index);
    const tone = bar.close >= bar.open ? "up" : "down";
    box(index, { x, y: priceY((bar.open + bar.close) / 2), z },
      { x: 0.115, y: Math.max(0.075, Math.abs(bar.close - bar.open) * PRICE_SCALE), z: 0.34 }, "body", tone);
    box(index, { x, y: -4.3 + bar.volume * 0.4, z }, { x: 0.105, y: bar.volume * 0.8, z: 0.34 }, "volume", tone);
    const points: SculptureWick["points"] = [project({ x, y: priceY(bar.high), z }), project({ x, y: priceY(bar.low), z })];
    primitives.push({ kind: "wick", layer: "wick", index, points, depth: (points[0].depth + points[1].depth) / 2, tone });
  });
  primitives.sort((a, b) => b.depth - a.depth || a.index - b.index);
  const floor = [{ x: -10, y: FLOOR_Y, z: -4 }, { x: 10, y: FLOOR_Y, z: -4 },
    { x: 10, y: FLOOR_Y, z: 4 }, { x: -10, y: FLOOR_Y, z: 4 }].map(project);
  const grid: [SculptureProjectionPoint, SculptureProjectionPoint][] = [];
  for (let x = -10; x <= 10; x += 2) grid.push([project({ x, y: FLOOR_Y, z: -4 }), project({ x, y: FLOOR_Y, z: 4 })]);
  for (let z = -4; z <= 4; z += 1) grid.push([project({ x: -10, y: FLOOR_Y, z }), project({ x: 10, y: FLOOR_Y, z })]);
  const landmark = (index: number) => {
    const position = candlePosition(index);
    const point = { ...position, y: priceY(CANDLES[index].high) + 0.9 };
    return { index, point: project(point), world: point,
      stem: [project({ ...position, y: FLOOR_Y }), project(point)] as const,
      label: { x: clamp(project(point).x, 38, Math.max(38, width - 38)), y: Math.max(20, project(point).y - 17) } };
  };
  const entry = landmark(ENTRY_INDEX), exit = landmark(EXIT_INDEX);
  const entryPosition = candlePosition(ENTRY_INDEX), exitPosition = candlePosition(EXIT_INDEX);
  const stop = [project({ ...entryPosition, y: priceY(STOP_PRICE) }),
    project({ x: exitPosition.x, y: priceY(STOP_PRICE), z: entryPosition.z })] as const;
  const trail = [entry.point, project({ x: entry.world.x, y: exit.world.y, z: entry.world.z }), exit.point];
  const priceTicks = Array.from({ length: 5 }, (_, index) => {
    const price = PRICE_LOW + (PRICE_HIGH - PRICE_LOW) * index / 4;
    const point = project({ x: -9.5, y: priceY(price), z: 3.4 });
    // JetBrains Mono measurements at 10px; reserve the endpoint-caption row.
    const label = { x: clamp(point.x - 5, price.toFixed(1).length * 6 + 8, width - 8),
      y: clamp(point.y + 3, 20, height - 44) };
    return { price, point, label };
  });
  const timeTicks = [0, 23, 47, 71, 95].map(index => {
    const point = project({ x: candlePosition(index).x, y: FLOOR_Y, z: 3.85 });
    return { index, point, time: CANDLES[index].time,
      label: { x: clamp(point.x, 16, width - 16), y: clamp(point.y + 15, 20, height - 44) } };
  });
  return { width, height, yaw, pitch, chapter: options.chapter ?? "price", camera, target, project,
    primitives, floor, grid, entry, exit, stop, trail, priceTicks, timeTicks };
}
