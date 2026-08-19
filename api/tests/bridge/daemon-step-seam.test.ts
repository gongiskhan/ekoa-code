import { describe, it, expect, vi } from 'vitest';
import type { BridgeCapability } from '@ekoa/shared';
import {
  capabilityForStep,
  createDaemonStepConnection,
  type DaemonStepDeps,
} from '../../src/bridge/daemon-step-seam.js';

/**
 * The seam between the automation engine and a paired machine - the ONE place a resolved step
 * becomes a `tool.invoke`, and the place three things were wrong or missing.
 *
 * 1. A BROWSER STEP WAS DISPATCHED AS `local.filesystem`. The map read
 *    `req.capability === 'bash' ? 'local.bash' : 'local.filesystem'`, so every browser step was
 *    grant-checked against a capability that has nothing to do with driving a browser, and the
 *    daemon advertises `desktop.automation` for exactly that. An org that had correctly granted
 *    `desktop.automation` and NOT `local.filesystem` got a refusal; one that had granted
 *    `local.filesystem` for file delegation silently authorised browser automation with it.
 * 2. THE SCREENSHOT WAS DROPPED. The seam built `observation: { data: res.output }` and nothing
 *    else, so `DaemonBrowserSession.ingest` - which reads `observation.screenshotB64` - never saw
 *    one, and a bridge run produced no visual evidence at all while a hosted run produced it for
 *    every step.
 * 3. SECRET DELIVERY HAD NO CALLER. `authoriseDelivery`/`deliverSecrets` were built, tested and
 *    never invoked from production code, and `local-command.ts` sent `env: undefined`. The order
 *    matters and is asserted below: authorise, then deliver, then invoke, all under ONE
 *    invocationId, so the daemon holds the credential keyed by the invocation that consumes it.
 * 4. THE CAPABILITY GRANT WAS CHECKED LAST. The only per-machine authorisation lived inside
 *    `invokeTool`, i.e. AFTER `deliverSecrets` had redeemed the nonce, unwrapped a Cofre item,
 *    armed the ingress filter, put the PLAINTEXT on the wire and written a Registo "use" row. So an
 *    ungranted machine received a decrypted credential and was only then refused. It is checked
 *    first now, and the order is asserted in every case below.
 *
 * WHY THE `invoke` DOUBLE REFUSES. It used to return `ok: true` unconditionally, which is exactly
 * why defect 4 was invisible here: a seam that checked the grant only inside `invoke` produced the
 * same green run as one that checked it before decrypting anything. The double now mirrors the real
 * `invokeTool` - it re-reads the same grant set and throws when the capability is not granted - so
 * the only way to keep these cases green is to refuse BEFORE the delivery block.
 */
function deps(
  overrides: Partial<DaemonStepDeps> = {},
  granted: Set<string> = new Set<string>(['desktop.automation', 'local.bash']),
): DaemonStepDeps & {
  calls: Array<{ capability: BridgeCapability; invocationId: string; payload: unknown }>;
  order: string[];
  granted: Set<string>;
} {
  const calls: Array<{ capability: BridgeCapability; invocationId: string; payload: unknown }> = [];
  const order: string[] = [];
  const base: DaemonStepDeps = {
    isCapabilityGranted: async (_orgId, _pairingId, capability) => {
      order.push(`grant?:${capability}`);
      return granted.has(capability);
    },
    invoke: async (input) => {
      // Mirrors `invokeTool`: the grant is re-read here too and an ungranted capability THROWS
      // rather than dispatching. Belt to the seam's braces - never the only check.
      if (!granted.has(input.capability)) {
        throw new Error(`${input.capability} is not granted for machine ${input.pairingId} in this org`);
      }
      order.push('invoke');
      calls.push({ capability: input.capability, invocationId: input.invocationId!, payload: input.payload });
      return { ok: true, output: { url: 'https://x.test' }, screenshotB64: 'aGk=' };
    },
    newInvocationId: () => 'inv-1',
    authoriseDelivery: (invocationId) => {
      order.push(`authorise:${invocationId}`);
      return 'nonce-1';
    },
    deliverSecrets: async (_actor, input) => {
      order.push(`deliver:${input.invocationId}`);
      return { nonce: 'nonce-1', itemIds: [] };
    },
    ...overrides,
  };
  return { ...base, calls, order, granted };
}

