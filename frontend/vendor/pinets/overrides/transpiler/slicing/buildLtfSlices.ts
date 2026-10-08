// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
// Modified by EdgeLab, 2026-10-08: isolate bounded UDF request call paths.

/**
 * LTF / HTF request slicing — Phases 1 + 2 + 3.
 *
 * For every `request.security_lower_tf` (and `request.security`) call
 * site in the post-transpile AST, build a "slice" — a pre-built async
 * JavaScript Function whose body is a *path-projection* of the user's
 * code: every statement on the execution chain that leads to the call,
 * with sibling/post-call statements dropped at every nesting level.
 *
 * Coverage:
 *   - Phase 1 — call at top level of the wrapper function.
 *   - Phase 2 — call nested inside `if` / `for` / `while` / `do-while`
 *     / `switch` / nested `BlockStatement` at any depth.
 *   - Phase 3 — call inside a user-defined function (or UDT method —
 *     methods compile to regular FunctionDeclarations). Slice
 *     preserves the truncated definition and earliest supported invocation
 *     as the default. `_edgelabCallSlices` selects a full root-to-callee
 *     path of literal `$.call` IDs, with each caller projected at its
 *     matching invocation. Recursive paths and depths beyond eight calls
 *     are unsupported; generation is capped at 256 slice functions.
 *
 * Slices are keyed by the static `pN` literal carried by the call's
 * third positional argument (the same name `request.param` injects at
 * codegen). Inside a function body, the runtime composes the actual
 * `_expression_name` as `$$.id + 'pN'` (see commit 812eb2d for the
 * path-prefixing fix). The trailing `pN` selects the base slice; its
 * remaining call-path prefix selects a direct invocation slice.
 */

import * as astring from 'astring';

const SLICING_TARGETS = new Set(['security_lower_tf', 'security']);
const MAX_CALL_DEPTH = 8;
const MAX_GENERATED_SLICES = 256;
const MAX_CALL_PATH_VISITS = 4096;


const AST_SKIP_KEYS = new Set([
    'type', 'loc', 'start', 'end', 'range', 'parent',
    'leadingComments', 'trailingComments',
]);

/** Match `request.<target>(...)`. */
function isRequestSecurityCall(node: any): boolean {
    if (!node || node.type !== 'CallExpression') return false;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
    if (callee.object?.type !== 'Identifier' || callee.object.name !== 'request') return false;
    if (callee.property?.type !== 'Identifier') return false;
    return SLICING_TARGETS.has(callee.property.name);
}

/**
 * Read the `pN` expression name from a request call's 3rd arg. The
 * call's 3rd arg is the Identifier `pN` returned by `request.param`.
 */
function exprNameOfCall(call: any, bindings: Map<string, any>): string | null {
    let bag = call?.arguments?.find((arg: any) => arg?.type === 'ObjectExpression');
    if (!bag) {
        for (const arg of call?.arguments ?? []) {
            const init = arg?.type === 'Identifier' ? bindings.get(arg.name) : undefined;
            if (init?.type === 'CallExpression' && init.callee?.object?.name === 'request' && init.callee?.property?.name === 'param'
                && init.arguments?.[0]?.type === 'ObjectExpression') bag = init.arguments[0];
        }
    }
    const named = bag?.properties?.find((property: any) => (property.key?.name ?? property.key?.value) === 'expression')?.value;
    const arg2 = named ?? call?.arguments?.[2];
    if (arg2?.type === 'Identifier' && typeof arg2.name === 'string') return arg2.name;
    return null;
}

/**
 * Find every `request.security_lower_tf` CallExpression inside `root`,
 * paired with the path of AST ancestors leading to it. The path
 * starts at `root` (path[0] === root) and ends at the call node.
 */
