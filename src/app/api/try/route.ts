import { z } from 'zod';
import { body, handle } from '@/lib/api';
import { num, one } from '@/lib/db';
import { runSupport } from '@/lib/loop/runner';
import { liveVersion } from '@/lib/loop/versions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({ message: z.string().trim().min(3).max(800) });

/** One live customer message on the live prompt. Shows up as a new trace with source "try". */
export async function POST(request: Request) {
  return handle(async () => {
    const { message } = await body(request, input.parse);
    // Request ids count up per prompt version (try-v1-1, try-v1-2, ...), as in the recorded walkthrough.
    const version = (await liveVersion()).id;
    const tried = await one('SELECT COUNT(*) AS n FROM trace_checks WHERE source = ? AND prompt_version = ?', ['try', version], (row) => num(row.n));
    const out = await runSupport(message, { source: 'try', requestId: `try-${version}-${(tried ?? 0) + 1}`, promptVersion: version });
    return { traceId: out.traceId, passed: out.check.passed, reply: out.trace.reply };
  });
}
