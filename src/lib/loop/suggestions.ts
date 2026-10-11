import { randomUUID } from 'node:crypto';
import { diffLines } from 'diff';
import { z } from 'zod';
import { audit, json, one, run, str } from '../db';
import { agents } from '../mastra';
import { datasetSummary } from './autoevals';
import { currentFailureGroups, type FailureGroup } from './findings';
import { latestGate } from './gate';
import { listSupportTraces } from './traces';
import { candidateVersion, createCandidate, getVersion, liveVersion } from './versions';

export const promptEditSchema = z.object({
  find: z.string().max(2000).describe('Exact text to replace; empty string appends'),
  replace: z.string().max(2000),
  reason: z.string().min(5).max(300),
  evidenceRequestIds: z.array(z.string().max(12)).min(1).max(8),
});
export type PromptEdit = z.infer<typeof promptEditSchema>;

export const learnerOutputSchema = z.object({
  summary: z.string().min(5).max(300),
  edits: z.array(promptEditSchema).min(1).max(5),
});

export class EditError extends Error {}

const occurrences = (haystack: string, needle: string) => {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
};

/** Applies find/replace edits in order. Every `find` must match exactly once, so edits stay minimal. */
export function applyEdits(prompt: string, edits: PromptEdit[]): string {
  let text = prompt;
  for (const [index, edit] of edits.entries()) {
    if (edit.find === '') {
      text = `${text.trimEnd()}\n${edit.replace}`;
      continue;
    }
    const count = occurrences(text, edit.find);
    if (count !== 1) throw new EditError(`Edit ${index + 1} must match the prompt exactly once, but its "find" text matched ${count} times.`);
    text = text.replace(edit.find, () => edit.replace);
  }
  return text;
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  return diffLines(before, after).flatMap((part) =>
    part.value
      .replace(/\n$/, '')
      .split('\n')
      .map((text) => ({ kind: part.added ? ('added' as const) : part.removed ? ('removed' as const) : ('same' as const), text })),
  );
}

export interface LearnerCase {
  title: string;
  input: string;
  must: string[];
  mustNot: string[];
  expectedToolPath: string[];
  golden: boolean;
}

/** What the previous candidate got wrong in its gate, so the learner can revise. */
export interface GateFeedback {
  candidateVersion: string;
  candidateText: string;
  failures: Array<{ title: string; status: string; reason: string; expectedToolPath: string[]; actualToolPath: string[] }>;
}

const short = (names: string[]) => names.map((n) => n.replace(/^mcp__[^_]+__/, '')).join(' > ') || '(none)';

export function learnerPrompt(current: string, groups: FailureGroup[], cases: LearnerCase[], revision?: GateFeedback, feedback?: string): string {
  const groupText = groups
    .slice(0, 6)
    .map((g) => `## ${g.label} (${g.behavior}): ${g.count} traces\n${g.traces.slice(0, 5).map((t) => `- ${t.requestId}: ${t.reason}`).join('\n')}`)
    .join('\n\n');
  const caseText = (list: LearnerCase[]) =>
    list.map((c) => `- ${c.title}\n  input: ${c.input}\n  must: ${c.must.join(' | ')}\n  mustNot: ${c.mustNot.join(' | ') || '(none)'}\n  tool path: ${short(c.expectedToolPath)}`).join('\n') || '(none)';
  const revisionText = revision
    ? `\n\nA previous candidate (${revision.candidateVersion}) failed the gate. Its prompt was:\n"""\n${revision.candidateText}\n"""\nFailing gate rows:\n${revision.failures
        .map((f) => `- ${f.title} [${f.status}]: ${f.reason} Expected tools: ${short(f.expectedToolPath)}. Actual: ${short(f.actualToolPath)}.`)
        .join('\n')}\nPropose edits to the CURRENT prompt that keep what that candidate fixed and avoid these failures.`
    : '';
  return `Current prompt:\n"""\n${current}\n"""\n\nFailure groups from online checks:\n${groupText}\n\nApproved regression cases the new prompt must pass:\n${caseText(cases.filter((c) => !c.golden))}\n\nGolden cases that pass today and must keep passing, tool paths included:\n${caseText(cases.filter((c) => c.golden))}${revisionText}${feedback ? `\n\nYour previous answer could not be applied: ${feedback} Copy "find" text exactly from the current prompt.` : ''}`;
}

export interface Suggestion {
  id: string;
  baseVersion: string;
  proposedText: string;
  summary: string;
  edits: PromptEdit[];
  status: 'proposed' | 'approved' | 'rejected';
  candidateVersion: string | null;
  createdAt: string;
}

