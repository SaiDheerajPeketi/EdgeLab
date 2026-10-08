import { useId } from "react";
import { NumericDraftInput } from "./NumericDraftInput";
import { pineInputActive } from "../lib/pineInputActivation";
import type { PineInputDefinition, PineInputValue } from "../lib/pineProtocol";

export function PineInputControl({ definition, definitions = [definition], inputs = {}, value, recoveryLabel, scopeKey, onChange }: {
  definition: PineInputDefinition; definitions?: PineInputDefinition[]; inputs?: Record<string, PineInputValue>;
  value?: PineInputValue; recoveryLabel?: string; scopeKey?: string;
  onChange: (value: PineInputValue) => void;
}) {
  const recoveryId = useId();
  const current = value ?? definition.defval;
  const numeric = ["int", "float", "price", "time"].includes(definition.type);
  const options = definition.options ?? (definition.type === "source"
    ? ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"] : undefined);
  const disabled = !pineInputActive(definition, definitions, inputs);
  const unknownOption = options && !options.some((option) => option === current);
  const showRecovery = unknownOption && typeof recoveryLabel === "string";
  return <label className="grid min-w-0 gap-1.5 text-xs text-slate-300" title={definition.tooltip}>
    <span>{definition.title || definition.name}{definition.group ? <span className="ml-2 text-slate-400">{definition.group}</span> : null}</span>
    {definition.type === "bool" ? <input checked={current === true} className="h-4 w-4 accent-cyan-300" disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      : options ? <select aria-label={definition.title || definition.name} aria-invalid={Boolean(unknownOption)} aria-describedby={showRecovery ? recoveryId : undefined} className="input-control h-9 min-w-0 text-xs" disabled={disabled} onChange={(event) => {
        const chosen = options.find((option) => String(option) === event.target.value);
        if (chosen !== undefined && chosen !== null) onChange(chosen);
      }} value={String(current ?? "")}>{unknownOption ? <option disabled value={String(current ?? "")}>Choose a valid option</option> : null}{options.map((option, index) => <option key={index} value={String(option)}>{definition.enumVersion === 1 ? definition.enumMembers?.find((member) => member.id === option)?.label ?? String(option) : String(option)}</option>)}</select>
      : numeric ? <NumericDraftInput label={definition.title || definition.name} disabled={disabled} value={current} onChange={onChange}
          integer={["int", "time"].includes(definition.type)} min={definition.minval} max={definition.maxval}
          step={definition.step ?? (["int", "time"].includes(definition.type) ? 1 : "any")} resetKey={JSON.stringify([scopeKey, definition])} />
      : <input className="input-control h-9 min-w-0 text-xs" disabled={disabled} onChange={(event) => onChange(event.target.value)} type="text" value={current === null ? "" : String(current)} />}

    {showRecovery ? <span id={recoveryId} role="alert" className="break-words text-[11px] leading-4 text-[var(--loss-text)]">Saved choice “{recoveryLabel}” needs reselection. Choose a valid option.</span> : null}
    {definition.tooltip ? <span className="text-[11px] leading-4 text-slate-400">{definition.tooltip}</span> : null}
  </label>;
}
