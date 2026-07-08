import { describe, it, expect } from 'vitest';
import type { BridgeFrame } from '@ekoa/shared';
import { createProviderHandler, type ResolvedPairing } from '../../src/bridge/provider.js';

/**
 * Provider-endpoint auth binding (ch18 §18.4.4, §18.8 criterion 3). The credential -> pairing -> org
 * chain is checked server-side, per request, BEFORE any model call: a credential resolving to no
 * live pairing is rejected; a request carrying a conversation from another org is rejected before
 * any model call; a deactivated owner is refused. The chokepoint completion is injected as a spy so
 * the chain is exercised without a model, and we assert it is NOT called on any rejection.
 */
type ProviderRequestFrame = Extract<BridgeFrame, { type: 'provider_request' }>;

function reqFrame(over: Partial<ProviderRequestFrame> = {}): ProviderRequestFrame {
  return {
    type: 'provider_request',
    correlationId: 'corr-1',
    session: 'conv-1',
    credential: 'cred-A',
    body: { model: 'x', messages: [{ role: 'user', content: 'oi' }] },
    ...over,
  };
}

const pairingA: ResolvedPairing = { pairingId: 'p-A', org: 'org-A', ownerUserId: 'owner-A' };
const active = () => ({ active: true, billingLocked: false });

describe('provider endpoint credential -> pairing -> org chain (§18.4.4)', () => {
  it('rejects a credential that resolves to no live pairing — before any model call', async () => {
    let called = false;
    const handler = createProviderHandler({
      resolvePairingByCredential: async () => {
        throw new Error('no live pairing');
      },
      resolveSessionOrg: async () => 'org-A',
      getActivation: active,
      runCompletion: async () => {
        called = true;
        return { status: 200, body: '{}' };
      },
    });
    const out = await handler.handle(reqFrame(), 'p-A');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no-live-pairing');
    expect(out.frame.type).toBe('provider_response');
    expect((out.frame.body as { type?: string }).type).toBe('error');
    expect(called).toBe(false);
  });

  it('rejects a credential presented on a DIFFERENT socket than its pairing (§18.4.4 credential-socket binding)', async () => {
    // The credential resolves to pairing p-A, but the frame arrived on socket pairing p-other -
    // a stolen/replayed credential cannot address its own pairing's org/vault from another socket.
    let called = false;
    const handler = createProviderHandler({
      resolvePairingByCredential: async () => pairingA, // credential -> p-A
      resolveSessionOrg: async () => 'org-A',
      getActivation: active,
      runCompletion: async () => {
        called = true;
        return { status: 200, body: '{}' };
      },
    });
    const out = await handler.handle(reqFrame(), 'p-other'); // ...but the socket is p-other
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('credential-socket-mismatch');
    expect(called).toBe(false); // rejected before any model call
  });

  it('rejects a conversation from another org BEFORE any model call (cross-org)', async () => {
    let called = false;
    const handler = createProviderHandler({
      resolvePairingByCredential: async () => pairingA,
      resolveSessionOrg: async () => 'org-B', // the conversation belongs to a DIFFERENT org
      getActivation: active,
      runCompletion: async () => {
        called = true;
        return { status: 200, body: '{}' };
      },
    });
    const out = await handler.handle(reqFrame(), 'p-A');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('cross-org-session');
    expect(called).toBe(false);
  });

  it('an org-A credential cannot address an org-B vault: org is derived from the pairing, not the request', async () => {
    let called = false;
    // Even if the request names an org-B conversation, org comes from the credential's pairing
    // (org-A). The mismatch is caught before any model call — no request field can name org-B's vault.
    const handler = createProviderHandler({
      resolvePairingByCredential: async () => pairingA,
      resolveSessionOrg: async (sessionId) => (sessionId === 'conv-B' ? 'org-B' : 'org-A'),
      getActivation: active,
      runCompletion: async () => {
        called = true;
        return { status: 200, body: '{}' };
      },
    });
    const out = await handler.handle(reqFrame({ session: 'conv-B' }), 'p-A');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('cross-org-session');
    expect(called).toBe(false);
  });

  it('refuses a deactivated owner with ACCOUNT_DISABLED before any model call (§18.4.4 activation)', async () => {
    let called = false;
    const handler = createProviderHandler({
      resolvePairingByCredential: async () => pairingA,
      resolveSessionOrg: async () => 'org-A',
      getActivation: () => ({ active: false, billingLocked: false }),
      runCompletion: async () => {
        called = true;
        return { status: 200, body: '{}' };
      },
    });
    const out = await handler.handle(reqFrame(), 'p-A');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('ACCOUNT_DISABLED');
    expect((out.frame.body as { error?: { type?: string } }).error?.type).toBe('ACCOUNT_DISABLED');
    expect(called).toBe(false);
  });

  it('refuses a billing-locked owner with BILLING_LOCKED', async () => {
    const handler = createProviderHandler({
      resolvePairingByCredential: async () => pairingA,
      resolveSessionOrg: async () => 'org-A',
      getActivation: () => ({ active: true, billingLocked: true }),
      runCompletion: async () => ({ status: 200, body: '{}' }),
    });
    const out = await handler.handle(reqFrame(), 'p-A');
    expect(out.reason).toBe('BILLING_LOCKED');
  });

  it('on the happy path routes through the chokepoint, propagates the session id, and bills the owner', async () => {
    let seenBody: Record<string, unknown> | undefined;
    let seenBillee: string | undefined;
    const handler = createProviderHandler({
      resolvePairingByCredential: async () => pairingA,
      resolveSessionOrg: async () => 'org-A',
      getActivation: active,
      runCompletion: async (body, billee) => {
        seenBody = body;
        seenBillee = billee;
        return { status: 200, body: JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'olá' }] }) };
      },
    });
    const out = await handler.handle(reqFrame(), 'p-A');
    expect(out.ok).toBe(true);
    // Session-identity propagation (§18.4.3): the conversation id is set as the vault key.
    expect((seenBody?.metadata as { session_id?: string } | undefined)?.session_id).toBe('conv-1');
    // Attribution (§18.4.2): billed to the delegating user (the pairing owner).
    expect(seenBillee).toBe('owner-A');
    expect(out.frame.correlationId).toBe('corr-1');
    expect((out.frame.body as { type?: string }).type).toBe('message');
  });
});
