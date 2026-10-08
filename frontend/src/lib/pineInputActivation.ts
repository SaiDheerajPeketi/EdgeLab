import type { PineInputDefinition, PineInputValue } from "./pineProtocol";

export type PineInputCondition =
  | { kind: "literal"; value: PineInputValue }
  | { kind: "input"; id: string }
  | { kind: "unary"; operator: "!" | "+" | "-"; argument: PineInputCondition }
  | { kind: "binary"; operator: string; left: PineInputCondition; right: PineInputCondition }
  | { kind: "conditional"; test: PineInputCondition; consequent: PineInputCondition; alternate: PineInputCondition };

const binaryOperators = ["&&", "||", "==", "!=", "<", "<=", ">", ">=", "+", "-", "*", "/", "%"];
/** Validate a small data-only expression; no eval, functions or property access. */
export function validatePineInputCondition(value: unknown): PineInputCondition {
  let nodes = 0;
  const visit = (item: unknown, depth: number): PineInputCondition => {
    if (++nodes > 64 || depth > 7 || !item || typeof item !== "object" || Array.isArray(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error("Invalid Pine input activation expression.");
    const raw = item as Record<string, unknown>;
    const keys: Record<string, string[]> = { literal: ["kind", "value"], input: ["kind", "id"], unary: ["kind", "operator", "argument"], binary: ["kind", "operator", "left", "right"], conditional: ["kind", "test", "consequent", "alternate"] };
    const kindDescriptor = Object.getOwnPropertyDescriptor(raw, "kind");
    const kind = kindDescriptor && "value" in kindDescriptor ? kindDescriptor.value : undefined;
    if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(keys, kind)) throw new Error("Invalid Pine input activation expression.");
    const allowed = keys[kind];
    if (Reflect.ownKeys(raw).length !== allowed.length || Reflect.ownKeys(raw).some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in Object.getOwnPropertyDescriptor(raw, key)!) || !Object.getOwnPropertyDescriptor(raw, key)!.enumerable)) throw new Error("Invalid Pine input activation fields.");
    if (kind === "literal") {
      if (!(typeof raw.value === "boolean" || (typeof raw.value === "number" && Number.isFinite(raw.value)) || (typeof raw.value === "string" && raw.value.length <= 4096))) throw new Error("Invalid Pine input activation value.");
      return { kind, value: raw.value as PineInputValue };
    }
    if (kind === "input") {
      if (typeof raw.id !== "string" || !/^in_\d+$/.test(raw.id) || raw.id.length > 96) throw new Error("Invalid Pine input activation reference.");
      return { kind, id: raw.id };
    }
    if (kind === "unary") {
      if (typeof raw.operator !== "string" || !["!", "+", "-"].includes(raw.operator)) throw new Error("Invalid Pine input activation operator.");
      return { kind, operator: raw.operator as "!" | "+" | "-", argument: visit(raw.argument, depth + 1) };
    }
    if (kind === "binary") {
      if (typeof raw.operator !== "string" || !binaryOperators.includes(raw.operator)) throw new Error("Invalid Pine input activation operator.");
      return { kind, operator: raw.operator, left: visit(raw.left, depth + 1), right: visit(raw.right, depth + 1) };
    }
    return { kind: "conditional", test: visit(raw.test, depth + 1), consequent: visit(raw.consequent, depth + 1), alternate: visit(raw.alternate, depth + 1) };
  };
  return visit(value, 0);
}

export function pineInputConditionReferences(condition: PineInputCondition): string[] {
  if (condition.kind === "input") return [condition.id];
  if (condition.kind === "literal") return [];
  if (condition.kind === "unary") return pineInputConditionReferences(condition.argument);
  if (condition.kind === "binary") return [...pineInputConditionReferences(condition.left), ...pineInputConditionReferences(condition.right)];
  return [...pineInputConditionReferences(condition.test), ...pineInputConditionReferences(condition.consequent), ...pineInputConditionReferences(condition.alternate)];
}

export function pineInputActive(definition: PineInputDefinition, definitions: PineInputDefinition[], inputs: Record<string, PineInputValue>): boolean {
  if (!definition.activeCondition) return definition.active !== false;
  const invalid = (): never => { throw new Error("Pine input activation must resolve to a boolean expression with compatible operands."); };
  const typeOf = (node: PineInputCondition): string => {
    if (node.kind === "literal") return typeof node.value;
    if (node.kind === "input") {
      const input = definitions.find((item) => item.id === node.id);
      if (!input) return invalid();
      return input.type === "bool" ? "boolean" : ["int", "float", "price", "time"].includes(input.type) ? "number" : "string";
    }
    if (node.kind === "conditional") {
      const consequent = typeOf(node.consequent), alternate = typeOf(node.alternate);
      if (typeOf(node.test) !== "boolean" || consequent !== alternate) return invalid();
      return consequent;
    }
    if (node.kind === "unary") {
      const expected = node.operator === "!" ? "boolean" : "number";
      return typeOf(node.argument) === expected ? expected : invalid();
    }
    const left = typeOf(node.left), right = typeOf(node.right);
    if (["&&", "||"].includes(node.operator)) return left === "boolean" && right === "boolean" ? "boolean" : invalid();
    if (["==", "!="].includes(node.operator)) return left === right ? "boolean" : invalid();
    if (node.operator === "+" && left === "string" && right === "string") return "string";
    if (left !== "number" || right !== "number") return invalid();
    return ["<", "<=", ">", ">="].includes(node.operator) ? "boolean" : "number";
  };
  if (typeOf(definition.activeCondition) !== "boolean") return invalid();
  const evaluate = (node: PineInputCondition): PineInputValue | null => {
    if (node.kind === "literal") return node.value;
    if (node.kind === "input") return inputs[node.id] ?? definitions.find((item) => item.id === node.id)?.defval ?? null;
    if (node.kind === "conditional") return evaluate(evaluate(node.test) === true ? node.consequent : node.alternate);
    if (node.kind === "unary") {
      const value = evaluate(node.argument);
      if (node.operator === "!") return value !== true;
      return typeof value === "number" ? (node.operator === "-" ? -value : value) : null;
    }
    const left = evaluate(node.left);
    if (node.operator === "&&") return left === true && evaluate(node.right) === true;
    if (node.operator === "||") return left === true || evaluate(node.right) === true;
    const right = evaluate(node.right);
    if (left === null || right === null || (typeof left === "number" && !Number.isFinite(left)) || (typeof right === "number" && !Number.isFinite(right))) return ["==", "!=", "<", "<=", ">", ">="].includes(node.operator) ? false : null;
    if (node.operator === "==") return left === right;
    if (node.operator === "!=") return left !== right;
    if (node.operator === "+" && typeof left === "string" && typeof right === "string") return left + right;
    if (typeof left !== "number" || typeof right !== "number") return null;
    switch (node.operator) {
      case "<": return left < right;
      case "<=": return left <= right;
      case ">": return left > right;
      case ">=": return left >= right;
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/": return right === 0 ? null : left / right;
      case "%": return right === 0 ? null : left % right;
      default: return null;
    }
  };
  const result = evaluate(definition.activeCondition);
  if (typeof result !== "boolean") throw new Error("Pine input activation must resolve to a boolean.");
  return result;
}
