import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chokepoint mock: proposePatch calls runOneShot + decideForTier from
// '../llm/index.js' (was the old callSimpleLlm seam). A FIFO queue lets
// each test script its single scripted response.
const hoisted = vi.hoisted(() => ({
  responses: [] as string[],
}));

vi.mock('../../src/llm/index.js', () => ({
  runOneShot: vi.fn(async (_opts: unknown, _attr: unknown) => {
    const text = hoisted.responses.shift() ?? '';
    return { text, usage: {} };
  }),
  decideForTier: vi.fn((tier: string) => ({ tier, model: 'm', effort: 'high', weight: 1 })),
}));

import {
  proposePatch,
  applyPatch,
  detectHumanActionable,
  REHEARSAL_BUDGET,
} from '../../src/automation/rehearsal.js';
import type { Step } from '../../src/automation/types.js';

const SCREENSHOT = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const sampleSteps: Step[] = [
  { id: 'navigate', type: 'navigate', description: 'go to google', url: 'https://www.google.com' },
  { id: 'verify', type: 'verify', description: 'page loaded', expectedOutcome: 'search box ready' },
  { id: 'type', type: 'browser', description: 'type ekoa' },
];

describe('proposePatch', () => {
  beforeEach(() => {
    hoisted.responses = [];
  });

  it('returns insert_before when verifier failed because of an overlay', async () => {
    hoisted.responses.push(JSON.stringify({
      patch: 'insert_before',
      newStep: {
        id: 'dismiss-cookies',
        type: 'browser',
        description: 'Click the Accept button on the cookie consent dialog',
      },
      reasoning: 'cookie consent is blocking the search box',
    }));

    const patch = await proposePatch({
      goal: 'search for ekoa',
      steps: sampleSteps,
      currentIndex: 1,
      failureKind: 'verify_failed',
      failureMessage: 'A cookie consent modal is blocking the Google search page',
      screenshotPng: SCREENSHOT,
      pageUrl: 'https://www.google.com',
      patchesAtThisIndex: 0,
      userId: 'user-1',
    });

    expect(patch.kind).toBe('insert_before');
    if (patch.kind === 'insert_before') {
      expect(patch.newStep.type).toBe('browser');
      expect(patch.newStep.description).toMatch(/cookie/i);
    }
  });

  it('returns replace_current for a browser action that picked the wrong element', async () => {
    hoisted.responses.push(JSON.stringify({
      patch: 'replace_current',
      newStep: {
        id: 'click-export-btn',
        type: 'browser',
        description: 'Click the "Download as PDF" item in the Export submenu',
      },
      reasoning: 'previous click landed on the wrong menu item',
    }));

    const patch = await proposePatch({
      steps: sampleSteps,
      currentIndex: 2,
      failureKind: 'browser_failed',
      failureMessage: 'click hit the wrong button',
      screenshotPng: SCREENSHOT,
      pageUrl: 'https://docs.google.com/foo',
      patchesAtThisIndex: 0,
      goal: '',
      userId: 'user-1',
    });

    expect(patch.kind).toBe('replace_current');
  });

  it('rejects insert_before / replace_current with an invalid step type', async () => {
    hoisted.responses.push(JSON.stringify({
      patch: 'insert_before',
      newStep: { id: 'x', type: 'sub_automation', description: 'no' },
      reasoning: 'illegal',
    }));

    await expect(proposePatch({
      steps: sampleSteps,
      currentIndex: 1,
      failureKind: 'verify_failed',
      failureMessage: 'x',
      screenshotPng: SCREENSHOT,
      pageUrl: '',
      patchesAtThisIndex: 0,
      goal: '',
      userId: 'user-1',
    })).rejects.toThrow(/unsupported type/);
  });

  it('rejects new navigate step missing url', async () => {
    hoisted.responses.push(JSON.stringify({
      patch: 'replace_current',
      newStep: { id: 'go', type: 'navigate', description: 'go somewhere' },
      reasoning: '',
    }));

    await expect(proposePatch({
      steps: sampleSteps,
      currentIndex: 0,
      failureKind: 'navigate_failed',
      failureMessage: 'x',
      screenshotPng: SCREENSHOT,
      pageUrl: '',
      patchesAtThisIndex: 0,
      goal: '',
      userId: 'user-1',
    })).rejects.toThrow(/navigate step missing url/);
  });

  it('rejects newStep with empty description', async () => {
    hoisted.responses.push(JSON.stringify({
      patch: 'insert_before',
      newStep: { id: 'x', type: 'browser', description: '' },
      reasoning: '',
    }));

    await expect(proposePatch({
      steps: sampleSteps,
      currentIndex: 1,
      failureKind: 'verify_failed',
      failureMessage: 'x',
      screenshotPng: SCREENSHOT,
      pageUrl: '',
      patchesAtThisIndex: 0,
      goal: '',
      userId: 'user-1',
    })).rejects.toThrow(/description/);
  });

  it('parses pause_for_user with explicit user instructions', async () => {
    hoisted.responses.push(JSON.stringify({
      patch: 'pause_for_user',
      reasoning: 'Google served a reCAPTCHA',
      userInstructions: 'Solve the CAPTCHA in the open browser window, then click Continue.',
    }));
    const patch = await proposePatch({
      steps: sampleSteps, currentIndex: 1,
      failureKind: 'verify_failed',
      failureMessage: 'reCAPTCHA challenge page',
      screenshotPng: SCREENSHOT, pageUrl: 'https://www.google.com/sorry',
      patchesAtThisIndex: 0, goal: 'search ekoa',
      userId: 'user-1',
    });
    expect(patch.kind).toBe('pause_for_user');
    if (patch.kind === 'pause_for_user') {
      expect(patch.userInstructions).toMatch(/CAPTCHA/i);
      expect(patch.reasoning).toMatch(/reCAPTCHA/);
    }
  });

  it('falls back to a default user-instruction string when the model omits one', async () => {
    hoisted.responses.push(JSON.stringify({
      patch: 'pause_for_user',
      reasoning: 'login wall',
      // no userInstructions field
    }));
    const patch = await proposePatch({
      steps: sampleSteps, currentIndex: 1,
      failureKind: 'verify_failed', failureMessage: 'login wall',
      screenshotPng: SCREENSHOT, pageUrl: 'https://x.com',
      patchesAtThisIndex: 0, goal: '',
      userId: 'user-1',
    });
    expect(patch.kind).toBe('pause_for_user');
    if (patch.kind === 'pause_for_user') {
      expect(patch.userInstructions.length).toBeGreaterThan(0);
    }
  });

  it('parses skip_current and abort without requiring a newStep', async () => {
    hoisted.responses.push(JSON.stringify({ patch: 'skip_current', reasoning: 'unnecessary' }));
    const skip = await proposePatch({
      steps: sampleSteps, currentIndex: 1,
      failureKind: 'verify_failed', failureMessage: 'x',
      screenshotPng: SCREENSHOT, pageUrl: '', patchesAtThisIndex: 0, goal: '',
      userId: 'user-1',
    });
    expect(skip.kind).toBe('skip_current');

    hoisted.responses.push(JSON.stringify({ patch: 'abort', reasoning: 'paywalled' }));
    const abort = await proposePatch({
      steps: sampleSteps, currentIndex: 1,
      failureKind: 'verify_failed', failureMessage: 'x',
      screenshotPng: SCREENSHOT, pageUrl: '', patchesAtThisIndex: 0, goal: '',
      userId: 'user-1',
    });
    expect(abort.kind).toBe('abort');
  });

  it('rejects unknown patch kinds', async () => {
    hoisted.responses.push(JSON.stringify({ patch: 'rewrite_everything', reasoning: 'no' }));
    await expect(proposePatch({
      steps: sampleSteps, currentIndex: 0,
      failureKind: 'browser_failed', failureMessage: 'x',
      screenshotPng: SCREENSHOT, pageUrl: '', patchesAtThisIndex: 0, goal: '',
      userId: 'user-1',
    })).rejects.toThrow(/invalid patch kind/);
  });

  it('rejects non-JSON output', async () => {
    hoisted.responses.push('I think we should...');
    await expect(proposePatch({
      steps: sampleSteps, currentIndex: 0,
      failureKind: 'browser_failed', failureMessage: 'x',
      screenshotPng: SCREENSHOT, pageUrl: '', patchesAtThisIndex: 0, goal: '',
      userId: 'user-1',
    })).rejects.toThrow(/non-JSON/);
  });
});

