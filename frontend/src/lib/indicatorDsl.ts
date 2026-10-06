import type { Candle } from "./api";
import { trueRangeValues as trueRanges, wilderAverage } from "./indicatorMath";

export const EDGE_INDICATOR_DSL_VERSION = "1.0";

export const EDGE_INDICATOR_LIMITS = {
  bars: 20_000,
  inputs: 24,
  operations: 1_000_000,
  plots: 8,
  sourceBytes: 20_000,
  syntaxNodes: 256,
} as const;

export const EDGE_INDICATOR_DSL_REFERENCE = `EdgeLab Indicator DSL 1.0

EdgeLab DSL is an original, deterministic study language. It is not Pine Script compatible.

indicator "Name" overlay|pane
input period: number = 20 min 1 max 500
input source: source = close
plot "Signal" = ema(source, period) color "#32d3ee"

Series: open, high, low, close, volume, hl2, hlc3, ohlc4.
Functions: sma, ema, wma, highest, lowest, change, roc, rsi, atr, stdev,
linreg, cci, adx, obv, mfi, cmf, force_index, histvol, choppiness, abs, min, max.
Operators: +, -, *, / and parentheses. Comments begin with //.

RSI, ATR, and ADX use Wilder smoothing after a full lookback. Flat RSI/MFI is 50.
histvol(source, period, periodsPerYear) accepts an optional annualization factor
(default 252). Choose bars per year for your timeframe and market calendar.

There are no loops, network calls, imports, mutation, wall-clock reads, or arbitrary JavaScript.
Execution is isolated in a worker and bounded by source, syntax, bar, plot, and operation limits.`;

export type EdgeIndicatorDiagnostic = {
  code: string;
  column: number;
  line: number;
  message: string;
  severity: "error" | "warning";
};

export type EdgeIndicatorInputType = "boolean" | "number" | "source";
export type EdgeIndicatorInputValue = boolean | number | string;

export type EdgeIndicatorInput = {
  defaultValue: EdgeIndicatorInputValue;
  max?: number;
  min?: number;
  name: string;
  type: EdgeIndicatorInputType;
};

type EdgeExpression =
  | { kind: "binary"; left: EdgeExpression; operator: "+" | "-" | "*" | "/"; right: EdgeExpression }
  | { arguments: EdgeExpression[]; kind: "call"; name: string }
  | { kind: "identifier"; name: string }
  | { kind: "number"; value: number }
  | { argument: EdgeExpression; kind: "unary"; operator: "-" };

export type EdgeIndicatorPlot = {
  color: string;
  expression: EdgeExpression;
  line: number;
  name: string;
};

export type EdgeIndicatorProgram = {
  inputs: EdgeIndicatorInput[];
  name: string;
  overlay: boolean;
  plots: EdgeIndicatorPlot[];
  version: typeof EDGE_INDICATOR_DSL_VERSION;
};

export type EdgeIndicatorParseResult = {
  diagnostics: EdgeIndicatorDiagnostic[];
  program: EdgeIndicatorProgram | null;
};

export type EdgeIndicatorPlotResult = {
  color: string;
  name: string;
  points: Array<{ time: number; value: number }>;
};

export type EdgeIndicatorExecutionResult = {
  audit: {
    bars: number;
    mode: "historical" | "live";
    operations: number;
    plots: number;
    sourceBytes: number;
  };
  diagnostics: EdgeIndicatorDiagnostic[];
  inputs: Record<string, EdgeIndicatorInputValue>;
  name: string;
  overlay: boolean;
  plots: EdgeIndicatorPlotResult[];
};

type Token = {
  column: number;
  kind: "comma" | "eof" | "identifier" | "left" | "number" | "operator" | "right";
  value: string;
};

type ValueType = "boolean" | "number" | "series";
type RuntimeValue = boolean | number | number[];

const SERIES_NAMES = new Set(["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"]);
const SOURCE_NAMES = [...SERIES_NAMES];

export type BackendIndicatorAdapterResult = {
  diagnostics: EdgeIndicatorDiagnostic[];
  source: string | null;
};

/**
 * Converts the server's validated JSON security-boundary format into the
 * canonical, user-editable EdgeLab DSL. Raw JSON is never executable here.
 */
