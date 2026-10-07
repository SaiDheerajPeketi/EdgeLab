import { useMemo } from "react";
import { CANDLES, PRICE_HIGH, PRICE_LOW, projectMarketSculpture, type MarketSculptureChapter,
  type SculptureFace, type SculptureProjectionPoint } from "../../lib/marketSculptureGeometry";

export type MarketSculptureProjectionProps = {
  chapter: MarketSculptureChapter;
  yaw: number;
  pitch: number;
  width?: number;
  height?: number;
  className?: string;
};
const point = (value: SculptureProjectionPoint) => `${value.x.toFixed(3)},${value.y.toFixed(3)}`;
const path = (points: readonly SculptureProjectionPoint[]) => points.map((value, index) => `${index ? "L" : "M"}${point(value)}`).join(" ");
const faceColor = (face: SculptureFace) => {
  if (face.layer === "volume") return face.face === "top" ? "#43bfd0" : face.face === "left" || face.face === "right" ? "#164f64" : "#2c97a8";
  if (face.tone === "up") return face.face === "top" ? "#a5f8dc" : face.face === "left" || face.face === "right" ? "#279d80" : "#55e6bb";
  return face.face === "top" ? "#ffc0ce" : face.face === "left" || face.face === "right" ? "#b44c67" : "#fa7893";
};

/** Crisp software-rendered geometry for loading, unavailable WebGL and context loss. */
export function MarketSculptureProjection({ chapter, yaw, pitch, width = 1000, height = 600, className = "" }: MarketSculptureProjectionProps) {
  const scene = useMemo(() => projectMarketSculpture({ width, height, yaw, pitch, chapter }), [width, height, yaw, pitch, chapter]);
  const decisions = chapter !== "price";
  return <svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"
    viewBox={`0 0 ${scene.width} ${scene.height}`} preserveAspectRatio="xMidYMid meet" className={className}
    data-market-projection data-chapter={chapter} data-camera={`${yaw},${pitch}`} data-candle-count={CANDLES.length}
    data-price-low={PRICE_LOW} data-price-high={PRICE_HIGH}>
    <rect width={scene.width} height={scene.height} fill="#050a10" />
    <g data-scene-layer="floor">
      <polygon points={scene.floor.map(point).join(" ")} fill="#0a1923" stroke="#244a5a" strokeWidth="0.7" />
      {scene.grid.map((line, index) => <path d={path(line)} key={index} fill="none" stroke="#2b5969" strokeOpacity="0.55" strokeWidth="0.65" />)}
    </g>
    <g strokeLinejoin="miter">
      {scene.primitives.map((primitive, index) => {
        const bar = CANDLES[primitive.index];
        const identity = { "data-candle-index": primitive.index, "data-candle-number": primitive.index + 1,
          "data-time": bar.time, "data-open": bar.open, "data-high": bar.high, "data-low": bar.low, "data-close": bar.close,
          "data-volume": bar.volume, "data-scene-layer": primitive.layer, "data-depth": primitive.depth };
        return primitive.kind === "face"
          ? <polygon {...identity} data-face={primitive.face} key={index} points={primitive.points.map(point).join(" ")}
              fill={faceColor(primitive)} fillOpacity={primitive.layer === "volume" ? 0.64 : 1}
              stroke={primitive.layer === "volume" ? "#3a8d9d" : primitive.tone === "up" ? "#164e42" : "#672f41"}
              strokeWidth="0.35" strokeOpacity="0.6" />
          : <path {...identity} key={index} d={path(primitive.points)} fill="none"
              stroke={primitive.tone === "up" ? "#93f2d1" : "#ffacc0"} strokeWidth="0.85" />;
      })}
    </g>
    <g data-scene-layer="measurement" className="font-data" fill="#85a6b5" fontSize="10">
      {scene.priceTicks.map(tick => <text key={tick.price} data-measurement="price" x={tick.label.x} y={tick.label.y} textAnchor="end">{tick.price.toFixed(1)}</text>)}
      {scene.timeTicks.map(tick => <text key={tick.index} data-measurement="time" x={tick.label.x} y={tick.label.y} textAnchor="middle">{String(tick.index + 1).padStart(2, "0")}</text>)}
    </g>
    {decisions ? <g data-scene-layer="decisions" fill="none">
      <path d={path(scene.stop)} stroke="#fb7185" strokeWidth="1.3" strokeDasharray="4 3" data-decision="stop" />
      <text x={scene.stop[1].x + 6} y={scene.stop[1].y + 4} fontSize="11" fill="#fda4af">Stop</text>
      {[scene.entry, scene.exit].map((landmark, index) => {
        const tint = index === 0 ? "#67e8f9" : "#fbbf24";
        const { x, y } = landmark.point;
        return <g key={landmark.index} data-decision={index === 0 ? "entry" : "exit"} data-candle-index={landmark.index} data-candle-number={landmark.index + 1}>
          <path d={path(landmark.stem)} stroke={tint} strokeOpacity="0.65" strokeWidth="0.9" />
          <polygon points={`${x},${y - 6} ${x + 5},${y} ${x},${y + 6} ${x - 5},${y}`} fill={tint} stroke={tint} strokeWidth="0.6" />
          <text x={landmark.label.x} y={landmark.label.y} textAnchor="middle" fill={tint} fontSize="12" fontWeight="600">{index === 0 ? "Entry" : "Exit"} {landmark.index + 1}</text>
        </g>;
      })}
    </g> : null}
    {chapter === "review" ? <g data-scene-layer="review" fill="none">
      <path d={path(scene.trail)} stroke="#67e8f9" strokeWidth="1.5" strokeDasharray="6 3" data-decision="review-trail" />
      <circle cx={scene.entry.point.x} cy={scene.entry.point.y} r="9" stroke="#67e8f9" strokeWidth="0.8" />
      <circle cx={scene.exit.point.x} cy={scene.exit.point.y} r="9" stroke="#fbbf24" strokeWidth="0.8" />
    </g> : null}
  </svg>;
}
