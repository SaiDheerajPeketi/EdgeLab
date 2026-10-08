// EdgeLab modification, 2026-10-08: scoped static request extraction and realtime rollback groundwork.
// Original PineTS 0.11.0 source; licensed AGPL-3.0-only. Upstream notices retained below.
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * PineTS Transpiler
 *
 * What is PineTS ?
 * -----------------
 * PineTS is an open-source intermediate language designed to bridge the gap between Pine Script and JavaScript.
 * It provides a way to simulate Pine Script-like behavior in a JavaScript environment by representing Pine Script code
 * in a JavaScript-compatible format.
 *
 * Important Notes:
 * -----------------
 * 1. **Independence from Pine Script**: PineTS is not officially affiliated with, endorsed by, or associated with TradingView or Pine Script.
 *    It is an independent open-source initiative created to enable developers to replicate Pine Script indicators in JavaScript environments.
 * 2. **Purpose**: PineTS uses JavaScript syntax and semantics but should not be confused with standard JavaScript code.
 *    It acts as a representation of Pine Script logic that requires transpilation to be executed in JavaScript.
 * 3. **Open Source**: This project is developed and maintained as an open-source initiative. It is intended to serve as a tool for
 *    developers to bridge Pine Script concepts into JavaScript applications.
 *
 * What Does PineTS Transpiler Do?
 * --------------------------------
 * PineTS cannot be executed directly in a JavaScript environment. It requires transpilation into standard JavaScript to handle
 * Pine Script's unique time-series data processing. The PineTS Transpiler facilitates this process by transforming PineTS code
 * into executable JavaScript at runtime, making it possible to execute Pine Script-inspired logic in JavaScript applications.
 *
 * Key Features of the Transpiler:
 * --------------------------------
 * 1. **Context Management**: Transforms code to use a context object (`$`) for variable storage, ensuring all variables are
 *    accessed through this context to prevent scope conflicts.
 * 2. **Variable Scoping**: Renames variables based on their scope and declaration type (`const`, `let`, `var`) to avoid naming issues.
 * 3. **Function Handling**: Converts arrow functions while maintaining parameters and logic. Parameters are registered in the context
 *    to prevent accidental renaming.
 * 4. **Loop and Conditional Handling**: Adjusts loops and conditionals to ensure proper scoping and handling of variables.
 *
 * Usage:
 * -------
 * - The `transpile` function takes a JavaScript function or code string, applies transformations, and returns the transformed
 *   code or function.
 * - The transformed code uses a context object (`$`) to manage variable storage and access.
 *
 * Disclaimer:
 * -----------
 * PineTS is independently developed and is not endorsed by or affiliated with TradingView, the creators of Pine Script. All
 * trademarks and registered trademarks mentioned belong to their respective owners.
 */

import * as acorn from 'acorn';
import * as astring from 'astring';
import ScopeManager from './analysis/ScopeManager';
import { injectImplicitImports } from './transformers/InjectionTransformer';
import { normalizeNativeImports } from './transformers/NormalizationTransformer';
import { wrapInContextFunction } from './transformers/WrapperTransformer';
import { transformNestedArrowFunctions, renameParamsShadowingFunctions, preProcessContextBoundVars, preProcessUdtRegistry, runAnalysisPass } from './analysis/AnalysisPass';
import { runTypeInferencePass } from './analysis/TypeInferencePass';
import { markLazyOperands } from './analysis/LazyOperandPass';
import {
    runTransformationPass,
    transformEqualityChecks,
    transformStrictLogicalOperators,
    transformDisplayArithmetic,
    propagateAsyncAwait,
} from './transformers/MainTransformer';
import { extractPineScriptVersion, pineToJS } from './pineToJS/pineToJS.index';
import { buildLtfSlices } from './slicing/buildLtfSlices';

/**
 * Resolve the input into PineTS code plus the Pine Script version it came from.
 * `version` is null for PineTS-syntax / function input (no //@version marker):
 * such code is JavaScript-like and follows JS semantics, not a Pine version.
 */
function getPineTSFromSource(source: string | Function): { code: string; version: number | null } {
    if (typeof source === 'function') {
        return { code: source.toString(), version: null };
    } else {
        const pineScriptVersion = extractPineScriptVersion(source);
        if (pineScriptVersion === null) {
            //assume it's PineTS syntax ==> use it as is
            return { code: source, version: null };
        }
        if (pineScriptVersion >= 5) {
            //assume it's Pine Script syntax ==> use pineToJS to transpile it
            const pineToJSResult = pineToJS(source);
            if (pineToJSResult.success) {
                return { code: pineToJSResult.code, version: pineScriptVersion };
            } else {
                throw new Error(`Failed to transpile Pine Script version ${pineScriptVersion}: ${pineToJSResult.error}`);
            }
        } else {
            throw new Error(`Unsupported Pine Script version ${pineScriptVersion}. Only version 5 and above are supported.`);
        }
    }
}

/** Extract only static request calculations, never an entire conditional wrapper.
 * The clean compiler AST still distinguishes local declarations and function
 * parameters. Generated helper calls run once per chart execution; the original
 * function clone receives their results and keeps its own activation/history.
 */
