import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { knowledgeUploads } from '../../src/data/stores.js';
import type { Actor } from '@ekoa/shared';
import {
  ingestDocument, deleteDocument, listDocuments, listCollections, createUpload, deleteUpload, listUploads,
  reindexOrg, indexStatus, backfillKnowledgeIndex, readDocWithShared, KnowledgeError,
} from '../../src/knowledge/service.js';
import { search, closeIndex } from '../../src/knowledge/index-store.js';
import { writeDoc } from '../../src/knowledge/vault.js';
import * as vault from '../../src/knowledge/vault.js';
import { SHARED_ORG_ID } from '../../src/knowledge/paths.js';

/**
 * Service tests (ch03 §3.8.20, ch04 §4.4.1): the vault+index orchestration — ingest write hook,
 * uploads (text ingested / binary registered honestly), delete unindex, startup backfill, and the
 * org-admin reindex heal, all org-partitioned.
 */
let mem: MongoMemoryServer; let dir: string; let n = 0;
const deps = { now: () => 1_700_000_000_000 + n, genId: () => `d${n++}` };
const actor = (orgId: string): Actor => ({ userId: `u-${orgId}`, orgId, role: 'org-admin' });

beforeAll(async () => { mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_knowledge_svc'); }, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-svc-'));
  process.env.EKOA_DATA_DIR = dir;
  await knowledgeUploads.deleteMany({});
});
afterEach(async () => {
  closeIndex();
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('document ingest + delete', () => {
  it('ingests a document (write hook indexes it) and delete unindexes it', async () => {
    const { id } = await ingestDocument(actor('orgA'), { collection: 'jurisprudencia', title: 'Prazos', text: 'ações e prazos de recurso' }, deps);
    expect(search('orgA', 'acoes', 5).map((h) => h.docId)).toContain(id); // accent-folded, indexed on write
    const listed = await listDocuments(actor('orgA'), {});
    expect(listed.items.map((d) => d.id)).toContain(id);

    expect(await deleteDocument(actor('orgA'), 'jurisprudencia', id)).toBe(true);
    expect(search('orgA', 'acoes', 5)).toHaveLength(0);
    expect((await listDocuments(actor('orgA'), {})).total).toBe(0);
  });
});

describe('uploads', () => {
  it('a .md upload is ingested into the vault and becomes searchable', async () => {
    const out = await createUpload(actor('orgA'), { filename: 'nota.md', collection: 'uploads', contentType: 'text/markdown', bytes: Buffer.from('conteúdo sobre penhora de bens') }, deps);
    expect(out.status).toBe('indexed');
    expect(out.docsIndexed).toBe(1);
    expect(search('orgA', 'penhora', 5)).toHaveLength(1);
    const rows = await listUploads(actor('orgA'));
    expect(rows).toHaveLength(1);
  });

  it('a binary upload is registered honestly as un-indexed (no silent partial index)', async () => {
    const out = await createUpload(actor('orgA'), { filename: 'contrato.pdf', collection: 'uploads', contentType: 'application/pdf', bytes: Buffer.from([0x25, 0x50, 0x44, 0x46]) }, deps);
    expect(out.status).toBe('registered');
    expect(out.docsIndexed).toBe(0);
    expect(search('orgA', 'contrato', 5)).toHaveLength(0);
  });

  it('deleting an upload unindexes its documents and drops the registry row', async () => {
    const out = await createUpload(actor('orgA'), { filename: 'nota.md', collection: 'uploads', contentType: 'text/markdown', bytes: Buffer.from('texto sobre acórdão') }, deps);
    const del = await deleteUpload(actor('orgA'), out.uploadId);
    expect(del).toEqual({ removed: true, docsRemoved: 1 });
    expect(search('orgA', 'acordao', 5)).toHaveLength(0);
    expect(await listUploads(actor('orgA'))).toHaveLength(0);
  });

  it('cross-org: orgB cannot delete orgA uploads (uniform not-found)', async () => {
    const out = await createUpload(actor('orgA'), { filename: 'x.md', collection: 'uploads', contentType: 'text/markdown', bytes: Buffer.from('prazo') }, deps);
    expect(await deleteUpload(actor('orgB'), out.uploadId)).toEqual({ removed: false, docsRemoved: 0 });
    expect(await listUploads(actor('orgA'))).toHaveLength(1); // untouched
  });
});

describe('shared partition read fallback (readDocWithShared)', () => {
  it('an org doc shadows a shared doc on the same (collection, docId)', async () => {
    await writeDoc('orgA', 'legislacao', 'lei-1', { title: 'Org override', createdAt: '2026-01-01T00:00:00.000Z' }, 'texto do org');
    await writeDoc(SHARED_ORG_ID, 'legislacao', 'lei-1', { title: 'Shared base', createdAt: '2026-01-01T00:00:00.000Z' }, 'texto partilhado');
    const doc = await readDocWithShared('orgA', 'legislacao', 'lei-1');
    expect(doc?.body).toBe('texto do org');
    expect(doc?.fm.title).toBe('Org override');
  });

  it('falls back to the shared corpus when the org has no such doc', async () => {
    await writeDoc(SHARED_ORG_ID, 'legislacao', 'lei-2', { title: 'Shared only', createdAt: '2026-01-01T00:00:00.000Z' }, 'só partilhado');
    const doc = await readDocWithShared('orgA', 'legislacao', 'lei-2');
    expect(doc?.body).toBe('só partilhado');
    expect(doc?.fm.title).toBe('Shared only');
  });

  it('returns null when neither the org nor the shared corpus has the doc', async () => {
    expect(await readDocWithShared('orgA', 'legislacao', 'inexistente')).toBeNull();
  });

  it('a shared-scope caller reads the shared corpus directly', async () => {
    await writeDoc(SHARED_ORG_ID, 'legislacao', 'lei-3', { title: 'Shared', createdAt: '2026-01-01T00:00:00.000Z' }, 'partilhado');
    expect((await readDocWithShared(SHARED_ORG_ID, 'legislacao', 'lei-3'))?.body).toBe('partilhado');
    expect(await readDocWithShared(SHARED_ORG_ID, 'legislacao', 'inexistente')).toBeNull();
  });
});

describe('shared partition is write-protected online (FORBIDDEN 403)', () => {
  const shared = actor(SHARED_ORG_ID);
  const forbidden = async (fn: () => Promise<unknown>) => {
    await expect(fn()).rejects.toBeInstanceOf(KnowledgeError);
    await expect(fn()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  };

  it('refuses ingest, upload, delete-doc, delete-upload and reindex for the shared actor', async () => {
    await forbidden(() => ingestDocument(shared, { collection: 'c', title: 'T', text: 'x' }, deps));
    await forbidden(() => createUpload(shared, { filename: 'n.md', contentType: 'text/markdown', bytes: Buffer.from('x') }, deps));
    await forbidden(() => deleteDocument(shared, 'c', 'd1'));
    await forbidden(() => deleteUpload(shared, 'u1'));
    await forbidden(() => reindexOrg(shared));
  });

  it('a normal org is unaffected by the guard (ingest still works)', async () => {
    const { id } = await ingestDocument(actor('orgA'), { collection: 'c', title: 'T', text: 'prazo' }, deps);
    expect(search('orgA', 'prazo', 5).map((h) => h.docId)).toContain(id);
  });
});

describe('browse scope (WS8a): the org vault vs. the reserved `_shared` corpus', () => {
  it('defaults to org - omitting `scope` (or passing `scope: "org"`) never sees `_shared`, even when it holds documents', async () => {
    await ingestDocument(actor('orgA'), { collection: 'c', title: 'Meu', text: 'conteúdo próprio' }, deps);
    await writeDoc(SHARED_ORG_ID, 'c', 'shared-1', { title: 'Partilhado', createdAt: '2026-01-01T00:00:00.000Z' }, 'conteúdo partilhado');

    expect(await listCollections(actor('orgA'))).toEqual(['c']);
    const withoutOpts = await listDocuments(actor('orgA'), {});
    const withOrgScope = await listDocuments(actor('orgA'), { scope: 'org' });
    expect(withoutOpts).toEqual(withOrgScope);
    expect(withoutOpts.total).toBe(1);
    expect(withoutOpts.items[0]?.scope).toBe('org'); // stamped like the single-doc read always has
    expect(withoutOpts.items.map((d) => d.title)).not.toContain('Partilhado');
  });

  it('scope: "shared" reads the `_shared` partition instead, for ANY org actor, each row marked scope: "shared"', async () => {
    await writeDoc(SHARED_ORG_ID, 'jurisprudencia', 'j-1', { title: 'Acórdão', createdAt: '2026-01-01T00:00:00.000Z' }, 'conteúdo do acórdão');
    await writeDoc(SHARED_ORG_ID, 'legislacao', 'l-1', { title: 'Lei', createdAt: '2026-01-01T00:00:00.000Z' }, 'conteúdo da lei');
    // F43: the browse listing is now index-backed (the vault write alone is not enough - mirrors
    // how the real corpus is populated: the offline importer writes vault files AND runs a backfill).
    await backfillKnowledgeIndex({ force: true });
    await ingestDocument(actor('orgA'), { collection: 'jurisprudencia', title: 'Privado', text: 'nunca deve aparecer' }, deps);

    for (const org of ['orgA', 'orgB']) {
      const cols = await listCollections(actor(org), { scope: 'shared' });
      expect(cols.sort()).toEqual(['jurisprudencia', 'legislacao']);
      const docs = await listDocuments(actor(org), { scope: 'shared' });
      expect(docs.total).toBe(2);
      expect(docs.items.every((d) => d.scope === 'shared')).toBe(true);
      expect(docs.items.map((d) => d.title)).not.toContain('Privado'); // the org's OWN doc never leaks in
    }
  });

  it('collection filter + pagination behave identically under scope: "shared"', async () => {
    for (let i = 0; i < 3; i++) {
      await writeDoc(SHARED_ORG_ID, 'jurisprudencia', `j-${i}`, { title: `Doc ${i}`, createdAt: '2026-01-01T00:00:00.000Z' }, `conteúdo ${i}`);
    }
    await writeDoc(SHARED_ORG_ID, 'legislacao', 'l-1', { title: 'Lei única', createdAt: '2026-01-01T00:00:00.000Z' }, 'conteúdo da lei');
    await backfillKnowledgeIndex({ force: true }); // F43: browse is index-backed - see the note above

    const filtered = await listDocuments(actor('orgA'), { scope: 'shared', collection: 'legislacao' });
    expect(filtered.total).toBe(1);
    const paged = await listDocuments(actor('orgA'), { scope: 'shared', collection: 'jurisprudencia', limit: 2, offset: 0 });
    expect(paged.total).toBe(3);
    expect(paged.items).toHaveLength(2);
  });

  /**
   * F43 (live-verified regression, task #43): `scope=shared&limit=20` against the operator's real
   * 262,672-document `_shared` corpus took 56.9 SECONDS - `vault.listDocs` read and parsed EVERY
   * file in the partition, sorted the lot, then sliced 20 off the front. A small fixture would not
   * catch this (it already passes at any small N), so this test pins the STRUCTURAL property
   * instead of a timing threshold that would flake on a loaded machine: a paged browse call must
   * never touch the vault filesystem at all, for ANY corpus size - it is index-backed now
   * (`index.listDocsPage`). Proven with a spy, not a fixture size assumption, so it fails exactly as
   * hard on 500 docs as it would have on 262,672 - and would have failed against the PRE-FIX
   * `vault.listDocs` implementation regardless of corpus size, since that path always called
   * `vault.readDoc` at least once (for a non-empty partition).
   */
  it('F43: a paged browse costs O(page) - zero vault file reads, at any corpus size', async () => {
    for (let i = 0; i < 500; i++) {
      const createdAt = new Date(1735689600000 + i * 1000).toISOString(); // deterministic, distinct, ascending
      await writeDoc(SHARED_ORG_ID, 'jurisprudencia', `bulk-${String(i).padStart(4, '0')}`, { title: `Doc ${i}`, createdAt }, `conteúdo ${i}`);
    }
    await backfillKnowledgeIndex({ force: true }); // simulates the real offline importer's write + index

    // Spy on the actual CROSS-MODULE entry point `service.ts` calls into `vault.ts` - not the
    // internal `listAllDocs`/`readDoc` helpers `vault.listDocs` calls itself, which a same-file
    // self-call cannot be intercepted by spying on the module's own exports object (a vitest/ESM
    // limitation, not specific to this code). `vault.listDocs` is the one call that is EITHER made
    // (pre-fix) or never made (post-fix) from OUTSIDE vault.ts, so it is the correct interception
    // point for this property.
    const listDocsSpy = vi.spyOn(vault, 'listDocs');
    try {
      const page = await listDocuments(actor('orgA'), { scope: 'shared', limit: 20, offset: 250 });
      expect(page.total).toBe(500);
      expect(page.items).toHaveLength(20);
      // Deterministic order (createdAt ascending) proves the page is the RIGHT slice, not just
      // the right size - offset 250 of an ascending 500-doc corpus starts at "Doc 250".
      expect(page.items[0]?.title).toBe('Doc 250');
      expect(page.items[19]?.title).toBe('Doc 269');
      // THE PIN: this call never went through the filesystem-backed vault listing at all. On the
      // pre-fix implementation (`vault.listDocs` -> `listAllDocs` -> `readDoc` per file) this
      // assertion fails immediately - `vault.listDocs` is called exactly once.
      expect(listDocsSpy).not.toHaveBeenCalled();
    } finally {
      listDocsSpy.mockRestore();
    }
  });

  it('shared scope is READ-ONLY: no write function on the module even has a `scope` option to pass', async () => {
    // ingestDocument / deleteDocument / createUpload / deleteUpload / reindexOrg all take only an
    // Actor (+ input) - there is no `opts.scope` parameter anywhere on the write surface, so there
    // is no argument shape through which a caller could aim a write at `_shared`. The behavioural
    // half: an org's write always lands in ITS OWN partition and never appears under scope: 'shared'.
    const { id } = await ingestDocument(actor('orgA'), { collection: 'c', title: 'T', text: 'x' }, deps);
    expect((await listDocuments(actor('orgA'), { scope: 'shared' })).total).toBe(0);
    expect((await listDocuments(actor('orgA'), { scope: 'org' })).items.map((d) => d.id)).toContain(id);
  });

  it('the shared-actor invariant (assertNotSharedActor) holds regardless of `opts.scope`', async () => {
    const shared = actor(SHARED_ORG_ID);
    await expect(listCollections(shared)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(listCollections(shared, { scope: 'shared' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(listDocuments(shared, { scope: 'org' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(listDocuments(shared, { scope: 'shared' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

describe('backfill + reindex (index is derived data)', () => {
  it('backfill rebuilds the index from the vault when it is missing/empty, and skips when populated', async () => {
    const { id } = await ingestDocument(actor('orgA'), { collection: 'c', title: 'T', text: 'prazo de recurso' }, deps);
    // simulate a lost index: close + drop the sqlite file, then backfill from the surviving vault
    closeIndex();
    await rm(join(dir, 'knowledge', 'index'), { recursive: true, force: true });
    const rebuilt = await backfillKnowledgeIndex();
    expect(rebuilt.skipped).toBe(false);
    expect(rebuilt.indexed).toBe(1);
    expect(search('orgA', 'prazo', 5).map((h) => h.docId)).toContain(id);
    // second run is a no-op (index persists across restarts)
    expect(await backfillKnowledgeIndex()).toEqual({ indexed: 0, skipped: true });
  });

  it('reindexOrg clears + rebuilds only the caller org partition; index-status reports counts', async () => {
    await ingestDocument(actor('orgA'), { collection: 'c', title: 'A', text: 'prazo' }, deps);
    await ingestDocument(actor('orgB'), { collection: 'c', title: 'B', text: 'prazo' }, deps);
    const res = await reindexOrg(actor('orgA'));
    expect(res).toEqual({ started: true });
    const status = indexStatus(actor('orgA'));
    expect(status.status).toBe('ready');
    expect(status.documentCount).toBe(1);
    expect(indexStatus(actor('orgB')).documentCount).toBe(1); // untouched
  });
});
