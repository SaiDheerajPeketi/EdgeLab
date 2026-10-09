import { useId } from "react";
import { NumericDraftInput } from "./NumericDraftInput";
import { ThemedSelect } from "./ThemedSelect";
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
  const selectedIndex = options?.findIndex((option) => option !== null && option === current) ?? -1;
  const unknownOption = Boolean(options && selectedIndex < 0);
  const showRecovery = unknownOption && typeof recoveryLabel === "string";
  const label = definition.title || definition.name;
  return <div className="grid min-w-0 gap-1.5 text-xs text-[var(--text-secondary)]" title={definition.tooltip}>
    <span>{label}{definition.group ? <span className="ml-2 text-[var(--text-muted)]">{definition.group}</span> : null}</span>
    {definition.type === "bool" ? <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-[var(--ui-border-subtle)] bg-[var(--ui-inset)] px-3 ${disabled ? "cursor-not-allowed opacity-50" : "hover:bg-[var(--ui-hover)]"}`}>
        <input aria-label={label} checked={current === true} className="h-5 w-5 shrink-0 accent-[var(--ui-focus)]" disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
        <span aria-hidden="true" className="text-[var(--text-primary)]">{current === true ? "On" : "Off"}</span>
      </label>
      : options ? <ThemedSelect ariaLabel={label} ariaInvalid={unknownOption} ariaDescribedBy={showRecovery ? recoveryId : undefined}
          className="min-h-11 w-full min-w-0" disabled={disabled} portal placeholder="Choose a valid option"
          options={options.map((option, index) => ({ value: String(index), disabled: option === null,
            label: definition.enumVersion === 1 ? definition.enumMembers?.find((member) => member.id === option)?.label ?? String(option) : String(option) }))}
          onChange={(index) => { const chosen = options[Number(index)]; if (chosen !== undefined && chosen !== null) onChange(chosen); }}
          value={selectedIndex < 0 ? "" : String(selectedIndex)} />
      : numeric ? <NumericDraftInput label={label} disabled={disabled} value={current} onChange={onChange}
          integer={["int", "time"].includes(definition.type)} min={definition.minval} max={definition.maxval}
          className="input-control min-h-11 w-full min-w-0 text-xs" step={definition.step ?? (["int", "time"].includes(definition.type) ? 1 : "any")} resetKey={JSON.stringify([scopeKey, definition])} />
      : <input aria-label={label} className="input-control min-h-11 w-full min-w-0 text-xs" disabled={disabled} onChange={(event) => onChange(event.target.value)} type="text" value={current === null ? "" : String(current)} />}

    {showRecovery ? <span id={recoveryId} role="alert" className="break-words text-[11px] leading-4 text-[var(--loss-text)]">Saved choice “{recoveryLabel}” needs reselection. Choose a valid option.</span> : null}
    {definition.tooltip ? <span className="text-[11px] leading-4 text-[var(--text-muted)]">{definition.tooltip}</span> : null}
  </div>;
}
