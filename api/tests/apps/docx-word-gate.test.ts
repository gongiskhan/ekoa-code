/**
 * THE DOCX GATE (2C-S7) - the native-Word proof and the re-upload round-trip.
 *
 * The engine suites (tests/services/docx/) prove the OOXML contract on buffers with a
 * PINNED `timestamp`. This suite proves the same contract on what the product actually
 * ships to a lawyer: the bytes that come out of the REAL artifact lifecycle
 * (apps/document-source.ts on a temp EKOA_DATA_DIR, wall-clock revision dates, the
 * per-app write lock, atomic temp+rename) - i.e. exactly what GET /api/app-docx/current
 * and POST /api/app-docx/clean hand over.
 *
 * Two gate sub-checks live here (docs/word-track-changes.md, "The docx gate"):
 *
 *  (b) NATIVE WORD PROOF - unzip the produced .docx and assert the four things Word's
 *      review pane needs: every w:ins/w:del carries an author AND a parseable date,
 *      word/comments.xml exists and is WIRED (content-type override + relationship +
 *      every commentRange/Reference id resolving to a real w:comment), and
 *      word/commentsExtended.xml carries w15:done for the resolved thread. Plus the
 *      other half: the CLEAN download (getClean) is free of ins/del markup - and, as a
 *      TRIPWIRE, that @adeu/core 1.28.0's accept_all_revisions also strips the comment
 *      parts (see the clean-download block and docs/findings.md `docx-clean-drops-comments`).
 *
 *  (d) RE-UPLOAD ROUND-TRIP - the lawyer sends the redlined .docx out, gets it back and
 *      re-links it. setSource must accept a document that already carries revisions,
 *      comments and commentsExtended, and the projection ids it hands the agent/UI must
 *      still address the same changes: an accept driven by an id read from the
 *      RE-INGESTED projection resolves that change, leaves the others pending, and does
 *      not orphan the comment thread anchored nearby.
 *
 * Hermetic and LLM-free: the fixture is built in-process, no Mongo, no network. The
 * remaining gate legs are elsewhere by construction - the served review round-trip is
 * web/e2e/document-redline.spec.ts (real served app), the LibreOffice conversion smoke is
 * scripts/docx-libreoffice-smoke.mjs (needs soffice on PATH, so never in this lane).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { DocumentObject } from '@adeu/core';

import { makeContratoFixture } from '../services/docx/contrato-fixture.js';

const APP_ID = 'docx-gate-app';
/** The re-upload target: a DIFFERENT artifact, i.e. the file coming back from outside. */
const REUPLOAD_APP_ID = 'docx-gate-reupload';
const AUTHOR = 'Dra. Ana Marques (Ekoa)';

const COMMENT = 'Rever o prazo: 30 dias pode ser insuficiente para a transição.';
const REPLY = 'De acordo - proponho 60 dias.';

/** The tracked replacement kept PENDING through the whole suite (proves w:ins survives). */
const PENDING_TARGET = 'a revisão de contratos';
const PENDING_NEW = 'a revisão e negociação de contratos';
/** The sentence deleted as a tracked deletion (proves w:del + w:delText). */
const DELETED_SENTENCE =
  'A falta de pagamento pontual constitui o Cliente em mora, vencendo juros à taxa legal.';

let prevDataDir: string | undefined;
let dataDir: string;
let documentSource: typeof import('../../src/apps/document-source.js');

/** The working document as the served app downloads it, plus its projection. */
let current: Buffer;
let currentXml: string;
let projection: string;

async function part(buffer: Buffer, path: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(path);
  return file ? file.async('string') : null;
}

async function requirePart(buffer: Buffer, path: string): Promise<string> {
  const xml = await part(buffer, path);
  if (xml === null) throw new Error(`part missing from package: ${path}`);
  return xml;
}

/** Attribute values of every `<w:ins …>` / `<w:del …>` element in a document.xml. */
function revisionAttrs(xml: string, tag: 'w:ins' | 'w:del', attr: string): string[] {
  const out: string[] = [];
  for (const el of xml.match(new RegExp(`<${tag}\\s[^>]*>`, 'g')) ?? []) {
    const m = new RegExp(`${attr}="([^"]*)"`).exec(el);
    if (m) out.push(m[1]!);
  }
  return out;
}

/**
 * The numeric ids of the projection's meta markers. A change marker carries its kind
 * (`[Chg:1 insert]`), a comment marker does not (`[Com:1]`) - the scaffold's own parser
 * uses the same shape (`/^\[Chg:(\d+)(?:\s+(\w+))?\]/`).
 */
