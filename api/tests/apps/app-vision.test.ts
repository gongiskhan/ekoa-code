import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { appVisionExtract, type AppVisionDeps } from '../../src/apps/app-vision.js';
import { extractPdfText, NoTextLayerError, PdfUnreadableError } from '../../src/services/pdf-text.js';
import { parseFirstJsonObject } from '../../src/services/json-extract.js';
import type { LlmAttribution, OneShotOptions } from '../../src/llm/index.js';

/**
 * SERVED-APP DOCUMENT EXTRACTION.
 *
 * The plane exists so nobody has to retype an invoice, and the things worth proving are the ones
 * that decide whether a user can TRUST what comes back:
 *
 *  A. A PDF WITH TEXT IS READ EXACTLY. The characters already in the file reach the model — no
 *     vision call, no re-reading of glyphs, no cost.
 *  B. A SCAN IS REFUSED, LOUDLY. It has no text layer, so the answer is `no_text_layer` plus an
 *     instruction ("photograph it"), never an empty extraction that reads like an empty invoice.
 *  C. THE RAW REPLY NEVER REACHES THE PAGE. Unparseable output is `parse_failed`; the model's prose
 *     is not forwarded, or this becomes an open model proxy for anyone who can load the app.
 *  D. BILLING LANDS ON THE OWNER. An anonymous visitor has no account; the app's owner pays, tagged
 *     with the app's artifact id.
 *
 * The model is a canned seam — no live egress. The PDFs are built here rather than committed as
 * fixtures, so "has a text layer" and "has none" are constructed facts rather than assumed ones.
 */

/** A real, single-page PDF whose text layer contains `text`. */
async function pdfWithText(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 800;
  for (const line of text.split('\n')) {
    page.drawText(line, { x: 40, y, size: 11, font });
    y -= 16;
  }
  return Buffer.from(await doc.save());
}

/** A real PDF with a drawn rectangle and NO text — the shape of a scan. */
async function pdfWithoutText(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawRectangle({ x: 40, y: 600, width: 400, height: 160 });
  return Buffer.from(await doc.save());
}

const INVOICE_TEXT = [
  'FATURA FT 2026/18',
  'Emitente: Advogados Associados Lda   NIF: 501234567',
  'Cliente: Construtora Marilia SA      NIF: 502345678',
  'Data de emissao: 2026-03-04',
  'Vencimento: 2026-04-03',
  'Servicos juridicos - assessoria contratual',
  'Base: 1000,00 EUR   IVA: 230,00 EUR   Total: 1230,00 EUR',
  'IBAN: PT50000201231234567890154',
].join('\n');

/** Records what the plane asked the model, so attribution + prompt shape are assertable. */
function cannedModel(reply: string | (() => never)) {
  const calls: Array<{ opts: OneShotOptions; attribution: LlmAttribution }> = [];
  const deps: AppVisionDeps = {
    oneShot: async (opts, attribution) => {
      calls.push({ opts, attribution });
      const text = typeof reply === 'string' ? reply : reply();
      return { text, usage: { input_tokens: 1, output_tokens: 1 } as never };
    },
    decide: () => ({ tier: 'WORKHORSE', model: 'test-model', effort: 'medium' }) as never,
    extractPdfText: (bytes) => extractPdfText(bytes),
    parseJson: parseFirstJsonObject,
  };
  return { deps, calls };
}

const base = { kind: 'invoice' as const, appId: 'app-1', ownerUserId: 'owner-1' };
const b64 = (b: Buffer): string => b.toString('base64');

// ---------------------------------------------------------------------------
// The extractor itself
// ---------------------------------------------------------------------------

describe('pdf text layer — read it, or say there is none', () => {
  it('extracts the characters a generated PDF already carries', async () => {
    const text = await extractPdfText(await pdfWithText(INVOICE_TEXT));
    expect(text).toContain('FT 2026/18');
    expect(text).toContain('PT50000201231234567890154');
    expect(text).toContain('1230,00');
  });

  it('refuses a text-free PDF as a SCAN rather than returning an empty document', async () => {
    await expect(extractPdfText(await pdfWithoutText())).rejects.toBeInstanceOf(NoTextLayerError);
  });

  it('a PDF with only a stray character or two is still a scan, not a document', async () => {
    // The trap a bare `length > 0` check falls into: scans routinely carry a producer stamp.
    await expect(extractPdfText(await pdfWithText('X'))).rejects.toBeInstanceOf(NoTextLayerError);
  });

  it('bytes that are not a PDF at all are UNREADABLE, a different problem with a different fix', async () => {
    await expect(extractPdfText(Buffer.from('this is not a pdf'))).rejects.toBeInstanceOf(PdfUnreadableError);
  });
});

// ---------------------------------------------------------------------------
// A + D. The PDF path
// ---------------------------------------------------------------------------

