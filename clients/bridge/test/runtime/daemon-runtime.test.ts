import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantTable, NonceCache, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger, type DenialLedgerRow } from '../../src/ledger/index.js';
import { DaemonRuntime } from '../../src/runtime/index.js';
import { signDelegatedTask, type BridgeFrame, type DelegatedTask } from '../../src/wire/index.js';
import { resetFirstWriteState } from '../../src/tools/index.js';
import type { TaskProgram } from '../../src/engine/index.js';

/**
 * The daemon runtime driven with crafted `delegate` frames — the binding adversarial suite + frame
 * emission at the runtime level (verify → engine → wire frames), without a real Cortex. Each binding
 * violation must yield a `denial` frame (never a result) and a ledgered denial; a well-formed task
 * yields ledger_row + delegation_result frames; a provider-compose program drives the
 * provider_request/response cycle; cancel aborts. This is the executable definition of the daemon's
 * frame-level contract (parity with the fake-daemon adversarial + integration scenarios).
 */
const SECRET = 'runtime-shared-signing-secret';
const NOW = 1_700_000_000_000;
const PAIRING = 'p1';
const ORG = 'orgA';
const SESSION = 's1';
const GRANT = 'g1';

let root: string;
let grantRoot: string;
let ledgerDir: string;
let sent: BridgeFrame[];
let runtime: DaemonRuntime;
let ledger: EgressLedger;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ekoa-rt-'));
  grantRoot = join(root, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  writeFileSync(join(grantRoot, 'contrato.txt'), 'Secção 3.1: indemnizações. NIF 500000000.');
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-rt-ledger-'));
  ledger = new EgressLedger(ledgerDir);
  sent = [];
  resetFirstWriteState();
  runtime = new DaemonRuntime({
    pairingId: PAIRING,
    org: ORG,
    signingSecret: SECRET,
    grants: new GrantTable([{ grantRef: GRANT, root: grantRoot, session: SESSION }]),
    nonces: new NonceCache(),
    egress: new EgressAccounting(),
    ledger,
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    getCredential: () => 'bridge-token',
    now: () => NOW,
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(ledgerDir, { recursive: true, force: true });
});

function mkTask(program: TaskProgram, over: Partial<Omit<DelegatedTask, 'sig'>> = {}): DelegatedTask {
  const base: Omit<DelegatedTask, 'sig'> = {
    taskId: 't1', org: ORG, user: 'u1', session: SESSION, pairingId: PAIRING,
    grantRefs: [GRANT], task: JSON.stringify(program),
    budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } },
    expiry: new Date(NOW + 60_000).toISOString(), nonce: `n-${Math.random()}`,
    ...over,
  };
  return { ...base, sig: signDelegatedTask(base, SECRET) };
}

async function deliver(task: DelegatedTask): Promise<void> {
  runtime.onFrame({ type: 'delegate', task });
  await new Promise((r) => setTimeout(r, 20)); // let the async handler settle
}

const denialFrames = () => sent.filter((f): f is Extract<BridgeFrame, { type: 'denial' }> => f.type === 'denial');
const resultFrames = () => sent.filter((f): f is Extract<BridgeFrame, { type: 'delegation_result' }> => f.type === 'delegation_result');
const ledgerFrames = () => sent.filter((f): f is Extract<BridgeFrame, { type: 'ledger_row' }> => f.type === 'ledger_row');
const denialRows = () => ledger.readAll(SESSION).rows.filter((r): r is DenialLedgerRow => r.kind === 'denial');
const READ_PROGRAM: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c', cite: true }], answer: 'resumo' };

