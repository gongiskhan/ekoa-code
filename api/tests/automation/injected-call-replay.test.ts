/**
 * Replaying a compiled recipe (slice P2.3) - the ladder, the write gate (T4), drift detection, and
 * the two things an ARGUMENT is not allowed to decide.
 *
 * The ladder's ORDER is the security property, not just the performance one: the in-page rung is
 * the only one that inherits the authenticated jar, SameSite and the page's TLS session (T3), and
 * the server-side rung is restricted to permissive origins precisely because it inherits none of
 * them. A test that only checked "the call was made" would pass with the ladder inverted.
 *
 * TWO PROPERTIES HERE WERE DEFECTS IN THE FIRST VERSION OF THIS MODULE, and each has a test whose
 * fixture the old code would have passed:
 *
 *   - posture was resolved ONCE, from the recipe's first call, and applied to every call. The
 *     `spans two origins` cases below use a recipe whose SECOND call is to a different host, so a
 *     first-call verdict is visibly the wrong answer;
 *   - the write gate had no key. `writeAssent` is now set by the mount from the owner's actual
 *     approval, and the gate additionally covers SCRIPTED DOM STEPS, which the first version
 *     replayed with no gate at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { replayCompiledAction, scriptedStepWrites, type ReplayResult } from '../../src/automation/executors/injected-call.js';
import type { BrowserSession } from '../../src/automation/browser-session.js';
import type { OriginClassification } from '../../src/automation/origin-posture.js';
import { classifyOrigin } from '../../src/automation/origin-posture.js';
import { PLAYWRIGHT_ACTION_KINDS } from '../../src/automation/recipe.js';
import { secretRegistryFromValues } from '../../src/security/redaction.js';

const PERMISSIVE: OriginClassification = Object.freeze({ posture: 'permissive', requiresAttendedAuth: false, cloudEgressAllowed: true });
const ADVERSARIAL: OriginClassification = Object.freeze({ posture: 'adversarial', requiresAttendedAuth: false, cloudEgressAllowed: false });

/** Every origin gets the same answer. Fine for the cases where posture is not what is under test. */
const always = (verdict: OriginClassification) => () => verdict;

/** The realistic shape: ONE origin is declared permissive, everything else gets the closed answer.
 *  This is what `classifyOrigin` produces for an action carrying an `httpConfig.baseUrl`. */
const permissiveOnly = (origin: string) => (asked: string) =>
  asked === origin ? PERMISSIVE : ADVERSARIAL;

function recipe(over: Record<string, unknown> = {}): unknown {
  return {
    version: 3,
    goal: 'read case {{input.ref}}',
    injectedCalls: [
      {
        method: 'GET',
        urlTemplate: 'https://portal.example/api/cases?ref={{input.ref}}',
        headerNames: ['accept', 'x-csrf-token'],
        expectShape: { kind: 'object', keys: { items: { kind: 'array', of: { kind: 'object', keys: { id: { kind: 'number' } } } } } },
        idempotent: true,
      },
    ],
    scriptedSteps: [],
    lessons: [],
    compiledAt: '2026-08-18T10:00:00.000Z',
    ...over,
  };
}

/** Two calls, two DIFFERENT hosts - the shape a single-verdict posture gets wrong. */
const TWO_ORIGIN_RECIPE = recipe({
  injectedCalls: [
    { method: 'GET', urlTemplate: 'https://portal.example/api/cases', headerNames: [], idempotent: true },
    { method: 'GET', urlTemplate: 'https://cdn.other.example/api/docs', headerNames: [], idempotent: true },
  ],
});

type Answer = { status: number; bodyText: string };

function session(answer: Answer | (() => never)): BrowserSession & { calls: unknown[]; acts: unknown[] } {
  const calls: unknown[] = [];
  const acts: unknown[] = [];
  return {
    calls,
    acts,
    act: vi.fn(async (action: unknown) => { acts.push(action); }),
    assert: async () => true as const,
    observe: async () => undefined,
    ensureObserved: async () => undefined,
    hasObservation: () => true,
    screenshotPng: () => Buffer.from('png'),
    screenshotB64: () => 'cG5n',
    url: () => 'https://portal.example/cases',
    fingerprint: () => ({ origin: 'https://portal.example', pathname: '/', pathSuffix: '', titleHash: 'h', headingHash: 'h', domShapeHash: 'h', viewport: { w: 1, h: 1 } }),
    accessibilitySnapshot: () => undefined,
    injectCall: vi.fn(async (call: unknown) => {
      calls.push(call);
      // A thrower stands in for "the page could not make the call at all"; it never returns.
      const a: Answer = typeof answer === 'function' ? answer() : answer;
      return { status: a.status, ok: a.status < 400, bodyText: a.bodyText, responseHeaderNames: ['content-type'] };
    }),
  } as unknown as BrowserSession & { calls: unknown[]; acts: unknown[] };
}

