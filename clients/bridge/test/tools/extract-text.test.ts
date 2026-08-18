import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractText } from '../../src/tools/extract-text.js';
import { ToolError } from '../../src/tools/index.js';
import { makeHarness, GRANT, type Harness } from './harness.js';

/**
 * extract_text over real synthetic .docx (built with jszip — a docx is an OOXML zip) and a minimal
 * PDF. The EXTRACTED TEXT is metered as egress + ledgered (tool='extract_text'); unsupported types
 * and parse failures are ledgered S1 ToolErrors, never crashes. No OCR.
 */
let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.cleanup());

/** Build a minimal valid .docx (OOXML zip) whose body is a single paragraph of `text`. */
async function makeDocx(text: string): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.folder('_rels')!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.folder('word')!.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A minimal single-page PDF whose content stream draws `text`. pdfjs recovers via object indexing. */
function makePdf(text: string): Buffer {
  const content = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  return Buffer.from(`%PDF-1.4\n${objs.join('\n')}\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF`, 'latin1');
}

function writeFixture(relPath: string, buf: Buffer): void {
  writeFileSync(join(h.grantRoot, relPath), buf);
}

describe('extract_text — docx', () => {
  it('extracts the text of a .docx, meters + ledgers it as an extract_text egress row', async () => {
    writeFixture('contrato.docx', await makeDocx('Secção 3.1: indemnizações limitadas a 12 meses.'));
    const r = await extractText(h.ctx(), GRANT, 'contrato.docx');
    expect(r.text).toContain('indemnizações limitadas a 12 meses');
    expect(r.bytesOut).toBeGreaterThan(0);
    const row = h.rows().find((x) => x.kind === 'read' && x.tool === 'extract_text');
    expect(row).toBeDefined();
    // The ledger path is grant-relative, never absolute.
    expect(row && 'path' in row ? row.path : '').toBe('contrato.docx');
  });
});

describe('extract_text — pdf', () => {
  it('extracts the text of a .pdf', async () => {
    writeFixture('doc.pdf', makePdf('Hello PDF World'));
    const r = await extractText(h.ctx(), GRANT, 'doc.pdf');
    expect(r.text).toContain('Hello PDF World');
  });
});

describe('extract_text — failure paths are ledgered denials, not crashes', () => {
  it('an unsupported extension → ToolError(S1) + ledgered denial', async () => {
    writeFixture('notes.txt', Buffer.from('plain text'));
    await expect(extractText(h.ctx(), GRANT, 'notes.txt')).rejects.toBeInstanceOf(ToolError);
    expect(h.denials().at(-1)?.reason).toMatch(/unsupported file type/);
  });

  it('a corrupt .docx → ToolError(S1) + ledgered denial (no crash)', async () => {
    writeFixture('broken.docx', Buffer.from('not a real zip'));
    await expect(extractText(h.ctx(), GRANT, 'broken.docx')).rejects.toBeInstanceOf(ToolError);
    expect(h.denials().at(-1)?.reason).toMatch(/extraction failed/);
  });

  it('a missing file → ToolError(S1) + ledgered denial', async () => {
    await expect(extractText(h.ctx(), GRANT, 'nope.pdf')).rejects.toBeInstanceOf(ToolError);
    expect(h.denials().at(-1)?.principle).toBe('S1');
  });

  it('an out-of-grant path → denied (containment)', async () => {
    await expect(extractText(h.ctx(), GRANT, '../escape.docx')).rejects.toBeInstanceOf(ToolError);
    expect(h.denials().at(-1)?.principle).toBe('S1');
  });
});