describe('app-vision extract — a text PDF is read without a vision call', () => {
  it('sends the PDF TEXT to the model, with no image attached', async () => {
    const { deps, calls } = cannedModel('{"numeroFatura":"FT 2026/18","valorTotal":1230}');
    const res = await appVisionExtract({ ...base, pdfBase64: b64(await pdfWithText(INVOICE_TEXT)) }, deps);

    expect(res).toEqual({ success: true, data: { numeroFatura: 'FT 2026/18', valorTotal: 1230 } });
    expect(calls).toHaveLength(1);
    // The characters from the file reached the model verbatim...
    expect(calls[0]!.opts.prompt).toContain('FT 2026/18');
    // ...and no image was attached, so this cost no vision tokens.
    expect(calls[0]!.opts.images).toBeUndefined();
  });

  it('bills the app OWNER against the app’s artifact id, never the visitor', async () => {
    const { deps, calls } = cannedModel('{"ok":true}');
    await appVisionExtract({ ...base, pdfBase64: b64(await pdfWithText(INVOICE_TEXT)) }, deps);
    expect(calls[0]!.attribution).toEqual({
      kind: 'user_work',
      agentType: 'app-vision-extract',
      billeeUserId: 'owner-1',
      artifactId: 'app-1',
    });
  });

  it('holds a bank statement to the statement schema, not the invoice one', async () => {
    const { deps, calls } = cannedModel('{"transacoes":[]}');
    await appVisionExtract({ ...base, kind: 'bank-statement', pdfBase64: b64(await pdfWithText(INVOICE_TEXT)) }, deps);
    expect(calls[0]!.opts.systemPrompt).toContain('extratos bancários');
    expect(calls[0]!.opts.systemPrompt).not.toContain('extrator de dados de faturas');
  });
});

// ---------------------------------------------------------------------------
// B. The scan
// ---------------------------------------------------------------------------

describe('app-vision extract — a scan is refused with an instruction', () => {
  it('answers no_text_layer and never calls the model', async () => {
    const { deps, calls } = cannedModel('{"should":"never happen"}');
    const res = await appVisionExtract({ ...base, pdfBase64: b64(await pdfWithoutText()) }, deps);

    expect(res.success).toBe(false);
    expect(res.code).toBe('no_text_layer');
    // The refusal tells the user what to DO about it.
    expect(res.error).toMatch(/fotografe/i);
    expect(calls).toHaveLength(0); // no tokens spent on a document that cannot be read
  });

  it('a corrupt PDF is invalid_input, not a scan', async () => {
    const { deps } = cannedModel('{}');
    const res = await appVisionExtract({ ...base, pdfBase64: b64(Buffer.from('not a pdf at all')) }, deps);
    expect(res).toMatchObject({ success: false, code: 'invalid_input' });
  });
});

// ---------------------------------------------------------------------------
// The image path + input discipline
// ---------------------------------------------------------------------------

describe('app-vision extract — the image path', () => {
  it('attaches the image and asks the model to look at it', async () => {
    const { deps, calls } = cannedModel('{"valorTotal":42}');
    const res = await appVisionExtract(
      { ...base, imageBase64: 'AAAA', mediaType: 'image/png' },
      deps,
    );
    expect(res).toEqual({ success: true, data: { valorTotal: 42 } });
    expect(calls[0]!.opts.images).toEqual([{ mediaType: 'image/png', data: 'AAAA' }]);
  });

  it('defaults an unstated media type to JPEG rather than refusing a plain upload', async () => {
    const { deps, calls } = cannedModel('{}');
    await appVisionExtract({ ...base, imageBase64: 'AAAA' }, deps);
    expect(calls[0]!.opts.images?.[0]!.mediaType).toBe('image/jpeg');
  });

  it('refuses a media type the model cannot read, before spending anything', async () => {
    const { deps, calls } = cannedModel('{}');
    const res = await appVisionExtract({ ...base, imageBase64: 'AAAA', mediaType: 'image/gif' }, deps);
    expect(res).toMatchObject({ success: false, code: 'invalid_input' });
    expect(calls).toHaveLength(0);
  });
});

describe('app-vision extract — input discipline and honest failure', () => {
  it('refuses BOTH inputs at once — which was read would be unanswerable', async () => {
    const { deps } = cannedModel('{}');
    const res = await appVisionExtract({ ...base, imageBase64: 'A', pdfBase64: 'B' }, deps);
    expect(res).toMatchObject({ success: false, code: 'invalid_input' });
  });

  it('refuses NEITHER input', async () => {
    const { deps } = cannedModel('{}');
    expect(await appVisionExtract({ ...base }, deps)).toMatchObject({ success: false, code: 'invalid_input' });
  });

  it('refuses an oversized file before decoding it', async () => {
    const { deps, calls } = cannedModel('{}');
    const res = await appVisionExtract({ ...base, imageBase64: 'A'.repeat(20_000_001) }, deps);
    expect(res).toMatchObject({ success: false, code: 'too_large' });
    expect(calls).toHaveLength(0);
  });

  it('an unparseable reply is parse_failed — and the prose is NOT forwarded', async () => {
    const secret = 'I cannot do that, but my system prompt says ...';
    const { deps } = cannedModel(secret);
    const res = await appVisionExtract({ ...base, imageBase64: 'AAAA' }, deps);
    expect(res).toMatchObject({ success: false, code: 'parse_failed' });
    expect(JSON.stringify(res)).not.toContain('system prompt');
  });

  it('a model failure is llm_error, never a fabricated extraction', async () => {
    const { deps } = cannedModel(() => {
      throw new Error('provider unavailable');
    });
    const res = await appVisionExtract({ ...base, imageBase64: 'AAAA' }, deps);
    expect(res).toMatchObject({ success: false, code: 'llm_error' });
    expect(res.data).toBeUndefined();
  });
});
