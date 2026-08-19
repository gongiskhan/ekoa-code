import { describe, it, expect, vi } from 'vitest';
import { DaemonBrowserSession, releaseBrowserLease } from '../../src/automation/browser-session.js';
import { LocalBrowserStepInput, LocalToolInvokeInput } from '@ekoa/shared';
import type { DaemonConnection, DaemonStepRequest, ResultEnvelope } from '../../src/automation/seams.js';

/**
 * THE BROWSER LEASE, from Cortex's end: how a run says "still here" and how it says "done".
 *
 * WHY IT MATTERS, in the terms of the defect it closes. Cortex sends ONE `tool.invoke` per action:
 * `dispatch` is reached from every `act()`, `assert()` and `observe()`. The daemon therefore had no
 * way to know a run had ended, and hung its browser teardown off the end of each INVOKE - closing
 * the page and clearing the whole cookie jar between every pair of steps, so every browser step
 * after the first ran on a fresh `about:blank`, signed out.
 *
 * The daemon now holds one page and one jar per LEASE. Two frames operate on it, and the assertions
 * below are about both: what they say, which lease they name, that they cannot throw out of the
 * engine's run `finally`, and that a failure is never reported as a clean end.
 */
function recordingConnection(
  behaviour: (req: DaemonStepRequest) => ResultEnvelope | Promise<ResultEnvelope> = () => ({ ok: true }),
): { conn: DaemonConnection; calls: DaemonStepRequest[] } {
  const calls: DaemonStepRequest[] = [];
  return {
    calls,
    conn: {
      pairingId: 'pair-1',
      async runStep(req: DaemonStepRequest): Promise<ResultEnvelope> {
        calls.push(req);
        return behaviour(req);
      },
    },
  };
}

const OBSERVED: ResultEnvelope = {
  ok: true,
  observation: { data: { url: 'https://portal.test/inbox' }, screenshotB64: 'UE5H' },
};

function session(
  conn: DaemonConnection,
  opts: { lease?: { id: string; used: boolean }; keepAliveMs?: number } = {},
): DaemonBrowserSession {
  return new DaemonBrowserSession({
    connection: conn,
    runId: 'run-42',
    ownerUserId: 'u1',
    keepAliveMs: 0, // off unless a test asks for it
    ...opts,
  });
}

