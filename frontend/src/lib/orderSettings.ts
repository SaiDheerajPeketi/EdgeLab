import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

export const ORDER_DEFAULT_QUANTITY_STORAGE_KEY = "order-default-quantity.v1";
export const ORDER_DEFAULT_RISK_PERCENT_STORAGE_KEY = "order-default-risk-percent.v1";
export const ORDER_RISK_BASE_STORAGE_KEY = "order-risk-base.v1";
export const ORDER_SIZING_MODE_STORAGE_KEY = "order-sizing-mode.v1";

export type OrderRiskBase = "CURRENT_BALANCE" | "INITIAL_BALANCE";
export type OrderSizingMode = "quantity" | "risk";

export function loadOrderSizingMode() {
  return sanitizeOrderSizingMode(
    getCachedAppStorageItem<unknown>(ORDER_SIZING_MODE_STORAGE_KEY, null),
  );
}

export async function hydrateOrderSizingMode() {
  return sanitizeOrderSizingMode(
    await loadAppStorageItem<unknown>(ORDER_SIZING_MODE_STORAGE_KEY, null),
  );
}

export function saveOrderSizingMode(value: OrderSizingMode) {
  return saveAppStorageItem(ORDER_SIZING_MODE_STORAGE_KEY, sanitizeOrderSizingMode(value));
}

export function subscribeOrderSizingMode(listener: (value: OrderSizingMode) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_SIZING_MODE_STORAGE_KEY,
    (value) => listener(sanitizeOrderSizingMode(value)),
  );
}

export function loadOrderRiskBase() {
  return sanitizeOrderRiskBase(
    getCachedAppStorageItem<unknown>(ORDER_RISK_BASE_STORAGE_KEY, null),
  );
}

export async function hydrateOrderRiskBase() {
  return sanitizeOrderRiskBase(
    await loadAppStorageItem<unknown>(ORDER_RISK_BASE_STORAGE_KEY, null),
  );
}

export function saveOrderRiskBase(value: OrderRiskBase) {
  return saveAppStorageItem(ORDER_RISK_BASE_STORAGE_KEY, sanitizeOrderRiskBase(value));
}

export function subscribeOrderRiskBase(listener: (value: OrderRiskBase) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_RISK_BASE_STORAGE_KEY,
    (value) => listener(sanitizeOrderRiskBase(value)),
  );
}

export function loadOrderDefaultQuantity() {
  return sanitizePositiveNumberText(
    getCachedAppStorageItem<unknown>(ORDER_DEFAULT_QUANTITY_STORAGE_KEY, "100000"),
    "100000",
  );
}

export async function hydrateOrderDefaultQuantity() {
  return sanitizePositiveNumberText(
    await loadAppStorageItem<unknown>(ORDER_DEFAULT_QUANTITY_STORAGE_KEY, "100000"),
    "100000",
  );
}

export function saveOrderDefaultQuantity(value: string) {
  return saveAppStorageItem(
    ORDER_DEFAULT_QUANTITY_STORAGE_KEY,
    sanitizePositiveNumberText(value, "100000"),
  );
}

export function subscribeOrderDefaultQuantity(listener: (value: string) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_DEFAULT_QUANTITY_STORAGE_KEY,
    (value) => listener(sanitizePositiveNumberText(value, "100000")),
  );
}

export function loadOrderDefaultRiskPercent() {
  return sanitizePositiveNumberText(
    getCachedAppStorageItem<unknown>(ORDER_DEFAULT_RISK_PERCENT_STORAGE_KEY, "1"),
    "1",
  );
}

export async function hydrateOrderDefaultRiskPercent() {
  return sanitizePositiveNumberText(
    await loadAppStorageItem<unknown>(ORDER_DEFAULT_RISK_PERCENT_STORAGE_KEY, "1"),
    "1",
  );
}

export function saveOrderDefaultRiskPercent(value: string) {
  return saveAppStorageItem(
    ORDER_DEFAULT_RISK_PERCENT_STORAGE_KEY,
    sanitizePositiveNumberText(value, "1"),
  );
}

export function subscribeOrderDefaultRiskPercent(listener: (value: string) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_DEFAULT_RISK_PERCENT_STORAGE_KEY,
    (value) => listener(sanitizePositiveNumberText(value, "1")),
  );
}

export function sanitizeOrderSizingMode(value: unknown): OrderSizingMode {
  return value === "risk" ? "risk" : "quantity";
}

export function sanitizeOrderRiskBase(value: unknown): OrderRiskBase {
  return value === "INITIAL_BALANCE" ? "INITIAL_BALANCE" : "CURRENT_BALANCE";
}

function sanitizePositiveNumberText(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? text : fallback;
}
