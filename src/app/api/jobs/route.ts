import { handle } from '@/lib/api';
import { latestJobs } from '@/lib/loop/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => latestJobs());
}
