import { describe, it, expect, afterEach, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { bashInvoke, deliverFrame, invokeAndWait, makeRig, readTree, type SecurityRig } from './helpers.js';

/**
 * SECURITY SUITE - `secret-no-log` (I9).
 *
 * WHY THE NAMES COUNT AS WELL AS THE VALUES. A value in a log is an obvious disclosure. The env-var
 * NAMES are the less obvious one, and they are why the original drop comment said "not even its
 * env-var names": a log line reading `injected EKOA_ACME_PROD_DB_TOKEN, STRIPE_LIVE_KEY` is a map
 * of what this tenant holds and where, published to whoever reads the daemon's output - which on a
 * user's laptop is a terminal, a systemd journal, or a support bundle they paste into a ticket.
 *
 * EVERY sink is captured: the daemon's own `log` channel, the ledger on disk, and the process-level
 * console (a stray `console.log` in a dependency path would be invisible to the first two).
 */
const SECRET = 'stripe-live-NO-LOG-77c1f0';
const ENV_NAME = 'EKOA_ACME_PROD_DB_TOKEN';

let rig: SecurityRig | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  if (rig) rmSync(rig.home, { recursive: true, force: true });
  rig = undefined;
});

describe('neither the value nor its env-var NAMES reach any log or ledger sink', () => {
  it('captures every sink across a delivery + a child that echoes the value', async () => {
    const console_ = [] as string[];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        console_.push(args.map(String).join(' '));
      });
    }

    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { [ENV_NAME]: SECRET }));
    // The child RECEIVES the injection but the command does not NAME it: the question this suite
    // answers is whether the DAEMON volunteers what it holds, not whether the ledger records the
    // command it was told to run. See the last test for that deliberate boundary.
    const result = await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', 'env > /dev/null; echo done']));
    expect(result.ok).toBe(true);

    const sinks = [
      ...rig.logs.map((l) => ['daemon log', l] as const),
      ...console_.map((l) => ['console', l] as const),
      ...readTree(rig.home).map(([p, b]) => [`file ${p}`, b] as const),
    ];

    for (const [where, text] of sinks) {
      expect(text.includes(SECRET), `${where} leaked the VALUE`).toBe(false);
      expect(text.includes(ENV_NAME), `${where} leaked the env-var NAME`).toBe(false);
    }
  });

  it('logs nothing at all about the delivery itself', async () => {
    rig = makeRig();
    const before = rig.logs.length;
    rig.runtime.onFrame(deliverFrame('inv-1', { [ENV_NAME]: SECRET }));
    expect(rig.logs.slice(before)).toEqual([]);
  });

  it('BOUNDARY, stated: a command that itself NAMES the variable puts that name in the ledger', async () => {
    // Not a leak by this module and not fixable here: ADR-002 requires every tier-2 invocation to
    // be ledgered with its full detail, and the detail IS the command the step author wrote. If
    // that command says `echo "$DB_TOKEN"`, the audit record says so. What must never appear is the
    // VALUE, and what the daemon must never volunteer is the set of names it was handed.
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { [ENV_NAME]: SECRET }));
    await invokeAndWait(rig, bashInvoke('inv-1', ['sh', '-c', `echo "$${ENV_NAME}"`]));
    const ledgerBodies = readTree(rig.ledgerDir).map(([, b]) => b).join('\n');
    expect(ledgerBodies).toContain(ENV_NAME); // the command, recorded as written
    expect(ledgerBodies).not.toContain(SECRET); // never the value
  });

  it('a REFUSED step does not log the names either - a denial is a common place to over-explain', async () => {
    rig = makeRig();
    rig.runtime.onFrame(deliverFrame('inv-1', { [ENV_NAME]: SECRET }));
    // A cwd that escapes the grant: the step is refused and ledgered.
    const refused = await invokeAndWait(rig, {
      type: 'tool.invoke',
      invocationId: 'inv-1',
      capability: 'local.bash',
      input: { capability: 'bash', input: { argv: ['pwd'], cwd: '../../..', grantRef: 'g-sec' }, runId: 'r1' },
    } as never);
    expect(refused.ok).toBe(false);

    for (const [, body] of readTree(rig.home)) {
      expect(body.includes(ENV_NAME)).toBe(false);
      expect(body.includes(SECRET)).toBe(false);
    }
    for (const line of rig.logs) {
      expect(line.includes(ENV_NAME)).toBe(false);
      expect(line.includes(SECRET)).toBe(false);
    }
  });
});
