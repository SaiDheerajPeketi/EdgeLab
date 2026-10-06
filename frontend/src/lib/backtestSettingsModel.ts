import type { OrderCommissionMode, OrderRiskBase, OrderSizingMode } from "./orderSettings";

export type BacktestDefaults = {
  sizingMode: OrderSizingMode; quantity: string; riskPercent: string; riskBase: OrderRiskBase;
  commissionMode: OrderCommissionMode; commissionFixed: string; commissionPercent: string;
  feeMode: OrderCommissionMode; feeFixed: string; feePercent: string; lineConfirmation: boolean;
};
export type BacktestField = keyof BacktestDefaults;
export const BACKTEST_DEFAULTS: BacktestDefaults = {
  sizingMode: "quantity", quantity: "100000", riskPercent: "1", riskBase: "CURRENT_BALANCE",
  commissionMode: "NONE", commissionFixed: "0", commissionPercent: "0",
  feeMode: "NONE", feeFixed: "0", feePercent: "0", lineConfirmation: true,
};
export const BACKTEST_KEYS: Record<BacktestField, string> = {
  sizingMode: "order-sizing-mode.v1", quantity: "order-default-quantity.v1", riskPercent: "order-default-risk-percent.v1", riskBase: "order-risk-base.v1",
  commissionMode: "order-commission-mode.v1", commissionFixed: "order-commission-fixed.v1", commissionPercent: "order-commission-percent.v1",
  feeMode: "order-fee-mode.v1", feeFixed: "order-fee-fixed.v1", feePercent: "order-fee-percent.v1", lineConfirmation: "order-line-modification-confirmation.v1",
};
export const BACKTEST_FIELDS = Object.keys(BACKTEST_KEYS) as BacktestField[];
export const BACKTEST_COST_FIELDS: BacktestField[] = ["commissionMode", "commissionFixed", "commissionPercent", "feeMode", "feeFixed", "feePercent"];
export function backtestValidation(field: BacktestField, value: unknown): string | null {
  if (field === "lineConfirmation") return typeof value === "boolean" ? null : "Choose whether confirmation is required.";
  if (field === "sizingMode") return value === "quantity" || value === "risk" ? null : "Choose fixed quantity or percent risk.";
  if (field === "riskBase") return value === "CURRENT_BALANCE" || value === "INITIAL_BALANCE" ? null : "Choose a balance basis.";
  if (field === "commissionMode" || field === "feeMode") return ["NONE", "FIXED", "PERCENT"].includes(String(value)) ? null : "Choose a cost mode.";
  const numeric = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0 || ((field === "quantity" || field === "riskPercent") && numeric === 0)) return field === "quantity" ? "Enter a number greater than zero." : field === "riskPercent" ? "Enter a percentage greater than 0 and no more than 100." : "Cost values must be zero or greater.";
  if ((field === "riskPercent" || field.endsWith("Percent")) && numeric > 100) return field === "riskPercent" ? "Enter a percentage greater than 0 and no more than 100." : "Percentage costs cannot exceed 100%.";
  return null;
}
export function backtestValue(field: BacktestField, value: unknown) {
  return backtestValidation(field, value) ? BACKTEST_DEFAULTS[field] : value as BacktestDefaults[BacktestField];
}
export function backtestSaveDelay(field: BacktestField) {
  return ["quantity", "riskPercent", "commissionFixed", "commissionPercent", "feeFixed", "feePercent"].includes(field) ? 600 : 0;
}
