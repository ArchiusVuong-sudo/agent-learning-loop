import { z } from 'zod';
import { body, handle } from '@/lib/api';
import { updateProposal } from '@/lib/loop/autoevals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({ status: z.enum(['proposed', 'approved', 'rejected']).optional(), body: z.unknown().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => updateProposal(id, await body(request, input.parse)));
}
