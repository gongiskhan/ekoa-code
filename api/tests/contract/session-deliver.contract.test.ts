import { describe, it, expect, beforeEach } from 'vitest';
import { BridgeFrame } from '@ekoa/shared';
import { createDaemonStepConnection, type DaemonStepDeps } from '../../src/bridge/daemon-step-seam.js';
import { deliverSession, sessionCookieValues } from '../../src/bridge/session-delivery.js';
import {
  redactInboundFrame,
  registryFor,
  releasePairingSecrets,
  __resetIngressRedactionForTests,
} from '../../src/bridge/ingress-redaction.js';
import { DaemonBrowserSession } from '../../src/automation/browser-session.js';
import type { DaemonConnection, DaemonStepRequest, ResultEnvelope } from '../../src/automation/seams.js';

/**
 * CONTRACT - the Cortex -> daemon SESSION DELIVERY channel (S-inject).
 *
 * WHAT A CONTRACT TEST IS FOR HERE. The frame is not an HTTP endpoint, so the contract it has to
 * satisfy is the shared zod union rather than a response schema: every frame this process emits for
 * a session delivery must parse as `BridgeFrame`, because the daemon parses it with the same schema
 * and a frame that does not is a step that silently never becomes authenticated. So these cases
 * assert on the ACTUAL emitted object, validated against the shared schema, rather than on a
 * hand-written literal that could drift from what the code builds.
 *
 * The behavioural half is the pair the design turns on: a run whose origin HAS a captured session
 * gets exactly one delivery, on the lease-taking frame; a run that has none gets no frame at all.
 * "No frame at all" is the property that keeps `no session resolved` meaning `whatever the machine
 * already holds` rather than `wipe what the machine holds`.
 */

const PAIRING = 'pair-1';
const ORG = 'org-1';
const STORAGE_STATE = {
  cookies: [{ name: 'SESSIONID', value: 'contract-session-0001', domain: 'portal.test', path: '/' }],
  origins: [],
};

/** Everything the composition root supplies, with the two disclosure paths recorded. */
function seamDeps(over: Partial<DaemonStepDeps> = {}): {
  deps: DaemonStepDeps;
  frames: unknown[];
  invokes: Array<{ capability: string; payload: unknown }>;
  order: string[];
} {
  const frames: unknown[] = [];
  const invokes: Array<{ capability: string; payload: unknown }> = [];
  const order: string[] = [];
  const deps: DaemonStepDeps = {
    isCapabilityGranted: async () => {
      order.push('grant?');
      return true;
    },
    invoke: async (input) => {
      order.push('invoke');
      invokes.push({ capability: input.capability, payload: input.payload });
      return { ok: true, output: { url: 'https://portal.test/inbox' } };
    },
    newInvocationId: () => 'inv-1',
    authoriseDelivery: () => 'nonce-1',
    deliverSecrets: async () => ({}),
    // Builds the SAME object `server.ts` hands to `sendToPairing`, so what is validated below is
    // the frame that would actually cross the socket.
    deliverSession: ({ pairingId, runId, storageState }) => {
      order.push('session');
      frames.push({ type: 'session.deliver', runId, storageState });
      return pairingId === PAIRING;
    },
    ...over,
  };
  return { deps, frames, invokes, order };
}

const conn = { pairingId: PAIRING, org: ORG };

describe('the delivery frame validates against the shared schema', () => {
  it('what the seam emits parses as a BridgeFrame', async () => {
    const { deps, frames } = seamDeps();
    const seam = createDaemonStepConnection(conn, deps);

    await seam.runStep({
      capability: 'browser',
      input: { owner: 'u1', leaseId: 'lease-1', action: { action: 'navigate', url: 'https://portal.test/inbox' } },
      runId: 'run_1',
      sessionState: STORAGE_STATE,
    } as DaemonStepRequest);

    expect(frames).toHaveLength(1);
    const parsed = BridgeFrame.safeParse(frames[0]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.type).toBe('session.deliver');
    expect(parsed.success && parsed.data.type === 'session.deliver' && parsed.data.runId).toBe('run_1');
    expect(parsed.success && parsed.data.type === 'session.deliver' && parsed.data.storageState).toEqual(STORAGE_STATE);
  });

  it('the session is delivered BEFORE the step that consumes it, and after the grant check', async () => {
    const { deps, order } = seamDeps();
    const seam = createDaemonStepConnection(conn, deps);

    await seam.runStep({
      capability: 'browser',
      input: { owner: 'u1', leaseId: 'lease-1', action: { action: 'navigate', url: 'https://portal.test/x' } },
      runId: 'run_1',
      sessionState: STORAGE_STATE,
    } as DaemonStepRequest);

    // AFTER the grant: a `storageState` is credential-equivalent, so putting it on an unauthorised
    // machine is disclosure that no later refusal takes back. BEFORE the invoke: the daemon builds
    // the browser context WITH the cookies or without them, and there is no injecting into a jar
    // after the fact.
    expect(order).toEqual(['grant?', 'session', 'invoke']);
  });
});

