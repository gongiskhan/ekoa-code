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
 *
 * SLICE E5 adds the two READ capabilities the vault always had in-process (the agents' knowledge
 * tools) but never exposed over REST: {@link searchDocuments} and {@link readDocument}. They add
 * no storage and no new query — they wrap the SAME index/vault calls the agent seams use, with
 * the capability-surface obligations bolted on: the org comes from the call context's actor and
 * from nowhere else, the reserved `_shared` partition can never BE that actor, and every call
 * leaves one activity row plus one structured console line.
 */
import { knowledgeSources, knowledgeUploads } from '../data/stores.js';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';
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
 *
 * E5 tightens the invariant from "cannot MUTATE the corpus" to "is never a request actor at all":
 * the two capability reads refuse it as well (via {@link assertNotSharedOrg}). Nothing legitimate
 * is lost — every org's search already consults `_shared` and every org can read a `_shared`
 * document, so the corpus stays fully readable; what is refused is a caller CLAIMING to be it.
 */
function sharedActorRefusal(): KnowledgeError {
  return new KnowledgeError('FORBIDDEN', 403, 'A coleção partilhada é só de leitura.');
}

function assertNotSharedOrg(orgId: string): void {
  if (orgId === SHARED_ORG_ID) throw sharedActorRefusal();
}

