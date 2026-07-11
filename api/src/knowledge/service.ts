/**
 * Knowledge service (ch03 §3.8.20, ch04 §4.4.1). Org-partitioned throughout: a firm's documents
 * never pool across orgs. Two concerns compose here:
 *  - Sources (G4): a user-supplied URL, SSRF-validated at write time (ch09 invariant 8).
 *  - The vault + lexical index (this slice): the filesystem markdown corpus and its FTS5 index,
 *    a deliberate filesystem/SQLite exception (§4.4.1). The service is the orchestrator — it owns
 *    the write/delete hooks that keep the index in step with the vault, plus uploads and the
 *    org-admin heal operations (reindex, index-status) and the startup backfill.
 *
 * knowledge/ has NO import path to llm/ (CLAUDE.md, FIXED-3). The grounding builder lives beside
 * this module and is consumed by agents/, not by any REST route.
 */
import { knowledgeSources, knowledgeUploads } from '../data/stores.js';
import { assertSafeUrl, SsrfError } from '../services/url-safety.js';
import type { Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';
import * as vault from './vault.js';
import * as index from './index-store.js';
import { PathSafetyError, uploadBlobPath, uploadsDir, knowledgeRoot, SHARED_ORG_ID } from './paths.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { relative } from 'node:path';

export interface KnowledgeSourceDoc extends Doc {
  orgId: string;
  url: string;
  kind?: string;
  seedId?: string;
  collection?: string;
  enabled?: boolean;
  lastCrawledAt?: string;
  crawlConfig?: Record<string, unknown>;
}

export interface KnowledgeUploadDoc extends Doc {
  orgId: string;
  filename: string;
  collection?: string;
  docIds: string[];
  status: string;
  size?: number;
  contentType?: string;
  storedPath?: string; // storage-relative (P-07)
  createdAt?: string;
}

export interface Deps { now: () => number; genId: () => string }

export class KnowledgeError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

/**
 * Tenancy guard for the reserved shared partition (ch04 §4.4.1). The `_shared` corpus is a
 * read-only public legal spine, written ONLY by the offline importer CLI. No real actor is ever
 * assigned this org id (UUIDs never collide with it), so this is a structural invariant, not a
 * user-facing permission: any request actor presenting the shared org id is refused before it can
 * mutate the corpus through the service.
 */
function assertNotSharedActor(actor: Actor): void {
  if (actor.orgId === SHARED_ORG_ID) {
    throw new KnowledgeError('FORBIDDEN', 403, 'A coleção partilhada é só de leitura.');
  }
}

// --- Sources (G4, unchanged) ---------------------------------------------------------------

/**
 * Aligned to the shared `KnowledgeSource` contract (F5): the store's `kind`/`seedId` surface under
 * the contract's names `type`/`seedTemplate`, and `collection`/`enabled`/`lastCrawledAt` are
 * emitted so a client that validates the response does not reject it. `enabled` defaults to true —
 * a source with no explicit flag has always been crawled/considered, so `true` is the honest read.
 */
export function sourceView(s: KnowledgeSourceDoc) {
  return {
    id: s._id,
    url: s.url,
    type: s.kind,
    collection: s.collection,
    seedTemplate: s.seedId ?? null,
    enabled: s.enabled ?? true,
    ...(s.lastCrawledAt ? { lastCrawledAt: s.lastCrawledAt } : {}),
  };
}

export async function listSources(actor: Actor): Promise<KnowledgeSourceDoc[]> {
  return knowledgeSources.find({ orgId: actor.orgId }) as Promise<KnowledgeSourceDoc[]>;
}

export async function addSource(actor: Actor, input: { url: string; kind?: string; seedId?: string }, deps: Deps): Promise<KnowledgeSourceDoc> {
  // SSRF-validate the user-supplied URL at write time (ch09 invariant 8).
  try {
    assertSafeUrl(input.url);
  } catch (e) {
    if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'URL não permitido.');
    throw e;
  }
  const id = deps.genId();
  const doc: KnowledgeSourceDoc = { _id: id, orgId: actor.orgId, url: input.url, kind: input.kind, seedId: input.seedId };
  await knowledgeSources.insert(doc as never);
  return doc;
}

export async function getVisibleSource(actor: Actor, id: string): Promise<KnowledgeSourceDoc | null> {
  const s = (await knowledgeSources.get(id)) as KnowledgeSourceDoc | null;
  if (!s || s.orgId !== actor.orgId) return null; // cross-org → uniform 404
  return s;
}

/**
 * Patch a source (F5). Cross-org reads as not-found (uniform 404) before any write. The contract's
 * `type`/`seedTemplate` names are mapped back onto the store's `kind`/`seedId`. A changed `url` is
 * SSRF-validated exactly as `addSource` does — a patch must not be a bypass of that gate.
 */
