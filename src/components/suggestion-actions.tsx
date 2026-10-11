'use client';

import { Check, RotateCcw, Sparkles, X } from 'lucide-react';
import { ActionError, postJson, useAction } from './client';
import { Button, Spinner } from './ui';

export function SuggestButtons({ canSuggest, canRevise, hasSuggestion }: { canSuggest: boolean; canRevise: boolean; hasSuggestion: boolean }) {
  const suggest = useAction();
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {canRevise ? (
          <Button variant="primary" disabled={suggest.busy} onClick={() => suggest.run(() => postJson('/api/suggestions', { revise: true }))}>
            {suggest.busy ? <Spinner /> : <RotateCcw className="h-3.5 w-3.5" />} Revise from gate results
          </Button>
        ) : null}
        <Button variant={canRevise || hasSuggestion ? 'secondary' : 'primary'} disabled={!canSuggest || suggest.busy} onClick={() => suggest.run(() => postJson('/api/suggestions', { revise: false }))}>
          {suggest.busy ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" />} {suggest.busy ? 'Learner is thinking' : hasSuggestion ? 'Suggest again' : 'Suggest fix'}
        </Button>
      </div>
      <ActionError error={suggest.error} />
    </div>
  );
}

export function ReviewButtons({ id, nextVersion }: { id: string; nextVersion: string }) {
  const approve = useAction();
  return (
    <div className="flex items-center gap-2">
      <ActionError error={approve.error} />
      <Button variant="ghost" disabled={approve.busy} onClick={() => approve.run(() => postJson(`/api/suggestions/${id}`, { action: 'reject' }))}>
        <X className="h-3.5 w-3.5" /> Reject
      </Button>
      <Button variant="good" disabled={approve.busy} onClick={() => approve.run(() => postJson(`/api/suggestions/${id}`, { action: 'approve' }))}>
        {approve.busy ? <Spinner /> : <Check className="h-3.5 w-3.5" />} Approve as {nextVersion}
      </Button>
    </div>
  );
}