function findRequestCallsWithPaths(root: any, bindings: Map<string, any>, fields: Map<string, any[]>): Array<{ call: any; path: any[] }> {
    const found: Array<{ call: any; path: any[] }> = [];
    const seen = new WeakSet<object>();
    function walk(n: any, path: any[]): void {
        if (!n || typeof n !== 'object') return;
        if (seen.has(n)) return;
        seen.add(n);
        const newPath = path.concat([n]);
        if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier') bindings.set(n.id.name, n.init);
        if (n.type === 'FunctionDeclaration' && n.id?.name) bindings.set(n.id.name, n);
        if (n.type === 'AssignmentExpression') {
            const key = fieldKey(n.left);
            if (key) {
                const values = fields.get(key) ?? [];
                values.push(n.right); fields.set(key, values);
            }
        }
        // Reassignments lower to $.set rather than AssignmentExpression.
        if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.computed
            && n.callee.object?.name === '$' && n.callee.property?.name === 'set') {
            const key = fieldKey(n.arguments?.[0]);
            if (key) {
                const values = fields.get(key) ?? [];
                values.push(n.arguments?.[1]); fields.set(key, values);
            }
        }
        if (isRequestSecurityCall(n)) {
            found.push({ call: n, path: newPath });
        }
        for (const key of Object.keys(n)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const v = n[key];
            if (Array.isArray(v)) {
                for (const item of v) walk(item, newPath);
            } else if (v && typeof v === 'object') {
                walk(v, newPath);
            }
        }
    }
    walk(root, []);
    return found;
}

/** True for any user-function-like AST node (excludes the wrapper). */
function isFunctionLike(n: any): boolean {
    if (!n) return false;
    return n.type === 'FunctionExpression' ||
           n.type === 'ArrowFunctionExpression' ||
           n.type === 'FunctionDeclaration';
}

/**
 * Slice a single AST node along the path. Reused by Phase 1, 2, and 3
 * (Phase 3 also runs this against function-bodies).
 *
 * `path[depth]` is the node we're slicing; `path[depth+1]` is the
 * child on the path. Return a new node with sibling/post-path content
 * dropped. Once we leave the statement realm and enter expression-
 * level nodes (ConditionalExpression, BinaryExpression, etc.), we
 * preserve them whole — slicing inside an expression breaks its
 * value.
 */
function sliceAlongPath(node: any, path: any[], depth: number): any {
    if (depth >= path.length - 1) return node;
    const next = path[depth + 1];

    switch (node.type) {
        case 'BlockStatement': {
            const idx = node.body.indexOf(next);
            if (idx < 0) return node;
            const newBody = node.body.slice(0, idx);
            newBody.push(sliceAlongPath(next, path, depth + 1));
            return { ...node, body: newBody };
        }
        case 'IfStatement': {
            if (next === node.test) {
                return { ...node, test: sliceAlongPath(next, path, depth + 1), consequent: { type: 'BlockStatement', body: [] }, alternate: null };
            }
            if (next === node.consequent) {
                return { ...node, consequent: sliceAlongPath(next, path, depth + 1), alternate: null };
            }
            if (next === node.alternate) {
                return { ...node, alternate: sliceAlongPath(next, path, depth + 1) };
            }
            return node;
        }
        case 'ForStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ForInStatement':
        case 'ForOfStatement': {
            if (next === node.body) {
                return { ...node, body: sliceAlongPath(next, path, depth + 1) };
            }
            return node;
        }
        case 'SwitchStatement': {
            const idx = node.cases.indexOf(next);
            if (idx >= 0) {
                const newCases = node.cases.slice(0, idx);
                newCases.push(sliceAlongPath(next, path, depth + 1));
                return { ...node, cases: newCases };
            }
            return node;
        }
        case 'SwitchCase': {
            const idx = node.consequent.indexOf(next);
            if (idx >= 0) {
                const newCons = node.consequent.slice(0, idx);
                newCons.push(sliceAlongPath(next, path, depth + 1));
                return { ...node, consequent: newCons };
            }
            return node;
        }
        // FunctionDeclaration / FunctionExpression / ArrowFunctionExpression
        // — slice their body when the path enters it.
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression': {
            if (next === node.body) {
                return { ...node, body: sliceAlongPath(next, path, depth + 1) };
            }
            return node;
        }
        default:
            return node;
    }
}

