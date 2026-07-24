/**
 * E-signature inbound-webhook trust model (2B-S3) — handleZohoWebhook + handleAdobeWebhook.
 *
 * These are the security-critical guarantees the PUBLIC, credential-free
 * /api/{zoho,adobe}-sign/webhook routes rest on. The route only ACKs 200 + dispatches;
 * ALL trust logic lives in these pure, deps-injected handlers, so they are tested here
 * directly with in-memory fakes (no mongo, no express, no real provider):
 *
 *   1. FORGED-PAYLOAD NO-OP — a payload CLAIMING completion must NOT advance state.
 *      The handler re-fetches owner-scoped and the re-fetch is the only truth:
 *        a) unknown id           → never re-fetched, never advanced;
 *        b) re-fetch says unsigned → payload lied, no advance;
 *        c) re-fetch throws (fail-closed, e.g. the notConnected Adobe backend) → no advance.
 *   2. REPLAY IDEMPOTENCE — the SAME real completion delivered twice advances EXACTLY
 *      once (guarded on stage !== 'Assinada'); the second delivery is a no-op.
 *
 * Covered for BOTH providers (Zoho is live on the SALOMAO ERP; Adobe is the facade the
 * migrated adobe_agreements rows route to).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  handleZohoWebhook,
  zohoClientSigned,
  type ZohoWebhookDeps,
  type ZohoAgreementRef,
} from '../../src/integrations/zoho-sign.js';
import {
  handleAdobeWebhook,
  adobeClientSigned,
  type AdobeWebhookDeps,
  type AdobeAgreementRef,
} from '../../src/integrations/adobe-sign.js';

const CLIENT = 'cliente@example.com';

/** In-memory proposta with the idempotency guard baked into getProposta/updateProposta:
 *  updateProposta merges the patch, so a second webhook sees the advanced stage. */
function makePropostas(initialStage = 'Enviada') {
  const proposta: Record<string, unknown> = { id: 'prop-1', stage: initialStage, client: 'José Cliente' };
  const getProposta = vi.fn(async (_appId: string, _id: string) => ({ ...proposta }));
  const updateProposta = vi.fn(async (_appId: string, _id: string, patch: Record<string, unknown>) => {
    Object.assign(proposta, patch);
  });
  return { proposta, getProposta, updateProposta };
}

// ============================================================================
// Zoho
// ============================================================================

const zohoRef: ZohoAgreementRef = {
  id: 'zr-1',
  appId: 'app-1',
  propostaId: 'prop-1',
  ownerUserId: 'owner-1',
  clientEmail: CLIENT,
  createdAt: '2026-07-01T00:00:00.000Z',
};
/** Re-fetch truth: the client action is genuinely SIGNED. */
const zohoSignedRequest = {
  request_id: 'zr-1',
  request_status: 'completed',
  actions: [{ recipient_email: CLIENT, action_status: 'SIGNED' }],
};
/** Re-fetch truth: nobody has signed yet (contradicts a "completed" payload). */
const zohoUnsignedRequest = {
  request_id: 'zr-1',
  request_status: 'inprogress',
  actions: [{ recipient_email: CLIENT, action_status: 'NOACTION' }],
};
/** A forged event body claiming the request is completed. */
const zohoForgedPayload = { requests: { request_id: 'zr-1', request_status: 'completed' } };

