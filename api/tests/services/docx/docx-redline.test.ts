/**
 * DOCX redline service tests.
 *
 * Exercises the full native-Word contract: w:ins/w:del track changes with
 * pinned author + date, comments.xml wiring, formatting preservation
 * (untouched paragraphs stay byte-identical), atomic batch rejection with
 * adeu's occurrence guidance, CriticMarkup projection, and container
 * validation. OOXML is inspected directly via jszip + string assertions.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DocumentObject } from '@adeu/core';
import {
  RedlineBatchError,
  type RedlineOp,
  type RedlineReport,
  acceptAllRevisions,
  applyRedline,
  projectDocx,
  validateDocx,
} from '../../../src/services/docx-redline.js';
import { makeContratoFixture } from './contrato-fixture.js';

const AUTHOR = 'Dra. Ana Marques';
const TIMESTAMP = '2026-07-22T09:00:00Z';
const COMMENT_TEXT = 'Rever prazo: 30 dias pode ser insuficiente para a transição.';

const OPS: RedlineOp[] = [
  // tracked replace inside CLAUSULA PRIMEIRA
  {
    type: 'modify',
    target_text: 'a revisão de contratos',
    new_text: 'a revisão e negociação de contratos',
  },
  // tracked delete of a full sentence (CLAUSULA TERCEIRA, 2nd clause)
  {
    type: 'modify',
    target_text:
      'A falta de pagamento pontual constitui o Cliente em mora, vencendo juros à taxa legal.',
    new_text: '',
  },
  // tracked insert of a whole new clause after CLAUSULA QUINTA: '# ' heading
  // line plus a PLAIN continuation line (clones the anchor pPr incl numbering;
  // never a '1.' markdown marker, which would map to pStyle ListNumber)
  {
    type: 'modify',
    target_text: 'as partes elegem o foro da comarca de Lisboa, com expressa renúncia a qualquer outro.',
    new_text:
      'as partes elegem o foro da comarca de Lisboa, com expressa renúncia a qualquer outro.\n' +
      '# CLÁUSULA SEXTA - Proteção de dados\n' +
      'As partes obrigam-se a tratar os dados pessoais a que tenham acesso em conformidade com o Regulamento (UE) 2016/679 (RGPD) e com a legislação nacional aplicável.',
  },
  // comment-only (new_text === target_text)
  {
    type: 'modify',
    target_text: 'aviso prévio de 30 dias',
    new_text: 'aviso prévio de 30 dias',
    comment: COMMENT_TEXT,
  },
];

async function zipText(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(path);
  if (!file) throw new Error(`part not found in package: ${path}`);
  return file.async('string');
}

async function zipHas(buffer: Buffer, path: string): Promise<boolean> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(path) !== null;
}

/**
 * Top-level w:p serializations of a document.xml string. The fixture has no
 * tables, so paragraphs never nest and a lazy regex is exact. `<w:p\b` does
 * not match `<w:pPr` (no word boundary between p and P).
 */
function paragraphsOf(documentXml: string): string[] {
  return documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
}

function textOf(paragraphXml: string): string {
  return paragraphXml.replace(/<[^>]+>/g, '');
}

function attrValues(xml: string, tag: 'w:ins' | 'w:del', attr: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\s[^>]*>`, 'g');
  for (const m of xml.match(re) ?? []) {
    const v = new RegExp(`${attr}="([^"]*)"`).exec(m);
    if (v) out.push(v[1]!);
  }
  return out;
}

/**
 * Re-serialize a buffer through adeu's own load + save so the original and
 * the edited output share one serializer; byte comparison of untouched
 * paragraphs is then exact instead of hostage to Packer-vs-xmldom formatting.
 */
async function normalize(buffer: Buffer): Promise<Buffer> {
  const doc = await DocumentObject.load(buffer);
  return doc.save();
}

let fixture: Buffer;
let result: Buffer;
let report: RedlineReport;
let resultXml: string;

