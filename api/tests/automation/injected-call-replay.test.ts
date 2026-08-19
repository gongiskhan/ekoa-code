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

/**
 * Two calls, two DIFFERENT hosts - the shape a single-verdict posture gets wrong.
 *
 * The SECOND call carries the `ref` hole and the first carries none, which is what a real compile
 * produces (the opening hop of a flow routinely takes no argument) and is also the shape that pins
 * the argument-coverage check as a RECIPE-wide question: `ref` is honoured by exactly one call, and
 * it is not the first, so any reading that stops at one call refuses a perfectly ordinary recipe.
 */
const TWO_ORIGIN_RECIPE = recipe({
  injectedCalls: [
    { method: 'GET', urlTemplate: 'https://portal.example/api/cases', headerNames: [], idempotent: true },
    { method: 'GET', urlTemplate: 'https://cdn.other.example/api/docs?ref={{input.ref}}', headerNames: [], idempotent: true },
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
  // A READ, stated. `mutates` is REQUIRED on `ReplayInput` - the seam above normalises it
  // fail-closed once (`runAutomationForAction`) and this module is handed the answer - so a case
  // that forgets to say is a compile error rather than a silently mutating action whose read-only
  // recipe replays. The coverage refusal keyed on it has its own cases below.
  mutates: false,
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

  /**
   * POSTURE IS ASKED ON EVERY RUNG, INCLUDING THE ONE IT DOES NOT GATE.
   *
   * `chooseRoute` used to answer `in-page` BEFORE calling `classify`, so a replay holding a browser
   * session resolved no posture at all and the run record could not say what the system believed
   * about the hosts it had just spoken to. The in-page rung is deliberately still not REFUSABLE by
   * the answer - it is the rung an adversarial origin requires, and gating it would disable the
   * ladder exactly where it is the only thing that works - so what these two pin is that the
   * verdict is resolved and recorded.
   */
  it('classifies every origin even WITH a session, though in-page is not refused by the answer', async () => {
    const asked: string[] = [];
    const result = await replayCompiledAction(
      {
        ...base,
        browser: session({ status: 200, bodyText: '{"items":[{"id":1}]}' }),
        classify: (origin) => { asked.push(origin); return ADVERSARIAL; },
      },
      { loadRecipe: async () => TWO_ORIGIN_RECIPE },
    );
    // Adversarial on BOTH hops and the replay still ran: in-page is exactly the rung for that.
    expect(result.outcome).toBe('ok');
    expect(asked).toEqual(['https://portal.example', 'https://cdn.other.example']);
  });

  it('records the verdict on each resolved call, so the run record says what was believed', async () => {
    const result = await replayCompiledAction(
      {
        ...base,
        browser: session({ status: 200, bodyText: '{"items":[{"id":1}]}' }),
        classify: permissiveOnly('https://portal.example'),
      },
      { loadRecipe: async () => TWO_ORIGIN_RECIPE },
    );
    expect(result.outcome).toBe('ok');
    const calls = (result as { calls: Array<{ resolved: { route: string; posture: string } }> }).calls;
    // PER CALL, not one verdict for the list: the declared host is permissive, the third-party hop
    // the author never classified is not, and both rode the same rung.
    expect(calls.map((c) => [c.resolved.posture, c.resolved.route])).toEqual([
      ['permissive', 'in-page'],
      ['adversarial', 'in-page'],
    ]);
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

describe('replayCompiledAction - the server-side rung goes through the SSRF guard', () => {
  /**
   * EVERY OTHER CASE ON THIS RUNG INJECTS `fetchImpl`, so `guardedFetch` - the transport the module
   * actually names - was never once executed by this suite. Swapping it for a bare `fetch` left
   * every test green, which is the shape of a defence that reads as covered and is not.
   *
   * So this one supplies NO transport. A recipe's URL is authored from a captured URL and a captured
   * URL is data: "the recipe said so" is not a reason to dial an address. The cloud metadata service
   * is the canonical target, and it is reachable from a datacenter - which is exactly where this
   * rung runs from.
   */
  it('REFUSES a link-local address the recipe names, with the REAL transport', async () => {
    const result = await replayCompiledAction(
      {
        ...base,
        classify: always(PERMISSIVE),
        args: { ref: '2024-1' },
      },
      {
        // No `fetchImpl`: `guardedFetch` runs, and it is what has to refuse.
        loadRecipe: async () => recipe({
          injectedCalls: [{ method: 'GET', urlTemplate: 'http://169.254.169.254/latest/meta-data/?ref={{input.ref}}', headerNames: [], idempotent: true }],
        }),
      },
    );
    // A call that could not be MADE is drift, not a run failure - and the reason names the refusal.
    expect(result.outcome).toBe('drift');
    expect((result as { reason: string }).reason).toMatch(/blocked|private|ssrf|not allowed/i);
  });

  it('…and reaches an ORDINARY address through the same transport', async () => {
    // THE CONTROL, and it is what makes the refusal above about the ADDRESS rather than about a
    // rung that cannot send anything at all. `example.invalid` never resolves, so the guard lets it
    // through (it is not a blocked address) and the failure is DNS - a different failure, arriving
    // from a different place, which is the whole point.
    const result = await replayCompiledAction(
      { ...base, classify: always(PERMISSIVE), args: { ref: '2024-1' } },
      {
        loadRecipe: async () => recipe({
          injectedCalls: [{ method: 'GET', urlTemplate: 'http://portal.example.invalid/api/cases?ref={{input.ref}}', headerNames: [], idempotent: true }],
        }),
      },
    );
    expect(result.outcome).toBe('drift');
    expect((result as { reason: string }).reason).not.toMatch(/blocked|ssrf/i);
  }, 20_000);
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
      // NOTHING supplied, so this is the missing-hole refusal and ONLY that one. Supplying an
      // UNRELATED argument instead - which is what this case used to do - trips the coverage
      // refusal below first, and both messages contain the substring "ref" (from "refusing"), so
      // the assertion would have passed while testing the other rule.
      { ...base, args: {}, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('no-recipe');
    expect((result as { reason: string }).reason).toMatch(/needs argument\(s\) ref\b/);
    // The point of the refusal: `?ref=` would have fetched every case in the tenant.
    expect(browser.calls).toHaveLength(0);
  });

  // ===========================================================================================
  // THE MIRROR REFUSAL: AN ARGUMENT NO HOLE CAN CARRY.
  //
  // `assertHolesSupplied` proves args ⊇ holes; these prove holes ⊇ args. Without the second half a
  // recipe compiled around one question answers every later one with the same data: the caller asks
  // for case 2025-9, the call the recipe holds is the 2024-1 one it was compiled from, and the run
  // reports SUCCESS. The compile already refuses to LEARN that; a recipe written by an older build,
  // or a caller that starts passing a new argument, reaches the replay with exactly that shape.
  //
  // Every case asserts the CONSEQUENCE - `browser.calls` - and not only the outcome string: the
  // whole failure being prevented is a call that goes out and answers the wrong question.
  // ===========================================================================================
  it('REFUSES an argument the recipe has NO HOLE for, rather than answering the question it was compiled around', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[{"id":41}]}' });
    const result = await replayCompiledAction(
      // The recipe's one call is `?ref={{input.ref}}`. `status` can reach nothing in it, so a
      // replay would fetch the same page of cases whatever the caller filtered on.
      { ...base, args: { ref: '2024-1', status: 'closed' }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('no-recipe');
    // Anchored on the phrase, not on the bare argument name: a loose `toContain('status')` would
    // also match any message that happened to use the word, which is how the missing-argument case
    // above quietly matched "ref" inside "refusing".
    expect((result as { reason: string }).reason).toMatch(/no hole for argument\(s\) status\b/);
    expect(browser.calls).toHaveLength(0);
  });

  it('…and the SAME recipe with the SAME argument set minus that one replays - the refusal is about the argument', async () => {
    // THE CONTROL. Without it "nothing was sent" would also hold for a harness that cannot send.
    const browser = session({ status: 200, bodyText: '{"items":[{"id":41}]}' });
    const result = await replayCompiledAction(
      { ...base, args: { ref: '2024-1' }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('ok');
    expect((browser.calls[0] as { url: string }).url).toBe('https://portal.example/api/cases?ref=2024-1');
  });

  it('accepts an argument honoured by ONE call of several - coverage is the RECIPE\'s, not one call\'s', async () => {
    // `TWO_ORIGIN_RECIPE`'s second call has no hole at all. A per-call reading of this rule would
    // refuse a perfectly ordinary multi-hop recipe, so the union is the unit and this pins it.
    const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
    const result = await replayCompiledAction(
      { ...base, args: { ref: '2024-1' }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => TWO_ORIGIN_RECIPE },
    );
    expect(result.outcome).toBe('ok');
    expect((browser.calls as Array<{ url: string }>).map((c) => c.url)).toEqual([
      'https://portal.example/api/cases',
      'https://cdn.other.example/api/docs?ref=2024-1',
    ]);
  });

  it('counts a hole in the BODY as coverage - a POST search parameterises there, not in the URL', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[]}' });
    const result = await replayCompiledAction(
      { ...base, args: { q: 'processos' }, browser, classify: always(ADVERSARIAL), writeAssent: true },
      {
        loadRecipe: async () => recipe({
          injectedCalls: [{
            method: 'POST',
            urlTemplate: 'https://portal.example/api/search',
            bodyTemplate: '{"q":"{{input.q}}"}',
            headerNames: [],
            idempotent: false,
          }],
        }),
      },
    );
    expect(result.outcome).toBe('ok');
    expect((browser.calls[0] as { body: string }).body).toBe('{"q":"processos"}');
  });

  it('does NOT demand a hole for a SECRET-SHAPED argument name - the compile never writes one', async () => {
    // `network-capture.inputHoles` skips these on both counts: never holed (a recipe that says "put
    // the password here" is a recipe that needs a password) and never required to be found. Reading
    // the same vocabulary here is what keeps the two sides from disagreeing - and disagreeing would
    // refuse every replay of every authenticated action that takes a credential argument.
    const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
    const result = await replayCompiledAction(
      { ...base, args: { ref: '2024-1', sessionToken: 'abcdefgh' }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('ok');
    // …and it did not ride out on the wire either: it filled no hole, so it is in no URL.
    expect((browser.calls[0] as { url: string }).url).toBe('https://portal.example/api/cases?ref=2024-1');
  });

  it('does NOT demand a hole for a NULL argument - it carries nothing the compile could have found', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
    const result = await replayCompiledAction(
      { ...base, args: { ref: '2024-1', notes: null, extra: undefined }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('ok');
  });

  it('REFUSES a NON-SCALAR argument even where a hole bears its name - `[object Object]` is not a value', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[]}' });
    const result = await replayCompiledAction(
      { ...base, args: { ref: { from: '2024-01', to: '2024-12' } }, browser, classify: always(ADVERSARIAL) },
      { loadRecipe: async () => recipe() },
    );
    expect(result.outcome).toBe('no-recipe');
    expect((result as { reason: string }).reason).toMatch(/argument\(s\) ref that are not scalar values/);
    // The failure prevented is not an error - it is `?ref=%5Bobject%20Object%5D` returning the
    // collection's default page and the run calling that a success.
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
    expect((result as { reason: string }).reason).toMatch(/origin/i);
    expect(browser.calls).toHaveLength(0);
  });

  // ===========================================================================================
  // THE ESCAPE ATTEMPTS. A replay runs inside the user's LIVE AUTHENTICATED PAGE, so an argument
  // that can change WHICH endpoint is called is an SSRF with the session already attached. Each
  // case below is one way out of a value slot; each must be neutralised into a value or refused,
  // never reach the page as a different request.
  // ===========================================================================================
  describe('an argument fills a value slot and cannot choose the endpoint', () => {
    const pathRecipe = recipe({
      injectedCalls: [{
        method: 'GET',
        urlTemplate: 'https://portal.example/api/cases/{{input.id}}',
        headerNames: [],
        idempotent: true,
      }],
    });

    async function replayWith(args: Record<string, unknown>, stored: unknown = pathRecipe) {
      // A body that satisfies the default recipe's `expectShape`, so a case that reaches the page
      // reports `ok` rather than drifting on the answer - what is under test here is the REQUEST.
      const browser = session({ status: 200, bodyText: '{"items":[{"id":1}]}' });
      const result = await replayCompiledAction(
        { ...base, args, browser, classify: always(ADVERSARIAL) },
        { loadRecipe: async () => stored },
      );
      return { result, calls: browser.calls as Array<{ url: string }> };
    }

    it('does not resolve a traversal to another endpoint - the first cut reached /admin/secrets', async () => {
      const { result, calls } = await replayWith({ id: '../../admin/secrets' });
      expect(calls.map((c) => c.url)).not.toContain('https://portal.example/admin/secrets');
      if (result.outcome === 'ok') {
        // If it went out at all it went out as a VALUE - one segment, still under /api/cases/.
        expect(new URL(calls[0]!.url).pathname.split('/')).toHaveLength(4);
        expect(calls[0]!.url.startsWith('https://portal.example/api/cases/')).toBe(true);
      } else {
        expect(calls).toHaveLength(0);
      }
    });

    it('REFUSES a segment that walks up - `..` needs no character an encoder would escape', async () => {
      const { result, calls } = await replayWith({ id: '..' });
      expect(result.outcome).toBe('no-recipe');
      expect((result as { reason: string }).reason).toMatch(/emptied or walked|shape/i);
      expect(calls).toHaveLength(0);
    });

    it('REFUSES a walk-up even when NO literal segment follows it to notice', async () => {
      // The case the segment COUNT exists for. Every segment after `/api/cases/` is a hole here, so
      // comparing the hole-free segments finds nothing wrong: `''`, `api` and `cases` all still
      // match. Only "the path has as many segments as the template said" sees that one was eaten.
      const { result, calls } = await replayWith(
        { a: 'x', b: '..' },
        recipe({ injectedCalls: [{ method: 'GET', urlTemplate: 'https://portal.example/api/cases/{{input.a}}/{{input.b}}', headerNames: [], idempotent: true }] }),
      );
      expect(result.outcome).toBe('no-recipe');
      expect((result as { reason: string }).reason).toMatch(/shape/i);
      expect(calls).toHaveLength(0);
    });

    it('REFUSES a segment that empties, which turns an item endpoint into its collection', async () => {
      const { result, calls } = await replayWith({ id: '' });
      expect(result.outcome).toBe('no-recipe');
      expect(calls).toHaveLength(0);
    });

    it('cannot ADD a query parameter - `&` in an argument is a value, not a separator', async () => {
      const { result, calls } = await replayWith({ ref: 'x&scope=all&admin=1' }, recipe());
      expect(result.outcome).toBe('ok');
      const sent = new URL(calls[0]!.url);
      expect([...sent.searchParams.keys()]).toEqual(['ref']);
      expect(sent.searchParams.get('ref')).toBe('x&scope=all&admin=1');
    });

    it('cannot open a new PATH SEGMENT - `/` in an argument is a value, not a separator', async () => {
      const { result, calls } = await replayWith({ id: 'a/b/c' });
      expect(result.outcome).toBe('ok');
      expect(new URL(calls[0]!.url).pathname.split('/')).toHaveLength(4);
    });

    it('cannot append a query string through a PATH hole', async () => {
      const { result, calls } = await replayWith({ id: '7?scope=all' });
      expect(result.outcome).toBe('ok');
      expect([...new URL(calls[0]!.url).searchParams.keys()]).toEqual([]);
    });

    it('REFUSES a template whose query parameter NAME is a hole', async () => {
      const { result, calls } = await replayWith(
        { field: 'admin' },
        recipe({ injectedCalls: [{ method: 'GET', urlTemplate: 'https://portal.example/api/cases?{{input.field}}=1', headerNames: [], idempotent: true }] }),
      );
      expect(result.outcome).toBe('no-recipe');
      expect(calls).toHaveLength(0);
    });

    it('REFUSES a placeholder family the compile never emits, rather than sending it as a literal', async () => {
      const { result, calls } = await replayWith(
        { ref: '2024-1' },
        recipe({ injectedCalls: [{ method: 'GET', urlTemplate: 'https://portal.example/api/cases?ref={{integration.portal.token}}', headerNames: [], idempotent: true }] }),
      );
      expect(result.outcome).toBe('no-recipe');
      expect(calls).toHaveLength(0);
    });

    it('cannot inject a sibling FIELD into a JSON body - the escaping is the body\'s own', async () => {
      const browser = session({ status: 200, bodyText: '{}' });
      const result = await replayCompiledAction(
        {
          ...base,
          args: { q: 'x", "isAdmin": true, "z": "' },
          browser,
          classify: always(ADVERSARIAL),
          writeAssent: true,
        },
        {
          loadRecipe: async () => recipe({
            injectedCalls: [{
              method: 'POST',
              urlTemplate: 'https://portal.example/api/search',
              bodyTemplate: '{"q":"{{input.q}}"}',
              headerNames: [],
              idempotent: false,
            }],
          }),
        },
      );
      expect(result.outcome).toBe('ok');
      const sent = JSON.parse((browser.calls[0] as { body: string }).body) as Record<string, unknown>;
      expect(Object.keys(sent)).toEqual(['q']);
      expect(sent.q).toBe('x", "isAdmin": true, "z": "');
    });
  });

  // ===========================================================================================
  // THE LAST PROOF: A RESOLVED CALL CARRIES NO LIVE CREDENTIAL.
  //
  // `assertNoCredentialRodeIn` scans the RESOLVED url AND the RESOLVED body, and they are two legs
  // rather than one because they are two different disclosures: a credential in a query string
  // lands in the site's access logs, one in a body lands in its application logs. The suite pinned
  // the URL leg only, and dropping the body leg from the loop left the whole automation and
  // security lane green - so the leg that guards a POST recipe was covered by nothing at all.
  // Both variants are pinned here now, each against its own control.
  // ===========================================================================================
  const LIVE_VALUE = ['live', 'session', 'token', '9f2'].join('-');

  it('refuses to send a resolved URL that contains a live credential value', async () => {
    const browser = session({ status: 200, bodyText: '{}' });
    await expect(
      replayCompiledAction(
        {
          ...base,
          args: { ref: LIVE_VALUE },
          secrets: secretRegistryFromValues([LIVE_VALUE]),
          browser,
          classify: always(ADVERSARIAL),
        },
        { loadRecipe: async () => recipe() },
      ),
    ).rejects.toThrow(/live credential/i);
    expect(browser.calls).toHaveLength(0);
  });

  /** A POST whose one argument lands in the BODY and nowhere in the URL - so the URL leg cannot
   *  see it and only the body leg can. This is the ordinary shape of a portal's search. */
  const bodyRecipe = () => recipe({
    injectedCalls: [{
      method: 'POST',
      urlTemplate: 'https://portal.example/api/search',
      bodyTemplate: '{"q":"{{input.q}}"}',
      headerNames: [],
      idempotent: false,
    }],
  });

  it('refuses to send a resolved BODY that contains one - the URL leg cannot see a POST\'s argument', async () => {
    const browser = session({ status: 200, bodyText: '{}' });
    await expect(
      replayCompiledAction(
        {
          ...base,
          args: { q: LIVE_VALUE },
          secrets: secretRegistryFromValues([LIVE_VALUE]),
          browser,
          classify: always(ADVERSARIAL),
          writeAssent: true,
        },
        { loadRecipe: async () => bodyRecipe() },
      ),
    ).rejects.toThrow(/live credential/i);
    expect(browser.calls).toHaveLength(0);
  });

  it('…and sends the identical POST when the argument is not a live value - the refusal is about the value', async () => {
    const browser = session({ status: 200, bodyText: '{"items":[]}' });
    const result = await replayCompiledAction(
      {
        ...base,
        args: { q: 'processos' },
        secrets: secretRegistryFromValues([LIVE_VALUE]),
        browser,
        classify: always(ADVERSARIAL),
        writeAssent: true,
      },
      { loadRecipe: async () => bodyRecipe() },
    );
    expect(result.outcome).toBe('ok');
    expect((browser.calls[0] as { body: string }).body).toBe('{"q":"processos"}');
  });
});