export function adaptBackendIndicatorJson(raw: string): BackendIndicatorAdapterResult {
  const fail = (code: string, message: string): BackendIndicatorAdapterResult => ({
    diagnostics: [diagnostic(code, 1, 1, message)],
    source: null,
  });
  if (new TextEncoder().encode(raw).length > 64 * 1024) {
    return fail("E_ADAPTER_SOURCE_LIMIT", "The server artifact exceeds the 64 KB adapter limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail("E_ADAPTER_JSON", "The server artifact is not valid JSON and was not converted or executed.");
  }
  if (!isPlainRecord(value)) return fail("E_ADAPTER_ROOT", "The server artifact root must be an object.");
  const allowedRoot = new Set(["dsl_version", "name", "description", "inputs", "series", "plots", "signals"]);
  const unknownRoot = Object.keys(value).filter((key) => !allowedRoot.has(key));
  if (unknownRoot.length) return fail("E_ADAPTER_ROOT_FIELD", `Unsupported server field${unknownRoot.length === 1 ? "" : "s"}: ${unknownRoot.join(", ")}.`);
  if (value.dsl_version !== 1) return fail("E_ADAPTER_VERSION", "Only validated server DSL version 1 can be converted.");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 80 || /["\n\r]/.test(value.name)) {
    return fail("E_ADAPTER_NAME", "The server indicator name cannot be represented safely in canonical EdgeLab DSL.");
  }
  const inputs = value.inputs ?? {};
  const series = value.series ?? [];
  const plots = value.plots ?? [];
  const signals = value.signals ?? [];
  if (!isPlainRecord(inputs) || Object.keys(inputs).length > EDGE_INDICATOR_LIMITS.inputs) {
    return fail("E_ADAPTER_INPUTS", `At most ${EDGE_INDICATOR_LIMITS.inputs} supported inputs can be converted.`);
  }
  if (!Array.isArray(series) || series.length > 64 || !Array.isArray(plots) || plots.length > EDGE_INDICATOR_LIMITS.plots || !Array.isArray(signals)) {
    return fail("E_ADAPTER_NODES", "The server artifact contains invalid or excessive node collections.");
  }
  if (signals.length > 0) {
    return fail("E_ADAPTER_SIGNALS", "Server signal nodes are not supported by the chart runtime yet; the artifact was not executed.");
  }

  const inputLines: string[] = [];
  const knownInputs = new Set<string>();
  for (const [name, specValue] of Object.entries(inputs)) {
    if (!safeIdentifier(name) || !isPlainRecord(specValue)) return fail("E_ADAPTER_INPUT", `Input “${name}” is not a supported safe input.`);
    const allowed = new Set(["type", "default", "min", "max", "options"]);
    const unknown = Object.keys(specValue).filter((key) => !allowed.has(key));
    if (unknown.length) return fail("E_ADAPTER_INPUT_FIELD", `Input “${name}” contains unsupported fields.`);
    if (specValue.type === "integer" || specValue.type === "number") {
      if (typeof specValue.default !== "number" || !Number.isFinite(specValue.default)) return fail("E_ADAPTER_INPUT_DEFAULT", `Input “${name}” requires a finite numeric default.`);
      const min = specValue.min == null ? "" : typeof specValue.min === "number" && Number.isFinite(specValue.min) ? ` min ${canonicalNumber(specValue.min)}` : null;
      const max = specValue.max == null ? "" : typeof specValue.max === "number" && Number.isFinite(specValue.max) ? ` max ${canonicalNumber(specValue.max)}` : null;
      if (min == null || max == null || (Array.isArray(specValue.options) && specValue.options.length > 0)) return fail("E_ADAPTER_INPUT_OPTIONS", `Input “${name}” uses unsupported bounds or options.`);
      inputLines.push(`input ${name}: number = ${canonicalNumber(specValue.default)}${min}${max}`);
    } else if (specValue.type === "boolean") {
      if (typeof specValue.default !== "boolean" || specValue.min != null || specValue.max != null || specValue.options != null) return fail("E_ADAPTER_INPUT_DEFAULT", `Boolean input “${name}” is not representable.`);
      inputLines.push(`input ${name}: boolean = ${specValue.default ? "true" : "false"}`);
    } else if (specValue.type === "string" && typeof specValue.default === "string" && SOURCE_NAMES.includes(specValue.default)) {
      if (specValue.min != null || specValue.max != null || (specValue.options != null && (!Array.isArray(specValue.options) || specValue.options.some((item) => typeof item !== "string" || !SOURCE_NAMES.includes(item))))) {
        return fail("E_ADAPTER_SOURCE_INPUT", `Source input “${name}” contains unsupported constraints.`);
      }
      inputLines.push(`input ${name}: source = ${specValue.default}`);
    } else {
      return fail("E_ADAPTER_INPUT_TYPE", `Input “${name}” uses a server type that the chart runtime cannot execute.`);
    }
    knownInputs.add(name);
  }

  const expressions = new Map<string, string>();
  const available = new Set<string>([...SERIES_NAMES, ...knownInputs]);
  const operand = (candidate: unknown): string | null => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return canonicalNumber(candidate);
    if (typeof candidate !== "string" || !available.has(candidate)) return null;
    return expressions.get(candidate) ?? candidate;
  };
  for (let index = 0; index < series.length; index += 1) {
    const node = series[index];
    if (!isPlainRecord(node) || !safeIdentifier(node.name) || available.has(node.name)) return fail("E_ADAPTER_SERIES_NAME", `Series node ${index + 1} has an unsupported name.`);
    const allowed = new Set(["name", "op", "source", "length", "left", "right"]);
    if (Object.keys(node).some((key) => !allowed.has(key))) return fail("E_ADAPTER_SERIES_FIELD", `Series “${node.name}” contains unsupported fields.`);
    let expression: string | null = null;
    if (["sma", "ema", "highest", "lowest"].includes(String(node.op))) {
      const sourceExpression = operand(node.source);
      const lengthExpression = operand(node.length);
      if (sourceExpression && lengthExpression) expression = `${node.op}(${sourceExpression}, ${lengthExpression})`;
    } else if (node.op === "change" || node.op === "roc") {
      const sourceExpression = operand(node.source);
      if (sourceExpression) expression = `${node.op}(${sourceExpression}, 1)`;
    } else if (["add", "subtract", "multiply", "divide"].includes(String(node.op))) {
      const left = operand(node.left);
      const right = operand(node.right);
      const operator = node.op === "add" ? "+" : node.op === "subtract" ? "-" : node.op === "multiply" ? "*" : "/";
      if (left && right) expression = `(${left} ${operator} ${right})`;
    } else {
      return fail("E_ADAPTER_SERIES_OP", `Series “${node.name}” uses unsupported operation “${String(node.op)}”.`);
    }
    if (!expression) return fail("E_ADAPTER_REFERENCE", `Series “${node.name}” contains an unresolved or unsupported reference.`);
    expressions.set(node.name, expression);
    available.add(node.name);
  }

  const plotLines: string[] = [];
  for (let index = 0; index < plots.length; index += 1) {
    const plot = plots[index];
    if (!isPlainRecord(plot) || typeof plot.series !== "string" || !available.has(plot.series)) return fail("E_ADAPTER_PLOT", `Plot ${index + 1} references an unsupported series.`);
    if (plot.width != null || plot.style != null || Object.keys(plot).some((key) => !["series", "color", "width", "style"].includes(key))) {
      return fail("E_ADAPTER_PLOT_STYLE", `Plot “${plot.series}” uses styling that cannot be represented without changing its meaning.`);
    }
    const color = plot.color == null ? "#22d3ee" : plot.color;
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail("E_ADAPTER_PLOT_COLOR", `Plot “${plot.series}” has an invalid color.`);
    plotLines.push(`plot "${plot.series}" = ${expressions.get(plot.series) ?? plot.series} color "${color.toLowerCase()}"`);
  }
  if (plotLines.length === 0) return fail("E_ADAPTER_PLOTS", "The server artifact has no supported plots.");
  const source = [`indicator "${value.name.trim()}" pane`, ...inputLines, ...plotLines].join("\n");
  const parsed = parseEdgeIndicator(source);
  return parsed.program ? { diagnostics: [], source } : { diagnostics: parsed.diagnostics, source: null };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
}

