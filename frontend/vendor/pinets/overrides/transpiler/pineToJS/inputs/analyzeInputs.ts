// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
// EdgeLab modification: bounded activation, canonical enum input metadata and scoped enum type checks (2026-10-08).

import { Identifier, Literal, ObjectExpression, Property } from '../ast';
import { ConstEnv, ConstType, ConstValue, dottedName, evalConst, finalizeConst, SOURCE_BUILTINS } from './constEval';
import { describeArgument, inferQualified, QualifierEnv, startPos, ValueType } from './qualifiers';

/**
 * Input declaration analysis over the pine2js AST (runs before code generation).
 *
 * TradingView declares inputs at compile time, wherever the `input*()` call
 * sits: global or local scope, `if`/`switch`/loop bodies, function bodies,
 * or directly as an argument (`ta.sma(close, input(14))`). This pass mirrors
 * that model:
 *
 *   - Every reachable input call site gets a sequential id `in_0`, `in_1`, …
 *     in source order — the same ids TradingView uses. Call sites in branches
 *     whose condition folds to a constant are skipped (`if false`, a
 *     `const` false variable, `false and …`, constant ternaries and switches).
 *   - Each input is labelled like the settings dialog: the `title` argument
 *     when given, else the variable it is assigned to (`k = …`, `k := …`,
 *     `k += …`, even deep inside the expression), else the enclosing
 *     function's name, else "untitled".
 *   - Arguments are folded at compile time (see constEval). A folded default
 *     that does not depend on the chart replaces the original expression, so
 *     the runtime value matches the declared one (`input(7 / 2)` is 3).
 *   - Arguments may only reference constants: a loop counter or a function
 *     parameter is an undeclared identifier there, and a variable holding
 *     another input is rejected.
 *
 * The call is tagged with a trailing `{ __inputId, __varId }` argument; the
 * runtime pops it (input/utils.parseInputOptions) and uses the id as the
 * primary override key.
 */

export interface InputSite {
    /** `in_N`, in declaration order. */
    id: string;
    /** `''` for the bare `input()` wrapper, else the `input.<fn>` name. */
    fn: string;
    /** Label shown in the settings dialog. */
    name: string;
    /** Variable the input value is assigned to, when there is one. */
    varId?: string;
    /** Folded argument values keyed by parameter name. */
    args: Record<string, unknown>;
    /** Static type of the folded `defval` (drives the bare `input()` auto-typing). */
    defvalType?: ConstType;
}

export interface AnalyzeInputsOptions {
    /** Pine version of the script — v5 truncates `const int / const int`. */
    version?: number | null;
}

const UNTITLED = 'untitled';

const TYPED_INPUT_FNS = new Set([
    'bool',
    'color',
    'enum',
    'float',
    'int',
    'price',
    'session',
    'source',
    'string',
    'symbol',
    'text_area',
    'time',
    'timeframe',
]);

// Positional parameter order per input function (Pine v6 reference).
const POSITIONAL_BY_FN: Record<string, readonly string[]> = {
    '': ['defval', 'title', 'tooltip', 'inline', 'group', 'display', 'active'],
    bool: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    color: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    enum: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    price: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    session: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    source: ['defval', 'title', 'tooltip', 'inline', 'group', 'display', 'active', 'confirm'],
    string: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    symbol: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    text_area: ['defval', 'title', 'tooltip', 'group', 'confirm', 'display', 'active'],
    time: ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
    timeframe: ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
};
// The bare wrapper's source overload orders `inline` / `group` before `tooltip`.
const BARE_SOURCE_LAYOUT = ['defval', 'title', 'inline', 'group', 'tooltip', 'display', 'active'];
// input.int / input.float: the 3rd positional is `options` (array) or `minval`.
const INT_FLOAT_OPTIONS = ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'];
const INT_FLOAT_RANGE = ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'];

const DEFVAL_TYPE: Record<string, string> = {
    '': 'bool', // the bare wrapper's first overload; used for bool / string runtime defaults
    int: 'int',
    float: 'float',
    bool: 'bool',
    string: 'string',
    text_area: 'string',
    session: 'string',
    symbol: 'string',
    timeframe: 'string',
    time: 'int',
    price: 'float',
    color: 'color',
};

/** Type an input argument must have, as a `const`, for qualifier checks. */
function expectedArgType(fn: string, param: string): string | undefined {
    if (param === 'defval') return DEFVAL_TYPE[fn];
    if (param === 'title' || param === 'tooltip' || param === 'group' || param === 'inline') return 'string';
    if (param === 'minval' || param === 'maxval' || param === 'step') return fn === 'int' ? 'int' : 'float';
    if (param === 'confirm') return 'bool';
    return undefined;
}