const base = {
  orgId: 'org-a',
  integrationKey: 'portal',
  actionName: 'read_case',
  args: { ref: '2024-1' },
};

describe('replayCompiledAction - the in-page rung', () => {
  it('fills the holes, sends header NAMES only, and answers the parsed body', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[{"id":7}]}' });
    const result = await replayCompiledAction(
      { ...base, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );

    expect(result.outcome).toBe('ok');
    const ok = result as Extract<ReplayResult, { outcome: 'ok' }>;
    expect(ok.data).toEqual({ items: [{ id: 7 }] });
    expect(ok.recipeVersion).toBe(3);
    expect(ok.calls[0]!.resolved.url).toBe('https://portal.example/api/cases?ref=2024-1');
    expect(ok.calls[0]!.resolved.route).toBe('in-page');
    // NAMES on the wire to the machine; the values are resolved there, from the live session.
    expect(browser.calls[0]).toEqual({ method: 'GET', url: 'https://portal.example/api/cases?ref=2024-1', headerNames: ['accept', 'x-csrf-token'] });
  });

  it('prefers the page even for a PERMISSIVE origin - inheritance is free and never wrong', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[]}' });
    const fetchImpl = vi.fn();
    const result = await replayCompiledAction(
      { ...base, browser, classify: always(PERMISSIVE) },
      { loadRecipe: async () => recipe(), fetchImpl },
    );
    expect((result as Extract<ReplayResult, { outcome: 'ok' }>).calls[0]!.resolved.route).toBe('in-page');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('replayCompiledAction - posture is resolved PER CALL', () => {
  it('asks about EVERY origin the recipe touches, not just the first', async () => {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async () => ({ status: 200, text: async () => '{}' }));
    await replayCompiledAction(
      { ...base, classify: (origin) => { asked.push(origin); return PERMISSIVE; } },
      { loadRecipe: async () => TWO_ORIGIN_RECIPE, fetchImpl },
    );
    expect(asked).toContain('https://portal.example');
    expect(asked).toContain('https://cdn.other.example');
  });

  it('a permissive FIRST hop does not authorise a second hop nobody classified', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, text: async () => '{}' }));
    const result = await replayCompiledAction(
      // Exactly one origin is declared permissive - the one the action is about. The recipe's
      // second call is somewhere else, and the closed default has to apply to it.
      { ...base, classify: permissiveOnly('https://portal.example') },
      { loadRecipe: async () => TWO_ORIGIN_RECIPE, fetchImpl },
    );
    expect(result.outcome).toBe('unavailable');
    expect((result as { reason: string }).reason).toContain('cdn.other.example');
    // AND NOTHING WAS SENT. The whole ladder is resolved before the first call, so a recipe with
    // one reachable call and one unreachable one leaves no half-replay behind.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is asked about the origin the CALL targets, which is what a real declaration classifies', async () => {
    // Wired through the real `classifyOrigin` with a real action declaration, so this pins the
    // integration rather than a hand-written stand-in for it.
    const action = { posture: 'permissive' as const, httpConfig: { baseUrl: 'https://portal.example/api' } };
    const fetchImpl = vi.fn(async () => ({ status: 200, text: async () => '{}' }));
    const result = await replayCompiledAction(
      { ...base, classify: (origin) => classifyOrigin(origin, action) },
      { loadRecipe: async () => TWO_ORIGIN_RECIPE, fetchImpl },
    );
    expect(result.outcome).toBe('unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('replayCompiledAction - the server-side rung is posture-gated', () => {
  it('falls to node-http with NO session when the origin is permissive', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, text: async () => '{"items":[{"id":1}]}' }));
    const result = await replayCompiledAction(
      { ...base, classify: always(PERMISSIVE) },
      { loadRecipe: async () => recipe(), fetchImpl },
    );
    expect((result as Extract<ReplayResult, { outcome: 'ok' }>).calls[0]!.resolved.route).toBe('node-http');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('REFUSES to replay an adversarial origin from the server, and says why', async () => {
    const fetchImpl = vi.fn();
    const result = await replayCompiledAction(
      { ...base, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe(), fetchImpl },
    );
    expect(result.outcome).toBe('unavailable');
    expect((result as { reason: string }).reason).toContain('adversarial');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('replayCompiledAction - the write gate (trap T4)', () => {
  const writeRecipe = recipe({
    injectedCalls: [
      { method: 'GET', urlTemplate: 'https://portal.example/api/cases', headerNames: [], idempotent: true },
      { method: 'POST', urlTemplate: 'https://portal.example/api/cases/{{input.ref}}/notes', headerNames: [], bodyTemplate: '{"ref":"{{input.ref}}"}', idempotent: false },
    ],
  });

  it('stops BEFORE any call runs, so a partial replay cannot half-mutate the site', async () => {
    const browser = session({ status: 200, bodyText: '{}' });
    const result = await replayCompiledAction(
      { ...base, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => writeRecipe },
    );
    expect(result.outcome).toBe('write-gate');
    const gated = result as Extract<ReplayResult, { outcome: 'write-gate' }>;
    expect(gated.blocked).toBe('POST https://portal.example/api/cases/{{input.ref}}/notes');
    expect(browser.calls).toHaveLength(0);
  });

  it('names the offending call by its TEMPLATE, so no argument reaches the refusal text', async () => {
    // The refusal becomes a user-facing error string. A resolved URL there would put this run's
    // arguments - a case number, a client name - into a message and a log line.
    const result = await replayCompiledAction(
      {
        ...base,
        args: { ref: 'CASE-THAT-MUST-NOT-BE-QUOTED' },
        browser: session({ status: 200, bodyText: '{}' }),
        classify: always(ADVERSARIAL),
      },
      { loadRecipe: async () => writeRecipe },
    );
    const gated = result as Extract<ReplayResult, { outcome: 'write-gate' }>;
    expect(gated.blocked).not.toContain('CASE-THAT-MUST-NOT-BE-QUOTED');
    expect(gated.blocked).toContain('{{input.ref}}');
  });

  it('replays the write once a human has assented, and never by default', async () => {
    const browser = session({ status: 200, bodyText: '{}' });
    const result = await replayCompiledAction(
      { ...base, browser, classify: always(ADVERSARIAL), writeAssent: true },
      { loadRecipe: async () => writeRecipe },
    );
    expect(result.outcome).toBe('ok');
    expect(browser.calls).toHaveLength(2);
  });

  it('replays a READ freely - that is the whole point of the recipe', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
    const result = await replayCompiledAction(
      { ...base, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('ok');
  });

  describe('a SCRIPTED DOM STEP is a write too - the first version replayed these ungated', () => {
    const clickRecipe = recipe({
      scriptedSteps: [{ action: 'click', locator: { strategy: 'role', role: 'button', name: 'Submeter' } }],
    });

    it('gates a click, and the read-only calls in front of it never run either', async () => {
      const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
      const result = await replayCompiledAction(
        { ...base, browser, classify: always(ADVERSARIAL) },
        { loadRecipe: async () => clickRecipe },
      );
      expect(result.outcome).toBe('write-gate');
      expect((result as Extract<ReplayResult, { outcome: 'write-gate' }>).blocked).toContain('click');
      expect(browser.calls).toHaveLength(0);
      expect(browser.acts).toHaveLength(0);
    });

    it('does NOT gate a hover - the read-only verbs still replay', async () => {
      const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
      const result = await replayCompiledAction(
        { ...base, browser, classify: always(ADVERSARIAL) },
        { loadRecipe: async () => recipe({ scriptedSteps: [{ action: 'hover', locator: { strategy: 'text', text: 'x' } }] }) },
      );
      expect(result.outcome).toBe('ok');
      expect(browser.acts).toHaveLength(1);
    });

    it('classifies EVERY verb the parser accepts, and an unknown one as a WRITE', () => {
      // The list is the PARSER's own (`PLAYWRIGHT_ACTION_KINDS`), not a copy: a verb added there
      // and left out of the expectation below fails this test rather than replaying ungated.
      const expected: Record<string, boolean> = {
        navigate: true, click: true, dblclick: true, fill: true, press: true,
        select: true, check: true, uncheck: true,
        hover: false, wait: false, wait_for: false, scroll: false, screenshot: false, noop: false,
      };
      expect(Object.keys(expected).sort()).toEqual([...PLAYWRIGHT_ACTION_KINDS].sort());
      for (const action of PLAYWRIGHT_ACTION_KINDS) {
        expect({ action, writes: scriptedStepWrites({ action }) }).toEqual({ action, writes: expected[action] });
      }
      // Closed by default: a verb this build has never heard of is a write.
      expect(scriptedStepWrites({ action: 'a-verb-invented-next-year' })).toBe(true);
    });
  });
});

describe('replayCompiledAction - drift', () => {
  it('classifies a NON-2xx as drift, naming the call', async () => {
    const result = await replayCompiledAction(
      { ...base, browser: session({ status: 404, bodyText: 'gone' }), classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('drift');
    expect((result as { reason: string }).reason).toContain('404');
  });

  it('classifies a 200 whose SHAPE lost a field as drift, and names the field', async () => {
    const result = await replayCompiledAction(
      { ...base, browser: session({ status: 200, bodyText: '{"results":[{"id":1}]}' }), classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('drift');
    expect((result as { reason: string }).reason).toContain('response.items');
  });

  it('does NOT call an added field drift - APIs add fields constantly', async () => {
    const result = await replayCompiledAction(
      { ...base, browser: session({ status: 200, bodyText: '{"items":[{"id":1,"newField":true}],"page":1}' }), classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('ok');
  });

  it('does NOT call an EMPTY list drift - a list endpoint may legitimately have nothing today', async () => {
    const result = await replayCompiledAction(
      { ...base, browser: session({ status: 200, bodyText: '{"items":[]}' }), classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('ok');
  });

  it('treats a call that could not be MADE as drift, not as a run failure', async () => {
    const result = await replayCompiledAction(
      { ...base, browser: session(() => { throw new Error('the page navigated away'); }), classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('drift');
  });
});

describe('replayCompiledAction - falls through rather than half-executing', () => {
  it('answers no-recipe when there is none', async () => {
    const result = await replayCompiledAction({ ...base, classify: always(PERMISSIVE) }, { loadRecipe: async () => null });
    expect(result.outcome).toBe('no-recipe');
  });

  it('answers no-recipe for a stored recipe this build cannot read, rather than guessing at it', async () => {
    const result = await replayCompiledAction(
      { ...base, browser: session({ status: 200, bodyText: '{}' }), classify: always(ADVERSARIAL) },
      // A "header name" that is a JWT is the exact shape of the leak the brand exists to prevent:
      // the whole recipe is invalidated rather than the field quietly dropped.
      { loadRecipe: async () => recipe({ injectedCalls: [{ method: 'GET', urlTemplate: 'https://x.example/', headerNames: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], idempotent: true }] }) },
    );
    expect(result.outcome).toBe('no-recipe');
  });

  it('answers no-recipe when a template does not resolve to an absolute URL', async () => {
    const result = await replayCompiledAction(
      { ...base, browser: session({ status: 200, bodyText: '{}' }), classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe({ injectedCalls: [{ method: 'GET', urlTemplate: '/api/cases', headerNames: [], idempotent: true }] }) },
    );
    expect(result.outcome).toBe('no-recipe');
  });
});

describe('replayCompiledAction - what an ARGUMENT may not decide', () => {
  it('REFUSES a missing argument rather than blanking the hole and widening the query', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[]}' });
    const result = await replayCompiledAction(
      // `ref` is what the template asks for; the run supplies something else entirely.
      { ...base, args: { unrelated: 'x' }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('no-recipe');
    expect((result as { reason: string }).reason).toContain('ref');
    // The point of the refusal: `?ref=` would have fetched every case in the tenant.
    expect(browser.calls).toHaveLength(0);
  });

  it('treats an explicitly NULL argument as missing, not as an empty value', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[]}' });
    const result = await replayCompiledAction(
      { ...base, args: { ref: null }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('no-recipe');
    expect(browser.calls).toHaveLength(0);
  });

  it('accepts a supplied FALSY argument - "" and 0 are answers, absence is not', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
    const result = await replayCompiledAction(
      { ...base, args: { ref: 0 }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('ok');
    expect((browser.calls[0] as { url: string }).url).toBe('https://portal.example/api/cases?ref=0');
  });

  it('REFUSES an argument that moves the call to another host', async () => {
    const browser = session({ status: 200, bodyText: '{}' });
    const result = await replayCompiledAction(
      {
        ...base,
        args: { host: 'evil.example' },
        browser,
        classify: always(ADVERSARIAL),
      },
      // A hand-authored (or maliciously stored) template with a hole in its ORIGIN. The compile
      // never writes one; this is the boundary that holds if a document arrives with one anyway.
      { loadRecipe: async () => recipe({ injectedCalls: [{ method: 'GET', urlTemplate: 'https://{{input.host}}/api/cases', headerNames: [], idempotent: true }] }) },
    );
    expect(result.outcome).toBe('no-recipe');
    expect((result as { reason: string }).reason).toContain('origin');
    expect(browser.calls).toHaveLength(0);
  });

  it('refuses to send a resolved URL that contains a live credential value', async () => {
    const browser = session({ status: 200, bodyText: '{}' });
    await expect(
      replayCompiledAction(
        {
          ...base,
          args: { ref: 'live-session-token-9f2' },
          secrets: secretRegistryFromValues(['live-session-token-9f2']),
          browser,
          classify: always(ADVERSARIAL),
        },
        { loadRecipe: async () => recipe() },
      ),
    ).rejects.toThrow(/live credential/i);
    expect(browser.calls).toHaveLength(0);
  });
});
