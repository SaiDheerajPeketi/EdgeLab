import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

const ORDER_LINE_CONFIRMATION_KEY = "order-line-modification-confirmation.v1";

export function loadOrderLineModificationConfirmation() {
  return sanitizeConfirmationValue(
    getCachedAppStorageItem<unknown>(ORDER_LINE_CONFIRMATION_KEY, true),
  );
}

export async function hydrateOrderLineModificationConfirmation() {
  const value = await loadAppStorageItem<unknown>(ORDER_LINE_CONFIRMATION_KEY, true);
  return sanitizeConfirmationValue(value);
}

export function saveOrderLineModificationConfirmation(enabled: boolean) {
  return saveAppStorageItem(ORDER_LINE_CONFIRMATION_KEY, Boolean(enabled));
}

export function subscribeOrderLineModificationConfirmation(
  listener: (enabled: boolean) => void,
) {
  return subscribeAppStorageItem<unknown>(
    ORDER_LINE_CONFIRMATION_KEY,
    (value) => listener(sanitizeConfirmationValue(value)),
  );
}

function sanitizeConfirmationValue(value: unknown) {
  return value !== false;
}
