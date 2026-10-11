'use client';

import { Rocket, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ActionError, postJson, useAction } from './client';
import { Button, Spinner } from './ui';

export function PromoteButton({ candidate, disabled }: { candidate: string; disabled?: boolean }) {
  const router = useRouter();
  const { run, busy, error } = useAction();
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="good"
        disabled={disabled || busy}
        onClick={async () => {
          const out = await run(() => postJson('/api/versions', { action: 'promote' }));
          if (out) router.push('/versions');
        }}
      >
        {busy ? <Spinner /> : <Rocket className="h-3.5 w-3.5" />} Promote {candidate}
      </Button>
      <ActionError error={error} />
    </div>
  );
}

export function RollbackButton({ target }: { target: string }) {
  const { run, busy, error } = useAction();
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="danger" disabled={busy} onClick={() => run(() => postJson('/api/versions', { action: 'rollback' }))}>
        {busy ? <Spinner /> : <Undo2 className="h-3.5 w-3.5" />} Roll back to {target}
      </Button>
      <ActionError error={error} />
    </div>
  );
}
