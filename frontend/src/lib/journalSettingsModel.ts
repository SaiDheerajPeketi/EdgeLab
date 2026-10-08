export type SettingsJournalDefaults = { default_broker: string; default_currency: string; default_entry_type: "MISSED" | "TAKEN"; require_account_for_taken_trades: boolean };
export const DEFAULT_JOURNAL_SETTINGS: SettingsJournalDefaults = { default_broker: "Manual", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: true };
export const RESET_JOURNAL_SETTINGS: SettingsJournalDefaults = { default_broker: "", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: false };
export const DEFAULT_NOTE_TEMPLATE = ["Setup", "- Context:", "- Trigger:", "", "Execution", "- Side: {side}", "- Quantity: {quantity}", "- Entry: {entry}", "- Exit: {exit}", "- Result: {pnl} ({r}R)", "", "Review", "- What worked:", "- What needs correction:", "- Next action:"].join("\n");
const fields = Object.keys(DEFAULT_JOURNAL_SETTINGS) as Array<keyof SettingsJournalDefaults>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function valid(field: keyof SettingsJournalDefaults, value: unknown) {
  if (field === "default_broker") return typeof value === "string" && value.length <= 80;
  if (field === "default_currency") return typeof value === "string" && /^[A-Za-z]{3}$/.test(value);
  if (field === "default_entry_type") return value === "TAKEN" || value === "MISSED";
  return typeof value === "boolean";
}
export function journalSettingsFrom(value: unknown): SettingsJournalDefaults {
  const candidate = record(value) && record(value.settings) ? value.settings : {};
  return {
    default_broker: typeof candidate.default_broker === "string" ? candidate.default_broker.trim() || "Manual" : "Manual",
    default_currency: typeof candidate.default_currency === "string" && /^[A-Za-z]{3}$/.test(candidate.default_currency) ? candidate.default_currency.toUpperCase() : "USD",
    default_entry_type: candidate.default_entry_type === "MISSED" ? "MISSED" : "TAKEN",
    require_account_for_taken_trades: typeof candidate.require_account_for_taken_trades === "boolean" ? candidate.require_account_for_taken_trades : true,
  };
}
function valueFor(item: unknown, key: string): unknown {
  if (!record(item) || item.namespace !== "edgelab" || item.key !== key || !Object.prototype.hasOwnProperty.call(item, "value")) throw new Error("The settings response could not be confirmed.");
  return item.value;
}
/** Validate before storage publication; unknown journal records and settings stay intact. */
export function confirmedJournalSettings(item: unknown, changes?: Partial<SettingsJournalDefaults>): SettingsJournalDefaults {
  const value = valueFor(item, "live-journal.v1");
  if (value != null && !record(value)) throw new Error("Journal settings need recovery.");
  const settings = record(value) ? value.settings : undefined;
  if (settings != null && !record(settings)) throw new Error("Journal settings need recovery.");
  if (record(settings) && fields.some(field => Object.prototype.hasOwnProperty.call(settings, field) && !valid(field, settings[field]))) throw new Error("Journal settings need recovery.");
  const normalized = journalSettingsFrom(value);
  if (changes) {
    const expected = journalSettingsFrom({ settings: changes });
    if (Object.keys(changes).some(field => !record(settings) || !Object.prototype.hasOwnProperty.call(settings, field) || normalized[field as keyof SettingsJournalDefaults] !== expected[field as keyof SettingsJournalDefaults])) throw new Error("The journal changes were not confirmed.");
  }
  return normalized;
}
export function confirmedNoteTemplate(item: unknown, submitted?: string): string {
  const value = valueFor(item, "notebook-template.v1");
  if (value == null && submitted === undefined) return DEFAULT_NOTE_TEMPLATE;
  if (typeof value !== "string" || !value.trim() || value.length > 200_000) throw new Error("The note template could not be confirmed.");
  if (submitted !== undefined && value !== submitted) throw new Error("The note template changes were not confirmed.");
  return value;
}
