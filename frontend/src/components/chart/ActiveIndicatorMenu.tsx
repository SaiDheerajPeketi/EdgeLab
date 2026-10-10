import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Eye, EyeOff, Settings2, Trash2, X } from "lucide-react";
import { indicatorDisplayName, type ChartIndicatorInstance } from "../../lib/charting";
import { OverlaySurface } from "../overlays/OverlaySurface";

type Props = {
  indicators: readonly ChartIndicatorInstance[];
  onOpenSettings: (id: string, trigger: HTMLButtonElement) => void;
  onToggleVisibility: (id: string) => void;
  onRemove: (id: string) => void;
};

export function ActiveIndicatorMenu({ indicators, onOpenSettings, onToggleVisibility, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const focusFrame = useRef(0);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    focusFrame.current = requestAnimationFrame(() => surfaceRef.current?.querySelector<HTMLButtonElement>("[data-indicator-settings]")?.focus());
    return () => cancelAnimationFrame(focusFrame.current);
  }, [open]);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);

  function remove(indicatorId: string, index: number) {
    const chart = triggerRef.current?.closest<HTMLElement>(".chart-stage");
    onRemove(indicatorId);
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      const controls = surfaceRef.current?.querySelectorAll<HTMLButtonElement>("[data-indicator-settings]");
      const next = controls?.[Math.min(index, controls.length - 1)];
      (next ?? triggerRef.current ?? chart)?.focus({ preventScroll: true });
    });
  }

  if (!indicators.length) return null;
  return <>
    <button type="button" ref={triggerRef} aria-controls={id} aria-expanded={open} aria-haspopup="dialog"
      className="chart-active-indicator-trigger" onClick={() => setOpen(value => !value)}>
      Indicators ({indicators.length})<ChevronDown aria-hidden="true" size={14} />
    </button>
    <OverlaySurface anchorRef={triggerRef} triggerRef={triggerRef} surfaceRef={surfaceRef} open={open}
      onDismiss={() => setOpen(false)} preferredWidth={400} estimatedHeight={360} id={id}
      role="dialog" ariaLabel="Active indicators" className="chart-active-indicator-menu">
      <div className="chart-active-indicator-heading"><strong>Active indicators ({indicators.length})</strong>
        <button type="button" aria-label="Close active indicators" className="chart-active-indicator-action"
          onClick={() => setOpen(false)}><X aria-hidden="true" size={16} /></button>
      </div>
      <ul className="chart-active-indicator-list">
        {indicators.map((indicator, index) => {
          const label = indicatorDisplayName(indicator);
          const visible = indicator.visible !== false;
          return <li key={indicator.id} data-active-indicator-id={indicator.id}>
            <button type="button" data-indicator-settings={indicator.id} aria-label={`Settings for ${label}`}
              className="chart-active-indicator-settings" onClick={() => {
                setOpen(false);
                if (triggerRef.current) onOpenSettings(indicator.id, triggerRef.current);
              }}>
              <Settings2 aria-hidden="true" size={16} /><span>{label}{!visible && <small>Hidden</small>}</span>
            </button>
            <button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label}`} aria-pressed={visible}
              title={visible ? "Hide indicator" : "Show indicator"} className="chart-active-indicator-action"
              onClick={() => onToggleVisibility(indicator.id)}>
              {visible ? <Eye aria-hidden="true" size={16} /> : <EyeOff aria-hidden="true" size={16} />}
            </button>
            <button type="button" aria-label={`Remove ${label}`} title="Remove indicator"
              className="chart-active-indicator-action chart-active-indicator-remove"
              onClick={() => remove(indicator.id, index)}><Trash2 aria-hidden="true" size={16} /></button>
          </li>;
        })}
      </ul>
    </OverlaySurface>
  </>;
}
