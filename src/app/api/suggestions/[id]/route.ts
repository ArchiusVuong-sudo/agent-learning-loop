import { z } from 'zod';
import { body, handle } from '@/lib/api';
import { approveSuggestion, rejectSuggestion } from '@/lib/loop/suggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({ action: z.enum(['approve', 'reject']) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const { action } = await body(request, input.parse);
    if (action === 'approve') return approveSuggestion(id);
    await rejectSuggestion(id);
    return { ok: true };
  });
}