const conn = { pairingId: 'pair-1', org: 'org-1' };

describe('capabilityForStep - the grant a step is checked against', () => {
  it('routes a BROWSER step as desktop.automation (was local.filesystem)', () => {
    expect(capabilityForStep('browser')).toBe('desktop.automation');
  });

  it('routes a BASH step as local.bash', () => {
    expect(capabilityForStep('bash')).toBe('local.bash');
  });

  it('never routes anything as local.filesystem - that capability is the FILE delegation rail', () => {
    expect([capabilityForStep('browser'), capabilityForStep('bash')]).not.toContain('local.filesystem');
  });
});

describe('runStep - dispatch and the evidence channel', () => {
  it('dispatches a browser step under desktop.automation', async () => {
    const d = deps();
    const c = createDaemonStepConnection(conn, d);
    await c.runStep({ capability: 'browser', input: { owner: 'u1', action: { action: 'screenshot' } }, runId: 'r1' });
    expect(d.calls[0]!.capability).toBe('desktop.automation');
  });

  it('THREADS the screenshot into observation.screenshotB64 - the field ingest reads', async () => {
    const d = deps();
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({ capability: 'browser', input: {}, runId: 'r1' });
    expect(env.observation?.screenshotB64).toBe('aGk=');
    expect(env.observation?.data).toEqual({ url: 'https://x.test' });
  });

  it('omits screenshotB64 entirely when the machine captured none (never an empty string)', async () => {
    const d = deps({ invoke: async () => ({ ok: true, output: {} }) });
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({ capability: 'browser', input: {}, runId: 'r1' });
    expect(env.observation && 'screenshotB64' in env.observation).toBe(false);
  });

  it('surfaces a daemon refusal as a failed envelope, not a thrown error', async () => {
    const d = deps({ invoke: async () => ({ ok: false, error: 'a máquina recusou' }) });
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({ capability: 'bash', input: {}, runId: 'r1' });
    expect(env.ok).toBe(false);
    expect(env.error?.message).toBe('a máquina recusou');
  });
});

describe('secret delivery - authorise, deliver, invoke, one invocationId', () => {
  const actor = { userId: 'u1', orgId: 'org-1' } as never;

  it('does NOT deliver anything when the step declares no credentials', async () => {
    const d = deps();
    const c = createDaemonStepConnection(conn, d);
    await c.runStep({ capability: 'bash', input: { argv: ['echo'] }, runId: 'r1' });
    expect(d.order).toEqual(['grant?:local.bash', 'invoke']);
  });

  it('authorises, delivers, THEN invokes - all under the same invocationId', async () => {
    const d = deps();
    const c = createDaemonStepConnection(conn, d);
    await c.runStep({
      capability: 'bash',
      input: { argv: ['env'] },
      runId: 'r1',
      secretEnv: { DB_TOKEN: 'cofre:itm_abc' },
      actor,
    });
    expect(d.order).toEqual(['grant?:local.bash', 'authorise:inv-1', 'deliver:inv-1', 'invoke']);
    expect(d.calls[0]!.invocationId).toBe('inv-1');
  });

  it('does NOT invoke when the delivery fails - a child that believes it has credentials it never got produces an unexplained auth failure on the user machine', async () => {
    const d = deps({
      deliverSecrets: async () => {
        throw new Error('pairing is not reachable; secrets were not delivered');
      },
    });
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({
      capability: 'bash',
      input: { argv: ['env'] },
      runId: 'r1',
      secretEnv: { DB_TOKEN: 'cofre:itm_abc' },
      actor,
    });
    expect(env.ok).toBe(false);
    expect(d.order).toEqual(['grant?:local.bash', 'authorise:inv-1']);
    expect(d.calls).toHaveLength(0);
  });

  it('REFUSES a replayed invocationId - the delivery is single-use', async () => {
    // The real `authoriseDelivery` throws on a second authorise for one invocation. The seam must
    // let that refusal reach the caller rather than proceeding to invoke without the credential.
    const authorise = vi.fn((invocationId: string) => {
      if (authorise.mock.calls.length > 1) throw new Error(`invocation ${invocationId} already has a delivery authorised`);
      return 'nonce-1';
    });
    const d = deps({ authoriseDelivery: authorise });
    const c = createDaemonStepConnection(conn, d);
    const req = {
      capability: 'bash' as const,
      input: { argv: ['env'] },
      runId: 'r1',
      secretEnv: { DB_TOKEN: 'cofre:itm_abc' },
      actor,
    };
    const first = await c.runStep(req);
    expect(first.ok).toBe(true);
    const replay = await c.runStep(req);
    expect(replay.ok).toBe(false);
    expect(replay.error?.message).toContain('already has a delivery authorised');
    expect(d.calls).toHaveLength(1); // only the FIRST invocation ever went out
  });
});