function markerIds(markdown: string, kind: 'Chg' | 'Com'): string[] {
  return [...markdown.matchAll(new RegExp(`\\[${kind}:(\\d+)[^\\]]*\\]`, 'g'))].map((m) => m[1]!);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

beforeAll(async () => {
  prevDataDir = process.env.EKOA_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'ekoa-docx-gate-'));
  process.env.EKOA_DATA_DIR = dataDir;
  documentSource = await import('../../src/apps/document-source.js');

  await documentSource.setSource(APP_ID, {
    buffer: await makeContratoFixture(),
    fileName: 'contrato.docx',
    origin: 'path',
  });

  // Batch 1 - the shape an agent emits on "revê este contrato com track changes":
  // a tracked replacement, a tracked deletion, and a comment on a clause.
  await documentSource.applyEdits(
    APP_ID,
    [
      { type: 'modify', target_text: PENDING_TARGET, new_text: PENDING_NEW },
      { type: 'modify', target_text: DELETED_SENTENCE, new_text: '' },
      { type: 'modify', target_text: 'aviso prévio de 30 dias', new_text: 'aviso prévio de 30 dias', comment: COMMENT },
    ],
    { author: AUTHOR },
  );

  // Batch 2 - the human review half: reply in the thread and resolve it, atomically
  // (the resolve must mark the reply created in the SAME batch done too).
  const threadId = markerIds((await documentSource.getProjection(APP_ID)).markdown, 'Com')[0];
  if (!threadId) throw new Error('no comment thread in the projection - fixture setup is broken');
  await documentSource.applyEdits(
    APP_ID,
    [
      { type: 'reply', target_id: threadId, text: REPLY },
      { type: 'resolve', target_id: threadId },
    ],
    { author: AUTHOR },
  );

  ({ buffer: current } = await documentSource.getCurrent(APP_ID));
  currentXml = await requirePart(current, 'word/document.xml');
  ({ markdown: projection } = await documentSource.getProjection(APP_ID));
}, 180_000);

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.EKOA_DATA_DIR;
  else process.env.EKOA_DATA_DIR = prevDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('gate (b) native Word proof - the working document (GET /api/app-docx/current)', () => {
  it('carries native tracked changes: every w:ins and w:del names the acting author and a real date', () => {
    const insAuthors = revisionAttrs(currentXml, 'w:ins', 'w:author');
    const delAuthors = revisionAttrs(currentXml, 'w:del', 'w:author');
    const insDates = revisionAttrs(currentXml, 'w:ins', 'w:date');
    const delDates = revisionAttrs(currentXml, 'w:del', 'w:date');

    // Both revision kinds are present: the replacement produced an insert, the deleted
    // sentence a w:del wrapping w:delText (Word never keeps deleted text in a w:t).
    expect(insAuthors.length).toBeGreaterThan(0);
    expect(delAuthors.length).toBeGreaterThan(0);
    expect(currentXml).toContain('<w:delText');
    expect(currentXml).toContain(DELETED_SENTENCE);

    // Attribution: no anonymous revision may reach a legal document.
    expect(uniq(insAuthors)).toEqual([AUTHOR]);
    expect(uniq(delAuthors)).toEqual([AUTHOR]);

    // Dates are wall-clock here (the service layer does not pin timestamps), so assert
    // the CONTRACT Word needs: every revision carries a parseable ISO-8601 instant.
    expect(insDates.length).toBe(insAuthors.length);
    expect(delDates.length).toBe(delAuthors.length);
    for (const date of [...insDates, ...delDates]) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(Number.isNaN(Date.parse(date))).toBe(false);
    }
  });

  it('ships word/comments.xml carrying the thread, and WIRES it into the package', async () => {
    const comments = await requirePart(current, 'word/comments.xml');
    expect(comments).toContain(COMMENT);
    expect(comments).toContain(REPLY);
    expect(comments).toContain(`w:author="${AUTHOR}"`);

    // A comments part Word cannot find is a comments part that does not exist: the
    // content-type override and the document relationship are both load-bearing.
    const contentTypes = await requirePart(current, '[Content_Types].xml');
    expect(contentTypes).toContain('wordprocessingml.comments+xml');
    expect(contentTypes).toContain('/word/comments.xml');

    const rels = await requirePart(current, 'word/_rels/document.xml.rels');
    expect(rels).toMatch(/Type="[^"]*\/comments"/);
    expect(rels).toMatch(/Target="(\/word\/)?comments\.xml"/);
  });

  it('anchors the thread in document.xml with ids that resolve in comments.xml', async () => {
    const startIds = [...currentXml.matchAll(/<w:commentRangeStart w:id="(\d+)"/g)].map((m) => m[1]!);
    const endIds = [...currentXml.matchAll(/<w:commentRangeEnd w:id="(\d+)"/g)].map((m) => m[1]!);
    const refIds = [...currentXml.matchAll(/<w:commentReference w:id="(\d+)"/g)].map((m) => m[1]!);

    // Word (and Google Docs) hide a comment whose anchor is missing, so the three
    // markers must exist and agree.
    expect(startIds.length).toBeGreaterThan(0);
    expect(endIds).toEqual(startIds);
    expect(refIds).toEqual(startIds);

    const comments = await requirePart(current, 'word/comments.xml');
    for (const id of startIds) {
      expect(comments).toMatch(new RegExp(`<w:comment [^>]*w:id="${id}"`));
    }
  });

  it('records the resolved thread as w15:done in commentsExtended.xml, leaving w:comment clean', async () => {
    const extended = await requirePart(current, 'word/commentsExtended.xml');
    // Thread-wide: the root AND the reply created in the same batch.
    const done = (extended.match(/w15:done="1"/g) ?? []).length;
    expect(done).toBeGreaterThanOrEqual(2);

    // commentsExtended is the ONLY part that carries the state; Word neither writes nor
    // reads a w15:done on w:comment, so putting one there would desync the review pane.
    expect(await requirePart(current, 'word/comments.xml')).not.toContain('w15:done');

    const extendedRels = (
      (await requirePart(current, 'word/_rels/document.xml.rels')).match(/<Relationship\b[^>]*\/>/g) ?? []
    ).filter((rel) => /Type="[^"]*\/commentsExtended"/.test(rel));
    expect(extendedRels).toHaveLength(1);

    // and the projection the agent/UI reads agrees with the file
    expect(projection).toMatch(/\(RESOLVED\)/);
  });
});