describe('applyPatch', () => {
  it('insert_before places the new step at currentIndex and pushes the failing one forward', () => {
    const out = applyPatch(sampleSteps, 1, {
      kind: 'insert_before',
      newStep: { id: 'dismiss', type: 'browser', description: 'dismiss' },
      reasoning: 'r',
    });
    expect(out.map((s) => s.id)).toEqual(['navigate', 'dismiss', 'verify', 'type']);
  });

  it('replace_current swaps the failing step', () => {
    const out = applyPatch(sampleSteps, 1, {
      kind: 'replace_current',
      newStep: { id: 'verify-v2', type: 'verify', description: 'page loaded', expectedOutcome: 'logo visible' },
      reasoning: 'r',
    });
    expect(out.map((s) => s.id)).toEqual(['navigate', 'verify-v2', 'type']);
    expect(out[1]!.expectedOutcome).toBe('logo visible');
  });

  it('skip_current drops the failing step', () => {
    const out = applyPatch(sampleSteps, 2, { kind: 'skip_current', reasoning: 'unnecessary' });
    expect(out.map((s) => s.id)).toEqual(['navigate', 'verify']);
  });

  it('abort returns the steps unchanged', () => {
    const out = applyPatch(sampleSteps, 1, { kind: 'abort', reasoning: 'paywalled' });
    expect(out).toEqual(sampleSteps);
  });

  it('pause_for_user returns the steps unchanged (engine retries the same step after resume)', () => {
    const out = applyPatch(sampleSteps, 1, {
      kind: 'pause_for_user',
      reasoning: 'CAPTCHA',
      userInstructions: 'Solve the CAPTCHA, then click Continue.',
    });
    expect(out).toEqual(sampleSteps);
  });

  it('does not mutate the input array', () => {
    const before = sampleSteps.slice();
    applyPatch(sampleSteps, 1, { kind: 'skip_current', reasoning: 'r' });
    expect(sampleSteps).toEqual(before);
  });

  it('assigns a fresh id when the inserted step is missing one', () => {
    const out = applyPatch(sampleSteps, 0, {
      kind: 'insert_before',
      newStep: { id: '', type: 'wait', description: 'wait' },
      reasoning: 'r',
    });
    expect(out[0]!.id.length).toBeGreaterThan(0);
  });
});