function assertNotSharedActor(actor: Actor): void {
  assertNotSharedOrg(actor.orgId);
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

/**
 * The two browse reads. `assertNotSharedActor` here is not about the corpus being secret — it is
 * public and every org reads it — but about the invariant that NO request actor is ever the shared
 * partition. Keeping it uniform across every endpoint an actor can reach means the property is
 * "presenting `_shared` is refused", with no endpoint-by-endpoint exceptions to reason about.
 */
export async function listDocuments(
  actor: Actor,
  opts: { collection?: string; offset?: number; limit?: number },
): Promise<{ items: ReturnType<typeof toSummary>[]; total: number }> {
  assertNotSharedActor(actor);
  const { items, total } = await vault.listDocs(actor.orgId, opts);
  return { items: items.map((d) => toSummary(d)), total };
}

export async function listCollections(actor: Actor): Promise<string[]> {
  assertNotSharedActor(actor);
  return vault.listCollections(actor.orgId);
}

/**
 * Read a document, consulting the caller's own vault first and the shared corpus as a fallback: an
 * org doc SHADOWS a shared doc on the same (collection, docId). A shared-scope caller reads the
 * shared partition once (no double read). This backs the in-process knowledge read tool so an agent
 * can open a shared-corpus citation it surfaced via {@link searchKnowledgeIndex}.
 *
 * `scope` (E5) names WHICH partition answered, mirroring the same field on a search hit. It is
 * derived here rather than re-deriving the fallback at the caller: the shadowing rule must have
 * exactly one implementation. The org id itself is never returned — a caller learns "yours" or
 * "public", never an identifier.
 */
export async function readDocWithShared(
  orgId: string,
  collection: string,
  docId: string,
): Promise<{ fm: vault.DocFrontmatter; body: string; scope: 'org' | 'shared' } | null> {
  const own = await vault.readDoc(orgId, collection, docId);
  if (own) return { ...own, scope: orgId === SHARED_ORG_ID ? 'shared' : 'org' };
  if (orgId === SHARED_ORG_ID) return null;
  const shared = await vault.readDoc(SHARED_ORG_ID, collection, docId);
  return shared ? { ...shared, scope: 'shared' } : null;
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

// --- The capability READ surface (slice E5) -------------------------------------------------

/** Key principal marker (res.locals.apiKeyPrincipal) — present only on key-admitted calls. */
export interface KnowledgePrincipal {
  keyId: string;
  xClient?: string;
}

export type KnowledgeVerdict = 'ok' | 'denied' | 'not_found' | 'forbidden' | 'error';

/**
 * Everything a capability call is allowed to know about itself. The org lives on `actor` and is
 * put there by the auth middleware from a verified JWT or a verified key's OWNER — there is
 * deliberately no other channel into these functions, so no request field can reach the partition
 * selection.
 */
export interface KnowledgeCallContext {
  actor: ActivityActor;
  deps: LogActivityDeps;
  principal?: KnowledgePrincipal | undefined;
}

/**
 * One activity row + one structured console line per capability call (the E2/E3 memvault shape).
 *
 * What is NOT recorded: the query text and the document body. A search string on this surface is
 * a client's confidential matter ("penhora Cliente X"), and the durable audit store is the wrong
 * place for it; the row carries the SHAPE of the call (op, verdict, hit count, addressed
 * collection/docId) which is what an attribution or abuse question actually needs.
 */
async function auditKnowledge(
  ctx: KnowledgeCallContext,
  op: string,
  verdict: KnowledgeVerdict,
  t0: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const ms = Date.now() - t0;
  const key = ctx.principal
    ? { keyId: ctx.principal.keyId, ...(ctx.principal.xClient ? { xClient: ctx.principal.xClient } : {}) }
    : {};
  await logActivity(ctx.actor, 'knowledge', `knowledge_${op}`, ctx.deps, { op, verdict, ms, ...key, ...extra });
  console.log(
    JSON.stringify({ ts: new Date(ctx.deps.now()).toISOString(), userId: ctx.actor.userId, ...key, op, ...extra, verdict, ms }),
  );
}

/**
 * Audit a refusal that never reached an op — a router-level schema rejection (a traversal-shaped
 * collection, an empty query). Without this the highest-signal events on the surface would be a
 * 400 and total silence in the trail (the E2 review F3 lesson, applied here up front). `attempt`
 * is attacker-controlled text: length-capped, only ever recorded, never resolved, never echoed.
 */
export async function auditKnowledgeDenied(ctx: KnowledgeCallContext, op: string, attempt?: string): Promise<void> {
  await auditKnowledge(ctx, op, 'denied', Date.now(), attempt ? { attempt: attempt.slice(0, 128) } : {});
}

/** Default page size for a capability search when the caller does not ask for one. */
export const SEARCH_DEFAULT_LIMIT = 10;
/**
 * A collection filter is applied AFTER the index query, because the FTS query has no collection
 * predicate and adding one would change the shape the agent tools already depend on. So a filtered
 * search over-fetches and narrows. The consequence is stated rather than hidden: for an org whose
 * matches for a term are dominated by other collections, a filtered search can under-report — it
 * is a relevance-ordered narrowing, not a `WHERE collection = ?` scan.
 */
const COLLECTION_OVERFETCH = 20;
const COLLECTION_OVERFETCH_MAX = 500;

/**
 * Search the caller's own partition + the shared corpus. Thin over {@link index.search}, which is
 * the SAME function the in-process agent tool calls: org partitioning is in its signature, so a
 * cross-org hit is structurally impossible rather than filtered out afterwards.
 */
export async function searchDocuments(
  ctx: KnowledgeCallContext,
  input: { query: string; limit?: number; collection?: string },
): Promise<{ hits: index.SearchHit[] }> {
  const t0 = Date.now();
  const { orgId } = ctx.actor;
  if (orgId === SHARED_ORG_ID) {
    await auditKnowledge(ctx, 'search', 'forbidden', t0);
    throw sharedActorRefusal();
  }
  const limit = input.limit ?? SEARCH_DEFAULT_LIMIT;
  try {
    const want = input.collection ? Math.min(limit * COLLECTION_OVERFETCH, COLLECTION_OVERFETCH_MAX) : limit;
    const raw = index.search(orgId, input.query, want);
    const hits = input.collection ? raw.filter((h) => h.collection === input.collection).slice(0, limit) : raw;
    await auditKnowledge(ctx, 'search', 'ok', t0, {
      hits: hits.length,
      ...(input.collection ? { collection: input.collection } : {}),
    });
    return { hits };
  } catch (e) {
    await auditKnowledge(ctx, 'search', 'error', t0);
    // Server-side only: a sqlite message can name absolute paths, so it never reaches the wire.
    console.error('[knowledge] search', e instanceof Error ? e.message : e);
    throw new KnowledgeError('INTERNAL', 500, 'Erro interno.');
  }
}

/** The wire view of one document: the list summary a client already knows + body + partition. */
export interface KnowledgeDocumentView {
  id: string;
  collection: string;
  title: string;
  sourceUrl?: string;
  sourceType?: string;
  language?: string;
  createdAt?: string;
  scope: 'org' | 'shared';
  contentMd: string;
}

/**
 * Read one document by (collection, docId), the caller's own partition shadowing the shared
 * corpus. A missing document, an unreadable one and a document belonging to another org are the
 * SAME null here and the same uniform 404 on the wire — there is no cross-org existence oracle.
 * Path safety is the vault's (docPath asserts every segment); the contract-level grammar refuses
 * the same shapes one layer earlier.
 */
export async function readDocument(
  ctx: KnowledgeCallContext,
  collection: string,
  docId: string,
): Promise<KnowledgeDocumentView | null> {
  const t0 = Date.now();
  const { orgId } = ctx.actor;
  const addressed = { collection, docId };
  if (orgId === SHARED_ORG_ID) {
    await auditKnowledge(ctx, 'read', 'forbidden', t0, addressed);
    throw sharedActorRefusal();
  }
  let doc: Awaited<ReturnType<typeof readDocWithShared>>;
  try {
    doc = await readDocWithShared(orgId, collection, docId);
  } catch (e) {
    await auditKnowledge(ctx, 'read', 'error', t0, addressed);
    console.error('[knowledge] read', e instanceof Error ? e.message : e);
    throw new KnowledgeError('INTERNAL', 500, 'Erro interno.');
  }
  if (!doc) {
    await auditKnowledge(ctx, 'read', 'not_found', t0, addressed);
    return null;
  }
  await auditKnowledge(ctx, 'read', 'ok', t0, { ...addressed, scope: doc.scope });
  return {
    id: docId,
    collection,
    title: doc.fm.title,
    ...(doc.fm.sourceUrl ? { sourceUrl: doc.fm.sourceUrl } : {}),
    ...(doc.fm.sourceType ? { sourceType: doc.fm.sourceType } : {}),
    ...(doc.fm.language ? { language: doc.fm.language } : {}),
    // A vault file written by any path this service owns always carries createdAt; a hand-placed
    // or legacy corpus file may not, and the contract's IsoTimestamp would reject an empty string.
    ...(doc.fm.createdAt ? { createdAt: doc.fm.createdAt } : {}),
    scope: doc.scope,
    contentMd: doc.body,
  };
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