describe('releaseBrowserLease - the run-end signal', () => {
  it('sends exactly one browser frame, and it is the `release` lifecycle op', async () => {
    const { conn, calls } = recordingConnection();
    await releaseBrowserLease(conn, { leaseId: 'lease-1', ownerUserId: 'u1', runId: 'run-42' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.capability).toBe('browser');
    expect(calls[0]!.input).toEqual({ owner: 'u1', leaseId: 'lease-1', leaseOp: 'release' });
  });

  it('names the LEASE and the RUN - one is what the daemon keys by, the other is who is asking', async () => {
    const { conn, calls } = recordingConnection();
    await releaseBrowserLease(conn, { leaseId: 'lease-1', ownerUserId: 'u1', runId: 'run-42' });
    expect(calls[0]!.runId).toBe('run-42');
    expect((calls[0]!.input as { leaseId: string }).leaseId).toBe('lease-1');
  });

  it('puts a frame on the wire that the daemon can actually parse (the shared contract)', async () => {
    const { conn, calls } = recordingConnection();
    await releaseBrowserLease(conn, { leaseId: 'lease-1', ownerUserId: 'u1', runId: 'run-42' });
    // Exactly the parse the daemon does: the envelope, then the step payload.
    const envelope = LocalToolInvokeInput.safeParse({
      capability: calls[0]!.capability,
      input: calls[0]!.input,
      runId: calls[0]!.runId,
    });
    expect(envelope.success, JSON.stringify(envelope.success ? {} : envelope.error.issues)).toBe(true);
    const step = LocalBrowserStepInput.safeParse(calls[0]!.input);
    expect(step.success, JSON.stringify(step.success ? {} : step.error.issues)).toBe(true);
  });

  it('carries NO secretEnv - ending a run needs no credential', async () => {
    const { conn, calls } = recordingConnection();
    await releaseBrowserLease(conn, { leaseId: 'lease-1', ownerUserId: 'u1', runId: 'run-42' });
    expect(calls[0]!.secretEnv).toBeUndefined();
  });

  it('NEVER throws - the engine calls it from a run `finally`, where a throw eats the real outcome', async () => {
    const dead: DaemonConnection = {
      pairingId: 'pair-1',
      runStep: async () => {
        throw new Error('socket closed');
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(releaseBrowserLease(dead, { leaseId: 'l1', ownerUserId: 'u1', runId: 'run-42' })).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('is LOUD when the daemon could not end the lease - a failed wipe is not a clean run end', async () => {
    // The daemon answers ok:false when the jar could not be cleared. Swallowing that would leave
    // an authenticated Cofre session resident in a profile the user's next automation shares while
    // Cortex recorded a run that ended cleanly.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { conn } = recordingConnection(() => ({ ok: false, error: { message: 'browser context is closed' } }));
    await releaseBrowserLease(conn, { leaseId: 'l1', ownerUserId: 'u1', runId: 'run-42' });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain('browser context is closed');
    expect(String(spy.mock.calls[0]?.[0])).toContain('run-42');
    spy.mockRestore();
  });

  it('says so when the MACHINE never answered, rather than failing silently', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dead: DaemonConnection = {
      pairingId: 'pair-1',
      runStep: async () => {
        throw new Error('socket closed');
      },
    };
    await releaseBrowserLease(dead, { leaseId: 'l1', ownerUserId: 'u1', runId: 'run-42' });
    expect(String(spy.mock.calls[0]?.[0])).toContain('socket closed');
    spy.mockRestore();
  });
});

describe('DaemonBrowserSession - the lease it names', () => {
  it('stamps the leaseId on EVERY step frame, so one run drives one page', async () => {
    const { conn, calls } = recordingConnection(() => OBSERVED);
    const s = session(conn, { lease: { id: 'lease-1', used: false } });
    await s.act({ kind: 'navigate', url: 'https://portal.test/inbox' });
    await s.observe();
    await s.assert({ kind: 'expect_url', pattern: '/inbox' }).catch(() => undefined);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect((call.input as { leaseId: string }).leaseId).toBe('lease-1');
      expect(call.runId).toBe('run-42');
    }
  });

  it('falls back to its runId when no lease is supplied - a run with no parent means one lease', async () => {
    const { conn, calls } = recordingConnection(() => OBSERVED);
    await session(conn).observe();
    expect((calls[0]!.input as { leaseId: string }).leaseId).toBe('run-42');
  });

  it('does NOT end the lease on dispose - a sub-automation would tear the browser down under its parent', async () => {
    // THE REGRESSION THIS PREVENTS. `dispose()` used to send the release itself. A sub-automation
    // has its own session but SHARES its parent's lease, so the moment a child finished it dropped
    // the page and wiped the jar that its parent was still using.
    const { conn, calls } = recordingConnection(() => OBSERVED);
    const s = session(conn, { lease: { id: 'lease-1', used: false } });
    await s.observe();
    calls.length = 0;
    await s.dispose();
    expect(calls).toHaveLength(0);
  });

  it('marks the lease USED only when it actually sends a frame, never at construction', async () => {
    // The engine builds a session for EVERY step of a daemon-connected run, whatever the step's
    // type (`executeStep({ browser: getBrowser() })`). Marking at construction would make every
    // such run send a run-end release for a lease the daemon never took.
    const { conn } = recordingConnection(() => OBSERVED);
    const lease = { id: 'lease-1', used: false };
    const s = session(conn, { lease });
    expect(lease.used).toBe(false);
    await s.observe();
    expect(lease.used).toBe(true);
  });

  it('does not disturb the cached page state - a run summary read after dispose is still true', async () => {
    const { conn } = recordingConnection(() => OBSERVED);
    const s = session(conn, { lease: { id: 'lease-1', used: false } });
    await s.observe();
    const fingerprintBefore = s.fingerprint();
    await s.dispose();
    expect(s.url()).toBe('https://portal.test/inbox');
    expect(s.screenshotB64()).toBe('UE5H');
    expect(s.fingerprint()).toEqual(fingerprintBefore);
  });
});

/**
 * THE KEEPALIVE.
 *
 * The daemon reaps a lease nothing has arrived for in two minutes, because a Cortex that died
 * mid-run must not leave an authenticated jar and a headed window resident on somebody's machine.
 * A live run routinely goes minutes without a browser step - blocked on a sub-automation, on a slow
 * API call, or on a human solving a CAPTCHA in that very window - and reaping those closes the
 * browser out from under the person using it. This is what separates the two cases.
 */
describe('DaemonBrowserSession - the keepalive heartbeat', () => {
  it('says nothing until something has taken the lease, then repeats on its own', async () => {
    vi.useFakeTimers();
    try {
      const { conn, calls } = recordingConnection(() => OBSERVED);
      const s = session(conn, { lease: { id: 'lease-1', used: false }, keepAliveMs: 1_000 });

      // Nothing yet: there is no lease to keep alive until a step has taken one.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls).toHaveLength(0);

      await s.observe();
      calls.length = 0;
      await vi.advanceTimersByTimeAsync(3_500);

      expect(calls.length).toBeGreaterThanOrEqual(3);
      for (const call of calls) {
        expect(call.input).toEqual({ owner: 'u1', leaseId: 'lease-1', leaseOp: 'keepalive' });
        expect(LocalBrowserStepInput.safeParse(call.input).success).toBe(true);
      }
      await s.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('heartbeats a lease a SUB-AUTOMATION took, from a session that never dispatched', async () => {
    // The parent of a browser-only sub-automation never dispatches from its own session. If the
    // heartbeat only existed after a session's first frame, that parent would have nothing to hold
    // the lease with while it sat through a long api_call after the child returned - and the lease
    // the child opened would be reaped out from under its next browser step.
    vi.useFakeTimers();
    try {
      const { conn, calls } = recordingConnection(() => OBSERVED);
      const lease = { id: 'lease-1', used: false };
      const parent = session(conn, { lease, keepAliveMs: 1_000 });

      await vi.advanceTimersByTimeAsync(3_000);
      expect(calls).toHaveLength(0); // nothing has taken the lease

      lease.used = true; // ... the child's session did, on the shared object
      await vi.advanceTimersByTimeAsync(3_500);

      expect(calls.length).toBeGreaterThanOrEqual(3);
      expect(calls[0]!.input).toEqual({ owner: 'u1', leaseId: 'lease-1', leaseOp: 'keepalive' });
      await parent.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('STOPS on dispose - a finished run must not go on heartbeating a lease it gave back', async () => {
    vi.useFakeTimers();
    try {
      const { conn, calls } = recordingConnection(() => OBSERVED);
      const s = session(conn, { lease: { id: 'lease-1', used: false }, keepAliveMs: 1_000 });
      await s.observe();
      await s.dispose();
      calls.length = 0;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a heartbeat the machine refuses - it is best effort, never a run error', async () => {
    vi.useFakeTimers();
    try {
      let beats = 0;
      const conn: DaemonConnection = {
        pairingId: 'pair-1',
        runStep: async (req: DaemonStepRequest) => {
          if ((req.input as { leaseOp?: string }).leaseOp === 'keepalive') {
            beats += 1;
            throw new Error('socket hiccup');
          }
          return OBSERVED;
        },
      };
      const s = session(conn, { lease: { id: 'lease-1', used: false }, keepAliveMs: 1_000 });
      await s.observe();
      await vi.advanceTimersByTimeAsync(3_500);
      expect(beats).toBeGreaterThanOrEqual(3); // it kept beating after the first failure
      // ... and the session is still perfectly usable.
      await expect(s.observe()).resolves.toBeUndefined();
      await s.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
