import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getBinanceInstruments, type BinanceInstrument } from "../../lib/api";
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import { pineContextForChart } from "../../lib/customIndicators";
import { binanceChartSymbolMatches, pineContextWithBinanceInstrument } from "../../lib/pineInstrumentContext";
import type { PineLiveFeed } from "../../lib/pineLiveFeed";

type Loaded = { feed: PineLiveFeed; owner: string; instrument?: BinanceInstrument; error?: string };

/** Metadata belongs to this provider, feed generation and authenticated account. */
export function usePineInstrumentContext(symbol: string, timeframe: string, feed?: PineLiveFeed, enabled = true) {
  const auth = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, getStoredAuthSession);
  const epoch = useSyncExternalStore(
    useCallback(listener => feed ? feed.subscribe(() => listener()) : () => {}, [feed]),
    useCallback(() => feed?.getSnapshot().epoch ?? 0, [feed]),
    () => 0,
  );
  const snapshot = feed?.getSnapshot();
  const providerSymbol = snapshot?.symbol ?? "";
  const owner = JSON.stringify([auth?.user.id, auth?.token, providerSymbol, epoch]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!enabled || !feed || !binanceChartSymbolMatches(symbol, providerSymbol)) return;
    const abort = new AbortController();
    let active = true;
    void getBinanceInstruments(providerSymbol, 5000, abort.signal).then(response => {
      if (!active) return;
      const matches = response.instruments.filter(instrument => instrument.symbol === providerSymbol);
      if (matches.length !== 1) throw new Error("Instrument details are unavailable for this Binance chart. Reload the chart.");
      // Validate before retaining data; wrong/partial catalog rows never become defaults.
      pineContextWithBinanceInstrument(symbol, timeframe, providerSymbol, matches[0]);
      setLoaded({ feed, owner, instrument: matches[0] });
    }).catch(error => {
      if (active) setLoaded({ feed, owner, error: error instanceof Error ? error.message : "Instrument details are unavailable. Reload the chart." });
    });
    return () => { active = false; abort.abort(); };
  }, [enabled, feed, owner, symbol, providerSymbol]);
  return useMemo(() => {
    if (!enabled || !symbol.trim()) return { context: undefined, loading: false, error: null, key: "inactive" };
    try {
      if (!feed) return { context: pineContextForChart(symbol, timeframe), loading: false, error: null, key: "assumed" };
      if (!binanceChartSymbolMatches(symbol, providerSymbol)) throw new Error("Instrument details do not match this Binance chart. Reload the chart.");
      if (!loaded || loaded.feed !== feed || loaded.owner !== owner) return { context: undefined, loading: true, error: null, key: "loading" };
      if (loaded.error) throw new Error(loaded.error);
      const context = pineContextWithBinanceInstrument(symbol, timeframe, providerSymbol, loaded.instrument!);
      return { context, loading: false, error: null, key: JSON.stringify(context) };
    } catch (failure) {
      const error = failure instanceof Error ? failure.message : "Instrument details are unavailable. Reload the chart.";
      return { context: undefined, loading: false, error, key: `unavailable:${error}` };
    }
  }, [enabled, symbol, timeframe, feed, providerSymbol, loaded, owner]);
}
