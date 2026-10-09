import { binanceChartEvent, binanceChartPlan } from "./binanceChartFeed";
import { trackDiagnosticWebSocket } from "./browserDiagnostics";
import { pineContextForChart } from "./customIndicators";
import { advancePineLiveMarkets, pineLiveMarketKey, validatePineLiveMarketEvents, validatePineLiveMarketStreams,
  PINE_LIVE_MARKET_BATCH_LIMIT, type PineLiveMarketEvent, type PineLiveMarketState, type PineLiveMarketStream } from "./pineLiveMarkets";
import { pineMarketSymbol } from "./pineMarketProtocol";
import { createPineMarketDataResolver, type PineMarketDataScope, type PineMarketHistoryAdmission } from "./pineMarketDataResolver";
import { canonicalPineTimeframe, PineProtocolError } from "./pineProtocol";

type Socket = Pick<WebSocket, "addEventListener" | "removeEventListener" | "close">;
type Dependencies = { socket(url: string): Socket; deadlineMs: number };
type Held = { binding: Readonly<PineLiveMarketStream>; context: Readonly<PineMarketHistoryAdmission["context"]>;
  first?: Readonly<PineLiveMarketEvent>; tail?: PineLiveMarketState; ready: Promise<void>; reject(error: Error): void;
  dispose(): void; metadata: string };
type Receipt = Readonly<{ ordinal: number; event: Readonly<PineLiveMarketEvent> }>;
const bytes = new TextEncoder();
const abortError = () => new DOMException("Requested live markets retired.", "AbortError");

