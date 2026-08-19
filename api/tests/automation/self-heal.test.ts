/**
 * Self-heal (slice P2.4): a re-learned recipe supersedes IN-TENANT, unless it writes.
 *
 * Three properties, in descending order of how quietly they could stop being true:
 *   1. a heal supersedes through `recipe-store`, which bumps the version and stamps the lineage -
 *      never `publishSnapshot`, whose gate is super-admin AND which flips the row to `global`;
 *   2. a re-learned recipe containing a WRITE does not go live unattended - and a "write" includes
 *      a scripted DOM step, which the first version of this module did not look at;
 *   3. drift is classified apart from every other replay failure, so a missing daemon does not
 *      spend a pass finding out that the daemon is still missing.
 *
 * WHERE THE DRAFT COMES FROM is deliberately not this module's business: the instrumented run in
 * `service.ts` compiles it, and `discovery-replay-acceptance.test.ts` drives that end to end
 * through the production entry point. Here the draft is an input, so what is under test is the
 * DECISION about it.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyReplayDrift, healDriftedRecipe, applyHealedRecipe, writesIn } from '../../src/automation/self-heal.js';
import type { RecipeDraft, RecipeSupersedeInput, RecipeWriteResult } from '../../src/integrations/recipe-store.js';
import type { SecretRegistry } from '../../src/security/redaction.js';

/** The store method's exact signature, so `mock.calls` is a real tuple rather than `[]`. */
type Supersede = (
  orgId: string,
  key: string,
  actionName: string,
  next: RecipeSupersedeInput,
  opts?: { secrets?: SecretRegistry },
) => Promise<RecipeWriteResult>;

function draft(over: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    goal: 'replay of portal/read_case',
    injectedCalls: [{ method: 'GET', urlTemplate: 'https://portal.example/api/v2/cases', headerNames: ['x-csrf-token'], idempotent: true }],
    scriptedSteps: [],
    lessons: ['the session travels on x-csrf-token'],
    ...over,
  };
}

const input = {
  orgId: 'org-a',
  integrationKey: 'portal',
  actionName: 'read_case',
  reason: 'replayed call 1 no longer carries response.items',
};

const okSupersede = (version: number, superseded: number): RecipeWriteResult => ({
  verdict: 'ok',
  recipe: {
    version,
    goal: 'g',
    injectedCalls: [],
    scriptedSteps: [],
    lessons: [],
    compiledAt: 'now',
    supersedes: { version: superseded, reason: input.reason },
  },
});

describe('classifyReplayDrift', () => {
  it('separates a site that changed from a route that is missing', () => {
    expect(classifyReplayDrift({ outcome: 'drift' })).toBe('recipe_drift');
    // Re-learning would fail exactly the same way and burn a pass to find out.
    expect(classifyReplayDrift({ outcome: 'unavailable' })).toBe('needs_human');
    // A refusal must never be routed around by a heal.
    expect(classifyReplayDrift({ outcome: 'write-gate' })).toBe('refused');
    expect(classifyReplayDrift({ outcome: 'no-recipe' })).toBe('transport');
    expect(classifyReplayDrift({ outcome: 'ok' })).toBe('transport');
  });
});

describe('healDriftedRecipe - a read-only heal lands silently', () => {
  it('supersedes with a bumped version and the drift reason as the lineage payload', async () => {
    const supersedeRecipe = vi.fn<Supersede>(async () => okSupersede(4, 3));
    const result = await healDriftedRecipe(input, draft(), { supersedeRecipe });

    expect(result).toEqual({ outcome: 'healed', version: 4, supersededVersion: 3 });
    const [orgId, key, actionName, next] = supersedeRecipe.mock.calls[0]!;
    expect([orgId, key, actionName]).toEqual(['org-a', 'portal', 'read_case']);
    expect(next!.reason).toBe(input.reason);
    expect(next!.injectedCalls[0]!.urlTemplate).toBe('https://portal.example/api/v2/cases');
  });

  it('reports the version the STORE says it replaced, not one this process guessed', async () => {
    // The store reads the prior version inside its own CAS. A heal racing another writer must
    // report what actually happened, so `supersededVersion` follows the store's lineage stamp.
    const supersedeRecipe = vi.fn<Supersede>(async () => okSupersede(9, 7));
    const result = await healDriftedRecipe(input, draft(), { supersedeRecipe });
    expect(result).toEqual({ outcome: 'healed', version: 9, supersededVersion: 7 });
  });

  it('forwards the run registry so the store can refuse a recipe carrying a live value', async () => {
    const supersedeRecipe = vi.fn<Supersede>(async () => okSupersede(2, 1));
    const secrets = { redact: (t: string) => t } as unknown as SecretRegistry;
    await healDriftedRecipe({ ...input, secrets }, draft(), { supersedeRecipe });
    expect(supersedeRecipe.mock.calls[0]![4]).toEqual({ secrets });
  });
});