/**
 * Test if a CallExpression is `$.call(fnRef, ...)` and return the
 * fnRef Identifier name. Used to locate top-level invocations of a
 * given user function. Returns null if the node is not a `$.call`
 * or its first arg is neither an Identifier nor its exact $.get(fn, 0) wrapper.
 */
function dollarCallTarget(node: any): string | null {
    if (!node || node.type !== 'CallExpression') return null;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null;
    if (callee.object?.type !== 'Identifier' || callee.object.name !== '$') return null;
    if (callee.property?.type !== 'Identifier' || callee.property.name !== 'call') return null;
    let arg0 = node.arguments?.[0];
    // UDF calls inside another UDF unwrap the function through $.get(fn, 0).
    if (arg0?.type === 'CallExpression' && arg0.callee?.type === 'MemberExpression' && !arg0.callee.computed
        && arg0.callee.object?.name === '$' && arg0.callee.property?.name === 'get'
        && arg0.arguments?.length === 2 && arg0.arguments[1]?.type === 'Literal' && arg0.arguments[1].value === 0) {
        arg0 = arg0.arguments[0];
    }
    if (arg0?.type === 'Identifier' && typeof arg0.name === 'string') return arg0.name;
    return null;
}

type Invocation = { id: string; path: any[]; owner: any | null };

/** Calls within one execution scope; nested definitions are scanned separately. */
function findInvocationPaths(body: any): Array<{ target: string; id: string; path: any[] }> {
    const found: Array<{ target: string; id: string; path: any[] }> = [];
    const seen = new WeakSet<object>();
    function walk(node: any, path: any[]): void {
        if (!node || typeof node !== 'object' || seen.has(node) || isFunctionLike(node)) return;
        seen.add(node);
        const nextPath = path.concat(node);
        const target = dollarCallTarget(node);
        if (target) {
            const id = node.arguments?.[1];
            if (id?.type === 'Literal' && typeof id.value === 'string') found.push({ target, id: id.value, path: nextPath });
        }
        for (const key of Object.keys(node)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const value = node[key];
            if (Array.isArray(value)) for (const child of value) walk(child, nextPath);
            else walk(value, nextPath);
        }
    }
    walk(body, []);
    return found;
}

/** Reverse call edges over top-level declarations, retaining lexical execution scopes. */
function buildInvocationGraph(wrapperBody: any): Map<string, Invocation[]> {
    const functions = wrapperBody.body.filter((node: any) => node.type === 'FunctionDeclaration' && node.id?.name);
    const names = new Set(functions.map((node: any) => node.id.name));
    const graph = new Map<string, Invocation[]>();
    for (const owner of [null, ...functions]) {
        for (const call of findInvocationPaths(owner ? owner.body : wrapperBody)) {
            if (!names.has(call.target)) continue;
            const incoming = graph.get(call.target) ?? [];
            incoming.push({ id: call.id, path: call.path, owner });
            graph.set(call.target, incoming);
        }
    }
    return graph;
}

/** Build bounded root-to-request call paths, never falling back to a different invocation. */
function buildPhase3Slices(wrapperBody: any, path: any[], graph: Map<string, Invocation[]>): Array<{ id: string; body: any[]; roots: any[] }> {
    const fnIdx = path.findIndex(isFunctionLike);
    if (fnIdx < 0 || path.slice(fnIdx + 1).some(isFunctionLike)) return [];
    const fnNode = path[fnIdx];
    if (fnNode.type !== 'FunctionDeclaration' || !fnNode.id?.name || !wrapperBody.body.includes(fnNode)) return [];
    const requestOwner = sliceAlongPath(fnNode, path.slice(fnIdx), 0);
    const slices: Array<{ id: string; body: any[]; roots: any[] }> = [];
    let visits = 0;

    function visit(target: any, chain: Invocation[], visited: Set<any>): void {
        if (chain.length >= MAX_CALL_DEPTH) return;
        for (const invocation of graph.get(target.id.name) ?? []) {
            if (++visits > MAX_CALL_PATH_VISITS) throw new Error('Request isolation exceeds the call-path traversal limit.');
            const next = [invocation, ...chain];
            if (invocation.owner) {
                if (visited.has(invocation.owner)) continue;
                visit(invocation.owner, next, new Set([...visited, invocation.owner]));
                continue;
            }
            if (slices.length >= MAX_GENERATED_SLICES) throw new Error('Request isolation exceeds the generated slice limit.');
            const replacements = new Map<any, any>([[fnNode, requestOwner]]);
            for (const call of next) {
                if (call.owner) replacements.set(call.owner, { ...call.owner, body: sliceAlongPath(call.owner.body, call.path, 0) });
            }
            const root = sliceAlongPath(wrapperBody, invocation.path, 0);
            const body = root.body.map((statement: any) => replacements.get(statement) ?? statement);
            // A hoisted definition can follow its invocation; retain that definition alone.
            for (const [original, replacement] of replacements) {
                if (!root.body.includes(original)) body.push(replacement);
            }
            slices.push({ id: next.map(call => call.id).join('|'), body, roots: [...replacements.keys()] });
        }
    }
    visit(fnNode, [], new Set([fnNode]));
    return slices;
}

