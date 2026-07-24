/**
 * Word comment RESOLUTION tests (w15:done in word/commentsExtended.xml).
 *
 * @adeu/core has no `resolve` action, so cortex writes the flag itself
 * (services/docx-comments.ts) inside the same atomic batch as adeu's ops.
 * These tests pin the Word contract - thread-wide flip, the exact OOXML that
 * carries it, and the package-level traps that corrupt a .docx silently
 * (duplicate relationships, a second commentsExtended part, a spurious
 * commentEx for a multi-paragraph comment).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DocumentObject } from '@adeu/core';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import {
  RedlineBatchError,
  applyRedline,
  projectDocx,
} from '../../../src/services/docx-redline.js';
import { makeContratoFixture } from './contrato-fixture.js';

const ANCHOR = 'Confidencialidade';

/** Fixture with a two-message comment thread: [Com:1] root, [Com:2] reply. */
let threaded: Buffer;

beforeAll(async () => {
  const base = await makeContratoFixture();
  const withComment = await applyRedline(
    base,
    [{ type: 'modify', target_text: ANCHOR, new_text: ANCHOR, comment: 'Rever o prazo.' }],
    { author: 'Dra. Ana Marques' },
  );
  const withReply = await applyRedline(
    withComment.buffer,
    [{ type: 'reply', target_id: '1', text: 'Reduzido para três anos.' }],
    { author: 'Dr. Bruno Costa' },
  );
  threaded = withReply.buffer;
}, 60_000);

async function commentsExtendedXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/commentsExtended.xml');
  return file ? file.async('string') : '';
}

/** The <Relationship> elements of document.xml.rels that point at commentsExtended. */
async function extendedRelationships(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/_rels/document.xml.rels')!.async('string');
  return (xml.match(/<Relationship\b[^>]*\/>/g) ?? []).filter((rel) =>
    /Type="[^"]*\/commentsExtended"/.test(rel),
  );
}

async function doneFlags(buffer: Buffer): Promise<string[]> {
  const xml = await commentsExtendedXml(buffer);
  return (xml.match(/w15:done="([01])"/g) ?? []).map((m) => m.slice(-2, -1));
}

describe('resolve / unresolve a comment thread', () => {
  it('projects an unresolved thread without the (RESOLVED) marker', async () => {
    const markdown = await projectDocx(threaded);
    expect(markdown).toContain('[Com:1]');
    expect(markdown).toContain('[Com:2]');
    expect(markdown).not.toContain('(RESOLVED)');
  });

  it('marks the WHOLE thread done - root and reply - and reports it', async () => {
    const { buffer, report } = await applyRedline(threaded, [{ type: 'resolve', target_id: '1' }], {
      author: 'Dra. Ana Marques',
    });

    expect(report.resolutions_applied).toBe(1);
    expect(await doneFlags(buffer)).toEqual(['1', '1']);

    const markdown = await projectDocx(buffer);
    expect(markdown).toMatch(/\[Com:1\][^\n]*\(RESOLVED\)/);
    expect(markdown).toMatch(/\[Com:2\][^\n]*\(RESOLVED\)/);
  });

  it('writes the flag as w15:done on w15:commentEx and leaves w:comment untouched', async () => {
    const { buffer } = await applyRedline(threaded, [{ type: 'resolve', target_id: '1' }], {
      author: 'Dra. Ana Marques',
    });

    expect(await commentsExtendedXml(buffer)).toMatch(/<w15:commentEx[^>]*w15:done="1"/);

    // Word never puts w15:done on w:comment; writing it there would make our
    // projection disagree with Word's review pane.
    const commentsXml = await (await JSZip.loadAsync(buffer)).file('word/comments.xml')!.async('string');
    expect(commentsXml).not.toContain('w15:done');
  });

  it('resolves the thread when the REPLY id is targeted, not just the root', async () => {
    const { buffer } = await applyRedline(threaded, [{ type: 'unresolve', target_id: '2' }], {
      author: 'x',
    });
    expect(await doneFlags(buffer)).toEqual(['0', '0']);

    const { buffer: resolved } = await applyRedline(buffer, [{ type: 'resolve', target_id: '2' }], {
      author: 'x',
    });
    expect(await doneFlags(resolved)).toEqual(['1', '1']);
  });

  it('reopens a resolved thread', async () => {
    const { buffer } = await applyRedline(threaded, [{ type: 'resolve', target_id: '1' }], { author: 'x' });
    const { buffer: reopened, report } = await applyRedline(
      buffer,
      [{ type: 'unresolve', target_id: '1' }],
      { author: 'x' },
    );
    expect(report.resolutions_applied).toBe(1);
    expect(await doneFlags(reopened)).toEqual(['0', '0']);
    expect(await projectDocx(reopened)).not.toContain('(RESOLVED)');
  });

  it('is idempotent - a no-op resolve counts as unchanged, not applied', async () => {
    const { buffer } = await applyRedline(threaded, [{ type: 'resolve', target_id: '1' }], { author: 'x' });
    const { report } = await applyRedline(buffer, [{ type: 'resolve', target_id: '1' }], { author: 'x' });
    expect(report.resolutions_applied).toBe(0);
    expect(report.resolutions_unchanged).toBe(1);
  });

  it('accepts the "Com:n" id form the MCP ops also take', async () => {
    const { buffer } = await applyRedline(threaded, [{ type: 'resolve', target_id: 'Com:1' }], {
      author: 'x',
    });
    expect(await doneFlags(buffer)).toEqual(['1', '1']);
  });
});

