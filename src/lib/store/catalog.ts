/**
 * Synthetic store data. Every customer, order and product here is made up; the generator is
 * seeded so every install gets the same rows.
 */
export type Category = 'electronics' | 'footwear' | 'apparel' | 'camping';

export interface Customer {
  id: string;
  name: string;
  tier: 'member' | 'guest';
  memberSince: string | null;
}

export interface Order {
  id: string;
  customerId: string;
  sku: string;
  item: string;
  category: Category;
  priceCents: number;
  orderedOn: string;
  deliveredOn: string | null;
  status: 'delivered' | 'in_transit';
  opened: boolean;
  finalSale: boolean;
}

export function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

interface AnchorOrder {
  customer: string;
  tier?: 'member';
  orderId: string;
  item: string;
  category: Category;
  price: number;
  deliveredDaysAgo: number | null;
  opened?: boolean;
  finalSale?: boolean;
}

/** Orders the synthetic traffic refers to by id. */
const ANCHORS: AnchorOrder[] = [
  { customer: 'Imani Okafor', orderId: 'ORD-20431', item: 'Ridgeline hiking boots', category: 'footwear', price: 149, deliveredDaysAgo: null },
  { customer: 'Theo Lindqvist', orderId: 'ORD-20457', item: 'Trail running shoes', category: 'footwear', price: 129, deliveredDaysAgo: 10 },
  { customer: 'Rowan Pike', orderId: 'ORD-20512', item: 'Trail wireless headphones', category: 'electronics', price: 179, deliveredDaysAgo: 20, opened: true },
  { customer: 'Priya Raman', orderId: 'ORD-20533', item: 'Summit handheld GPS', category: 'electronics', price: 249, deliveredDaysAgo: 18, opened: true },
  { customer: 'Mateo Duarte', orderId: 'ORD-20548', item: 'Lumen 400 headlamp', category: 'electronics', price: 59, deliveredDaysAgo: 9, opened: true },
  { customer: 'Hana Sato', orderId: 'ORD-20561', item: 'Rain shell jacket (clearance)', category: 'apparel', price: 89, deliveredDaysAgo: 6, finalSale: true },
  { customer: 'Felix Brandt', orderId: 'ORD-20577', item: 'Grid fleece pullover (clearance)', category: 'apparel', price: 45, deliveredDaysAgo: 3, finalSale: true },
  { customer: 'Amara Nwosu', orderId: 'ORD-20589', item: 'Basecamp 4 tent', category: 'camping', price: 340, deliveredDaysAgo: 2 },
  { customer: 'Jonah Whitley', orderId: 'ORD-20594', item: 'Compact camp stove', category: 'camping', price: 89, deliveredDaysAgo: 3 },
  { customer: 'Leila Haddad', orderId: 'ORD-20602', item: 'Expedition 65L backpack', category: 'camping', price: 260, deliveredDaysAgo: 4 },
  { customer: 'Oskar Nilsen', tier: 'member', orderId: 'ORD-20607', item: 'Merino hiking socks (3 pack)', category: 'apparel', price: 36, deliveredDaysAgo: 30 },
  { customer: 'Zoe Marchetti', tier: 'member', orderId: 'ORD-20611', item: 'Packable sun hat', category: 'apparel', price: 32, deliveredDaysAgo: 45 },
  { customer: 'Ravi Iyer', orderId: 'ORD-20618', item: 'Insulated bottle set', category: 'camping', price: 39, deliveredDaysAgo: 40 },
  { customer: 'Elena Petrova', orderId: 'ORD-20624', item: 'Waterproof hiking boots', category: 'footwear', price: 169, deliveredDaysAgo: 26 },
  { customer: 'Kai Halvorsen', orderId: 'ORD-20633', item: 'Alpine down jacket', category: 'apparel', price: 229, deliveredDaysAgo: 8 },
  { customer: 'Nadia Rahman', orderId: 'ORD-20639', item: 'Camp chair', category: 'camping', price: 69, deliveredDaysAgo: 21 },
  { customer: 'Caleb Moreau', orderId: 'ORD-20645', item: 'Ridge trekking poles', category: 'camping', price: 99, deliveredDaysAgo: 150 },
  { customer: 'Sofia Lindgren', orderId: 'ORD-20652', item: 'Trailcam action camera', category: 'electronics', price: 299, deliveredDaysAgo: 12, opened: true },
  { customer: 'Ibrahim Diallo', orderId: 'ORD-20667', item: 'Trail GPS watch', category: 'electronics', price: 329, deliveredDaysAgo: 25, opened: true },
  { customer: 'Mei Chen', orderId: 'ORD-20671', item: 'Softshell jacket', category: 'apparel', price: 119, deliveredDaysAgo: 25 },
  { customer: 'Lucas Ferreira', orderId: 'ORD-20688', item: 'Ultralight 2 tent', category: 'camping', price: 279, deliveredDaysAgo: 20, opened: true },
  { customer: 'Ana Kovac', orderId: 'ORD-20694', item: 'Lumen 400 headlamp', category: 'electronics', price: 59, deliveredDaysAgo: 1 },
  { customer: 'Tomas Novak', tier: 'member', orderId: 'ORD-20699', item: 'Trail running vest', category: 'apparel', price: 95, deliveredDaysAgo: 60 },
  { customer: 'Yara Lund', orderId: 'ORD-20705', item: 'Trail wireless headphones', category: 'electronics', price: 179, deliveredDaysAgo: 5, opened: true },
  // Held-out traffic for the shadow run.
  { customer: 'Elena Petrova', orderId: 'ORD-20712', item: 'Trail GPS watch', category: 'electronics', price: 329, deliveredDaysAgo: 16, opened: true },
  { customer: 'Noor Aziz', orderId: 'ORD-20718', item: 'River sandals (clearance)', category: 'footwear', price: 49, deliveredDaysAgo: 4, finalSale: true },
  { customer: 'Bram Visser', orderId: 'ORD-20723', item: 'Inflatable sleeping pad', category: 'camping', price: 45, deliveredDaysAgo: 2 },
  { customer: 'Ines Carvalho', orderId: 'ORD-20731', item: 'Basecamp 6 tent', category: 'camping', price: 480, deliveredDaysAgo: 1 },
  { customer: 'Dmitri Volkov', tier: 'member', orderId: 'ORD-20735', item: 'Merino base layer', category: 'apparel', price: 79, deliveredDaysAgo: 50 },
  { customer: 'Ruth Abebe', orderId: 'ORD-20740', item: 'Approach shoes', category: 'footwear', price: 139, deliveredDaysAgo: 12 },
  { customer: 'Sven Aalto', orderId: 'ORD-20746', item: 'Trail wireless headphones', category: 'electronics', price: 179, deliveredDaysAgo: 9, opened: true },
  { customer: 'Mira Joshi', orderId: 'ORD-20749', item: 'Hiking day pack 22L', category: 'camping', price: 85, deliveredDaysAgo: 14 },
  // Golden set.
  { customer: 'Lena Fischer', orderId: 'ORD-20755', item: 'Merino base layer', category: 'apparel', price: 79, deliveredDaysAgo: null },
  { customer: 'Omar Saleh', orderId: 'ORD-20761', item: 'Trail running vest', category: 'apparel', price: 95, deliveredDaysAgo: 6 },
  { customer: 'Grace Odhiambo', orderId: 'ORD-20768', item: 'Leather hiking boots', category: 'footwear', price: 159, deliveredDaysAgo: 11 },
  { customer: 'Henrik Dahl', orderId: 'ORD-20774', item: 'Camp cookset', category: 'camping', price: 65, deliveredDaysAgo: 2 },
];

