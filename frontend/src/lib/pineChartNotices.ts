import type { PineDiagnostic } from "./pineProtocol";

export type PineChartNoticeStudy = {
  id: string;
  name: string;
  diagnostics: readonly PineDiagnostic[];
  adapterWarnings: readonly string[];
};
type Source = Pick<PineChartNoticeStudy, "id" | "name">;
const ASSUMPTIONS = new Set(["CLOSED_BAR_SNAPSHOT", "SNAPSHOT_CONTEXT", "DEFAULT_SYMBOL_METADATA"]);

/** Only actual diagnostic objects can enter the shared assumption disclosure. */
export function groupPineChartNotices(studies: readonly PineChartNoticeStudy[]) {
  const assumptions = new Map<string, { diagnostic: PineDiagnostic; sources: Source[] }>();
  const warnings: { id: string; name: string; messages: string[] }[] = [];
  for (const study of studies) {
    const messages: string[] = [];
    for (const diagnostic of study.diagnostics) {
      if (diagnostic.severity !== "warning" || !ASSUMPTIONS.has(diagnostic.code)) {
        messages.push(`${diagnostic.code}: ${diagnostic.message}`);
        continue;
      }
      const key = JSON.stringify([diagnostic.code, diagnostic.message, diagnostic.severity, diagnostic.line, diagnostic.column]);
      let group = assumptions.get(key);
      if (!group) { group = { diagnostic, sources: [] }; assumptions.set(key, group); }
      if (!group.sources.some((source) => source.id === study.id)) group.sources.push({ id: study.id, name: study.name });
    }
    messages.push(...study.adapterWarnings);
    if (messages.length) warnings.push({ id: study.id, name: study.name, messages: [...new Set(messages)] });
  }
  return { assumptions: [...assumptions.values()], warnings };
}
