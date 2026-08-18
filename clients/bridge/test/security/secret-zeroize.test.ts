import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { SecretHold } from '../../src/runtime/index.js';
import { bashInvoke, deliverFrame, invokeAndWait, makeRig, type SecurityRig } from './helpers.js';

/**
 * SECURITY SUITE - `secret-zeroize` (I9).
 *
 * WHY BUFFERS, RESTATED HERE BECAUSE THIS IS THE SUITE THAT DEPENDS ON IT. A JavaScript string is
 * immutable: nothing overwrites its bytes, and it survives in the heap until the collector happens
 * to reach it - which may be after a core dump, a heap snapshot, or a swap to disk. `buf.fill(0)`
 * overwrites the actual backing memory, synchronously, at a moment we choose. So the hold copies
 * every delivered value into a Buffer on arrival and works from that; a string is materialised only
 * transiently, inside `withChildEnv`, because Node's spawn API takes strings and there is no way
 * around it.
 *
 * WHAT THIS SUITE CAN AND CANNOT PROVE. It proves the RESIDENT copy - the one that lives for the
 * whole invocation - is zeroized, by holding a reference to the very Buffers the hold owns and
 * reading them afterwards. It does NOT prove the process is free of every transient: the frame's
 * own `JSON.parse` produced strings this code never had a handle on. That limit is stated rather
 * than papered over; a suite that claimed otherwise would be the more dangerous artefact.
 */
const SECRET = 'db-token-ZEROIZE-8811ffaa';

let rig: SecurityRig | undefined;

afterEach(() => {
  if (rig) rmSync(rig.home, { recursive: true, force: true });
  rig = undefined;
});

describe('the held Buffers are overwritten after the child exits', () => {
  it('zeroizes and drops the entry once the step completes', async () => {
    const hold = new SecretHold();
    hold.deliver('inv-1', 'n1', { DB_TOKEN: SECRET });
    const buffers = hold.__buffersForZeroizeTest('inv-1');
    expect(buffers).toHaveLength(1);
    expect(buffers[0]!.toString('utf8')).toBe(SECRET); // it really held the value

    const seen = await hold.withChildEnv('inv-1', async (injected) => injected.DB_TOKEN);
    expect(seen).toBe(SECRET); // the child genuinely received it

    expect(buffers[0]!.every((b) => b === 0)).toBe(true);
    expect(hold.size).toBe(0);
    expect(hold.has('inv-1')).toBe(false);
  });

  it('zeroizes when the child THROWS - a failing step must not leave a credential resident', async () => {
    const hold = new SecretHold();
    hold.deliver('inv-1', 'n1', { DB_TOKEN: SECRET });
    const buffers = hold.__buffersForZeroizeTest('inv-1');
    await expect(
      hold.withChildEnv('inv-1', async () => {
        throw new Error('child died');
      }),
    ).rejects.toThrow('child died');
    expect(buffers[0]!.every((b) => b === 0)).toBe(true);
    expect(hold.size).toBe(0);
  });

  it('sweeps and zeroizes a hold whose invoke NEVER ARRIVES (TTL)', () => {
    let now = 1_000;
    const hold = new SecretHold({ now: () => now, ttlMs: 60_000 });
    hold.deliver('inv-orphan', 'n1', { DB_TOKEN: SECRET });
    const buffers = hold.__buffersForZeroizeTest('inv-orphan');

    now += 30_000;
    hold.sweep();
    expect(hold.size).toBe(1); // still inside the window

    now += 60_000;
    hold.sweep();
    expect(hold.size).toBe(0);
    expect(buffers[0]!.every((b) => b === 0)).toBe(true);
  });

  it('a REDELIVERY for one invocation zeroizes the stale copy rather than leaving two live', () => {
    const hold = new SecretHold();
    hold.deliver('inv-1', 'n1', { DB_TOKEN: SECRET });
    const first = hold.__buffersForZeroizeTest('inv-1');
    hold.deliver('inv-1', 'n2', { DB_TOKEN: 'a-different-value-here' });
    expect(first[0]!.every((b) => b === 0)).toBe(true);
    expect(hold.size).toBe(1);
  });

  it('zeroizeAll clears everything (daemon shutdown)', () => {
    const hold = new SecretHold();
    hold.deliver('a', 'n', { X: SECRET });
    hold.deliver('b', 'n', { Y: SECRET });
    const all = [...hold.__buffersForZeroizeTest('a'), ...hold.__buffersForZeroizeTest('b')];
    hold.zeroizeAll();
    expect(all.every((b) => b.every((byte) => byte === 0))).toBe(true);
    expect(hold.size).toBe(0);
  });
});

describe('through the real runtime', () => {
  it('leaves no hold behind after a step consumes a delivery', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', 'echo "$DB_TOKEN"']));
    expect(rig.runtime.heldSecretCount()).toBe(0);
    // …and the FILTER is deliberately still armed: it must outlive the hold, because the frame
    // carrying the child's stdout is built after the hold's `finally` has already zeroized.
    expect(rig.runtime.outboundRedactor().size).toBe(1);
  });

  it('zeroizes a delivery whose step was REFUSED at a gate - the value must not outlive the refusal', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    const refused = await invokeAndWait(rig, {
      type: 'tool.invoke',
      invocationId: 'inv-1',
      capability: 'local.bash',
      input: { capability: 'bash', input: { argv: ['pwd'], cwd: '/etc', grantRef: 'nope' }, runId: 'r1' },
    } as never);
    expect(refused.ok).toBe(false);
    expect(rig.runtime.heldSecretCount()).toBe(0);
  });

  it('zeroizeSecrets() at shutdown drops the holds AND disarms the filter', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    expect(rig.runtime.heldSecretCount()).toBe(1);
    rig.runtime.zeroizeSecrets();
    expect(rig.runtime.heldSecretCount()).toBe(0);
    expect(rig.runtime.outboundRedactor().size).toBe(0);
  });
});