const FIRST = ['Alex', 'Bea', 'Cass', 'Dara', 'Eli', 'Fen', 'Gus', 'Ivy', 'Jude', 'Kit', 'Lior', 'Maren', 'Nico', 'Odile', 'Pax', 'Quinn', 'Rhea', 'Sami', 'Tova', 'Uri'];
const LAST = ['Ashby', 'Brook', 'Carver', 'Dunmore', 'Ellery', 'Frost', 'Garrow', 'Hollis', 'Ingram', 'Jessop', 'Kerrigan', 'Lowell', 'Marsh', 'Northam', 'Orrin', 'Pell'];
const PRODUCTS: Array<{ item: string; category: Category; price: number }> = [
  { item: 'Trail wireless headphones', category: 'electronics', price: 179 },
  { item: 'Lumen 400 headlamp', category: 'electronics', price: 59 },
  { item: 'Summit handheld GPS', category: 'electronics', price: 249 },
  { item: 'Trail running shoes', category: 'footwear', price: 129 },
  { item: 'Ridgeline hiking boots', category: 'footwear', price: 149 },
  { item: 'Camp slippers', category: 'footwear', price: 49 },
  { item: 'Softshell jacket', category: 'apparel', price: 119 },
  { item: 'Merino hiking socks (3 pack)', category: 'apparel', price: 36 },
  { item: 'Packable sun hat', category: 'apparel', price: 32 },
  { item: 'Ultralight 2 tent', category: 'camping', price: 279 },
  { item: 'Compact camp stove', category: 'camping', price: 89 },
  { item: 'Insulated bottle set', category: 'camping', price: 39 },
  { item: 'Camp chair', category: 'camping', price: 69 },
];

