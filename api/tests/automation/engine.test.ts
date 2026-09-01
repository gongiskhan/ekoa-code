/**
 * Engine orchestration tests. Heavy dependencies (Playwright, vision,
 * cache, persistence) are mocked; the daemon/integration/platform/scoped-
 * memory collaborators are wired through the real injected seams
 * (automation/seams.ts) with fakes, since those modules don't exist yet /
 * live in siblings the engine must not import directly. We verify the
 * three-tier dispatch logic, sub-automation cycle detection, and run-record
 * structure end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  const automations = new Map<string, any>();
  const runs = new Map<string, any>();
  return {
    automations,
    runs,

    findAutomation: vi.fn((id: string) => Promise.resolve(automations.get(id) ?? null)),

    runCreate: vi.fn(async (record: any) => {
      runs.set(`${record.automationId}:${record.id}`, record);
      return record;
    }),
    runUpdate: vi.fn(async (automationId: string, runId: string, patch: any) => {
      const key = `${automationId}:${runId}`;
      const existing = runs.get(key);
      if (!existing) throw new Error('not found');
      const merged = { ...existing, ...patch };
      runs.set(key, merged);
      return merged;
    }),
    runFindById: vi.fn(async (automationId: string, runId: string) =>
      runs.get(`${automationId}:${runId}`) ?? null),

    writeStepScreenshot: vi.fn(() => 'automation-runs/auto/run/step-0.png'),

    resolvePlaywrightAction: vi.fn(),
    verifyOutcome: vi.fn(),
    classifyHumanAction: vi.fn(async (): Promise<{ kind: string; userInstructions: string } | null> => null),
    // Browser steps run against a BrowserSession (daemon-backed or
    // in-process). `act` dispatches a PlaywrightAction, `assert` a
    // PlaywrightAssertion. The engine's three-tier logic is what we
    // exercise; the session transport is mocked away.
    act: vi.fn(),
    assert: vi.fn(),

    lookupActionCache: vi.fn(),
    writeActionCache: vi.fn(),
    lookupAssertionCache: vi.fn(),
    writeAssertionCache: vi.fn(),

    // computePageFingerprint here is a hoisted stand-in the fake
    // BrowserSession classes call directly — NOT the real fingerprint.ts
    // module (which the engine never touches once the sessions are mocked).
    computePageFingerprint: vi.fn(() => ({
      origin: 'https://x.com',
      pathname: '/',
      pathSuffix: '',
      titleHash: 'h',
      headingHash: 'h',
      domShapeHash: 'h',
      viewport: { w: 1280, h: 800 },
    })),

    accessibilitySnapshot: vi.fn(() => undefined as string | undefined),

    // Non-null daemon connection stub (presence drives the daemon-connected
    // path). runStep is unused — the BrowserSession is mocked above — but
    // present so the shape is realistic.
    bridgeConnection: { runStep: vi.fn() },

    // Constructor opts captured from the fake LocalBrowserSession below —
    // proves the engine threads inputs.credentials.storageState into the
    // in-process session (and nowhere else) when no daemon is connected.
    localSessionOpts: [] as any[],

    proposePatch: vi.fn(),

    // The bytes the fake BrowserSessions return from screenshotPng(). Default non-empty; a test
    // sets it to an empty Buffer to exercise the engine's empty-screenshot guard.
    screenshotBytes: Buffer.from('png') as Buffer,
  };
});

vi.mock('../../src/automation/persistence.js', async (importOriginal) => ({
  // Slice E4: the engine builds its per-step log accumulator from persistence.js. It is pure
  // (no store, no filesystem) and its CAPS are part of what the engine must honour, so it is
  // passed through to the real implementation rather than faked.
  createStepLogAccumulator: (await importOriginal<typeof import('../../src/automation/persistence.js')>()).createStepLogAccumulator,
  automationStore: {
    findById: hoisted.findAutomation,
    update: vi.fn(async (id: string, patch: any) => {
      const existing = hoisted.automations.get(id);
      const merged = { ...existing, ...patch };
      hoisted.automations.set(id, merged);
      return merged;
    }),
  },
  automationRunStore: {
    create: hoisted.runCreate,
    update: hoisted.runUpdate,
    findById: hoisted.runFindById,
    listForAutomation: vi.fn(async () => []),
  },
  writeStepScreenshot: hoisted.writeStepScreenshot,
  // The engine imports these from persistence.js; the mock must export them or the calls (in
  // pauseRunForUser and the SSE mapper) resolve to `undefined` and throw at runtime.
  screenshotUrlFromPath: (rel?: string) => (rel ? `/automation-screenshots/${rel.replace(/^automation-runs\//, '')}` : undefined),
  automationRunsRoot: () => '/tmp/ekoa-test/automation-runs',
}));

// Fake daemon-backed BrowserSession. act/assert are hoisted mocks the
// tests drive. The observation accessors return stable values so the
// cache/fingerprint/vision path runs unchanged.
vi.mock('../../src/automation/browser-session.js', () => ({
  DaemonBrowserSession: class {
    private observed = true;
    /** Where the last navigate took this fake. A stub that reports a FIXED url however it was
     *  navigated cannot exercise the engine's landed-where-we-asked check (added 2026-08-28). */
    private at = 'https://x.com/';
    constructor(_opts: unknown) {}
    act(action: unknown) {
      const a = action as { kind?: string; url?: string };
      if (a?.kind === 'navigate' && typeof a.url === 'string') this.at = a.url;
      return hoisted.act(action);
    }
    assert(assertion: unknown) { return hoisted.assert(assertion); }
    async observe() { this.observed = true; }
    async ensureObserved() { this.observed = true; }
    hasObservation() { return this.observed; }
    screenshotPng() { return hoisted.screenshotBytes; }
    screenshotB64() { return Buffer.from('png').toString('base64'); }
    url() { return this.at; }
    fingerprint() { return hoisted.computePageFingerprint(); }
    accessibilitySnapshot() { return hoisted.accessibilitySnapshot(); }
  },
}));

// Fake in-process LocalBrowserSession (daemon-less fallback). Same surface
// as the DaemonBrowserSession fake; additionally records constructor opts so
// the session-credential plumbing test can assert on `sessionState`.
vi.mock('../../src/automation/local-browser-session.js', () => ({
  LocalBrowserSession: class {
    private observed = true;
    private at = 'https://x.com/';
    constructor(opts: unknown) { hoisted.localSessionOpts.push(opts); }
    act(action: unknown) {
      const a = action as { kind?: string; url?: string };
      if (a?.kind === 'navigate' && typeof a.url === 'string') this.at = a.url;
      return hoisted.act(action);
    }
    assert(assertion: unknown) { return hoisted.assert(assertion); }
    async observe() { this.observed = true; }
    async ensureObserved() { this.observed = true; }
    hasObservation() { return this.observed; }
    screenshotPng() { return hoisted.screenshotBytes; }
    screenshotB64() { return Buffer.from('png').toString('base64'); }
    url() { return this.at; }
    fingerprint() { return hoisted.computePageFingerprint(); }
    accessibilitySnapshot() { return hoisted.accessibilitySnapshot(); }
    async dispose() {}
  },
  extractSessionCookies: vi.fn(() => null),
}));

vi.mock('../../src/automation/vision.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/automation/vision.js')>(
    '../../src/automation/vision.js',
  );
  return {
    ...actual,
    resolvePlaywrightAction: hoisted.resolvePlaywrightAction,
    verifyOutcome: hoisted.verifyOutcome,
    classifyHumanAction: hoisted.classifyHumanAction,
  };
});

vi.mock('../../src/automation/cache.js', () => ({
  lookupActionCache: hoisted.lookupActionCache,
  writeActionCache: hoisted.writeActionCache,
  lookupAssertionCache: hoisted.lookupAssertionCache,
  writeAssertionCache: hoisted.writeAssertionCache,
  evictCacheForFingerprint: vi.fn(),
}));

