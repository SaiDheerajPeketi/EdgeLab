import { PINE_LIMITS, type PineInputValue, type PinePrepareResult } from "./pineProtocol";

function safeRecovery(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value)).flatMap(([id, descriptor]) =>
    /^in_(0|[1-9]\d*)$/.test(id) && Number(id.slice(3)) < PINE_LIMITS.inputs &&
    "value" in descriptor && typeof descriptor.value === "string" && descriptor.value.length <= 4096
      ? [[id, descriptor.value]] : []));
}

/** Labels are legacy values only when the exact saved source proves that format. */
export function migratePineEnumInputs(
  saved: PinePrepareResult | undefined,
  current: PinePrepareResult,
  inputs: Record<string, PineInputValue> = {},
  recovery: Record<string, string> = {},
): { inputs: Record<string, PineInputValue>; recovery: Record<string, string> } {
  const nextRecovery = safeRecovery(recovery);
  if (!saved || saved.source !== current.source) return { inputs, recovery: nextRecovery };
  const nextInputs = { ...inputs };
  for (const previous of saved.inputDefinitions) {
    if (previous.type !== "enum" || previous.enumVersion === 1 || !Object.prototype.hasOwnProperty.call(inputs, previous.id)) continue;
    const definition = current.inputDefinitions.find((item) => item.id === previous.id && item.type === "enum" && item.enumVersion === 1);
    if (!definition) continue;
    const value = inputs[previous.id];
    if (typeof value !== "string") continue;
    const matches = definition.enumMembers?.filter((member) => member.label === value && definition.options?.includes(member.id)) ?? [];
    if (matches.length === 1) {
      nextInputs[previous.id] = matches[0].id;
      delete nextRecovery[previous.id];
    } else {
      // Empty strings cannot be qualified member IDs, even if the old label was.
      nextInputs[previous.id] = "";
      nextRecovery[previous.id] = nextRecovery[previous.id] ?? value.slice(0, 4096);
    }
  }
  return { inputs: nextInputs, recovery: nextRecovery };
}

export function hasLegacyPineEnums(prepared: PinePrepareResult | undefined): boolean {
  return Boolean(prepared?.inputDefinitions.some((item) => item.type === "enum" && item.enumVersion !== 1));
}
