// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
// EdgeLab modification: cancel every pending order, including attached exits.

import { Order } from '../types';

/**
 * Cancel all pending entry and exit orders. Filled trades stay open.
 * Pine signature: strategy.cancel_all() → void
 */
export function cancel_all(context: any) {
    return () => {
        if (!context.strategy) {
            throw new Error('strategy.cancel_all() called before strategy() declaration');
        }
        context.strategy.pending_orders = context.strategy.pending_orders.filter(
            (o: Order) => o.status !== 'pending',
        );
    };
}