describe('atomicity with adeu ops', () => {
  it('applies "reply then resolve" in ONE batch, marking the new reply done too', async () => {
    const { buffer, report } = await applyRedline(
      threaded,
      [
        { type: 'reply', target_id: '1', text: 'De acordo, fechado.' },
        { type: 'resolve', target_id: '1' },
      ],
      { author: 'Dra. Ana Marques' },
    );

    expect(report.actions_applied).toBe(1);
    expect(report.resolutions_applied).toBe(1);
    // root + original reply + the reply added by this very batch
    expect(await doneFlags(buffer)).toEqual(['1', '1', '1']);
    expect(await projectDocx(buffer)).toContain('De acordo, fechado.');
  });

  it('rejects the whole batch when the resolve target does not exist - nothing saved', async () => {
    const before = await projectDocx(threaded);
    await expect(
      applyRedline(
        threaded,
        [
          { type: 'modify', target_text: ANCHOR, new_text: 'Sigilo' },
          { type: 'resolve', target_id: '999' },
        ],
        { author: 'x' },
      ),
    ).rejects.toBeInstanceOf(RedlineBatchError);
    expect(await projectDocx(threaded)).toBe(before);
  });

  it('maps a resolve failure back to its position in the CALLER ops array', async () => {
    const error = (await applyRedline(
      threaded,
      [
        { type: 'reply', target_id: '1', text: 'ok' },
        { type: 'resolve', target_id: '999' },
      ],
      { author: 'x' },
    ).catch((err: unknown) => err)) as RedlineBatchError;

    expect(error).toBeInstanceOf(RedlineBatchError);
    expect(error.failures).toHaveLength(1);
    // index 1, not 0: the engine ops and the resolve ops are counted separately
    // internally but reported against the caller's array.
    expect(error.failures[0]!.index).toBe(1);
    expect(error.failures[0]!.error).toContain('999');
  });

  it('runs a resolve-only batch without invoking the engine', async () => {
    const { report } = await applyRedline(threaded, [{ type: 'resolve', target_id: '1' }], {
      author: 'x',
    });
    expect(report.engine).toBe('ekoa-docx-comments');
    expect(report.edits).toEqual([]);
  });
});