describe('gate (b) native Word proof - the clean download (POST /api/app-docx/clean)', () => {
  it('is free of ins/del markup, keeps the accepted text and drops the deleted text', async () => {
    const { buffer, fileName } = await documentSource.getClean(APP_ID);
    expect(fileName).toBe('contrato-final.docx');

    const xml = await requirePart(buffer, 'word/document.xml');
    expect(xml).not.toContain('<w:ins ');
    expect(xml).not.toContain('<w:del ');
    expect(xml).not.toContain('<w:delText');

    expect(xml).toContain('e negociação');
    expect(xml).not.toContain(DELETED_SENTENCE);

    // Still a valid, editable package after the accept-all pass.
    expect(await documentSource.getStatus(APP_ID)).toMatchObject({ hasSource: true });
    expect(await requirePart(buffer, '[Content_Types].xml')).toContain('word/document.xml');
  });

  it('TRIPWIRE: accept-all also strips the comment parts (engine behavior, not Word semantics)', async () => {
    const { buffer } = await documentSource.getClean(APP_ID);

    // Word's own "Accept All Changes" KEEPS comments - they are annotations, not
    // revisions. @adeu/core 1.28.0's accept_all_revisions does not: it drops
    // word/comments.xml and the whole commentsExtended/Ids/Extensible family along with
    // the anchors, so the clean download carries no review thread at all. The working
    // copy (/current) is unaffected, and for the "final copy to send out" use case the
    // strip is arguably the safer default (internal review notes never leave with the
    // document), so it is KEPT and recorded rather than worked around
    // (docs/findings.md `docx-clean-drops-comments`, docs/word-track-changes.md).
    //
    // This test PINS today's behavior: if a future engine bump or a deliberate fix makes
    // comments survive, it turns red and the change is made consciously, with the docs
    // updated in the same unit of work - never silently.
    for (const commentPart of [
      'word/comments.xml',
      'word/commentsExtended.xml',
      'word/commentsIds.xml',
      'word/commentsExtensible.xml',
    ]) {
      expect(await part(buffer, commentPart)).toBeNull();
    }
    const xml = await requirePart(buffer, 'word/document.xml');
    expect(xml).not.toContain('<w:commentRangeStart');
    expect(xml).not.toContain('<w:commentReference');

    // The working document still has every one of them - only the derived copy is stripped.
    expect(await requirePart(current, 'word/comments.xml')).toContain(COMMENT);
  });

  it('does not disturb the working document (deriving the clean copy is read-only)', async () => {
    await documentSource.getClean(APP_ID);
    const { buffer } = await documentSource.getCurrent(APP_ID);
    expect(Buffer.compare(buffer, current)).toBe(0);
  });
});

