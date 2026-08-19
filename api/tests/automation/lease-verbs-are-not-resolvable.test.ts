import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { resolvePlaywrightAction } from '../../src/automation/vision.js';
import { parseCompiledRecipe } from '../../src/automation/recipe.js';
import { LocalBrowserAction } from '@ekoa/shared';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { PlaywrightAction } from '../../src/automation/types.js';

/**
 * A STEP CAN NEVER END ITS OWN RUN.
 *
 * The daemon holds one page and one cookie jar per browser lease, and two verbs on the wire operate
 * on that lease rather than on a page: `release` (drop the page, WIPE the injected Cofre session out
 * of a jar the next run shares) and `keepalive`. If either could arrive as a resolved STEP, an
 * ordinary automation step could tear its own browser down mid-run - or, with a release resolved
 * early, sign the user out and keep going against a blank page.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS IN `api/`. The invariant used to be "asserted" in
 * `shared/src/local-execution.test.ts` by a line that read
 * `expect(ACTIONS.some(a => a.action === 'release')).toBe(false)` - where ACTIONS is a literal array
 * declared in that same file. No change to any source file could make it fail; adding `release` to
 * the api's `PlaywrightAction` union left it green. And it could not have been fixed in place:
 * `shared/` may not import `api/` (FIXED-1), so nothing there can see Cortex's own union.
 *
 * The invariant is really held in three places, and all three are exercised here:
 *   1. THE TYPE. `PlaywrightAction` has no lifecycle member, enforced at compile time by the
 *      exhaustive switch in `automation/cache.ts` (a new member breaks the build) and by the
 *      type-level assertion at the bottom of this file.
 *   2. THE VISION RESOLVER. `VALID_ACTION_KINDS` in `automation/vision.ts` is the allowlist a model
 *      completion has to pass to become an action at all.
 *   3. RECIPE REPLAY. `PLAYWRIGHT_ACTION_KINDS` in `automation/recipe.ts` is the allowlist a STORED
 *      action has to pass to be replayed against a live authenticated session.
 * Adding a lifecycle verb to any one of them turns this file red.
 */
const LIFECYCLE_VERBS = ['release', 'keepalive'] as const;

// NO LIVE MODEL AND NO BROWSER: the resolver's transport is the injected chokepoint seam. The
// mongo harness is here only because the chokepoint resolves a credential before it calls out.
beforeAll(() => bootAgentTestDb('ekoa_lease_verbs'));
afterAll(shutdownAgentTestDb);
afterEach(restoreTransport);

/** Run the resolver against a scripted model completion. */
async function resolveWith(modelJson: string): Promise<{ kind: string }> {
  resetAgentState({ oneShotText: modelJson });
  const out = await resolvePlaywrightAction({
    stepDescription: 'clique em Entrar',
    pageUrl: 'https://portal.test/login',
    screenshotPng: Buffer.from('PNGBYTES'),
    scopedMemories: [],
    userId: 'u1',
    tier: 'expert',
  });
  return out.action as { kind: string };
}

describe('THE VISION RESOLVER cannot return a lease lifecycle verb', () => {
  it('accepts an ordinary action, so the refusals below are about the KIND and nothing else', async () => {
    const action = await resolveWith(
      JSON.stringify({ action: { kind: 'click', locator: { strategy: 'testid', value: 'entrar' } }, confidence: 'high' }),
    );
    expect(action.kind).toBe('click');
  });

  it.each(LIFECYCLE_VERBS)('REFUSES a model completion that resolves a step into `%s`', async (verb) => {
    await expect(resolveWith(JSON.stringify({ action: { kind: verb }, confidence: 'high' }))).rejects.toThrow(
      /invalid action kind/,
    );
  });
});

describe('RECIPE REPLAY cannot replay a lease lifecycle verb', () => {
  // A stored recipe is replayed against a LIVE authenticated session, and the store is a Mongo
  // document this process treats as `unknown` - it may have been written by another build, or
  // poisoned. Replay re-validates rather than casting.
  const base = {
    version: 1,
    goal: 'entrar',
    compiledAt: '2026-08-19T00:00:00.000Z',
    injectedCalls: [],
    lessons: [],
    scriptedSteps: [{ locator: { strategy: 'role', role: 'button', name: 'Entrar' }, action: 'click' }],
  };

  it('parses the control recipe, so the refusals below are about the ACTION and nothing else', () => {
    expect(parseCompiledRecipe(base)).not.toBeNull();
  });

  it.each(LIFECYCLE_VERBS)('answers null for a stored step whose action is `%s`', (verb) => {
    expect(
      parseCompiledRecipe({
        ...base,
        scriptedSteps: [{ locator: { strategy: 'role', role: 'button', name: 'Entrar' }, action: verb }],
      }),
    ).toBeNull();
  });
});

describe('THE WIRE agrees - the daemon would refuse one as a page action too', () => {
  it.each(LIFECYCLE_VERBS)('`%s` is not a member of the page-action union', (verb) => {
    expect(LocalBrowserAction.safeParse({ action: verb }).success).toBe(false);
  });
});

/**
 * THE TYPE-LEVEL HALF, which fails `npm run typecheck` rather than the test run.
 *
 * `PlaywrightAction` is what every resolver, the planner, the action cache and `toDaemonInput` are
 * typed against. If a lifecycle member were added to it, `NoLifecycleInPlaywrightAction` stops
 * being `true` and this file no longer compiles - which is the earliest possible failure and the
 * one that costs nothing to run.
 */
type NoLifecycleInPlaywrightAction =
  Extract<PlaywrightAction, { kind: (typeof LIFECYCLE_VERBS)[number] }> extends never ? true : false;
const LIFECYCLE_IS_NOT_AN_ACTION: NoLifecycleInPlaywrightAction = true;

describe('THE TYPE - PlaywrightAction has no lifecycle member', () => {
  it('compiles, which is the assertion (see the comment above)', () => {
    expect(LIFECYCLE_IS_NOT_AN_ACTION).toBe(true);
  });
});