function canonicalNumber(value: number) {
  return Object.is(value, -0) ? "0" : String(value);
}

const FUNCTION_SIGNATURES: Record<string, { args: Array<"number" | "series">; minArgs?: number; returns: ValueType }> = {
  abs: { args: ["series"], returns: "series" },
  adx: { args: ["number"], returns: "series" },
  atr: { args: ["number"], returns: "series" },
  cci: { args: ["number"], returns: "series" },
  change: { args: ["series", "number"], returns: "series" },
  choppiness: { args: ["number"], returns: "series" },
  cmf: { args: ["number"], returns: "series" },
  ema: { args: ["series", "number"], returns: "series" },
  force_index: { args: ["number"], returns: "series" },
  highest: { args: ["series", "number"], returns: "series" },
  histvol: { args: ["series", "number", "number"], minArgs: 2, returns: "series" },
  linreg: { args: ["series", "number"], returns: "series" },
  lowest: { args: ["series", "number"], returns: "series" },
  max: { args: ["series", "series"], returns: "series" },
  mfi: { args: ["number"], returns: "series" },
  min: { args: ["series", "series"], returns: "series" },
  obv: { args: [], returns: "series" },
  roc: { args: ["series", "number"], returns: "series" },
  rsi: { args: ["series", "number"], returns: "series" },
  sma: { args: ["series", "number"], returns: "series" },
  stdev: { args: ["series", "number"], returns: "series" },
  wma: { args: ["series", "number"], returns: "series" },
};

