'use client';

import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, Cpu, Wrench, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CheckResult } from '@/lib/loop/checks';
import type { SpanView, TraceView } from '@/lib/loop/traces';
import { Badge, PassDot, cn, secs, shortTool, usd } from './ui';

export interface TraceRow {
  trace: TraceView;
  check: CheckResult | null;
}

function Json({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <pre className="scroll-thin max-h-48 overflow-auto rounded-md bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">{text}</pre>;
}

function SpanIcon({ type }: { type: string }) {
  if (type === 'agent_run') return <Bot className="h-3.5 w-3.5 text-indigo-600" />;
  if (type === 'model_generation') return <Cpu className="h-3.5 w-3.5 text-sky-600" />;
  return <Wrench className="h-3.5 w-3.5 text-amber-600" />;
}

function SpanTree({ spans }: { spans: SpanView[] }) {
  const [open, setOpen] = useState<string | null>(spans.find((s) => s.type === 'mcp_tool_call')?.spanId ?? null);
  const depth = (span: SpanView): number => {
    const parent = spans.find((s) => s.spanId === span.parentSpanId);
    return parent ? depth(parent) + 1 : 0;
  };
  return (
    <div className="space-y-1">
      {spans.map((span) => {
        const isTool = span.type === 'mcp_tool_call' || span.type === 'tool_call';
        const expanded = open === span.spanId;
        const usage = span.attributes.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        return (
          <div key={span.spanId} style={{ marginLeft: depth(span) * 18 }}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : span.spanId)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50', span.error && 'bg-rose-50/60')}
            >
              {isTool ? expanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" /> : <span className="w-3" />}
              <SpanIcon type={span.type} />
              <span className="font-mono text-[11px] text-slate-500">{span.type}</span>
              <span className="truncate font-medium text-slate-800">{isTool ? shortTool(String(span.name.match(/'(.+)'/)?.[1] ?? span.name)) : span.name}</span>
              {usage?.inputTokens ? <span className="text-[11px] text-slate-400">{usage.inputTokens} in / {usage.outputTokens} out tokens</span> : null}
              {span.error ? <Badge tone="bad">error</Badge> : null}
              <span className="ml-auto tabular-nums text-[11px] text-slate-400">{secs(span.durationMs)}</span>
            </button>
            {isTool && expanded ? (
              <div className="grid grid-cols-2 gap-2 px-2 pb-2 pl-9">
                <div>
                  <div className="mb-1 text-[11px] font-medium text-slate-500">Args</div>
                  <Json value={span.input} />
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium text-slate-500">{span.error ? 'Error' : 'Result'}</div>
                  <Json value={span.error ?? span.output} />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function CheckPanel({ check }: { check: CheckResult | null }) {
  if (!check) return <div className="text-xs text-slate-500">Not checked yet.</div>;
  return (
    <div className="space-y-3">
      <div className={cn('rounded-lg px-3 py-2 text-xs', check.judge.verdict === 'pass' ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900')}>
        <div className="mb-0.5 flex items-center gap-1.5 font-semibold">
          {check.judge.verdict === 'pass' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          Grounded-reply judge: {check.judge.verdict}
        </div>
        {check.judge.reason}
        {check.judge.issues.length ? (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {check.judge.issues.map((issue, i) => (
              <li key={i}>
                <span className="font-mono">{issue.kind}</span>: {issue.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {check.rules.map((rule) => (
          <li key={rule.id} className="flex gap-2 text-xs">
            {rule.passed ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-rose-500" />}
            <div>
              <div className={cn('font-medium', rule.passed ? 'text-slate-700' : 'text-rose-700')}>{rule.label}</div>
              {!rule.passed ? <div className="text-slate-600">{rule.detail}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TraceDetail({ row }: { row: TraceRow }) {
  const { trace, check } = row;
  return (
    <div className="grid grid-cols-[1.25fr_1fr] gap-5 border-t border-slate-100 bg-slate-50/50 px-5 py-4">
      <div className="min-w-0 space-y-3">
        <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Customer</div>
          <p className="mt-1 text-sm text-slate-800">{trace.input}</p>
          <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">Agent reply</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{trace.reply || <span className="text-rose-600">{trace.error ?? 'No reply'}</span>}</p>
        </div>
        <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
          <div className="flex items-center justify-between px-2 pb-1 pt-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Span tree</span>
            <span className="font-mono text-[11px] text-slate-400">
              {trace.replayed ? 'span times from the replay, ' : ''}trace {trace.traceId.slice(0, 12)}
            </span>
          </div>
          <SpanTree spans={trace.spans} />
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">Online checks</div>
        <CheckPanel check={check} />
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
            <div className="text-slate-400">{trace.replayed ? 'Latency (live run)' : 'Latency'}</div>
            <div className="font-semibold tabular-nums">{secs(trace.durationMs)}</div>
          </div>
          <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
            <div className="text-slate-400">SDK cost est.</div>
            <div className="font-semibold tabular-nums">{usd(trace.costUsd)}</div>
          </div>
          <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
            <div className="text-slate-400">Model</div>
            <div className="truncate font-semibold">{trace.model ?? '-'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Window event the try box sends with a trace id so the list opens it after the refresh. */
export const OPEN_TRACE_EVENT = 'open-trace';

export function TraceList({ rows, initialOpen }: { rows: TraceRow[]; initialOpen?: string | null }) {
  const [open, setOpen] = useState<string | null>(initialOpen ?? null);
  useEffect(() => {
    if (initialOpen) setOpen(initialOpen);
  }, [initialOpen]);
  // A trace to open once it shows up in the list: from the URL hash, or from the try box.
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => {
    const fromHash = () => setWanted(window.location.hash.slice(1) || null);
    const fromEvent = (event: Event) => setWanted((event as CustomEvent<string>).detail);
    fromHash();
    window.addEventListener('hashchange', fromHash);
    window.addEventListener(OPEN_TRACE_EVENT, fromEvent);
    return () => {
      window.removeEventListener('hashchange', fromHash);
      window.removeEventListener(OPEN_TRACE_EVENT, fromEvent);
    };
  }, []);
  useEffect(() => {
    if (!wanted) return;
    const match = rows.find((r) => r.trace.requestId === wanted || r.trace.traceId === wanted);
    if (!match) return;
    setOpen(match.trace.traceId);
    setWanted(null);
    setTimeout(() => document.getElementById(`trace-${match.trace.traceId}`)?.scrollIntoView({ block: 'center' }), 50);
  }, [rows, wanted]);
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row) => {
        const { trace, check } = row;
        const expanded = open === trace.traceId;
        const failedRules = check?.rules.filter((r) => !r.passed) ?? [];
        return (
          <div key={trace.traceId} id={`trace-${trace.traceId}`} className={cn(check && !check.passed && 'bg-rose-50/30')}>
            <button type="button" onClick={() => setOpen(expanded ? null : trace.traceId)} className="grid w-full grid-cols-[18px_56px_minmax(0,1fr)_220px_64px_64px] items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50">
              {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
              <span className="flex items-center gap-2">
                <PassDot passed={check ? check.passed : null} />
                <span className="font-mono text-xs text-slate-500">{trace.requestId?.startsWith('try-') ? 'try' : trace.requestId}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-800">{trace.input}</span>
                <span className={cn('block truncate text-xs', check && !check.passed ? 'text-rose-700' : 'text-slate-500')}>
                  {check ? (check.passed ? check.judge.reason : check.judge.verdict === 'fail' ? check.judge.reason : failedRules[0]?.detail) : 'Checking...'}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {trace.toolCalls.length ? (
                  trace.toolCalls.map((c, i) => (
                    <Badge key={i} tone={c.isError ? 'bad' : 'neutral'} className="font-mono">
                      {c.shortName}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-slate-400">no tools</span>
                )}
              </span>
              <span className="text-right">
                <Badge tone={trace.source === 'try' ? 'info' : 'neutral'}>{trace.promptVersion}</Badge>
              </span>
              <span className="text-right text-xs tabular-nums text-slate-500">{secs(trace.durationMs)}</span>
            </button>
            {expanded ? <TraceDetail row={row} /> : null}
          </div>
        );
      })}
    </div>
  );
}
