import { handle } from '@/lib/api';
import { addApprovedToDataset } from '@/lib/loop/autoevals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return handle(() => addApprovedToDataset());
}
