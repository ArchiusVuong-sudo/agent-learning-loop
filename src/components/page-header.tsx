import { Cpu, PlayCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { shellState } from '@/lib/loop/state';
import { Badge } from './ui';

/** Page title plus the badges every page shares: provider mode, live prompt and dataset version. */
export async function PageHeader({ step, title, description, actions }: { step?: string; title: string; description: ReactNode; actions?: ReactNode }) {
  const shell = await shellState();
  return (
    <header className="border-b border-slate-200 bg-white/80 px-8 pb-5 pt-6 backdrop-blur">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          {step ? <div className="text-xs font-medium text-indigo-600">{step}</div> : null}
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            {shell.mode === 'replay' ? (
              <Badge tone="warn" title={`${shell.modeReason}. Responses come from recorded live runs in fixtures/.`}>
                <PlayCircle className="h-3 w-3" /> Replay mode
              </Badge>
            ) : (
              <Badge tone="good" title={shell.modeReason}>
                <Cpu className="h-3 w-3" /> Live: Claude Agent SDK
              </Badge>
            )}
            <Badge tone="neutral">Synthetic data</Badge>
            <Badge tone="brand" title="The prompt version that serves Try box and traffic runs">Live prompt {shell.live.id}</Badge>
            <Badge tone="neutral" title="Mastra dataset version">Dataset v{shell.counts.datasetVersion}</Badge>
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}