/**
 * THE ORDER THE WHOLE MODULE TURNS ON: the org's per-machine grant is read BEFORE anything is
 * decrypted.
 *
 * `deliverSecrets` is not a dispatch, it is a DISCLOSURE: it redeems the nonce, unwraps a Cofre
 * item through `unwrap()`, arms the ingress filter, puts the plaintext on the socket and writes a
 * Registo "use" row. Every one of those is irreversible. Running them and then asking whether the
 * org authorised this machine is asking after the credential is already on someone's laptop, held
 * there for the delivery TTL. The seam suite's sibling (`security/daemon-seam-wiring.test.ts`)
 * states the property for dispatch - "a refusal after dispatch would already have asked a user's
 * computer to run something" - and delivering a decrypted credential is strictly more than that.
 */
describe('the capability grant is the FIRST thing consulted, before any decrypt', () => {
  const actor = { userId: 'u1', orgId: 'org-1' } as never;
  const noGrants = () => new Set<string>();

  it('an UNGRANTED machine: nothing is authorised, nothing is delivered, nothing is dispatched', async () => {
    const d = deps({}, noGrants());
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({
      capability: 'bash',
      input: { argv: ['env'] },
      runId: 'r1',
      secretEnv: { DB_TOKEN: 'cofre:itm_abc' },
      actor,
    });

    expect(env.ok).toBe(false);
    // The decisive assertion: the grant question is the ONLY thing that happened. No authorise, no
    // deliver - so no nonce redeemed, no unwrap, no plaintext frame, no Registo row.
    expect(d.order).toEqual(['grant?:local.bash']);
    expect(d.calls).toHaveLength(0);
  });

  it('a refusal is NOT retryable - a retried step would re-deliver the credential every time', async () => {
    // `local-command.ts` reads `recoverable: env.error?.retryable !== false`, so leaving it unset
    // marks an authorisation refusal as a transient failure and the engine retries it. Each retry
    // used to be another decrypt-and-ship.
    const d = deps({}, noGrants());
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({ capability: 'bash', input: { argv: ['ls'] }, runId: 'r1' });
    expect(env.error?.retryable).toBe(false);
  });

  it('an ungranted BROWSER step is refused under desktop.automation, not local.filesystem', async () => {
    const d = deps({}, noGrants());
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({ capability: 'browser', input: {}, runId: 'r1' });
    expect(env.ok).toBe(false);
    expect(d.order).toEqual(['grant?:desktop.automation']);
  });

  it('a grant for the OTHER capability does not authorise this one', async () => {
    const d = deps({}, new Set(['desktop.automation']));
    const c = createDaemonStepConnection(conn, d);
    const env = await c.runStep({
      capability: 'bash',
      input: { argv: ['env'] },
      runId: 'r1',
      secretEnv: { DB_TOKEN: 'cofre:itm_abc' },
      actor,
    });
    expect(env.ok).toBe(false);
    expect(d.order).toEqual(['grant?:local.bash']);
  });

  it('THE MID-RUN CASE: revoking between steps stops the SECOND delivery, not just the dispatch', async () => {
    // Re-read per step, never cached. `tool-invocation.ts` documents this for dispatch; the same
    // must hold for the credential, or a de-authorised machine keeps receiving decrypted
    // credentials for the rest of the run.
    const d = deps();
    const c = createDaemonStepConnection(conn, d);
    const req = {
      capability: 'bash' as const,
      input: { argv: ['env'] },
      runId: 'r1',
      secretEnv: { DB_TOKEN: 'cofre:itm_abc' },
      actor,
    };
    expect((await c.runStep(req)).ok).toBe(true);
    expect(d.order).toContain('deliver:inv-1');

    d.granted.delete('local.bash'); // the admin revokes mid-run
    d.order.length = 0;
    const second = await c.runStep(req);

    expect(second.ok).toBe(false);
    expect(d.order).toEqual(['grant?:local.bash']);
  });
});
