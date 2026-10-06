import { useState } from "react";

/** Keep rendered rows bounded while metrics and filters use the complete collection. */
export function useJournalPages<T>(rows: T[], context: string) {
  const [state, setState] = useState({ context, page: 0 });
  if (state.context !== context) setState({ context, page: 0 });
  const pageCount = Math.max(1, Math.ceil(rows.length / 100));
  const page = Math.min(state.context === context ? state.page : 0, pageCount - 1);
  return { rows: rows.slice(page * 100, (page + 1) * 100), page, pageCount, total: rows.length,
    setPage: (next: number) => setState({ context, page: Math.max(0, Math.min(next, pageCount - 1)) }) };
}
