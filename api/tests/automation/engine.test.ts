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
  };
});

vi.mock('../../src/automation/persistence.js', () => ({
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
}));

// Fake daemon-backed BrowserSession. act/assert are hoisted mocks the
// tests drive. The observation accessors return stable values so the
// cache/fingerprint/vision path runs unchanged.
vi.mock('../../src/automation/browser-session.js', () => ({
  DaemonBrowserSession: class {
    private observed = true;
    constructor(_opts: unknown) {}
    act(action: unknown) { return hoisted.act(action); }
    assert(assertion: unknown) { return hoisted.assert(assertion); }
    async observe() { this.observed = true; }
    async ensureObserved() { this.observed = true; }
    hasObservation() { return this.observed; }
    screenshotPng() { return Buffer.from('png'); }
    screenshotB64() { return Buffer.from('png').toString('base64'); }
    url() { return 'https://x.com/'; }
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
    constructor(opts: unknown) { hoisted.localSessionOpts.push(opts); }
    act(action: unknown) { return hoisted.act(action); }
    assert(assertion: unknown) { return hoisted.assert(assertion); }
    async observe() { this.observed = true; }
    async ensureObserved() { this.observed = true; }
    hasObservation() { return this.observed; }
    screenshotPng() { return Buffer.from('png'); }
    screenshotB64() { return Buffer.from('png').toString('base64'); }
    url() { return 'https://x.com/'; }
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
    // Cached action fails, then a fresh resolution succeeds.
    hoisted.act
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
    expect(run.steps[0].error.message).toMatch(/outcome not met/);
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

  it('threads inputs.credentials.storageState into the LocalBrowserSession when no daemon is connected', async () => {
    // Daemon-less path: no daemon connection resolves for this run, so the
    // engine falls back to the in-process LocalBrowserSession (the
    // automation config's local-browser fallback is ON in tests).
    setDaemonConnectionResolver(() => null);

    hoisted.automations.set('auto-1', automation([{
      id: 's1', description: 'go to portal', type: 'navigate', url: 'https://portal.example.pt/',
    }]));

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
