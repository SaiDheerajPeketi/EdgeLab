import type { JournalDailyNote } from "./journalApi";

export function isJournalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dailyNoteScope(date: string, accountId: number | null) {
  return `journal:daily-note:${date}:${accountId ?? "shared"}` as const;
}

export function exactDailyNote(notes: JournalDailyNote[], date: string, accountId: number | null) {
  return notes.find((note) => note.note_date === date && note.account_id === accountId) ?? null;
}

export function utcEntryDay(entryTime: string) {
  const parsed = new Date(entryTime);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

export function journalMonthDays(month: string) {
  const first = new Date(`${month}-01T00:00:00Z`);
  const start = first.getTime() - ((first.getUTCDay() + 6) % 7) * 86_400_000;
  return Array.from({ length: 42 }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

export function shiftJournalMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