export function parseEdgeIndicator(source: string): EdgeIndicatorParseResult {
  const diagnostics: EdgeIndicatorDiagnostic[] = [];
  if (new TextEncoder().encode(source).length > EDGE_INDICATOR_LIMITS.sourceBytes) {
    diagnostics.push(diagnostic("E_LIMIT_SOURCE", 1, 1, `Source exceeds ${EDGE_INDICATOR_LIMITS.sourceBytes} bytes.`));
    return { diagnostics, program: null };
  }
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let header: { name: string; overlay: boolean } | null = null;
  const inputs: EdgeIndicatorInput[] = [];
  const plots: EdgeIndicatorPlot[] = [];
  let syntaxNodes = 0;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = stripComment(rawLine).trim();
    if (!line) return;
    const headerMatch = line.match(/^indicator\s+"([^"]{1,80})"\s+(overlay|pane)$/i);
    if (headerMatch) {
      if (header) diagnostics.push(diagnostic("E_HEADER_DUPLICATE", lineNumber, 1, "Only one indicator declaration is allowed."));
      else header = { name: headerMatch[1].trim(), overlay: headerMatch[2].toLowerCase() === "overlay" };
      return;
    }
    const inputMatch = line.match(/^input\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(number|boolean|source)\s*=\s*([^\s]+)(?:\s+min\s+(-?(?:\d+\.?\d*|\.\d+)))?(?:\s+max\s+(-?(?:\d+\.?\d*|\.\d+)))?$/i);
    if (inputMatch) {
      const name = inputMatch[1];
      const type = inputMatch[2].toLowerCase() as EdgeIndicatorInputType;
      if (inputs.some((input) => input.name === name) || SERIES_NAMES.has(name)) {
        diagnostics.push(diagnostic("E_INPUT_DUPLICATE", lineNumber, 1, `Input “${name}” is duplicated or reserved.`));
        return;
      }
      const defaultValue = parseInputDefault(type, inputMatch[3]);
      if (defaultValue == null) {
        diagnostics.push(diagnostic("E_INPUT_DEFAULT", lineNumber, 1, `Invalid ${type} default for “${name}”.`));
        return;
      }
      const min = inputMatch[4] == null ? undefined : Number(inputMatch[4]);
      const max = inputMatch[5] == null ? undefined : Number(inputMatch[5]);
      if (type !== "number" && (min != null || max != null)) {
        diagnostics.push(diagnostic("E_INPUT_BOUNDS", lineNumber, 1, "Only number inputs may declare min/max bounds."));
      }
      inputs.push({ defaultValue, max, min, name, type });
      return;
    }
    const plotMatch = line.match(/^plot\s+"([^"]{1,64})"\s*=\s*(.+?)(?:\s+color\s+"(#[0-9a-fA-F]{6})")?$/i);
    if (plotMatch) {
      try {
        const parser = new ExpressionParser(plotMatch[2]);
        const expression = parser.parse();
        syntaxNodes += parser.nodeCount;
        plots.push({ color: plotMatch[3] ?? "#32d3ee", expression, line: lineNumber, name: plotMatch[1].trim() });
      } catch (error) {
        const failure = error as ExpressionSyntaxError;
        diagnostics.push(diagnostic("E_EXPRESSION", lineNumber, failure.column ?? 1, failure.message));
      }
      return;
    }
    diagnostics.push(diagnostic("E_STATEMENT", lineNumber, 1, "Expected an indicator, input, or plot statement."));
  });

  if (!header) diagnostics.push(diagnostic("E_HEADER_REQUIRED", 1, 1, "Start with: indicator \"Name\" overlay|pane"));
  if (inputs.length > EDGE_INDICATOR_LIMITS.inputs) diagnostics.push(diagnostic("E_LIMIT_INPUTS", 1, 1, `At most ${EDGE_INDICATOR_LIMITS.inputs} inputs are allowed.`));
  if (plots.length === 0) diagnostics.push(diagnostic("E_PLOT_REQUIRED", 1, 1, "Add at least one plot statement."));
  if (plots.length > EDGE_INDICATOR_LIMITS.plots) diagnostics.push(diagnostic("E_LIMIT_PLOTS", 1, 1, `At most ${EDGE_INDICATOR_LIMITS.plots} plots are allowed.`));
  if (syntaxNodes > EDGE_INDICATOR_LIMITS.syntaxNodes) diagnostics.push(diagnostic("E_LIMIT_SYNTAX", 1, 1, `Expressions exceed ${EDGE_INDICATOR_LIMITS.syntaxNodes} syntax nodes.`));

  const inputTypes = new Map(inputs.map((input) => [input.name, input.type]));
  plots.forEach((plot) => {
    const type = inferExpressionType(plot.expression, inputTypes, diagnostics, plot.line);
    if (type === "boolean") diagnostics.push(diagnostic("E_PLOT_TYPE", plot.line, 1, "Plots must evaluate to a number or series."));
  });
  const parsedHeader = header as { name: string; overlay: boolean } | null;
  return {
    diagnostics,
    program: parsedHeader && !diagnostics.some((item) => item.severity === "error")
      ? { inputs, name: parsedHeader.name, overlay: parsedHeader.overlay, plots, version: EDGE_INDICATOR_DSL_VERSION }
      : null,
  };
}

export function executeEdgeIndicator({
  bars,
  inputs: providedInputs = {},
  mode = "historical",
  source,
}: {
  bars: Candle[];
  inputs?: Record<string, EdgeIndicatorInputValue>;
  mode?: "historical" | "live";
  source: string;
}): EdgeIndicatorExecutionResult {
  const parsed = parseEdgeIndicator(source);
  if (!parsed.program) throw new EdgeIndicatorRuntimeError("COMPILE_ERROR", parsed.diagnostics.map((item) => `Line ${item.line}: ${item.message}`).join("\n"));
  if (bars.length > EDGE_INDICATOR_LIMITS.bars) throw new EdgeIndicatorRuntimeError("BAR_LIMIT", `Runtime accepts at most ${EDGE_INDICATOR_LIMITS.bars} bars.`);
  const cleanBars = bars.map((bar, index) => {
    if (![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite)) {
      throw new EdgeIndicatorRuntimeError("INVALID_BAR", `Bar ${index + 1} contains a non-finite value.`);
    }
    return bar;
  });
  const resolvedInputs = resolveIndicatorInputs(parsed.program.inputs, providedInputs);
  const budget = new OperationBudget();
  const context = runtimeContext(cleanBars, resolvedInputs, budget);
  const plots = parsed.program.plots.map((plot) => {
    const value = evaluateExpression(plot.expression, context);
    const series = Array.isArray(value) ? value : cleanBars.map(() => Number(value));
    return {
      color: plot.color,
      name: plot.name,
      points: series.flatMap((item, index) => Number.isFinite(item)
        ? [{ time: cleanBars[index].time, value: item }]
        : []),
    };
  });
  return {
    audit: {
      bars: cleanBars.length,
      mode,
      operations: budget.operations,
      plots: plots.length,
      sourceBytes: new TextEncoder().encode(source).length,
    },
    diagnostics: parsed.diagnostics,
    inputs: resolvedInputs,
    name: parsed.program.name,
    overlay: parsed.program.overlay,
    plots,
  };
}

export class EdgeIndicatorRuntimeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EdgeIndicatorRuntimeError";
    this.code = code;
  }
}

class ExpressionSyntaxError extends Error {
  column: number;
  constructor(message: string, column: number) {
    super(message);
    this.column = column;
  }
}

class ExpressionParser {
  nodeCount = 0;
  private index = 0;
  private readonly tokens: Token[];

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  parse() {
    const expression = this.additive();
    if (this.peek().kind !== "eof") throw new ExpressionSyntaxError(`Unexpected token “${this.peek().value}”.`, this.peek().column);
    return expression;
  }

  private additive(): EdgeExpression {
    let expression = this.multiplicative();
    while (this.peek().value === "+" || this.peek().value === "-") {
      const operator = this.consume().value as "+" | "-";
      expression = this.node({ kind: "binary", left: expression, operator, right: this.multiplicative() });
    }
    return expression;
  }

  private multiplicative(): EdgeExpression {
    let expression = this.unary();
    while (this.peek().value === "*" || this.peek().value === "/") {
      const operator = this.consume().value as "*" | "/";
      expression = this.node({ kind: "binary", left: expression, operator, right: this.unary() });
    }
    return expression;
  }

  private unary(): EdgeExpression {
    if (this.peek().value === "-") {
      this.consume();
      return this.node({ argument: this.unary(), kind: "unary", operator: "-" });
    }
    return this.primary();
  }

  private primary(): EdgeExpression {
    const token = this.consume();
    if (token.kind === "number") return this.node({ kind: "number", value: Number(token.value) });
    if (token.kind === "identifier") {
      if (this.peek().kind !== "left") return this.node({ kind: "identifier", name: token.value });
      this.consume();
      const args: EdgeExpression[] = [];
      if (this.peek().kind !== "right") {
        do {
          args.push(this.additive());
          if (this.peek().kind !== "comma") break;
          this.consume();
        } while (true);
      }
      if (this.consume().kind !== "right") throw new ExpressionSyntaxError("Expected closing parenthesis.", this.peek().column);
      return this.node({ arguments: args, kind: "call", name: token.value.toLowerCase() });
    }
    if (token.kind === "left") {
      const expression = this.additive();
      if (this.consume().kind !== "right") throw new ExpressionSyntaxError("Expected closing parenthesis.", token.column);
      return expression;
    }
    throw new ExpressionSyntaxError(`Expected an expression, received “${token.value || "end of line"}”.`, token.column);
  }

  private node<T extends EdgeExpression>(value: T) {
    this.nodeCount += 1;
    return value;
  }

  private consume() {
    return this.tokens[this.index++] ?? this.tokens.at(-1)!;
  }

  private peek() {
    return this.tokens[this.index] ?? this.tokens.at(-1)!;
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const value = source[index];
    if (/\s/.test(value)) { index += 1; continue; }
    if (/[0-9.]/.test(value)) {
      const match = source.slice(index).match(/^(?:\d+\.?\d*|\.\d+)/);
      if (!match) throw new ExpressionSyntaxError("Invalid number.", index + 1);
      tokens.push({ column: index + 1, kind: "number", value: match[0] });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(value)) {
      const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      tokens.push({ column: index + 1, kind: "identifier", value: match[0] });
      index += match[0].length;
      continue;
    }
    const kind = value === "(" ? "left" : value === ")" ? "right" : value === "," ? "comma" : "+-*/".includes(value) ? "operator" : null;
    if (!kind) throw new ExpressionSyntaxError(`Unsupported character “${value}”.`, index + 1);
    tokens.push({ column: index + 1, kind, value });
    index += 1;
  }
  tokens.push({ column: source.length + 1, kind: "eof", value: "" });
  return tokens;
}

