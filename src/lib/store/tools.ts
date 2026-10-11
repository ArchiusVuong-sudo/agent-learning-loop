import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config } from '../config';
import type { ToolBelt } from '../llm/types';
import { daysBetween } from './catalog';
import { evaluateReturn, RETURN_REASONS } from './eligibility';
import { searchPolicies } from './policies';
import { createEscalation, createReturnRecord, findCustomers, getCustomer, getOrder, ordersForCustomer } from './repo';

export const STORE_SERVER = 'store';
export const toolName = (name: StoreToolName) => `mcp__${STORE_SERVER}__${name}` as const;

const orderId = z
  .string()
  .trim()
  .regex(/^ORD-\d{5}$/i, 'Order ids look like ORD-12345');

/** Input shapes, shared by the MCP server and the unit tests. */
export const toolInputs = {
  search_policy: { query: z.string().trim().min(2).max(200).describe('Keywords, for example "opened electronics return"') },
  find_orders: {
    customerName: z.string().trim().min(2).max(80).optional().describe('Full or partial customer name'),
    customerId: z.string().trim().regex(/^C-\d{4}$/).optional().describe('Customer id like C-1001'),
  },
  lookup_order: { orderId },
  check_return_eligibility: {
    orderId,
    reason: z.enum(RETURN_REASONS).default('changed_mind').describe('Why the customer wants to send it back'),
  },
  create_return: { orderId, reason: z.enum(RETURN_REASONS) },
  escalate_to_human: {
    category: z.enum(['damage_claim', 'membership', 'warranty', 'other']),
    summary: z.string().trim().min(10).max(600).describe('What the customer needs, in one or two sentences'),
    orderId: orderId.optional(),
  },
} as const;

export type StoreToolName = keyof typeof toolInputs;
export const STORE_TOOL_NAMES = Object.keys(toolInputs) as StoreToolName[];

export class ToolInputError extends Error {}

type Handler = (input: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<StoreToolName, Handler> = {
  async search_policy(input) {
    const results = searchPolicies(String(input.query));
    return { results: results.map(({ id, title, body }) => ({ id, title, body })) };
  },

  async find_orders(input) {
    let customerId = input.customerId ? String(input.customerId) : undefined;
    if (!customerId && !input.customerName) throw new ToolInputError('Provide customerName or customerId.');
    if (!customerId) {
      const matches = await findCustomers(String(input.customerName));
      if (matches.length === 0) return { customers: [], orders: [], note: 'No customer with that name.' };
      if (matches.length > 1) return { customers: matches, orders: [], note: 'Several customers match; ask which one.' };
      customerId = matches[0]!.id;
    }
    const customer = await getCustomer(customerId);
    if (!customer) return { customers: [], orders: [], note: 'No customer with that id.' };
    const orders = await ordersForCustomer(customerId);
    return {
      customers: [customer],
      orders: orders.map((o) => ({ orderId: o.id, item: o.item, status: o.status, deliveredOn: o.deliveredOn, price: o.priceCents / 100 })),
    };
  },

  async lookup_order(input) {
    const order = await getOrder(String(input.orderId));
    if (!order) throw new ToolInputError(`Order ${String(input.orderId)} was not found.`);
    const customer = await getCustomer(order.customerId);
    return {
      orderId: order.id,
      customer: customer ? { id: customer.id, name: customer.name, tier: customer.tier } : null,
      item: order.item,
      category: order.category,
      price: order.priceCents / 100,
      status: order.status,
      orderedOn: order.orderedOn,
      deliveredOn: order.deliveredOn,
      daysSinceDelivery: order.deliveredOn ? daysBetween(order.deliveredOn, config.storeToday) : null,
      opened: order.opened,
      finalSale: order.finalSale,
      today: config.storeToday,
    };
  },

  async check_return_eligibility(input) {
    const order = await getOrder(String(input.orderId));
    if (!order) throw new ToolInputError(`Order ${String(input.orderId)} was not found.`);
    return evaluateReturn(order, config.storeToday, input.reason as (typeof RETURN_REASONS)[number]);
  },

  async create_return(input) {
    const order = await getOrder(String(input.orderId));
    if (!order) throw new ToolInputError(`Order ${String(input.orderId)} was not found.`);
    const verdict = evaluateReturn(order, config.storeToday, input.reason as (typeof RETURN_REASONS)[number]);
    // Guardrail: the tool itself refuses returns the policy does not allow.
    if (!verdict.eligible) {
      throw new ToolInputError(`Return refused: ${verdict.explanation}${verdict.requiresEscalation ? ' Use escalate_to_human instead.' : ''}`);
    }
    const refundCents = Math.round(verdict.refundEstimate * 100);
    const returnId = await createReturnRecord(order, String(input.reason), refundCents, order.priceCents - refundCents);
    return { returnId, orderId: order.id, refund: verdict.refundEstimate, restockingFeePct: verdict.restockingFeePct, refundTiming: '5-7 business days after the item reaches the warehouse' };
  },

  async escalate_to_human(input) {
    const ticketId = await createEscalation(String(input.category), String(input.summary), input.orderId ? String(input.orderId).toUpperCase() : null);
    return { ticketId, category: input.category, responseTime: input.category === 'membership' ? '2 business days' : '1 business day' };
  },
};

/** Validates input against the tool's schema, then runs it. Used by the MCP server and tests. */
export async function runStoreTool(name: StoreToolName, rawInput: unknown): Promise<unknown> {
  const parsed = z.object(toolInputs[name]).safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolInputError(parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return handlers[name](parsed.data as Record<string, unknown>);
}

const DESCRIPTIONS: Record<StoreToolName, string> = {
  search_policy: 'Search the store help-center policies (returns, electronics, final sale, damage, refunds, exchanges, membership, warranty).',
  find_orders: 'Find a customer and their recent orders by name or customer id.',
  lookup_order: 'Get one order: item, category, price, delivery date, days since delivery, opened and final-sale flags.',
  check_return_eligibility: 'Check whether an order can be returned under current policy, with the refund estimate and fees.',
  create_return: 'Start a return for an eligible order. Refuses orders the policy does not allow.',
  escalate_to_human: 'Hand the case to a human agent (damage claims of $200 or more, membership changes, warranty claims).',
};

function asContent(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

/**
 * The in-process MCP server the support agent talks to. A fresh server per run, because an MCP
 * server instance binds to one transport and runs execute concurrently.
 */
export function storeToolBelt(): ToolBelt {
  const tools = STORE_TOOL_NAMES.map((name) =>
    tool(name, DESCRIPTIONS[name], toolInputs[name], async (input: unknown) => {
      try {
        return asContent(await runStoreTool(name, input));
      } catch (error) {
        return asContent(error instanceof Error ? error.message : String(error), true);
      }
    }),
  );
  const server = createSdkMcpServer({ name: STORE_SERVER, version: '1.0.0', tools });
  return { serverName: STORE_SERVER, server, allowedTools: STORE_TOOL_NAMES.map(toolName) };
}
