import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

const SERVER_STORAGE_KEY = "strategy-mistake-tags.v1";

export const DEFAULT_MISTAKE_TAGS = [
  "FOMO",
  "Early Exit",
  "Late Entry",
  "Moved Stop",
  "Oversized",
];

export function strategyTagScope(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Unassigned";
}

export function loadStrategyMistakeTags(strategyName: string | null | undefined) {
  const library = readLibrary();
  return library[scopeKey(strategyName)] ?? [];
}

export async function hydrateStrategyMistakeTags(
  strategyName?: string | null,
): Promise<string[]> {
  const library = sanitizeLibrary(await loadAppStorageItem<unknown>(SERVER_STORAGE_KEY, {}));
  return library[scopeKey(strategyName)] ?? [];
}

export function persistStrategyMistakeTags(
  strategyName: string | null | undefined,
  tags: string[],
) {
  const customTags = tags.filter((tag) => !isDefaultMistakeTag(tag));
  if (customTags.length === 0) {
    return;
  }
  const library = readLibrary();
  const key = scopeKey(strategyName);
  library[key] = mergeTags(library[key] ?? [], customTags);
  writeLibrary(library);
}

export function removeStrategyMistakeTag(
  strategyName: string | null | undefined,
  tag: string,
) {
  if (isDefaultMistakeTag(tag)) {
    return;
  }
  const library = readLibrary();
  const key = scopeKey(strategyName);
  const nextTags = (library[key] ?? []).filter(
    (currentTag) => currentTag.toLowerCase() !== tag.toLowerCase(),
  );
  if (nextTags.length > 0) {
    library[key] = nextTags;
  } else {
    delete library[key];
  }
  writeLibrary(library);
}

export function subscribeStrategyMistakeTags(
  strategyName: string | null | undefined,
  listener: (tags: string[]) => void,
) {
  return subscribeAppStorageItem<unknown>(
    SERVER_STORAGE_KEY,
    (value) => listener(sanitizeLibrary(value)[scopeKey(strategyName)] ?? []),
  );
}

export function parseTagInput(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

export function mergeTags(current: string[], nextTags: string[]) {
  const seen = new Set(current.map((tag) => tag.toLowerCase()));
  const merged = [...current];
  nextTags.forEach((tag) => {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(tag);
    }
  });
  return merged;
}

export function isDefaultMistakeTag(value: string) {
  return DEFAULT_MISTAKE_TAGS.some(
    (tag) => tag.toLowerCase() === value.toLowerCase(),
  );
}

function scopeKey(strategyName: string | null | undefined) {
  return strategyTagScope(strategyName).toLowerCase();
}

function readLibrary(): Record<string, string[]> {
  try {
    return sanitizeLibrary(getCachedAppStorageItem<unknown>(SERVER_STORAGE_KEY, {}));
  } catch {
    return {};
  }
}

function writeLibrary(library: Record<string, string[]>) {
  void saveAppStorageItem(SERVER_STORAGE_KEY, library);
}

function sanitizeLibrary(value: unknown): Record<string, string[]> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .map(([key, values]) => [
        key,
        mergeTags(
          [],
          values.filter((item): item is string => typeof item === "string"),
        ),
      ]),
  );
}