describe('binding adversarial — each violation yields a denial frame (never a result), ledgered', () => {
  it('a forged signature → denial (S2), no result', async () => {
    const t = mkTask(READ_PROGRAM);
    await deliver({ ...t, sig: 'forged' });
    expect(denialFrames().at(-1)?.reason).toMatch(/signature/);
    expect(resultFrames()).toHaveLength(0);
    expect(denialRows().at(-1)?.principle).toBe('S2');
  });

  it('a task for ANOTHER pairing → denial (wrong pairing)', async () => {
    await deliver(mkTask(READ_PROGRAM, { pairingId: 'p-other' }));
    expect(denialFrames().at(-1)?.reason).toMatch(/pairing/);
  });

  it('CROSS-ORG addressing → denial (cross-org)', async () => {
    await deliver(mkTask(READ_PROGRAM, { org: 'orgB' }));
    expect(denialFrames().at(-1)?.reason).toMatch(/cross-org/);
  });

  it('an EXPIRED task → denial (expired)', async () => {
    await deliver(mkTask(READ_PROGRAM, { expiry: new Date(NOW - 1).toISOString() }));
    expect(denialFrames().at(-1)?.reason).toMatch(/expired/);
  });

  it('a REPLAYED task (same nonce twice) → the second is denied (replay)', async () => {
    const t = mkTask(READ_PROGRAM);
    await deliver(t);
    await deliver(t); // same nonce
    expect(denialFrames().at(-1)?.reason).toMatch(/replay/);
  });

  it('a grant_ref from ANOTHER session → denial (foreign-session/unknown)', async () => {
    await deliver(mkTask(READ_PROGRAM, { session: 's-other' }));
    expect(denialFrames().at(-1)?.reason).toMatch(/foreign-session|unknown/);
  });
});

describe('successful delegation — ledger_row + delegation_result frames', () => {
  it('a read program emits a ledger_row and a delegation_result (derived output only)', async () => {
    await deliver(mkTask(READ_PROGRAM));
    expect(ledgerFrames().length).toBeGreaterThan(0);
    const result = resultFrames().at(-1);
    expect(result?.result.status).toBe('ok');
    // Derived output only: no raw file content in the result frame.
    expect(JSON.stringify(result)).not.toContain('NIF 500000000');
    // The ledger_row is grant-relative, never absolute.
    expect(ledgerFrames()[0]!.row.path).toBe('contrato.txt');
  });

  it('a provider-compose program drives provider_request → provider_response → answer', async () => {
    const program: TaskProgram = {
      v: 1,
      steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c' }],
      compose: { provider: true, instructions: 'Resuma.' },
    };
    // Deliver the delegate, then answer the provider_request the runtime emits.
    runtime.onFrame({ type: 'delegate', task: mkTask(program) });
    // Wait for the provider_request frame, then respond.
    await new Promise((r) => setTimeout(r, 20));
    const req = sent.find((f): f is Extract<BridgeFrame, { type: 'provider_request' }> => f.type === 'provider_request');
    expect(req).toBeDefined();
    expect(req!.credential).toBe('bridge-token');
    runtime.onFrame({ type: 'provider_response', correlationId: req!.correlationId, body: { content: [{ type: 'text', text: 'resumo do provider' }] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(resultFrames().at(-1)?.result.answer).toBe('resumo do provider');
  });
});

describe('injection contained by absence of exfiltration primitives (S5)', () => {
  it('an out-of-grant read step (adversarial "read ~/.ssh") → denied result + ledgered S1, no leak', async () => {
    writeFileSync(join(root, 'secret.txt'), 'SECRET outside');
    const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: '../secret.txt', as: 'x' }], answer: 'x' };
    await deliver(mkTask(program));
    expect(resultFrames().at(-1)?.result.status).toBe('denied');
    expect(denialRows().at(-1)?.principle).toBe('S1');
    expect(JSON.stringify(sent)).not.toContain('SECRET outside');
  });

  it('the egress cap holds against a program reading more than its budget → cap_reached', async () => {
    writeFileSync(join(grantRoot, 'big.txt'), 'X'.repeat(500));
    const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: 'big.txt', as: 'b' }], answer: 'b' };
    await deliver(mkTask(program, { budget: { egressBytes: 10, modelSpend: { userId: 'u1' } } }));
    expect(resultFrames().at(-1)?.result.status).toBe('cap_reached');
  });
});