/** Enum types are checked on the original Pine AST, including unreachable branches. */
function checkEnumTypes(ast: any, version?: number | null): WeakSet<object> {
    type Binding = { type?: string; namespace?: string; init?: any; declaration?: any };
    type Fn = { node: any; scope: Env; origin?: any };
    class Env {
        vars = new Map<string, Binding>();
        functions = new Map<string, Fn[]>();
        constructor(readonly parent: Env | null) {}
        binding(name: string): Binding | undefined { return this.vars.get(name) ?? this.parent?.binding(name); }
        functionsFor(name: string): Fn[] { return this.functions.get(name) ?? this.parent?.functionsFor(name) ?? []; }
    }
    const enumNames = new Set<string>();
    const objectNames = new Set<string>();
    const objectFields = new Map<string, Map<string, string>>();
    const mutated = new WeakSet<object>();
    const globalEnums = new Set((ast.body ?? []).flatMap((node: any) =>
        node.type === 'VariableDeclaration' ? (node.declarations ?? []).map((declaration: any) => declaration.init).filter((init: any) => init?._pineEnumName) : []));
    forEachNode(ast, node => {
        if (node.type === 'TypeDefinition') {
            objectNames.add(node.name);
            objectFields.set(node.name, new Map((node.fields ?? []).map((field: any) => [field.name, field.type])));
        }
        if (!node._pineEnumName) return;
        if (!globalEnums.has(node)) throw new Error('Enum declarations must be in global scope.');
        if (enumNames.has(node._pineEnumName)) throw new Error('Duplicate enum declaration ' + node._pineEnumName + '.');
        enumNames.add(node._pineEnumName);
    });
    const normalize = (type: unknown): string | undefined => typeof type === 'string'
        ? type.replace(/\b(const|input|simple|series)\s+/g, '').replace(/\s+/g, '') : undefined;
    const enumType = (type?: string) => Boolean(type && enumNames.has(type));
    const hasEnum = (type?: string) => Boolean(type && (enumType(type) || [...enumNames].some(name => type.includes('<' + name + '>') || type.includes('<' + name + ',') || type.includes(',' + name + '>'))));
    const compatible = (expected?: string, actual?: string, location = 'expression') => {
        if (!expected || !actual || actual === '@na') return;
        if ((hasEnum(expected) || hasEnum(actual)) && expected !== actual)
            throw new Error('Incompatible enum types in ' + location + ': ' + expected + ' and ' + actual + '.');
    };
    const join = (left?: string, right?: string): string | undefined => {
        if (left === '@na') return right;
        if (right === '@na') return left;
        compatible(left, right);
        return left === right ? left : left ?? right;
    };
    const genericParts = (type?: string): string[] => {
        const start = type?.indexOf('<') ?? -1;
        return start < 0 ? [] : type!.slice(start + 1, -1).split(',');
    };
    let depth = 0;
    let expressionVisits = 0;
    const activeFunctions = new Set<object>();
    const functionStack: Fn[] = [];
    const unresolvedOverloads = new Set<any>();
    const ordinaryCalls = new Map<any, Fn>();
    const specializations = new WeakMap<object, Map<string, Fn>>();
    let specializationIndex = 0;
    let hasOrdinaryOverloads = false;
    const clone = (node: any): any => {
        if (Array.isArray(node)) return node.map(clone);
        if (!node || typeof node !== 'object') return node;
        if (++expressionVisits > 100_000) throw new Error('Pine overload specialization exceeded its analysis budget.');
        // One written input declaration keeps one ID/default/activation tree,
        // even when its containing generic function has specialized bodies.
        if (inputFnName(node) !== null) return node;
        const copy: any = {};
        for (const [key, value] of Object.entries(node)) {
            if (['parent', '_pineOverloadTarget', '_pineOverloadParams', '_pineSpecializations'].includes(key)) continue;
            copy[key] = clone(value);
        }
        return copy;
    };
    function constantInt(node: any, scope: Env): boolean {
        const resolving = new Set<Binding>();
        const env: ConstEnv = {
            enums: new Map(), truncatingIntDivision: true,
            lookup(name) {
                const binding = scope.binding(name);
                if (!binding?.init || mutated.has(binding.init) || resolving.has(binding)) return undefined;
                if (++expressionVisits > 100_000) throw new Error('Pine overload analysis exceeded its expression budget.');
                resolving.add(binding);
                try { return evalConst(binding.init, env); }
                finally { resolving.delete(binding); }
            },
        };
        return evalConst(node, env)?.type === 'int';
    }
    function specialize(fn: Fn, args: Array<string | undefined>): Fn {
        const params = fn.node.params ?? [];
        if (!hasOrdinaryOverloads || fn.node.id?.isMethod || !params.some((pattern: any) => !normalize((pattern.left ?? pattern).varType))) return fn;
        const types = params.map((pattern: any, index: number) => normalize((pattern.left ?? pattern).varType)
            ?? args[index] ?? (pattern.type === 'AssignmentPattern' ? expression(pattern.right, fn.scope) : undefined));
        if (types.some(type => !type || type === '@na')) return fn;
        const key = types.join('|');
        let instances = specializations.get(fn.node);
        if (!instances) specializations.set(fn.node, instances = new Map());
        if (instances.has(key)) return instances.get(key)!;
        const node = clone(fn.node);
        delete node._pineOverloadName;
        node._pineOverloadName = '$F_' + fn.node.id.name + '$S' + (++specializationIndex);
        node.params.forEach((pattern: any, index: number) => {
            const target = pattern.left ?? pattern;
            if (!normalize(target.varType)) target.varType = types[index];
        });
        const instance = { node, scope: fn.scope, origin: fn.origin ?? fn.node };
        instances.set(key, instance);
        (fn.node._pineSpecializations ??= []).push(node);
        return instance;
    }
    function functionResult(fn: Fn, args: Array<string | undefined> = []): string | undefined {
        const origin = fn.origin ?? fn.node;
        if (activeFunctions.has(origin)) throw new Error('Recursive Pine function calls are not supported.');
        if (++depth > 64) { depth--; throw new Error('Pine enum type analysis exceeded its function depth limit.'); }
        activeFunctions.add(origin);
        functionStack.push(fn);
        try {
            const scope = new Env(fn.scope);
            const params = fn.node.params ?? [];
            for (let index = 0; index < params.length; index++) {
                const pattern = params[index].type === 'AssignmentPattern' ? params[index].left : params[index];
                const declared = normalize(pattern.varType);
                const actual = args[index] ?? (params[index].type === 'AssignmentPattern' ? expression(params[index].right, scope) : undefined);
                compatible(declared, actual, 'parameter ' + pattern.name);
                scope.vars.set(pattern.name, { type: declared ?? actual });
            }
            const declared = normalize(fn.node.id?.returnType ?? fn.node.returnType);
            const result = statements(fn.node.body?.body ?? [], scope, declared);
            compatible(declared, result, 'return');
            return declared ?? result;
        } finally { functionStack.pop(); activeFunctions.delete(origin); depth--; }
    }
    function expression(node: any, scope: Env): string | undefined {
        if (!node) return undefined;
        if (++expressionVisits > 100_000) throw new Error('Pine enum type analysis exceeded its expression budget.');
        switch (node.type) {
            case 'Literal': return typeof node.value === 'string' ? 'string' : typeof node.value === 'boolean' ? 'bool' : typeof node.value === 'number'
                ? (typeof node.raw === 'string' ? /[.eE]/.test(node.raw) : !Number.isInteger(node.value)) ? 'float' : 'int' : '@na';
            case 'Identifier': {
                if (node.name === 'na') return '@na';
                const binding = scope.binding(node.name);
                if (binding) return binding.type;
                if (SOURCE_BUILTINS.has(node.name)) return 'float';
                if (['bar_index', 'last_bar_index', 'time', 'time_close', 'timenow', 'last_bar_time', 'dayofmonth', 'dayofweek', 'month', 'year', 'hour', 'minute', 'second'].includes(node.name)) return 'int';
                return undefined;
            }
            case 'MemberExpression': {
                if (node.computed) { expression(node.property, scope); return expression(node.object, scope); }
                if (node.object?.type === 'Identifier') {
                    const namespace = scope.binding(node.object.name)?.namespace;
                    if (namespace) {
                        const init = scope.binding(node.object.name)?.init;
                        if (!init?.properties?.some((property: any) => property.key?.name === node.property?.name))
                            throw new Error('Unknown enum member ' + namespace + '.' + node.property?.name + '.');
                        return namespace;
                    }
                }
                const receiver = expression(node.object, scope);
                const field = receiver && objectFields.get(receiver)?.get(node.property?.name);
                if (field) return normalize(field);
                const name = dottedName(node);
                if (name?.startsWith('color.') || ['chart.bg_color', 'chart.fg_color'].includes(name)) return 'color';
                if (name?.startsWith('barstate.')) return 'bool';
                if (['syminfo.ticker', 'syminfo.tickerid', 'syminfo.currency', 'syminfo.basecurrency', 'syminfo.timezone', 'syminfo.session', 'syminfo.type', 'timeframe.period'].includes(name)) return 'string';
                if (['syminfo.mintick', 'syminfo.pointvalue', 'syminfo.minmove', 'syminfo.pricescale', 'syminfo.mincontract', 'timeframe.multiplier'].includes(name)) return 'float';
                return undefined;
            }
            case 'ConditionalExpression':
                if (enumType(expression(node.test, scope))) throw new Error('Enum values cannot be used as boolean conditions.');
                return join(expression(node.consequent, scope), expression(node.alternate, scope));
            case 'BinaryExpression':
            case 'LogicalExpression': {
                const left = expression(node.left, scope), right = expression(node.right, scope);
                if (['==', '!=', '===', '!=='].includes(node.operator)) {
                    compatible(left, right, 'comparison');
                    return 'bool';
                }
                if (enumType(left) || enumType(right)) throw new Error('Enum values support equality comparisons only.');
                return ['&&', '||', '<', '>', '<=', '>='].includes(node.operator) ? 'bool'
                    : node.operator === '/' && (version == null || version >= 6 || !constantInt(node.left, scope) || !constantInt(node.right, scope)) ? 'float'
                    : left === 'float' || right === 'float' ? 'float' : left ?? right;
            }
            case 'UnaryExpression': {
                const type = expression(node.argument, scope);
                if (enumType(type)) throw new Error('Unsupported operator on enum value.');
                return node.operator === '!' ? 'bool' : type;
            }
            case 'AssignmentExpression': {
                const actual = expression(node.right, scope);
                if (node.operator !== '=' && (enumType(actual) || enumType(expression(node.left, scope))))
                    throw new Error('Enum values support direct assignment only.');
                if (node.left?.type === 'Identifier') {
                    const binding = scope.binding(node.left.name);
                    if (binding) {
                        compatible(binding.type, actual, 'assignment');
                        if (!binding.type && actual !== '@na') binding.type = actual;
                        if (binding.init && typeof binding.init === 'object') mutated.add(binding.init);
                    }
                } else expression(node.left, scope);
                return actual;
            }
            case 'ArrayExpression': {
                let member: string | undefined;
                for (const item of node.elements ?? []) member = join(member, expression(item, scope));
                return member ? 'array<' + member + '>' : undefined;
            }
            case 'SwitchExpression': {
                const subject = expression(node.discriminant, scope);
                let result: string | undefined;
                for (const arm of node.cases ?? []) {
                    if (arm.test) compatible(subject, expression(arm.test, scope), 'switch');
                    const child = new Env(scope);
                    result = join(result, arm.statements?.length ? statements(arm.statements, child) : expression(arm.consequent, child));
                }
                return result;
            }
            case 'CallExpression': {
                const callee = dottedName(node.callee);
                const raw = node.arguments ?? [];
                const userCall = node.callee?.type === 'Identifier' && scope.functionsFor(node.callee.name).some(fn => !fn.node.id?.isMethod);
                const named = raw.at(-1)?.type === 'ObjectExpression' ? raw.at(-1).properties ?? [] : [];
                const positional = named.length ? raw.slice(0, -1) : raw;
                if (userCall && new Set(named.map((property: any) => property.key?.name)).size !== named.length)
                    throw new Error('Duplicate named Pine function argument.');
                const actual = positional.map((argument: any) => expression(argument, scope));
                const namedTypes = new Map<string, string | undefined>(named.map((property: any) => [property.key?.name, expression(property.value, scope)]));
                if (callee === 'input.enum') return actual[0] ?? namedTypes.get('defval');
                if (callee?.startsWith('str.')) {
                    const invalid = callee === 'str.tostring'
                        ? actual.slice(1).some(enumType) || [...namedTypes].some(([name, type]) => name !== 'value' && enumType(type))
                        : actual.some(enumType) || [...namedTypes.values()].some(enumType);
                    if (invalid) throw new Error('Enum values require str.tostring() before use as string arguments.');
                    if (callee === 'str.tostring') return 'string';
                }
                const primitiveInput = callee?.startsWith('input.') ? DEFVAL_TYPE[callee.slice(6)] : undefined;
                if (primitiveInput) return primitiveInput;
                if (!userCall && ['int', 'float', 'bool', 'string', 'color'].includes(callee ?? '')) return callee;
                if (callee?.startsWith('color.')) return ['color.r', 'color.g', 'color.b', 'color.t'].includes(callee) ? 'float' : 'color';
                if (!userCall && callee === 'na') return 'bool';
                if (!userCall && ['nz', 'fixnan'].includes(callee ?? '')) return join(actual[0], actual[1]);
                if (node.callee?.type === 'MemberExpression' && !node.callee.computed) {
                    const object = node.callee.object;
                    if (object?.type === 'Identifier' && objectNames.has(object.name) && node.callee.property?.name === 'new') return object.name;
                    if (node.callee.property?.name === 'copy') {
                        if (object?.type === 'Identifier' && objectNames.has(object.name)) return object.name;
                        const receiver = expression(object, scope);
                        if (receiver && objectNames.has(receiver)) return receiver;
                    }
                }
                if (callee?.startsWith('math.') || callee?.startsWith('ta.')) {
                    if (actual.some(enumType)) throw new Error('Enum values cannot be used as numeric function arguments.');
                    if (['ta.cross', 'ta.crossover', 'ta.crossunder', 'ta.rising', 'ta.falling'].includes(callee)) return 'bool';
                    if (callee === 'ta.change') return actual[0] ?? namedTypes.get('source');
                    if (callee === 'math.round' && (actual.length > 1 || namedTypes.has('precision'))) return 'float';
                    if (['ta.barssince', 'ta.highestbars', 'ta.lowestbars', 'math.floor', 'math.ceil', 'math.round', 'math.round_to_mintick'].includes(callee))
                        return callee === 'math.round_to_mintick' ? 'float' : 'int';
                    if (['math.abs', 'math.min', 'math.max'].includes(callee)) {
                        const operands = [...actual, ...namedTypes.values()];
                        return operands.length && operands.every(type => type === 'int' || type === 'float')
                            ? operands.includes('float') ? 'float' : 'int' : undefined;
                    }
                    if (['math.avg', 'math.sqrt', 'math.pow', 'math.exp', 'math.log', 'math.log10', 'math.sin', 'math.cos', 'math.tan', 'math.asin', 'math.acos', 'math.atan', 'math.random',
                        'math.sum', 'ta.sma', 'ta.ema', 'ta.rma', 'ta.wma', 'ta.vwma', 'ta.hma', 'ta.rsi', 'ta.atr', 'ta.tr', 'ta.highest', 'ta.lowest', 'ta.mom', 'ta.roc', 'ta.stdev', 'ta.variance', 'ta.sum', 'ta.cum'].includes(callee)) return 'float';
                    return undefined;
                }
                if (['str.contains', 'str.startswith', 'str.endswith'].includes(callee ?? '')) return 'bool';
                if (['str.length', 'str.pos'].includes(callee ?? '')) return 'int';
                if (callee === 'str.tonumber') return 'float';
                if (['str.upper', 'str.lower', 'str.substring', 'str.replace', 'str.replace_all', 'str.format', 'str.trim', 'str.repeat'].includes(callee ?? '')) return 'string';
                if (callee === 'array.from') { let type: string | undefined; actual.forEach((value: string | undefined) => { type = join(type, value); }); return type ? 'array<' + type + '>' : undefined; }
                const generic = /^((?:array|map|matrix)\.new)<(.+)>$/.exec(callee ?? '');
                if (generic) return generic[1].split('.')[0] + '<' + generic[2] + '>';
                if (callee === 'array.new' || callee === 'map.new' || callee === 'matrix.new') {
                    const parameters = node._pineGenericTypes;
                    if (typeof parameters === 'string') return callee.split('.')[0] + '<' + parameters + '>';
                }
                if (callee?.startsWith('array.') || callee?.startsWith('map.') || callee?.startsWith('matrix.')) {
                    const kind = callee.split('.')[0], method = callee.split('.')[1];
                    const receiver = actual[0], parts = genericParts(receiver);
                    if (receiver?.startsWith(kind + '<')) {
                        if (kind === 'array') {
                            if (['push', 'unshift', 'includes', 'indexof', 'lastindexof'].includes(method)) compatible(parts[0], actual[1], 'array element');
                            if (['set', 'insert'].includes(method)) compatible(parts[0], actual[2], 'array element');
                            if (['get', 'pop', 'shift', 'first', 'last'].includes(method)) return parts[0];
                        } else if (kind === 'map') {
                            if (['put', 'get', 'contains', 'remove'].includes(method)) compatible(parts[0], actual[1], 'map key');
                            if (method === 'put') compatible(parts[1], actual[2], 'map value');
                            if (['get', 'put', 'remove'].includes(method)) return parts[1];
                        } else if (kind === 'matrix') {
                            if (method === 'set') compatible(parts[0], actual[3], 'matrix element');
                            if (method === 'get') return parts[0];
                        }
                        if (['copy', 'slice'].includes(method)) return receiver;
                    }
                }
                let functions = node.callee?.type === 'Identifier' ? scope.functionsFor(node.callee.name).filter(fn => !fn.node.id?.isMethod) : [];
                if (node.callee?.type === 'MemberExpression' && !node.callee.computed) {
                    const receiver = expression(node.callee.object, scope);
                    const method = node.callee.property?.name;
                    const parts = genericParts(receiver);
                    if (receiver?.startsWith('array<')) {
                        if (['push', 'unshift', 'includes', 'indexof', 'lastindexof'].includes(method)) compatible(parts[0], actual[0], 'array element');
                        if (method === 'set') compatible(parts[0], actual[1], 'array element');
                        if (['get', 'pop', 'shift', 'first', 'last'].includes(method)) return parts[0];
                        if (['copy', 'slice'].includes(method)) return receiver;
                    }
                    if (receiver?.startsWith('map<')) {
                        if (['put', 'get', 'contains', 'remove'].includes(method)) compatible(parts[0], actual[0], 'map key');
                        if (method === 'put') compatible(parts[1], actual[1], 'map value');
                        if (['get', 'put', 'remove'].includes(method)) return parts[1];
                        if (method === 'copy') return receiver;
                    }
                    functions = scope.functionsFor(method).filter(fn => fn.node.id?.isMethod);
                    if (functions.length) {
                        const matching = functions.filter(fn => normalize((fn.node.params[0]?.left ?? fn.node.params[0])?.varType) === receiver);
                        if (matching.length) functions = matching;
                        actual.unshift(receiver);
                    }
                }
                if (functions.length) {
                    const ordinaryOverloads = functions.some(fn => fn.node._pineOverloadName);
                    const caller = functionStack.at(-1);
                    if (ordinaryOverloads && caller?.node.id.name === node.callee?.name) {
                        functions = functions.filter(fn => fn.node._pineOverloadOrdinal <= caller.node._pineOverloadOrdinal);
                    }
                    const ordered = (fn: Fn) => (fn.node.params ?? []).map((pattern: any, index: number) => actual[index] ?? namedTypes.get((pattern.left ?? pattern).name));
                    const present = (fn: Fn, index: number) => index < actual.length || namedTypes.has((fn.node.params[index].left ?? fn.node.params[index]).name);
                    const candidates = functions.filter(fn => {
                        const params = fn.node.params ?? [], args = ordered(fn);
                        if (actual.length > params.length || [...namedTypes.keys()].some(name => !params.some((pattern: any) => (pattern.left ?? pattern).name === name))) return false;
                        return params.every((pattern: any, index: number) => {
                            const declared = normalize((pattern.left ?? pattern).varType), supplied = args[index];
                            if (index < actual.length && namedTypes.has((pattern.left ?? pattern).name)) return false;
                            if (!present(fn, index)) return pattern.type === 'AssignmentPattern';
                            if (supplied === undefined && ordinaryOverloads) return true;
                            if (ordinaryOverloads && declared && supplied !== '@na') return declared === supplied || (declared === 'float' && supplied === 'int');
                            return supplied === '@na' || !declared || !(hasEnum(declared) || hasEnum(supplied)) || declared === supplied;
                        });
                    });
                    // Prefer an exact declared signature over an untyped overload.
                    const score = (fn: Fn) => ordered(fn).reduce((total: number, type: string | undefined, index: number) =>
                        total + (normalize((fn.node.params[index].left ?? fn.node.params[index]).varType) === type ? 1 : 0), 0);
                    candidates.sort((left, right) => score(right) - score(left));
                    if (ordinaryOverloads && candidates.some(fn => ordered(fn).some((type, index) => type === undefined && present(fn, index)))) {
                        unresolvedOverloads.add(node);
                        return undefined;
                    }
                    if (ordinaryOverloads && !candidates.length && (actual.some(hasEnum) || [...namedTypes.values()].some(hasEnum)
                        || functions.some(fn => fn.node.params.some((pattern: any) => hasEnum(normalize((pattern.left ?? pattern).varType))))))
                        throw new Error('Incompatible enum types in Pine function overload ' + node.callee.name + '.');
                    if (ordinaryOverloads && (!candidates.length || (candidates.length > 1 && score(candidates[0]) === score(candidates[1]))))
                        throw new Error('Cannot resolve Pine function overload ' + node.callee.name + ': incompatible or ambiguous arguments.');
                    let fn = candidates[0] ?? functions[0];
                    const args = ordered(fn);
                    if (!fn.node.id?.isMethod) ordinaryCalls.set(node, fn);
                    const originalFn = fn;
                    fn = specialize(fn, args);
                    if (ordinaryOverloads || fn !== originalFn) {
                        if (node._pineOverloadTarget && node._pineOverloadTarget !== fn.node._pineOverloadName)
                            throw new Error('Pine overload calls through untyped functions require a consistent argument signature.');
                        node._pineOverloadTarget = fn.node._pineOverloadName;
                        node._pineOverloadParams = fn.node.params.map((pattern: any) => (pattern.left ?? pattern).name);
                        unresolvedOverloads.delete(node);
                    }
                    if (fn.node.id?.isMethod && (fn.node.params ?? []).some((pattern: any) => enumType(normalize((pattern.left ?? pattern).varType)))) {
                        node._pineEnumMethodParams = fn.node.params.slice(1).map((pattern: any) => (pattern.left ?? pattern).name);
                    }
                    return functionResult(fn, args);
                }
                return undefined;
            }
            case 'ReturnStatement': return expression(node.argument, scope);
            case 'ExpressionStatement': return expression(node.expression, scope);
            case 'BlockStatement': return statements(node.body ?? [], new Env(scope));
            default:
                for (const [key, value] of Object.entries(node)) {
                    if (key === 'parent' || key.startsWith('_')) continue;
                    if (Array.isArray(value)) {
                        for (const child of value) if (child?.type) expression(child, scope);
                    } else if (value && typeof value === 'object' && (value as any).type) expression(value, scope);
                }
                return undefined;
        }
    }
    function statements(nodes: any[], scope: Env, expectedReturn?: string): string | undefined {
        for (const node of nodes) {
            if (node.type === 'FunctionDeclaration') {
                const name = node.id.name;
                scope.functions.set(name, [...(scope.functions.get(name) ?? []), { node, scope }]);
            }
        }
        for (const [name, functions] of scope.functions) {
            const ordinary = functions.filter(fn => !fn.node.id?.isMethod);
            if (ordinary.length < 2) continue;
            hasOrdinaryOverloads = true;
            const signatures = new Set<string>();
            for (let index = 0; index < ordinary.length; index++) {
                const fn = ordinary[index];
                const required = (fn.node.params ?? []).filter((pattern: any) => pattern.type !== 'AssignmentPattern');
                const signature = required.map((pattern: any) => typeof pattern.varType === 'string' ? pattern.varType.trim().replace(/\s+/g, ' ') : '?').join('|');
                if (signatures.has(signature)) throw new Error('Duplicate required Pine function overload signature for ' + name + '.');
                signatures.add(signature);
                fn.node._pineOverloadName = '$F_' + name + '$' + (index + 1);
                fn.node._pineOverloadOrdinal = index;
            }
        }
        let result: string | undefined;
        for (const node of nodes) {
            if (node.type === 'VariableDeclaration') {
                for (const declaration of node.declarations ?? []) {
                    const name = declaration.id?.name;
                    if (!name) { expression(declaration.init, scope); continue; }
                    if (declaration.init?._pineEnumName) {
                        scope.vars.set(name, { namespace: declaration.init._pineEnumName, init: declaration.init });
                        continue;
                    }
                    const actual = expression(declaration.init, scope);
                    const declared = normalize(declaration.id.varType ?? declaration.varType);
                    compatible(declared, actual, 'declaration ' + name);
                    scope.vars.set(name, { type: declared ?? actual, init: declaration.init, declaration });
                }
            } else if (node.type === 'FunctionDeclaration') {
                functionResult({ node, scope });
            } else if (node.type === 'IfStatement') {
                if (enumType(expression(node.test, scope))) throw new Error('Enum values cannot be used as boolean conditions.');
                const left = node.consequent?.type === 'BlockStatement' ? statements(node.consequent.body, new Env(scope), expectedReturn) : expression(node.consequent, new Env(scope));
                const right = node.alternate?.type === 'BlockStatement' ? statements(node.alternate.body, new Env(scope), expectedReturn) : expression(node.alternate, new Env(scope));
                result = join(left, right);
            } else if (node.type === 'BlockStatement') {
                result = statements(node.body, node._sequence ? scope : new Env(scope), expectedReturn);
            } else {
                result = expression(node, scope);
                if (node.type === 'ReturnStatement') compatible(expectedReturn, result, 'return');
            }
        }
        return result;
    }
    statements(ast.body ?? [], new Env(null));
    const checkEmitted = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'FunctionDeclaration' && node._pineSpecializations?.length) {
            node._pineSpecializations.forEach(checkEmitted);
            return;
        }
        if (unresolvedOverloads.has(node) || (ordinaryCalls.get(node)?.node._pineSpecializations?.length && !node._pineOverloadTarget))
            throw new Error('Cannot resolve Pine function overload with unknown argument types.');
        for (const [key, value] of Object.entries(node)) {
            if (key === 'parent' || key.startsWith('_')) continue;
            if (Array.isArray(value)) value.forEach(checkEmitted);
            else if (value && typeof value === 'object') checkEmitted(value);
        }
    };
    checkEmitted(ast);
    return mutated;
}


