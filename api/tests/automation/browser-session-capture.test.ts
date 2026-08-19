/**
 * The hosted session's half of capture and injected replay (slices P2.2 / P2.3).
 *
 * Both frames go through the SAME `LocalBrowserStepInput` union the daemon parses, and both are
 * asserted against it here rather than against a hand-written expectation - a frame this session
 * builds that the daemon's zod boundary would refuse is a bug neither side's unit test would
 * otherwise see.
 */
import { describe, it, expect } from 'vitest';
import { LocalBrowserStepInput } from '@ekoa/shared';
import { DaemonBrowserSession } from '../../src/automation/browser-session.js';
import type { DaemonConnection, DaemonStepRequest, ResultEnvelope } from '../../src/automation/seams.js';

function connection(behaviour: (req: DaemonStepRequest) => ResultEnvelope): { conn: DaemonConnection; calls: DaemonStepRequest[] } {
  const calls: DaemonStepRequest[] = [];
  return {
    calls,
    conn: { pairingId: 'pair-1', async runStep(req) { calls.push(req); return behaviour(req); } },
  };
}

function session(conn: DaemonConnection): DaemonBrowserSession {
  return new DaemonBrowserSession({ connection: conn, runId: 'run-1', ownerUserId: 'u1', lease: { id: 'lease-1', used: false }, keepAliveMs: 0 });
}

const CAPTURE = {
  method: 'GET',
  url: 'https://portal.example/api/cases',
  requestHeaderNames: ['x-csrf-token'],
  responseHeaderNames: ['content-type'],
  status: 200,
  resourceType: 'xhr',
};

describe('capture lifecycle frames', () => {
  it('sends a captureOp frame the daemon\'s own schema accepts, naming the lease', async () => {
    const { conn, calls } = connection(() => ({ ok: true, observation: { data: {} } }));
    const s = session(conn);
    await s.startCapture();
    await s.stopCapture();

    expect(calls.map((c) => (c.input as { captureOp?: string }).captureOp)).toEqual(['start', 'stop']);
    for (const call of calls) {
      const parsed = LocalBrowserStepInput.safeParse(call.input);
      expect(parsed.success).toBe(true);
      expect((call.input as { leaseId?: string }).leaseId).toBe('lease-1');
    }
  });

  it('marks the lease USED - arming a recorder takes the machine\'s lease exactly as a click does', async () => {
    const lease = { id: 'lease-1', used: false };
    const { conn } = connection(() => ({ ok: true, observation: { data: {} } }));
    const s = new DaemonBrowserSession({ connection: conn, runId: 'run-1', ownerUserId: 'u1', lease, keepAliveMs: 0 });
    await s.startCapture();
    expect(lease.used).toBe(true);
  });

  it('throws when the machine refuses to arm, rather than reporting a pass that records nothing', async () => {
    const { conn } = connection(() => ({ ok: false, error: { message: 'a máquina não tem sessão activa' } }));
    await expect(session(conn).startCapture()).rejects.toThrow(/sessão activa/);
  });
});

describe('captures ACCUMULATE across observations and drain exactly once', () => {
  it('collects from every frame that carries them, and does not re-deliver on a frame that omits them', async () => {
    let n = 0;
    const { conn } = connection(() => {
      n += 1;
      return n <= 2
        ? { ok: true, observation: { data: { url: 'https://portal.example/', captures: [{ ...CAPTURE, url: `https://portal.example/api/${n}` }] } } }
        : { ok: true, observation: { data: { url: 'https://portal.example/' } } };
    });
    const s = session(conn);
    await s.act({ kind: 'click', locator: { strategy: 'testid', value: 'go' } });
    await s.act({ kind: 'click', locator: { strategy: 'testid', value: 'go' } });
    await s.act({ kind: 'click', locator: { strategy: 'testid', value: 'go' } });

    // THE MERGE HAZARD: `ingest` keeps a previous value when a frame omits a field, which is right
    // for every field that describes the page NOW and wrong for a log of what happened. Three acts,
    // two of which carried one exchange each, must drain exactly two.
    const drained = s.drainCaptures();
    expect(drained.map((c) => c.url)).toEqual(['https://portal.example/api/1', 'https://portal.example/api/2']);
    expect(s.drainCaptures()).toEqual([]);
  });
});

describe('injected-call frames', () => {
  it('sends an injectedCall frame the daemon\'s schema accepts and returns the verdict', async () => {
    const { conn, calls } = connection(() => ({
      ok: true,
      observation: { data: { url: 'https://portal.example/', injectedCall: { status: 200, ok: true, bodyText: '{"items":[]}', responseHeaderNames: ['content-type'] } } },
    }));
    const result = await session(conn).injectCall({ method: 'GET', url: 'https://portal.example/api/cases', headerNames: ['x-csrf-token'] });

    expect(result.status).toBe(200);
    expect(result.bodyText).toBe('{"items":[]}');
    expect(LocalBrowserStepInput.safeParse(calls[0]!.input).success).toBe(true);
  });

  it('never lets one call\'s verdict be read as another\'s', async () => {
    let first = true;
    const { conn } = connection(() => {
      const answer = first
        ? { ok: true as const, observation: { data: { injectedCall: { status: 200, ok: true, bodyText: 'first', responseHeaderNames: [] } } } }
        : { ok: true as const, observation: { data: { url: 'https://portal.example/' } } };
      first = false;
      return answer;
    });
    const s = session(conn);
    await s.injectCall({ method: 'GET', url: 'https://portal.example/api/a', headerNames: [] });
    // The second frame carries NO verdict. Because `ingest` merges, a stale `first` would otherwise
    // be handed back as if this call had answered it.
    await expect(s.injectCall({ method: 'GET', url: 'https://portal.example/api/b', headerNames: [] })).rejects.toThrow(/no verdict/i);
  });
});