describe('a run receives a session only when one was resolved for it', () => {
  it('sends NO frame for a run with no session', async () => {
    const { deps, frames, invokes } = seamDeps();
    const seam = createDaemonStepConnection(conn, deps);

    await seam.runStep({
      capability: 'browser',
      input: { owner: 'u1', leaseId: 'lease-1', action: { action: 'navigate', url: 'https://portal.test/x' } },
      runId: 'run_2',
    } as DaemonStepRequest);

    // Silence, not an empty delivery. An empty one would be a statement Cortex has no right to
    // make: the daemon's profile is persistent, and "no session resolved" must keep meaning
    // "whatever this machine already holds".
    expect(frames).toHaveLength(0);
    expect(invokes).toHaveLength(1);
  });

  it('an UNGRANTED machine receives no session, and the refusal carries the typed envelope', async () => {
    const { deps, frames } = seamDeps({ isCapabilityGranted: async () => false });
    const seam = createDaemonStepConnection(conn, deps);

    const env = await seam.runStep({
      capability: 'browser',
      input: { owner: 'u1', leaseId: 'lease-1', action: { action: 'navigate', url: 'https://portal.test/x' } },
      runId: 'run_1',
      sessionState: STORAGE_STATE,
    } as DaemonStepRequest);

    expect(frames).toHaveLength(0);
    expect(env.ok).toBe(false);
    // `retryable: false` is load-bearing, not decorative: `local-command.ts` records
    // `recoverable: env.error?.retryable !== false`, so an unflagged refusal is retried - and every
    // retry of THIS one would be another attempt to ship a session to an unauthorised machine.
    expect(env.error?.retryable).toBe(false);
    expect(env.error?.message).toBeTruthy();
    expect(JSON.stringify(env)).not.toContain('contract-session-0001');
  });
});

describe('delivering a session arms the INGRESS filter', () => {
  beforeEach(() => {
    __resetIngressRedactionForTests();
  });

  it('registers the session cookie so an echoed one never reaches persistence', () => {
    // The delivery itself cannot send (no live socket in this suite) and that is fine: the arming
    // happens BEFORE the send precisely so it survives a send that fails.
    deliverSession({ pairingId: PAIRING, runId: 'run_1', storageState: STORAGE_STATE });

    // The daemon now reports an observation with the cookie in the page title - a portal that
    // reflects its own session token. Without this leg Cortex would write that into the run record
    // and stream it over SSE, where it is durable in a way a dropped frame is not.
    const scrubbed = redactInboundFrame(PAIRING, {
      type: 'tool.result',
      invocationId: 'inv-1',
      ok: true,
      output: { url: 'https://portal.test/x?sid=contract-session-0001', title: 'contract-session-0001' },
    });

    expect(JSON.stringify(scrubbed)).not.toContain('contract-session-0001');
  });

  it('arms nothing for a pairing that was delivered nothing', () => {
    // Non-vacuity for the case above: the redaction there must come from THIS delivery and not from
    // some filter that scrubs everything regardless.
    const scrubbed = redactInboundFrame('other-pairing', {
      type: 'tool.result',
      invocationId: 'inv-1',
      ok: true,
      output: { title: 'contract-session-0001' },
    });

    expect(JSON.stringify(scrubbed)).toContain('contract-session-0001');
    expect(registryFor('other-pairing')).toBeUndefined();
  });

  it('drops the registration when the pairing socket closes', () => {
    deliverSession({ pairingId: PAIRING, runId: 'run_1', storageState: STORAGE_STATE });
    expect(registryFor(PAIRING)).toBeDefined();

    releasePairingSecrets(PAIRING);

    // The filter's lifetime is the machine's ability to echo what it was given, which ends with the
    // socket. Same lifetime a delivered secret's registration has, and for the same reason.
    expect(registryFor(PAIRING)).toBeUndefined();
  });

  it('takes cookie values from BOTH stored shapes, and leaves short ones alone', () => {
    expect(sessionCookieValues(STORAGE_STATE)).toEqual(['contract-session-0001']);
    expect(sessionCookieValues({ storageState: STORAGE_STATE, capturedAt: 'now' })).toEqual([
      'contract-session-0001',
    ]);
    // A short cookie is a preference flag, not a session token. Registering `en` would substitute
    // it wherever it occurred in ordinary page text - a filter that mangles the page is not a safer
    // filter. Same floor as the daemon's leg in `runtime/session-hold.ts`.
    expect(
      sessionCookieValues({ cookies: [{ name: 'lang', value: 'en', domain: 'portal.test', path: '/' }] }),
    ).toEqual([]);
    expect(sessionCookieValues(undefined)).toEqual([]);
    expect(sessionCookieValues({ cookies: 'not-an-array' })).toEqual([]);
  });
});