type Sym =
    | {
          kind: 'value';
          name: string;
          init: any;
          scope: Scope;
          nonConst: boolean;
          inputDerived: boolean;
          persistent: boolean;
          /** Default of the input call this variable is initialized with (`x = input.string("A")`). */
          inputDefault?: ConstValue;
          inputId?: string;
          cache?: ConstValue | null;
          busy?: boolean;
      }
    | { kind: 'loop' | 'param'; name: string };

class Scope {
    readonly vars = new Map<string, Sym>();
    constructor(readonly parent: Scope | null) {}
    resolve(name: string): Sym | undefined {
        for (let s: Scope | null = this; s; s = s.parent) {
            const sym = s.vars.get(name);
            if (sym) return sym;
        }
        return undefined;
    }
}

interface Ctx {
    scope: Scope;
    /** Variable the current expression is assigned to. */
    target: string | null;
    /** Enclosing function name. */
    fnName: string | null;
}

export function analyzeInputs(ast: any, options: AnalyzeInputsOptions = {}): InputSite[] {
    return new InputAnalyzer(ast, options).run();
}

/** `"input"` → `''`, `"input.int"` → `'int'`, anything else → null. */
export function inputFnName(call: any): string | null {
    if (call?.type !== 'CallExpression') return null;
    const name = dottedName(call.callee);
    if (name === 'input') return '';
    if (name?.startsWith('input.') && TYPED_INPUT_FNS.has(name.slice(6))) return name.slice(6);
    return null;
}

