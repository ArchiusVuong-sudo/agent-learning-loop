import { all, db, num, one, run, str } from '../db';
import { buildCatalog, type Category, type Customer, type Order } from './catalog';
import { POLICIES } from './policies';

const toOrder = (row: Record<string, unknown>): Order => ({
  id: str(row.id),
  customerId: str(row.customer_id),
  sku: str(row.sku),
  item: str(row.item),
  category: str(row.category) as Category,
  priceCents: num(row.price_cents),
  orderedOn: str(row.ordered_on),
  deliveredOn: row.delivered_on ? str(row.delivered_on) : null,
  status: str(row.status) as Order['status'],
  opened: num(row.opened) === 1,
  finalSale: num(row.final_sale) === 1,
});

const toCustomer = (row: Record<string, unknown>): Customer => ({
  id: str(row.id),
  name: str(row.name),
  tier: str(row.tier) as Customer['tier'],
  memberSince: row.member_since ? str(row.member_since) : null,
});

/** Writes the synthetic catalog. Idempotent: skips when the store already has orders. */
export async function seedStore(today: string): Promise<{ customers: number; orders: number; policies: number }> {
  const existing = await one('SELECT COUNT(*) AS n FROM orders', [], (row) => num(row.n));
  const { customers, orders } = buildCatalog(today);
  if (!existing) {
    const client = await db();
    await client.batch(
      [
        ...customers.map((c) => ({ sql: 'INSERT INTO customers (id, name, tier, member_since) VALUES (?, ?, ?, ?)', args: [c.id, c.name, c.tier, c.memberSince] })),
        ...orders.map((o) => ({
          sql: 'INSERT INTO orders (id, customer_id, sku, item, category, price_cents, ordered_on, delivered_on, status, opened, final_sale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [o.id, o.customerId, o.sku, o.item, o.category, o.priceCents, o.orderedOn, o.deliveredOn, o.status, o.opened ? 1 : 0, o.finalSale ? 1 : 0],
        })),
        ...POLICIES.map((p) => ({ sql: 'INSERT INTO policies (id, title, body, keywords) VALUES (?, ?, ?, ?)', args: [p.id, p.title, p.body, p.keywords.join(',')] })),
      ],
      'write',
    );
  }
  return { customers: customers.length, orders: orders.length, policies: POLICIES.length };
}

export async function getOrder(id: string): Promise<Order | null> {
  return one('SELECT * FROM orders WHERE id = ?', [id.toUpperCase()], toOrder);
}

export async function getCustomer(id: string): Promise<Customer | null> {
  return one('SELECT * FROM customers WHERE id = ?', [id], toCustomer);
}

export async function findCustomers(name: string): Promise<Customer[]> {
  return all('SELECT * FROM customers WHERE lower(name) LIKE ? ORDER BY name LIMIT 5', [`%${name.toLowerCase().trim()}%`], toCustomer);
}

export async function ordersForCustomer(customerId: string): Promise<Order[]> {
  return all('SELECT * FROM orders WHERE customer_id = ? ORDER BY ordered_on DESC LIMIT 10', [customerId], toOrder);
}

/** Upsert keyed by order, with an id derived from it, so repeated eval runs stay independent. */
export async function createReturnRecord(order: Order, reason: string, refundCents: number, feeCents: number): Promise<string> {
  const id = `RMA-${order.id.slice(4)}`;
  await run(
    `INSERT INTO returns (id, order_id, reason, refund_cents, fee_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET reason = excluded.reason, refund_cents = excluded.refund_cents, fee_cents = excluded.fee_cents`,
    [id, order.id, reason, refundCents, feeCents, new Date().toISOString()],
  );
  return id;
}

export async function createEscalation(category: string, summary: string, orderId: string | null): Promise<string> {
  const count = await one('SELECT COUNT(*) AS n FROM escalations', [], (row) => num(row.n));
  const id = `ESC-${String(4101 + (count ?? 0))}`;
  await run('INSERT INTO escalations (id, order_id, category, summary, created_at) VALUES (?, ?, ?, ?, ?)', [id, orderId, category, summary, new Date().toISOString()]);
  return id;
}

export async function storeCounts(): Promise<{ customers: number; orders: number; returns: number; escalations: number }> {
  const count = (table: string) => one(`SELECT COUNT(*) AS n FROM ${table}`, [], (row) => num(row.n)).then((n) => n ?? 0);
  const [customers, orders, returns, escalations] = await Promise.all([count('customers'), count('orders'), count('returns'), count('escalations')]);
  return { customers, orders, returns, escalations };
}
