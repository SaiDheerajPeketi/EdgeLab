import type { Candle } from "./api";
import { aggregateBars, bucketTime, canAggregateTimeframe, getTimeframeSeconds, normalizeChartTimeframe, type ChartTimeframe } from "./charting";
import { PINE_LIMITS, PineProtocolError, validatePineBar } from "./pineProtocol";

export type PineFeedEvent = { sequence: number; bar: Candle; confirmed: boolean; eventTime: number; closeTime: number };
export type PineFeedSnapshot = { epoch: number; symbol: string; sourceTimeframe?: ChartTimeframe; bars: readonly Candle[]; event: PineFeedEvent | null; error: string | null };
export type PineLiveFeed = {
  getSnapshot(): PineFeedSnapshot;
  subscribe(listener: (snapshot: PineFeedSnapshot) => void): () => void;
  seed(bars: Candle[]): void;
  receive(bar: Candle, confirmed: boolean, eventTime: number, closeTime: number): void;
  reset(): void;
  fail(message: string): void;
};

const NATIVE_SOURCE_TIMEFRAMES = new Set(["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "8H", "12H", "1D", "1W", "1M"]);

/** Calendar months cannot be advanced by their nominal duration in seconds. */
export function pineFeedNextSourceTime(time: number, sourceTimeframe: ChartTimeframe): number {
  if (sourceTimeframe === "1M") {
    const date = new Date(time * 1000);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
  }
  return time + getTimeframeSeconds(sourceTimeframe);
}

/** Authoritative native interval events are recorded before React can batch them. */
export function createPineLiveFeed(symbol: string, sourceTimeframe: ChartTimeframe = "1m"): PineLiveFeed {
  const normalizedTimeframe = normalizeChartTimeframe(sourceTimeframe);
  if (!normalizedTimeframe || !NATIVE_SOURCE_TIMEFRAMES.has(normalizedTimeframe)) {
    throw new PineProtocolError("LIVE_TIMEFRAME", "The live provider does not support this source candle interval.");
  }
  sourceTimeframe = normalizedTimeframe;
  const sourceLabel = sourceTimeframe === "1m" ? "one-minute" : sourceTimeframe;
  const nextTime = (time: number) => pineFeedNextSourceTime(time, sourceTimeframe);
  const listeners = new Set<(snapshot: PineFeedSnapshot) => void>();
  let epoch = 0, sequence = 0, seeded = false;
  let snapshot: PineFeedSnapshot = { epoch, symbol, sourceTimeframe, bars: [], event: null, error: null };
  let lastReceived: PineFeedEvent | null = null;
  const pending: PineFeedEvent[] = [];
  const emit = () => { for (const listener of listeners) listener(snapshot); };
  const fail = (message: string) => { snapshot = { ...snapshot, error: message }; pending.length = 0; emit(); };
  const apply = (event: PineFeedEvent) => {
    const bars = snapshot.bars;
    const tail = bars.at(-1);
    if (tail && tail.time > event.bar.time) { fail("Live history extends past the received candle. Reload the feed to restart indicators."); return; }
    if (tail?.time === event.bar.time) snapshot = { ...snapshot, bars: [...bars.slice(0, -1), event.bar], event };
    else {
      if (tail && event.bar.time !== nextTime(tail.time)) { fail("Live candle history has a gap. Reload the feed to restart indicators."); return; }
      if (bars.length >= PINE_LIMITS.bars) { fail(`Live indicator history reached 20,000 ${sourceTimeframe === "1m" ? "minutes" : "candles"}. Reload the feed for a fresh window.`); return; }
      snapshot = { ...snapshot, bars: [...bars, event.bar], event };
    }
    emit();
  };
  const same = (a: PineFeedEvent, b: PineFeedEvent) => a.bar.time === b.bar.time && a.confirmed === b.confirmed && a.closeTime === b.closeTime
    && ["open", "high", "low", "close", "volume"].every(key => a.bar[key as keyof Candle] === b.bar[key as keyof Candle]);
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); listener(snapshot); return () => { listeners.delete(listener); }; },
    reset: () => {
      epoch++;
      sequence = 0;
      seeded = false;
      lastReceived = null;
      pending.length = 0;
      snapshot = { epoch, symbol, sourceTimeframe, bars: [], event: null, error: null };
      emit();
    },
    fail,
    seed: input => {
      if (snapshot.error || seeded) return;
      try {
        const bars = input.slice(-PINE_LIMITS.bars).map(validatePineBar);
        if (!bars.length || bars.some((bar, index) => bucketTime(bar.time, sourceTimeframe) !== bar.time
          || (index > 0 && bar.time !== nextTime(bars[index - 1].time)))) throw new Error(`Live indicator history requires continuous ${sourceLabel} candles.`);
        // REST may finish after several WS events. Its unfinished tail must not
        // overwrite any received event or enter committed warmup history.
        const boundary = pending[0]?.bar.time;
        snapshot = { ...snapshot, bars: boundary === undefined ? bars : bars.filter(bar => bar.time < boundary) };
        seeded = true;
        if (!pending.length) emit();
        for (const event of pending.splice(0)) { if (snapshot.error) break; apply(event); }
      } catch (error) { fail(error instanceof Error ? error.message : "Live indicator history is unavailable."); }
    },
    receive: (input, confirmed, eventTime, closeTime) => {
      if (snapshot.error) return;
      try {
        const bar = validatePineBar(input);
        if (bucketTime(bar.time, sourceTimeframe) !== bar.time || typeof confirmed !== "boolean" || !Number.isSafeInteger(eventTime) || eventTime < 0
          || closeTime !== nextTime(bar.time) * 1000 - 1) throw new Error(`The live provider returned an invalid ${sourceLabel} candle event.`);
        const event = { sequence: sequence + 1, bar, confirmed, eventTime, closeTime };
        if (lastReceived) {
          // Replayed transport events and repeated committed closes are idempotent.
          if (same(event, lastReceived) && (eventTime === lastReceived.eventTime || lastReceived.confirmed)) return;
          if (eventTime < lastReceived.eventTime || bar.time < lastReceived.bar.time) throw new Error("Live candle events arrived out of order.");
          if (bar.time === lastReceived.bar.time) {
            if (lastReceived.confirmed) throw new Error("The live provider revised a confirmed candle.");
          } else if (!lastReceived.confirmed || bar.time !== nextTime(lastReceived.bar.time)) throw new Error("A live candle advanced without an explicit closing event.");
        }
        sequence++;
        lastReceived = event;
        if (!seeded) {
          if (pending.length >= 32) throw new Error("Live updates exceeded the history-loading queue. Reload the feed to restart indicators.");
          pending.push(event);
        } else {
          // The first authoritative event establishes the REST cutoff even when
          // history finished loading first; no wall-clock confirmation is inferred.
          if (!snapshot.event) snapshot = { ...snapshot, bars: snapshot.bars.filter(item => item.time < bar.time) };
          apply(event);
        }
      } catch (error) { fail(error instanceof Error ? error.message : "Live candle updates are unavailable."); }
    },
  };
}

