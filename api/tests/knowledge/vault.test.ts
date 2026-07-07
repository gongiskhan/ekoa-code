import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeDoc, parseDoc, writeDoc, readDoc, deleteDoc, listCollections, listDocs, listOrgIds,
} from '../../src/knowledge/vault.js';
import { PathSafetyError } from '../../src/knowledge/paths.js';

/**
 * Vault module tests (ch04 §4.4.1): the filesystem markdown corpus. Frontmatter round-trip,
 * CRUD, filesystem browse (list, NOT search), org partition by path segment, path-traversal guard.
 */
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-vault-'));
  process.env.EKOA_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('frontmatter serialize/parse', () => {
  it('round-trips a doc whose title carries colons, quotes and newlines', () => {
    const fm = { title: 'Acórdão: "STJ" \n2ª secção', sourceUrl: 'https://dgsi.pt/a:b', createdAt: '2026-07-07T10:00:00.000Z' };
    const body = 'Corpo do documento\ncom várias linhas.\n---\nnão é fence real';
    const { fm: got, body: gotBody } = parseDoc(serializeDoc(fm, body));
    expect(got.title).toBe(fm.title);
    expect(got.sourceUrl).toBe(fm.sourceUrl);
    expect(got.createdAt).toBe(fm.createdAt);
    expect(gotBody).toBe(body);
  });
});

describe('vault CRUD + browse', () => {
  it('writes, reads and deletes a document', async () => {
    const wrote = await writeDoc('orgA', 'jurisprudencia', 'd1', { title: 'T1', createdAt: '2026-01-01T00:00:00.000Z' }, 'body one');
    expect(wrote.size).toBeGreaterThan(0);
    const read = await readDoc('orgA', 'jurisprudencia', 'd1');
    expect(read?.body).toBe('body one');
    expect(read?.fm.title).toBe('T1');
    expect(await deleteDoc('orgA', 'jurisprudencia', 'd1')).toBe(true);
    expect(await readDoc('orgA', 'jurisprudencia', 'd1')).toBeNull();
    expect(await deleteDoc('orgA', 'jurisprudencia', 'd1')).toBe(false); // already gone
  });

  it('lists collections and paginates documents in deterministic (createdAt, docId) order', async () => {
    await writeDoc('orgA', 'colA', 'd2', { title: 'B', createdAt: '2026-01-02T00:00:00.000Z' }, 'x');
    await writeDoc('orgA', 'colA', 'd1', { title: 'A', createdAt: '2026-01-01T00:00:00.000Z' }, 'x');
    await writeDoc('orgA', 'colB', 'd3', { title: 'C', createdAt: '2026-01-03T00:00:00.000Z' }, 'x');
    expect(await listCollections('orgA')).toEqual(['colA', 'colB']);

    const all = await listDocs('orgA');
    expect(all.total).toBe(3);
    expect(all.items.map((d) => d.docId)).toEqual(['d1', 'd2', 'd3']); // createdAt order

    const page = await listDocs('orgA', { offset: 1, limit: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.docId).toBe('d2');

    const filtered = await listDocs('orgA', { collection: 'colB' });
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]!.docId).toBe('d3');
  });

  it('partitions by org: orgB never sees orgA documents or collections', async () => {
    await writeDoc('orgA', 'colA', 'd1', { title: 'A', createdAt: '2026-01-01T00:00:00.000Z' }, 'x');
    expect(await listCollections('orgB')).toEqual([]);
    expect((await listDocs('orgB')).total).toBe(0);
    expect(await listOrgIds()).toEqual(['orgA']);
  });
});

describe('path-traversal guard', () => {
  it('rejects a collection segment that tries to escape the org partition', async () => {
    await expect(writeDoc('orgA', '../orgB', 'd1', { title: 'T', createdAt: '2026-01-01T00:00:00.000Z' }, 'x')).rejects.toBeInstanceOf(PathSafetyError);
    await expect(writeDoc('orgA', 'a/b', 'd1', { title: 'T', createdAt: '2026-01-01T00:00:00.000Z' }, 'x')).rejects.toBeInstanceOf(PathSafetyError);
  });
});
