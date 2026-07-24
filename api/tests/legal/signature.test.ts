/**
 * Signature-provider facade + CMD stub + Zoho swap (2B-S4). Ported from
 * cortex/tests/services/signature-provider.test.ts. Adapted harness: each provider's
 * service is an injected backend seam (a fake with vi.fn methods) instead of vi.mock of a
 * module — the facade must DELEGATE to it and never reimplement it; the CMD stub is always
 * not_available. 2B-S4 adds the Zoho branch: `getSignatureProvider('zoho-sign', {adobe,zoho})`
 * routes to the live Zoho backend (requestId->agreementId; email-only signers dropped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSignatureProvider, CMD_UNAVAILABLE_MESSAGE, type AdobeSignBackend } from '../../src/integrations/adobe-sign.js';
import type { ZohoSignBackend } from '../../src/integrations/zoho-sign.js';

function fakeBackend(): AdobeSignBackend {
  return {
    isConnected: vi.fn(async () => false),
    sendForSignature: vi.fn(async () => ({ agreementId: 'a', status: 'X', signingUrls: [] })),
    getAgreement: vi.fn(async () => ({})),
    getSigningUrls: vi.fn(async () => []),
    getCombinedDocument: vi.fn(async () => ({ bytes: Buffer.from(''), contentType: 'application/pdf' })),
  };
}

function fakeZohoBackend(): ZohoSignBackend {
  return {
    isConnected: vi.fn(async () => false),
    sendForSignature: vi.fn(async () => ({ success: true, requestId: 'r', status: 'draft', signingUrls: [] })),
    getRequest: vi.fn(async () => ({})),
    getSignUrl: vi.fn(async () => null),
    getDocument: vi.fn(async () => ({ bytes: Buffer.from(''), contentType: 'application/pdf' })),
  };
}

let backend: AdobeSignBackend;
let zoho: ZohoSignBackend;
beforeEach(() => {
  backend = fakeBackend();
  zoho = fakeZohoBackend();
});

describe('signature-provider · factory', () => {
  it('routes by key: zoho-sign -> zoho, cmd -> cmd, adobe/default/unknown -> adobe', () => {
    expect(getSignatureProvider('zoho-sign', { adobe: backend, zoho }).key).toBe('zoho-sign');
    expect(getSignatureProvider('cmd', { adobe: backend, zoho }).key).toBe('cmd');
    expect(getSignatureProvider('adobe', { adobe: backend, zoho }).key).toBe('adobe-sign');
    expect(getSignatureProvider('adobe-sign', { adobe: backend, zoho }).key).toBe('adobe-sign');
    expect(getSignatureProvider('bogus-provider', { adobe: backend, zoho }).key).toBe('adobe-sign');
  });

  it('is backwards-tolerant: a raw AdobeSignBackend still resolves adobe/cmd branches', () => {
    expect(getSignatureProvider('adobe-sign', backend).key).toBe('adobe-sign');
    expect(getSignatureProvider('cmd', backend).key).toBe('cmd');
  });

  it('zoho-sign WITHOUT a wired zoho backend -> a not-connected zoho provider (never throws)', async () => {
    const p = getSignatureProvider('zoho-sign', { adobe: backend });
    expect(p.key).toBe('zoho-sign');
    expect(await p.isAvailable('user-1')).toBe(false);
    const send = await p.send({ title: 'Doc', recipients: [{ email: 'a@b.pt' }] });
    expect(send).toMatchObject({ ok: false, provider: 'zoho-sign', code: 'not_connected' });
    // The Adobe backend must never be touched for the zoho branch.
    expect(backend.sendForSignature).not.toHaveBeenCalled();
  });
});

describe('signature-provider · adobe-sign delegation', () => {
  it('isAvailable delegates to backend.isConnected(ownerUserId)', async () => {
    (backend.isConnected as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const available = await getSignatureProvider('adobe-sign', backend).isAvailable('user-1');
    expect(available).toBe(true);
    expect(backend.isConnected).toHaveBeenCalledWith('user-1');
  });

  it('send maps the credential-free input onto sendForSignature args', async () => {
    (backend.sendForSignature as ReturnType<typeof vi.fn>).mockResolvedValue({
      agreementId: 'agr-123',
      status: 'OUT_FOR_SIGNATURE',
      signingUrls: [{ email: 'cliente@exemplo.pt', esignUrl: 'https://sign.example/abc' }],
    });

    const result = await getSignatureProvider('adobe-sign', backend).send({
      ownerUserId: 'user-1',
      title: 'Proposta de Honorários',
      documentHtml: '<h1>Proposta</h1>',
      recipients: [{ email: 'cliente@exemplo.pt', name: 'Cliente' }],
    });

    expect(backend.sendForSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
        documentName: 'Proposta de Honorários',
        html: '<h1>Proposta</h1>',
        recipients: [{ email: 'cliente@exemplo.pt', name: 'Cliente' }],
      }),
    );
    expect(result).toMatchObject({ ok: true, provider: 'adobe-sign', agreementId: 'agr-123', status: 'OUT_FOR_SIGNATURE' });
    expect(result.signingUrls).toHaveLength(1);
  });

  it('send forwards a base64 PDF as pdfBase64', async () => {
    await getSignatureProvider('adobe-sign', backend).send({
      ownerUserId: 'user-1',
      title: 'Doc',
      documentPdfBase64: 'JVBERi0x',
      recipients: [{ email: 'a@b.pt' }],
    });
    expect(backend.sendForSignature).toHaveBeenCalledWith(expect.objectContaining({ pdfBase64: 'JVBERi0x', documentName: 'Doc' }));
  });

  it('surfaces a not_connected error as a sanitized result (no throw)', async () => {
    (backend.sendForSignature as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('Adobe Acrobat Sign is not connected for this workspace.'), { code: 'not_connected' }),
    );
    const result = await getSignatureProvider('adobe-sign', backend).send({ title: 'Doc', recipients: [{ email: 'a@b.pt' }] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_connected');
    expect(result.error).toMatch(/not connected/i);
  });
});

describe('signature-provider · zoho-sign delegation (2B-S4 swap)', () => {
  it('isAvailable delegates to the zoho backend.isConnected(ownerUserId)', async () => {
    (zoho.isConnected as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const available = await getSignatureProvider('zoho-sign', { adobe: backend, zoho }).isAvailable('user-1');
    expect(available).toBe(true);
    expect(zoho.isConnected).toHaveBeenCalledWith('user-1');
    // The adobe backend is never consulted for the zoho branch.
    expect(backend.isConnected).not.toHaveBeenCalled();
  });

  it('send maps title/html onto the zoho backend, requestId -> agreementId, and drops email-only signers', async () => {
    (zoho.sendForSignature as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      requestId: 'req-777',
      status: 'inprogress',
      signingUrls: [
        { email: 'cliente@exemplo.pt', signUrl: 'https://sign.zoho.eu/portal/abc?locale=pt' },
        { email: 'socio@bsm.pt', signUrl: null },
      ],
    });

    const result = await getSignatureProvider('zoho-sign', { adobe: backend, zoho }).send({
      ownerUserId: 'user-1',
      title: 'Proposta de Honorários',
      documentHtml: '<h1>Proposta</h1>',
      recipients: [{ email: 'cliente@exemplo.pt', name: 'Cliente' }],
    });

    expect(zoho.sendForSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
        documentName: 'Proposta de Honorários',
        html: '<h1>Proposta</h1>',
        recipients: [{ email: 'cliente@exemplo.pt', name: 'Cliente' }],
      }),
    );
    expect(result).toMatchObject({ ok: true, provider: 'zoho-sign', agreementId: 'req-777', status: 'inprogress' });
    // Only the embedded signer (non-null signUrl) survives, mapped signUrl -> esignUrl.
    expect(result.signingUrls).toEqual([{ email: 'cliente@exemplo.pt', esignUrl: 'https://sign.zoho.eu/portal/abc?locale=pt' }]);
  });

  it('surfaces a not_connected error from the zoho backend as a sanitized result (no throw)', async () => {
    (zoho.sendForSignature as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('Zoho Sign is not connected for this workspace.'), { code: 'not_connected' }),
    );
    const result = await getSignatureProvider('zoho-sign', { adobe: backend, zoho }).send({ title: 'Doc', recipients: [{ email: 'a@b.pt' }] });
    expect(result.ok).toBe(false);
    expect(result.provider).toBe('zoho-sign');
    expect(result.code).toBe('not_connected');
    expect(result.error).toMatch(/not connected/i);
  });
});

describe('signature-provider · cmd stub (not available)', () => {
  it('isAvailable is always false and send returns the not_available PT-PT contract', async () => {
    const cmd = getSignatureProvider('cmd', backend);
    expect(await cmd.isAvailable('user-1')).toBe(false);
    const send = await cmd.send({ title: 'Doc', recipients: [{ email: 'a@b.pt' }] });
    expect(send.ok).toBe(false);
    expect(send.provider).toBe('cmd');
    expect(send.code).toBe('not_available');
    expect(send.error).toBe(CMD_UNAVAILABLE_MESSAGE);
    // The Adobe backend must never be touched for the CMD provider.
    expect(backend.sendForSignature).not.toHaveBeenCalled();
  });
});