export async function updateSource(
  actor: Actor,
  id: string,
  patch: { url?: string; type?: string; collection?: string; seedTemplate?: string | null; enabled?: boolean },
): Promise<KnowledgeSourceDoc | null> {
  const s = await getVisibleSource(actor, id);
  if (!s) return null;
  if (patch.url !== undefined) {
    try {
      assertSafeUrl(patch.url);
    } catch (e) {
      if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'URL não permitido.');
      throw e;
    }
  }
  const next: Partial<KnowledgeSourceDoc> = {
    ...(patch.url !== undefined ? { url: patch.url } : {}),
    ...(patch.type !== undefined ? { kind: patch.type } : {}),
    ...(patch.collection !== undefined ? { collection: patch.collection } : {}),
    ...(patch.seedTemplate !== undefined ? { seedId: patch.seedTemplate ?? undefined } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
  };
  return (await knowledgeSources.update(id, (cur) => ({ ...cur, ...next } as never))) as unknown as KnowledgeSourceDoc | null;
}

export async function deleteSource(actor: Actor, id: string): Promise<boolean> {
  const s = await getVisibleSource(actor, id);
  if (!s) return false;
  return knowledgeSources.delete(id);
}

// --- Vault documents (this slice) -----------------------------------------------------------

export interface CreateDocumentInput {
  collection: string;
  title: string;
  text: string;
  sourceUrl?: string;
  sourceType?: string;
  language?: string;
}

function toSummary(d: vault.VaultDoc, now?: string) {
  return {
    id: d.docId,
    collection: d.collection,
    title: d.title,
    sourceUrl: d.sourceUrl,
    sourceType: d.sourceType,
    language: d.language,
    size: d.size,
    createdAt: d.createdAt || now,
  };
}

/** Ingest a document: write the vault file, then run the index write hook. Returns the id. */
export async function ingestDocument(actor: Actor, input: CreateDocumentInput, deps: Deps): Promise<{ id: string }> {
  assertNotSharedActor(actor);
  const docId = deps.genId();
  const createdAt = new Date(deps.now()).toISOString();
  const fm: vault.DocFrontmatter = {
    title: input.title,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    language: input.language,
    createdAt,
  };
  try {
    await vault.writeDoc(actor.orgId, input.collection, docId, fm, input.text);
  } catch (e) {
    if (e instanceof PathSafetyError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'Coleção inválida.');
    throw e;
  }
  index.indexDoc({
    orgId: actor.orgId,
    collection: input.collection,
    docId,
    title: input.title,
    body: input.text,
    createdAt,
    sourceUrl: input.sourceUrl,
    sourceType: input.sourceType,
    language: input.language,
  });
  return { id: docId };
}

export async function listDocuments(
  actor: Actor,
  opts: { collection?: string; offset?: number; limit?: number },
): Promise<{ items: ReturnType<typeof toSummary>[]; total: number }> {
  const { items, total } = await vault.listDocs(actor.orgId, opts);
  return { items: items.map((d) => toSummary(d)), total };
}

export async function listCollections(actor: Actor): Promise<string[]> {
  return vault.listCollections(actor.orgId);
}

/**
 * Read a document, consulting the caller's own vault first and the shared corpus as a fallback: an
 * org doc SHADOWS a shared doc on the same (collection, docId). A shared-scope caller reads the
 * shared partition once (no double read). This backs the in-process knowledge read tool so an agent
 * can open a shared-corpus citation it surfaced via {@link searchKnowledgeIndex}.
 */
export async function readDocWithShared(
  orgId: string,
  collection: string,
  docId: string,
): Promise<{ fm: vault.DocFrontmatter; body: string } | null> {
  const own = await vault.readDoc(orgId, collection, docId);
  if (own) return own;
  if (orgId === SHARED_ORG_ID) return null;
  return vault.readDoc(SHARED_ORG_ID, collection, docId);
}

/** Delete a document: remove the vault file + the index row. */
export async function deleteDocument(actor: Actor, collection: string, docId: string): Promise<boolean> {
  assertNotSharedActor(actor);
  let removed = false;
  try {
    removed = await vault.deleteDoc(actor.orgId, collection, docId);
  } catch (e) {
    if (e instanceof PathSafetyError) return false;
    throw e;
  }
  index.removeDoc(actor.orgId, collection, docId);
  return removed;
}

// --- Uploads (this slice) -------------------------------------------------------------------

const TEXT_EXTENSIONS = ['.md', '.txt', '.markdown'];

function isTextUpload(filename: string, contentType: string): boolean {
  const lower = filename.toLowerCase();
  if (TEXT_EXTENSIONS.some((e) => lower.endsWith(e))) return true;
  return contentType.startsWith('text/') || contentType === 'text/markdown';
}

/** Store a raw upload blob (org-scoped), register it, and — for plain text/markdown — ingest its
 *  text into the vault so it becomes searchable. Other formats are registered honestly as
 *  `unindexed` (no silent partial indexing). */