vi.mock('../../src/automation/rehearsal.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/automation/rehearsal.js')>(
    '../../src/automation/rehearsal.js',
  );
  return {
    ...actual,
    proposePatch: hoisted.proposePatch,
  };
});

// ---------------------------------------------------------------------------
// Imports (post-mock)
// ---------------------------------------------------------------------------

import { runAutomation, rehearseAutomation, type RunContext } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setIntegrationActionExecutor,
  setIntegrationActionDeclarationResolver,
  setPlatformIntegrationCaller,
  setScopedMemoryResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import type { Automation } from '../../src/automation/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<RunContext> = {}): RunContext {
  return {
    ownerUserId: 'user-1',
    orgId: 'org-1',
    triggeredBy: 'user',
    visitedAutomationIds: new Set(),
    traceId: 'trace-1',
    ...overrides,
  };
}

function automation(steps: Automation['steps'], id = 'auto-1'): Automation {
  return {
    id,
    name: 'Test',
    description: '',
    steps,
    ownerUserId: 'user-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.automations.clear();
  hoisted.runs.clear();
  hoisted.localSessionOpts.length = 0;

  // Seams: reset to honest defaults, then wire the fakes each test needs.
  __resetAutomationSeamsForTests();
  process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'true';
  __resetAutomationConfigForTests();

  // Default: daemon connected — the engine takes the DaemonBrowserSession
  // path. Tests exercising the daemon-less fallback override this with
  // setDaemonConnectionResolver(() => null).
  setDaemonConnectionResolver(() => hoisted.bridgeConnection);
  setIntegrationActionExecutor(async () => ({
    success: false,
    error: 'integration slack is not connected for this user',
  }));
  setPlatformIntegrationCaller(async () => ({ success: true, data: { ok: true } }));
  setScopedMemoryResolver(async () => []);

  hoisted.lookupActionCache.mockResolvedValue(null);
  hoisted.lookupAssertionCache.mockResolvedValue(null);
  hoisted.writeActionCache.mockResolvedValue(undefined);
  hoisted.writeAssertionCache.mockResolvedValue(undefined);
  // Default: the daemon browser act/assert succeed.
  hoisted.act.mockResolvedValue(undefined);
  hoisted.assert.mockResolvedValue(true);
  hoisted.accessibilitySnapshot.mockReturnValue(undefined);
  hoisted.classifyHumanAction.mockResolvedValue(null);
  hoisted.screenshotBytes = Buffer.from('png');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAutomation', () => {
  it('runs a single browser step end-to-end via vision (cache miss)', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'click save', type: 'browser',
    }]));

    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Save' } },
      reasoning: 'click save',
      confidence: 'high',
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.lookupActionCache).toHaveBeenCalledTimes(1);
    expect(hoisted.resolvePlaywrightAction).toHaveBeenCalledTimes(1);
    expect(hoisted.writeActionCache).toHaveBeenCalledTimes(1);

    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.status).toBe('completed');
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].tier).toBe('vision');
  });

  it('uses cached action without calling vision when cache hits', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'click save', type: 'browser',
    }]));
    hoisted.lookupActionCache.mockResolvedValueOnce({
      kind: 'action-cache',
      fingerprint: { origin: 'https://x.com', pathname: '/', pathSuffix: '', titleHash: 'h', headingHash: 'h', domShapeHash: 'h', viewport: { w: 1280, h: 800 } },
      fingerprintKey: 'https://x.com|h',
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Save' } },
      successCount: 3,
      lastUsedAt: '2026-04-29T00:00:00Z',
      confidence: 'high',
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.resolvePlaywrightAction).not.toHaveBeenCalled();
    expect(hoisted.act).toHaveBeenCalledTimes(1);
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].tier).toBe('cache');
  });

  it('falls back to vision when cached action fails at runtime', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'click save', type: 'browser',
    }]));
    hoisted.lookupActionCache.mockResolvedValueOnce({
      kind: 'action-cache',
      fingerprint: { origin: 'https://x.com', pathname: '/', pathSuffix: '', titleHash: 'h', headingHash: 'h', domShapeHash: 'h', viewport: { w: 1280, h: 800 } },
      fingerprintKey: 'https://x.com|h',
      action: { kind: 'click', locator: { strategy: 'css', selector: '.stale' } },
      successCount: 1,
      lastUsedAt: '2026-04-01T00:00:00Z',
      confidence: 'high',
    });
    // Cached action fails BOTH deterministic attempts (STEP_RETRY_BUDGET.deterministicRetries is
    // one re-attempt on top of the first), then a fresh resolution succeeds. Failing it only once
    // no longer reaches vision at all - that case is the retry spec below.
    hoisted.act
      .mockRejectedValueOnce(new Error('selector not found'))
      .mockRejectedValueOnce(new Error('selector not found'))
      .mockResolvedValueOnce(undefined);
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Save' } },
      reasoning: 'fresh resolve',
      confidence: 'high',
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.resolvePlaywrightAction).toHaveBeenCalledTimes(1);
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].tier).toBe('cache-then-vision');
  });

  it('calls vision exactly once (Opus on max — no Sonnet→Opus escalation)', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'do thing', type: 'browser',
    }]));
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button' } },
      reasoning: 'Opus solved it',
      confidence: 'medium',
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.resolvePlaywrightAction).toHaveBeenCalledTimes(1);
  });

  it('marks the step failed when vision throws (no escalation, single attempt)', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'do thing', type: 'browser',
    }]));
    hoisted.resolvePlaywrightAction.mockRejectedValueOnce(new Error('vision failed'));

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('failed');
    expect(hoisted.resolvePlaywrightAction).toHaveBeenCalledTimes(1);
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].status).toBe('failed');
    expect(run.steps[0].error.message).toMatch(/vision resolution failed/);
    expect(run.steps[0].error.message).toMatch(/vision failed/);
  });

  it('confidence gate: a low-confidence resolver result fails the step (recoverable) without executing or caching', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'do thing', type: 'browser',
    }]));
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'text', value: 'Sign in' } },
      reasoning: 'guessing',
      confidence: 'low',
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('failed');
    expect(hoisted.act).not.toHaveBeenCalled();
    expect(hoisted.writeActionCache).not.toHaveBeenCalled();
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].status).toBe('failed');
    expect(run.steps[0].error.message).toMatch(/low confidence/);
    expect(run.steps[0].error.recoverable).toBe(true);
  });

  it('empty-screenshot guard: a browser step never calls vision with a blank image; fails recoverable in PT', async () => {
    // Both the initial read and the forced re-observe come back empty (the capture failed) — the
    // engine must refuse to resolve blind rather than hand the model a blank screenshot.
    hoisted.screenshotBytes = Buffer.alloc(0);
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'click save', type: 'browser',
    }]));

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('failed');
    // The whole point: vision is NEVER asked to work off an empty screenshot.
    expect(hoisted.resolvePlaywrightAction).not.toHaveBeenCalled();
    expect(hoisted.act).not.toHaveBeenCalled();
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].status).toBe('failed');
    expect(run.steps[0].error.recoverable).toBe(true);
    expect(run.steps[0].error.message).toMatch(/captura de ecrã indisponível/);
  });

  it('empty-screenshot guard: a verify step never calls the verifier with a blank image', async () => {
    hoisted.screenshotBytes = Buffer.alloc(0);
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'confirm result', type: 'verify', expectedOutcome: 'the page shows a success banner',
    }]));

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('failed');
    expect(hoisted.verifyOutcome).not.toHaveBeenCalled();
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].status).toBe('failed');
    expect(run.steps[0].error.recoverable).toBe(true);
    expect(run.steps[0].error.message).toMatch(/captura de ecrã indisponível/);
  });

  it('planner-authored cachedAssertion: verify step runs assertion deterministically without calling vision', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1',
      description: 'Confirm we are on the contact page',
      type: 'verify',
      expectedOutcome: 'URL contains /contacto',
      cachedAssertion: { kind: 'expect_url', pattern: '/contacto' },
    }]));
    hoisted.assert.mockResolvedValueOnce(undefined);

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.assert).toHaveBeenCalledWith(
      { kind: 'expect_url', pattern: '/contacto' },
    );
    expect(hoisted.verifyOutcome).not.toHaveBeenCalled();
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].tier).toBe('cache');
    expect(run.steps[0].assertionResolved).toEqual({ kind: 'expect_url', pattern: '/contacto' });
  });

  it('planner-authored cachedAssertion: falls through to vision when the assertion fails', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1',
      description: 'Confirm contact page',
      type: 'verify',
      expectedOutcome: 'contact page is showing',
      cachedAssertion: { kind: 'expect_url', pattern: '/contacto' },
    }]));
    hoisted.assert.mockRejectedValueOnce(new Error('URL does not match /contacto'));
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'page shows contact heading',
      pageClassObserved: 'contact page',
      pageClassExpected: 'contact page',
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.assert).toHaveBeenCalled();
    expect(hoisted.verifyOutcome).toHaveBeenCalledTimes(1);
  });

  it('runs a verify step end-to-end via vision and caches the assertion', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'check we landed in inbox', type: 'verify', expectedOutcome: 'inbox visible',
    }]));
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'inbox header is shown',
      cachedAssertion: { kind: 'expect_text', locator: { strategy: 'role', role: 'heading' }, contains: 'Inbox' },
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.writeAssertionCache).toHaveBeenCalledTimes(1);
  });

  it('fails the run when the verifier reports outcome not met', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'check inbox', type: 'verify', expectedOutcome: 'inbox',
    }]));
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false,
      reasoning: 'still on login page',
    });

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('failed');
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].error.message).toMatch(/resultado não atingido/);
  });

  it('runs a navigate step without calling vision', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'go to page', type: 'navigate', url: 'https://example.com/',
    }]));

    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('completed');
    expect(hoisted.resolvePlaywrightAction).not.toHaveBeenCalled();
    expect(hoisted.act).toHaveBeenCalledWith({
      kind: 'navigate', url: 'https://example.com/',
    });
  });

  // ── STEP TEXT IS TEMPLATED, AND NOTHING USED TO RESOLVE IT ──────────────────────────────────
  //
  // The engine passed `step.url` to `browser.act` and `step.description` to the vision resolver
  // exactly as authored. So a shipped automation template that said "introduzir o numero unico de
  // processo '{{input.numeroProcesso}}'" told the model to type those literal characters into a
  // search box, and a `navigate` step could not be pointed anywhere but the address hardcoded in
  // its own JSON - which made the citius package's `portal_url` config field decoration. Both
  // channels are pinned here because both were dead, and the failure was quiet in both: the run
  // completes and answers about the wrong thing.

  it('resolves {{input.*}} in a navigate url before driving the browser', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'abrir', type: 'navigate', url: '{{input.portal}}/mandatario',
    }]));

    const result = await runAutomation('auto-1', ctx(), { inputs: { portal: 'https://portal.example.pt' } });

    expect(result.status).toBe('completed');
    expect(hoisted.act).toHaveBeenCalledWith({ kind: 'navigate', url: 'https://portal.example.pt/mandatario' });
  });

  it('resolves {{config.*}} in a navigate url from the launching integration\'s non-secret config', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'abrir', type: 'navigate', url: '{{config.portal_url}}',
    }]));

    const result = await runAutomation(
      'auto-1',
      ctx({ configValues: { portal_url: 'https://portal.tribunais.example' } }),
    );

    expect(result.status).toBe('completed');
    expect(hoisted.act).toHaveBeenCalledWith({ kind: 'navigate', url: 'https://portal.tribunais.example' });
  });

  it('a navigate whose template resolved to NOTHING halts naming the template - the fixer must not invent a destination (found live, 2026-09-01)', async () => {
    // The live chain this pins: `{{config.portal_url}}` with no config values resolves to '', the
    // old recoverable "missing url" throw handed the step to the rehearsal fixer, and the fixer -
    // whose prompt teaches "navigate_failed usually wants replace_current with a different URL" -
    // authored the REAL CITIUS portal from world knowledge and drove it. The address of a navigate
    // is the owner's fact; a run that lost it must say which template emptied and stop.
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'abrir', type: 'navigate', url: '{{config.portal_url}}',
    }]));

    const result = await runAutomation('auto-1', ctx()); // NO configValues - the seam-drop shape

    expect(result.status).toBe('failed');
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].error.recoverable).toBe(false);
    expect(run.steps[0].error.message).toContain('{{config.portal_url}}');
    // The browser was never driven anywhere, and the fixer was never asked for a patch.
    expect(hoisted.act).not.toHaveBeenCalled();
    expect(hoisted.proposePatch).not.toHaveBeenCalled();
  });

  it('resolves the step DESCRIPTION and expectedOutcome the vision model is given', async () => {
    hoisted.resolvePlaywrightAction.mockResolvedValue({
      action: { kind: 'click', selector: '#pesquisar' },
      confidence: 'high',
      reasoning: 'ok',
    });
    hoisted.automations.set('auto-1', automation([{
      id: 's1',
      type: 'browser',
      description: "introduzir o numero unico de processo '{{input.numeroProcesso}}' e submeter",
      expectedOutcome: "o processo {{input.numeroProcesso}} aparece nos resultados",
    }]));

    await runAutomation('auto-1', ctx(), { inputs: { numeroProcesso: '1234/26.0T8LSB' } });

    const call = hoisted.resolvePlaywrightAction.mock.calls[0][0];
    expect(call.stepDescription).toBe("introduzir o numero unico de processo '1234/26.0T8LSB' e submeter");
    expect(call.expectedOutcome).toBe('o processo 1234/26.0T8LSB aparece nos resultados');
    // The bug in one assertion: the model must never be handed the placeholder as an instruction.
    expect(call.stepDescription).not.toContain('{{');
  });

  it('does NOT bake the resolved text back into the saved automation', async () => {
    // Resolving in place would hardcode the first run\'s arguments into the stored steps, so the
    // next run would search for the previous run\'s process number with nothing to explain why.
    const authored = "abrir o processo '{{input.numeroProcesso}}'";
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'ir', type: 'navigate', url: '{{input.portal}}/x',
    }, {
      id: 's2', type: 'browser', description: authored,
    }]));
    hoisted.resolvePlaywrightAction.mockResolvedValue({
      action: { kind: 'click', selector: '#x' }, confidence: 'high', reasoning: 'ok',
    });

    await runAutomation('auto-1', ctx(), {
      inputs: { portal: 'https://portal.example.pt', numeroProcesso: '55/26.1T8CBR' },
    });

    const saved = hoisted.automations.get('auto-1');
    expect(saved.steps[0].url).toBe('{{input.portal}}/x');
    expect(saved.steps[1].description).toBe(authored);
  });

  it('never lets a credential reach a step description through the template channel', async () => {
    hoisted.resolvePlaywrightAction.mockResolvedValue({
      action: { kind: 'click', selector: '#x' }, confidence: 'high', reasoning: 'ok',
    });
    hoisted.automations.set('auto-1', automation([{
      id: 's1', type: 'browser', description: 'entrar com {{input.credentials.password}}',
    }]));

    await runAutomation('auto-1', ctx(), {
      inputs: { credentials: { password: 'hunter2-do-not-leak' } },
    });

    const call = hoisted.resolvePlaywrightAction.mock.calls[0][0];
    expect(call.stepDescription).toBe('entrar com ');
    expect(call.stepDescription).not.toContain('hunter2');
  });

  it('threads inputs.credentials.storageState into the LocalBrowserSession when no daemon is connected', async () => {
    // Daemon-less path: no daemon connection resolves for this run, so the engine may fall back to
    // the in-process LocalBrowserSession.
    //
    // P4.1 CHANGED THE PRECONDITION, and this test now states it rather than relying on it. The
    // fallback is no longer opened by the config flag alone — the ORIGIN POSTURE decides, in every
    // environment. So the run declares its origin PERMISSIVE through an integration action (the one
    // place a posture may be declared), and the `wait` step that follows inherits that origin. An
    // automation declaring nothing HALTS here instead, which `engine-locality.test.ts` asserts.
    setDaemonConnectionResolver(() => null);
    setIntegrationActionExecutor(async () => ({ success: true, data: { ok: true } }));
    setIntegrationActionDeclarationResolver(async () => ({
      posture: 'permissive',
      httpConfig: { baseUrl: 'https://portal.example.pt' },
    }));

    hoisted.automations.set('auto-1', automation([
      { id: 's0', description: 'open portal', type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' },
      { id: 's1', description: 'let the page settle', type: 'wait', durationMs: 5 },
    ]));

    const storageState = { cookies: [{ name: 'sessao', value: 'tok-secreto', domain: '.example.pt', path: '/' }] };
    const result = await runAutomation('auto-1', ctx(), {
      inputs: { credentials: { storageState, apiKey: 'chave-secreta' } },
    });

    expect(result.status).toBe('completed');
    expect(hoisted.localSessionOpts).toHaveLength(1);
    // The session receives EXACTLY the storageState object — not the whole
    // credentials bag, and by reference (no copy that could get logged).
    expect(hoisted.localSessionOpts[0].sessionState).toBe(storageState);
    expect(hoisted.localSessionOpts[0].sessionState.apiKey).toBeUndefined();
    // CREDENTIAL BOUNDARY (G8 Codex finding): the PERSISTED run record must NOT carry the
    // credentials bag — GET /automations/runs/:id returns inputs to the owner AND org admins.
    // Find THIS run's create call by id (runCreate is a shared hoisted mock across tests — a
    // fixed [0] index is cross-test-flaky; select by runId instead).
    const call = hoisted.runCreate.mock.calls.find((c: any[]) => c[0]?.id === result.runId);
    expect(call, 'runCreate was called for this run').toBeTruthy();
    const persisted = call![0];
    expect(persisted.inputs).toBeDefined();
    expect(persisted.inputs.credentials).toBeUndefined();
    expect(JSON.stringify(persisted.inputs)).not.toContain('chave-secreta');
    expect(JSON.stringify(persisted.inputs)).not.toContain('tok-secreto');
  });

  it('does NOT forward the session credential to the DaemonBrowserSession (local-session-only)', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'go to portal', type: 'navigate', url: 'https://portal.example.pt/',
    }]));

    const result = await runAutomation('auto-1', ctx(), {
      inputs: { credentials: { storageState: { cookies: [] } } },
    });

    expect(result.status).toBe('completed');
    // Daemon connected (default mock) — the local session is never built.
    expect(hoisted.localSessionOpts).toHaveLength(0);
  });

  it('never substitutes input.credentials into the step description the vision resolver sees', async () => {
    const secret = 'tok-SUPER-SECRET-cookie-value';
    hoisted.automations.set('auto-1', automation([{
      id: 's1', type: 'browser',
      description: "Abrir o portal com a sessao '{{input.credentials.storageState}}' ja autenticada",
    }]));
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Entrar' } },
      reasoning: 'ok',
      confidence: 'high',
    });

    const result = await runAutomation('auto-1', ctx(), {
      inputs: {
        credentials: {
          storageState: { cookies: [{ name: 'sessao', value: secret, domain: '.example.pt', path: '/' }] },
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(hoisted.resolvePlaywrightAction).toHaveBeenCalledTimes(1);
    // The full vision input (description, memories, everything serialisable)
    // must be free of credential material.
    const visionInput = hoisted.resolvePlaywrightAction.mock.calls[0]![0];
    expect(visionInput.stepDescription).not.toContain(secret);
    expect(JSON.stringify({ ...visionInput, screenshotPng: undefined })).not.toContain(secret);
  });

  it('integration step that fails with "not connected" pauses the run as awaiting_integration', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'send slack', type: 'integration',
      integrationKey: 'slack', integrationAction: 'send_message',
    }]));

    // The integration-action executor seam reports "not connected" when the
    // user has no credential row for the key — that's the awaiting-
    // integration signal the engine surfaces upward.
    const result = await runAutomation('auto-1', ctx());

    expect(result.status).toBe('awaiting_integration');
  });

  it('detects and rejects sub-automation cycles', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'call self', type: 'sub_automation', subAutomationId: 'auto-1',
    }]));

    const result = await runAutomation('auto-1', ctx());

    // The sub-automation cycle throws synchronously; the engine catches
    // it and the step record is marked failed.
    expect(result.status).toBe('failed');
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].error.message).toMatch(/cycle/);
  });

  it('emits step / complete events through the emitter', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'go', type: 'navigate', url: 'https://x.com',
    }]));

    const events: any[] = [];
    const emit = {
      stepUpdate: (record: any, runId: string) => events.push({ type: 'step', record, runId }),
      runComplete: (runId: string, durationMs: number, summary: string) =>
        events.push({ type: 'complete', runId, durationMs, summary }),
      runError: (runId: string, error: string, partial: any[]) =>
        events.push({ type: 'error', runId, error, partial }),
      runPaused: (runId: string, reason: string, service: string) =>
        events.push({ type: 'paused', runId, reason, service }),
    };

    await runAutomation('auto-1', ctx(), { emit });

    const types = events.map((e) => e.type);
    expect(types).toContain('step');
    expect(types).toContain('complete');
  });

  it('rejects an unknown automation id', async () => {
    await expect(runAutomation('nope', ctx())).rejects.toThrow(/not found/);
  });

  it('rejects when a non-owner tries to run via "user" trigger', async () => {
    hoisted.automations.set('auto-1', { ...automation([{ id: 's1', description: '', type: 'wait', durationMs: 10 }]), ownerUserId: 'other' });

    await expect(runAutomation('auto-1', ctx({ ownerUserId: 'user-1', triggeredBy: 'user' })))
      .rejects.toThrow(/forbidden/);
  });
});

