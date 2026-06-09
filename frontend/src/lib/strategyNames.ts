import { useEffect, useState } from "react";

import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

const BACKTEST_STRATEGIES_STORAGE_KEY = "backtest-strategies.v1";

export function useBacktestStrategyNames() {
  const [names, setNames] = useState<string[]>(() =>
    normalizeBacktestStrategyNames(
      getCachedAppStorageItem<unknown>(BACKTEST_STRATEGIES_STORAGE_KEY, []),
    ),
  );

  useEffect(() => {
    let active = true;
    void loadAppStorageItem<unknown>(BACKTEST_STRATEGIES_STORAGE_KEY, []).then((value) => {
      if (active) {
        setNames(normalizeBacktestStrategyNames(value));
      }
    });
    const unsubscribe = subscribeAppStorageItem<unknown>(
      BACKTEST_STRATEGIES_STORAGE_KEY,
      (value) => setNames(normalizeBacktestStrategyNames(value)),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return names;
}

export async function persistBacktestStrategyNames(names: string[]) {
  const nextNames = normalizeBacktestStrategyNames(names);
  await saveAppStorageItem(BACKTEST_STRATEGIES_STORAGE_KEY, nextNames);
  return nextNames;
}

export function normalizeBacktestStrategyNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const item of value) {
    const name = normalizeBacktestStrategyName(String(item ?? ""));
    if (!name || names.some((current) => sameStrategyName(current, name))) {
      continue;
    }
    names.push(name);
  }
  return names.sort((left, right) => left.localeCompare(right));
}

export function normalizeBacktestStrategyName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

export function renameSavedStrategyName(names: string[], currentName: string, nextName: string) {
  const nextNames = names
    .filter((name) => !sameStrategyName(name, currentName) && !sameStrategyName(name, nextName));
  nextNames.push(nextName);
  return nextNames;
}

export function removeSavedStrategyName(names: string[], currentName: string) {
  return names.filter((name) => !sameStrategyName(name, currentName));
}

export function sameStrategyName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