function extractStaticWrappedRequests(ast: any, version: number): void {
    const root = ast.body?.[0]?.expression ?? ast.body?.[0];
    const body = root?.body?.body;
    if (!Array.isArray(body)) return;
    const functions = new Map<string, any>();
    const metadata = new Map<string, any[]>();
    const names = new Set<string>();
    let visits = 0, serial = 0, generated = 0;
    const fail = (detail: string): never => { throw new Error(`Unsupported static wrapped request: ${detail}`); };
    const children = (node: any, visit: (value: any) => void) => {
        if (++visits > 100000) fail('compiler traversal exceeds its bounded state.');
        for (const key of Object.keys(node ?? {})) {
            if (key === 'parent' || key.startsWith('_')) continue;
            const value = node[key];
            if (Array.isArray(value)) value.forEach(item => item?.type && visit(item));
            else if (value?.type) visit(value);
        }
    };
    const walk = (node: any, visit: (value: any) => void) => {
        if (!node?.type) return;
        if (++visits > 100000) fail('compiler traversal exceeds its bounded state.');
        visit(node); children(node, value => walk(value, visit));
    };
    walk(root, node => { if (node.type === 'Identifier') names.add(node.name); });
    for (const statement of body) {
        if (statement.type === 'FunctionDeclaration') functions.set(statement.id.name, statement);
        const assignment = statement.type === 'ExpressionStatement' && statement.expression;
        if (assignment?.type === 'AssignmentExpression' && assignment.left?.type === 'MemberExpression' &&
            assignment.left.object?.type === 'Identifier') {
            const name = assignment.left.object.name;
            const list = metadata.get(name) ?? []; list.push(statement); metadata.set(name, list);
        }
    }
    const clone = (node: any, depth = 0): any => {
        if (!node || typeof node !== 'object') return node;
        if (++visits > 100000 || depth > 256) fail('compiler dependency copying exceeds its bounded state.');
        if (Array.isArray(node)) return node.map(value => clone(value, depth + 1));
        const result: any = {};
        for (const key of Object.keys(node)) if (key !== 'parent') result[key] = clone(node[key], depth + 1);
        return result;
    };
    const fresh = () => {
        let name: string; do { name = `$E_request${serial++}`; } while (names.has(name));
        if (serial > 4096) fail('compiler generated more than 4096 dependency identifiers.');
        names.add(name); return name;
    };
    const freshFunction = () => {
        if (++generated > 256) fail('more than 256 generated calculation/activation functions.');
        return fresh();
    };
    const identifier = (name: string) => ({ type: 'Identifier', name });
    const declaration = (name: string, init: any) => ({ type: 'VariableDeclaration', kind: 'let',
        declarations: [{ type: 'VariableDeclarator', id: identifier(name), init }] });
    const isRequest = (node: any) => node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression' &&
        !node.callee.computed && node.callee.object?.name === 'request' && ['security', 'security_lower_tf'].includes(node.callee.property?.name);
    const called = (node: any) => node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && functions.has(node.callee.name) ? node.callee.name : undefined;
    const contains = new Map<string, boolean>();
    const edges = new Map<string, Set<string>>();
    for (const [name, fn] of functions) {
        const dependencies = new Set<string>(); let found = false;
        const inspect = (node: any) => {
            if (node.type === 'FunctionDeclaration') return;
            if (isRequest(node)) found = true;
            const callee = called(node); if (callee) dependencies.add(callee);
            children(node, inspect);
        };
        inspect(fn.body); contains.set(name, found); edges.set(name, dependencies);
    }
    const propagate = (values: Map<string, boolean>) => {
        let changed = true;
        while (changed) {
            changed = false;
            for (const [name, dependencies] of edges) if (!values.get(name)) for (const dependency of dependencies) {
                if (++visits > 100000) fail('compiler function dependency graph exceeds its bounded state.');
                if (values.get(dependency)) { values.set(name, true); changed = true; break; }
            }
        }
    };
    propagate(contains);
    const hasRequests = (name: string): boolean => contains.get(name) ?? false;
    const globalInitializers = new Map<string, any>();
    const reassignedGlobals = new Set<string>();
    for (const statement of body) {
        if (statement.type === 'VariableDeclaration') for (const item of statement.declarations)
            if (item.id.type === 'Identifier') globalInitializers.set(item.id.name, item.init);
        if (statement.type !== 'FunctionDeclaration') walk(statement, node => {
            if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier') reassignedGlobals.add(node.left.name);
            if (node.type === 'UpdateExpression' && node.argument?.type === 'Identifier') reassignedGlobals.add(node.argument.name);
        });
    }
    const booleanValue = (node: any, active = new Set<string>()): boolean | undefined => {
        if (node?.type === 'Literal' && typeof node.value === 'boolean') return node.value;
        if (node?.type === 'Identifier' && globalInitializers.has(node.name) && !reassignedGlobals.has(node.name) && !active.has(node.name))
            return booleanValue(globalInitializers.get(node.name), new Set(active).add(node.name));
        if (node?.type === 'UnaryExpression' && node.operator === '!') { const value = booleanValue(node.argument, active); return value === undefined ? undefined : !value; }
        if (node?.type === 'LogicalExpression') {
            const left = booleanValue(node.left, active), right = booleanValue(node.right, active);
            return left === undefined || right === undefined ? undefined : node.operator === '&&' ? left && right : left || right;
        }
        return undefined;
    };
    const directive = body.find((statement: any) => statement.type === 'ExpressionStatement' &&
        statement.expression?.type === 'CallExpression' && ['indicator', 'strategy'].includes(statement.expression.callee?.name));
    const flag = directive?.expression.arguments?.flatMap((argument: any) => argument.type === 'ObjectExpression' ? argument.properties : [])
        .find((property: any) => (property.key.name ?? property.key.value) === 'dynamic_requests');
    const dynamic = flag ? booleanValue(flag.value) : version >= 6;
    if (dynamic === true) return;
    const childIsLocal = (node: any, key: string, local: boolean): boolean => {
        if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') return key === 'test' ? local : true;
        if (node.type === 'LogicalExpression') return local || version >= 6 && key === 'right';
        if (node.type === 'SwitchStatement') return key === 'discriminant' ? local : true;
        return local || ['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type);
    };
    const localRequests = new Map<string, boolean>();
    for (const [name, fn] of functions) {
        let found = false;
        const inspect = (node: any, local = false) => {
            if (++visits > 100000) fail('compiler traversal exceeds its bounded state.');
            if (node.type === 'FunctionDeclaration') return;
            const callee = called(node);
            if (local && (isRequest(node) || callee && hasRequests(callee))) found = true;
            for (const key of Object.keys(node)) {
                if (key === 'parent' || key.startsWith('_')) continue;
                const value = node[key], nextLocal = childIsLocal(node, key, local);
                if (Array.isArray(value)) value.forEach(child => child?.type && inspect(child, nextLocal));
                else if (value?.type) inspect(value, nextLocal);
            }
        };
        inspect(fn.body); localRequests.set(name, found);
    }
    propagate(localRequests);
    const functionHasLocalRequest = (name: string): boolean => localRequests.get(name) ?? false;
    for (const fn of functions.values()) {
        const inspect = (node: any, local = false) => {
            if (++visits > 100000) fail('compiler traversal exceeds its bounded state.');
            if (node.type === 'FunctionDeclaration') return;
            if (isRequest(node) && local) throw new Error('Static request calls cannot execute directly in conditional or loop scopes.');
            for (const key of Object.keys(node)) {
                if (key === 'parent' || key.startsWith('_')) continue;
                const value = node[key], nextLocal = childIsLocal(node, key, local);
                if (Array.isArray(value)) value.forEach(child => child?.type && inspect(child, nextLocal));
                else if (value?.type) inspect(value, nextLocal);
            }
        };
        inspect(fn.body);
    }
    const copiedMetadata = (from: string, to: string) => (metadata.get(from) ?? []).map(statement => {
        const result = clone(statement); result.expression.left.object.name = to; return result;
    });
    const formalName = (parameter: any) => parameter.type === 'AssignmentPattern' ? parameter.left.name : parameter.name;
    const references = (node: any, visit: (name: string) => void) => {
        const inspect = (value: any, parent?: any, key?: string) => {
            if (!value?.type) return;
            if (++visits > 100000) fail('compiler dependency scanning exceeds its bounded state.');
            if (value.type === 'Identifier' && !(parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) &&
                !(parent?.type === 'Property' && key === 'key' && !parent.computed)) visit(value.name);
            for (const childKey of Object.keys(value)) {
                if (childKey === 'parent' || childKey.startsWith('_')) continue;
                const child = value[childKey];
                if (Array.isArray(child)) child.forEach(item => inspect(item, value, childKey));
                else if (child?.type) inspect(child, value, childKey);
            }
        };
        inspect(node);
    };
    // Keep lexical environment links out of emitted AST. A formal that has the
    // same name as its caller's global resolves in the caller, not recursively
    // against itself. Only context arguments need a simple qualifier proof.
    type ContextBinding = { value: any; environment: Map<string, ContextBinding>; mutable?: boolean };
    const globalContext = new Map<string, ContextBinding>();
    for (const [name, value] of globalInitializers) globalContext.set(name,
        { value, environment: globalContext, mutable: reassignedGlobals.has(name) });
    const pureMath = new Set(['abs', 'acos', 'asin', 'atan', 'avg', 'ceil', 'cos', 'exp', 'floor', 'log', 'log10',
        'max', 'min', 'pow', 'round', 'round_to_mintick', 'sign', 'sin', 'sqrt', 'tan', 'todegrees', 'toradians']);
    const proveContext = (value: any, environment: Map<string, ContextBinding>, active = new Set<ContextBinding>(), depth = 0): boolean => {
        if (++visits > 100000 || depth > 64) fail('compiler context dependency proof exceeds its bounded state.');
        if (value?.type === 'Literal') return ['string', 'number', 'boolean'].includes(typeof value.value);
        if (value?.type === 'Identifier') {
            const binding = environment.get(value.name);
            return !!binding && !binding.mutable && !active.has(binding) && proveContext(binding.value, binding.environment,
                new Set(active).add(binding), depth + 1);
        }
        if (value?.type === 'MemberExpression' && !value.computed)
            return ['syminfo', 'timeframe', 'barmerge', 'currency'].includes(value.object?.name);
        const simple = (node: any) => proveContext(node, environment, active, depth + 1);
        if (value?.type === 'UnaryExpression') return simple(value.argument);
        if (['BinaryExpression', 'LogicalExpression'].includes(value?.type)) return simple(value.left) && simple(value.right);
        if (value?.type === 'ConditionalExpression') return simple(value.test) && simple(value.consequent) && simple(value.alternate);
        if (value?.type === 'CallExpression' && value.callee?.type === 'MemberExpression' && !value.callee.computed) {
            const namespace = value.callee.object?.name, member = value.callee.property?.name;
            if (namespace === 'input') return member !== 'source';
            if (namespace === 'math' && !pureMath.has(member)) return false;
            if (['str', 'math', 'ticker'].includes(namespace)) return value.arguments.every(simple);
        }
        return false;
    };
    const validateContexts = (name: string, actuals: any[], outer = globalContext, depth = 0) => {
        if (depth >= 8) return; // Deeper call isolation retains its existing runtime refusal.
        const fn = functions.get(name), environment = new Map(outer);
        fn.params.forEach((parameter: any, index: number) => environment.set(formalName(parameter), {
            value: actuals[index] && !(actuals[index].type === 'Identifier' && actuals[index].name === 'undefined') ? actuals[index] :
                (parameter.type === 'AssignmentPattern' ? parameter.right : identifier('undefined')),
            environment: outer,
        }));
        walk(fn.body, node => {
            if (node.type === 'VariableDeclaration') for (const item of node.declarations)
                if (item.id.type === 'Identifier') environment.set(item.id.name, { value: item.init, environment,
                    mutable: node.kind === 'var' || node.kind === 'varip' });
        });
        walk(fn.body, node => {
            const mutated = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' ? node.argument : undefined;
            if (mutated?.type === 'Identifier') {
                const binding = environment.get(mutated.name); if (binding) environment.set(mutated.name, { ...binding, mutable: true });
            }
            if (isRequest(node)) {
                const bag = node.arguments.find((argument: any) => argument.type === 'ObjectExpression');
                const argument = (slot: string, index: number) => bag?.properties.find((property: any) =>
                    (property.key.name ?? property.key.value) === slot)?.value ?? node.arguments[index];
                if (!proveContext(argument('symbol', 0), environment) || !proveContext(argument('timeframe', 1), environment))
                    fail('the symbol and timeframe dependencies cannot be proved simple/input/constant.');
            }
            const callee = called(node);
            if (callee && hasRequests(callee)) validateContexts(callee, node.arguments, environment, depth + 1);
        });
    };
    const completeArguments = (call: any, fn: any) => {
        fn.params.forEach((parameter: any, index: number) => {
            const argument = call.arguments[index];
            if (!argument || argument.type === 'Identifier' && argument.name === 'undefined')
                call.arguments[index] = parameter.type === 'AssignmentPattern' ? clone(parameter.right) : identifier('undefined');
        });
    };
    const additions: any[] = [];
    const specialize = (name: string, actuals: any[], resolveOuter: (value: any) => any, forbidden: Set<string>, depth: number): any => {
        if (depth > 8) fail('function request paths exceed eight levels.');
        const original = functions.get(name), copied = clone(original), copiedName = freshFunction();
        copied.id.name = copiedName;
        const params = new Map<string, any>();
        original.params.forEach((parameter: any, index: number) => params.set(formalName(parameter),
            actuals[index] && !(actuals[index].type === 'Identifier' && actuals[index].name === 'undefined') ? actuals[index] :
                (parameter.type === 'AssignmentPattern' ? parameter.right : identifier('undefined'))));
        const declarations = new Map<string, any>(), mutable = new Set<string>(), unsupported = new Set<string>();
        walk(original.body, node => {
            if (node.type === 'VariableDeclaration') for (const item of node.declarations) {
                if (item.id.type !== 'Identifier') { references(item.id, reference => unsupported.add(reference)); continue; }
                if (declarations.has(item.id.name) || params.has(item.id.name)) unsupported.add(item.id.name);
                declarations.set(item.id.name, { declaration: node, item });
                if (node.kind === 'var' || node.kind === 'varip') mutable.add(item.id.name);
            }
            if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') mutable.add(node.left.name);
            if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') mutable.add(node.argument.name);
        });
        const resolve = (node: any, active = new Set<string>(), depth = 0): any => {
            if (++visits > 100000 || depth > 64) fail('compiler dependency resolution exceeds its bounded state.');
            if (node?.type === 'Identifier') {
                if (active.has(node.name)) fail('cyclic local expression dependencies.');
                if (unsupported.has(node.name)) fail('tuple or shadowed local expression dependencies cannot be isolated.');
                if (params.has(node.name)) return resolveOuter(params.get(node.name));
                if (declarations.has(node.name)) {
                    if (mutable.has(node.name)) fail('a requested calculation depends on mutable wrapper-local state.');
                    return resolve(declarations.get(node.name).item.init, new Set(active).add(node.name), depth + 1);
                }
                if (forbidden.has(node.name)) fail('a requested calculation depends on local control-flow or loop variables.');
            }
            if (!node || typeof node !== 'object') return node;
            if (Array.isArray(node)) return node.map(value => resolve(value, active, depth + 1));
            const result: any = {};
            for (const key of Object.keys(node)) {
                if (key === 'parent') continue;
                // Noncomputed property names are labels, not lexical references.
                result[key] = (node.type === 'MemberExpression' && key === 'property' && !node.computed ||
                    node.type === 'Property' && key === 'key' && !node.computed) ? clone(node[key]) : resolve(node[key], active, depth + 1);
            }
            return result;
        };
        const lifted: any[] = [], hidden: string[] = [];
        const replace = (node: any): any => {
            if (!node?.type) return node;
            if (isRequest(node)) {
                // Resolving only request dependencies leaves unused side-effectful
                // wrapper arguments under their original call-site predicate.
                const required = new Set<string>();
                const depend = (value: any) => references(value, reference => {
                    if (unsupported.has(reference)) fail('tuple or shadowed local expression dependencies cannot be isolated.');
                    if (!declarations.has(reference) || required.has(reference)) return;
                    if (mutable.has(reference)) fail('a requested calculation depends on mutable wrapper-local state.');
                    required.add(reference); depend(declarations.get(reference).item.init);
                });
                depend(node);
                const requestValue = (value: any, depth = 0): any => {
                    if (++visits > 100000 || depth > 64) fail('compiler request dependency resolution exceeds its bounded state.');
                    if (value?.type === 'Identifier' && required.has(value.name)) return clone(value);
                    if (!value || typeof value !== 'object') return value;
                    if (Array.isArray(value)) return value.map(item => requestValue(item, depth + 1));
                    if (value.type === 'Identifier') return resolve(value);
                    const result: any = {};
                    for (const key of Object.keys(value)) if (key !== 'parent') result[key] =
                        (value.type === 'MemberExpression' && key === 'property' && !value.computed ||
                            value.type === 'Property' && key === 'key' && !value.computed) ? clone(value[key]) : requestValue(value[key], depth + 1);
                    return result;
                };
                const helperName = freshFunction(), resultName = fresh(), parameter = fresh();
                const dependencies: any[] = [];
                for (const [reference, entry] of declarations) if (required.has(reference))
                    dependencies.push({ ...clone(entry.declaration), declarations: [{ ...clone(entry.item), init: requestValue(entry.item.init) }] });
                const extracted = requestValue(node);
                const simpleContext = (value: any, active = new Set<string>()): boolean => {
                    if (value?.type === 'Literal') return ['string', 'number', 'boolean'].includes(typeof value.value);
                    if (value?.type === 'Identifier') {
                        if (active.has(value.name)) return false;
                        const next = new Set(active).add(value.name);
                        if (required.has(value.name)) return simpleContext(requestValue(declarations.get(value.name).item.init), next);
                        return globalInitializers.has(value.name) && !reassignedGlobals.has(value.name) &&
                            simpleContext(globalInitializers.get(value.name), next);
                    }
                    if (value?.type === 'MemberExpression' && !value.computed)
                        return ['syminfo', 'timeframe', 'barmerge', 'currency'].includes(value.object?.name);
                    if (value?.type === 'UnaryExpression') return simpleContext(value.argument, active);
                    if (['BinaryExpression', 'LogicalExpression'].includes(value?.type))
                        return simpleContext(value.left, active) && simpleContext(value.right, active);
                    if (value?.type === 'ConditionalExpression') return simpleContext(value.test, active) &&
                        simpleContext(value.consequent, active) && simpleContext(value.alternate, active);
                    if (value?.type === 'CallExpression' && value.callee?.type === 'MemberExpression' && !value.callee.computed) {
                        const namespace = value.callee.object?.name, member = value.callee.property?.name;
                        if (namespace === 'input') return member !== 'source';
                        const pureMath = ['abs', 'acos', 'asin', 'atan', 'avg', 'ceil', 'cos', 'exp', 'floor', 'log', 'log10', 'max', 'min',
                            'pow', 'round', 'round_to_mintick', 'sign', 'sin', 'sqrt', 'tan', 'todegrees', 'toradians'];
                        if (namespace === 'math' && !pureMath.includes(member)) return false;
                        if (['str', 'math', 'ticker'].includes(namespace)) return value.arguments.every((argument: any) => simpleContext(argument, active));
                    }
                    return false;
                };
                const bag = extracted.arguments.find((argument: any) => argument.type === 'ObjectExpression');
                const contextArgument = (slot: string, index: number) =>
                    bag?.properties.find((property: any) => (property.key.name ?? property.key.value) === slot)?.value ?? extracted.arguments[index];
                if (!simpleContext(contextArgument('symbol', 0)) || !simpleContext(contextArgument('timeframe', 1)))
                    fail('the symbol and timeframe dependencies cannot be proved simple/input/constant.');
                additions.push({ type: 'FunctionDeclaration', id: identifier(helperName), params: [],
                    body: { type: 'BlockStatement', body: [...dependencies, { type: 'ReturnStatement', argument: extracted }] },
                    generator: false, async: false });
                lifted.push(declaration(resultName, { type: 'CallExpression', callee: identifier(helperName), arguments: [] }));
                hidden.push(parameter);
                const expressionBag = node.arguments.find((argument: any) => argument.type === 'ObjectExpression');
                const expression = expressionBag?.properties.find((property: any) => (property.key.name ?? property.key.value) === 'expression')?.value ?? node.arguments[2];
                if (expression?.type === 'ArrayExpression') return { type: 'CallExpression', _transformed: true,
                    callee: { type: 'MemberExpression', object: identifier('$'), property: identifier('toTuple'), computed: false },
                    arguments: [{ type: 'CallExpression', _transformed: true,
                        callee: { type: 'MemberExpression', object: identifier('$'), property: identifier('get'), computed: false },
                        arguments: [{ ...identifier(parameter), _skipTransformation: true, _arrayAccessed: true }, { type: 'Literal', value: 0 }] },
                        { type: 'Literal', value: expression.elements.length }] };
                return identifier(parameter);
            }
            const callee = called(node);
            if (callee && hasRequests(callee)) {
                const nested = specialize(callee, node.arguments, resolve, forbidden, depth + 1);
                lifted.push(...nested.lifted);
                const result = clone(node); result.callee.name = nested.name;
                completeArguments(result, functions.get(callee));
                for (const value of nested.results) { const parameter = fresh(); hidden.push(parameter); result.arguments.push(identifier(parameter)); }
                return result;
            }
            const result = { ...node };
            for (const key of Object.keys(result)) {
                if (key === 'parent' || key.startsWith('_')) continue;
                if (Array.isArray(result[key])) result[key] = result[key].map(value => value?.type ? replace(value) : value);
                else if (result[key]?.type) result[key] = replace(result[key]);
            }
            return result;
        };
        copied.body = replace(copied.body);
        copied.params.push(...hidden.map(identifier));
        additions.push(copied, ...copiedMetadata(name, copiedName));
        return { name: copiedName, lifted, results: lifted.map(statement => identifier(statement.declarations[0].id.name)) };
    };
    const rewritten: any[] = [];
    for (const statement of body) {
        if (statement.type === 'FunctionDeclaration') { rewritten.push(statement); continue; }
        const additionStart = additions.length;
        const lifted: any[] = [], forbidden = new Set<string>();
        walk(statement, node => { if (node.type === 'VariableDeclarator') references(node.id, name => forbidden.add(name)); });
        const process = (node: any, local = false): any => {
            if (!node?.type) return node;
            if (++visits > 100000) fail('compiler traversal exceeds its bounded state.');
            if (isRequest(node) && local) throw new Error('Static request calls cannot execute directly in conditional or loop scopes.');
            const callee = called(node);
            if (callee && hasRequests(callee) && dynamic === false) validateContexts(callee, node.arguments);
            if (callee && hasRequests(callee) && (local || functionHasLocalRequest(callee))) {
                if (dynamic === undefined) fail('dynamic_requests cannot be resolved to a constant boolean.');
                if (version >= 6) throw new Error('Pine v6 requires dynamic_requests=true for wrapped request calls in conditional or loop scopes.');
                const specialization = specialize(callee, node.arguments, value => {
                    references(value, reference => { if (forbidden.has(reference))
                        fail('a requested calculation depends on local control-flow or loop variables.'); });
                    return clone(value);
                }, forbidden, 1);
                lifted.push(...specialization.lifted);
                const result = clone(node); result.callee.name = specialization.name;
                completeArguments(result, functions.get(callee));
                result.arguments.push(...specialization.results); return result;
            }
            const result = { ...node };
            for (const key of Object.keys(result)) {
                if (key === 'parent' || key.startsWith('_')) continue;
                if (Array.isArray(result[key])) result[key] = result[key].map(value => value?.type ? process(value, childIsLocal(node, key, local)) : value);
                else if (result[key]?.type) result[key] = process(result[key], childIsLocal(node, key, local));
            }
            return result;
        };
        const result = process(statement);
        rewritten.push(...additions.slice(additionStart), ...lifted, result);
    }
    root.body.body = rewritten;
}

export function transpile(source: string | Function, options: { debug: boolean; ln?: boolean } = { debug: false, ln: false }): Function {
    // Handle backward compatibility if a boolean is passed (though signature changed)
    if (typeof options === 'boolean') {
        options = { debug: options, ln: true };
    }

    const { debug } = options;

    const { code: sourceCode, version: pineVersion } = getPineTSFromSource(source);
    let code = sourceCode;

    // Pre-process: Wrap in context function if not already wrapped
    code = wrapInContextFunction(code);

    const sourceLines = debug ? code.split('\n') : [];

    // Parse the code into an AST
    const intrabarComments: Array<{ name: string; end: number }> = [];
    const ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: debug,
        onComment: (block: boolean, text: string, _start: number, end: number) => {
            if (pineVersion !== null && block && text.startsWith('__pineVarip:'))
                intrabarComments.push({ name: text.slice(12), end });
        },
    });

    // Compiler comments cannot be produced by authored Pine string expressions.
    // Pine comments are discarded by pineToJS; JS/function inputs do not use this metadata.
    const preserveIntrabarDeclarations = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'VariableDeclaration' && intrabarComments.some(marker =>
            marker.name === node.declarations?.[0]?.id?.name && marker.end <= node.start &&
            /^\s*$/.test(code.slice(marker.end, node.start)))) node.kind = 'varip';
        for (const [key, child] of Object.entries(node)) {
            if (key === 'parent') continue;
            if (Array.isArray(child)) child.forEach(preserveIntrabarDeclarations);
            else if (child && typeof child === 'object') preserveIntrabarDeclarations(child);
        }
    };
    preserveIntrabarDeclarations(ast);
    if (pineVersion !== null) extractStaticWrappedRequests(ast, pineVersion);

    // Pre-process: Transform all nested arrow functions
    transformNestedArrowFunctions(ast);

    // Pre-process: a parameter named like a user function must not shadow the function
    renameParamsShadowingFunctions(ast);

    // Pre-process: Normalize native imports (prevent renaming of standard symbols)
    normalizeNativeImports(ast);

    // Pre-process: Inject implicit imports for missing context variables
    injectImplicitImports(ast);

    const scopeManager = new ScopeManager();

    // Pre-process: Identify context-bound variables
    preProcessContextBoundVars(ast, scopeManager);

    // Pre-process: Build the UDT registry (type names + their field maps,
    // and user variables that hold UDT instances). Enables type-aware
    // rewrites at use sites — e.g. distinguishing Pine series-lookback
    // (`bar.field[N]` on a UDT instance) from JS array indexing.
    // Expose the upstream declaration shape while it builds type/field registries.
    // Only our canonical Pine-generated metadata form is normalized. Function/JS
    // input and authored one-argument Type calls retain their original arity.
    const metadataTypeCalls = new Map<any, any[]>();
    const prepareTypeRegistry = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (pineVersion !== null && node.type === 'VariableDeclaration' && node.kind === 'const') {
            for (const declaration of node.declarations) {
                const call = declaration.init;
                if (declaration.id?.type !== 'Identifier' || call?.type !== 'CallExpression' ||
                    call.callee?.type !== 'Identifier' || call.callee.name !== 'Type' || call.arguments?.length !== 3 ||
                    call.arguments[0]?.type !== 'ObjectExpression' || call.arguments[1]?.type !== 'Identifier' ||
                    call.arguments[1].name !== 'undefined' || call.arguments[2]?.type !== 'Literal' ||
                    typeof call.arguments[2].value !== 'string') continue;
                let fields: any;
                try { fields = JSON.parse(call.arguments[2].value); } catch { continue; }
                const declared = call.arguments[0].properties.map((property: any) => property.key?.name);
                if (!Array.isArray(fields) || JSON.stringify(fields) !== call.arguments[2].value ||
                    !fields.every(field => typeof field === 'string' && declared.includes(field))) continue;
                metadataTypeCalls.set(call, call.arguments);
                call.arguments = [call.arguments[0]];
            }
        }
        for (const [key, child] of Object.entries(node)) {
            if (key === 'parent') continue;
            if (Array.isArray(child)) child.forEach(prepareTypeRegistry);
            else if (child && typeof child === 'object') prepareTypeRegistry(child);
        }
    };
    prepareTypeRegistry(ast);
    preProcessUdtRegistry(ast, scopeManager);
    for (const [call, argumentsBeforeRegistry] of metadataTypeCalls) {
        const typeName = call._udtName;
        call.arguments = [argumentsBeforeRegistry[0],
            typeof typeName === 'string' ? { type: 'Literal', value: typeName, raw: JSON.stringify(typeName) } : argumentsBeforeRegistry[1],
            argumentsBeforeRegistry[2]];
        // Runtime name already occupies its proper slot; do not append it again.
        delete call._udtName;
    }

    // Identify Pine object-history receivers on the clean, typed AST. Only these
    // field chains need the value-receiver traversal; JavaScript array indexing
    // and unrelated built-in receivers retain the upstream argument traversal.
    // Pine v6 additionally rejects direct field history (`object.field[N]`),
    // while v5 retains that compatibility path.
    if (pineVersion !== null) {
        const receiverType = (node: any, parameters: Map<string, string | undefined>): string | undefined => {
            if (node?.type === 'Identifier') {
                return parameters.has(node.name) ? parameters.get(node.name) : scopeManager.getVariableUdtType(node.name);
            }
            if (node?.type === 'MemberExpression') {
                if (node.computed) return receiverType(node.object, parameters);
                const type = receiverType(node.object, parameters);
                return type && node.property?.type === 'Identifier'
                    ? scopeManager.getUdtTypeFields(type)?.[node.property.name] : undefined;
            }
            if (node?.type === 'CallExpression') {
                const callee = node.callee;
                if (callee?.type === 'Identifier') return scopeManager.getFunctionReturnType(callee.name);
                if (callee?.type === 'MemberExpression' && !callee.computed && callee.object?.type === 'Identifier' &&
                    scopeManager.isUdtTypeName(callee.object.name) && ['new', 'copy'].includes(callee.property?.name)) {
                    return callee.object.name;
                }
                if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.name === 'copy') {
                    const type = receiverType(callee.object, parameters);
                    if (type && scopeManager.isUdtTypeName(type)) return type;
                }
            }
            return undefined;
        };
        const inspectObjectHistory = (node: any, parameters = new Map<string, string | undefined>()) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'FunctionDeclaration') {
                parameters = new Map(parameters);
                const name = node.id?.name?.replace(/^\$M_/, '');
                const typed = scopeManager.getFunctionParamUdtTypes(name) || {};
                const receiver = scopeManager.getMethodReceiverType(name);
                for (const [index, parameter] of (node.params || []).entries()) {
                    if (parameter.type === 'Identifier') {
                        const type = typed[parameter.name] || (index === 0 && receiver && scopeManager.isUdtTypeName(receiver) ? receiver : undefined);
                        parameters.set(parameter.name, type);
                    }
                }
            }
            if (node.type === 'MemberExpression' && !node.computed) {
                let receiver = node.object;
                while (receiver?.type === 'MemberExpression') {
                    const type = receiver.computed && receiverType(receiver.object, parameters);
                    if (type && scopeManager.isUdtTypeName(type)) {
                        node._pineObjectHistory = true;
                        break;
                    }
                    receiver = receiver.object;
                }
            }
            if (pineVersion >= 6 && node.type === 'MemberExpression' && node.computed && node.object?.type === 'MemberExpression' &&
                !node.object.computed && node.object.property?.type === 'Identifier') {
                const type = receiverType(node.object.object, parameters);
                const fields = type && scopeManager.getUdtTypeFields(type);
                if (fields && Object.prototype.hasOwnProperty.call(fields, node.object.property.name)) {
                    throw new Error('Pine v6 cannot reference UDT field history directly; use (object[offset]).field.');
                }
            }
            for (const [key, child] of Object.entries(node)) {
                if (key === 'parent') continue;
                if (Array.isArray(child)) child.forEach(value => inspectObjectHistory(value, parameters));
                else if (child && typeof child === 'object') inspectObjectHistory(child, parameters);
            }
        };
        inspectObjectHistory(ast);
    }

    // First pass: register all function declarations and their parameters
    // Returns the original parameter name of the root function if any
    const originalParamName = runAnalysisPass(ast, scopeManager) || '';

    // Type inference: replicate Pine v5 `const int / const int → int` truncation.
    // Runs on the clean pre-lowering AST (operands still bare identifiers /
    // literals) and rewrites provably-const-int `/` to `$.pine.math.__idiv(...)`;
    // the main pass below then lowers the operand subtrees inside the call args.
    //
    // Version-gated: only Pine v5 truncates, and only when BOTH operands are
    // 'const'-qualified ints. Pine v6+ always performs fractional division
    // (see TradingView's v6 migration guide, "Fractional division of constants"),
    // and PineTS-syntax / function input (pineVersion === null) is JavaScript,
    // where `/` is always float division.
    // The same pass types array.from() elements (int vs float) for every Pine version.
    if (pineVersion !== null) {
        runTypeInferencePass(ast, scopeManager, { intDivision: pineVersion < 6 });
    }

    // Lazy operands: tag nodes inside `?:` branches (every version) and the
    // right operand of `and`/`or` (Pine v6+, and JS `&&`/`||` for PineTS
    // syntax) so the call transformer keeps their namespace calls inline
    // instead of hoisting them into unconditional temps. Pine v5 evaluates
    // `and`/`or` strictly (see TradingView's v6 migration guide, "Lazy
    // evaluation of conditions"), so v5 keeps the eager right operand.
    markLazyOperands(ast, { lazyLogical: pineVersion === null || pineVersion >= 6 });

    // Second pass: transform the code
    runTransformationPass(ast, scopeManager, originalParamName, options, sourceLines);

    // Post-process: transform equality checks to math.__eq calls
    transformEqualityChecks(ast);

    // Post-process: Pine v5 `and`/`or` inside a lazy `?:` branch → math.__and/__or
    // so both operands are evaluated (v5 strictness) without hoisting them out
    // of the branch.
    transformStrictLogicalOperators(ast);

    // Post-process: `+` / `-` between display constants → display.__union / display.__minus
    transformDisplayArithmetic(ast);

    // Post-process: propagate async/await through user-defined function call chains
    // Functions containing await (e.g., from request.security) must be async,
    // and their callers (via $.call) must await them.
    propagateAsyncAwait(ast);

    // Post-process: inject __maxLoops local variable at the top of the function body.
    // This caches $.__maxLoops (from Context) in a local variable so loop guards
    // don't access the context object on every iteration. Falls back to 500000.
    if (ast.type === 'Program' && ast.body.length > 0) {
        const firstStmt = ast.body[0] as any;
        const fn = firstStmt?.expression || firstStmt;
        if (fn.body?.type === 'BlockStatement') {
            fn.body.body.unshift({
                type: 'VariableDeclaration',
                kind: 'const',
                declarations: [{
                    type: 'VariableDeclarator',
                    id: { type: 'Identifier', name: '__maxLoops' },
                    init: {
                        type: 'LogicalExpression',
                        operator: '||',
                        left: {
                            type: 'MemberExpression',
                            object: { type: 'Identifier', name: '$' },
                            property: { type: 'Identifier', name: '__maxLoops' },
                            computed: false,
                        },
                        right: { type: 'Literal', value: 500000 },
                    },
                }],
            });
        }
    }

    // Generate final code
    // astring exports baseGenerator (camelCase) in this version/build
    const baseGenerator = astring.baseGenerator || astring.GENERATOR || ((astring as any).default && (astring as any).default.BASE_GENERATOR);

    const customGenerator = Object.assign({}, baseGenerator, {
        LineComment(node: any, state: any) {
            state.write('//' + node.value);
        },
    });

    const transformedCode = astring.generate(ast, {
        generator: customGenerator,
        comments: debug,
    });

    // Slice every `request.security_lower_tf` call site. Each slice is a
    // pre-built async Function whose body is the user-script prefix up
    // through and including the call. Stashed on the returned function
    // (PineTS picks them up at run time and propagates onto the
    // Context). Slicing is read-only over the AST and is safe to do
    // alongside / after the main code-generation pass.
    //
    // Disabled via the PINETS_DISABLE_LTF_SLICING env var (used in
    // tooling that needs to exercise the legacy full-script slow path,
    // e.g. correctness comparisons).
    const slicingDisabled = (typeof process !== 'undefined') && process?.env?.PINETS_DISABLE_LTF_SLICING === '1';
    const slices = slicingDisabled ? {} : buildLtfSlices(ast);

    const _wraperFunction = new Function('', `var _r = ${transformedCode}\n; return _r;`);
    const mainFn = _wraperFunction(this);
    (mainFn as any)._pineVersion = pineVersion;
    if (slices && Object.keys(slices).length > 0) {
        for (const slice of Object.values(slices)) (slice as any)._pineVersion = pineVersion;
        (mainFn as any)._ltfSlices = slices;
    }
    return mainFn;
}
