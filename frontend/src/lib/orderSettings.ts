import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

export const ORDER_DEFAULT_QUANTITY_STORAGE_KEY = "order-default-quantity.v1";
export const ORDER_DEFAULT_RISK_PERCENT_STORAGE_KEY = "order-default-risk-percent.v1";
export const ORDER_COMMISSION_FIXED_STORAGE_KEY = "order-commission-fixed.v1";
export const ORDER_COMMISSION_MODE_STORAGE_KEY = "order-commission-mode.v1";
export const ORDER_COMMISSION_PERCENT_STORAGE_KEY = "order-commission-percent.v1";
export const ORDER_FEE_FIXED_STORAGE_KEY = "order-fee-fixed.v1";
export const ORDER_FEE_MODE_STORAGE_KEY = "order-fee-mode.v1";
export const ORDER_FEE_PERCENT_STORAGE_KEY = "order-fee-percent.v1";
export const ORDER_RISK_BASE_STORAGE_KEY = "order-risk-base.v1";
export const ORDER_SIZING_MODE_STORAGE_KEY = "order-sizing-mode.v1";

export type OrderCommissionMode = "NONE" | "FIXED" | "PERCENT";
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

export function loadOrderCommissionMode() {
  return sanitizeOrderCommissionMode(
    getCachedAppStorageItem<unknown>(ORDER_COMMISSION_MODE_STORAGE_KEY, null),
  );
}

export async function hydrateOrderCommissionMode() {
  return sanitizeOrderCommissionMode(
    await loadAppStorageItem<unknown>(ORDER_COMMISSION_MODE_STORAGE_KEY, null),
  );
}

export function saveOrderCommissionMode(value: OrderCommissionMode) {
  return saveAppStorageItem(
    ORDER_COMMISSION_MODE_STORAGE_KEY,
    sanitizeOrderCommissionMode(value),
  );
}

export function subscribeOrderCommissionMode(listener: (value: OrderCommissionMode) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_COMMISSION_MODE_STORAGE_KEY,
    (value) => listener(sanitizeOrderCommissionMode(value)),
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

export function loadOrderCommissionFixed() {
  return sanitizeNonNegativeNumberText(
    getCachedAppStorageItem<unknown>(ORDER_COMMISSION_FIXED_STORAGE_KEY, "0"),
    "0",
  );
}

export async function hydrateOrderCommissionFixed() {
  return sanitizeNonNegativeNumberText(
    await loadAppStorageItem<unknown>(ORDER_COMMISSION_FIXED_STORAGE_KEY, "0"),
    "0",
  );
}

export function saveOrderCommissionFixed(value: string) {
  return saveAppStorageItem(
    ORDER_COMMISSION_FIXED_STORAGE_KEY,
    sanitizeNonNegativeNumberText(value, "0"),
  );
}

export function subscribeOrderCommissionFixed(listener: (value: string) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_COMMISSION_FIXED_STORAGE_KEY,
    (value) => listener(sanitizeNonNegativeNumberText(value, "0")),
  );
}

export function loadOrderCommissionPercent() {
  return sanitizeNonNegativeNumberText(
    getCachedAppStorageItem<unknown>(ORDER_COMMISSION_PERCENT_STORAGE_KEY, "0"),
    "0",
  );
}

export async function hydrateOrderCommissionPercent() {
  return sanitizeNonNegativeNumberText(
    await loadAppStorageItem<unknown>(ORDER_COMMISSION_PERCENT_STORAGE_KEY, "0"),
    "0",
  );
}

export function saveOrderCommissionPercent(value: string) {
  return saveAppStorageItem(
    ORDER_COMMISSION_PERCENT_STORAGE_KEY,
    sanitizeNonNegativeNumberText(value, "0"),
  );
}

export function subscribeOrderCommissionPercent(listener: (value: string) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_COMMISSION_PERCENT_STORAGE_KEY,
    (value) => listener(sanitizeNonNegativeNumberText(value, "0")),
  );
}

export function loadOrderFeeMode() {
  return sanitizeOrderCommissionMode(
    getCachedAppStorageItem<unknown>(ORDER_FEE_MODE_STORAGE_KEY, null),
  );
}

export async function hydrateOrderFeeMode() {
  return sanitizeOrderCommissionMode(
    await loadAppStorageItem<unknown>(ORDER_FEE_MODE_STORAGE_KEY, null),
  );
}

export function saveOrderFeeMode(value: OrderCommissionMode) {
  return saveAppStorageItem(
    ORDER_FEE_MODE_STORAGE_KEY,
    sanitizeOrderCommissionMode(value),
  );
}

export function subscribeOrderFeeMode(listener: (value: OrderCommissionMode) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_FEE_MODE_STORAGE_KEY,
    (value) => listener(sanitizeOrderCommissionMode(value)),
  );
}

export function loadOrderFeeFixed() {
  return sanitizeNonNegativeNumberText(
    getCachedAppStorageItem<unknown>(ORDER_FEE_FIXED_STORAGE_KEY, "0"),
    "0",
  );
}

export async function hydrateOrderFeeFixed() {
  return sanitizeNonNegativeNumberText(
    await loadAppStorageItem<unknown>(ORDER_FEE_FIXED_STORAGE_KEY, "0"),
    "0",
  );
}

export function saveOrderFeeFixed(value: string) {
  return saveAppStorageItem(
    ORDER_FEE_FIXED_STORAGE_KEY,
    sanitizeNonNegativeNumberText(value, "0"),
  );
}

export function subscribeOrderFeeFixed(listener: (value: string) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_FEE_FIXED_STORAGE_KEY,
    (value) => listener(sanitizeNonNegativeNumberText(value, "0")),
  );
}

export function loadOrderFeePercent() {
  return sanitizeNonNegativeNumberText(
    getCachedAppStorageItem<unknown>(ORDER_FEE_PERCENT_STORAGE_KEY, "0"),
    "0",
  );
}

export async function hydrateOrderFeePercent() {
  return sanitizeNonNegativeNumberText(
    await loadAppStorageItem<unknown>(ORDER_FEE_PERCENT_STORAGE_KEY, "0"),
    "0",
  );
}

export function saveOrderFeePercent(value: string) {
  return saveAppStorageItem(
    ORDER_FEE_PERCENT_STORAGE_KEY,
    sanitizeNonNegativeNumberText(value, "0"),
  );
}

export function subscribeOrderFeePercent(listener: (value: string) => void) {
  return subscribeAppStorageItem<unknown>(
    ORDER_FEE_PERCENT_STORAGE_KEY,
    (value) => listener(sanitizeNonNegativeNumberText(value, "0")),
  );
}

export function sanitizeOrderSizingMode(value: unknown): OrderSizingMode {
  return value === "risk" ? "risk" : "quantity";
}

export function sanitizeOrderRiskBase(value: unknown): OrderRiskBase {
  return value === "INITIAL_BALANCE" ? "INITIAL_BALANCE" : "CURRENT_BALANCE";
}

export function sanitizeOrderCommissionMode(value: unknown): OrderCommissionMode {
  return value === "FIXED" || value === "PERCENT" ? value : "NONE";
}

function sanitizePositiveNumberText(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? text : fallback;
}

function sanitizeNonNegativeNumberText(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? text : fallback;
}
