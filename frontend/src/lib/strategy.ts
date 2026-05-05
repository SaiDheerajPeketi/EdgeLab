export const DEFAULT_STRATEGY_NAME = "London Continuation";

export function normalizeStrategyName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Unassigned";
}

export function sessionStrategyName(session: {
  name?: string | null;
  strategy_name: string | null;
}) {
  const savedStrategy = normalizeStrategyName(session.strategy_name);
  const nameStrategy = strategyFromSessionName(session.name);
  if (
    nameStrategy &&
    (savedStrategy === "Unassigned" || savedStrategy === DEFAULT_STRATEGY_NAME)
  ) {
    return nameStrategy;
  }
  return savedStrategy;
}

export function tradeStrategyName(
  trade: { strategy_name: string | null },
  session?: { name?: string | null; strategy_name: string | null },
) {
  const sessionStrategy = session ? sessionStrategyName(session) : "Unassigned";
  const tradeStrategy = normalizeStrategyName(trade.strategy_name);
  if (
    sessionStrategy !== "Unassigned" &&
    sessionStrategy !== DEFAULT_STRATEGY_NAME &&
    (tradeStrategy === "Unassigned" || tradeStrategy === DEFAULT_STRATEGY_NAME)
  ) {
    return sessionStrategy;
  }
  return tradeStrategy !== "Unassigned" ? tradeStrategy : sessionStrategy;
}

function strategyFromSessionName(value: string | null | undefined) {
  const prefix = value?.split(" / ")[0]?.trim();
  if (!prefix || prefix.toLowerCase().endsWith("replay")) {
    return null;
  }
  return prefix;
}
