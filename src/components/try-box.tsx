'use client';

import { Send, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { ActionError, postJson, useAction } from './client';
import { requestOpenTrace } from './trace-list';
import { Button, Spinner } from './ui';

export function TryBox({ suggestions, liveVersion, replay }: { suggestions: string[]; liveVersion: string; replay: boolean }) {
  const [message, setMessage] = useState('');
  const { run, busy, error } = useAction();
  const send = (text: string) => {
    if (!text.trim() || busy) return;
    void run(async () => {
      const out = await postJson<{ traceId: string }>('/api/try', { message: text });
      setMessage('');
      requestOpenTrace(out.traceId);
      return out;
    });
  };
  return (
    <div className="space-y-2.5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(message);
        }}
        className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white p-1.5 pl-3.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100"
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={`Write as a customer. The support agent answers on prompt ${liveVersion}.`}
          className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          disabled={busy}
          aria-label="Customer message"
        />
        <Button type="submit" disabled={busy || message.trim().length < 3}>
          {busy ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
          {busy ? 'Agent is working' : 'Send'}
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <Sparkles className="h-3 w-3" /> Try{replay ? ' (recorded in replay mode)' : ''}:
        </span>
        {suggestions.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => setMessage(s)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50">
            {s.length > 64 ? `${s.slice(0, 62)}...` : s}
          </button>
        ))}
      </div>
      <ActionError error={error} />
    </div>
  );
}
