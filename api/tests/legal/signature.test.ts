/**
 * Signature-provider facade + CMD stub. Ported from
 * cortex/tests/services/signature-provider.test.ts. Adapted harness: the Adobe
 * service is the injected `AdobeSignBackend` seam (a fake with vi.fn methods)
 * instead of vi.mock of a module — the facade must DELEGATE to it and never
 * reimplement it; the CMD stub is always not_available. Assertions carried.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSignatureProvider, CMD_UNAVAILABLE_MESSAGE, type AdobeSignBackend } from '../../src/integrations/adobe-sign.js';

function fakeBackend(): AdobeSignBackend {
  return {
    isConnected: vi.fn(async () => false),
    sendForSignature: vi.fn(async () => ({ agreementId: 'a', status: 'X', signingUrls: [] })),
    getAgreement: vi.fn(async () => ({})),
    getSigningUrls: vi.fn(async () => []),
    getCombinedDocument: vi.fn(async () => ({ bytes: Buffer.from(''), contentType: 'application/pdf' })),
  };
}

let backend: AdobeSignBackend;
beforeEach(() => {
  backend = fakeBackend();
});

describe('signature-provider · factory', () => {
  it('defaults to adobe-sign and falls back to it for an unknown key', () => {
    expect(getSignatureProvider('adobe-sign', backend).key).toBe('adobe-sign');
    expect(getSignatureProvider('cmd', backend).key).toBe('cmd');
    expect(getSignatureProvider('bogus-provider', backend).key).toBe('adobe-sign');
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