describe('REHEARSAL_BUDGET', () => {
  it('matches the agreed limits', () => {
    // Documenting the contract — change these only with intent.
    expect(REHEARSAL_BUDGET.maxFixerCalls).toBe(25);
    expect(REHEARSAL_BUDGET.maxWallClockMs).toBe(4 * 60 * 1000);
    expect(REHEARSAL_BUDGET.maxPatchesPerIndex).toBe(5);
  });
});

describe('detectHumanActionable (fast-path)', () => {
  it('matches a verifier message describing a Google reCAPTCHA page', () => {
    const m = detectHumanActionable(
      'outcome not met: The page shows a Google reCAPTCHA verification page, not search results.',
    );
    expect(m).not.toBeNull();
    expect(m?.userInstructions).toMatch(/CAPTCHA/);
  });

  it('matches Portuguese "Não sou um robô"', () => {
    const m = detectHumanActionable('outcome not met: page asks "Não sou um robô"');
    expect(m).not.toBeNull();
    expect(m?.userInstructions).toMatch(/CAPTCHA/);
  });

  it('matches MFA / authenticator prompts', () => {
    const m = detectHumanActionable('outcome not met: enter the 6-digit code from your authenticator app');
    expect(m).not.toBeNull();
    expect(m?.userInstructions).toMatch(/authenticator/);
  });

  it('matches payment confirmation prompts', () => {
    const m = detectHumanActionable('outcome not met: the page is a 3-D Secure challenge to confirm the payment');
    expect(m).not.toBeNull();
    expect(m?.userInstructions).toMatch(/payment/);
  });

  it('returns null for unrelated failures', () => {
    expect(
      detectHumanActionable('outcome not met: the search box is missing'),
    ).toBeNull();
    expect(detectHumanActionable('')).toBeNull();
  });
});
