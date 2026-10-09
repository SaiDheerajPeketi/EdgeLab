import { useMemo } from "react";
import { groupPineChartNotices, type PineChartNoticeStudy } from "../lib/pineChartNotices";

export function PineChartNotices({ studies, include = "all" }: {
  studies: readonly PineChartNoticeStudy[];
  include?: "all" | "warnings" | "assumptions";
}) {
  const { assumptions, warnings, failures } = useMemo(() => {
    const grouped = groupPineChartNotices(studies);
    const failures = studies.flatMap(study => {
      const messages = [...new Set(study.diagnostics.filter(diagnostic => diagnostic.severity === "error")
        .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`))];
      return messages.length ? [{ id: study.id, name: study.name, messages }] : [];
    });
    const failedMessages = new Map(failures.map(failure => [failure.id, new Set(failure.messages)]));
    const warnings = grouped.warnings.map(warning => ({ ...warning,
      messages: warning.messages.filter(message => !failedMessages.get(warning.id)?.has(message)),
    })).filter(warning => warning.messages.length);
    return { ...grouped, warnings, failures };
  }, [studies]);
  const sourceCount = new Set(assumptions.flatMap((group) => group.sources.map((source) => source.id))).size;
  const live = assumptions.some(group => group.diagnostic.code === "REALTIME_CONTEXT");
  const snapshot = assumptions.some(group => ["CLOSED_BAR_SNAPSHOT", "SNAPSHOT_CONTEXT"].includes(group.diagnostic.code));
  const executionLabel = live && !snapshot ? "Live chart updates" : snapshot && !live ? "Candle snapshot" : "Calculation details";
  const warningCount = warnings.reduce((total, warning) => total + warning.messages.length, 0);
  const summaryClass = "min-h-11 cursor-pointer rounded py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]";
  return <>
    {include !== "assumptions" && failures.map(({ id, name, messages }) => <div className="border-t border-[var(--ui-border-subtle)] bg-[var(--loss-soft)] px-4 py-2 text-xs leading-5 text-[var(--loss-text)] break-words" key={id} role="alert">
      <strong>{name}:</strong>{" "}{messages.join(" · ")}
    </div>)}
    {include !== "assumptions" && warnings.length > 0 && <div className="border-t border-[var(--ui-border-subtle)] bg-[var(--warning-soft)] px-4 text-xs leading-5 text-[var(--warning-text)]" role="status">
      <details aria-label="Indicator notices">
        <summary className={summaryClass}>Chart notices ({warningCount})</summary>
        <div role="region" aria-label="Indicator notice details" className="grid max-h-56 gap-3 overflow-y-auto overscroll-contain break-words pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]" tabIndex={0}>
          {warnings.map(({ id, name, messages }) => <div key={id}>
            <strong className="block">{name}</strong>
            <ul className="mt-1 list-disc space-y-2 pl-4">{messages.map(message => <li key={message}>{message}</li>)}</ul>
          </div>)}
        </div>
      </details>
    </div>}
    {include !== "warnings" && assumptions.length > 0 && <div className="border-t border-[var(--ui-border-subtle)] bg-[var(--ui-inset)] px-4 text-xs leading-5 text-[var(--text-secondary)]" role="status">
      <details aria-label="Pine execution assumptions">
        <summary className={summaryClass}>{executionLabel}</summary>
        <p role="region" aria-label="Assumption details and affected scripts" className="grid max-h-56 gap-3 overflow-y-auto overscroll-contain break-words rounded pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]" tabIndex={0}>
          <span>{assumptions.length} calculation {assumptions.length === 1 ? "note" : "notes"} for {sourceCount} {sourceCount === 1 ? "script" : "scripts"}.</span>
          {assumptions.map(({ diagnostic, sources }, index) => <span className="block" key={index}>
            <span className="block">{diagnostic.code}: {diagnostic.message}</span>
            <span className="mt-1 block">Applies to: {sources.map((source) => source.name).join(" · ")}</span>
          </span>)}
        </p>
      </details>
    </div>}
  </>;
}
