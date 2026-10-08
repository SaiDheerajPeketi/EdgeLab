// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
// Modified by EdgeLab, 2026-10-08: isolate direct UDF request invocations by call ID.

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
 *     preserves the truncated definition and earliest direct invocation
 *     as the default. `_edgelabCallSlices` additionally selects each
 *     direct invocation by its literal `$.call` ID. Calls reached only
 *     through another UDF have no supported slice.
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
 * or its first arg is not an Identifier.
 */
function dollarCallTarget(node: any): string | null {
    if (!node || node.type !== 'CallExpression') return null;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || callee.computed) return null;
    if (callee.object?.type !== 'Identifier' || callee.object.name !== '$') return null;
    if (callee.property?.type !== 'Identifier' || callee.property.name !== 'call') return null;
    const arg0 = node.arguments?.[0];
    if (arg0?.type === 'Identifier' && typeof arg0.name === 'string') return arg0.name;
    return null;
}

/** Direct wrapper invocations only. Calls inside another function are unsupported. */
function findInvocationPaths(wrapperBody: any, fnName: string): Array<{ id: string; path: any[] }> {
    const found: Array<{ id: string; path: any[] }> = [];
    const seen = new WeakSet<object>();
    function walk(node: any, path: any[]): void {
        if (!node || typeof node !== 'object' || seen.has(node) || isFunctionLike(node)) return;
        seen.add(node);
        const nextPath = path.concat(node);
        if (dollarCallTarget(node) === fnName) {
            const id = node.arguments?.[1];
            if (id?.type === 'Literal' && typeof id.value === 'string') found.push({ id: id.value, path: nextPath });
        }
        for (const key of Object.keys(node)) {
            if (AST_SKIP_KEYS.has(key)) continue;
            const value = node[key];
            if (Array.isArray(value)) for (const child of value) walk(child, nextPath);
            else walk(value, nextPath);
        }
    }
    walk(wrapperBody, []);
    return found;
}

/**
 * Build a Phase 3 slice for a request call inside a function body.
 *
 * Strategy:
 *   1. The call's path = [wrapperBody, …, fnDecl, fnDecl.body, …, call].
 *   2. Slice fnDecl.body at the call (using sliceAlongPath rooted at
 *      fnDecl).
 *   3. Find the requested direct `$.call(fnDecl.id, id, …)` invocation,
 *      or the earliest direct invocation for the default slice.
 *   4. Project the wrapper through that invocation, swapping fnDecl
 *      for its sliced version. The
 *      kept statements include any `var` instance initializers the
 *      method needs (e.g. `var Counter c = Counter.new()`), preserving
 *      the var-once semantics observed in TV (Probe 3).
 *
 * Returns the sliced wrapper.body's statement list, or null if the
 * shape isn't supported (multi-level fn nesting, recursive fn,
 * etc.). Expression nodes retain their value semantics. A missing
 * slice lets the host explicitly reject unsupported isolation.
 */
function buildPhase3SliceStmts(wrapperBody: any, path: any[], invocationPath?: any[]): any[] | null {
    // path[0] === wrapperBody. Find the FIRST FunctionDeclaration
    // on the path — that's the outer-most fn body the call lives in.
    let fnIdx = -1;
    for (let i = 1; i < path.length; i++) {
        if (isFunctionLike(path[i])) { fnIdx = i; break; }
    }
    if (fnIdx < 0) return null;
    const fnNode = path[fnIdx];

    // Phase 3 v1 — only handle single-level fn nesting. If there's a
    // SECOND function-like node deeper in the path, bail.
    for (let i = fnIdx + 1; i < path.length; i++) {
        if (isFunctionLike(path[i])) return null;
    }

    // Only handle FunctionDeclarations — anonymous fn-expressions
    // can't be looked up by name in the call graph.
    if (fnNode.type !== 'FunctionDeclaration' || !fnNode.id?.name) return null;
    const fnName = fnNode.id.name;

    // Slice the function's body at the call.
    const fnSlicePath = path.slice(fnIdx); // [fnDecl, fnDecl.body?, …, call]
    const slicedFn = sliceAlongPath(fnNode, fnSlicePath, 0);

    // Keep the existing earliest-call default, and expose exact direct call-site slices.
    const invocation = invocationPath ?? findInvocationPaths(wrapperBody, fnName)[0]?.path;
    if (!invocation) return null;
    const fnDeclIdx = wrapperBody.body.indexOf(fnNode);
    if (fnDeclIdx < 0) return null;
    const projected = sliceAlongPath(wrapperBody, invocation, 0);
    const result = projected.body.map((statement: any) => statement === fnNode ? slicedFn : statement);
    // Declarations are hoisted; retain only this declaration if it follows the invocation.
    if (!result.includes(slicedFn)) result.push(slicedFn);
    return result;
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

    for (const { call, path } of calls) {
        const exprName = exprNameOfCall(call, bindings);
        if (!exprName) continue;
        if (exprName in slices) continue;

        // Phase 1 + 2 path: the request call is reachable without
        // crossing a nested user function.
        const crossesFn = path.some((n) => isFunctionLike(n));
        let stmts: any[] | null = null;
        if (!crossesFn) {
            const slicedRoot = sliceAlongPath(wrapperFn.body, path, 0);
            stmts = (slicedRoot && slicedRoot.body) ? slicedRoot.body : [];
        } else {
            // Phase 3 path: call lives inside a function body.
            stmts = buildPhase3SliceStmts(wrapperFn.body, path);
        }
        if (!stmts || stmts.length === 0) continue;

        const dependencies = Object.freeze(requestDependencies(exprName, bindings, fields));
        const makeSlice = (body: any[]): Function => {
            const fn = buildSliceFunction(wrapperFn, body);
            Object.defineProperty(fn, '_edgelabRequestDependencies', { value: dependencies });
            return fn;
        };
        const sliceFn = makeSlice(stmts);
        if (crossesFn) {
            const fnNode = path.find(isFunctionLike);
            const callSlices: Record<string, Function> = Object.create(null);
            if (fnNode?.type === 'FunctionDeclaration' && fnNode.id?.name) {
                for (const invocation of findInvocationPaths(wrapperFn.body, fnNode.id.name)) {
                    const body = buildPhase3SliceStmts(wrapperFn.body, path, invocation.path);
                    if (body?.length) callSlices[invocation.id] = makeSlice(body);
                }
            }
            Object.defineProperty(sliceFn, '_edgelabCallSlices', { value: Object.freeze(callSlices) });
        }
        slices[exprName] = sliceFn;
    }

    return slices;
}