function inferExpressionType(
  expression: EdgeExpression,
  inputs: Map<string, EdgeIndicatorInputType>,
  diagnostics: EdgeIndicatorDiagnostic[],
  line: number,
): ValueType {
  if (expression.kind === "number") return "number";
  if (expression.kind === "identifier") {
    if (SERIES_NAMES.has(expression.name)) return "series";
    const input = inputs.get(expression.name);
    if (!input) {
      diagnostics.push(diagnostic("E_UNKNOWN_NAME", line, 1, `Unknown series or input “${expression.name}”.`));
      return "number";
    }
    return input === "source" ? "series" : input;
  }
  if (expression.kind === "unary") return inferExpressionType(expression.argument, inputs, diagnostics, line);
  if (expression.kind === "binary") {
    const left = inferExpressionType(expression.left, inputs, diagnostics, line);
    const right = inferExpressionType(expression.right, inputs, diagnostics, line);
    if (left === "boolean" || right === "boolean") diagnostics.push(diagnostic("E_BOOLEAN_MATH", line, 1, "Boolean inputs cannot be used in arithmetic."));
    return left === "series" || right === "series" ? "series" : "number";
  }
  const signature = FUNCTION_SIGNATURES[expression.name];
  if (!signature) {
    diagnostics.push(diagnostic("E_UNKNOWN_FUNCTION", line, 1, `Unknown function “${expression.name}”.`));
    return "series";
  }
  const minimumArgs = signature.minArgs ?? signature.args.length;
  if (expression.arguments.length < minimumArgs || expression.arguments.length > signature.args.length) {
    const count = minimumArgs === signature.args.length ? String(minimumArgs) : `${minimumArgs}–${signature.args.length}`;
    diagnostics.push(diagnostic("E_ARGUMENT_COUNT", line, 1, `${expression.name} expects ${count} argument${signature.args.length === 1 ? "" : "s"}.`));
  }
  expression.arguments.forEach((argument, index) => {
    const actual = inferExpressionType(argument, inputs, diagnostics, line);
    const expected = signature.args[index];
    if (expected === "number" && actual !== "number") diagnostics.push(diagnostic("E_ARGUMENT_TYPE", line, 1, `Argument ${index + 1} of ${expression.name} must be a number.`));
  });
  return signature.returns;
}

function parseInputDefault(type: EdgeIndicatorInputType, raw: string): EdgeIndicatorInputValue | null {
  if (type === "boolean") return raw === "true" ? true : raw === "false" ? false : null;
  if (type === "source") return SOURCE_NAMES.includes(raw) ? raw : null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function resolveIndicatorInputs(
  definitions: EdgeIndicatorInput[],
  provided: Record<string, EdgeIndicatorInputValue>,
) {
  return Object.fromEntries(definitions.map((definition) => {
    const candidate = provided[definition.name];
    if (definition.type === "number") {
      const numeric = typeof candidate === "number" && Number.isFinite(candidate) ? candidate : Number(definition.defaultValue);
      return [definition.name, clamp(numeric, definition.min ?? -1_000_000, definition.max ?? 1_000_000)];
    }
    if (definition.type === "boolean") return [definition.name, typeof candidate === "boolean" ? candidate : definition.defaultValue];
    return [definition.name, typeof candidate === "string" && SOURCE_NAMES.includes(candidate) ? candidate : definition.defaultValue];
  }));
}

class OperationBudget {
  operations = 0;
  add(count: number) {
    this.operations += Math.max(1, count);
    if (this.operations > EDGE_INDICATOR_LIMITS.operations) throw new EdgeIndicatorRuntimeError("OPERATION_LIMIT", `Execution exceeded ${EDGE_INDICATOR_LIMITS.operations.toLocaleString()} deterministic operations.`);
  }
}

function runtimeContext(
  bars: Candle[],
  inputs: Record<string, EdgeIndicatorInputValue>,
  budget: OperationBudget,
) {
  const series: Record<string, number[]> = {
    close: bars.map((bar) => bar.close),
    high: bars.map((bar) => bar.high),
    hl2: bars.map((bar) => (bar.high + bar.low) / 2),
    hlc3: bars.map((bar) => (bar.high + bar.low + bar.close) / 3),
    low: bars.map((bar) => bar.low),
    ohlc4: bars.map((bar) => (bar.open + bar.high + bar.low + bar.close) / 4),
    open: bars.map((bar) => bar.open),
    volume: bars.map((bar) => bar.volume),
  };
  return { bars, budget, inputs, series };
}

function evaluateExpression(
  expression: EdgeExpression,
  context: ReturnType<typeof runtimeContext>,
): RuntimeValue {
  if (expression.kind === "number") return expression.value;
  if (expression.kind === "identifier") {
    if (context.series[expression.name]) return context.series[expression.name];
    const input = context.inputs[expression.name];
    if (typeof input === "string") return context.series[input];
    return input ?? Number.NaN;
  }
  if (expression.kind === "unary") return applyUnary(evaluateExpression(expression.argument, context), context.budget);
  if (expression.kind === "binary") return applyBinary(evaluateExpression(expression.left, context), evaluateExpression(expression.right, context), expression.operator, context.bars.length, context.budget);
  return evaluateCall(expression.name, expression.arguments.map((argument) => evaluateExpression(argument, context)), context);
}

function applyUnary(value: RuntimeValue, budget: OperationBudget): RuntimeValue {
  if (Array.isArray(value)) { budget.add(value.length); return value.map((item) => -item); }
  return typeof value === "number" ? -value : Number.NaN;
}

function applyBinary(left: RuntimeValue, right: RuntimeValue, operator: "+" | "-" | "*" | "/", length: number, budget: OperationBudget): RuntimeValue {
  const calculate = (a: number, b: number) => operator === "+" ? a + b : operator === "-" ? a - b : operator === "*" ? a * b : b === 0 ? Number.NaN : a / b;
  if (!Array.isArray(left) && !Array.isArray(right)) return calculate(Number(left), Number(right));
  budget.add(length);
  const leftSeries = Array.isArray(left) ? left : Array.from({ length }, () => Number(left));
  const rightSeries = Array.isArray(right) ? right : Array.from({ length }, () => Number(right));
  return leftSeries.map((value, index) => calculate(value, rightSeries[index]));
}

function evaluateCall(name: string, args: RuntimeValue[], context: ReturnType<typeof runtimeContext>): number[] {
  const period = (index: number) => clamp(Math.round(Number(args[index])), 1, 5000);
  const series = (index: number) => Array.isArray(args[index]) ? args[index] as number[] : context.bars.map(() => Number(args[index]));
  const budget = context.budget;
  switch (name) {
    case "abs": budget.add(context.bars.length); return series(0).map(Math.abs);
    case "sma": return rollingMean(series(0), period(1), budget);
    case "ema": return exponentialMean(series(0), period(1), budget);
    case "wma": return weightedMean(series(0), period(1), budget);
    case "highest": return rollingExtreme(series(0), period(1), Math.max, budget);
    case "lowest": return rollingExtreme(series(0), period(1), Math.min, budget);
    case "change": return changeSeries(series(0), period(1), budget);
    case "roc": return rateOfChange(series(0), period(1), budget);
    case "rsi": return relativeStrength(series(0), period(1), budget);
    case "atr": return averageTrueRange(context.bars, period(0), budget);
    case "stdev": return rollingDeviation(series(0), period(1), budget);
    case "linreg": return linearRegression(series(0), period(1), budget);
    case "cci": return commodityChannel(context.bars, period(0), budget);
    case "adx": return averageDirectionalIndex(context.bars, period(0), budget);
    case "obv": return onBalanceVolume(context.bars, budget);
    case "mfi": return moneyFlowIndex(context.bars, period(0), budget);
    case "cmf": return chaikinMoneyFlow(context.bars, period(0), budget);
    case "force_index": return forceIndex(context.bars, period(0), budget);
    case "histvol": return historicalVolatility(series(0), period(1), budget, args.length > 2 ? clamp(Number(args[2]), 1, 1_000_000_000) : 252);
    case "choppiness": return choppinessIndex(context.bars, period(0), budget);
    case "min": return elementwise(series(0), series(1), Math.min, budget);
    case "max": return elementwise(series(0), series(1), Math.max, budget);
    default: throw new EdgeIndicatorRuntimeError("UNKNOWN_FUNCTION", `Unknown function “${name}”.`);
  }
}

function rollingMean(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length * 2);
  const result = values.map(() => Number.NaN);
  let sum = 0;
  values.forEach((value, index) => { sum += value; if (index >= period) sum -= values[index - period]; if (index >= period - 1) result[index] = sum / period; });
  return result;
}

