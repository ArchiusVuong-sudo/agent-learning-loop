import { daysBetween, type Order } from './catalog';
import {
  DAMAGE_ESCALATION_THRESHOLD_CENTS,
  DAMAGE_REPORT_DAYS,
  OPENED_ELECTRONICS_WINDOW_DAYS,
  RESTOCKING_FEE_PCT,
  RETURN_WINDOW_DAYS,
} from './policies';

export const RETURN_REASONS = ['changed_mind', 'wrong_size', 'damaged_in_transit', 'defective'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export interface Eligibility {
  orderId: string;
  eligible: boolean;
  /** True when policy says a human must decide (high-value damage, warranty). */
  requiresEscalation: boolean;
  policyId: string;
  daysSinceDelivery: number | null;
  windowDays: number | null;
  restockingFeePct: number;
  refundEstimate: number;
  explanation: string;
}

const dollars = (cents: number) => Math.round(cents) / 100;

/** The store's return rules, as one pure function. Tools and tests share it. */
export function evaluateReturn(order: Order, today: string, reason: ReturnReason = 'changed_mind'): Eligibility {
  const base = { orderId: order.id, restockingFeePct: 0, refundEstimate: 0, windowDays: null as number | null };
  if (order.status !== 'delivered' || !order.deliveredOn) {
    return { ...base, eligible: false, requiresEscalation: false, policyId: 'returns-general', daysSinceDelivery: null, explanation: 'The order has not been delivered yet, so it cannot be returned.' };
  }
  const days = daysBetween(order.deliveredOn, today);

  if (reason === 'defective') {
    return { ...base, eligible: false, requiresEscalation: true, policyId: 'warranty', daysSinceDelivery: days, explanation: 'Defects are handled as warranty claims by a human agent. Escalate with category "warranty".' };
  }

  if (reason === 'damaged_in_transit') {
    if (days > DAMAGE_REPORT_DAYS) {
      return { ...base, eligible: false, requiresEscalation: false, policyId: 'damaged-in-transit', daysSinceDelivery: days, windowDays: DAMAGE_REPORT_DAYS, explanation: `Shipping damage must be reported within ${DAMAGE_REPORT_DAYS} days of delivery; this order was delivered ${days} days ago.` };
    }
    if (order.priceCents >= DAMAGE_ESCALATION_THRESHOLD_CENTS) {
      return { ...base, eligible: false, requiresEscalation: true, policyId: 'damaged-in-transit', daysSinceDelivery: days, windowDays: DAMAGE_REPORT_DAYS, explanation: 'Damage claims of $200 or more need review by a human agent. Escalate with category "damage_claim" and do not promise a refund.' };
    }
    return { ...base, eligible: true, requiresEscalation: false, policyId: 'damaged-in-transit', daysSinceDelivery: days, windowDays: DAMAGE_REPORT_DAYS, refundEstimate: dollars(order.priceCents), explanation: 'Damaged in transit and under $200: full refund, no restocking fee.' };
  }

  if (order.finalSale) {
    return { ...base, eligible: false, requiresEscalation: false, policyId: 'final-sale', daysSinceDelivery: days, explanation: 'Final-sale items cannot be returned or exchanged.' };
  }

  const openedElectronics = order.category === 'electronics' && order.opened;
  const windowDays = openedElectronics ? OPENED_ELECTRONICS_WINDOW_DAYS : RETURN_WINDOW_DAYS;
  const policyId = openedElectronics ? 'opened-electronics' : reason === 'wrong_size' ? 'exchanges' : 'returns-general';
  if (days > windowDays) {
    return { ...base, eligible: false, requiresEscalation: false, policyId, daysSinceDelivery: days, windowDays, explanation: `The return window for this item is ${windowDays} days and it was delivered ${days} days ago.` };
  }
  const feePct = openedElectronics ? RESTOCKING_FEE_PCT : 0;
  const refund = dollars(order.priceCents * (1 - feePct / 100));
  return {
    orderId: order.id,
    eligible: true,
    requiresEscalation: false,
    policyId,
    daysSinceDelivery: days,
    windowDays,
    restockingFeePct: feePct,
    refundEstimate: refund,
    explanation: feePct
      ? `Opened electronics can be returned within ${windowDays} days with a ${feePct}% restocking fee.`
      : `Within the ${windowDays}-day return window.`,
  };
}
