import { useMemo } from "react";
import { groupPineChartNotices, type PineChartNoticeStudy } from "../lib/pineChartNotices";

export function PineChartNotices({ studies, include = "all" }: {
  studies: readonly PineChartNoticeStudy[];
  include?: "all" | "warnings" | "assumptions";
}) {
  const { assumptions, warnings } = useMemo(() => groupPineChartNotices(studies), [studies]);
  const sourceCount = new Set(assumptions.flatMap((group) => group.sources.map((source) => source.id))).size;
  const live = assumptions.some(group => group.diagnostic.code === "REALTIME_CONTEXT");
  const snapshot = assumptions.some(group => ["CLOSED_BAR_SNAPSHOT", "SNAPSHOT_CONTEXT"].includes(group.diagnostic.code));
  const executionLabel = live && !snapshot ? "Live chart updates" : snapshot && !live ? "Closed historical snapshot" : "Pine execution details";
  return <>
    {include !== "assumptions" && warnings.map(({ id, name, messages }) => <div className="border-t border-amber-300/15 bg-amber-300/5 px-4 py-2 text-xs leading-5 text-amber-100" key={id} role="status">
      <strong>{name}:</strong>{" "}{messages.join(" · ")}
    </div>)}
    {include !== "warnings" && assumptions.length > 0 && <div className="border-t border-amber-300/15 bg-amber-300/5 px-4 text-xs leading-5 text-amber-100" role="status">
      <details aria-label="Pine execution assumptions">
        <summary className="min-h-11 cursor-pointer rounded py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200">{executionLabel} · {assumptions.length} assumptions · {sourceCount} {sourceCount === 1 ? "script" : "scripts"}</summary>
        <p role="region" aria-label="Assumption details and affected scripts" className="grid max-h-56 gap-3 overflow-y-auto break-words rounded pb-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200" tabIndex={0}>
          {assumptions.map(({ diagnostic, sources }, index) => <span className="block" key={index}>
            <span className="block">{diagnostic.code}: {diagnostic.message}</span>
            <span className="mt-1 block">Applies to: {sources.map((source) => source.name).join(" · ")}</span>
          </span>)}
        </p>
      </details>
    </div>}
  </>;
}
