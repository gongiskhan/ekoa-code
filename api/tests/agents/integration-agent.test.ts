/**
 * The SHARED authoring core (slice D2) — `agents/authoring-core.ts` (split out of
 * `agents/integration-agent.ts` by the D2 re-review, LOW-1: the core's "only dependency is the
 * chokepoint" is now a property of the file, not a claim about a section of one).
 *
 * The core is what the integration builder and the automation planner now BOTH author through, so
 * every case here is labelled with the caller whose policy it pins. The two policies are opposite
 * on purpose (`emptyReply`, `repairs`, `retryUnavailableOnce`), and a regression in either one is a
 * regression in a live surface: the builder's chat wire, or the planner's outage-vs-plan_failed
 * distinction.
 *
 * The chokepoint is mocked the way the planner suite mocks it (a FIFO of scripted replies) — the
 * core must never reach a provider, and nothing here does I/O.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  replies: [] as Array<string | Error>,
}));

vi.mock('../../src/llm/index.js', () => {
  class LlmAbortedError extends Error {
    constructor(message = 'LLM call aborted') {
      super(message);
      this.name = 'LlmAbortedError';
    }
  }
  return {
    LlmAbortedError,
    runOneShot: vi.fn(async (_opts: unknown, _attr: unknown) => {
      const next = hoisted.replies.shift() ?? '';
      if (next instanceof Error) throw next;
      return { text: next, usage: {} };
    }),
    decideForTier: vi.fn((tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
    decideForTask: vi.fn((_t: string, _c: unknown, tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
  };
});

import { runOneShot, LlmAbortedError } from '../../src/llm/index.js';
import { composeAuthoringPrompt, authorWithRepair, type AuthoringDraft } from '../../src/agents/authoring-core.js';

const DECISION = { tier: 'EXPERT', model: 'm', effort: 'high', weight: 1 } as const;
const ATTRIBUTION = { kind: 'user_work', agentType: 'automation-plan', billeeUserId: 'u1' } as const;

/** A parse seam that answers from a script of verdicts, one per attempt. */
function scriptedParse(verdicts: Array<{ draft: string | null; violations: string[] }>) {
  let i = 0;
  return (text: string): AuthoringDraft<string> => {
    const v = verdicts[Math.min(i, verdicts.length - 1)]!;
    i++;
    return { draft: v.draft === null ? null : `${v.draft}:${text}`, violations: [...v.violations] };
  };
}

const promptsSent = (): string[] => vi.mocked(runOneShot).mock.calls.map((c) => (c[0] as { prompt: string }).prompt);

beforeEach(() => {
  vi.mocked(runOneShot).mockClear();
  hoisted.replies = [];
});

describe('composeAuthoringPrompt — the one system-prompt rule both callers encode', () => {
  it('puts the content sections first and the output contract LAST', () => {
    expect(composeAuthoringPrompt(['# identity', '# catalog'], '# contract')).toBe('# identity\n\n# catalog\n\n# contract');
  });

  it('drops empty sections instead of emitting blank separators', () => {
    expect(composeAuthoringPrompt(['a', '', 'b'], 'c')).toBe('a\n\nb\n\nc');
    expect(composeAuthoringPrompt([], 'only-the-contract')).toBe('only-the-contract');
  });
});

