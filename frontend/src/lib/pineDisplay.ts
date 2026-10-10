export const PINE_DISPLAY_DESTINATIONS = ["pane", "data_window", "status_line", "price_scale"] as const;
export type PineDisplayDestination = typeof PINE_DISPLAY_DESTINATIONS[number];
export type PineValueFormat = "inherit" | "price" | "percent" | "volume";

/** Native display arithmetic concatenates enum members. Every character must
 * belong to a known member; malformed suffixes never gain display authority. */
export function parsePineDisplay(value: unknown = undefined): readonly PineDisplayDestination[] | undefined {
  if (value === undefined) return PINE_DISPLAY_DESTINATIONS;
  if (typeof value !== "string" || !value.length || value.length > 256) return undefined;
  const selected = new Set<PineDisplayDestination>();
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("display.", index) || value.startsWith("display_", index)) index += 8;
    const token = [...PINE_DISPLAY_DESTINATIONS, "all", "none"].find(token => value.startsWith(token, index));
    if (!token) return undefined;
    index += token.length;
    if (token === "all") PINE_DISPLAY_DESTINATIONS.forEach(destination => selected.add(destination));
    else if (token !== "none") selected.add(token as PineDisplayDestination);
  }
  return Object.freeze(PINE_DISPLAY_DESTINATIONS.filter(destination => selected.has(destination)));
}
export function canonicalPineDisplay(value: unknown = undefined): string | undefined {
  const destinations = parsePineDisplay(value);
  return destinations === undefined ? undefined : destinations.length === 4 ? "all" : destinations.length ? destinations.join("") : "none";
}
export function parsePineFormat(value: unknown): PineValueFormat | undefined {
  if (typeof value !== "string") return undefined;
  const canonical = value.replace(/^format[._]/, "");
  return ["inherit", "price", "percent", "volume"].includes(canonical) ? canonical as PineValueFormat : undefined;
}