/** Host-only native acquisition. It neither executes Pine nor fabricates history. */
export function createPineLiveMarketTransport(owner: { chartSymbol: string; epoch: number; owns(): boolean; signal?: AbortSignal; sourceTimeframe?: string },
  overrides: Partial<Dependencies> = {}) {
  const chartSymbol = pineMarketSymbol(owner.chartSymbol), epoch = owner.epoch, owns = owner.owns;
  const sourceTimeframe = owner.sourceTimeframe === undefined ? undefined : canonicalPineTimeframe(owner.sourceTimeframe);
  validatePineLiveMarketStreams([{ symbol: chartSymbol, timeframe: "1", epoch }]);
  if (sourceTimeframe) validatePineLiveMarketStreams([{ symbol: chartSymbol, timeframe: sourceTimeframe, epoch }]);
  const deps: Dependencies = { socket: url => { const socket = new WebSocket(url); trackDiagnosticWebSocket(socket, url); return socket; },
    deadlineMs: 10_000, ...overrides };
  const controller = new AbortController(), streams = new Map<string, Held>(), signals = new Map<AbortSignal, () => void>();
  const listeners = new Set<() => void>();
  let stopped: Error | undefined, ordinal = 0, journal: Receipt[] = [], journalBytes = 0;
  let rejectFailure: (error: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  void failure.catch(() => {});
  const stop = (error: Error) => {
    if (stopped) return;
    stopped = error;
    controller.abort();
    for (const held of streams.values()) { held.reject(error); held.dispose(); }
    for (const [signal, listener] of signals) signal.removeEventListener("abort", listener);
    signals.clear(); streams.clear(); journal = []; journalBytes = 0; listeners.clear(); rejectFailure(error);
  };
  const cancel = () => stop(abortError());
  const assertActive = () => { if (stopped) throw stopped; if (owner.signal?.aborted || !owns()) { cancel(); throw stopped!; } };
  const watch = (signal: AbortSignal) => {
    if (signals.has(signal)) return;
    if (signal.aborted) { cancel(); return; }
    signals.set(signal, cancel); signal.addEventListener("abort", cancel, { once: true });
  };
  if (owner.signal) watch(owner.signal);
  const beforeHistory = async (admission: PineMarketHistoryAdmission) => {
    try {
      assertActive(); watch(admission.signal); assertActive();
      const { providerSymbol, context, plan } = admission;
      const canonical = binanceChartPlan(plan.chartTimeframe);
      if (!canonical || JSON.stringify(canonical) !== JSON.stringify(plan) || context.symbol !== `BINANCE:${providerSymbol}`
        || !/^[A-Z0-9]{2,40}$/.test(providerSymbol)) throw new PineProtocolError("INVALID_LIVE_MARKET", "Requested live markets need validated provider instruments and native intervals.");
      const nativeTimeframe = pineContextForChart(context.symbol, plan.sourceTimeframe).timeframe;
      if (context.symbol === chartSymbol && (sourceTimeframe === undefined || nativeTimeframe === sourceTimeframe)) return;
      const binding = Object.freeze(validatePineLiveMarketStreams([{ symbol: context.symbol,
        timeframe: nativeTimeframe, epoch }])[0]);
      const key = pineLiveMarketKey(binding), nativeContext = Object.freeze({ ...context, timeframe: binding.timeframe });
      const metadata = JSON.stringify(nativeContext), existing = streams.get(key);
      if (existing) {
        if (existing.metadata !== metadata) throw new PineProtocolError("INVALID_LIVE_MARKET", "Requested live instrument details conflict.");
        await existing.ready; assertActive(); return;
      }
      if (streams.size >= 64) throw new PineProtocolError("REQUEST_LIMIT", "This indicator requested too many live markets.");
      let resolve: () => void = () => {}, reject: (error: Error) => void = () => {};
      const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      void ready.catch(() => {});
      let socket: Socket | undefined, timer: ReturnType<typeof setTimeout> | undefined, opened = false;
      const held: Held = { binding, context: nativeContext, ready, reject, metadata,
        dispose: () => {
          clearTimeout(timer);
          if (!socket) return;
          socket.removeEventListener("open", open); socket.removeEventListener("message", message);
          socket.removeEventListener("close", close); socket.removeEventListener("error", close);
          socket.close();
        } };
      const open = () => { try { assertActive(); opened = true; } catch (error) { stop(error as Error); } };
      const close = () => stop(new PineProtocolError("UNAVAILABLE_DATA", "A requested market disconnected. Reapply the indicator to reconnect."));
      const message = (incoming: Event) => {
        try {
          assertActive();
          const data: unknown = (incoming as MessageEvent).data;
          if (!opened || typeof data !== "string" || data.length > 16_384 || bytes.encode(data).byteLength > 16_384) throw new PineProtocolError("INVALID_LIVE_MARKET", "The requested market returned an invalid live update.");
          const parsed = binanceChartEvent(JSON.parse(data), providerSymbol, plan.interval);
          const previous = held.tail;
          const event = validatePineLiveMarketEvents([{ ...binding, sequence: (previous?.sequence ?? 0) + 1, ...parsed }])[0];
          const prior = previous?.event;
          if (prior && prior.eventTime === event.eventTime && prior.closeTime === event.closeTime && prior.confirmed === event.confirmed
            && ["time", "open", "high", "low", "close", "volume"].every(field => prior.bar[field as keyof typeof prior.bar] === event.bar[field as keyof typeof event.bar])) return;
          const seed: PineLiveMarketState = previous ?? Object.freeze({ ...binding, context: nativeContext, requestedTimeframes: Object.freeze([]),
            bars: Object.freeze([]), asOf: event.bar.time, sequence: 0, revision: 0, confirmed: true, event: null });
          const next = advancePineLiveMarkets([seed], [event], {})[0];
          const frozen = next.event!;
          const size = bytes.encode(JSON.stringify(frozen)).byteLength;
          if (journal.length >= PINE_LIVE_MARKET_BATCH_LIMIT || journal.filter(item => pineLiveMarketKey(item.event) === key).length >= 32
            || journalBytes + size > 1_000_000) throw new PineProtocolError("LIVE_QUEUE_LIMIT", "Requested live updates exceeded the loading buffer. Reapply the indicator.");
          // Only the actual tail is needed to validate the next transport event.
          held.tail = Object.freeze({ ...next, bars: Object.freeze([next.bars.at(-1)!]) });
          journal.push(Object.freeze({ ordinal: ++ordinal, event: frozen })); journalBytes += size;
          if (!held.first) { held.first = frozen; clearTimeout(timer); resolve(); }
          for (const listener of listeners) listener();
        } catch (error) { stop(error instanceof Error ? error : new Error("Requested live market failed.")); }
      };
      streams.set(key, held);
      timer = setTimeout(() => stop(new PineProtocolError("TIMEOUT", "A requested live market took too long to respond. Reapply the indicator.")), deps.deadlineMs);
      socket = deps.socket(`wss://data-stream.binance.vision/ws/${providerSymbol.toLowerCase()}@kline_${plan.interval}`);
      // A factory may synchronously revoke ownership; close its late result too.
      if (stopped) { socket.close(); throw stopped; }
      const listen = (type: string, listener: (event: Event) => void) => {
        socket!.addEventListener(type, listener);
        try { assertActive(); } catch (error) { held.dispose(); throw error; }
      };
      listen("open", open); listen("message", message);
      listen("close", close); listen("error", close);
      assertActive(); await ready; assertActive();
    } catch (error) { stop(error instanceof Error ? error : new Error("Requested live market failed.")); throw stopped!; }
  };
  return { beforeHistory, cancel, assertActive, signal: controller.signal, failure,
    streams: () => { assertActive(); return [...streams.values()].map(held => Object.freeze({ binding: held.binding, context: held.context, first: held.first })); },
    drain: () => { assertActive(); const received = Object.freeze(journal); journal = []; journalBytes = 0; return received; },
    subscribe: (listener: () => void) => { assertActive(); listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** Pair the resolver and sockets so either failure aborts all owned HTTP and streams. */
export function createPineLiveMarketDataResolver(scope: PineMarketDataScope, epoch: number, overrides: {
  resolver?: Parameters<typeof createPineMarketDataResolver>[1]; transport?: Partial<Dependencies>;
} = {}) {
  const transport = createPineLiveMarketTransport({ chartSymbol: scope.chartSymbol, sourceTimeframe: scope.primaryTimeframe, epoch, owns: scope.owns, signal: scope.signal }, overrides.transport);
  try {
    const resolver = createPineMarketDataResolver({ ...scope, signal: transport.signal }, { ...overrides.resolver, beforeHistory: transport.beforeHistory });
    resolver.signal.addEventListener("abort", transport.cancel, { once: true });
    if (resolver.signal.aborted) transport.cancel();
    return { ...resolver, transport, cancel: () => { resolver.cancel(); transport.cancel(); } };
  } catch (error) { transport.cancel(); throw error; }
}
