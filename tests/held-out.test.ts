import { describe, expect, it } from 'vitest';
import { config } from '@/lib/config';
import { buildCatalog } from '@/lib/store/catalog';
import { GOLDEN_CASES, HELD_OUT_TRAFFIC, SEED_TRAFFIC, TRY_SUGGESTIONS } from '@/lib/loop/traffic';

const { customers, orders } = buildCatalog(config.storeToday);
const orderById = new Map(orders.map((o) => [o.id, o]));
const customerById = new Map(customers.map((c) => [c.id, c]));

interface Facts {
  orderIds: string[];
  customers: string[];
  /** customer::item for every order the message names. */
  pairs: string[];
}

/** What a message refers to: order ids, customer names, and the customer and product behind each order. */
function facts(message: string): Facts {
  const orderIds = [...new Set(message.match(/ORD-\d+/g) ?? [])];
  const named = customers.filter((c) => message.includes(c.name)).map((c) => c.name);
  const pairs = orderIds.flatMap((id) => {
    const order = orderById.get(id);
    const owner = order ? customerById.get(order.customerId) : undefined;
    return order && owner ? [`${owner.name}::${order.item}`] : [];
  });
  return { orderIds, customers: [...new Set(named)], pairs };
}

// Everything the eval author and the learner can read: seed traces, Try box traces and the golden set.
const seen = [
  ...SEED_TRAFFIC.map((r) => ({ id: r.id, message: r.message })),
  ...TRY_SUGGESTIONS.map((message, i) => ({ id: `try-${i + 1}`, message })),
  ...GOLDEN_CASES.map((c) => ({ id: c.id, message: c.input })),
];

describe('held-out traffic', () => {
  it('names only orders that exist in the synthetic store', () => {
    for (const request of [...HELD_OUT_TRAFFIC, ...seen]) {
      for (const id of facts(request.message).orderIds) expect(orderById.has(id), `${request.id} names ${id}`).toBe(true);
    }
  });

  it('shares no order id with seed traffic, Try suggestions or golden cases', () => {
    const seenOrders = new Map(seen.flatMap((r) => facts(r.message).orderIds.map((id) => [id, r.id] as const)));
    for (const request of HELD_OUT_TRAFFIC) {
      for (const id of facts(request.message).orderIds) expect(seenOrders.get(id), `${request.id} reuses ${id}`).toBeUndefined();
    }
  });

  it('shares no customer and product pair with what the author and learner read', () => {
    const seenPairs = new Map(seen.flatMap((r) => facts(r.message).pairs.map((p) => [p, r.id] as const)));
    for (const request of HELD_OUT_TRAFFIC) {
      for (const pair of facts(request.message).pairs) expect(seenPairs.get(pair), `${request.id} repeats ${pair}`).toBeUndefined();
    }
  });

  it('never repeats a seen message or a seen customer with no order to tell them apart', () => {
    const seenMessages = new Set(seen.map((r) => r.message.trim().toLowerCase()));
    for (const request of HELD_OUT_TRAFFIC) {
      expect(seenMessages.has(request.message.trim().toLowerCase()), request.id).toBe(false);
      const f = facts(request.message);
      if (f.orderIds.length) continue;
      for (const name of f.customers) {
        const other = seen.find((r) => facts(r.message).customers.includes(name) && !facts(r.message).orderIds.length);
        expect(other?.id, `${request.id} and ${other?.id} are the same customer with no order`).toBeUndefined();
      }
    }
  });
});
