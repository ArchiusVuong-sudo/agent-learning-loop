import { createNextRouteHandler } from '@mastra/next';
import { getMastra } from '@/lib/mastra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Mastra API (agents, datasets, experiments, traces), so Mastra Studio can open the same data. */
export const { GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD } = createNextRouteHandler({ mastra: getMastra().mastra, prefix: '/api/mastra' });