class InputAnalyzer {
    private readonly sites: InputSite[] = [];
    private readonly enums = new Map<string, unknown>();
    private readonly reassigned = new Set<string>();
    private reassignedInitializers = new WeakSet<object>();
    private readonly visited = new WeakSet<object>();
    private readonly inputDefaults = new WeakMap<object, ConstValue>();
    private readonly inputIds = new WeakMap<object, string>();
    private readonly functionNames = new Set<string>();
    private readonly truncatingIntDivision: boolean;
    private readonly version: number | null | undefined;

    constructor(
        private readonly ast: any,
        options: AnalyzeInputsOptions,
    ) {
        this.truncatingIntDivision = options.version != null && options.version < 6;
        this.version = options.version;
    }

    run(): InputSite[] {
        this.reassignedInitializers = checkEnumTypes(this.ast, this.version);
        this.collectEnumsAndReassignments(this.ast);
        const global = new Scope(null);
        this.visitStatements(this.ast.body ?? [], { scope: global, target: null, fnName: null });
        return this.sites;
    }

    // ── pre-pass ────────────────────────────────────────────────────────

    private collectEnumsAndReassignments(root: any): void {
        forEachNode(root, (node) => {
            if (node.type === 'FunctionDeclaration' && node.id?.name) this.functionNames.add(node.id.name);
            if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') {
                this.reassigned.add(node.left.name);
            }
            if (node.type === 'VariableDeclaration') {
                for (const decl of node.declarations ?? []) {
                    const init = decl?.init;
                    if (decl?.id?.type !== 'Identifier' || init?.type !== 'ObjectExpression' || !init.properties?.length) continue;
                    // pine2js lowers `enum E` to `E = { field: "title", … }` (string literals only).
                    const isEnum = init._pineEnumName === decl.id.name && init.properties.every((p: any) => p.value?.type === 'Literal' && typeof p.value.value === 'string');
                    if (!isEnum) continue;
                    for (const p of init.properties) this.enums.set(`${decl.id.name}.${p.key.name}`, `${decl.id.name}.${p.key.name}`);
                }
            }
        });
    }

    /** The parser renames a variable sharing a user function's name to `name_var`; labels use the Pine name. */
    private pineName(name: string): string {
        return name.endsWith('_var') && this.functionNames.has(name.slice(0, -4)) ? name.slice(0, -4) : name;
    }

    // ── constant environment ────────────────────────────────────────────

    /**
     * `withInputDefaults` resolves a variable initialized from an input to that
     * input's default — how TradingView evaluates `active = mode == "A"`.
     */
    private env(scope: Scope, withInputDefaults = false): ConstEnv {
        return {
            enums: this.enums,
            enumLabel: (id) => {
                const [name, member] = id.split('.');
                const declaration = scope.resolve(name);
                return declaration?.kind === 'value' && declaration.init?._pineEnumName === name
                    ? declaration.init.properties.find((property: any) => property.key?.name === member)?.value.value : undefined;
            },
            truncatingIntDivision: this.truncatingIntDivision,
            lookup: (name) => {
                const sym = scope.resolve(name);
                if (withInputDefaults && sym?.kind === 'value' && !sym.nonConst && sym.inputDefault) return sym.inputDefault;
                if (!sym || sym.kind !== 'value' || sym.nonConst || sym.busy) return undefined;
                if (sym.cache === undefined) {
                    sym.busy = true;
                    sym.cache = evalConst(sym.init, this.env(sym.scope)) ?? null;
                    sym.busy = false;
                }
                return sym.cache ?? undefined;
            },
        };
    }

    private fold(node: any, scope: Scope): ConstValue | undefined {
        return evalConst(node, this.env(scope));
    }

    /** Constant boolean value of a condition, or undefined when it depends on runtime data. */
    private foldCondition(node: any, scope: Scope): boolean | undefined {
        const cv = this.fold(node, scope);
        return cv?.type === 'bool' ? (cv.value as boolean) : undefined;
    }

    // ── declarations ────────────────────────────────────────────────────

    private declareValue(scope: Scope, name: string, init: any, varType?: string | null, persistent = false): void {
        // An explicitly `series`/`simple` variable is never folded, nor is one reassigned anywhere.
        const nonConst = Boolean(init && this.reassignedInitializers.has(init)) || /\b(series|simple)\b/.test(varType ?? '');
        scope.vars.set(name, { kind: 'value', name, init, scope, nonConst, persistent, inputDerived: containsInputCall(init) });
    }

    private declarePattern(scope: Scope, pattern: any, kind: 'loop' | 'param'): void {
        if (pattern?.type === 'Identifier') scope.vars.set(pattern.name, { kind, name: pattern.name });
        else if (pattern?.type === 'ArrayPattern') for (const el of pattern.elements ?? []) this.declarePattern(scope, el, kind);
        else if (pattern?.type === 'AssignmentPattern') this.declarePattern(scope, pattern.left, kind);
    }

    // ── traversal ───────────────────────────────────────────────────────

    private visitStatements(stmts: any[], ctx: Ctx): void {
        for (const s of stmts) this.visit(s, ctx);
    }

    private visit(node: any, ctx: Ctx): void {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const n of node) this.visit(n, ctx);
            return;
        }
        if (typeof node.type !== 'string' || this.visited.has(node)) return;
        this.visited.add(node);

        switch (node.type) {
            case 'VariableDeclaration':
                for (const decl of node.declarations ?? []) {
                    const name = decl.id?.type === 'Identifier' ? decl.id.name : null;
                    this.visit(decl.init, { ...ctx, target: name ? this.pineName(name) : ctx.target });
                    if (name) {
                        this.declareValue(ctx.scope, name, decl.init, decl.varType ?? decl.id?.varType ?? null, node.kind === 'var' || node.kind === 'varip');
                        const sym = ctx.scope.vars.get(name);
                        const inputDefault = this.inputDefaults.get(decl.init);
                        if (sym?.kind === 'value') {
                            if (inputDefault) sym.inputDefault = inputDefault;
                            sym.inputId = this.inputIds.get(decl.init);
                        }
                    }
                }
                return;

            case 'AssignmentExpression': {
                const name = node.left?.type === 'Identifier' ? node.left.name : null;
                this.visit(node.right, { ...ctx, target: name ? this.pineName(name) : ctx.target });
                if (name && containsInputCall(node.right)) {
                    const sym = ctx.scope.resolve(name);
                    if (sym?.kind === 'value') sym.inputDerived = true;
                }
                return;
            }

            case 'BlockStatement':
                // `a = 1, b = 2` on one line is lowered to a block that shares the enclosing scope.
                this.visitStatements(node.body ?? [], node._sequence ? ctx : { ...ctx, scope: new Scope(ctx.scope) });
                return;

            case 'IfStatement': {
                this.visit(node.test, ctx);
                const cond = this.foldCondition(node.test, ctx.scope);
                if (cond !== false) this.visitBranch(node.consequent, ctx);
                if (cond !== true && node.alternate) this.visitBranch(node.alternate, ctx);
                return;
            }

            case 'ConditionalExpression': {
                this.visit(node.test, ctx);
                const cond = this.foldCondition(node.test, ctx.scope);
                if (cond !== false) this.visit(node.consequent, ctx);
                if (cond !== true) this.visit(node.alternate, ctx);
                return;
            }

            case 'BinaryExpression':
            case 'LogicalExpression': {
                this.visit(node.left, ctx);
                const op = node.operator;
                if (op === '&&' || op === '||') {
                    const left = this.foldCondition(node.left, ctx.scope);
                    if (left === (op === '||')) return; // right operand never evaluated
                }
                this.visit(node.right, ctx);
                return;
            }

            case 'SwitchExpression':
                this.visitSwitch(node, ctx);
                return;

            case 'ForStatement': {
                const scope = new Scope(ctx.scope);
                const init = node.init;
                if (init?.type === 'VariableDeclaration') {
                    for (const decl of init.declarations ?? []) {
                        this.visit(decl.init, ctx);
                        this.declarePattern(scope, decl.id, 'loop');
                    }
                } else {
                    this.visit(init, ctx);
                }
                const loopCtx = { ...ctx, scope };
                this.visit(node.test, loopCtx);
                this.visit(node.update, loopCtx);
                this.visitBranch(node.body, loopCtx);
                return;
            }

            case 'FunctionDeclaration': {
                const scope = new Scope(ctx.scope);
                for (const p of node.params ?? []) this.declarePattern(scope, p, 'param');
                const fnCtx: Ctx = { scope, target: null, fnName: node.id?.name ?? null };
                this.visit(node.params, fnCtx);
                this.visitBranch(node.body, fnCtx);
                return;
            }

            case 'CallExpression': {
                const fn = inputFnName(node);
                if (fn !== null) {
                    this.recordInput(node, fn, ctx);
                    return;
                }
                this.visit(node.callee, ctx);
                this.visit(node.arguments, ctx);
                return;
            }

            default:
                this.visitChildren(node, ctx);
        }
    }

    /** Block bodies open a scope; a bare statement (`else if`) is visited as-is. */
    private visitBranch(node: any, ctx: Ctx): void {
        if (node?.type === 'BlockStatement') this.visit(node, ctx);
        else this.visit(node, { ...ctx, scope: new Scope(ctx.scope) });
    }

    private visitSwitch(node: any, ctx: Ctx): void {
        this.visit(node.discriminant, ctx);
        const subject = node.discriminant ? this.fold(node.discriminant, ctx.scope) : undefined;
        let taken = false; // a previous arm is statically selected → the rest is dead
        for (const c of node.cases ?? []) {
            let live = !taken;
            if (live && c.test) {
                this.visit(c.test, ctx);
                if (node.discriminant) {
                    const test = subject ? this.fold(c.test, ctx.scope) : undefined;
                    if (subject && test && test.type === subject.type) {
                        if (test.value === subject.value) taken = true;
                        else live = false;
                    }
                } else {
                    const cond = this.foldCondition(c.test, ctx.scope);
                    if (cond === true) taken = true;
                    else if (cond === false) live = false;
                }
            } else if (live && !c.test) {
                taken = true;
            }
            if (!live) continue;
            const armCtx = { ...ctx, scope: new Scope(ctx.scope) };
            // `statements` holds the whole arm body; `consequent` aliases its last expression.
            if (c.statements?.length) this.visitStatements(c.statements, armCtx);
            else this.visit(c.consequent, armCtx);
        }
    }

    private visitChildren(node: any, ctx: Ctx): void {
        for (const key of Object.keys(node)) {
            if (key === 'args' || key === 'type' || key.startsWith('_')) continue;
            const child = node[key];
            if (child && typeof child === 'object') this.visit(child, ctx);
        }
    }

    // ── input call sites ────────────────────────────────────────────────

    private recordInput(call: any, fn: string, ctx: Ctx): void {
        const args: any[] = call.arguments ?? [];
        const last = args[args.length - 1];
        const hasNamed = last?.type === 'ObjectExpression';
        const named: any[] = hasNamed ? (last.properties ?? []) : [];
        const positionals = hasNamed ? args.slice(0, -1) : args.slice();
        const fnName = fn === '' ? 'input' : `input.${fn}`;

        // Parameter name → argument node (named arguments win over positionals).
        const raw: Record<string, { node: any; holder: any; key: string }> = {};
        const defvalNode = positionals[0] ?? named.find((p) => p.key?.name === 'defval')?.value;
        const layout =
            fn === 'int' || fn === 'float'
                ? named.some((p) => p.key?.name === 'options') || positionals[2]?.type === 'ArrayExpression'
                    ? INT_FLOAT_OPTIONS
                    : INT_FLOAT_RANGE
                : fn === '' && isBuiltinSource(defvalNode, ctx.scope)
                  ? BARE_SOURCE_LAYOUT
                  : POSITIONAL_BY_FN[fn];
        positionals.forEach((node, i) => {
            if (i < layout.length) raw[layout[i]] = { node, holder: args, key: String(i) };
        });
        const allowed = fn === 'int' || fn === 'float' ? new Set([...INT_FLOAT_OPTIONS, ...INT_FLOAT_RANGE]) : new Set(POSITIONAL_BY_FN[fn]);
        for (const p of named) {
            if (p.type !== 'Property' || !p.key?.name) continue;
            if (!allowed.has(p.key.name)) {
                throw new Error(
                    `The "${fnName}" function does not have an argument with the name "${p.key.name}"${p.key._pos ? ` at ${p.key._pos}` : ''}`,
                );
            }
            raw[p.key.name] = { node: p.value, holder: p, key: 'value' };
        }

        this.validateArguments(call, ctx.scope, raw.active?.node);
        this.checkArgumentTypes(call, fn, raw, ctx.scope);

        const values: Record<string, unknown> = {};
        let defvalType: ConstType | undefined;
        for (const [param, { node }] of Object.entries(raw)) {
            const cv =
                node?.type === 'ArrayExpression'
                    ? undefined
                    : param === 'active'
                      ? evalConst(node, this.env(ctx.scope, true))
                      : this.fold(node, ctx.scope);
            if (param === 'defval') {
                defvalType = cv?.type;
                if (cv) this.inputDefaults.set(call, cv);
            }
            values[param] = cv ? finalizeConst(cv) : fallbackValue(node, (n) => this.fold(n, ctx.scope));
        }

        if (raw.active) values.activeCondition = this.activationCondition(raw.active.node, ctx.scope);

        this.checkDefvalConstraints(call, fn, raw, values, ctx.scope);
        if (fn === 'enum') {
            const field = this.enumField(raw.defval?.node, ctx.scope)!;
            const enumType = field.slice(0, field.lastIndexOf('.'));
            const declaration = ctx.scope.resolve(enumType);
            if (declaration?.kind !== 'value') throw new Error('Missing enum declaration.');
            values.enumType = enumType;
            values.enumVersion = 1;
            values.enumMembers = declaration.init.properties.map((property: any) => ({ id: `${enumType}.${property.key.name}`, label: property.value.value }));
        }
        if (fn === 'enum' && values.options === undefined) {
            // Without `options`, the dropdown lists every field of the defval's enum.
            const field = this.enumField(raw.defval?.node, ctx.scope);
            const prefix = field?.slice(0, field.lastIndexOf('.') + 1);
            if (prefix)
                values.options = [...this.enums].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('.')).map(([, v]) => v);
        }

        if (fn !== 'enum') this.inlineDefval(raw.defval, ctx.scope);

        const id = `in_${this.sites.length}`;
        const title = typeof values.title === 'string' ? values.title : undefined;
        const varId = ctx.target ?? undefined;
        const site: InputSite = { id, fn, name: title ?? ctx.target ?? ctx.fnName ?? UNTITLED, args: values };
        if (varId !== undefined) site.varId = varId;
        if (defvalType !== undefined) site.defvalType = defvalType;
        this.sites.push(site);
        this.inputIds.set(call, id);

        const props = [new Property(new Identifier('__inputId'), new Literal(id))];
        if (varId !== undefined) props.push(new Property(new Identifier('__varId'), new Literal(varId)));
        args.push(new ObjectExpression(props));
    }

    /**
     * Substitute a folded default when it is a plain value whose computation
     * does not depend on the chart, so the runtime returns the declared value.
     */
    private inlineDefval(entry: { node: any; holder: any; key: string } | undefined, scope: Scope): void {
        if (!entry || !entry.node || entry.node.type === 'Literal') return;
        const cv = this.fold(entry.node, scope);
        if (!cv || !cv.exact || !['int', 'float', 'bool', 'string'].includes(cv.type)) return;
        const value = finalizeConst(cv);
        const raw =
            cv.type === 'float' && typeof value === 'number' && Number.isInteger(value)
                ? `${value}.0`
                : typeof value === 'number'
                  ? String(value)
                  : null;
        entry.holder[entry.key] = new Literal(value, raw);
    }

    /** Closed expression data for settings; never execute user code on the UI thread. */
    private activationCondition(node: any, scope: Scope): unknown {
        let count = 0;
        const visiting = new Set<Sym>();
        const compile = (expr: any, current: Scope, depth: number): unknown => {
            if (++count > 64 || depth > 7) throw new Error('Input activation expression exceeds the supported settings limit.');
            const constant = this.fold(expr, current);
            if (constant) {
                const value = finalizeConst(constant);
                if (typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
                    return { kind: 'literal', value };
                }
            }
            if (expr?.type === 'Identifier') {
                const sym = current.resolve(expr.name);
                if (sym?.kind === 'value' && !sym.nonConst && !visiting.has(sym)) {
                    if (sym.inputId) return { kind: 'input', id: sym.inputId };
                    visiting.add(sym);
                    const result = compile(sym.init, sym.scope, depth + 1);
                    visiting.delete(sym);
                    return result;
                }
            }
            if (expr?.type === 'UnaryExpression' && ['!', '+', '-'].includes(expr.operator)) {
                return { kind: 'unary', operator: expr.operator, argument: compile(expr.argument, current, depth + 1) };
            }
            if (['BinaryExpression', 'LogicalExpression'].includes(expr?.type) && ['&&', '||', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%'].includes(expr.operator)) {
                return { kind: 'binary', operator: expr.operator, left: compile(expr.left, current, depth + 1), right: compile(expr.right, current, depth + 1) };
            }
            if (expr?.type === 'ConditionalExpression') {
                return { kind: 'conditional', test: compile(expr.test, current, depth + 1), consequent: compile(expr.consequent, current, depth + 1), alternate: compile(expr.alternate, current, depth + 1) };
            }
            throw new Error('Input active must use a supported constant or input-dependent boolean expression.');
        };
        return compile(node, scope, 0);
    }

    private qualifierEnv(scope: Scope, seen = new Set<Sym>()): QualifierEnv {
        return {
            lookup: (name) => {
                const sym = scope.resolve(name);
                if (!sym) return undefined;
                if (sym.kind !== 'value' || sym.nonConst || sym.inputDerived || seen.has(sym)) return null;
                const cv = this.fold({ type: 'Identifier', name }, scope);
                if (cv && ['int', 'float', 'bool', 'string'].includes(cv.type)) return { qual: 'const', type: cv.type as ValueType };
                seen.add(sym);
                const q = inferQualified(sym.init, this.qualifierEnv(sym.scope, seen));
                seen.delete(sym);
                return q ?? null;
            },
        };
    }

    /**
     * Input arguments must be constants of the parameter's type. A runtime
     * value (`bar_index`, `close * 2`, `barstate.isfirst`, `ta.sma(…)`, a
     * variable holding one) or a constant of another type (`input.int(2.5)`,
     * `input.bool(1)`, `input.color("red")`) is rejected with TradingView's
     * messages: CE10123 naming the argument and its qualified type, or — for
     * a numeric runtime defval of the bare `input()` — "Arguments of input
     * function must be of constant type".
     */
    private checkArgumentTypes(call: any, fn: string, raw: Record<string, { node: any }>, scope: Scope): void {
        const env = this.qualifierEnv(scope);
        const fnName = fn === '' ? 'input' : `input.${fn}`;
        const callPos = leftmostPos(call.callee);
        const at = (pos: string | undefined) => (pos ? ` at ${pos}` : '');
        for (const [param, { node }] of Object.entries(raw)) {
            if (!node) continue;
            if (fn === 'source' && param === 'defval') {
                if (isBuiltinSource(node, scope)) continue;
                throw new Error(
                    'Invalid value for the "defval" parameter of the "input.source" function. ' +
                        `Possible values: [open, high, low, close, hl2, hlc3, ohlc4, hlcc4].${at(callPos)}`,
                );
            }
            if (fn === 'enum') continue;
            if (param === 'defval' && node.type === 'Identifier' && node.name === 'na' && !scope.resolve('na')) {
                if (fn === '') throw new Error(`Arguments of input function must be of constant type, or "source" builtin variables.${at(callPos)}`);
                if (fn === 'bool') {
                    throw new Error(
                        `Cannot call "input.bool" with argument "defval"="na". An argument of "simple na" type was used but a "const bool"  is expected.${at(startPos(node))}`,
                    );
                }
                throw new Error(`The "defval" parameter of the "${fnName}()" function cannot accept a "na" argument.${at(startPos(node))}`);
            }
            if (param === 'options' && node.type === 'ArrayExpression') {
                this.checkOptionTypes(fnName, fn, node, env);
                continue;
            }
            const expected = expectedArgType(fn, param);
            if (!expected) continue;
            const q = inferQualified(node, env);
            if (!q) continue;
            const runtime = q.qual === 'simple' || q.qual === 'series';

            if (fn === '' && param === 'defval') {
                // The bare wrapper takes a constant of any type.
                if (!runtime) continue;
                if (q.type !== 'bool' && q.type !== 'string') {
                    // Numeric runtime defaults: a source builtin is a source input;
                    // a ternary is accepted as one too.
                    if (isBuiltinSource(node, scope) || node.type === 'ConditionalExpression') continue;
                    throw new Error(`Arguments of input function must be of constant type, or "source" builtin variables.${at(callPos)}`);
                }
            } else if (!runtime && isCompatible(q.type, expected)) {
                continue;
            }

            const isLiteral = node.type === 'Literal';
            const desc = isLiteral ? literalText(node) : describeArgument(node, q);
            throw new Error(
                `Cannot call "${fnName}" with argument "${param}"="${desc}". ` +
                    `An argument of "${isLiteral ? 'literal' : q.qual} ${q.type}" type was used but a "const ${expected}"  is expected.${at(startPos(node))}`,
            );
        }
    }

    /** `options = [1, "x"]` on a numeric input: each element must be a constant of the input's type. */
    private checkOptionTypes(fnName: string, fn: string, array: any, env: QualifierEnv): void {
        const expected = fn === 'int' ? 'int' : fn === 'float' ? 'float' : ['string', 'session', 'timeframe'].includes(fn) ? 'string' : undefined;
        if (!expected) return;
        const elements: any[] = array.elements ?? [];
        const qs = elements.map((el) => inferQualified(el, env));
        if (qs.some((q) => !q)) return;
        const ok = qs.every((q) => q!.qual !== 'simple' && q!.qual !== 'series' && isCompatible(q!.type, expected));
        if (ok) return;
        const desc = elements.map((el, i) => (el.type === 'Literal' ? literalText(el) : describeArgument(el, qs[i]!))).join(',');
        const used = elements.map((el, i) => `${el.type === 'Literal' ? 'literal' : qs[i]!.qual} ${qs[i]!.type}`).join(', ');
        const pos = startPos(array);
        throw new Error(
            `Cannot call "${fnName}" with argument "options"="${desc}". An argument of "[${used}]" type was used but a "[const ${expected}...]"  is expected.${pos ? ` at ${pos}` : ''}`,
        );
    }

    /**
     * The default must be selectable: within `minval`..`maxval`, and one of
     * `options` when given. `input.enum` fields must all come from one enum.
     */
    /** Resolve member identity before folding its display title, including constant aliases. */
    private enumField(node: any, scope: Scope, seen = new Set<Sym>()): string | null {
        if (seen.size > 256) throw new Error('Enum input alias chain exceeds the supported limit.');
        if (node?.type === 'ConditionalExpression') {
            const cond = this.foldCondition(node.test, scope);
            return cond === undefined ? null : this.enumField(cond ? node.consequent : node.alternate, scope, seen);
        }
        if (node?.type === 'Identifier') {
            const sym = scope.resolve(node.name);
            if (sym?.kind !== 'value' || sym.nonConst || sym.persistent || sym.inputDerived || seen.has(sym)) return null;
            seen.add(sym);
            const field = this.enumField(sym.init, sym.scope, seen);
            seen.delete(sym);
            return field;
        }
        const field = dottedName(node);
        if (!field || !this.enums.has(field)) return null;
        const enumName = field.slice(0, field.lastIndexOf('.'));
        const declaration = scope.resolve(enumName);
        // A local variable with the same name must not resolve as the outer enum.
        if (declaration?.kind !== 'value' || declaration.nonConst || declaration.init?.type !== 'ObjectExpression') return null;
        return declaration.init?._pineEnumName === enumName && declaration.init.properties?.some((property: any) => `${enumName}.${property.key?.name}` === field && property.value?.type === 'Literal') ? field : null;
    }

    private checkDefvalConstraints(call: any, fn: string, raw: Record<string, { node: any }>, values: Record<string, unknown>, scope: Scope): void {
        const defNode = raw.defval?.node;
        const at = (pos: string | undefined) => (pos ? ` at ${pos}` : '');
        if (fn === 'enum') {
            const fields = [defNode, ...(raw.options?.node?.type === 'ArrayExpression' ? raw.options.node.elements : [])].map((n) =>
                this.enumField(n, scope),
            );
            if (raw.options && raw.options.node?.type !== 'ArrayExpression') {
                throw new Error(`input.enum options must be a tuple of constant enum members.${at(startPos(raw.options.node))}`);
            }
            if (fields.some((f) => !f || !this.enums.has(f))) {
                throw new Error(`input.enum defval and options must be constant members of a declared enum.${at(startPos(defNode))}`);
            }
            const enumNames = new Set(fields.map((f) => f!.slice(0, f!.lastIndexOf('.'))));
            if (enumNames.size > 1) {
                throw new Error(
                    `All values passed to "input.enum()" as its "defval" or "options" must be fields of the same enum.${at(leftmostPos(call.callee))}`,
                );
            }
            if (raw.options) {
                const [def, ...options] = fields as string[];
                if (!options.includes(def))
                    throw new Error(`input's defval should be in options, but '${def}' is not in [${options.join(', ')}]${at(startPos(defNode))}`);
            }
            return;
        }
        const d = values.defval;
        if (typeof d === 'number' && (fn === 'int' || fn === 'float')) {
            const { minval, maxval } = values;
            if ((typeof minval === 'number' && d < minval) || (typeof maxval === 'number' && d > maxval)) {
                throw new Error(`Input's "defval" value must be between "minval" and "maxval"${at(startPos(defNode))}`);
            }
        }
        const options = values.options;
        if (Array.isArray(options) && raw.options?.node?.type === 'ArrayExpression' && (typeof d === 'number' || typeof d === 'string')) {
            const found = options.some((o) => (typeof o === 'number' && typeof d === 'number' ? Math.abs(o - d) < 1e-10 : o === d));
            if (!found && options.every((o) => typeof o === typeof d)) {
                const shown = typeof d === 'string' ? `'${d}'` : String(d);
                throw new Error(
                    `input's defval should be in options, but ${shown} is not in [${options.map(String).join(', ')}]${at(startPos(defNode))}`,
                );
            }
        }
    }

    /**
     * Input arguments are evaluated at compile time, in a scope where only
     * constants exist: loop counters and function parameters are undeclared
     * there (even when an outer variable has the same name), and a variable
     * holding another input's value is not a constant — except in `active`,
     * which takes an input bool (`active = showInput`).
     */
    private validateArguments(call: any, scope: Scope, activeNode?: any): void {
        const inActive = new Set<any>();
        if (activeNode) forEachNode(activeNode, (n) => inActive.add(n));
        forEachNode({ type: 'Args', list: call.arguments ?? [] }, (node, parent, key) => {
            if (node.type !== 'Identifier') return;
            if (parent?.type === 'Property' && key === 'key') return;
            if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
            const sym = scope.resolve(node.name);
            if (!sym) return;
            if (sym.kind === 'loop' || sym.kind === 'param') {
                throw new Error(`Undeclared identifier "${node.name}"${node._pos ? ` at ${node._pos}` : ''}`);
            }
            if (sym.kind === 'value' && sym.inputDerived && !inActive.has(node)) {
                const pos = leftmostPos(call.callee);
                throw new Error(`Arguments of input function must be of constant type, or "source" builtin variables.${pos ? ` at ${pos}` : ''}`);
            }
        });
    }
}