function exponentialMean(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length);
  const factor = 2 / (period + 1);
  let previous = Number.NaN;
  return values.map((value) => { previous = Number.isFinite(previous) ? value * factor + previous * (1 - factor) : value; return previous; });
}

function weightedMean(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length * period);
  const divisor = period * (period + 1) / 2;
  return values.map((_, index) => index < period - 1 ? Number.NaN : values.slice(index - period + 1, index + 1).reduce((sum, value, offset) => sum + value * (offset + 1), 0) / divisor);
}

function rollingExtreme(values: number[], period: number, operation: (...values: number[]) => number, budget: OperationBudget) {
  budget.add(values.length * period);
  return values.map((_, index) => index < period - 1 ? Number.NaN : operation(...values.slice(index - period + 1, index + 1)));
}

function changeSeries(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length);
  return values.map((value, index) => index < period ? Number.NaN : value - values[index - period]);
}

function rateOfChange(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length);
  return values.map((value, index) => index < period || values[index - period] === 0 ? Number.NaN : ((value / values[index - period]) - 1) * 100);
}

function relativeStrength(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length * 5);
  const changes = values.map((value, index) => index === 0 ? Number.NaN : value - values[index - 1]);
  const gains = wilderAverage(changes.map((value) => Math.max(0, value)), period);
  const losses = wilderAverage(changes.map((value) => Math.max(0, -value)), period);
  return gains.map((gain, index) => {
    const loss = losses[index];
    if (!Number.isFinite(gain) || !Number.isFinite(loss)) return Number.NaN;
    if (gain === 0 && loss === 0) return 50;
    return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  });
}

function averageTrueRange(bars: Candle[], period: number, budget: OperationBudget) {
  budget.add(bars.length * 2);
  return wilderAverage(trueRanges(bars), period);
}

function rollingDeviation(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length * period);
  return values.map((_, index) => {
    if (index < period - 1) return Number.NaN;
    const window = values.slice(index - period + 1, index + 1);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period);
  });
}

function linearRegression(values: number[], period: number, budget: OperationBudget) {
  budget.add(values.length * period);
  const xMean = (period - 1) / 2;
  const denominator = Array.from({ length: period }, (_, x) => (x - xMean) ** 2).reduce((a, b) => a + b, 0) || 1;
  return values.map((_, index) => {
    if (index < period - 1) return Number.NaN;
    const window = values.slice(index - period + 1, index + 1);
    const yMean = window.reduce((sum, value) => sum + value, 0) / period;
    const slope = window.reduce((sum, value, x) => sum + (x - xMean) * (value - yMean), 0) / denominator;
    return yMean + slope * xMean;
  });
}

