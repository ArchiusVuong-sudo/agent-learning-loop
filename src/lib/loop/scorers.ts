import { createScorer } from '@mastra/core/evals';
import { createTrajectoryAccuracyScorerCode } from '@mastra/evals/scorers/prebuilt';
import { z } from 'zod';
import { renderTrace } from './checks';
import { getTraceView } from './traces';

export const CASE_JUDGE_SCORER_ID = 'case-judge-scorer';
export const TRAJECTORY_SCORER_ID = 'code-trajectory-accuracy-scorer';

export const groundTruthSchema = z.object({
  must: z.array(z.string().min(3)).min(1),
  mustNot: z.array(z.string().min(3)),
});
export type GroundTruth = z.infer<typeof groundTruthSchema>;

export const caseVerdictSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1).max(600),
  failedLines: z.array(z.string()).max(8),
});
export type CaseVerdict = z.infer<typeof caseVerdictSchema>;

export function renderCase(trace: Parameters<typeof renderTrace>[0], truth: GroundTruth): string {
  return `${renderTrace(trace)}\n\nmust:\n${truth.must.map((l) => `- ${l}`).join('\n')}\n\nmustNot:\n${truth.mustNot.map((l) => `- ${l}`).join('\n') || '- (none)'}`;
}

type AgentOutput = { text?: string; traceId?: string | null };

/** Lazy import keeps mastra.ts -> scorers.ts -> mastra.ts from forming a load-time cycle. */
async function caseJudge() {
  const { agents } = await import('../mastra');
  return agents().caseJudge;
}

/**
 * Ground-truth judge for experiments. A function analyze step calls a second SDK agent (on a
 * different model than the support agent), so it needs no provider API key.
 */
export function createCaseJudgeScorer() {
  return createScorer({ id: CASE_JUDGE_SCORER_ID, name: 'Case judge', description: 'Checks the reply and tool calls against must and mustNot lines.' })
    .analyze(async ({ run }) => {
      const truth = groundTruthSchema.parse(run.groundTruth);
      const output = (run.output ?? {}) as AgentOutput;
      const view = output.traceId ? await getTraceView(output.traceId) : null;
      const trace = view ?? { input: String(run.input), reply: output.text ?? '', toolCalls: [] };
      const judge = await caseJudge();
      const result = (await judge.generate(renderCase(trace, truth), {
        structuredOutput: { schema: caseVerdictSchema },
        // Replay falls back to the recorded verdict for this exact run if a person edited the lines.
        anchor: renderTrace(trace),
        tracingOptions: { metadata: { source: 'case-judge', judgedTraceId: output.traceId ?? null } },
      })) as { object: CaseVerdict };
      return { ...result.object, toolPath: trace.toolCalls.map((c) => c.name) };
    })
    .generateScore(({ results }) => (results.analyzeStepResult.pass ? 1 : 0))
    .generateReason(({ results }) => results.analyzeStepResult.reason);
}

export function createScorers() {
  return {
    caseJudge: createCaseJudgeScorer(),
    trajectory: createTrajectoryAccuracyScorerCode({ comparisonOptions: { ordering: 'relaxed', allowRepeatedSteps: true } }),
  };
}