const toSuggestion = (row: Record<string, unknown>): Suggestion => {
  const stored = json<{ summary: string; edits: PromptEdit[] }>(row.edits, { summary: '', edits: [] });
  return {
    id: str(row.id),
    baseVersion: str(row.base_version),
    proposedText: str(row.proposed_text),
    summary: stored.summary,
    edits: stored.edits,
    status: str(row.status) as Suggestion['status'],
    candidateVersion: row.candidate_version ? str(row.candidate_version) : null,
    createdAt: str(row.created_at),
  };
};

/** Asks the learner for a minimal prompt change and checks that it applies cleanly. */
export async function suggestFix(groups: FailureGroup[], cases: LearnerCase[], revision?: GateFeedback): Promise<Suggestion> {
  const base = await liveVersion();
  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = (await agents().learner.generate(learnerPrompt(base.text, groups, cases, revision, feedback), {
      structuredOutput: { schema: learnerOutputSchema },
      anchor: `learner::${base.id}::${revision ? `revise-${revision.candidateVersion}` : 'first'}::${attempt}`,
      tracingOptions: { metadata: { source: 'learner', baseVersion: base.id } },
    })) as { object: z.infer<typeof learnerOutputSchema> };
    try {
      const proposedText = applyEdits(base.text, out.object.edits);
      const id = randomUUID();
      await run("UPDATE suggestions SET status = 'rejected' WHERE status = 'proposed'");
      await run('INSERT INTO suggestions (id, base_version, proposed_text, edits, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        base.id,
        proposedText,
        JSON.stringify(out.object),
        'proposed',
        new Date().toISOString(),
      ]);
      return (await getSuggestion(id))!;
    } catch (error) {
      if (!(error instanceof EditError) || attempt === 2) throw error;
      feedback = error.message;
    }
  }
  throw new Error('unreachable');
}

export async function getSuggestion(id: string): Promise<Suggestion | null> {
  return one('SELECT * FROM suggestions WHERE id = ?', [id], toSuggestion);
}

export async function latestSuggestion(): Promise<Suggestion | null> {
  return one('SELECT * FROM suggestions ORDER BY created_at DESC LIMIT 1', [], toSuggestion);
}

/** Saves the suggestion as a candidate version. Live traffic stays on the current live version. */
export async function approveSuggestion(id: string) {
  const suggestion = await getSuggestion(id);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'proposed') throw new Error(`Suggestion is already ${suggestion.status}`);
  if (!(await getVersion(suggestion.baseVersion))) throw new Error('Base version is gone');
  const version = await createCandidate(suggestion.proposedText, suggestion.baseVersion, suggestion.id, suggestion.summary);
  await run("UPDATE suggestions SET status = 'approved', candidate_version = ? WHERE id = ?", [version.id, id]);
  await audit('reviewer', 'suggestion_approved', { suggestion: id, candidate: version.id });
  return version;
}

export async function rejectSuggestion(id: string): Promise<void> {
  await run("UPDATE suggestions SET status = 'rejected' WHERE id = ? AND status = 'proposed'", [id]);
  await audit('reviewer', 'suggestion_rejected', { suggestion: id });
}

/**
 * Gathers the learner's evidence from current state: failure groups, every dataset case, and,
 * when the latest gate failed for the current candidate, that gate's failing rows.
 */
export async function suggestFromState(options: { revise: boolean }): Promise<Suggestion> {
  const groups = await currentFailureGroups(await listSupportTraces({ sources: ['seed', 'try'] }));
  if (!groups.length) throw new Error('No failure groups yet: run traffic and analysis first');
  const dataset = await datasetSummary();
  const cases: LearnerCase[] = dataset.items.map((item) => ({
    title: item.metadata.title ?? item.input.slice(0, 60),
    input: item.input,
    must: item.groundTruth.must,
    mustNot: item.groundTruth.mustNot,
    expectedToolPath: item.expectedToolPath,
    golden: item.metadata.golden === true,
  }));
  let revision: GateFeedback | undefined;
  if (options.revise) {
    const [gate, candidate] = await Promise.all([latestGate(), candidateVersion()]);
    if (!gate?.report || gate.status !== 'failed' || !candidate || gate.candidateVersion !== candidate.id) throw new Error('There is no failed gate for the current candidate to learn from');
    revision = {
      candidateVersion: candidate.id,
      candidateText: candidate.text,
      failures: gate.report.rows
        .filter((r) => !r.candidate.passed)
        .map((r) => ({
          title: r.title,
          status: r.status,
          reason: r.candidate.judge === 1 ? `Judge passed, but the tool path scored ${r.candidate.trajectory ?? 'n/a'}.` : r.candidate.judgeReason,
          expectedToolPath: r.expectedToolPath,
          actualToolPath: r.candidate.toolPath,
        })),
    };
  }
  return suggestFix(groups, cases, revision);
}