describe('DaemonBrowserSession puts the session on the LEASE-TAKING frame and only there', () => {
  /** A connection double that records the requests the session builds. */
  function recordingConnection(): { conn: DaemonConnection; seen: DaemonStepRequest[] } {
    const seen: DaemonStepRequest[] = [];
    return {
      seen,
      conn: {
        pairingId: PAIRING,
        runStep: async (req: DaemonStepRequest): Promise<ResultEnvelope> => {
          seen.push(req);
          return { ok: true, observation: { data: {} } };
        },
      },
    };
  }

  it('carries it on the first frame and on no later one', async () => {
    const { conn: connection, seen } = recordingConnection();
    const session = new DaemonBrowserSession({
      connection,
      runId: 'run_1',
      ownerUserId: 'u1',
      keepAliveMs: 0,
      sessionState: STORAGE_STATE,
    });

    await session.act({ kind: 'navigate', url: 'https://portal.test/inbox' });
    await session.act({ kind: 'navigate', url: 'https://portal.test/next' });

    expect(seen).toHaveLength(2);
    expect(seen[0]!.sessionState).toEqual(STORAGE_STATE);
    // The daemon injects a session ONCE, when it takes the lease. A copy on every later step would
    // be credential material on the wire for a machine that already has it.
    expect(seen[1]!.sessionState).toBeUndefined();
  });

  it('omits the field entirely for a run with no session', async () => {
    const { conn: connection, seen } = recordingConnection();
    const session = new DaemonBrowserSession({ connection, runId: 'run_2', ownerUserId: 'u1', keepAliveMs: 0 });

    await session.act({ kind: 'navigate', url: 'https://portal.test/inbox' });

    expect(seen).toHaveLength(1);
    expect('sessionState' in seen[0]!).toBe(false);
  });

  it('a LIFECYCLE frame can be the one that takes the lease, and carries it', async () => {
    const { conn: connection, seen } = recordingConnection();
    const session = new DaemonBrowserSession({
      connection,
      runId: 'run_3',
      ownerUserId: 'u1',
      keepAliveMs: 0,
      sessionState: STORAGE_STATE,
    });

    // A discovery pass arms capture BEFORE it navigates, and that frame is what makes the daemon
    // open the jar. Delivering only from the page path would leave exactly those runs signed out.
    // Called WITHOUT `?.` on purpose: an optional call that silently skipped would leave the
    // navigate as frame 0 and this case would assert the wrong thing while staying green.
    await session.startCapture();
    await session.act({ kind: 'navigate', url: 'https://portal.test/inbox' });

    expect(seen).toHaveLength(2);
    expect(seen[0]!.input).toMatchObject({ captureOp: 'start' });
    expect(seen[0]!.sessionState).toEqual(STORAGE_STATE);
    expect(seen[1]!.sessionState).toBeUndefined();
  });
});
