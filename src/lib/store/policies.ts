/** Synthetic help-center articles for the store. Searched by keyword through `search_policy`. */
export interface Policy {
  id: string;
  title: string;
  body: string;
  keywords: string[];
}

export const RETURN_WINDOW_DAYS = 30;
export const OPENED_ELECTRONICS_WINDOW_DAYS = 14;
export const RESTOCKING_FEE_PCT = 15;
export const DAMAGE_REPORT_DAYS = 7;
export const DAMAGE_ESCALATION_THRESHOLD_CENTS = 200_00;

export const POLICIES: Policy[] = [
  {
    id: 'returns-general',
    title: 'Returns',
    body: `Most items can be returned within ${RETURN_WINDOW_DAYS} days of delivery for a full refund. Opened electronics have a shorter window (see "Opened electronics"). Final-sale items cannot be returned. Always confirm eligibility for the specific order before starting a return.`,
    keywords: ['return', 'returns', 'window', 'days', 'send back'],
  },
  {
    id: 'opened-electronics',
    title: 'Opened electronics',
    body: `Opened electronics (headphones, GPS units, headlamps, action cameras, watches) can be returned within ${OPENED_ELECTRONICS_WINDOW_DAYS} days of delivery. A ${RESTOCKING_FEE_PCT}% restocking fee is deducted from the refund. After ${OPENED_ELECTRONICS_WINDOW_DAYS} days, opened electronics are covered by warranty only.`,
    keywords: ['electronics', 'opened', 'headphones', 'gps', 'headlamp', 'camera', 'watch', 'restocking', 'fee'],
  },
  {
    id: 'final-sale',
    title: 'Final sale',
    body: 'Items marked final sale (clearance) cannot be returned or exchanged. They are still covered by the warranty against manufacturing defects.',
    keywords: ['final sale', 'clearance', 'final', 'sale', 'discount'],
  },
  {
    id: 'damaged-in-transit',
    title: 'Damaged in transit',
    body: `Report shipping damage within ${DAMAGE_REPORT_DAYS} days of delivery. For orders under $200, start a return with reason "damaged_in_transit": the customer gets a full refund and no restocking fee. Damage claims of $200 or more must be escalated to a human agent for review. Do not promise a refund or replacement for these claims; tell the customer a specialist will follow up within 1 business day.`,
    keywords: ['damaged', 'damage', 'broken', 'arrived', 'shipping', 'transit', 'cracked', 'torn'],
  },
  {
    id: 'refunds',
    title: 'Refunds',
    body: 'Refunds go back to the original payment method within 5-7 business days after the returned item is received at the warehouse. Restocking fees, when they apply, are deducted from the refund.',
    keywords: ['refund', 'money back', 'how long', 'when', 'payment', 'business days'],
  },
  {
    id: 'exchanges',
    title: 'Exchanges',
    body: `Footwear and apparel can be exchanged for a different size or color within ${RETURN_WINDOW_DAYS} days of delivery at no cost. To exchange, start a return with reason "wrong_size" and place a new order; the replacement ships once the return is scanned.`,
    keywords: ['exchange', 'size', 'color', 'swap', 'fit', 'wrong size'],
  },
  {
    id: 'membership',
    title: 'Trail Club membership',
    body: 'Trail Club is the paid membership (free shipping, member pricing). Support agents cannot cancel, pause or refund a membership. Escalate the request to a human agent with category "membership"; the membership team replies within 2 business days.',
    keywords: ['membership', 'member', 'trail club', 'cancel', 'subscription', 'renewal'],
  },
  {
    id: 'warranty',
    title: 'Warranty',
    body: 'All gear has a 1-year warranty against manufacturing defects (for example a failed zipper, a delaminating sole or a device that will not power on). Warranty claims are reviewed by a human agent: escalate with category "warranty" and ask the customer to keep the item and any photos.',
    keywords: ['warranty', 'defect', 'defective', 'stopped working', 'faulty', 'broke', 'zipper'],
  },
];

/** Ranks articles by keyword hits in the query. Pure, so it is easy to test. */
export function searchPolicies(query: string, limit = 3): Policy[] {
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = POLICIES.map((policy) => {
    let score = 0;
    for (const keyword of policy.keywords) {
      if (q.includes(keyword)) score += keyword.includes(' ') ? 3 : 2;
    }
    const haystack = `${policy.title} ${policy.body}`.toLowerCase();
    for (const word of words) if (haystack.includes(word)) score += 1;
    return { policy, score };
  });
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.policy);
}
