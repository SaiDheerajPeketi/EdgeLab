import { pineInputActive } from "../lib/pineInputActivation";
import type { PineInputDefinition, PineInputValue } from "../lib/pineProtocol";

export function PineInputControl({ definition, definitions = [definition], inputs = {}, value, onChange }: {
  definition: PineInputDefinition; definitions?: PineInputDefinition[]; inputs?: Record<string, PineInputValue>;
  value?: PineInputValue;
  onChange: (value: PineInputValue) => void;
}) {
  const current = value ?? definition.defval;
  const numeric = ["int", "float", "price", "time"].includes(definition.type);
  const options = definition.options ?? (definition.type === "source"
    ? ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"] : undefined);
  const disabled = !pineInputActive(definition, definitions, inputs);
  const unknownOption = options && !options.some((option) => option === current);
  return <label className="grid min-w-0 gap-1.5 text-xs text-slate-300" title={definition.tooltip}>
    <span>{definition.title || definition.name}{definition.group ? <span className="ml-2 text-slate-400">{definition.group}</span> : null}</span>
    {definition.type === "bool" ? <input checked={current === true} className="h-4 w-4 accent-cyan-300" disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      : options ? <select className="input-control h-9 min-w-0 text-xs" disabled={disabled} onChange={(event) => {
        const chosen = options.find((option) => String(option) === event.target.value);
        if (chosen !== undefined && chosen !== null) onChange(chosen);
      }} value={String(current ?? "")}>{unknownOption ? <option disabled value={String(current ?? "")}>Choose a valid option</option> : null}{options.map((option, index) => <option key={index} value={String(option)}>{String(option)}</option>)}</select>
      : <input className="input-control h-9 min-w-0 text-xs" disabled={disabled} max={definition.maxval} min={definition.minval} onChange={(event) => {
        if (!numeric) { onChange(event.target.value); return; }
        const number = event.target.valueAsNumber;
        if (Number.isFinite(number)) onChange(number);
      }} step={definition.step ?? (["int", "time"].includes(definition.type) ? 1 : "any")} type={numeric ? "number" : "text"} value={current === null ? "" : String(current)} />}
    {definition.tooltip ? <span className="text-[11px] leading-4 text-slate-400">{definition.tooltip}</span> : null}
  </label>;
}
