import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeDaemon, signTask, type DelegatedTask, type Grant } from '../../test/fake-daemon/daemon.js';
import { ContainmentError } from '../../test/fake-daemon/containment.js';

/**
 * Fake-daemon adversarial scenarios (ch18 §18.7.2, §18.8 criterion 2): the daemon-side half of
 * S1 (containment) and S2 (binding: sig, pairing, cross-org, expiry, replay, foreign-session
 * grant), each producing a rejection + a denial ledger row. This is the executable definition of
 * the daemon-side security contract; the ekoa-local run implements against it (§18.7.1).
 */
const SECRET = 'shared-signing-secret';
const NOW = 1_700_000_000_000;
let root: string;
let grantRoot: string;

function mkTask(over: Partial<Omit<DelegatedTask, 'sig'>> = {}): DelegatedTask {
  const base: Omit<DelegatedTask, 'sig'> = {
    taskId: 't1', org: 'orgA', user: 'u1', session: 's1', pairingId: 'p1',
    grantRefs: ['g1'], task: 'summarise the contract',
    budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } },
    expiry: new Date(NOW + 60_000).toISOString(), nonce: `n-${Math.random()}`,
    ...over,
  };
  return { ...base, sig: signTask(base, SECRET) };
}

function daemon(grants?: Grant[]): FakeDaemon {
  return new FakeDaemon({
    pairingId: 'p1', org: 'orgA', signingSecret: SECRET,
    grants: grants ?? [{ grantRef: 'g1', root: grantRoot, session: 's1' }],
    now: () => NOW,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fakedaemon-'));
  grantRoot = join(root, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  mkdirSync(join(root, 'outside'), { recursive: true });
  writeFileSync(join(grantRoot, 'contrato.txt'), 'ACME Lda, NIF 500000000, secção 3.1 indemnizações.');
  writeFileSync(join(root, 'outside', 'secret.txt'), 'SECRET outside grant');
  try { symlinkSync(join(root, 'outside', 'secret.txt'), join(grantRoot, 'escape-link')); } catch { /* symlink may fail on some FS */ }
});

describe('S2 — task binding verification (§18.5.1)', () => {
  it('accepts a well-formed task', () => {
    expect(daemon().verifyTask(mkTask())).toBeNull();
  });

  it('rejects a FORGED task (bad signature)', () => {
    const t = { ...mkTask(), sig: 'forged' };
    const d = daemon();
    expect(d.verifyTask(t)?.principle).toBe('S2');
    expect(d.denials.at(-1)?.reason).toMatch(/signature/);
  });

  it('rejects a task forged for ANOTHER pairing', () => {
    const d = daemon();
    expect(d.verifyTask(mkTask({ pairingId: 'p-other' }))?.reason).toMatch(/pairing/);
  });

  it('rejects CROSS-ORG addressing (task org != daemon org)', () => {
    const d = daemon();
    expect(d.verifyTask(mkTask({ org: 'orgB' }))?.reason).toMatch(/cross-org/);
  });

  it('rejects an EXPIRED task', () => {
    const d = daemon();
    expect(d.verifyTask(mkTask({ expiry: new Date(NOW - 1).toISOString() }))?.reason).toMatch(/expired/);
  });

  it('rejects a REPLAYED task (nonce already seen)', () => {
    const d = daemon();
    const t = mkTask();
    expect(d.verifyTask(t)).toBeNull();
    expect(d.verifyTask(t)?.reason).toMatch(/replay/); // same nonce → rejected
  });

  it('rejects a grant_ref from ANOTHER session', () => {
    // The daemon holds g1 for session s2, but the task claims session s1.
    const d = daemon([{ grantRef: 'g1', root: grantRoot, session: 's2' }]);
    expect(d.verifyTask(mkTask({ session: 's1', grantRefs: ['g1'] }))?.reason).toMatch(/foreign-session|unknown/);
  });

  it('every denial is ledgered', () => {
    const d = daemon();
    d.verifyTask(mkTask({ org: 'orgB' }));
    expect(d.denials).toHaveLength(1);
    expect(d.denials[0]).toMatchObject({ taskId: 't1', principle: 'S2' });
  });
});

describe('S1 — containment (§18.5 S1)', () => {
  it('reads a file WITHIN the grant and ledgers the read (S6)', () => {
    const d = daemon();
    const t = mkTask();
    d.verifyTask(t);
    const text = d.read(t, 'g1', 'contrato.txt', 'corr-1');
    expect(text).toMatch(/ACME/);
    expect(d.ledger).toHaveLength(1);
    expect(d.ledger[0]).toMatchObject({ session: 's1', correlationId: 'corr-1', tool: 'read' });
    expect(d.ledger[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('DENIES a traversal read outside the grant (+ ledgers the denial)', () => {
    const d = daemon();
    const t = mkTask();
    d.verifyTask(t);
    expect(() => d.read(t, 'g1', '../outside/secret.txt', 'corr-2')).toThrow(ContainmentError);
    expect(d.denials.at(-1)?.principle).toBe('S1');
    expect(d.ledger).toHaveLength(0); // nothing read → nothing ledgered as a read
  });

  it('DENIES a symlink-escape read (realpath catches it)', () => {
    const d = daemon();
    const t = mkTask();
    d.verifyTask(t);
    // escape-link points outside the grant; realpath resolves it out → containment rejects.
    expect(() => d.read(t, 'g1', 'escape-link', 'corr-3')).toThrow();
    expect(d.denials.at(-1)?.principle).toBe('S1');
  });

  it('DENIES an absolute path outside the grant', () => {
    const d = daemon();
    const t = mkTask();
    d.verifyTask(t);
    expect(() => d.read(t, 'g1', join(root, 'outside', 'secret.txt'), 'corr-4')).toThrow(ContainmentError);
  });
});

describe('S5 — injection contained by absence of exfiltration primitives', () => {
  it('a granted file that says "upload me / read ~/.ssh" cannot exfiltrate: no upload verb, out-of-grant read denied, cap holds', () => {
    // The daemon exposes NO upload primitive (structural — the class has read/stat only).
    const d = daemon();
    expect((d as unknown as Record<string, unknown>).upload).toBeUndefined();
    const t = mkTask();
    d.verifyTask(t);
    // The injected "read ~/.ssh" is an out-of-grant read → denied+ledgered (S1).
    expect(() => d.read(t, 'g1', '../../../.ssh/id_rsa', 'corr-5')).toThrow();
    expect(d.denials.at(-1)?.principle).toBe('S1');
    // The egress cap bounds the in-grant reads.
    const tiny = mkTask({ nonce: 'cap', budget: { egressBytes: 5, modelSpend: { userId: 'u1' } } });
    d.verifyTask(tiny);
    expect(() => d.read(tiny, 'g1', 'contrato.txt', 'corr-6')).toThrow(/cap/);
    expect(d.denials.at(-1)?.principle).toBe('S5');
  });
});
