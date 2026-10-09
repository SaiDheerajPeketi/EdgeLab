/** Synthetic, seeded market data. No feed, trading signal or performance evidence. */
export type DemoMarketBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type DemoMarketState = {
  randomState: number;
  time: number;
  price: number;
  intervalSeconds: number;
  baseVolume: number;
  regime: "advance" | "decline" | "range" | "expansion";
  remaining: number;
  drift: number;
  volatility: number;
  anchor: number;
};

export function createDemoMarket({
  seed = 52,
  startTime = Date.UTC(2026, 5, 12, 9, 30) / 1000,
  startPrice = 4278.8,
  intervalSeconds = 300,
  baseVolume = 182_000,
}: {
  seed?: number;
  startTime?: number;
  startPrice?: number;
  intervalSeconds?: number;
  baseVolume?: number;
} = {}): DemoMarketState {
  if (!Number.isSafeInteger(startTime) || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 ||
      !Number.isFinite(seed) || !Number.isFinite(startPrice) || startPrice <= 0 ||
      !Number.isFinite(baseVolume) || baseVolume <= 0) {
    throw new RangeError("Synthetic market parameters must be finite and positive, with whole-second timestamps.");
  }
  return { randomState: seed | 0, time: startTime - intervalSeconds, price: startPrice,
    intervalSeconds, baseVolume, regime: "range", remaining: 0, drift: 0,
    volatility: 0.0008, anchor: startPrice };
}

/** Immutable state makes stepping deterministic, including React's repeated updater checks. */
export function nextDemoBar(previous: DemoMarketState): { state: DemoMarketState; bar: DemoMarketBar } {
  const state = { ...previous };
  const random = () => {
    state.randomState = (state.randomState + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state.randomState ^ (state.randomState >>> 15), 1 | state.randomState);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  if (state.remaining <= 0) {
    const regimes = ["advance", "decline", "range", "expansion"] as const;
    state.regime = regimes[Math.floor(random() * regimes.length)];
    state.remaining = 18 + Math.floor(random() * 48);
    state.volatility = 0.00035 + random() * (state.regime === "expansion" ? 0.0021 : 0.00085);
    const trend = state.volatility * (0.1 + random() * 0.15);
    state.drift = state.regime === "advance" ? trend :
      state.regime === "decline" ? -trend :
      state.regime === "expansion" ? (random() < 0.5 ? -1 : 1) * trend : 0;
    state.anchor = state.price;
  }
  const open = state.price;
  const noise = (random() + random() + random() - 1.5) * state.volatility;
  const pullback = state.regime === "range" ? Math.log(state.anchor / open) * 0.085 : 0;
  const impulse = random() < 0.035 ? (random() - 0.5) * state.volatility * 4 : 0;
  const change = Math.max(-0.02, Math.min(0.02, state.drift + noise + pullback + impulse));
  const close = open * Math.exp(change);
  const body = Math.abs(close - open);
  const wick = Math.max(body * 0.25, open * state.volatility * 0.2);
  const high = Math.max(open, close) + wick * (0.25 + random() * 1.8);
  const low = Math.max(Number.MIN_VALUE, Math.min(open, close) - wick * (0.25 + random() * 1.8));
  const volume = Math.round(state.baseVolume * (0.55 + random() * 0.9 + Math.abs(change) / state.volatility * 0.55));
  state.time += state.intervalSeconds;
  state.price = close;
  state.remaining -= 1;
  return { state, bar: { time: state.time, open, high, low, close, volume } };
}

export function generateDemoBars(state: DemoMarketState, count: number): { state: DemoMarketState; bars: DemoMarketBar[] } {
  if (!Number.isSafeInteger(count) || count < 0 || count > 20_000) throw new RangeError("Synthetic generation count must be 0–20000.");
  const bars: DemoMarketBar[] = [];
  let current = state;
  for (let index = 0; index < count; index += 1) {
    const next = nextDemoBar(current);
    current = next.state;
    bars.push(next.bar);
  }
  return { state: current, bars };
}

/** Fit readable candles to the plot width, using only available history. */
export function demoVisibleBarCount(width: number, available: number) {
  return Math.min(available, Math.max(16, Math.min(160, Math.floor(Math.max(0, width) / 9))));
}

export type DemoReplay = {
  market: DemoMarketState;
  bars: DemoMarketBar[];
  firstIndex: number;
  cursor: number;
};

export function createDemoReplay(seed = 52): DemoReplay {
  const generated = generateDemoBars(createDemoMarket({ seed }), 256);
  return { market: generated.state, bars: generated.bars, firstIndex: 0, cursor: generated.bars.length - 1 };
}

export function appendDemoReplay(previous: DemoReplay): DemoReplay {
  const next = nextDemoBar(previous.market);
  const bars = [...previous.bars, next.bar];
  const dropped = Math.max(0, bars.length - 2048);
  const firstIndex = previous.firstIndex + dropped;
  return { market: next.state, bars: dropped ? bars.slice(dropped) : bars,
    firstIndex, cursor: firstIndex + bars.length - dropped - 1 };
}
