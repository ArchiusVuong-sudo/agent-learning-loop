import type { RequestContext } from '@mastra/core/request-context';
import { ANALYST_SYSTEM, AUTHOR_SYSTEM, JUDGE_SYSTEM, LEARNER_SYSTEM, OFFLINE_JUDGE_SYSTEM } from '../loop/prompts';
import { getVersion, liveVersion } from '../loop/versions';
import { storeToolBelt } from '../store/tools';
import { SdkAgent } from './sdk-agent';

export const SUPPORT_AGENT_ID = 'support-agent';

/** requestContext keys the support agent reads. */
export const CTX_PROMPT_VERSION = 'promptVersion';

async function supportSystem(ctx: RequestContext) {
  const requested = ctx.get(CTX_PROMPT_VERSION) as string | undefined;
  const version = requested ? await getVersion(requested) : await liveVersion();
  if (!version) throw new Error(`Unknown prompt version ${requested}`);
  return { system: version.text, promptVersion: version.id };
}

const fixed = (system: string) => async () => ({ system });

export function createAgents() {
  return {
    supportAgent: new SdkAgent({
      id: SUPPORT_AGENT_ID,
      name: 'Support agent',
      description: 'Customer support for a synthetic outdoor gear store, with six store tools.',
      role: 'support',
      resolveSystem: supportSystem,
      tools: storeToolBelt,
      anchor: (prompt, resolved) => `${resolved.promptVersion ?? 'live'}::${prompt}`,
    }),
    onlineJudge: new SdkAgent({ id: 'online-judge', name: 'Online judge', description: 'Reference-free check of one trace against its tool results.', role: 'judge', resolveSystem: fixed(JUDGE_SYSTEM) }),
    caseJudge: new SdkAgent({ id: 'case-judge', name: 'Case judge', description: 'Grades a reply against must and mustNot lines.', role: 'judge', resolveSystem: fixed(OFFLINE_JUDGE_SYSTEM) }),
    analyst: new SdkAgent({ id: 'trace-analyst', name: 'Trace analyst', description: 'Tags goal, outcome and behaviors for one trace.', role: 'analyst', resolveSystem: fixed(ANALYST_SYSTEM) }),
    evalAuthor: new SdkAgent({ id: 'eval-author', name: 'Eval author', description: 'Drafts eval cases from a failure group.', role: 'author', resolveSystem: fixed(AUTHOR_SYSTEM) }),
    learner: new SdkAgent({ id: 'prompt-learner', name: 'Prompt learner', description: 'Proposes a minimal prompt edit from evidence.', role: 'learner', resolveSystem: fixed(LEARNER_SYSTEM) }),
  };
}

export type Agents = ReturnType<typeof createAgents>;