// ---------------------------------------------------------------------------
// Self-correction (rehearsal) loop
// ---------------------------------------------------------------------------

describe('rehearseAutomation', () => {
  it('inserts a step before a failed verify and retries — the next attempt completes', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify page is ready', type: 'verify', expectedOutcome: 'search box is interactive' },
    ]));

    // First verify pass: failed (overlay blocking).
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false,
      reasoning: 'cookie consent modal blocks the search box',
    });
    // Inserted browser step (vision resolves it).
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Accept' } },
      reasoning: 'click Accept on the cookie consent dialog',
      confidence: 'high',
    });
    // Second verify pass: passes.
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'search box is visible',
      cachedAssertion: { kind: 'expect_visible', locator: { strategy: 'role', role: 'searchbox' } },
    });

    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'insert_before',
      newStep: { id: 'dismiss-cookies', type: 'browser', description: 'Click Accept on the cookie consent dialog' },
      reasoning: 'cookie modal needs to be dismissed first',
    });

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'search ekoa' });

    expect(result.status).toBe('completed');
    expect(result.refinedSteps).toHaveLength(2);
    expect(result.refinedSteps[0]!.id).toBe('dismiss-cookies');
    expect(result.refinedSteps[1]!.id).toBe('s1');
    expect(result.rehearsal.patchesApplied).toBe(1);
    expect(result.rehearsal.fixerCallCount).toBe(1);
    expect(hoisted.proposePatch).toHaveBeenCalledTimes(1);

    // Refined steps were persisted back to the automation store.
    const stored = hoisted.automations.get('auto-1');
    expect(stored.steps).toHaveLength(2);
    expect(stored.steps[0].id).toBe('dismiss-cookies');
  });

  it('replaces the current step on a browser action failure', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'click submit', type: 'browser' },
    ]));

    // First attempt: vision returns an action that throws on execute.
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'css', selector: '.wrong' } },
      reasoning: 'try the wrong selector',
      confidence: 'high',
    });
    hoisted.act.mockRejectedValueOnce(new Error('locator not found'));

    // Patch replaces the step with a clearer description.
    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'replace_current',
      newStep: { id: 's1-v2', type: 'browser', description: 'Click the primary "Submit" button at the bottom of the form' },
      reasoning: 'clearer description so vision picks the right element',
    });

    // Second attempt: vision succeeds.
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Submit' } },
      reasoning: 'pick the submit button',
      confidence: 'high',
    });
    hoisted.act.mockResolvedValueOnce(undefined);

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'submit form' });

    expect(result.status).toBe('completed');
    expect(result.refinedSteps).toHaveLength(1);
    expect(result.refinedSteps[0]!.id).toBe('s1-v2');
    expect(result.rehearsal.patchesApplied).toBe(1);
  });

  it('skip_current drops the failing step and continues', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'maybe dismiss', type: 'browser' },
      { id: 's2', description: 'verify done', type: 'verify', expectedOutcome: 'success' },
    ]));

    // s1: vision fails to resolve.
    hoisted.resolvePlaywrightAction.mockRejectedValueOnce(new Error('cannot resolve action'));
    // Fixer: skip it.
    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'skip_current',
      reasoning: 'no dismiss button on this page; skip',
    });
    // s2: passes.
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'success indicator present',
    });

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'do thing' });

    expect(result.status).toBe('completed');
    expect(result.refinedSteps).toHaveLength(1);
    expect(result.refinedSteps[0]!.id).toBe('s2');
    expect(result.rehearsal.patchesApplied).toBe(1);
  });

  it('fails fast when the fixer aborts', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify access', type: 'verify', expectedOutcome: 'logged in' },
    ]));

    hoisted.verifyOutcome.mockResolvedValueOnce({ passed: false, reasoning: 'login wall' });
    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'abort',
      reasoning: 'login wall and no integration available',
    });

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'view dashboard' });

    expect(result.status).toBe('failed');
    expect(result.rehearsal.status).toBe('aborted');
    expect(result.rehearsal.stuckAtIndex).toBe(0);
    expect(result.rehearsal.reason).toMatch(/login wall/);
  });

  it('emits proposing + applied patch events when fixing a step', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify ready', type: 'verify', expectedOutcome: 'logo visible' },
    ]));

    hoisted.verifyOutcome.mockResolvedValueOnce({ passed: false, reasoning: 'overlay blocking' });
    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'insert_before',
      newStep: { id: 'dismiss', type: 'browser', description: 'Dismiss the overlay' },
      reasoning: 'overlay must be dismissed first',
    });
    hoisted.resolvePlaywrightAction.mockResolvedValueOnce({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'OK' } },
      reasoning: 'click OK', confidence: 'high',
    });
    hoisted.verifyOutcome.mockResolvedValueOnce({ passed: true, reasoning: 'logo visible' });

    const patchEvents: any[] = [];
    const emit = {
      stepUpdate: () => {},
      runComplete: () => {},
      runError: () => {},
      runPaused: () => {},
      runPatch: (_runId: string, info: unknown) => patchEvents.push(info),
    };

    await rehearseAutomation('auto-1', ctx(), { goal: 'g', emit });

    const phases = patchEvents.map((e) => e.phase);
    expect(phases).toContain('proposing');
    expect(phases).toContain('applied');

    const applied = patchEvents.find((e) => e.phase === 'applied');
    expect(applied.patchKind).toBe('insert_before');
    expect(applied.newStepDescription).toContain('overlay');
    expect(applied.failureKind).toBe('verify_failed');
  });

  it('emits an aborted patch event when the fixer gives up', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify', type: 'verify', expectedOutcome: 'never' },
    ]));
    hoisted.verifyOutcome.mockResolvedValueOnce({ passed: false, reasoning: 'login wall' });
    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'abort',
      reasoning: 'paywall — cannot recover',
    });

    const patchEvents: any[] = [];
    const emit = {
      stepUpdate: () => {}, runComplete: () => {},
      runError: () => {}, runPaused: () => {},
      runPatch: (_runId: string, info: unknown) => patchEvents.push(info),
    };

    await rehearseAutomation('auto-1', ctx(), { goal: 'g', emit });

    expect(patchEvents.map((e) => e.phase)).toEqual(['proposing', 'aborted']);
    const aborted = patchEvents.find((e) => e.phase === 'aborted');
    expect(aborted.patchKind).toBe('abort');
    expect(aborted.reasoning).toMatch(/paywall/);
  });

  it('threads the daemon accessibility snapshot through to the fixer', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify', type: 'verify', expectedOutcome: 'never' },
    ]));
    hoisted.verifyOutcome.mockResolvedValueOnce({ passed: false, reasoning: 'no' });
    hoisted.proposePatch.mockResolvedValueOnce({ kind: 'abort', reasoning: 'stop' });

    // The trimmed accessibility outline is now part of the daemon's
    // browser observation (BrowserSession.accessibilitySnapshot()); the
    // engine just forwards it to the fixer. Stub what the daemon returns.
    hoisted.accessibilitySnapshot.mockReturnValue(
      '- button "Sign in"\n- textbox "Search" value="foo"',
    );

    await rehearseAutomation('auto-1', ctx(), { goal: 'g' });

    expect(hoisted.proposePatch).toHaveBeenCalledTimes(1);
    const arg = hoisted.proposePatch.mock.calls[0]![0];
    expect(arg.accessibilitySnapshot).toBeTruthy();
    expect(arg.accessibilitySnapshot).toMatch(/button/);
    expect(arg.accessibilitySnapshot).toMatch(/Sign in/);
    expect(arg.accessibilitySnapshot).toMatch(/textbox/);
  });

  it('pauses for user when fixer returns pause_for_user, resumes after signal, retries the step', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify ready', type: 'verify', expectedOutcome: 'no captcha' },
    ]));

    // First verify: failed with a message that doesn't match the
    // fast-path detector (so the fixer is the one that decides to
    // pause). Fixer says pause_for_user. After resume, verify passes.
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false,
      reasoning: 'page is in an unexpected state',
    });
    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'pause_for_user',
      reasoning: 'reCAPTCHA challenge',
      userInstructions: 'Solve the CAPTCHA, then click Continue.',
    });
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'CAPTCHA cleared, page is ready',
    });

    // Resume signal: flip to true after a short delay so the pause loop
    // is exercised.
    let shouldResume = false;
    setTimeout(() => { shouldResume = true; }, 100);

    const events: any[] = [];
    const emit = {
      stepUpdate: () => {},
      runComplete: () => {},
      runError: () => {},
      runPaused: () => {},
      runPatch: (_runId: string, info: unknown) => events.push({ kind: 'patch', info }),
      runPauseForUser: (_runId: string, info: unknown) => events.push({ kind: 'pause', info }),
      runResumed: (_runId: string, stepIndex: number) => events.push({ kind: 'resumed', stepIndex }),
    };

    const result = await rehearseAutomation('auto-1', ctx({
      resumeSignal: {
        shouldResume: () => shouldResume,
        clear: () => { shouldResume = false; },
      },
    }), { goal: 'view page', emit });

    expect(result.status).toBe('completed');
    // Plan didn't change — pause_for_user is a no-op patch.
    expect(result.refinedSteps).toHaveLength(1);
    expect(result.refinedSteps[0]!.id).toBe('s1');

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('pause');
    expect(kinds).toContain('resumed');

    const pauseEv = events.find((e) => e.kind === 'pause');
    expect(pauseEv.info.userInstructions).toMatch(/CAPTCHA/);
    expect(pauseEv.info.reasoning).toMatch(/reCAPTCHA/);

    // Verifier was called twice: once before the pause (failed), once
    // after resume (passed).
    expect(hoisted.verifyOutcome.mock.calls.length).toBe(2);
  });

  it('haiku classifier fallback: pauses when verifier humanAction missing AND regex did not match', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify ready', type: 'verify', expectedOutcome: 'something' },
    ]));

    // Verifier returns a non-CAPTCHA-shaped failure with NO
    // humanAction populated. Regex won't match. Only the Haiku
    // classifier can save the day — and it does.
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false,
      reasoning: 'page is in an unexpected state',
      // humanAction deliberately absent
    });
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'cleared',
    });

    // Haiku classifier — this is where the user's /sorry/ case lands.
    hoisted.classifyHumanAction.mockResolvedValueOnce({
      kind: 'captcha',
      userInstructions: 'Confirme que não é um robô na janela aberta, depois clique em Continuar.',
    });

    let shouldResume = false;
    setTimeout(() => { shouldResume = true; }, 100);

    const events: any[] = [];
    const emit = {
      stepUpdate: () => {},
      runComplete: () => {},
      runError: () => {},
      runPaused: () => {},
      runPatch: (_runId: string, info: unknown) => events.push({ kind: 'patch', info }),
      runPauseForUser: (_runId: string, info: unknown) => events.push({ kind: 'pause', info }),
      runResumed: (_runId: string, stepIndex: number) => events.push({ kind: 'resumed', stepIndex }),
    };

    const result = await rehearseAutomation('auto-1', ctx({
      resumeSignal: {
        shouldResume: () => shouldResume,
        clear: () => { shouldResume = false; },
      },
    }), { goal: 'view page', emit });

    expect(result.status).toBe('completed');
    // Haiku classifier was consulted (and supplied the pause).
    expect(hoisted.classifyHumanAction).toHaveBeenCalled();
    // Fixer was NOT consulted — the classifier short-circuited it.
    expect(hoisted.proposePatch).not.toHaveBeenCalled();
    const pauseEv = events.find((e) => e.kind === 'pause');
    expect(pauseEv).toBeTruthy();
    expect(pauseEv.info.userInstructions).toMatch(/robô|robot|continuar|continue/i);
  });

  it('verifier humanAction: pauses immediately when the verifier flags a CAPTCHA structurally', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify ready', type: 'verify', expectedOutcome: 'no captcha' },
    ]));

    // Verifier explicitly classifies the page as captcha via the
    // structured humanAction field. Reasoning text is intentionally
    // generic ("page is in an unexpected state") so the regex
    // fast-path won't match — only the verifier signal can drive
    // the pause here.
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false,
      reasoning: 'page is in an unexpected state',
      humanAction: {
        kind: 'captcha',
        userInstructions: 'Solve the reCAPTCHA in the open browser, then click Continue.',
      },
    });
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'cleared',
    });

    let shouldResume = false;
    setTimeout(() => { shouldResume = true; }, 100);

    const events: any[] = [];
    const emit = {
      stepUpdate: () => {},
      runComplete: () => {},
      runError: () => {},
      runPaused: () => {},
      runPatch: (_runId: string, info: unknown) => events.push({ kind: 'patch', info }),
      runPauseForUser: (_runId: string, info: unknown) => events.push({ kind: 'pause', info }),
      runResumed: (_runId: string, stepIndex: number) => events.push({ kind: 'resumed', stepIndex }),
    };

    const result = await rehearseAutomation('auto-1', ctx({
      resumeSignal: {
        shouldResume: () => shouldResume,
        clear: () => { shouldResume = false; },
      },
    }), { goal: 'view page', emit });

    expect(result.status).toBe('completed');
    // Verifier signal alone is enough — fixer not consulted.
    expect(hoisted.proposePatch).not.toHaveBeenCalled();
    const pauseEv = events.find((e) => e.kind === 'pause');
    expect(pauseEv).toBeTruthy();
    expect(pauseEv.info.userInstructions).toMatch(/reCAPTCHA/);
    // A CAPTCHA offers no sign-in choice, so the Google warning has no business here.
    expect(pauseEv.info.userInstructions).not.toMatch(/bloqueia navegadores automatizados/);
  });

  it('a LOGIN pause carries the Google-SSO warning the model was never asked to write', async () => {
    // Google refuses OAuth from the browser this pause is happening in (findings:
    // `google-sso-refuses-the-automated-ceremony-browser`), so the button the user would reach for
    // first is the one that cannot work. The engine appends the warning rather than hoping the
    // vision prompt produced it: what the person reads must not depend on a model's mood.
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify signed in', type: 'verify', expectedOutcome: 'signed in' },
    ]));

    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false,
      reasoning: 'page is in an unexpected state',
      humanAction: {
        kind: 'login',
        userInstructions: 'Inicie sessão na janela aberta e depois clique em Continuar.',
      },
    });
    hoisted.verifyOutcome.mockResolvedValueOnce({ passed: true, reasoning: 'cleared' });

    let shouldResume = false;
    setTimeout(() => { shouldResume = true; }, 100);

    const events: any[] = [];
    const emit = {
      stepUpdate: () => {},
      runComplete: () => {},
      runError: () => {},
      runPaused: () => {},
      runPatch: () => {},
      runPauseForUser: (_runId: string, info: unknown) => events.push({ kind: 'pause', info }),
      runResumed: () => {},
    };

    const result = await rehearseAutomation('auto-1', ctx({
      resumeSignal: {
        shouldResume: () => shouldResume,
        clear: () => { shouldResume = false; },
      },
    }), { goal: 'read the account page', emit });

    expect(result.status).toBe('completed');
    const pauseEv = events.find((e) => e.kind === 'pause');
    expect(pauseEv).toBeTruthy();
    // The model's own instruction survives; the warning is added to it, not instead of it.
    expect(pauseEv.info.userInstructions).toMatch(/Inicie sessão na janela aberta/);
    expect(pauseEv.info.userInstructions).toMatch(/a Google bloqueia navegadores automatizados/);
  });

  it('fast-path: pauses immediately on a CAPTCHA-shaped verifier failure without calling the fixer', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify ready', type: 'verify', expectedOutcome: 'no captcha' },
    ]));

    // Verifier message contains the CAPTCHA fast-path keyword. The
    // engine should pause for the user *without* the slow Opus fixer
    // round-trip. Fixer mock is left empty so the test fails loudly
    // if anything routes through it.
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false,
      reasoning: 'The page shows a Google reCAPTCHA verification page, not search results',
    });
    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: true,
      reasoning: 'CAPTCHA cleared',
    });

    let shouldResume = false;
    setTimeout(() => { shouldResume = true; }, 100);

    const events: any[] = [];
    const emit = {
      stepUpdate: () => {},
      runComplete: () => {},
      runError: () => {},
      runPaused: () => {},
      runPatch: (_runId: string, info: unknown) => events.push({ kind: 'patch', info }),
      runPauseForUser: (_runId: string, info: unknown) => events.push({ kind: 'pause', info }),
      runResumed: (_runId: string, stepIndex: number) => events.push({ kind: 'resumed', stepIndex }),
    };

    const result = await rehearseAutomation('auto-1', ctx({
      resumeSignal: {
        shouldResume: () => shouldResume,
        clear: () => { shouldResume = false; },
      },
    }), { goal: 'view page', emit });

    expect(result.status).toBe('completed');
    // Fast-path bypasses the fixer entirely.
    expect(hoisted.proposePatch).not.toHaveBeenCalled();
    // Pause event fired, with the synthetic instructions.
    const pauseEv = events.find((e) => e.kind === 'pause');
    expect(pauseEv).toBeTruthy();
    expect(pauseEv.info.userInstructions).toMatch(/CAPTCHA/);
  });

  it('cancelling during pause_for_user ends the run as cancelled', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify', type: 'verify', expectedOutcome: 'whatever' },
    ]));

    hoisted.verifyOutcome.mockResolvedValueOnce({
      passed: false, reasoning: 'page is in an unexpected state',
    });
    hoisted.proposePatch.mockResolvedValueOnce({
      kind: 'pause_for_user',
      reasoning: 'something only a human can resolve',
      userInstructions: 'solve please',
    });

    // Cancel after 100ms — never resume.
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 100);

    const result = await rehearseAutomation('auto-1', ctx({
      cancellation: { isCancelled: () => cancelled },
      resumeSignal: { shouldResume: () => false, clear: () => {} },
    }), { goal: 'g' });

    expect(result.status).toBe('cancelled');
  });

  it('respects the per-index patch cap', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify', type: 'verify', expectedOutcome: 'never' },
    ]));

    // The verifier never passes; the fixer keeps proposing replace_current.
    hoisted.verifyOutcome.mockResolvedValue({ passed: false, reasoning: 'still failing' });
    hoisted.proposePatch.mockResolvedValue({
      kind: 'replace_current',
      newStep: { id: 's1', type: 'verify', description: 'verify', expectedOutcome: 'never' },
      reasoning: 'try again',
    });

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'impossible' });

    expect(result.status).toBe('failed');
    expect(result.rehearsal.status).toBe('stuck');
    expect(hoisted.proposePatch.mock.calls.length).toBeLessThanOrEqual(5); // maxPatchesPerIndex
  });
});