describe('healDriftedRecipe - a heal that re-authors a WRITE stops for assent', () => {
  const writeDraft = draft({
    injectedCalls: [
      { method: 'GET', urlTemplate: 'https://portal.example/api/v2/cases', headerNames: [], idempotent: true },
      { method: 'POST', urlTemplate: 'https://portal.example/api/v2/cases', headerNames: [], idempotent: false },
    ],
  });

  it('does not supersede, and HOLDS the draft rather than throwing away an expensive pass', async () => {
    const supersedeRecipe = vi.fn<Supersede>();
    const result = await healDriftedRecipe(input, writeDraft, { supersedeRecipe });

    expect(result.outcome).toBe('needs_assent');
    expect(supersedeRecipe).not.toHaveBeenCalled();
    const held = result as Extract<typeof result, { outcome: 'needs_assent' }>;
    expect(held.writes).toEqual(['POST https://portal.example/api/v2/cases']);
    expect(held.draft.injectedCalls).toHaveLength(2);
  });

  it('stops for a SCRIPTED DOM STEP too - the first version only looked at the calls', async () => {
    const supersedeRecipe = vi.fn<Supersede>();
    // Every CALL here is a read. The only thing that writes is the click, so a gate that inspects
    // only `injectedCalls` supersedes this draft and puts an unattended form submission live.
    const clickDraft = draft({
      scriptedSteps: [{ action: 'click', locator: { strategy: 'role', role: 'button', name: 'Submeter' } }],
    });
    const result = await healDriftedRecipe(input, clickDraft, { supersedeRecipe });

    expect(result.outcome).toBe('needs_assent');
    expect(supersedeRecipe).not.toHaveBeenCalled();
    expect((result as Extract<typeof result, { outcome: 'needs_assent' }>).writes).toEqual(['the scripted step "click"']);
  });

  it('does NOT stop for a read-only scripted step', async () => {
    const supersedeRecipe = vi.fn<Supersede>(async () => okSupersede(2, 1));
    const result = await healDriftedRecipe(
      input,
      draft({ scriptedSteps: [{ action: 'hover', locator: { strategy: 'text', text: 'x' } }] }),
      { supersedeRecipe },
    );
    expect(result.outcome).toBe('healed');
  });

  it('applies exactly the HELD draft once a human answers - not a fresh pass', async () => {
    const supersedeRecipe = vi.fn<Supersede>(async () => okSupersede(5, 4));
    const result = await applyHealedRecipe(input, writeDraft, { supersedeRecipe });
    expect(result).toEqual({ outcome: 'healed', version: 5, supersededVersion: 4 });
    expect(supersedeRecipe.mock.calls[0]![3]!.injectedCalls.map((c) => c.method)).toEqual(['GET', 'POST']);
  });

  it('honours an explicit assent on the heal itself', async () => {
    const supersedeRecipe = vi.fn<Supersede>(async () => okSupersede(5, 4));
    const result = await healDriftedRecipe({ ...input, writeAssent: true }, writeDraft, { supersedeRecipe });
    expect(result.outcome).toBe('healed');
    expect(supersedeRecipe).toHaveBeenCalledOnce();
  });

  it('never treats an ABSENT assent as a yes', async () => {
    const supersedeRecipe = vi.fn<Supersede>();
    for (const writeAssent of [undefined, false]) {
      const result = await healDriftedRecipe({ ...input, ...(writeAssent !== undefined ? { writeAssent } : {}) }, writeDraft, { supersedeRecipe });
      expect(result.outcome).toBe('needs_assent');
    }
    expect(supersedeRecipe).not.toHaveBeenCalled();
  });
});

describe('writesIn - the one census both gates read', () => {
  it('names every non-idempotent call and every page-changing step, and nothing else', () => {
    expect(writesIn(draft())).toEqual([]);
    expect(
      writesIn(draft({
        injectedCalls: [
          { method: 'GET', urlTemplate: 'https://a.example/x', headerNames: [], idempotent: true },
          { method: 'DELETE', urlTemplate: 'https://a.example/x/1', headerNames: [], idempotent: false },
        ],
        scriptedSteps: [
          { action: 'hover', locator: { strategy: 'text', text: 'x' } },
          { action: 'fill', locator: { strategy: 'label', label: 'Nome' }, value: 'v' },
        ],
      })),
    ).toEqual(['DELETE https://a.example/x/1', 'the scripted step "fill"']);
  });

  it('reads `idempotent` from the STORED field, so a mislabelled call is still gated by its method', () => {
    // A document could arrive claiming a POST is idempotent. `isIdempotentMethod` is what decides,
    // not the stored flag - the gate and the compile share one predicate so they cannot drift.
    expect(
      writesIn(draft({ injectedCalls: [{ method: 'POST', urlTemplate: 'https://a.example/x', headerNames: [], idempotent: true }] })),
    ).toEqual(['POST https://a.example/x']);
  });
});

describe('healDriftedRecipe - a failed supersede leaves the action alone', () => {
  it('reports a store refusal rather than claiming a heal', async () => {
    const result = await healDriftedRecipe(input, draft(), { supersedeRecipe: async () => ({ verdict: 'notfound' }) });
    expect(result).toEqual({ outcome: 'refused', reason: 'there is no recipe on that action to supersede' });
  });
});
