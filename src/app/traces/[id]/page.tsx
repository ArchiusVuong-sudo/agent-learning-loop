import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { TraceDetail } from '@/components/trace-list';
import { Badge, Card } from '@/components/ui';
import { getCheck } from '@/lib/loop/checks';
import { getTraceView } from '@/lib/loop/traces';

export const dynamic = 'force-dynamic';

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trace = await getTraceView(id);
  if (!trace) notFound();
  const check = await getCheck(id);
  return (
    <>
      <PageHeader
        step={`Trace ${id.slice(0, 12)}`}
        title={`${trace.requestId ?? 'Run'} on prompt ${trace.promptVersion ?? '-'}`}
        description={
          <span className="flex items-center gap-2">
            <Badge tone="neutral">source: {trace.source}</Badge>
            <Link href="/traces" className="text-indigo-600 hover:underline">
              All traces
            </Link>
          </span>
        }
      />
      <div className="px-8 py-6">
        <Card className="overflow-hidden">
          <TraceDetail row={{ trace, check }} />
        </Card>
      </div>
    </>
  );
}
