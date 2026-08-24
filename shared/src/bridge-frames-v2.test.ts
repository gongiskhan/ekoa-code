import { describe, it, expect } from 'vitest';
import { BridgeFrame } from './ekoa-local.js';

/**
 * CONTRACT — bridge protocol v2 frame families (Cofre WS-J).
 *
 * Added, not replaced: `provider_request`/`provider_response` STAY, because they are the mechanism
 * keeping the LLM egress chokepoint intact for bridge traffic and dropping them needs a replacement
 * story nobody has. Both ends compute the same union, so a frame that parses here parses there.
 */
describe('the v1 families still parse (added, not replaced)', () => {
  it.each(['ping', 'pong'])('%s', (type) => {
    expect(BridgeFrame.safeParse({ type }).success).toBe(true);
  });

  it('provider_request survives — it is the egress chokepoint for bridge traffic', () => {
    expect(
      BridgeFrame.safeParse({
        type: 'provider_request',
        correlationId: 'c1',
        session: 's1',
        credential: 'tok',
        body: {},
      }).success,
    ).toBe(true);
  });
});

describe('hello — the machine advertises what it can do', () => {
  const base = { type: 'hello', machineName: 'escritorio', daemonVersion: '0.2.0' };

  it('parses with a closed capability vocabulary', () => {
    expect(
      BridgeFrame.safeParse({ ...base, capabilities: ['local.bash', 'egress.residential'] }).success,
    ).toBe(true);
  });

  it('REJECTS an invented capability — the vocabulary is closed for a reason', () => {
    expect(BridgeFrame.safeParse({ ...base, capabilities: ['local.everything'] }).success).toBe(false);
  });

  it('treats an absent egressEndpoint as "offers no egress" rather than a default', () => {
    const r = BridgeFrame.safeParse({ ...base, capabilities: [] });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'hello') expect(r.data.egressEndpoint).toBeUndefined();
  });
});

describe('tool.invoke / tool.result', () => {
  it('round-trips an invocation and its result', () => {
    expect(
      BridgeFrame.safeParse({ type: 'tool.invoke', invocationId: 'i1', capability: 'local.bash', input: {} })
        .success,
    ).toBe(true);
    expect(BridgeFrame.safeParse({ type: 'tool.result', invocationId: 'i1', ok: true }).success).toBe(true);
  });

  it('REJECTS an invocation for a capability outside the vocabulary', () => {
    expect(
      BridgeFrame.safeParse({ type: 'tool.invoke', invocationId: 'i1', capability: 'nope', input: {} }).success,
    ).toBe(false);
  });
});

describe('secret.deliver — the only frame carrying credential material', () => {
  it('is nonce-bound and single-use by contract', () => {
    const r = BridgeFrame.safeParse({
      type: 'secret.deliver',
      invocationId: 'i1',
      nonce: 'n1',
      env: { DB_TOKEN: 'value' },
    });
    expect(r.success).toBe(true);
  });

  it('REQUIRES the nonce — a replayable secret delivery is not a delivery', () => {
    expect(
      BridgeFrame.safeParse({ type: 'secret.deliver', invocationId: 'i1', env: { A: 'b' } }).success,
    ).toBe(false);
  });
});

describe('attended.request and session.push', () => {
  it('routes a typed ceremony to a machine with a human at it', () => {
    expect(
      BridgeFrame.safeParse({
        type: 'attended.request',
        requestId: 'r1',
        kind: 'card_login',
        origin: 'https://portal.oa.pt',
        reason: 'sessão expirou',
      }).success,
    ).toBe(true);
  });

  it('REJECTS an untyped ceremony — the kind is what makes it routable', () => {
    expect(
      BridgeFrame.safeParse({ type: 'attended.request', requestId: 'r1', origin: 'x', reason: 'y' }).success,
    ).toBe(false);
  });

  it('returns a captured session for storage as a Cofre item', () => {
    expect(
      BridgeFrame.safeParse({
        type: 'session.push',
        requestId: 'r1',
        origin: 'https://citius.tribunaisnet.mj.pt',
        storageState: { cookies: [] },
      }).success,
    ).toBe(true);
  });
});

describe('session.deliver - the DOWNWARD half of the session lifecycle (S-inject)', () => {
  it('carries a stored session to the machine that will run the browser', () => {
    expect(
      BridgeFrame.safeParse({
        type: 'session.deliver',
        runId: 'run_1',
        storageState: { cookies: [{ name: 'SESSIONID', value: 'v', domain: 'x.test', path: '/' }], origins: [] },
      }).success,
    ).toBe(true);
  });

  it('accepts the WRAPPED shape the Cofre stores as well as a raw storageState', () => {
    // `storageState` is `unknown` precisely so both shapes ride the same frame. The daemon's
    // `parseSessionState` is the ONE place that reconciles them; pinning a shape here would move
    // that decision onto the wire, where a stored item could no longer be delivered unchanged.
    expect(
      BridgeFrame.safeParse({
        type: 'session.deliver',
        runId: 'run_1',
        storageState: { storageState: { cookies: [] }, capturedAt: '2026-08-24T00:00:00.000Z' },
      }).success,
    ).toBe(true);
  });

  it('REQUIRES the runId - a session with nobody to belong to is not deliverable', () => {
    // The runId IS this frame's tenancy on the daemon: the hold is keyed by it and has no fallback
    // lookup, so a delivery without one could only be applied by guessing which run meant it.
    // Refusing it at the schema is what makes "no guessing" a property of the wire itself.
    expect(BridgeFrame.safeParse({ type: 'session.deliver', storageState: { cookies: [] } }).success).toBe(false);
  });
});

describe('the union still rejects the unknown', () => {
  it('drops an unrecognised frame type', () => {
    expect(BridgeFrame.safeParse({ type: 'exfiltrate', payload: 'x' }).success).toBe(false);
  });
});