/** mulberry32: a tiny seeded PRNG so the filler rows are the same on every machine. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCatalog(today: string): { customers: Customer[]; orders: Order[] } {
  const customers = new Map<string, Customer>();
  const orders: Order[] = [];
  const byName = new Map<string, string>();
  const customerFor = (name: string, tier: 'member' | 'guest'): string => {
    const existing = byName.get(name);
    if (existing) return existing;
    const id = `C-${1001 + customers.size}`;
    customers.set(id, { id, name, tier, memberSince: tier === 'member' ? shiftDays(today, -400 - customers.size * 7) : null });
    byName.set(name, id);
    return id;
  };

  for (const anchor of ANCHORS) {
    const customerId = customerFor(anchor.customer, anchor.tier ?? 'guest');
    const deliveredOn = anchor.deliveredDaysAgo === null ? null : shiftDays(today, -anchor.deliveredDaysAgo);
    orders.push({
      id: anchor.orderId,
      customerId,
      sku: `SKU-${anchor.orderId.slice(4)}`,
      item: anchor.item,
      category: anchor.category,
      priceCents: anchor.price * 100,
      orderedOn: shiftDays(deliveredOn ?? today, -4),
      deliveredOn,
      status: deliveredOn ? 'delivered' : 'in_transit',
      opened: anchor.opened ?? false,
      finalSale: anchor.finalSale ?? false,
    });
  }

  const random = prng(20261001);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  while (customers.size < 40) {
    customerFor(`${pick(FIRST)} ${pick(LAST)}`, random() < 0.3 ? 'member' : 'guest');
  }
  const customerIds = [...customers.keys()];
  let next = 30001;
  while (orders.length < 120) {
    const product = pick(PRODUCTS);
    const deliveredDaysAgo = Math.floor(random() * 90);
    const deliveredOn = shiftDays(today, -deliveredDaysAgo);
    orders.push({
      id: `ORD-${next}`,
      customerId: pick(customerIds),
      sku: `SKU-${next}`,
      item: product.item,
      category: product.category,
      priceCents: product.price * 100,
      orderedOn: shiftDays(deliveredOn, -4),
      deliveredOn,
      status: 'delivered',
      opened: product.category === 'electronics' && random() < 0.6,
      finalSale: random() < 0.08,
    });
    next += 1;
  }
  return { customers: [...customers.values()], orders };
}
