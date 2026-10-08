// SPDX-License-Identifier: AGPL-3.0-only
// Modified by EdgeLab, 2026-10-08: capture scalar helpers at the executing bar.

import { Series } from '../../../Series';
import { isScalarHelper } from '../../utils';
import { TimeHelper } from '../../Time';

export function param(context: any) {
    return (source: any, index: any, name?: string) => {
        if (!context.params[name]) context.params[name] = [];

        let val;
        if (source instanceof Series) {
            // Source is a Series - extract the value at index
            val = source.get(index || 0);
        } else if (Array.isArray(source)) {
            // Check if this is a tuple expression vs a time-series array
            //
            // For request.security/security_lower_tf, tuples are always passed as arrays of expressions.
            // A tuple can contain Series objects, scalars, or a mix (e.g., [open, close, wVolSrc()]).
            //
            // Detection: If any element is a Series, it's a tuple (time-series arrays don't contain
            // Series at the top level). If all elements are scalars (no nested arrays), it's also
            // a tuple of literal values. Only arrays with nested arrays are time-series data.

            const hasAnySeries = source.some((elem) => elem instanceof Series);
            const hasOnlyScalars = source.every((elem) => !(elem instanceof Series) && !Array.isArray(elem));
            const isTuple = (hasAnySeries || hasOnlyScalars) && source.length >= 1;

            if (isTuple) {
                // Extract current value from each element (Series → .get(0), scalars pass through)
                val = source.map((elem: any) => elem instanceof Series ? elem.get(0) : elem);
            } else {
                // Time-series array - extract value at index
                val = Series.from(source).get(index || 0);
            }
        } else {
            val = source;
        }

        // Helpers such as time/time_close are live views of context.idx.
        // Store their value now so historical tuples cannot retain a final-bar view.
        const scalar = (value: any) => value instanceof TimeHelper
            ? Series.from(value.__value).get(index || 0)
            : isScalarHelper(value) ? value.__value : value;
        val = Array.isArray(val) ? val.map(scalar) : scalar(val);

        if (context.params[name].length === 0) {
            context.params[name].push(val);
        } else {
            context.params[name][context.params[name].length - 1] = val;
        }

        // Preserve the ORIGINAL source (with Series identity intact, before
        // value extraction) so request.security_lower_tf can detect pure-
        // builtin expressions (`close`, `[open, high, low, close, volume]`,
        // …) and bypass running the user script in the secondary context.
        // Stored by param-name on a side channel — the existing 2-tuple
        // [val, name] return shape is preserved, so no other consumers of
        // request.param care.
        if (!context._requestParamSources) context._requestParamSources = {};
        context._requestParamSources[name] = source;

        return [val, name];
    };
}
