import { useEffect, useRef, useState } from "react";
import type { JournalDailyNote } from "../../lib/journalApi";
import { dailyNoteScope, isJournalDate } from "../../lib/journalDailyNotes";
import { useJournalDraft } from "../../lib/journalDrafts";
import { useJournalMutationPending } from "../../lib/journalMutationState";

export function useDailyNoteDraft(date: string, accountId: number | null, note: JournalDailyNote | null, saveNote: (date: string, payload: { account_id?: number | null; body: string }) => Promise<JournalDailyNote>) {
  const scope = dailyNoteScope(date, accountId);
  const [draft, setDraft, clearDraft, dirty] = useJournalDraft(scope, { body: note?.body ?? "" });
  const pending = useJournalMutationPending(scope);
  const [result, setResult] = useState<{ scope: string; state: "idle" | "saving" | "saved" | "error" }>({ scope, state: "idle" });
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const state = pending ? "saving" : result.scope === scope && result.state !== "saving" ? result.state : "idle";
  const saving = pending;

  async function save() {
    if (saving || !dirty || !isJournalDate(date)) return;
    const submitted = { ...draft };
    setResult({ scope, state: "saving" });
    try {
      await saveNote(date, { account_id: accountId, body: submitted.body });
      clearDraft(["body"], submitted);
      if (mounted.current && currentScope.current === scope) setResult({ scope, state: "saved" });
    } catch {
      if (mounted.current && currentScope.current === scope) setResult({ scope, state: "error" });
    }
  }

  return { body: draft.body, setBody: (body: string) => { setDraft({ body }); setResult({ scope, state: "idle" }); }, dirty, saving, state, save };
}
