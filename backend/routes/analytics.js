import {
  computeByDay,
  computeByHour,
  computeByStrategy,
  computeDrawdown,
  computeEquityCurve,
  computeMonthlyCalendar,
  computeRDistribution,
  computeStreaks,
  computeSummary,
} from "../utils/analytics.js";
import { asyncHandler } from "../utils/http.js";
import { createRouter } from "../utils/miniExpress.js";
import { getTradesForAnalytics } from "./trades.js";

const router = createRouter();

router.get(
  "/summary",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ summary: computeSummary(trades) });
  }),
);

router.get(
  "/equity-curve",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ equity_curve: computeEquityCurve(trades) });
  }),
);

router.get(
  "/drawdown",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ drawdown: computeDrawdown(trades).points });
  }),
);

router.get(
  "/by-hour",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ by_hour: computeByHour(trades) });
  }),
);

router.get(
  "/by-day",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ by_day: computeByDay(trades) });
  }),
);

router.get(
  "/by-strategy",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ by_strategy: computeByStrategy(trades) });
  }),
);

router.get(
  "/r-distribution",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ r_distribution: computeRDistribution(trades) });
  }),
);

router.get(
  "/monthly-calendar",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ monthly_calendar: computeMonthlyCalendar(trades) });
  }),
);

router.get(
  "/streaks",
  asyncHandler((req, res) => {
    const trades = getTradesForAnalytics(req.query);
    res.json({ streaks: computeStreaks(trades) });
  }),
);

export default router;
