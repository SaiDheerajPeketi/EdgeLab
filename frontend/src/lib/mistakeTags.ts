const STORAGE_KEY = "edgelab.strategy-mistake-tags.v1";

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

function isDefaultMistakeTag(value: string) {
  return DEFAULT_MISTAKE_TAGS.some(
    (tag) => tag.toLowerCase() === value.toLowerCase(),
  );
}

function scopeKey(strategyName: string | null | undefined) {
  return strategyTagScope(strategyName).toLowerCase();
}

function readLibrary(): Record<string, string[]> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
        .map(([key, values]) => [
          key,
          mergeTags(
            [],
            values.filter((value): value is string => typeof value === "string"),
          ),
        ]),
    );
  } catch {
    return {};
  }
}

function writeLibrary(library: Record<string, string[]>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}
