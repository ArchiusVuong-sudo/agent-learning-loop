import { z } from 'zod';
import { body, handle } from '@/lib/api';
import { promoteCandidate, rollback } from '@/lib/loop/rollout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({ action: z.enum(['promote', 'rollback']) });

export async function POST(request: Request) {
  return handle(async () => {
    const { action } = await body(request, input.parse);
    return action === 'promote' ? promoteCandidate() : rollback();
  });
}
