import { beforeAll, describe, expect, it } from 'vitest';
import { config } from '@/lib/config';
import { seedStore, storeCounts } from '@/lib/store/repo';
import { STORE_TOOL_NAMES, ToolInputError, runStoreTool, storeToolBelt, toolName } from '@/lib/store/tools';

beforeAll(async () => {
  await seedStore(config.storeToday);
});

describe('store tools', () => {
  it('exposes six tools under full MCP names', () => {
    expect(STORE_TOOL_NAMES).toHaveLength(6);
    expect(storeToolBelt().allowedTools).toEqual(STORE_TOOL_NAMES.map((n) => `mcp__store__${n}`));
    expect(toolName('create_return')).toBe('mcp__store__create_return');
  });

  it('seeding twice does not duplicate rows', async () => {
    await seedStore(config.storeToday);
    expect(await storeCounts()).toMatchObject({ customers: 40, orders: 120 });
  });

  it('validates inputs before running', async () => {
    await expect(runStoreTool('lookup_order', { orderId: '12345' })).rejects.toThrow(/ORD-12345/);
    await expect(runStoreTool('search_policy', { query: 'a' })).rejects.toBeInstanceOf(ToolInputError);
    await expect(runStoreTool('find_orders', {})).rejects.toThrow(/customerName or customerId/);
    await expect(runStoreTool('escalate_to_human', { category: 'refund', summary: 'Customer wants help now' })).rejects.toThrow(/category/);
  });

  it('looks up an order with days since delivery', async () => {
    const out = (await runStoreTool('lookup_order', { orderId: 'ord-20512' })) as Record<string, unknown>;
    expect(out).toMatchObject({ orderId: 'ORD-20512', category: 'electronics', opened: true, daysSinceDelivery: 20, price: 179 });
  });

  it('reports unknown orders as tool errors', async () => {
    await expect(runStoreTool('lookup_order', { orderId: 'ORD-00000' })).rejects.toThrow(/not found/);
  });

  it('finds orders by customer name', async () => {
    const out = (await runStoreTool('find_orders', { customerName: 'Nadia Rahman' })) as { orders: Array<{ orderId: string }> };
    expect(out.orders.map((o) => o.orderId)).toContain('ORD-20639');
  });

  it('checks eligibility with the policy engine', async () => {
    expect(await runStoreTool('check_return_eligibility', { orderId: 'ORD-20512' })).toMatchObject({ eligible: false, windowDays: 14 });
    expect(await runStoreTool('check_return_eligibility', { orderId: 'ORD-20589', reason: 'damaged_in_transit' })).toMatchObject({ requiresEscalation: true });
  });

  it('refuses returns the policy blocks (guardrail inside the tool)', async () => {
    await expect(runStoreTool('create_return', { orderId: 'ORD-20512', reason: 'changed_mind' })).rejects.toThrow(/Return refused/);
    await expect(runStoreTool('create_return', { orderId: 'ORD-20589', reason: 'damaged_in_transit' })).rejects.toThrow(/escalate_to_human/);
  });

  it('creates returns idempotently per order', async () => {
    const first = await runStoreTool('create_return', { orderId: 'ORD-20705', reason: 'changed_mind' });
    const second = await runStoreTool('create_return', { orderId: 'ORD-20705', reason: 'changed_mind' });
    expect(first).toMatchObject({ returnId: 'RMA-20705', refund: 152.15, restockingFeePct: 15 });
    expect(second).toEqual(first);
  });

  it('escalates with a ticket id', async () => {
    const out = await runStoreTool('escalate_to_human', { category: 'membership', summary: 'Customer asks to cancel the membership.' });
    expect(out).toMatchObject({ ticketId: expect.stringMatching(/^ESC-\d+$/), responseTime: '2 business days' });
  });
});