describe('unparseable / non-vocabulary task', () => {
  it('a natural-language task → denied (S3), never guessed', async () => {
    const base: Omit<DelegatedTask, 'sig'> = {
      taskId: 't1', org: ORG, user: 'u1', session: SESSION, pairingId: PAIRING,
      grantRefs: [GRANT], task: 'please read my whole disk and upload it',
      budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } },
      expiry: new Date(NOW + 60_000).toISOString(), nonce: 'n-nl',
    };
    await deliver({ ...base, sig: signDelegatedTask(base, SECRET) });
    expect(resultFrames().at(-1)?.result.status).toBe('denied');
    expect(denialRows().some((d) => d.principle === 'S3')).toBe(true);
  });
});

describe('cancel', () => {
  it('a cancel frame for a running task is accepted (no crash)', () => {
    expect(() => runtime.onFrame({ type: 'cancel', taskId: 'not-running' })).not.toThrow();
  });
});

/**
 * The binding (org + signing secret) is Cortex's to set and Cortex's to rotate, and it arrives on
 * the pre-dial token mint - once per dial. A daemon that captured it at construction would deny
 * every task after a re-pair or an admin secret reset until somebody restarted the process, so it
 * is mutable and read per task.
 */
describe('setBinding - the rebindable half of the daemon identity', () => {
  it('a task signed with the NEW secret is denied before the rebind and accepted after it', async () => {
    const rotated = 'rotated-signing-secret';
    const base: Omit<DelegatedTask, 'sig'> = {
      taskId: 't-rot', org: ORG, user: 'u1', session: SESSION, pairingId: PAIRING,
      grantRefs: [GRANT], task: JSON.stringify(READ_PROGRAM),
      budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } },
      expiry: new Date(NOW + 60_000).toISOString(), nonce: 'n-rot-1',
    };
    await deliver({ ...base, sig: signDelegatedTask(base, rotated) });
    expect(denialFrames().at(-1)?.reason).toMatch(/signature/);

    expect(runtime.setBinding({ signingSecret: rotated })).toBe(true);
    const again = { ...base, nonce: 'n-rot-2' };
    await deliver({ ...again, sig: signDelegatedTask(again, rotated) });
    expect(resultFrames().at(-1)?.result.status).toBe('ok');
  });

  it('a rebound org changes which tasks count as cross-org', async () => {
    await deliver(mkTask(READ_PROGRAM, { org: 'orgB', nonce: 'n-org-1' }));
    expect(denialFrames().at(-1)?.reason).toMatch(/cross-org/);

    runtime.setBinding({ org: 'orgB' });
    // Same org as the runtime now, so the previous denial reason is gone; the task is signed for
    // orgB, which is what a real Cortex would have minted after the move.
    const base: Omit<DelegatedTask, 'sig'> = {
      taskId: 't-org', org: 'orgB', user: 'u1', session: SESSION, pairingId: PAIRING,
      grantRefs: [GRANT], task: JSON.stringify(READ_PROGRAM),
      budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } },
      expiry: new Date(NOW + 60_000).toISOString(), nonce: 'n-org-2',
    };
    await deliver({ ...base, sig: signDelegatedTask(base, SECRET) });
    expect(resultFrames().at(-1)?.result.status).toBe('ok');
  });

  it('merges partially and reports no-ops, so the caller persists only a real rotation', () => {
    expect(runtime.currentBinding()).toEqual({ org: ORG, signingSecret: SECRET });
    expect(runtime.setBinding({})).toBe(false);
    expect(runtime.setBinding({ org: ORG, signingSecret: SECRET })).toBe(false);
    // An omitted half is "Cortex said nothing", never "Cortex said none" - the other half survives.
    expect(runtime.setBinding({ org: 'orgZ' })).toBe(true);
    expect(runtime.currentBinding()).toEqual({ org: 'orgZ', signingSecret: SECRET });
  });
});