export async function createUpload(
  actor: Actor,
  input: { filename: string; collection?: string; contentType: string; bytes: Buffer },
  deps: Deps,
): Promise<{ uploadId: string; filename: string; collection?: string; status: string; docsIndexed: number }> {
  assertNotSharedActor(actor);
  const uploadId = deps.genId();
  const createdAt = new Date(deps.now()).toISOString();
  await mkdir(uploadsDir(actor.orgId), { recursive: true });
  const blobPath = uploadBlobPath(actor.orgId, uploadId);
  await writeFile(blobPath, input.bytes);

  const docIds: string[] = [];
  let status: string;
  if (isTextUpload(input.filename, input.contentType)) {
    const collection = input.collection || 'uploads';
    const { id } = await ingestDocument(
      actor,
      { collection, title: input.filename, text: input.bytes.toString('utf8'), sourceType: 'upload' },
      deps,
    );
    docIds.push(id);
    status = 'indexed';
  } else {
    // Registered but not indexed — v1 ingests plain text/markdown only (spec §3.8.20 upload row).
    status = 'registered';
  }

  const row: KnowledgeUploadDoc = {
    _id: uploadId,
    orgId: actor.orgId,
    filename: input.filename,
    collection: input.collection,
    docIds,
    status,
    size: input.bytes.length,
    contentType: input.contentType,
    storedPath: relative(knowledgeRoot(), blobPath),
    createdAt,
  };
  await knowledgeUploads.insert(row as never);
  return { uploadId, filename: input.filename, collection: input.collection, status, docsIndexed: docIds.length };
}

export async function listUploads(actor: Actor) {
  const rows = (await knowledgeUploads.find({ orgId: actor.orgId })) as KnowledgeUploadDoc[];
  // Wire shape is UploadDoc (shared/src/knowledge.ts): `id`, not the store's `_id`.
  return rows.map(({ _id, ...rest }) => ({ id: _id, uploadId: _id, ...rest }));
}

/** Delete an upload: unindex its ingested docs, remove the blob, drop the registry row. */
export async function deleteUpload(actor: Actor, id: string): Promise<{ removed: boolean; docsRemoved: number }> {
  assertNotSharedActor(actor);
  const row = (await knowledgeUploads.get(id)) as KnowledgeUploadDoc | null;
  if (!row || row.orgId !== actor.orgId) return { removed: false, docsRemoved: 0 }; // cross-org → uniform not-found
  let docsRemoved = 0;
  const collection = row.collection || 'uploads';
  for (const docId of row.docIds ?? []) {
    if (await deleteDocument(actor, collection, docId)) docsRemoved++;
  }
  await rm(uploadBlobPath(actor.orgId, id), { force: true }).catch(() => {});
  await knowledgeUploads.delete(id);
  return { removed: true, docsRemoved };
}

// --- Heal operations (org-admin) + startup backfill ----------------------------------------

/** Rebuild one org's index from its vault (admin heal). Synchronous + deterministic in v1;
 *  clears the org partition then re-indexes every vault file. */
export async function reindexOrg(actor: Actor): Promise<{ started: boolean }> {
  assertNotSharedActor(actor);
  await index.ensureIndexDir();
  index.clearOrg(actor.orgId);
  await indexOrgFromVault(actor.orgId);
  return { started: true };
}

export function indexStatus(actor: Actor): { status: string; documentCount: number; collectionCount: number } {
  const s = index.orgStatus(actor.orgId);
  return { status: 'ready', documentCount: s.documentCount, collectionCount: s.collectionCount };
}

/** Read every vault file for an org and (re)index it. Batched through {@link index.bulkIndexDocs}
 *  (one transaction per 1000 docs) so a large org rebuild is not thousands of separate commits. */
async function indexOrgFromVault(orgId: string): Promise<number> {
  const BATCH = 1000;
  const docs = await vault.listAllDocs(orgId);
  let n = 0;
  let batch: index.IndexRow[] = [];
  const flush = () => {
    if (batch.length === 0) return;
    index.bulkIndexDocs(batch);
    n += batch.length;
    batch = [];
  };
  for (const d of docs) {
    const parsed = await vault.readDoc(orgId, d.collection, d.docId);
    if (!parsed) continue;
    batch.push({
      orgId,
      collection: d.collection,
      docId: d.docId,
      title: parsed.fm.title,
      body: parsed.body,
      createdAt: parsed.fm.createdAt,
      sourceUrl: parsed.fm.sourceUrl,
      sourceType: parsed.fm.sourceType,
      language: parsed.fm.language,
    });
    if (batch.length >= BATCH) flush();
  }
  flush();
  return n;
}

/** Startup backfill (ch04 §4.4.1): the FTS index is derived data that must persist across
 *  restarts. If it is present and non-empty we keep it; if it is missing/empty we rebuild it
 *  from the filesystem corpus. Returns the number of documents (re)indexed. Wire this into
 *  server.ts bootState (reported to the lead). */
export async function backfillKnowledgeIndex(opts: { force?: boolean } = {}): Promise<{ indexed: number; skipped: boolean }> {
  await index.ensureIndexDir();
  if (!opts.force && index.totalRows() > 0) return { indexed: 0, skipped: true };
  let indexed = 0;
  for (const orgId of await vault.listOrgIds()) {
    indexed += await indexOrgFromVault(orgId);
  }
  return { indexed, skipped: false };
}