function commodityChannel(bars: Candle[], period: number, budget: OperationBudget) {
  const typical = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
  const means = rollingMean(typical, period, budget);
  budget.add(bars.length * period);
  return typical.map((value, index) => {
    if (index < period - 1) return Number.NaN;
    const deviation = typical.slice(index - period + 1, index + 1).reduce((sum, item) => sum + Math.abs(item - means[index]), 0) / period;
    return deviation === 0 ? 0 : (value - means[index]) / (0.015 * deviation);
  });
}

function averageDirectionalIndex(bars: Candle[], period: number, budget: OperationBudget) {
  budget.add(bars.length * 9);
  const tr = trueRanges(bars);
  if (tr.length > 0) tr[0] = Number.NaN;
  const plus = bars.map((bar, index) => index === 0 ? Number.NaN : Math.max(0, bar.high - bars[index - 1].high) > Math.max(0, bars[index - 1].low - bar.low) ? Math.max(0, bar.high - bars[index - 1].high) : 0);
  const minus = bars.map((bar, index) => index === 0 ? Number.NaN : Math.max(0, bars[index - 1].low - bar.low) > Math.max(0, bar.high - bars[index - 1].high) ? Math.max(0, bars[index - 1].low - bar.low) : 0);
  const atr = wilderAverage(tr, period);
  const plusMean = wilderAverage(plus, period);
  const minusMean = wilderAverage(minus, period);
  const dx = bars.map((_, index) => {
    if (!Number.isFinite(atr[index])) return Number.NaN;
    if (atr[index] === 0) return 0;
    const plusDi = 100 * plusMean[index] / atr[index]; const minusDi = 100 * minusMean[index] / atr[index];
    return plusDi + minusDi === 0 ? 0 : 100 * Math.abs(plusDi - minusDi) / (plusDi + minusDi);
  });
  return wilderAverage(dx, period);
}

function onBalanceVolume(bars: Candle[], budget: OperationBudget) {
  budget.add(bars.length);
  let total = 0;
  return bars.map((bar, index) => { if (index > 0) total += bar.close > bars[index - 1].close ? bar.volume : bar.close < bars[index - 1].close ? -bar.volume : 0; return total; });
}

function moneyFlowIndex(bars: Candle[], period: number, budget: OperationBudget) {
  budget.add(bars.length * period);
  const typical = bars.map((bar) => (bar.high + bar.low + bar.close) / 3);
  return bars.map((_, index) => {
    if (index < period) return Number.NaN;
    let positive = 0; let negative = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const flow = typical[cursor] * bars[cursor].volume;
      if (typical[cursor] > typical[cursor - 1]) positive += flow;
      else if (typical[cursor] < typical[cursor - 1]) negative += flow;
    }
    if (positive === 0 && negative === 0) return 50;
    return negative === 0 ? 100 : 100 - 100 / (1 + positive / negative);
  });
}

function chaikinMoneyFlow(bars: Candle[], period: number, budget: OperationBudget) {
  budget.add(bars.length * period);
  return bars.map((_, index) => {
    if (index < period - 1) return Number.NaN;
    let flow = 0; let volume = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const bar = bars[cursor]; const range = bar.high - bar.low;
      flow += (range === 0 ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / range) * bar.volume;
      volume += bar.volume;
    }
    return volume === 0 ? 0 : flow / volume;
  });
}

function forceIndex(bars: Candle[], period: number, budget: OperationBudget) {
  const raw = bars.map((bar, index) => index === 0 ? 0 : (bar.close - bars[index - 1].close) * bar.volume);
  return exponentialMean(raw, period, budget);
}

function historicalVolatility(values: number[], period: number, budget: OperationBudget, periodsPerYear = 252) {
  budget.add(values.length * 2);
  const returns = values.map((value, index) => index === 0 || value <= 0 || values[index - 1] <= 0 ? Number.NaN : Math.log(value / values[index - 1]));
  return rollingDeviation(returns, period, budget).map((value) => value * Math.sqrt(periodsPerYear) * 100);
}

function choppinessIndex(bars: Candle[], period: number, budget: OperationBudget) {
  budget.add(bars.length * period);
  const tr = trueRanges(bars);
  return bars.map((_, index) => {
    if (index < period - 1) return Number.NaN;
    const window = bars.slice(index - period + 1, index + 1);
    const range = Math.max(...window.map((bar) => bar.high)) - Math.min(...window.map((bar) => bar.low));
    const totalRange = tr.slice(index - period + 1, index + 1).reduce((sum, value) => sum + value, 0);
    return range <= 0 || totalRange <= 0 ? 0 : 100 * Math.log10(totalRange / range) / Math.log10(period);
  });
}

function elementwise(left: number[], right: number[], operation: (left: number, right: number) => number, budget: OperationBudget) {
  budget.add(left.length);
  return left.map((value, index) => operation(value, right[index]));
}

function diagnostic(code: string, line: number, column: number, message: string): EdgeIndicatorDiagnostic {
  return { code, column, line, message, severity: "error" };
}

function stripComment(line: string) {
  const index = line.indexOf("//");
  return index < 0 ? line : line.slice(0, index);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