/** Include unfinished bucket constituents in the live bar, never in warmup. */
export function pineFeedChartSnapshot(snapshot: PineFeedSnapshot, timeframe: ChartTimeframe): { history: Candle[]; bar: Candle; confirmed: boolean } | null {
  if (snapshot.error) throw new PineProtocolError("LIVE_FEED_ERROR", snapshot.error);
  if (!snapshot.event) return null;
  const sourceTimeframe = snapshot.sourceTimeframe ?? "1m";
  if (!canAggregateTimeframe(timeframe, sourceTimeframe)) throw new PineProtocolError("LIVE_TIMEFRAME", `This ${sourceTimeframe === "1m" ? "one-minute" : sourceTimeframe} feed cannot run live Pine on a shorter or incompatible chart interval.`);
  const currentTime = bucketTime(snapshot.event.bar.time, timeframe);
  const bars = aggregateBars([...snapshot.bars], timeframe);
  const current = bars.find(bar => bar.time === currentTime);
  if (!current) throw new PineProtocolError("LIVE_FEED_ERROR", "The current live chart candle is unavailable.");
  return {
    history: bars.filter(bar => bar.time < currentTime),
    bar: current,
    confirmed: snapshot.event.confirmed && bucketTime(pineFeedNextSourceTime(snapshot.event.bar.time, sourceTimeframe), timeframe) !== currentTime,
  };
}