describe('package-level safety', () => {
  it('does not accumulate duplicate commentsExtended relationships', async () => {
    let buffer = threaded;
    expect(await extendedRelationships(buffer)).toHaveLength(1);
    for (let i = 0; i < 6; i += 1) {
      ({ buffer } = await applyRedline(
        buffer,
        [{ type: i % 2 === 0 ? 'resolve' : 'unresolve', target_id: '1' }],
        { author: 'x' },
      ));
    }
    // DocumentObject.relateTo appends a fresh rId every call - without the
    // already-linked guard this grows by one per resolve.
    expect(await extendedRelationships(buffer)).toHaveLength(1);
  });

  it('heals a document that already carries duplicate commentsExtended relationships', async () => {
    const files = unzipSync(new Uint8Array(threaded)) as Record<string, Uint8Array>;
    const relsXml = strFromU8(files['word/_rels/document.xml.rels']!);
    const original = (relsXml.match(/<Relationship\b[^>]*\/>/g) ?? []).find((rel) =>
      /Type="[^"]*\/commentsExtended"/.test(rel),
    )!;
    files['word/_rels/document.xml.rels'] = new TextEncoder().encode(
      relsXml.replace(original, `${original}${original.replace(/Id="[^"]*"/, 'Id="rId900"')}`),
    );
    const duplicated = Buffer.from(zipSync(files));
    expect(await extendedRelationships(duplicated)).toHaveLength(2);

    const { buffer } = await applyRedline(duplicated, [{ type: 'resolve', target_id: '1' }], {
      author: 'x',
    });
    expect(await extendedRelationships(buffer)).toHaveLength(1);
    expect(await doneFlags(buffer)).toEqual(['1', '1']);
  });

  it('creates commentsExtended (part + relationship + Override) when the document lacks it', async () => {
    const files = unzipSync(new Uint8Array(threaded)) as Record<string, Uint8Array>;
    delete files['word/commentsExtended.xml'];
    const encoder = new TextEncoder();
    files['[Content_Types].xml'] = encoder.encode(
      strFromU8(files['[Content_Types].xml']!).replace(/<Override[^>]*commentsExtended[^>]*\/>/g, ''),
    );
    files['word/_rels/document.xml.rels'] = encoder.encode(
      strFromU8(files['word/_rels/document.xml.rels']!).replace(
        /<Relationship[^>]*commentsExtended[^>]*\/>/g,
        '',
      ),
    );
    const stripped = Buffer.from(zipSync(files));
    expect(await commentsExtendedXml(stripped)).toBe('');

    const { buffer } = await applyRedline(stripped, [{ type: 'resolve', target_id: '1' }], {
      author: 'x',
    });
    expect(await commentsExtendedXml(buffer)).toMatch(/<w15:commentEx[^>]*w15:done="1"/);
    expect(await extendedRelationships(buffer)).toHaveLength(1);

    const contentTypes = await (await JSZip.loadAsync(buffer))
      .file('[Content_Types].xml')!
      .async('string');
    expect(contentTypes).toContain('commentsExtended');

    // Repeated passes must not add a second part or a second relationship.
    const { buffer: again } = await applyRedline(buffer, [{ type: 'unresolve', target_id: '1' }], {
      author: 'x',
    });
    expect(await extendedRelationships(again)).toHaveLength(1);
    const zip = await JSZip.loadAsync(again);
    expect(Object.keys(zip.files).filter((f) => f.includes('commentsExtended'))).toHaveLength(1);
  });

  it('reuses the existing commentEx of a MULTI-PARAGRAPH comment instead of adding one', async () => {
    // Word keys commentEx on the comment's LAST paragraph; adeu keys it on the
    // FIRST. Matching only one convention would mint a spurious commentEx and
    // resolve a phantom single-comment thread.
    const doc = await DocumentObject.load(threaded);
    const parts = doc.pkg.parts as unknown as Array<{ contentType: string; _element: any }>;
    const commentsPart = parts.find((p) => p.contentType.endsWith('comments+xml'))!;
    const extendedPart = parts.find((p) => p.contentType.endsWith('commentsExtended+xml'))!;

    const tagged = (root: any, name: string): any[] => {
      const out: any[] = [];
      const walk = (node: any): void => {
        for (let i = 0; i < node.childNodes.length; i += 1) {
          const child = node.childNodes[i];
          if (child.nodeType !== 1) continue;
          if (child.nodeName === name) out.push(child);
          walk(child);
        }
      };
      walk(root);
      return out;
    };

    const root = tagged(commentsPart._element, 'w:comment').find(
      (c) => c.getAttribute('w:id') === '1',
    );
    const firstParagraph = tagged(root, 'w:p')[0];
    const firstParaId = firstParagraph.getAttribute('w14:paraId');
    const lastParaId = 'BEEF1234';

    const secondParagraph = firstParagraph.cloneNode(true);
    secondParagraph.setAttribute('w14:paraId', lastParaId);
    root.appendChild(secondParagraph);
    for (const ex of tagged(extendedPart._element, 'w15:commentEx')) {
      if (ex.getAttribute('w15:paraId') === firstParaId) ex.setAttribute('w15:paraId', lastParaId);
      if (ex.getAttribute('w15:paraIdParent') === firstParaId) {
        ex.setAttribute('w15:paraIdParent', lastParaId);
      }
    }
    const multiParagraph = await doc.save();

    const { buffer } = await applyRedline(multiParagraph, [{ type: 'resolve', target_id: '1' }], {
      author: 'x',
    });

    const xml = await commentsExtendedXml(buffer);
    expect(xml.match(/<w15:commentEx/g)).toHaveLength(2);
    expect(await doneFlags(buffer)).toEqual(['1', '1']);
  });
});