describe('handleZohoWebhook — never trusts the payload for signature state', () => {
  it('forged completion for an UNKNOWN request is a silent no-op (never re-fetched, never advanced)', async () => {
    const { getProposta, updateProposta } = makePropostas();
    const getRequest = vi.fn(async () => zohoSignedRequest);
    const deps: ZohoWebhookDeps = { findAgreement: async () => null, getRequest, getProposta, updateProposta };

    const out = await handleZohoWebhook(zohoForgedPayload, deps);
    expect(out).toMatch(/unknown request_id/);
    expect(getRequest).not.toHaveBeenCalled();
    expect(updateProposta).not.toHaveBeenCalled();
  });

  it('forged completion whose OWNER-SCOPED re-fetch shows the client NOT signed does not advance', async () => {
    const { proposta, getProposta, updateProposta } = makePropostas();
    // The re-fetch (the only source of truth) contradicts the "completed" payload.
    const getRequest = vi.fn(async () => zohoUnsignedRequest);
    const deps: ZohoWebhookDeps = { findAgreement: async () => zohoRef, getRequest, getProposta, updateProposta };

    const out = await handleZohoWebhook(zohoForgedPayload, deps);
    expect(getRequest).toHaveBeenCalledWith('owner-1', 'zr-1'); // owner-scoped, from the ref
    expect(out).toMatch(/not signed yet/);
    expect(updateProposta).not.toHaveBeenCalled();
    expect(proposta.stage).toBe('Enviada');
  });

  it('fail-closed: an unverifiable re-fetch (getRequest throws) does not advance', async () => {
    const { proposta, getProposta, updateProposta } = makePropostas();
    const getRequest = vi.fn(async () => {
      throw new Error('not_connected');
    });
    const deps: ZohoWebhookDeps = { findAgreement: async () => zohoRef, getRequest, getProposta, updateProposta };

    const out = await handleZohoWebhook(zohoForgedPayload, deps);
    expect(out).toMatch(/getRequest failed/);
    expect(updateProposta).not.toHaveBeenCalled();
    expect(proposta.stage).toBe('Enviada');
  });

  it('replay idempotence: a real completion delivered TWICE advances exactly once', async () => {
    const { proposta, getProposta, updateProposta } = makePropostas();
    const getRequest = vi.fn(async () => zohoSignedRequest);
    const deps: ZohoWebhookDeps = { findAgreement: async () => zohoRef, getRequest, getProposta, updateProposta };

    const first = await handleZohoWebhook(zohoForgedPayload, deps);
    expect(first).toMatch(/advanced proposta prop-1/);
    expect(updateProposta).toHaveBeenCalledTimes(1);
    const patch = updateProposta.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch.stage).toBe('Assinada');
    expect(patch.conversionPending).toBe(true);
    expect((patch.eSignature as Record<string, unknown>).status).toBe('SIGNED');
    expect(proposta.stage).toBe('Assinada');

    // Second (replay) delivery — the guard on stage 'Assinada' makes it a no-op.
    const second = await handleZohoWebhook(zohoForgedPayload, deps);
    expect(second).toMatch(/already Assinada/);
    expect(updateProposta).toHaveBeenCalledTimes(1); // still exactly one advance
  });
});

describe('zohoClientSigned — the signature-state oracle', () => {
  it('true only when the whole request is completed OR the named client action is SIGNED', () => {
    expect(zohoClientSigned(zohoSignedRequest, CLIENT)).toBe(true);
    expect(zohoClientSigned(zohoUnsignedRequest, CLIENT)).toBe(false);
    expect(zohoClientSigned({ request_status: 'inprogress', actions: [{ recipient_email: CLIENT, action_status: 'SIGNED' }] }, CLIENT)).toBe(true);
    // A different signer's SIGNED action must not count for the client.
    expect(zohoClientSigned({ request_status: 'inprogress', actions: [{ recipient_email: 'other@bsm.pt', action_status: 'SIGNED' }] }, CLIENT)).toBe(false);
  });
});

// ============================================================================
// Adobe
// ============================================================================

const adobeRef: AdobeAgreementRef = { ownerUserId: 'owner-1', appId: 'app-1', propostaId: 'prop-1', clientEmail: CLIENT };
const adobeSignedAgreement = { id: 'ag-1', status: 'SIGNED' };
const adobeUnsignedAgreement = {
  id: 'ag-1',
  status: 'OUT_FOR_SIGNATURE',
  participantSetsInfo: [{ memberInfos: [{ email: CLIENT, status: 'WAITING_FOR_MY_SIGNATURE' }] }],
};
const adobeForgedPayload = { agreement: { id: 'ag-1' }, event: 'AGREEMENT_WORKFLOW_COMPLETED' };

