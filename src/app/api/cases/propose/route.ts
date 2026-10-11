import { z } from 'zod';
import { body, handle } from '@/lib/api';
import { proposeCases } from '@/lib/loop/autoevals';
import { currentFailureGroups } from '@/lib/loop/findings';
import { listSupportTraces } from '@/lib/loop/traces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({ behavior: z.string().min(2) });

export async function POST(request: Request) {
  return handle(async () => {
    const { behavior } = await body(request, input.parse);
    const groups = await currentFailureGroups(await listSupportTraces({ sources: ['seed', 'try'] }));
    const group = groups.find((g) => g.behavior === behavior);
    if (!group) throw new Error('That failure group has no failing traces');
    return proposeCases(group);
  });
}