beforeAll(async () => {
  fixture = await makeContratoFixture();
  const applied = await applyRedline(fixture, OPS, { author: AUTHOR, timestamp: TIMESTAMP });
  result = applied.buffer;
  report = applied.report;
  resultXml = await zipText(result, 'word/document.xml');
});

describe('applyRedline - native track changes', () => {
  it('applies the whole batch and reports every edit as applied', () => {
    expect(report.edits_applied).toBe(OPS.length);
    expect(report.edits_skipped).toBe(0);
    expect(report.edits.map((e) => e.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
  });

  it('produces w:ins and w:del elements, all attributed to the given author with the pinned timestamp', () => {
    const insAuthors = attrValues(resultXml, 'w:ins', 'w:author');
    const delAuthors = attrValues(resultXml, 'w:del', 'w:author');
    const insDates = attrValues(resultXml, 'w:ins', 'w:date');
    const delDates = attrValues(resultXml, 'w:del', 'w:date');

    expect(insAuthors.length).toBeGreaterThan(0);
    expect(delAuthors.length).toBeGreaterThan(0);
    expect(insAuthors.every((a) => a === AUTHOR)).toBe(true);
    expect(delAuthors.every((a) => a === AUTHOR)).toBe(true);
    expect(insDates.every((d) => d === TIMESTAMP)).toBe(true);
    expect(delDates.every((d) => d === TIMESTAMP)).toBe(true);
  });

  it('records the replacement as tracked insert and the removed sentence as w:delText', () => {
    // adeu applies the replacement as a minimal diff: only the added fragment
    // is wrapped in w:ins, the shared prefix/suffix stays untouched
    expect(resultXml).toMatch(/<w:ins [^>]*><w:r><w:t[^>]*>e negociação <\/w:t><\/w:r><\/w:ins>/);
    expect(resultXml).toMatch(/<w:del [^>]*><w:r><w:delText[^>]*>A falta de pagamento pontual[^<]*<\/w:delText><\/w:r><\/w:del>/);
  });

  it('inserts the new clause as a Heading1 paragraph plus a numbered continuation paragraph, both tracked', () => {
    const paragraphs = paragraphsOf(resultXml);
    const sexta = paragraphs.find((p) => p.includes('CLÁUSULA SEXTA - Proteção de dados'));
    const dados = paragraphs.find((p) => p.includes('dados pessoais'));

    expect(sexta).toBeDefined();
    expect(sexta).toMatch(/<w:pStyle w:val="Heading1"\s*\/>/);
    expect(sexta).toContain('<w:ins ');

    expect(dados).toBeDefined();
    expect(dados).toContain('<w:ins ');
    // plain continuation line clones the anchor pPr including its numbering
    expect(dados).toContain('<w:numPr>');
  });

  it('falls back to the Ekoa author only when the caller passes an empty author', async () => {
    const { buffer } = await applyRedline(
      fixture,
      [{ type: 'modify', target_text: 'aos 15 dias do mês de julho', new_text: 'aos 20 dias do mês de julho' }],
      { author: '   ', timestamp: TIMESTAMP },
    );
    const xml = await zipText(buffer, 'word/document.xml');
    const authors = attrValues(xml, 'w:ins', 'w:author');
    expect(authors.length).toBeGreaterThan(0);
    expect(authors.every((a) => a === 'Ekoa')).toBe(true);
  });
});

describe('applyRedline - native comments', () => {
  it('creates word/comments.xml with the comment text attributed to the author', async () => {
    const commentsXml = await zipText(result, 'word/comments.xml');
    expect(commentsXml).toContain(COMMENT_TEXT);
    expect(commentsXml).toContain(`w:author="${AUTHOR}"`);
  });

  it('registers the comments part in [Content_Types].xml and document.xml.rels', async () => {
    const contentTypes = await zipText(result, '[Content_Types].xml');
    expect(contentTypes).toContain('wordprocessingml.comments+xml');
    expect(contentTypes).toContain('/word/comments.xml');

    const rels = await zipText(result, 'word/_rels/document.xml.rels');
    expect(rels).toContain('relationships/comments');
    expect(rels).toMatch(/Target="(\/word\/)?comments\.xml"/);
  });

  it('anchors the comment with matching commentRangeStart/End/Reference ids resolving in comments.xml', async () => {
    const startIds = [...resultXml.matchAll(/<w:commentRangeStart w:id="(\d+)"/g)].map((m) => m[1]);
    const endIds = [...resultXml.matchAll(/<w:commentRangeEnd w:id="(\d+)"/g)].map((m) => m[1]);
    const refIds = [...resultXml.matchAll(/<w:commentReference w:id="(\d+)"/g)].map((m) => m[1]);

    expect(startIds.length).toBeGreaterThan(0);
    expect(endIds).toEqual(startIds);
    expect(refIds).toEqual(startIds);

    const commentsXml = await zipText(result, 'word/comments.xml');
    for (const id of startIds) {
      expect(commentsXml).toMatch(new RegExp(`<w:comment [^>]*w:id="${id}"`));
    }

    // the range wraps the commented phrase
    const paragraphs = paragraphsOf(resultXml);
    const commented = paragraphs.find((p) => p.includes('<w:commentRangeStart'));
    expect(commented).toBeDefined();
    expect(textOf(commented!)).toContain('aviso prévio de 30 dias');
  });
});

describe('applyRedline - formatting preservation', () => {
  it('keeps every unedited paragraph byte-identical', async () => {
    const normalizedOrig = await normalize(fixture);
    const origParagraphs = paragraphsOf(await zipText(normalizedOrig, 'word/document.xml'));
    const resultParagraphs = paragraphsOf(resultXml);

    // paragraphs the batch legitimately touches (by content marker)
    const editedMarkers = [
      'revisão de contratos', // replace
      'faturadas separadamente', // sentence delete lives in this paragraph
      'renúncia a qualquer outro', // insert anchor
      'aviso prévio', // comment range markers
    ];

    const untouched = origParagraphs.filter(
      (p) => !editedMarkers.some((m) => textOf(p).includes(m)),
    );
    expect(untouched.length).toBeGreaterThanOrEqual(10);
    for (const p of untouched) {
      expect(resultParagraphs).toContain(p);
    }

    // and nothing outside the edited set changed
    const changed = origParagraphs.filter((p) => !resultParagraphs.includes(p));
    for (const p of changed) {
      expect(editedMarkers.some((m) => textOf(p).includes(m))).toBe(true);
    }
  });

  it('leaves styles.xml and numbering.xml byte-identical', async () => {
    const normalizedOrig = await normalize(fixture);
    for (const part of ['word/styles.xml', 'word/numbering.xml']) {
      expect(await zipText(result, part)).toBe(await zipText(normalizedOrig, part));
    }
  });
});

describe('acceptAllRevisions', () => {
  it('yields a revision-free document containing the new text and not the deleted text', async () => {
    const clean = await acceptAllRevisions(result);
    const xml = await zipText(clean, 'word/document.xml');

    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
    expect(xml).not.toContain('<w:delText');

    expect(xml).toContain('e negociação ');
    expect(xml).toContain('CLÁUSULA SEXTA - Proteção de dados');
    expect(xml).not.toContain('A falta de pagamento pontual');
  });
});

describe('applyRedline - atomic batch rejection', () => {
  it('rejects an ambiguous strict target with occurrence guidance and applies nothing', async () => {
    const before = Buffer.from(fixture);
    const ops: RedlineOp[] = [
      // 'presente contrato' appears many times -> ambiguous under strict
      { type: 'modify', target_text: 'presente contrato', new_text: 'contrato' },
      // valid op that must NOT be applied because the batch is atomic
      { type: 'modify', target_text: 'a revisão de contratos', new_text: 'a revisão e negociação de contratos' },
    ];

    let error: unknown;
    try {
      await applyRedline(fixture, ops, { author: AUTHOR, timestamp: TIMESTAMP });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(RedlineBatchError);
    const batchError = error as RedlineBatchError;
    expect(batchError.failures.length).toBeGreaterThan(0);

    const ambiguous = batchError.failures.find((f) => f.index === 0);
    expect(ambiguous).toBeDefined();
    expect(ambiguous!.op).toEqual(ops[0]);
    // adeu's guidance verbatim: occurrence list + match_mode strategies
    expect(ambiguous!.error).toContain('Ambiguous match');
    expect(ambiguous!.error).toMatch(/appears \d+ times/);
    expect(ambiguous!.error).toContain('match_mode');
    expect(ambiguous!.error).toContain('1.');

    // input buffer untouched
    expect(Buffer.compare(fixture, before)).toBe(0);
  });

  it('rejects a missing target and an empty batch', async () => {
    await expect(
      applyRedline(
        fixture,
        [{ type: 'modify', target_text: 'texto que não existe no contrato', new_text: 'x' }],
        { author: AUTHOR },
      ),
    ).rejects.toThrow(RedlineBatchError);

    await expect(applyRedline(fixture, [], { author: AUTHOR })).rejects.toThrow(RedlineBatchError);
  });

  it('rejects review actions naming unknown target ids without modifying anything', async () => {
    let error: unknown;
    try {
      await applyRedline(result, [{ type: 'accept', target_id: '999' }], { author: AUTHOR });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(RedlineBatchError);
    const failures = (error as RedlineBatchError).failures;
    expect(failures.some((f) => f.error.includes('999'))).toBe(true);
  });
});

describe('projectDocx', () => {
  it('projects a clean document without change markers', async () => {
    const md = await projectDocx(fixture);
    expect(md).toContain('CLÁUSULA PRIMEIRA - Objeto');
    expect(md).toContain('aviso prévio de 30 dias');
    expect(md).not.toContain('[Chg:');
  });

  it('shows Chg markers, CriticMarkup and comment annotations for a document with revisions', async () => {
    const md = await projectDocx(result);
    expect(md).toContain('[Chg:');
    expect(md).toContain(`{++e negociação ++}`);
    expect(md).toContain('{--');
    expect(md).toContain('[Com:');
    expect(md).toContain(COMMENT_TEXT);
    expect(md).toContain(AUTHOR);
    expect(md).toContain('CLÁUSULA SEXTA - Proteção de dados');
  });
});

describe('validateDocx', () => {
  it('passes on the fixture and on redlined output', async () => {
    expect(await validateDocx(fixture)).toEqual({ ok: true, issues: [] });
    expect(await validateDocx(result)).toEqual({ ok: true, issues: [] });
  });

  it('fails on garbage bytes and on an empty buffer', async () => {
    const garbage = await validateDocx(Buffer.from('isto não é um docx, é lixo'));
    expect(garbage.ok).toBe(false);
    expect(garbage.issues.length).toBeGreaterThan(0);
    expect(garbage.issues[0]).toContain('ZIP');

    const empty = await validateDocx(Buffer.alloc(0));
    expect(empty.ok).toBe(false);
    expect(empty.issues).toEqual(['empty buffer']);
  });

  it('fails on a ZIP that is not a DOCX package', async () => {
    const zip = new JSZip();
    zip.file('ola.txt', 'olá');
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    const verdict = await validateDocx(buffer);
    expect(verdict.ok).toBe(false);
    expect(verdict.issues.join(' ')).toContain('word/document.xml');
  });

  it('fails on a package whose document.xml is malformed', async () => {
    const zip = await JSZip.loadAsync(fixture);
    zip.file('word/document.xml', '<w:document><w:body><w:p>truncado');
    const buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    const verdict = await validateDocx(buffer);
    expect(verdict.ok).toBe(false);
    expect(verdict.issues.length).toBeGreaterThan(0);
  });
});

describe('round-trip sanity', () => {
  it('output survives zip inspection with all core parts present', async () => {
    for (const part of [
      '[Content_Types].xml',
      'word/document.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/comments.xml',
    ]) {
      expect(await zipHas(result, part)).toBe(true);
    }
  });
});
