import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  signDelegatedTask,
  verifyDelegatedTaskSig,
  canonicalTaskBinding,
} from '../../src/wire/index.js';

// A synthetic, well-formed task binding. No plausible-real identifiers (harness convention):
// org/user/session are opaque tokens, nonce is random-looking, nothing checksum-bearing.
const SECRET = 'unit-secret-not-a-real-jwt-000';
function baseTask() {
  return {
    taskId: 'task-0001',
    org: 'org-alpha',
    user: 'user-777',
    session: 'sess-abc',
    pairingId: 'pair-xyz',
    grantRefs: ['grant-a', 'grant-b'],
    task: 'summarise the readme',
    budget: { egressBytes: 4096, modelSpend: { userId: 'user-777' } },
    expiry: '2026-07-10T12:00:00.000Z',
    nonce: 'n-0f9a2c',
  };
}

describe('signDelegatedTask / verifyDelegatedTaskSig', () => {
  it('round-trips: a task signed with the secret verifies with the same secret', () => {
    const task = baseTask();
    const sig = signDelegatedTask(task, SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex
    expect(verifyDelegatedTaskSig({ ...task, sig }, SECRET)).toBe(true);
  });

  it('fails verification under a different secret', () => {
    const task = baseTask();
    const sig = signDelegatedTask(task, SECRET);
    expect(verifyDelegatedTaskSig({ ...task, sig }, 'a-different-secret')).toBe(false);
  });

  it('tampering ANY of the eight signed binding fields breaks verification', () => {
    const task = baseTask();
    const sig = signDelegatedTask(task, SECRET);
    // The eight S2 fields the signature binds (§18.2.6). taskId is also signed and covered below.
    const tampers: Array<[string, Record<string, unknown>]> = [
      ['org', { org: 'org-evil' }],
      ['user', { user: 'user-000' }],
      ['session', { session: 'sess-evil' }],
      ['pairingId', { pairingId: 'pair-evil' }],
      ['grantRefs', { grantRefs: ['grant-a', 'grant-b', 'grant-smuggled'] }],
      ['budget', { budget: { egressBytes: 1_000_000, modelSpend: { userId: 'user-777' } } }],
      ['expiry', { expiry: '2099-01-01T00:00:00.000Z' }],
      ['nonce', { nonce: 'n-replayed' }],
    ];
    for (const [label, override] of tampers) {
      const tampered = { ...task, ...override, sig };
      expect(verifyDelegatedTaskSig(tampered, SECRET), `tamper: ${label}`).toBe(false);
    }
    // taskId (the server-minted id) is inside the binding too, so tampering it also fails.
    expect(verifyDelegatedTaskSig({ ...task, taskId: 'task-swapped', sig }, SECRET)).toBe(false);
  });

  it('rejects forged / truncated / odd-length / non-hex sigs and NEVER throws', () => {
    const task = baseTask();
    const good = signDelegatedTask(task, SECRET);
    // Each of these decodes (via Buffer.from(hex)) to a buffer that is either a different value or
    // a different length than the real 32-byte HMAC, so constant-time compare returns false.
    const forged = `f${good.slice(1)}`; // valid 64-char hex, first nibble flipped -> wrong value
    const cases: Array<[string, string]> = [
      ['empty', ''],
      ['all-non-hex', 'z'.repeat(64)], // no hex nibbles decode -> 0-length buffer
      ['embedded-non-hex', `${good.slice(0, 60)}zzzz`], // stops decoding at 'z' -> short buffer
      ['truncated-one-byte', good.slice(0, -2)], // 62 chars -> 31 bytes, length mismatch
      ['truncated-half', good.slice(0, 32)], // 16 bytes, length mismatch
      ['odd-length', good.slice(0, -1)], // 63 chars -> 31 bytes decoded, length mismatch
      ['extra-full-byte', `${good}ab`], // 33 bytes, length mismatch
      ['forged-same-length', forged],
    ];
    for (const [label, sig] of cases) {
      let result: boolean | undefined;
      expect(() => {
        result = verifyDelegatedTaskSig({ ...task, sig }, SECRET);
      }, `no throw: ${label}`).not.toThrow();
      expect(result, `false: ${label}`).toBe(false);
    }
  });

  it('characterises the Buffer.from(hex) nibble-drop: sig + one nibble still verifies (matches upstream bytes)', () => {
    // Buffer.from(good + 'a', 'hex') drops the incomplete trailing nibble, reconstructing the SAME
    // 32 bytes as `good`. This is not a forgery gap — the signature bytes are identical — and it is
    // exactly the Cortex signer's behaviour (api/src/bridge/signing.ts). Pinned here so a future
    // "fix" that diverges from those bytes is caught by this suite rather than silently breaking
    // wire parity.
    const task = baseTask();
    const good = signDelegatedTask(task, SECRET);
    expect(verifyDelegatedTaskSig({ ...task, sig: `${good}a` }, SECRET)).toBe(true);
  });

  it('canonicalTaskBinding throws on a non-finite egressBytes (ambiguous canonical bytes)', () => {
    const task = baseTask();
    const poisoned = { ...task, budget: { egressBytes: Infinity, modelSpend: { userId: 'user-777' } } };
    expect(() => canonicalTaskBinding(poisoned)).toThrow(/non-finite/);
    // Same for NaN and -Infinity.
    expect(() => canonicalTaskBinding({ ...task, budget: { egressBytes: NaN, modelSpend: { userId: 'u' } } })).toThrow(/non-finite/);
    expect(() => canonicalTaskBinding({ ...task, budget: { egressBytes: -Infinity, modelSpend: { userId: 'u' } } })).toThrow(/non-finite/);
  });

  it('is independent of key insertion order (same fields, different order -> identical bytes + sig)', () => {
    const a = baseTask();
    // Same logical task, every object literal built with keys in a different insertion order,
    // including the nested budget/modelSpend objects.
    const b = {
      nonce: 'n-0f9a2c',
      expiry: '2026-07-10T12:00:00.000Z',
      budget: { modelSpend: { userId: 'user-777' }, egressBytes: 4096 },
      task: 'summarise the readme',
      grantRefs: ['grant-a', 'grant-b'],
      pairingId: 'pair-xyz',
      session: 'sess-abc',
      user: 'user-777',
      org: 'org-alpha',
      taskId: 'task-0001',
    };
    expect(canonicalTaskBinding(b)).toBe(canonicalTaskBinding(a));
    expect(signDelegatedTask(b, SECRET)).toBe(signDelegatedTask(a, SECRET));
    // And a sig computed from one order verifies a task expressed in the other order.
    const sig = signDelegatedTask(a, SECRET);
    expect(verifyDelegatedTaskSig({ ...b, sig }, SECRET)).toBe(true);
  });

  it('verifyDelegatedTaskSig NEVER throws on a schema-valid task with a non-finite passthrough value (DoS guard)', () => {
    // BridgeFrame.safeParse admits arbitrary passthrough keys, so a peer can send a delegate task
    // carrying a non-finite number (1e999 -> Infinity over JSON) that canonicalTaskBinding refuses.
    // The daemon calls verify as its first S2 check; it must return false, never throw — else a
    // single crafted frame crashes the process. (S1 review finding: sign was called outside try.)
    const task = baseTask();
    const poisoned = {
      ...task,
      budget: { egressBytes: 4096, modelSpend: { userId: 'u', smuggled: Infinity } },
      sig: 'a'.repeat(64),
    };
    let result: boolean | undefined;
    expect(() => {
      result = verifyDelegatedTaskSig(poisoned as unknown as ReturnType<typeof baseTask> & { sig: string }, SECRET);
    }).not.toThrow();
    expect(result).toBe(false);
    // NaN and -Infinity smuggled the same way are also rejected without throwing.
    for (const bad of [NaN, -Infinity]) {
      const t = { ...task, budget: { egressBytes: 4096, modelSpend: { userId: 'u', smuggled: bad } }, sig: 'b'.repeat(64) };
      expect(() => verifyDelegatedTaskSig(t as never, SECRET)).not.toThrow();
      expect(verifyDelegatedTaskSig(t as never, SECRET)).toBe(false);
    }
  });

  it('refuses an EMPTY signing secret: sign throws, verify fails closed (no silent forgeable key)', () => {
    // createHmac('sha256', '') succeeds in Node, so an empty secret would silently sign+verify any
    // forged task. sign must fail loud on misconfiguration; verify must fail closed, never accept.
    const task = baseTask();
    expect(() => signDelegatedTask(task, '')).toThrow(/empty signing secret/i);
    // An attacker signs with the empty key and presents it: verify(empty) must be false, not true.
    const forgedWithEmptyKey = createHmac('sha256', '').update(canonicalTaskBinding(task)).digest('hex');
    expect(verifyDelegatedTaskSig({ ...task, sig: forgedWithEmptyKey }, '')).toBe(false);
    // A real secret still works end to end.
    expect(verifyDelegatedTaskSig({ ...task, sig: signDelegatedTask(task, SECRET) }, SECRET)).toBe(true);
  });

  it('canonicalTaskBinding refuses a nullish task (matches upstream TypeError, not silent "{}" )', () => {
    expect(() => canonicalTaskBinding(null as never)).toThrow();
    expect(() => canonicalTaskBinding(undefined as never)).toThrow();
  });

  it('canonical bytes are recursively key-sorted and exclude sig', () => {
    const task = baseTask();
    const withSig = { ...task, sig: 'deadbeef' };
    // sig is stripped; remaining keys sorted at every level.
    const canon = canonicalTaskBinding(withSig);
    expect(canon).not.toContain('sig');
    expect(canon).not.toContain('deadbeef');
    expect(canon.indexOf('"budget"')).toBeLessThan(canon.indexOf('"expiry"'));
    expect(canon.indexOf('"egressBytes"')).toBeLessThan(canon.indexOf('"modelSpend"'));
    // Recompute the HMAC by hand over these exact bytes to prove signDelegatedTask uses them.
    const byHand = createHmac('sha256', SECRET).update(canon).digest('hex');
    expect(byHand).toBe(signDelegatedTask(task, SECRET));
  });
});
