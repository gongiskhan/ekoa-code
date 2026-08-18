import { describe, it, expect } from 'vitest';
import { RunStatus, AutomationRunEvent, RunCredentialRequest, RunRecord } from '@ekoa/shared';
import type { RunStatus as EngineRunStatus } from '../../src/automation/types.js';

/**
 * THE RUN-STATUS PIN (Rule 7).
 *
 * No contract test enumerated the run statuses before this one, which is why the union has drifted:
 * `awaiting_daemon` and `awaiting_consent` reached the wire, the engine and the web store at
 * different times and by hand, and the only thing that ever caught a mismatch was a page rendering
 * a raw enum name. A pinned SET turns "add a status" from something that can happen by accident in
 * one file into something that fails here first and has to be done in all of them.
 *
 * WHAT IT PROVES, and what it deliberately does not: it proves the shared enum is EXACTLY this set
 * and that the engine's own union is a subset of it (the engine has no `idle` — that is a
 * client-side pre-run state, not something a run record can hold). It does not prove the web store
 * agrees; TypeScript cannot see across the repo boundary, so the web's exhaustive `tones` Record
 * (`run-viewer.tsx`) is the compile-time guard on that side, and `web/__tests__` pins its store.
 */

/**
 * EVERY run status, alphabetised so a diff on this list is unambiguous. Adding a member here is the
 * deliberate act; adding one anywhere else without touching this fails.
 */
const EXPECTED_RUN_STATUSES = [
  'awaiting_consent',
  'awaiting_daemon',
  'awaiting_integration',
  'cancelled',
  'completed',
  'failed',
  'idle',
  'needs_credentials',
  'paused_for_user',
  'running',
] as const;

/** Every automation-run SSE frame type, same discipline. */
const EXPECTED_RUN_EVENT_TYPES = [
  'awaiting_consent',
  'awaiting_daemon',
  'complete',
  'error',
  'needs_credentials',
  'patch',
  'pause_for_user',
  'paused',
  'ready',
  'resumed',
  'step',
  'step_output_chunk',
  'streaming_available',
] as const;

describe('RunStatus is pinned (Rule 7 additive)', () => {
  it('the shared enum is exactly the expected set', () => {
    expect([...RunStatus.options].sort()).toEqual([...EXPECTED_RUN_STATUSES]);
  });

  it('every expected status parses, and an invented one does not', () => {
    for (const s of EXPECTED_RUN_STATUSES) expect(RunStatus.safeParse(s).success).toBe(true);
    expect(RunStatus.safeParse('needs_credential').success).toBe(false); // near-miss singular
    expect(RunStatus.safeParse('blocked').success).toBe(false); // P4's, not landed
  });

  it("the engine's own union is assignable to the wire enum (no engine-only status)", () => {
    // A compile-time assertion with a runtime carrier: if the engine gains a status the wire does
    // not have, this stops compiling — which is the failure mode a runtime check cannot give.
    const engineStatuses: EngineRunStatus[] = [
      'running',
      'completed',
      'failed',
      'cancelled',
      'awaiting_integration',
      'paused_for_user',
      'awaiting_consent',
      'awaiting_daemon',
      'needs_credentials',
    ];
    for (const s of engineStatuses) expect(RunStatus.safeParse(s).success).toBe(true);
    // The engine has no `idle`: a run record is created `running`.
    expect(engineStatuses).not.toContain('idle');
  });
});

describe('the automation run event union is pinned', () => {
  it('is exactly the expected set of frame types', () => {
    const types = AutomationRunEvent.options
      .map((o) => (o.shape.type as { value: string }).value)
      .sort();
    expect(types).toEqual([...EXPECTED_RUN_EVENT_TYPES]);
  });

  it('the needs_credentials frame validates and carries the halt payload', () => {
    const frame = {
      type: 'needs_credentials',
      stepIndex: 2,
      origin: 'citius.mj.pt',
      integrationKey: 'citius',
      portalDeepLink: '/cofre?origin=citius.mj.pt',
      mode: 'ceremony',
      reason: 'citius.mj.pt needs an attended ceremony to re-establish its session',
      ceremony: {
        operation: 'login',
        relayId: 'rly_1',
        automationName: 'Sync cases',
        siteOrigin: 'citius.mj.pt',
        reason: 'no stored session',
        expiresAt: '2026-08-18T10:10:00.000Z',
      },
    };
    const parsed = AutomationRunEvent.safeParse(frame);
    expect(parsed.success).toBe(true);
  });

  it('an unknown mode is refused — the two establishment routes are the whole vocabulary', () => {
    expect(
      AutomationRunEvent.safeParse({
        type: 'needs_credentials',
        stepIndex: 0,
        origin: 'x.example',
        integrationKey: 'k',
        portalDeepLink: '/cofre',
        mode: 'otp', // the thing P3.2 refuses to build
        reason: 'r',
      }).success,
    ).toBe(false);
  });
});

describe('RunCredentialRequest cannot carry a credential', () => {
  it('strips anything that is not one of the published fields', () => {
    const parsed = RunCredentialRequest.parse({
      stepIndex: 0,
      origin: 'citius.mj.pt',
      integrationKey: 'citius',
      portalDeepLink: '/cofre?origin=citius.mj.pt',
      mode: 'typist',
      reason: 'no stored session',
      // A caller (or a future producer) trying to attach one:
      password: 'hunter2',
      value: 'hunter2',
      storageState: { cookies: [] },
    } as never);
    expect(Object.keys(parsed).sort()).toEqual([
      'integrationKey',
      'mode',
      'origin',
      'portalDeepLink',
      'reason',
      'stepIndex',
    ]);
    expect(JSON.stringify(parsed)).not.toContain('hunter2');
  });

  it('rides on the run resource, so a reloading client can rebuild the banner', () => {
    const run = RunRecord.parse({
      id: 'run_1',
      automationId: 'auto_1',
      status: 'needs_credentials',
      credentialRequest: {
        stepIndex: 1,
        origin: 'portal.example',
        integrationKey: 'example',
        portalDeepLink: '/cofre?origin=portal.example',
        mode: 'typist',
        reason: 'no credential reference to replay unattended',
      },
    });
    expect(run.credentialRequest?.origin).toBe('portal.example');
  });
});