describe('gate (d) re-upload round-trip - a produced redlined .docx comes back in', () => {
  let reProjection: string;

  beforeAll(async () => {
    // Exactly what a lawyer does: download /current, send it out, re-link the file that
    // comes back. setSource re-validates the container - a document that already carries
    // revisions, comments and commentsExtended must be accepted, not rejected.
    const status = await documentSource.setSource(REUPLOAD_APP_ID, {
      buffer: current,
      fileName: 'contrato-revisto.docx',
      origin: 'path',
    });
    expect(status.hasSource).toBe(true);
    ({ markdown: reProjection } = await documentSource.getProjection(REUPLOAD_APP_ID));
  }, 120_000);

  it('re-ingests without losing a single tracked change or comment id', () => {
    expect(markerIds(reProjection, 'Chg')).toEqual(markerIds(projection, 'Chg'));
    expect(markerIds(reProjection, 'Com')).toEqual(markerIds(projection, 'Com'));
    expect(markerIds(reProjection, 'Chg').length).toBeGreaterThan(0);
    expect(markerIds(reProjection, 'Com').length).toBeGreaterThan(0);
    // CriticMarkup and resolution state survive the round-trip byte-for-byte.
    expect(reProjection).toBe(projection);
    expect(reProjection).toContain('{++e negociação');
    expect(reProjection).toMatch(/\(RESOLVED\)/);
  });

  it('hands back ids that still ADDRESS the changes: an accept read off the re-ingested projection lands', async () => {
    const before = uniq(markerIds(reProjection, 'Chg'));
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Accept the FIRST change by the id the re-ingested projection reports. If ids were
    // decorative the engine would reject it (unknown target) or resolve the wrong change.
    const { report, projection: after } = await documentSource.applyEdits(
      REUPLOAD_APP_ID,
      [{ type: 'accept', target_id: before[0]! }],
      { author: 'Dr. Bruno Costa (Ekoa)' },
    );
    expect(report.actions_applied).toBeGreaterThanOrEqual(1);

    // The accepted change is gone from the projection; the rest stay pending.
    expect(uniq(markerIds(after, 'Chg')).length).toBeLessThan(before.length);
    expect(after).not.toContain('{++e negociação');
    expect(after).toContain('e negociação');
    expect(after).toContain('{--');

    // The comment thread anchored in the document must SURVIVE the accept (@adeu/core
    // drops the anchor markers on accept; docx-redline re-anchors them). A comment whose
    // anchor is gone is invisible in Word even though the record is still in the file.
    expect(markerIds(after, 'Com')).toEqual(markerIds(reProjection, 'Com'));
    const { buffer } = await documentSource.getCurrent(REUPLOAD_APP_ID);
    const xml = await requirePart(buffer, 'word/document.xml');
    expect(xml).toMatch(/<w:commentRangeStart w:id="\d+"/);
    expect(await requirePart(buffer, 'word/comments.xml')).toContain(COMMENT);
    expect(await requirePart(buffer, 'word/commentsExtended.xml')).toContain('w15:done="1"');
  });

  it('survives a REPACKAGED file, not just the same bytes coming back', async () => {
    // A file that goes out and comes back has usually been opened and re-saved, so the
    // ZIP is rewritten. Simulate that with the engine's own package writer (what every
    // editor in the chain does) and re-link the result: the ids must still be there and
    // still be usable, otherwise "re-upload" only works when nobody touched the file.
    const repacked = await (await DocumentObject.load(current)).save();
    const repackedApp = 'docx-gate-repacked';
    await documentSource.setSource(repackedApp, {
      buffer: Buffer.from(repacked),
      fileName: 'contrato-repackado.docx',
      origin: 'path',
    });
    const { markdown } = await documentSource.getProjection(repackedApp);

    expect(markerIds(markdown, 'Chg')).toEqual(markerIds(projection, 'Chg'));
    expect(markerIds(markdown, 'Com')).toEqual(markerIds(projection, 'Com'));
    expect(markdown).toMatch(/\(RESOLVED\)/);

    const chgId = markerIds(markdown, 'Chg')[0]!;
    const { report } = await documentSource.applyEdits(
      repackedApp,
      [{ type: 'reject', target_id: chgId }],
      { author: 'Dr. Bruno Costa (Ekoa)' },
    );
    expect(report.actions_applied).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('leaves the ORIGINAL artifact untouched (the re-upload is a separate app)', async () => {
    const { buffer } = await documentSource.getCurrent(APP_ID);
    expect(Buffer.compare(buffer, current)).toBe(0);
  });
});