/** A reference to a built-in source series (`close`, `hl2`, …) not shadowed by a user variable. */
function isBuiltinSource(node: any, scope: Scope): boolean {
    return node?.type === 'Identifier' && SOURCE_BUILTINS.has(node.name) && !scope.resolve(node.name);
}

/** Whether a constant of type `actual` is accepted where a `const expected` is required. */
function isCompatible(actual: ValueType, expected: string): boolean {
    return actual === expected || (expected === 'float' && actual === 'int');
}

/** How TradingView prints a literal argument in type errors (`5.0` → "5", `"red"` → "red"). */
function literalText(node: any): string {
    return String(node.value);
}

/** Metadata value for an argument that does not fold as a whole: arrays fold per element. */
function fallbackValue(node: any, fold: (n: any) => ConstValue | undefined): unknown {
    if (node?.type !== 'ArrayExpression') return undefined;
    return (node.elements ?? []).map((el: any) => {
        const cv = fold(el);
        return cv ? finalizeConst(cv) : undefined;
    });
}

function containsInputCall(node: any): boolean {
    let found = false;
    forEachNode(node, (n) => {
        if (!found && inputFnName(n) !== null) found = true;
    });
    return found;
}

function leftmostPos(node: any): string | undefined {
    let n = node;
    while (n?.type === 'MemberExpression') n = n.object;
    return n?._pos;
}

/** Pre-order walk over every AST node (skipping the `args` alias of `arguments`). */
function forEachNode(root: any, visit: (node: any, parent: any, key: string) => void): void {
    const seen = new WeakSet<object>();
    const walk = (node: any, parent: any, key: string) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const n of node) walk(n, parent, key);
            return;
        }
        if (seen.has(node)) return;
        seen.add(node);
        if (typeof node.type === 'string') visit(node, parent, key);
        for (const k of Object.keys(node)) {
            if (k === 'args' || k.startsWith('_')) continue;
            const child = node[k];
            if (child && typeof child === 'object') walk(child, node, k);
        }
    };
    walk(root, null, '');
}