/** Wrap a sliced statement list back into an async arrow Function. */
function buildSliceFunction(wrapperFn: any, slicedStmts: any[]): Function {
    const slicedAst = {
        type: 'Program',
        sourceType: 'module',
        body: [{
            type: 'ExpressionStatement',
            expression: {
                type: 'ArrowFunctionExpression',
                async: !!wrapperFn.async,
                params: wrapperFn.params,
                body: { type: 'BlockStatement', body: slicedStmts },
            },
        }],
    };
    const code = astring.generate(slicedAst as any);
    const wrapped = `var _r = ${code}\n; return _r;`;
    return new Function('', wrapped)();
}

/** Follow compiled expression bindings, including saved state fields, to earlier request results. */
function requestDependencies(name: string, bindings: Map<string, any>, fields: Map<string, any[]>): string[] {
    const dependencies = new Set<string>();
    const seen = new WeakSet<object>();
    function walk(node: any): void {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (node.type === 'Identifier') walk(bindings.get(node.name));
        const key = fieldKey(node);
        if (key) for (const value of fields.get(key) ?? []) walk(value);
        if (isRequestSecurityCall(node)) {
            const dependency = exprNameOfCall(node, bindings);
            if (dependency && dependency !== name) dependencies.add(dependency);
        }
        for (const key of Object.keys(node)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const value = node[key];
            if (Array.isArray(value)) for (const child of value) walk(child); else walk(value);
        }
    }
    walk(bindings.get(name));
    return [...dependencies];
}

/** Drop only proven dead consumers of unrelated requests from a prefix slice.
 * Otherwise a later lower request can replay an earlier intrabar array on the
 * child timeframe and execute chart-only array reads against singleton arrays.
 * Required request dependencies retain their existing static/dynamic behavior.
 */
