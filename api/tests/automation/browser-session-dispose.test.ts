import { describe, it, expect } from 'vitest';
import { DaemonBrowserSession } from '../../src/automation/browser-session.js';
import { LocalBrowserAction, LocalToolInvokeInput } from '@ekoa/shared';
import type { DaemonConnection, DaemonStepRequest, ResultEnvelope } from '../../src/automation/seams.js';

/**
 * THE RUN-END SIGNAL (`DaemonBrowserSession.dispose`).
 *
 * WHY IT MATTERS, in the terms of the defect it closes. Cortex sends ONE `tool.invoke` per action:
 * `dispatch` is reached from every `act()`, `assert()` and `observe()`. The daemon therefore had no
 * way to know a run had ended, and hung its browser teardown off the end of each INVOKE - closing
 * the page and clearing the whole cookie jar between every pair of steps, so every browser step
 * after the first ran on a fresh `about:blank`, signed out. `dispose` was declared OPTIONAL on
 * `BrowserSession` and this class did not implement it; its doc comment asserted the daemon "needs
 * no teardown", and that comment was the root of the bug.
 *
 * The daemon now holds one page and one jar per `runId` and this is what ends it. The assertions
 * below are about the FRAME: what it says, that it names the run, that it does not disturb the
 * session's cached page state, and that it cannot throw out of the engine's run `finally`.
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

function session(conn: DaemonConnection): DaemonBrowserSession {
  return new DaemonBrowserSession({ connection: conn, runId: 'run-42', ownerUserId: 'u1' });
}

describe('DaemonBrowserSession.dispose - the run-end signal', () => {
  it('EXISTS. The daemon session used to have no teardown at all, which is what broke multi-step', () => {
    const { conn } = recordingConnection();
    expect(typeof session(conn).dispose).toBe('function');
  });

  it('sends exactly one browser step, and it is the `release` verb', async () => {
    const { conn, calls } = recordingConnection();
    await session(conn).dispose();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.capability).toBe('browser');
    expect(calls[0]!.input).toEqual({ owner: 'u1', action: { action: 'release' } });
  });

  it('names the RUN - the runId is what the daemon keys its lease by', async () => {
    const { conn, calls } = recordingConnection();
    await session(conn).dispose();
    expect(calls[0]!.runId).toBe('run-42');
  });

  it('puts a frame on the wire that the daemon can actually parse (the shared contract)', async () => {
    const { conn, calls } = recordingConnection();
    await session(conn).dispose();
    // Exactly the parse the daemon does: the envelope, then the step, then the action union.
    const envelope = LocalToolInvokeInput.safeParse({
      capability: calls[0]!.capability,
      input: calls[0]!.input,
      runId: calls[0]!.runId,
    });
    expect(envelope.success, JSON.stringify(envelope.success ? {} : envelope.error.issues)).toBe(true);
    const action = LocalBrowserAction.safeParse((calls[0]!.input as { action: unknown }).action);
    expect(action.success, JSON.stringify(action.success ? {} : action.error.issues)).toBe(true);
  });

  it('carries NO secretEnv - ending a run needs no credential', async () => {
    const { conn, calls } = recordingConnection();
    await session(conn).dispose();
    expect(calls[0]!.secretEnv).toBeUndefined();
  });

  it('does NOT ingest the release envelope - a release has no page state to cache', async () => {
    // Going through `dispatch` would merge the (empty) release observation into `this.last` and
    // flip `observed` to true, leaving the session claiming a page it no longer has. A run summary
    // read after dispose would then report the wrong URL for the last step.
    const { conn } = recordingConnection((req) =>
      (req.input as { action: { action: string } }).action.action === 'release'
        ? { ok: true, observation: { data: {}, screenshotB64: '' } }
        : { ok: true, observation: { data: { url: 'https://portal.test/inbox' }, screenshotB64: 'UE5H' } },
    );
    const s = session(conn);
    await s.observe();
    expect(s.url()).toBe('https://portal.test/inbox');
    const fingerprintBefore = s.fingerprint();

    await s.dispose();

    expect(s.url()).toBe('https://portal.test/inbox');
    expect(s.screenshotB64()).toBe('UE5H');
    expect(s.fingerprint()).toEqual(fingerprintBefore);
  });

  it('NEVER throws - the engine calls it from a run `finally`, where a throw eats the real outcome', async () => {
    const dead: DaemonConnection = {
      pairingId: 'pair-1',
      runStep: async () => {
        throw new Error('socket closed');
      },
    };
    await expect(session(dead).dispose()).resolves.toBeUndefined();
  });

  it('does not throw on a daemon that REFUSES the release either (an older daemon, Rule 7)', async () => {
    // A daemon predating the verb fails it at its zod boundary. That is the fail-closed answer, and
    // it must not turn a finished run into a failed one; the daemon's idle backstop cleans up.
    const { conn } = recordingConnection(() => ({ ok: false, error: { message: 'passo de navegador inválido' } }));
    await expect(session(conn).dispose()).resolves.toBeUndefined();
  });
});