describe('comment anchor survival across accept/reject', () => {
  /** Comment ids present in comments.xml but with no anchor in document.xml. */
  async function orphanedComments(buffer: Buffer): Promise<string[]> {
    const zip = await JSZip.loadAsync(buffer);
    const commentsFile = zip.file('word/comments.xml');
    if (!commentsFile) return [];
    const comments = await commentsFile.async('string');
    const document = await zip.file('word/document.xml')!.async('string');
    const ids = [...comments.matchAll(/<w:comment\b[^>]*w:id="(\d+)"/g)].map((m) => m[1]!);
    const anchored = new Set(
      [...document.matchAll(/<w:commentReference[^>]*w:id="(\d+)"/g)].map((m) => m[1]!),
    );
    return ids.filter((id) => !anchored.has(id));
  }

  async function commentIds(buffer: Buffer): Promise<string[]> {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file('word/comments.xml');
    if (!file) return [];
    return [...(await file.async('string')).matchAll(/<w:comment\b[^>]*w:id="(\d+)"/g)].map((m) => m[1]!);
  }

  const TARGET = 'A falta de pagamento pontual constitui o Cliente em mora, vencendo juros à taxa legal.';
  const REWRITE =
    'A falta de pagamento pontual constitui o Cliente em mora, vencendo juros de mora à taxa supletiva legal aplicável às transações comerciais entre empresas.';

  /** A tracked rewrite that also carries a comment - the shape the agent emits. */
  async function commentedRewrite(): Promise<Buffer> {
    const base = await makeContratoFixture();
    const { buffer } = await applyRedline(
      base,
      [{ type: 'modify', target_text: TARGET, new_text: REWRITE, comment: 'Regime das transações comerciais.' }],
      { author: 'admin (Ekoa)' },
    );
    return buffer;
  }

  it('keeps the comment visible after its tracked change is ACCEPTED', async () => {
    // Regression: the engine drops w:commentRangeStart/End + w:commentReference
    // when accepting, leaving a record no editor can display. The text survives
    // an accepted insertion, so the anchor must be restored onto it.
    const commented = await commentedRewrite();
    expect(await orphanedComments(commented)).toEqual([]);

    const pending = [...new Set(
      [...(await projectDocx(commented)).matchAll(/\[Chg:(\d+)/g)].map((m) => m[1]!),
    )];

    let buffer = commented;
    let repaired = 0;
    for (const id of pending) {
      try {
        const result = await applyRedline(buffer, [{ type: 'accept', target_id: id }], { author: 'x' });
        buffer = result.buffer;
        repaired += result.report.comment_anchors_repaired ?? 0;
      } catch {
        // Paired ids settle together; the partner reports "not found".
      }
    }

    expect(repaired).toBeGreaterThan(0);
    expect(await orphanedComments(buffer)).toEqual([]);
    expect(await projectDocx(buffer)).toContain('[Com:');
  });

  it('re-anchors onto the same text, keeping the original author and body', async () => {
    const commented = await commentedRewrite();
    const pending = [...new Set(
      [...(await projectDocx(commented)).matchAll(/\[Chg:(\d+)/g)].map((m) => m[1]!),
    )];
    let buffer = commented;
    for (const id of pending) {
      try {
        buffer = (await applyRedline(buffer, [{ type: 'accept', target_id: id }], { author: 'x' })).buffer;
      } catch { /* paired */ }
    }

    const zip = await JSZip.loadAsync(buffer);
    const comments = await zip.file('word/comments.xml')!.async('string');
    expect(comments).toContain('admin (Ekoa)');
    expect(comments).toContain('Regime das transações comerciais.');

    const document = await zip.file('word/document.xml')!.async('string');
    const span = /<w:commentRangeStart[^>]*w:id="1"[^>]*\/>([\s\S]*?)<w:commentRangeEnd[^>]*w:id="1"/.exec(document);
    const anchoredText = (span?.[1]?.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
      .map((t) => t.replace(/<[^>]*>/g, ''))
      .join('');
    expect(anchoredText.length).toBeGreaterThan(0);
    expect(REWRITE).toContain(anchoredText.trim().slice(0, 30));
  });

  it('leaves a comment that was ALREADY unanchored untouched', async () => {
    // Never guess a new home for an orphan that predates the batch.
    const commented = await commentedRewrite();
    const files = unzipSync(new Uint8Array(commented)) as Record<string, Uint8Array>;
    files['word/document.xml'] = new TextEncoder().encode(
      strFromU8(files['word/document.xml']!)
        .replace(/<w:commentRangeStart[^>]*\/>/g, '')
        .replace(/<w:commentRangeEnd[^>]*\/>/g, '')
        .replace(/<w:commentReference[^>]*\/>/g, ''),
    );
    const stripped = Buffer.from(zipSync(files));
    expect(await orphanedComments(stripped)).toEqual(['1']);

    const { buffer } = await applyRedline(
      stripped,
      [{ type: 'modify', target_text: 'aviso prévio de 30 dias', new_text: 'aviso prévio de 60 dias' }],
      { author: 'x' },
    );
    expect(await commentIds(buffer)).toEqual(['1']);
    expect(await orphanedComments(buffer)).toEqual(['1']);
  });
});