function pruneUnrelatedRequests(body: any[], name: string, dependencies: readonly string[],
    bindings: Map<string, any>, fields: Map<string, any[]>, unrelated: readonly any[]): any[] {
    const required = new Set([name, ...dependencies]);
    const namespaces = new Set<string>();
    for (const statement of body) for (const declaration of statement.declarations ?? []) {
        if (declaration.id?.type !== 'ObjectPattern' || fieldKey(declaration.init) !== '$.pine') continue;
        for (const property of declaration.id.properties ?? []) {
            if (property.type === 'Property' && property.key?.name === property.value?.name) namespaces.add(property.value.name);
        }
    }
    const unusedParams = new Set<string>();
    for (const call of unrelated) for (const arg of call.arguments ?? []) {
        if (arg.type === 'Identifier') {
            const init = bindings.get(arg.name);
            if (init?.callee?.object?.name === 'request' && init?.callee?.property?.name === 'param') unusedParams.add(arg.name);
        }
    }
    const taintMemo = new WeakMap<object, boolean>();
    const active = new WeakSet<object>();
    let visits = 0;
    const limit = () => {
        if (++visits > 65536) throw new Error('Request prefix projection exceeds the traversal limit.');
    };
    function tainted(node: any, depth = 0): boolean {
        if (!node || typeof node !== 'object') return false;
        limit();
        if (depth > 128) throw new Error('Request prefix projection exceeds the nesting limit.');
        if (taintMemo.has(node)) return taintMemo.get(node)!;
        if (active.has(node)) return false;
        active.add(node);
        let result = false;
        if (isRequestSecurityCall(node) && node.callee.property.name === 'security_lower_tf') {
            const id = exprNameOfCall(node, bindings);
            result = !id || !required.has(id);
        }
        if (!result && node.type === 'Identifier') result = unusedParams.has(node.name) || tainted(bindings.get(node.name), depth + 1);
        const key = fieldKey(node);
        if (!result && key) result = (fields.get(key) ?? []).some(value => tainted(value, depth + 1));
        if (!result) for (const key of Object.keys(node)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const value = node[key];
            result = Array.isArray(value) ? value.some(child => tainted(child, depth + 1)) : tainted(value, depth + 1);
            if (result) break;
        }
        active.delete(node);
        if (result) taintMemo.set(node, true);
        return result;
    }
    // Removing a dead read/output is safe. Unknown mutation-bearing calls are
    // refused rather than silently changing state that a later expression uses.
    const pureFunctions = new Set<any>();
    function pureConsumer(node: any, depth = 0, inFunction = false): boolean {
        if (!node || typeof node !== 'object') return true;
        limit();
        if (depth > 128) throw new Error('Request prefix projection exceeds the nesting limit.');
        if (node.type === 'CallExpression') {
            const owner = node.callee?.object?.name, member = node.callee?.property?.name;
            if (owner === '$' && member === 'call') {
                const target = dollarCallTarget(node), fn = target ? bindings.get(target) : undefined;
                if (!fn || fn.type !== 'FunctionDeclaration' || pureFunctions.has(fn)) return false;
                pureFunctions.add(fn);
                const pure = pureConsumer(fn.body, depth + 1, true);
                pureFunctions.delete(fn);
                if (!pure) return false;
            } else {
                const allowed = isRequestSecurityCall(node) && namespaces.has('request')
                    || fieldKey(node.callee?.object) === '$.pine.math'
                        && ['__eq', '__neq', '__lt', '__le', '__gt', '__ge', '__and', '__or', '__idiv'].includes(member)
                    || member === 'param' && (owner === '$' || namespaces.has(owner))
                    || owner === '$' && ['get', 'init', 'initVar', 'toTuple', 'precision', 'peekCtx'].includes(member)
                    || owner === '$' && member === 'set' && /^\$\$\.(?:var|varip|let|const)\.[^.]+$/.test(fieldKey(node.arguments?.[0]) ?? '')
                    || owner === 'ta' && namespaces.has(owner)
                    || owner === 'array' && namespaces.has(owner) && ['get', 'size'].includes(member)
                    || owner === 'plot' && namespaces.has(owner) && member === 'any';
                if (!allowed) return false;
            }
        }
        if (node.type === 'UpdateExpression' || node.type === 'NewExpression' || isFunctionLike(node)) return false;
        if (node.type === 'AssignmentExpression') {
            const key = fieldKey(node.left) ?? '';
            if (node.operator !== '=' || !/^\$\$?\.(?:var|varip|let|const)\.[^.]+$/.test(key)
                || inFunction && key.startsWith('$.')) return false;
        }
        for (const key of Object.keys(node)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const value = node[key];
            if (Array.isArray(value) ? value.some(child => !pureConsumer(child, depth + 1, inFunction)) : !pureConsumer(value, depth + 1, inFunction)) return false;
        }
        return true;
    }
    function project(node: any): any | null {
        if (isFunctionLike(node)) return node;
        if (node.type === 'BlockStatement') return { ...node, body: node.body.map(project).filter(Boolean) };
        if (!tainted(node)) return node;
        if (['IfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)
            || !pureConsumer(node)) {
            throw new Error('Unrelated request consumers with shared state cannot be isolated safely.');
        }
        return null;
    }
    return body.map(project).filter(Boolean);
}

/** Prefix replay cannot reconstruct shared mutable state omitted after a request.
 * Follow only this expression and its original call-chain bodies, not unrelated globals.
 */
function staticReplaySafe(name: string, roots: any[], bindings: Map<string, any>, fields: Map<string, any[]>): boolean {
    const mutableActive = new WeakSet<object>();
    const mutableMemo = new WeakMap<object, boolean>();
    function mutableValue(node: any): boolean {
        if (!node || typeof node !== 'object') return false;
        if (mutableMemo.has(node)) return mutableMemo.get(node)!;
        if (mutableActive.has(node)) return false;
        mutableActive.add(node);
        const result = classifyMutableValue(node);
        mutableActive.delete(node);
        mutableMemo.set(node, result);
        return result;
    }
    function classifyMutableValue(node: any): boolean {
        if (node.type === 'Identifier') return mutableValue(bindings.get(node.name));
        const key = fieldKey(node);
        if (key && fields.has(key)) return fields.get(key)!.some(mutableValue);
        if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression' || node.type === 'NewExpression') return true;
        if (node.type === 'AwaitExpression' || node.type === 'ChainExpression') return mutableValue(node.argument ?? node.expression);
        if (node.type === 'ConditionalExpression') return mutableValue(node.consequent) || mutableValue(node.alternate);
        if (node.type === 'LogicalExpression') return mutableValue(node.left) || mutableValue(node.right);
        if (node.type === 'MemberExpression') {
            if (!node.computed && node.property?.name === 'prototype') return true;
            if (!node.computed && node.property?.name === 'all' && ['box', 'line', 'label', 'linefill', 'polyline', 'table'].includes(node.object?.name)) return true;
            return mutableValue(node.object);
        }
        if (node.type !== 'CallExpression') return false;
        const callee = node.callee?.type === 'ChainExpression' ? node.callee.expression : node.callee;
        const member = callee?.type === 'MemberExpression' && !callee.computed ? callee.property?.name : undefined;
        const owner = callee?.object?.name;
        if (owner === '$' && ['init', 'initVar'].includes(member)) return mutableValue(node.arguments?.[1]);
        if (owner === '$' && ['get', 'param', 'precision'].includes(member)) return mutableValue(node.arguments?.[0]);
        if (member === 'param') return mutableValue(node.arguments?.[0]);
        if (owner === '$' && member === 'call') {
            // A returned formal can carry a mutable value from the caller.
            // Conservatively retain that risk without inventing parameter bindings.
            if (node.arguments.slice(2).some(mutableValue)) return true;
            const target = dollarCallTarget(node);
            const fn = target ? bindings.get(target) : undefined;
            if (!fn || fn.type !== 'FunctionDeclaration') return true;
            let mutable = false;
            function returns(value: any): void {
                if (!value || typeof value !== 'object' || mutable) return;
                if (value.type === 'ReturnStatement') { mutable = mutableValue(value.argument); return; }
                if (isFunctionLike(value)) return;
                for (const key of Object.keys(value)) {
                    if (AST_SKIP_KEYS.has(key)) continue;
                    const child = value[key];
                    if (Array.isArray(child)) for (const item of child) returns(item); else returns(child);
                }
            }
            returns(fn.body);
            return mutable;
        }
        // Collections, UDTs and drawing/point constructors return mutable references.
        // color.new and ticker.new are string-producing helpers, not object factories.
        // Without complete return-type proof, any collection namespace result
        // stored in a referenced global is conservatively considered a pointer.
        if (['array', 'map', 'matrix'].includes(owner)) return true;
        if ((owner === 'ta' && member === 'pivot_point_levels') || (owner === 'request' && member === 'security_lower_tf')) return true;
        return ['new', 'copy', 'from_index', 'from_time'].includes(member) && !['color', 'ticker'].includes(owner);
    }
    const seen = new WeakSet<object>();
    let safe = true;
    function walk(node: any): void {
        if (!safe || !node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        const key = fieldKey(node);
        if (key && /^\$\.(?:var|varip|let|const)\.[^.]+$/.test(key)) {
            const assignments = fields.get(key);
            if (!assignments?.length || assignments.length > 1 || assignments.some(mutableValue)) { safe = false; return; }
        }
        if (node.type === 'Identifier') walk(bindings.get(node.name));
        if (key) for (const value of fields.get(key) ?? []) walk(value);
        for (const key of Object.keys(node)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const value = node[key];
            if (Array.isArray(value)) for (const child of value) walk(child); else walk(value);
        }
    }
    walk(bindings.get(name));
    for (const root of roots) walk(root);
    return safe;
}

function fieldKey(node: any): string | undefined {
    if (node?.type === 'Identifier') return node.name;
    if (node?.type !== 'MemberExpression' || node.computed || node.property?.type !== 'Identifier') return;
    const owner = fieldKey(node.object);
    return owner ? owner + '.' + node.property.name : undefined;
}

export function buildLtfSlices(ast: any): Record<string, Function> {
    const slices: Record<string, Function> = {};

    if (!ast || ast.type !== 'Program' || !Array.isArray(ast.body) || ast.body.length === 0) {
        return slices;
    }
    const firstStmt = ast.body[0];
    let wrapperFn: any | null = null;
    if (firstStmt.type === 'ExpressionStatement') {
        const expr = firstStmt.expression;
        if (expr && (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression')) {
            wrapperFn = expr;
        }
    } else if (firstStmt.type === 'FunctionDeclaration') {
        wrapperFn = firstStmt;
    }
    if (!wrapperFn || wrapperFn.body?.type !== 'BlockStatement') return slices;

    const bindings = new Map<string, any>();
    const fields = new Map<string, any[]>();
    const calls = findRequestCallsWithPaths(wrapperFn.body, bindings, fields);
    const graph = buildInvocationGraph(wrapperFn.body);
    let generated = 0;

    for (const { call, path } of calls) {
        const exprName = exprNameOfCall(call, bindings);
        if (!exprName) continue;
        if (exprName in slices) continue;

        // Phase 1 + 2 path: the request call is reachable without
        // crossing a nested user function.
        const crossesFn = path.some((n) => isFunctionLike(n));
        let stmts: any[] | null = null;
        let callPaths: Array<{ id: string; body: any[]; roots: any[] }> = [];
        if (!crossesFn) {
            const slicedRoot = sliceAlongPath(wrapperFn.body, path, 0);
            stmts = (slicedRoot && slicedRoot.body) ? slicedRoot.body : [];
        } else {
            // Phase 3 path: call lives inside a function body.
            callPaths = buildPhase3Slices(wrapperFn.body, path, graph);
            stmts = callPaths[0]?.body ?? null;
        }
        if (!stmts || stmts.length === 0) continue;

        const dependencies = Object.freeze(requestDependencies(exprName, bindings, fields));
        const unrelated = calls.filter(({ call }) => call.callee.property.name === 'security_lower_tf'
            && ![exprName, ...dependencies].includes(exprNameOfCall(call, bindings) ?? '')).map(({ call }) => call);
        const makeSlice = (body: any[], roots: any[] = []): Function => {
            if (++generated > MAX_GENERATED_SLICES) throw new Error('Request isolation exceeds the generated slice limit.');
            const fn = buildSliceFunction(wrapperFn, unrelated.length ? pruneUnrelatedRequests(body, exprName, dependencies, bindings, fields, unrelated) : body);
            Object.defineProperty(fn, '_edgelabRequestDependencies', { value: dependencies });
            Object.defineProperty(fn, '_edgelabStaticReplaySafe', { value: staticReplaySafe(exprName, roots, bindings, fields) });
            return fn;
        };
        const sliceFn = makeSlice(stmts, callPaths[0]?.roots);
        if (crossesFn) {
            const callSlices: Record<string, Function> = Object.create(null);
            for (const invocation of callPaths) callSlices[invocation.id] = makeSlice(invocation.body, invocation.roots);
            Object.defineProperty(sliceFn, '_edgelabCallSlices', { value: Object.freeze(callSlices) });
        }
        slices[exprName] = sliceFn;
    }

    return slices;
}
