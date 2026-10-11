import { z } from 'zod';
import { body, handle } from '@/lib/api';
import { suggestFromState } from '@/lib/loop/suggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({ revise: z.boolean().default(false) });

/** Asks the learner for a prompt change. `revise` feeds it the failing rows of the last gate. */
export async function POST(request: Request) {
  return handle(async () => suggestFromState(await body(request, input.parse)));
}
