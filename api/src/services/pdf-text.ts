/**
 * PDF TEXT-LAYER extraction — pull the characters a PDF already carries, and say so plainly when
 * it carries none.
 *
 * A PDF is two different things wearing one extension. A generated one (an invoice from billing
 * software, a bank statement from a portal) embeds its text and can be read exactly, for free, with
 * no model involved. A scanned one is a picture of paper: it has no text at all, and the only way
 * to read it is to look at it.
 *
 * This module does the first and REFUSES the second — `NoTextLayerError`, never a guess and never
 * an empty string that reads like an empty document. The caller (`apps/app-vision.ts`) turns that
 * refusal into an instruction the user can act on: photograph the document and send it as an image,
 * which routes to vision instead. Silently returning nothing here would surface downstream as "the
 * invoice had no fields", which is the worst possible answer: wrong, confident, and unactionable.
 *
 * There is deliberately NO OCR fallback. Upstream's `officeparser` (v7) bundles tesseract.js, which
 * pulls a WASM engine and fetches trained language data at runtime — a second egress path in a repo
 * whose whole model story is one chokepoint. Vision-on-an-image already covers scanned documents,
 * costs a model call the user consented to, and needs no such machinery.
 *
 * pdfjs is loaded through its LEGACY build: the default entry assumes browser globals
 * (DOMMatrix, Path2D) that a Node process does not have.
 */

import { createRequire } from 'node:module';

/** The PDF parsed, and it has no readable text layer — it is a scan. */
export class NoTextLayerError extends Error {
  constructor(message = 'PDF has no searchable text layer') {
    super(message);
    this.name = 'NoTextLayerError';
  }
}

/** The bytes are not a PDF this parser can open at all (truncated, encrypted, not a PDF). */
export class PdfUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfUnreadableError';
  }
}

/**
 * Below this many characters we treat the document as having no text layer. A scanned PDF is
 * rarely EMPTY — it usually carries a few stray characters from a header stamp or a producer
 * watermark — so a bare `length > 0` check would let scans through as "text" and hand the model a
 * dozen meaningless characters to hallucinate an invoice from.
 */
const MIN_MEANINGFUL_CHARS = 40;

export interface PdfTextOptions {
  /** Stop after this many pages. Statements run long, and the prompt is capped anyway. */
  maxPages?: number;
}

/**
 * Extract the text layer of a PDF, page by page, in reading order as the producer laid it out.
 *
 * Throws `PdfUnreadableError` when the file cannot be opened and `NoTextLayerError` when it opens
 * but carries no meaningful text. Both are distinct on purpose: the first is a broken upload, the
 * second is a scan, and the user needs to be told different things.
 */
/**
 * Where pdfjs's bundled Type1 metrics live, resolved off the installed package rather than a path
 * guess. Without it every parse of a document using a standard font logs
 * `UnknownErrorException: Ensure that the standardFontDataUrl API parameter is provided` — the text
 * still comes out, but the warning is emitted per document and would be permanent noise in the API
 * log. Resolved once, lazily, and never fatal: if the layout ever changes, extraction keeps working
 * exactly as it does today and only the warning returns.
 */
let standardFontDataUrl: string | undefined;
function resolveStandardFontDir(): string | undefined {
  if (standardFontDataUrl !== undefined) return standardFontDataUrl || undefined;
  try {
    // `createRequire` and not a bare `require`: this package is `"type": "module"`, so `require`
    // does not exist at runtime — it only appears to work under a test transform.
    const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
    standardFontDataUrl = `${pkg.slice(0, pkg.lastIndexOf('/'))}/standard_fonts/`;
  } catch {
    standardFontDataUrl = ''; // resolved-and-absent, so the lookup is not retried per document
  }
  return standardFontDataUrl || undefined;
}

export async function extractPdfText(bytes: Buffer, opts: PdfTextOptions = {}): Promise<string> {
  // Imported lazily so a process that never parses a PDF does not pay pdfjs's module init.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({
      // pdfjs takes ownership of the buffer, so hand it a copy — the caller's Buffer may be a view
      // onto a pooled allocation, and a detached ArrayBuffer surfaces much later as a corrupt read.
      data: new Uint8Array(bytes),
      // No network, no eval, no system fonts: this parse reads characters and nothing else. The
      // standard-font metrics are read from disk, not fetched.
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      standardFontDataUrl: resolveStandardFontDir(),
    }).promise;
  } catch (err) {
    throw new PdfUnreadableError(err instanceof Error ? err.message : String(err));
  }

  try {
    const pageCount = Math.min(doc.numPages, opts.maxPages ?? doc.numPages);
    const pages: string[] = [];
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      // Each item is a positioned run. Joining with spaces and letting `hasEOL` break lines keeps
      // table rows on one line, which is what makes a bank statement's columns readable at all.
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        const it = item as { str?: string; hasEOL?: boolean };
        if (typeof it.str !== 'string') continue;
        line += it.str;
        if (it.hasEOL) {
          lines.push(line.trim());
          line = '';
        }
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(lines.filter(Boolean).join('\n'));
      page.cleanup();
    }
    const text = pages.join('\n\n').trim();
    if (text.length < MIN_MEANINGFUL_CHARS) throw new NoTextLayerError();
    return text;
  } finally {
    await doc.destroy();
  }
}