describe('one turn through the chokepoint', () => {
  it('sends the composed system prompt, the first-attempt user text, the decision and the attribution', async () => {
    hoisted.replies.push('the answer');
    const outcome = await authorWithRepair<string>({
      contentSections: ['# sections'],
      outputContract: '# contract',
      userText: (violations) => (violations === null ? 'first attempt' : 'repair'),
      decision: DECISION,
      attribution: ATTRIBUTION,
      emptyReply: 'unavailable',
      parse: scriptedParse([{ draft: 'ok', violations: [] }]),
    });

    expect(runOneShot).toHaveBeenCalledTimes(1);
    const [opts, attr] = vi.mocked(runOneShot).mock.calls[0]!;
    expect((opts as { systemPrompt: string }).systemPrompt).toBe('# sections\n\n# contract');
    expect((opts as { prompt: string }).prompt).toBe('first attempt');
    expect((opts as { decision: { tier: string } }).decision.tier).toBe('EXPERT');
    expect(attr).toEqual(ATTRIBUTION);
    expect(outcome.status).toBe('authored');
    if (outcome.status !== 'authored') throw new Error('expected authored');
    expect(outcome.draft).toBe('ok:the answer');
    expect(outcome.text).toBe('the answer');
    expect(outcome.attempts).toBe(1);
  });
});

describe("the BUILDER's policy: repairs 0, emptyReply 'text', no plain retry", () => {
  const builderRun = (parse: (text: string) => AuthoringDraft<string>) =>
    authorWithRepair<string>({
      contentSections: [],
      outputContract: '# reply language',
      userText: () => 'the user message',
      decision: DECISION,
      attribution: ATTRIBUTION,
      emptyReply: 'text',
      parse,
    });

  it('an EMPTY reply is an ordinary package-less turn, never an outage (the builder chat wire)', async () => {
    hoisted.replies.push('');
    const outcome = await builderRun(scriptedParse([{ draft: null, violations: [] }]));
    expect(outcome.status).toBe('authored');
    if (outcome.status !== 'authored') throw new Error('expected authored');
    expect(outcome.text).toBe('');
    expect(runOneShot).toHaveBeenCalledTimes(1);
  });

  it('violations are SURFACED, never auto-repaired — the builder’s repair loop is the human', async () => {
    hoisted.replies.push('a package with problems', 'a second reply that must never be requested');
    const outcome = await builderRun(scriptedParse([{ draft: 'pkg', violations: ['Missing displayName'] }]));
    expect(runOneShot).toHaveBeenCalledTimes(1);
    if (outcome.status !== 'authored') throw new Error('expected authored');
    expect(outcome.violations).toEqual(['Missing displayName']);
    expect(outcome.draft).toBe('pkg:a package with problems');
    expect(outcome.attempts).toBe(1);
  });

  it('a transport failure is unavailable with the ORIGINAL error as cause, and is not retried', async () => {
    hoisted.replies.push(new Error('ECONNREFUSED 127.0.0.1:443'));
    const outcome = await builderRun(scriptedParse([{ draft: 'unused', violations: [] }]));
    expect(runOneShot).toHaveBeenCalledTimes(1);
    if (outcome.status !== 'unavailable') throw new Error('expected unavailable');
    expect(outcome.reason).toBe('transport');
    expect(outcome.detail).toMatch(/ECONNREFUSED/);
    expect(outcome.cause).toBeInstanceOf(Error);
  });
});