describe('handleAdobeWebhook — never trusts the payload for signature state', () => {
  it('forged completion for an UNKNOWN agreement is a silent no-op', async () => {
    const { getProposta, updateProposta } = makePropostas();
    const getAgreement = vi.fn(async () => adobeSignedAgreement);
    const deps: AdobeWebhookDeps = { findAgreement: async () => null, getAgreement, getProposta, updateProposta };

    const out = await handleAdobeWebhook(adobeForgedPayload, deps);
    expect(out).toMatch(/unknown agreementId/);
    expect(getAgreement).not.toHaveBeenCalled();
    expect(updateProposta).not.toHaveBeenCalled();
  });

  it('forged completion whose OWNER-SCOPED re-fetch shows the client NOT signed does not advance', async () => {
    const { proposta, getProposta, updateProposta } = makePropostas();
    const getAgreement = vi.fn(async () => adobeUnsignedAgreement);
    const deps: AdobeWebhookDeps = { findAgreement: async () => adobeRef, getAgreement, getProposta, updateProposta };

    const out = await handleAdobeWebhook(adobeForgedPayload, deps);
    expect(getAgreement).toHaveBeenCalledWith('owner-1', 'ag-1');
    expect(out).toMatch(/not signed yet/);
    expect(updateProposta).not.toHaveBeenCalled();
    expect(proposta.stage).toBe('Enviada');
  });

  it('fail-closed: an unverifiable re-fetch (the notConnected backend throws) does not advance', async () => {
    const { proposta, getProposta, updateProposta } = makePropostas();
    const getAgreement = vi.fn(async () => {
      throw new Error('not_connected'); // exactly what notConnectedBackend.getAgreement raises
    });
    const deps: AdobeWebhookDeps = { findAgreement: async () => adobeRef, getAgreement, getProposta, updateProposta };

    const out = await handleAdobeWebhook(adobeForgedPayload, deps);
    expect(out).toMatch(/getAgreement failed/);
    expect(updateProposta).not.toHaveBeenCalled();
    expect(proposta.stage).toBe('Enviada');
  });

  it('replay idempotence: a real completion delivered TWICE advances exactly once', async () => {
    const { proposta, getProposta, updateProposta } = makePropostas();
    const getAgreement = vi.fn(async () => adobeSignedAgreement);
    const deps: AdobeWebhookDeps = { findAgreement: async () => adobeRef, getAgreement, getProposta, updateProposta };

    const first = await handleAdobeWebhook(adobeForgedPayload, deps);
    expect(first).toMatch(/advanced proposta prop-1/);
    expect(updateProposta).toHaveBeenCalledTimes(1);
    expect((updateProposta.mock.calls[0]![2] as Record<string, unknown>).stage).toBe('Assinada');
    expect(proposta.stage).toBe('Assinada');

    const second = await handleAdobeWebhook(adobeForgedPayload, deps);
    expect(second).toMatch(/already Assinada/);
    expect(updateProposta).toHaveBeenCalledTimes(1);
  });
});

describe('adobeClientSigned — the signature-state oracle', () => {
  it('true only when the agreement is signed OR the named client member is signed', () => {
    expect(adobeClientSigned(adobeSignedAgreement, CLIENT)).toBe(true);
    expect(adobeClientSigned(adobeUnsignedAgreement, CLIENT)).toBe(false);
    expect(
      adobeClientSigned({ status: 'OUT_FOR_SIGNATURE', participantSetsInfo: [{ memberInfos: [{ email: CLIENT, status: 'SIGNED' }] }] }, CLIENT),
    ).toBe(true);
  });
});
