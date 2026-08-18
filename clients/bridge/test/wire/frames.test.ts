import { describe, it, expect } from 'vitest';
import { BridgeFrame, signDelegatedTask } from '../../src/wire/index.js';

const SECRET = 'unit-secret-not-a-real-jwt-000';

// Return a shallow copy of `obj` with `key` removed (used to build tasks that are missing a
// required field). Copy-and-delete keeps the eslint no-unused-vars rule happy vs a rest-destructure.
function omit(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

// A valid, signed DelegatedTask for the frames that carry one.
function validTask() {
  const t = {
    taskId: 'task-0001',
    org: 'org-alpha',
    user: 'user-777',
    session: 'sess-abc',
    pairingId: 'pair-xyz',
    grantRefs: ['grant-a'],
    task: 'summarise the readme',
    budget: { egressBytes: 4096, modelSpend: { userId: 'user-777' } },
    expiry: '2026-07-10T12:00:00.000Z',
    nonce: 'n-0f9a2c',
  };
  return { ...t, sig: signDelegatedTask(t, SECRET) };
}

function validLedgerRow() {
  return {
    ts: '2026-07-10T12:00:01.000Z',
    session: 'sess-abc',
    correlationId: 'corr-1',
    path: '/repo/readme.md',
    byteRange: '0-4096',
    bytesOut: 4096,
    sha256: 'a'.repeat(64),
    tool: 'read_file',
  };
}

function validResult() {
  return {
    status: 'ok' as const,
    answer: 'done',
    citations: [{ path: '/repo/readme.md', range: '0-4096' }],
    patches: [{ path: '/repo/readme.md', diff: '@@ -1 +1 @@' }],
    ledgerRefs: ['corr-1'],
    telemetry: { egressBytes: 4096, maskedCounts: { nif: 0 } },
  };
}

describe('BridgeFrame.safeParse — the nine delegation frame types', () => {
  const validFrames: Array<[string, unknown]> = [
    ['delegate', { type: 'delegate', task: validTask() }],
    ['provider_response', { type: 'provider_response', correlationId: 'corr-1', body: { any: 'json' } }],
    ['cancel', { type: 'cancel', taskId: 'task-0001' }],
    ['provider_request', { type: 'provider_request', correlationId: 'corr-1', session: 'sess-abc', credential: 'bridge-token', body: {} }],
    ['ledger_row', { type: 'ledger_row', taskId: 'task-0001', row: validLedgerRow() }],
    ['delegation_result', { type: 'delegation_result', taskId: 'task-0001', result: validResult() }],
    ['denial', { type: 'denial', taskId: 'task-0001', reason: 'outside_grant', principle: 'containment' }],
    ['denial-without-taskId', { type: 'denial', reason: 'outside_grant', principle: 'containment' }], // taskId optional
    ['ping', { type: 'ping' }],
    ['pong', { type: 'pong' }],
  ];

  for (const [label, frame] of validFrames) {
    it(`accepts a valid ${label} frame`, () => {
      const parsed = BridgeFrame.safeParse(frame);
      expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    });
  }

  it('accepts every one of the nine discriminated types', () => {
    const types = new Set(
      validFrames
        .map(([, f]) => BridgeFrame.safeParse(f))
        .filter((r) => r.success)
        .map((r) => (r.data as { type: string }).type),
    );
    expect([...types].sort()).toEqual(
      ['cancel', 'delegate', 'delegation_result', 'denial', 'ledger_row', 'ping', 'pong', 'provider_request', 'provider_response'],
    );
  });
});

describe('BridgeFrame.safeParse — rejections', () => {
  const rejected: Array<[string, unknown]> = [
    ['unknown discriminator', { type: 'not_a_frame', foo: 1 }],
    ['missing discriminator', { correlationId: 'corr-1', body: {} }],
    ['null', null],
    ['non-object', 'delegate'],
    ['delegate with malformed task: egressBytes Infinity', { type: 'delegate', task: { ...validTask(), budget: { egressBytes: Number.POSITIVE_INFINITY, modelSpend: { userId: 'u' } } } }],
    ['delegate with malformed task: negative egressBytes', { type: 'delegate', task: { ...validTask(), budget: { egressBytes: -1, modelSpend: { userId: 'u' } } } }],
    ['delegate with malformed task: missing nonce', { type: 'delegate', task: omit(validTask(), 'nonce') }],
    ['delegate with malformed task: missing sig', { type: 'delegate', task: omit(validTask(), 'sig') }],
    ['ledger_row with missing row fields', { type: 'ledger_row', taskId: 'task-0001', row: { ts: '2026-07-10T12:00:01.000Z' } }],
    ['ledger_row with wrong-typed field', { type: 'ledger_row', taskId: 'task-0001', row: { ...validLedgerRow(), bytesOut: 'lots' } }],
    ['provider_request missing credential', { type: 'provider_request', correlationId: 'corr-1', session: 'sess-abc', body: {} }],
    ['delegation_result with bad status enum', { type: 'delegation_result', taskId: 'task-0001', result: { ...validResult(), status: 'maybe' } }],
  ];

  for (const [label, frame] of rejected) {
    it(`rejects: ${label}`, () => {
      expect(BridgeFrame.safeParse(frame).success).toBe(false);
    });
  }
});
