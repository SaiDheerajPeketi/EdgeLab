// SPDX-License-Identifier: AGPL-3.0-only

import { parseInputOptions, resolveInput } from '../utils';
import { Series } from '../../../Series';

// EdgeLab modification (2026-10-08): exact member IDs at the host boundary,
// canonical enum tokens inside the engine. Display labels never identify members.
export function enum_fn(context: any) {
    return (...args: any[]) => {
        // Function/JavaScript input keeps the upstream permissive string contract.
        if (context.pineVersion === null) return resolveInput(context, parseInputOptions(args));
        const unwrap = (value: any) => value instanceof Series ? value.get(0) : value;
        const asId = (value: any): string => {
            const member = context.enumInfo(unwrap(value));
            if (!member) throw new TypeError('input.enum() declarations require enum members, not strings.');
            return member.id;
        };
        let defaultToken: any;
        const normalized = args.map((arg: any, index: number) => {
            const value = unwrap(arg);
            if (context.enumInfo(value)) {
                if (index === 0) defaultToken = value;
                return asId(value);
            }
            if (value !== null && typeof value === 'object' && !Array.isArray(value) &&
                Object.getPrototypeOf(value) === Object.prototype &&
                !Object.prototype.hasOwnProperty.call(value, '__inputId') &&
                !Object.prototype.hasOwnProperty.call(value, '__varId')) {
                const bag = { ...value };
                if (Object.prototype.hasOwnProperty.call(bag, 'defval')) {
                    defaultToken = unwrap(bag.defval);
                    bag.defval = asId(defaultToken);
                }
                if (Object.prototype.hasOwnProperty.call(bag, 'options')) {
                    const choices = unwrap(bag.options);
                    bag.options = Array.isArray(choices) ? choices.map(asId) : choices;
                }
                return bag;
            }
            return Array.isArray(value) ? value.map(asId) : value;
        });
        const options = parseInputOptions(normalized);
        const definition = context.enumInfo(defaultToken);
        if (!definition) throw new TypeError('input.enum() requires an enum member default.');
        const choices = options.options;
        if (choices !== undefined && (!Array.isArray(choices) || choices.length === 0 ||
            choices.some((id: any) => context.enumInfo(context.enumMemberFromId(id))?.type !== definition.type)))
            throw new TypeError('input.enum() options must be members of the default enum.');
        if (choices !== undefined && !choices.includes(definition.id))
            throw new TypeError('input.enum() default must be included in options.');
        const selected = resolveInput(context, options);
        const member = context.enumMemberFromId(selected);
        if (context.enumInfo(member)?.type !== definition.type ||
            (choices !== undefined && !choices.includes(selected)))
            throw new TypeError('input.enum() value is not an allowed enum member ID.');
        return member;
    };
}