describe("the PLANNER's policy: repairs 1, emptyReply 'unavailable', one plain retry", () => {
  const repairs: string[][] = [];
  const unavailable: Array<{ reason: string; willRetry: boolean }> = [];
  const plannerRun = (parse: (text: string) => AuthoringDraft<string>) =>
    authorWithRepair<string>({
      contentSections: [],
      outputContract: '# planner system',
      userText: (violations) => (violations === null ? 'BASE|plan now' : `BASE|rejected: ${violations.join(';')}`),
      decision: DECISION,
      attribution: ATTRIBUTION,
      emptyReply: 'unavailable',
      parse,
      repairs: 1,
      retryUnavailableOnce: true,
      onRepair: (v) => repairs.push([...v]),
      onUnavailable: (i) => unavailable.push({ reason: i.reason, willRetry: i.willRetry }),
    });

  beforeEach(() => {
    repairs.length = 0;
    unavailable.length = 0;
  });

  it('feeds the violations back into ONE corrective retry and returns the clean second draft', async () => {
    hoisted.replies.push('bad plan', 'good plan');
    const outcome = await plannerRun(
      scriptedParse([{ draft: 'plan', violations: ['step 1 names a connected integration'] }, { draft: 'plan', violations: [] }]),
    );

    expect(runOneShot).toHaveBeenCalledTimes(2);
    expect(promptsSent()[0]).toBe('BASE|plan now');
    expect(promptsSent()[1]).toBe('BASE|rejected: step 1 names a connected integration');
    expect(repairs).toEqual([['step 1 names a connected integration']]);
    if (outcome.status !== 'authored') throw new Error('expected authored');
    expect(outcome.violations).toEqual([]);
    expect(outcome.draft).toBe('plan:good plan');
    expect(outcome.attempts).toBe(2);
  });

  it('violations still open after the retry come back as the LAST attempt’s verdict (a structured failure)', async () => {
    hoisted.replies.push('bad plan', 'still bad', 'a third call that must never happen');
    const outcome = await plannerRun(
      scriptedParse([{ draft: 'plan', violations: ['v1'] }, { draft: 'plan', violations: ['v2'] }]),
    );

    expect(runOneShot).toHaveBeenCalledTimes(2);
    if (outcome.status !== 'authored') throw new Error('expected authored');
    expect(outcome.violations).toEqual(['v2']);
    expect(outcome.attempts).toBe(2);
  });

  it('an EMPTY reply is an outage: one PLAIN retry with the same text (never the repair text)', async () => {
    hoisted.replies.push('', '');
    const outcome = await plannerRun(scriptedParse([{ draft: 'plan', violations: [] }]));

    expect(runOneShot).toHaveBeenCalledTimes(2);
    expect(promptsSent()[1]).toBe('BASE|plan now');
    expect(promptsSent()[1]).not.toMatch(/rejected/);
    if (outcome.status !== 'unavailable') throw new Error('expected unavailable');
    expect(outcome.reason).toBe('empty');
    expect(outcome.detail).toBe('empty model response');
    expect(outcome.attempts).toBe(2);
    expect(unavailable).toEqual([
      { reason: 'empty', willRetry: true },
      { reason: 'empty', willRetry: false },
    ]);
  });

  it('the egress recovering on the plain retry continues the normal flow', async () => {
    hoisted.replies.push('', 'good plan');
    const outcome = await plannerRun(scriptedParse([{ draft: 'plan', violations: [] }]));
    expect(runOneShot).toHaveBeenCalledTimes(2);
    if (outcome.status !== 'authored') throw new Error('expected authored');
    expect(outcome.draft).toBe('plan:good plan');
  });

  it('the plain retry is the FIRST attempt’s privilege only — an outage during the repair attempt is final', async () => {
    hoisted.replies.push('bad plan', new Error('ECONNRESET'), 'a third call that must never happen');
    const outcome = await plannerRun(scriptedParse([{ draft: 'plan', violations: ['v1'] }]));

    expect(runOneShot).toHaveBeenCalledTimes(2);
    if (outcome.status !== 'unavailable') throw new Error('expected unavailable');
    expect(outcome.reason).toBe('transport');
    expect(unavailable).toEqual([{ reason: 'transport', willRetry: false }]);
  });

  it('a deliberate ABORT is never retried and keeps its typed error (the route owns that mapping)', async () => {
    hoisted.replies.push(new LlmAbortedError(), 'a retry that must never happen');
    const outcome = await plannerRun(scriptedParse([{ draft: 'plan', violations: [] }]));

    expect(runOneShot).toHaveBeenCalledTimes(1); // NOT the outage retry, even with retryUnavailableOnce
    if (outcome.status !== 'unavailable') throw new Error('expected unavailable');
    expect(outcome.reason).toBe('aborted');
    expect(outcome.cause).toBeInstanceOf(LlmAbortedError);
    expect(unavailable).toEqual([{ reason: 'aborted', willRetry: false }]);
  });
});
