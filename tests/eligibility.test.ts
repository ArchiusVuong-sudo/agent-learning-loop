import { describe, expect, it } from 'vitest';
import { buildCatalog, daysBetween, shiftDays, type Order } from '@/lib/store/catalog';
import { evaluateReturn } from '@/lib/store/eligibility';
import { searchPolicies } from '@/lib/store/policies';

const TODAY = '2026-10-01';
const order = (patch: Partial<Order>): Order => ({
  id: 'ORD-99999',
  customerId: 'C-1001',
  sku: 'SKU-99999',
  item: 'Test item',
  category: 'apparel',
  priceCents: 100_00,
  orderedOn: shiftDays(TODAY, -14),
  deliveredOn: shiftDays(TODAY, -10),
  status: 'delivered',
  opened: false,
  finalSale: false,
  ...patch,
});

describe('evaluateReturn', () => {
  it('allows unopened items inside 30 days with a full refund', () => {
    const r = evaluateReturn(order({}), TODAY);
    expect(r).toMatchObject({ eligible: true, windowDays: 30, restockingFeePct: 0, refundEstimate: 100, policyId: 'returns-general' });
  });

  it('refuses items past 30 days', () => {
    expect(evaluateReturn(order({ deliveredOn: shiftDays(TODAY, -40) }), TODAY)).toMatchObject({ eligible: false, daysSinceDelivery: 40 });
  });

  it('gives opened electronics a 14-day window and a 15% fee', () => {
    const inside = evaluateReturn(order({ category: 'electronics', opened: true, priceCents: 179_00, deliveredOn: shiftDays(TODAY, -5) }), TODAY);
    expect(inside).toMatchObject({ eligible: true, windowDays: 14, restockingFeePct: 15, refundEstimate: 152.15, policyId: 'opened-electronics' });
    const outside = evaluateReturn(order({ category: 'electronics', opened: true, deliveredOn: shiftDays(TODAY, -20) }), TODAY);
    expect(outside).toMatchObject({ eligible: false, windowDays: 14 });
  });

  it('keeps the 30-day window for unopened electronics', () => {
    expect(evaluateReturn(order({ category: 'electronics', opened: false, deliveredOn: shiftDays(TODAY, -20) }), TODAY)).toMatchObject({ eligible: true, windowDays: 30, restockingFeePct: 0 });
  });

  it('never returns final-sale items', () => {
    expect(evaluateReturn(order({ finalSale: true, deliveredOn: shiftDays(TODAY, -2) }), TODAY)).toMatchObject({ eligible: false, policyId: 'final-sale' });
  });

  it('refuses orders that are not delivered', () => {
    expect(evaluateReturn(order({ status: 'in_transit', deliveredOn: null }), TODAY)).toMatchObject({ eligible: false, daysSinceDelivery: null });
  });

  it('refunds small shipping damage in full and escalates $200 or more', () => {
    expect(evaluateReturn(order({ priceCents: 89_00, deliveredOn: shiftDays(TODAY, -3) }), TODAY, 'damaged_in_transit')).toMatchObject({ eligible: true, refundEstimate: 89, requiresEscalation: false });
    expect(evaluateReturn(order({ priceCents: 200_00, deliveredOn: shiftDays(TODAY, -3) }), TODAY, 'damaged_in_transit')).toMatchObject({ eligible: false, requiresEscalation: true });
  });

  it('refuses damage reported after 7 days', () => {
    expect(evaluateReturn(order({ deliveredOn: shiftDays(TODAY, -8) }), TODAY, 'damaged_in_transit')).toMatchObject({ eligible: false, requiresEscalation: false, windowDays: 7 });
  });

  it('sends defects to warranty review', () => {
    expect(evaluateReturn(order({ deliveredOn: shiftDays(TODAY, -150) }), TODAY, 'defective')).toMatchObject({ eligible: false, requiresEscalation: true, policyId: 'warranty' });
  });

  it('uses the exchanges policy for wrong size', () => {
    expect(evaluateReturn(order({ category: 'footwear' }), TODAY, 'wrong_size')).toMatchObject({ eligible: true, policyId: 'exchanges' });
  });
});

describe('synthetic catalog', () => {
  it('is deterministic and the size the plan asks for', () => {
    const a = buildCatalog(TODAY);
    const b = buildCatalog(TODAY);
    expect(a).toEqual(b);
    expect(a.customers).toHaveLength(40);
    expect(a.orders).toHaveLength(120);
    expect(new Set(a.orders.map((o) => o.id)).size).toBe(120);
  });

  it('date helpers round-trip', () => {
    expect(daysBetween(shiftDays(TODAY, -20), TODAY)).toBe(20);
  });
});

describe('searchPolicies', () => {
  it('ranks the matching article first', () => {
    expect(searchPolicies('opened headphones restocking fee')[0]?.id).toBe('opened-electronics');
    expect(searchPolicies('cancel my membership')[0]?.id).toBe('membership');
    expect(searchPolicies('how long until my refund')[0]?.id).toBe('refunds');
  });

  it('returns nothing for unrelated text', () => {
    expect(searchPolicies('zzz qqq')).toEqual([]);
  });
});
