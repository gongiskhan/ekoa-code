/**
 * tools/extract-text.ts — the `extract_text` tool (§18 Phase 3): pull the plain text out of a .docx
 * or .pdf within a grant, so a delegated task can reason over a document's text without the raw file
 * ever leaving the machine as a file. OCR is explicitly out of scope (image-only PDFs yield whatever
 * embedded text they have, which may be empty — never an image pass).
 *
 * EGRESS SEMANTICS (per the plan): the raw document bytes are read LOCALLY and never metered — only
 * the EXTRACTED TEXT crosses Boundary 1, so `emit` meters/ledgers the extracted-text bytes (tool =
 * 'extract_text'), capped like any emission. An unsupported extension, or a library that fails to
 * parse the file, is a LEDGERED S1 ToolError (never a raw crash) — consistent with the other tools.
 */
import { readFileSync } from 'node:fs';
import mammoth from 'mammoth';
import { emit, fsGuard, resolveInGrant, denyAndThrow, type ToolContext } from './types.js';

export interface ExtractTextResult {
  text: string;
  bytesOut: number;
}

/** Extract the plain text of a .docx / .pdf within a grant, metered as egress on the extracted text. */
export async function extractText(ctx: ToolContext, grantRef: string, relPath: string): Promise<ExtractTextResult> {
  const { real, ledgerPath } = resolveInGrant(ctx, grantRef, relPath, 'extract_text');
  // Read the raw document LOCALLY (a missing/unreadable path → a ledgered S1 ToolError, not a crash).
  const buf = fsGuard(ctx, 'extract_text', () => readFileSync(real));

  const lower = real.toLowerCase();
  let text: string;
  if (lower.endsWith('.docx')) {
    text = await extractDocx(ctx, buf);
  } else if (lower.endsWith('.pdf')) {
    text = await extractPdf(ctx, buf);
  } else {
    denyAndThrow(ctx, 'unsupported file type for extract_text (only .docx and .pdf)', 'S1', 'extract_text');
  }

  const payload = Buffer.from(text, 'utf8');
  const { bytesOut } = emit(ctx, 'extract_text', ledgerPath, `0-${payload.length}`, payload);
  return { text, bytesOut };
}

async function extractDocx(ctx: ToolContext, buf: Buffer): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  } catch {
    denyAndThrow(ctx, 'text extraction failed (docx)', 'S1', 'extract_text');
  }
}

async function extractPdf(ctx: ToolContext, buf: Buffer): Promise<string> {
  try {
    // pdfjs legacy build runs in Node without a browser worker. We only read text; no fonts/canvas.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = getDocument({ data: new Uint8Array(buf), useSystemFonts: true });
    try {
      const doc = await loadingTask.promise;
      const parts: string[] = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
      }
      return parts.join('\n');
    } finally {
      await loadingTask.destroy();
    }
  } catch {
    denyAndThrow(ctx, 'text extraction failed (pdf)', 'S1', 'extract_text');
  }
}
