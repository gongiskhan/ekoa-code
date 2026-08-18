import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { bashInvoke, deliverFrame, invokeAndWait, makeRig, readTree, type SecurityRig } from './helpers.js';

/**
 * SECURITY SUITE - `secret-no-disk` (I9).
 *
 * THE OBLIGATION. Cortex delivers a credential on `secret.deliver` because the step that needs it
 * runs on the user's machine. What the daemon owes back is that the value lives in RAM and nowhere
 * else: not in `config.json`, not in the ledger, not in a profile directory, not in a crash file.
 * That obligation used to be a COMMENT beside a `break` statement - the frame was dropped without
 * being stored, which made the promise true by doing nothing. Now the frame IS stored, so the
 * promise needs a test, and this is it.
 *
 * The proof is deliberately blunt: run a real delivery and a real child that consumes it, then read
 * EVERY file under `EKOA_BRIDGE_HOME` and assert the value appears in none of them. A narrower
 * assertion ("config.json does not contain it") would pass while the ledger leaked.
 */
const SECRET = 'db-token-NO-DISK-91ee44aa';

let rig: SecurityRig | undefined;

afterEach(() => {
  if (rig) rmSync(rig.home, { recursive: true, force: true });
  rig = undefined;
});

describe('a delivered and CONSUMED secret reaches no file under EKOA_BRIDGE_HOME', () => {
  it('is absent from every file in the home after the child that used it exits', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    // The child prints the injected variable, so the value is genuinely in flight - a test whose
    // child never touched the secret would prove only that an unused value is not written down.
    const result = await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', 'echo "$DB_TOKEN"']));
    expect(result.ok).toBe(true);

    const files = readTree(rig.home);
    expect(files.length).toBeGreaterThan(0); // the ledger at minimum, or the assertion proves nothing
    const leaks = files.filter(([, body]) => body.includes(SECRET));
    expect(leaks.map(([p]) => p)).toEqual([]);
  });

  it('is absent from the ledger even though EVERY invocation is ledgered', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { DB_TOKEN: SECRET }));
    await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', 'echo "$DB_TOKEN"']));

    const ledgerFiles = readTree(rig.ledgerDir);
    expect(ledgerFiles.length).toBeGreaterThan(0);
    for (const [path, body] of ledgerFiles) {
      expect(body.includes(SECRET), `ledger file leaked the value: ${path}`).toBe(false);
    }
  });

  it('is absent from disk when the delivery is NEVER consumed (swept, not spilled)', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-orphan', { DB_TOKEN: SECRET }));
    rig.runtime.zeroizeSecrets();
    const leaks = readTree(rig.home).filter(([, body]) => body.includes(SECRET));
    expect(leaks.map(([p]) => p)).toEqual([]);
  });

  it('does not persist the env-var NAMES either - they map what this tenant holds', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { EKOA_ACME_PROD_DB_TOKEN: SECRET }));
    await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', 'echo ok']));
    const leaks = readTree(rig.home).filter(([, body]) => body.includes('EKOA_ACME_PROD_DB_TOKEN'));
    expect(leaks.map(([p]) => p)).toEqual([]);
  });
});
