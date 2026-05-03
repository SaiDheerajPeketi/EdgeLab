import { useEffect, useMemo, useRef, useState } from "react";
import {
  CrosshairMode,
  createChart,
} from "lightweight-charts";
import type {
  CandlestickData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Execution, Order, Position } from "../lib/api";
import { formatPrice } from "../lib/format";

type Props = {
  bars: Candle[];
  executions: Execution[];
  orders: Order[];
  position: Position | null;
};

type TooltipData = {
  x: number;
  y: number;
  candle: Candle;
};

export function TradingChart({ bars, executions, orders, position }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<Candle[]>([]);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const tooltipStyle = tooltip
    ? getTooltipStyle(tooltip, containerRef.current)
    : undefined;

  const candleData = useMemo<CandlestickData[]>(
    () =>
      bars.map((bar) => ({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    [bars],
  );

  const ema20 = useMemo<LineData[]>(
    () =>
      bars
        .filter((bar) => bar.ema_20 != null)
        .map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.ema_20 as number,
        })),
    [bars],
  );

  const ema50 = useMemo<LineData[]>(
    () =>
      bars
        .filter((bar) => bar.ema_50 != null)
        .map((bar) => ({
          time: bar.time as UTCTimestamp,
          value: bar.ema_50 as number,
        })),
    [bars],
  );

  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#0d1117" },
        textColor: "#a8b3c7",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: true,
    });

    const candles = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#fb7185",
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });
    const ema20Series = chart.addLineSeries({
      color: "#32d3ee",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });
    const ema50Series = chart.addLineSeries({
      color: "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: "price",
        precision: 5,
        minMove: 0.00001,
      },
    });

    chartRef.current = chart;
    candlesRef.current = candles;
    ema20Ref.current = ema20Series;
    ema50Ref.current = ema50Series;

    chart.subscribeCrosshairMove((param) => {
      setTooltip(resolveTooltip(param, barsRef.current));
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
    };
  }, []);

  useEffect(() => {
    candlesRef.current?.setData(candleData);
    ema20Ref.current?.setData(ema20);
    ema50Ref.current?.setData(ema50);
    if (bars.length > 0) {
      chartRef.current?.timeScale().scrollToRealTime();
    }
  }, [bars.length, candleData, ema20, ema50]);

  useEffect(() => {
    candlesRef.current?.setMarkers(
      executions.map((execution) => ({
        time: toChartTime(execution.timestamp),
        position: execution.side === "BUY" ? "belowBar" : "aboveBar",
        color: execution.side === "BUY" ? "#22c55e" : "#fb7185",
        shape: execution.side === "BUY" ? "arrowUp" : "arrowDown",
        text: `${execution.side} ${formatPrice(execution.price)}`,
      })),
    );
  }, [executions]);

  useEffect(() => {
    const series = candlesRef.current;
    if (!series) {
      return;
    }
    priceLinesRef.current.forEach((line) => series.removePriceLine(line));
    priceLinesRef.current = [];

    const addLine = (price: number | null | undefined, color: string, title: string) => {
      if (price == null) {
        return;
      }
      priceLinesRef.current.push(
        series.createPriceLine({
          price,
          color,
          title,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
        }),
      );
    };

    if (position && position.side !== "FLAT") {
      addLine(position.avg_price, "#a8b3c7", `${position.side} avg`);
      addLine(position.stop_loss, "#fb7185", "SL");
      addLine(position.take_profit, "#22c55e", "TP");
    }

    orders
      .filter((order) => order.status === "PENDING")
      .forEach((order) => {
        addLine(
          order.limit_price ?? order.stop_price,
          order.side === "BUY" ? "#32d3ee" : "#f59e0b",
          `${order.side} ${order.order_type}`,
        );
      });
  }, [orders, position]);

  return (
    <section className="relative min-h-[560px] min-w-0 overflow-hidden rounded-md border border-white/10 bg-ink-900 shadow-panel">
      <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
        <div>
          <div className="text-sm font-semibold text-white">EURUSD M1</div>
          <div className="text-xs text-slate-400">EMA 20 / EMA 50 / Replay levels</div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm bg-cyan-300" />
            EMA 20
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm bg-amber-400" />
            EMA 50
          </span>
        </div>
      </div>
      <div ref={containerRef} className="h-[calc(100%-3rem)] min-h-[508px]" />

      {tooltip && (
        <div
          className="pointer-events-none absolute max-w-[240px] rounded-md border border-white/10 bg-ink-950/95 px-3 py-2 text-xs text-slate-200 shadow-panel"
          style={tooltipStyle}
        >
          <div className="mb-1 font-semibold text-white">
            {new Date(tooltip.candle.timestamp).toLocaleString()}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span>O {formatPrice(tooltip.candle.open)}</span>
            <span>H {formatPrice(tooltip.candle.high)}</span>
            <span>L {formatPrice(tooltip.candle.low)}</span>
            <span>C {formatPrice(tooltip.candle.close)}</span>
            <span>Vol {tooltip.candle.volume}</span>
            <span>RSI {tooltip.candle.rsi_14?.toFixed(1) ?? "—"}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function getTooltipStyle(tooltip: TooltipData, container: HTMLDivElement | null) {
  const width = container?.clientWidth ?? 320;
  const height = container?.clientHeight ?? 508;
  const left = Math.min(Math.max(12, tooltip.x + 12), Math.max(12, width - 252));
  const top = Math.min(Math.max(60, tooltip.y + 60), Math.max(60, height - 102));
  return { left, top };
}

function resolveTooltip(
  param: MouseEventParams<Time>,
  bars: Candle[],
): TooltipData | null {
  if (!param.point || param.time == null) {
    return null;
  }
  const time = Number(param.time);
  const candle = bars.find((bar) => bar.time === time);
  if (!candle) {
    return null;
  }
  return {
    x: param.point.x,
    y: param.point.y,
    candle,
  };
}

function toChartTime(timestamp: string) {
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp);
  const normalized = hasTimezone ? timestamp : `${timestamp}Z`;
  return Math.floor(new Date(normalized).getTime() / 1000) as UTCTimestamp;
}