// ---------------------------------------------------------------------------
// The write rails: an unapproved write PAUSES the run, and the fixer is never
// invited to route around the refusal.
// ---------------------------------------------------------------------------

/**
 * C2 landed the gate; its reviewer found that the engine did not honour it. An `awaiting_consent`
 * refusal came back as an ordinary failure (the pause branch keyed on `/not connected/i`), so the
 * run reported `failed` - a state a caller retries - instead of "a human has to answer this", and
 * on the step types the fixer does handle it was a live invitation to rewrite the refused step.
 *
 * These specs pin the two halves, per rail. Revert either and a named test here goes red.
 */
describe('write rails - the run pauses on an unapproved write', () => {
  it('an integration step refused by the write gate pauses the run in awaiting_consent', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'send an invoice', type: 'integration',
      integrationKey: 'slack', integrationAction: 'send_message',
    }]));
    // Exactly what `executeUserIntegrationAction` (and, since this slice, `callPlatformIntegration`)
    // answers: the CODE on `details`, never a message the engine has to pattern-match.
    setIntegrationActionExecutor(async () => ({
      success: false,
      error: 'action "send_message" on slack writes (POST https://slack.example/send) and needs the owner\'s approval before it can run',
      details: 'awaiting_consent',
    }));

    const paused: Array<[string, string]> = [];
    const errors: string[] = [];
    const result = await runAutomation('auto-1', ctx(), {
      emit: {
        stepUpdate: () => {}, runComplete: () => {},
        runError: (_id, e) => { errors.push(e); },
        runPaused: (_id, reason, service) => { paused.push([reason, service]); },
      },
    });

    expect(result.status).toBe('awaiting_consent');
    expect(result.summary).toMatch(/approval/);
    // NOT awaiting_integration, on either surface: "connect the integration" sends a user who has to
    // APPROVE AN ACTION to the wrong place entirely, and the `paused` frame carries only a service
    // name so it could say nothing else.
    expect(result.status).not.toBe('awaiting_integration');
    expect(paused).toEqual([]);
    // The terminal frame carries the actionable message instead - the USER-facing frame is
    // PT-PT product copy (the English /approval/ this used to pin lives only on the internal
    // record message, asserted via result.summary above).
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/aprova/i);
    // The fixer is never asked: a non-recoverable record is refused by shouldAttemptFix.
    expect(hoisted.proposePatch).not.toHaveBeenCalled();
    // …and the record SAYS non-recoverable, rather than relying on `integration` happening to be a
    // step type the fixer declines today. Drop the `awaitingConsent` term from the engine's
    // `recoverable` and this assertion is the one that notices.
    const stored = [...hoisted.runs.values()][0] as { steps: Array<{ error?: { recoverable?: boolean } }> };
    expect(stored.steps[0]!.error!.recoverable).toBe(false);
  });

  it('the same refusal in a REHEARSAL does not reach the self-heal fixer either', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'send an invoice', type: 'integration',
      integrationKey: 'google-workspace', integrationAction: 'send_email',
    }]));
    setPlatformIntegrationCaller(async () => ({
      success: false,
      error: 'action "send_email" on google-workspace writes (POST https://gmail.googleapis.com/…) and needs the owner\'s approval before it can run',
      details: 'awaiting_consent',
    }));

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'send it' });

    expect(result.status).toBe('awaiting_consent');
    expect(hoisted.proposePatch).not.toHaveBeenCalled();
  });

  it('a NON-mutating integration step still completes untouched (Rule 7)', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'list emails', type: 'integration',
      integrationKey: 'google-workspace', integrationAction: 'list_emails',
    }]));
    setPlatformIntegrationCaller(async () => ({ success: true, data: { messages: [] } }));

    const result = await runAutomation('auto-1', ctx(), {});
    expect(result.status).toBe('completed');
  });

  it('an unapproved api_call step on an UNATTENDED run cancels - it never runs the request', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'post it', type: 'api_call',
      apiRequest: { method: 'POST', url: 'https://api.example.com/send', body: '{"a":1}' },
    } as never]));

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      // No resumeSignal - the listener/webhook shape. `waitForResumeOrCancel` answers false at once,
      // so an unapproved write is refused rather than left hanging on a human who is not there.
      const result = await runAutomation('auto-1', ctx(), {});
      expect(result.status).toBe('cancelled');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(hoisted.proposePatch).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('an ATTENDED run raises the consent dialog and continues once the shape is approved', async () => {
    const spec = { method: 'POST', url: 'https://api.example.com/send', body: '{"a":1}' };
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'post it', type: 'api_call', apiRequest: spec,
    } as never]));

    const { apiCallConsentShape } = await import('../../src/automation/executors/api-call.js');
    const shape = apiCallConsentShape(spec);
    const approvedThisRun = new Set<string>();
    const asked: Array<{ shape: string; argv: string[]; description: string }> = [];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    try {
      const result = await runAutomation('auto-1', ctx({
        // The handler's resolve-consent intent, in miniature: it banks the shape the RUN asked
        // about and sets the resume flag.
        resumeSignal: { shouldResume: () => approvedThisRun.has(shape), clear: () => {} },
        runApprovedShapes: { has: (s) => approvedThisRun.has(s), add: (s) => { approvedThisRun.add(s); } },
      }), {
        emit: {
          stepUpdate: () => {}, runComplete: () => {}, runError: () => {}, runPaused: () => {},
          runAwaitingConsent: (_id, info) => {
            asked.push({ shape: info.shape, argv: info.argv, description: info.description });
            approvedThisRun.add(info.shape); // the human clicks "permitir uma vez"
          },
        },
      });

      // It ASKED - with the method and URL template the dialog shows - and only then ran.
      expect(asked.length).toBe(1);
      expect(asked[0]!.shape).toBe(shape);
      expect(asked[0]!.argv).toEqual(['POST', 'https://api.example.com/send']);
      expect(result.status).toBe('completed');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('a GET api_call step runs with no dialog at all (Rule 7)', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'read it', type: 'api_call',
      apiRequest: { method: 'GET', url: 'https://api.example.com/things' },
    } as never]));

    const asked: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    try {
      const result = await runAutomation('auto-1', ctx(), {
        emit: {
          stepUpdate: () => {}, runComplete: () => {}, runError: () => {}, runPaused: () => {},
          runAwaitingConsent: (_id, info) => { asked.push(info.shape); },
        },
      });
      expect(result.status).toBe('completed');
      expect(asked).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// budgets.ts wiring: the normal-run wall-clock cap, and the per-step retry.
// ---------------------------------------------------------------------------

/**
 * Both knobs existed only for rehearsal before `automation/budgets.ts`. A normal run had NO
 * wall-clock ceiling at all, and the only retry in the engine - the cache-then-vision fallthrough -
 * was an uncounted `catch`. These specs pin the two behaviours the wiring introduced, and the two
 * it must NOT have changed (rehearsal's own budget, and human-pause time staying free).
 */
describe('run budgets', () => {
  /** Advance the engine's clock without touching `new Date()` (which produces `startedAt`). */
  function skewClock(): { advance: (ms: number) => void; restore: () => void } {
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    return { advance: (ms: number) => { skew = ms; }, restore: () => spy.mockRestore() };
  }

  const silentEmit = () => ({
    stepUpdate: () => {}, runComplete: () => {}, runError: () => {}, runPaused: () => {},
  });

  it('a NORMAL run trips NORMAL_RUN_BUDGET.maxWallClockMs and fails through runError', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'go', type: 'navigate', url: 'https://x.com/one' },
      { id: 's2', description: 'go again', type: 'navigate', url: 'https://x.com/two' },
    ]));

    const clock = skewClock();
    // The first navigate burns nine minutes of wall clock; the guard at the top of the loop sees
    // it before step two ever starts.
    hoisted.act.mockImplementation(async () => { clock.advance(9 * 60 * 1000); });

    const errors: string[] = [];
    try {
      const result = await runAutomation('auto-1', ctx(), {
        emit: { ...silentEmit(), runError: (_id, e) => { errors.push(e); } },
      });

      expect(result.status).toBe('failed');
      expect(result.error).toMatch(/wall-clock budget of 480000ms exhausted/);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/wall-clock budget of 480000ms exhausted/);

      const run = hoisted.runs.get('auto-1:' + result.runId);
      expect(run.status).toBe('failed');
      // Step two never ran, and a normal run manufactures NO rehearsal summary on the way out.
      expect(run.steps).toHaveLength(1);
      expect(run.rehearsalSummary).toBeUndefined();
    } finally {
      clock.restore();
    }
  });

  it('the two caps are distinct: 5 minutes trips rehearsal (4 min) and not a normal run (8 min)', async () => {
    const steps = () => ([
      { id: 's1', description: 'go', type: 'navigate' as const, url: 'https://x.com/one' },
      { id: 's2', description: 'go again', type: 'navigate' as const, url: 'https://x.com/two' },
    ]);

    const clock = skewClock();
    hoisted.act.mockImplementation(async () => { clock.advance(5 * 60 * 1000); });
    try {
      hoisted.automations.set('auto-1', automation(steps()));
      const rehearsal = await rehearseAutomation('auto-1', ctx(), { goal: 'go', emit: silentEmit() });
      expect(rehearsal.status).toBe('failed');
      expect(rehearsal.error).toMatch(/wall-clock budget of 240000ms exhausted/);
      expect(rehearsal.rehearsal.status).toBe('budget_exhausted');

      hoisted.automations.set('auto-2', automation(steps(), 'auto-2'));
      const normal = await runAutomation('auto-2', ctx(), { emit: silentEmit() });
      expect(normal.status).toBe('completed');
    } finally {
      clock.restore();
    }
  });

  it('time the human spent paused is subtracted, so a nine-minute CAPTCHA never trips the cap', async () => {
    hoisted.automations.set('auto-1', automation([
      { id: 's1', description: 'verify ready', type: 'verify', expectedOutcome: 'no captcha' },
    ]));

    const clock = skewClock();
    hoisted.verifyOutcome
      .mockResolvedValueOnce({ passed: false, reasoning: 'The page shows a Google reCAPTCHA verification page' })
      .mockResolvedValueOnce({ passed: true, reasoning: 'CAPTCHA cleared' });

    try {
      const result = await runAutomation('auto-1', ctx({
        // The human takes nine minutes to solve it - past the eight-minute run cap - and then
        // resumes. Every millisecond of that is pause time, not run time.
        resumeSignal: { shouldResume: () => { clock.advance(9 * 60 * 1000); return true; }, clear: () => {} },
      }), { emit: silentEmit() });

      expect(result.status).toBe('completed');
      expect(hoisted.verifyOutcome).toHaveBeenCalledTimes(2);
    } finally {
      clock.restore();
    }
  });

  it('a cached action that fails once is re-attempted deterministically - no vision, no model call', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'click save', type: 'browser',
    }]));
    const cachedAction = { kind: 'click', locator: { strategy: 'css', selector: '.save' } };
    hoisted.lookupActionCache.mockResolvedValueOnce({
      kind: 'action-cache',
      fingerprint: { origin: 'https://x.com', pathname: '/', pathSuffix: '', titleHash: 'h', headingHash: 'h', domShapeHash: 'h', viewport: { w: 1280, h: 800 } },
      fingerprintKey: 'https://x.com|h',
      action: cachedAction,
      successCount: 4,
      lastUsedAt: '2026-08-01T00:00:00Z',
      confidence: 'high',
    });
    // The page had not settled: the same action succeeds on the re-attempt.
    hoisted.act
      .mockRejectedValueOnce(new Error('element is not stable'))
      .mockResolvedValueOnce(undefined);

    const result = await runAutomation('auto-1', ctx(), { emit: silentEmit() });

    expect(result.status).toBe('completed');
    // Two acts, both of the SAME resolved action: a retry, never a re-decision.
    expect(hoisted.act).toHaveBeenCalledTimes(2);
    expect(hoisted.act.mock.calls[0]![0]).toEqual(cachedAction);
    expect(hoisted.act.mock.calls[1]![0]).toEqual(cachedAction);
    // The expensive tier was never reached.
    expect(hoisted.resolvePlaywrightAction).not.toHaveBeenCalled();
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].tier).toBe('cache');
  });

  it('the vision re-ground is COUNTED per step index: the second one at the same index is refused', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'click save', type: 'browser',
    }]));
    const cachedEntry = {
      kind: 'action-cache',
      fingerprint: { origin: 'https://x.com', pathname: '/', pathSuffix: '', titleHash: 'h', headingHash: 'h', domShapeHash: 'h', viewport: { w: 1280, h: 800 } },
      fingerprintKey: 'https://x.com|h',
      action: { kind: 'click', locator: { strategy: 'css', selector: '.stale' } },
      successCount: 1,
      lastUsedAt: '2026-08-01T00:00:00Z',
      confidence: 'high',
    };
    // Every visit to index 0 hits the cache, and the cached action always fails.
    hoisted.lookupActionCache.mockResolvedValue(cachedEntry);
    hoisted.act.mockRejectedValue(new Error('selector not found'));
    // The one re-ground the budget allows resolves to something that also fails to execute, so
    // the fixer is invited and sends the run back to the same index.
    hoisted.resolvePlaywrightAction.mockResolvedValue({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Save' } },
      reasoning: 'try the button',
      confidence: 'high',
    });
    hoisted.proposePatch.mockResolvedValue({
      kind: 'replace_current',
      reasoning: 'try a different phrasing',
      newStep: { id: 's1b', type: 'browser', description: 'click the Save button' },
    });

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'save it', emit: silentEmit() });

    expect(result.status).toBe('failed');
    // THE POINT: however many times the fixer sends the run back to index 0, vision re-grounds
    // that index exactly once. Before this was counted, every visit bought another model call.
    expect(hoisted.resolvePlaywrightAction).toHaveBeenCalledTimes(1);
    const run = hoisted.runs.get('auto-1:' + result.runId);
    expect(run.steps[0].tier).toBe('cache-then-vision');
    expect(run.steps[0].error.message).toMatch(/vision re-ground budget of 1 exhausted/);
    expect(run.steps[0].error.recoverable).toBe(true);
  });

  it('a cache MISS is not a re-ground: an ordinary tier-2 resolution is never counted', async () => {
    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'click save', type: 'browser',
    }]));
    // No cache entry at any point, and the vision-resolved action keeps failing to execute, so the
    // fixer revisits index 0 repeatedly - each visit resolving with vision as it always has.
    hoisted.lookupActionCache.mockResolvedValue(null);
    hoisted.act.mockRejectedValue(new Error('selector not found'));
    hoisted.resolvePlaywrightAction.mockResolvedValue({
      action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Save' } },
      reasoning: 'the save button',
      confidence: 'high',
    });
    hoisted.proposePatch.mockResolvedValue({
      kind: 'replace_current',
      reasoning: 'try a different phrasing',
      newStep: { id: 's1b', type: 'browser', description: 'click the Save button' },
    });

    const result = await rehearseAutomation('auto-1', ctx(), { goal: 'save it', emit: silentEmit() });

    expect(result.status).toBe('failed');
    expect(hoisted.resolvePlaywrightAction.mock.calls.length).toBeGreaterThan(1);
  });
});
