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
 *
 * WS8a fixes a visibility bug, not a storage one: the 262k-document `_shared` legal corpus was
 * always searchable (search already unions org + `_shared`) but never BROWSABLE - {@link
 * listCollections}/{@link listDocuments} only ever listed the caller's own org vault, so an org
 * with zero private uploads saw an empty Biblioteca even though the shared corpus was fully
 * populated. Both gain an additive `scope` option (default `'org'`, unchanged); `'shared'`
 * redirects the same read to the `_shared` partition. No write path gains this option.
 */
import { knowledgeSources, knowledgeUploads } from '../data/stores.js';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';
import { assertSafeUrl, SsrfError } from '../services/url-safety.js';
import { IsoTimestamp, type Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';
import * as vault from './vault.js';
import * as index from './index-store.js';
import { PathSafetyError, uploadBlobPath, uploadsDir, knowledgeRoot, SHARED_ORG_ID } from './paths.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { relative } from 'node:path';

/** A URL template expanded over a numeric range (WS8c) - mirrors the shared `SeedTemplate`. */
export interface SeedTemplate {
  url: string;
  from: number;
  to: number;
  step?: number;
}

/** One Domino database a `kind: 'domino'` source's harvest walks (WS8c). */
export interface DominoDatabase {
  db: string;
  view?: string;
  maxPages?: number;
}

/** A Lotus Domino harvest config (WS8c) - see `crawl/domino.ts`. */
export interface DominoSourceConfig {
  baseUrl: string;
  view?: string;
  count?: number;
  databases: DominoDatabase[];
}

/** One crawl/refresh run's outcome (WS8c) - mirrors the shared `KnowledgeCrawlSummary`. */
export interface KnowledgeCrawlSummary {
  fetched: number;
  ingested: number;
  updated: number;
  unchanged: number;
  discovered: number;
  failed: number;
  capped: boolean;
  pendingRemaining?: number;
  durationMs: number;
  finishedAt: string;
  error?: string;
}

export interface KnowledgeSourceDoc extends Doc {
  orgId: string;
  url: string;
  label?: string;
  /** Source kind: anchor crawler (default when absent), JSON API-ingest (declared, NOT executed
   *  in this build - WS8c OPEN item), or Domino harvest. */
  kind?: 'crawl' | 'api' | 'domino';
  domino?: DominoSourceConfig;
  /** Internal idempotent-seed marker (WS8b/8c). Distinct from `seedTemplate` below - see the
   *  shared contract's doc comment on that field for the history of the two being conflated. */
  seedId?: string;
  collection?: string;
  /** Link-follow depth: 1 = the seed page's links; 2 = + the links on those pages. Unused by a
   *  Domino harvest (it walks ReadViewEntries pages, not anchors). */
  levels?: number;
  /** Per-RUN page/document budget (crawl: pages; domino: documents) - resumable, not a total cap. */
  maxPages?: number;
  scope?: 'same-domain' | 'any';
  enabled?: boolean;
  /** Render each page with the shared headless-browser pool before extracting (JS/SPA sources). */
  render?: boolean;
  userAgent?: string;
  seeds?: string[];
  seedTemplate?: SeedTemplate | null;
  /** WS8c: an honest, human-readable reason a seeded source ships `enabled: false` (e.g. a
   *  wholesale failure on its last live run this build could not diagnose offline). */
  disabledReason?: string;
  lastCrawledAt?: string;
  lastRefreshAt?: string;
  lastResult?: KnowledgeCrawlSummary | null;
  /** WS8b legacy free-form escape hatch, superseded by the typed fields above (kept optional for
   *  any pre-WS8c row that still carries it; no longer written). */
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
/**
 * ONE message for every refusal of a `_shared` actor, and it names the actual reason (E5 review
 * F6): the first cut said "é só de leitura", which is true of the corpus but wrong as the answer to
 * a READ — a caller refused on GET would read it as "this document is read-only" rather than "your
 * organisation identity is not a valid one". The invariant being enforced is about WHO is calling.
 */
function sharedActorRefusal(): KnowledgeError {
  return new KnowledgeError('FORBIDDEN', 403, 'A coleção partilhada não pode ser a organização do pedido.');
}

function assertNotSharedOrg(orgId: string): void {
  if (orgId === SHARED_ORG_ID) throw sharedActorRefusal();
}

function assertNotSharedActor(actor: Actor): void {
  assertNotSharedOrg(actor.orgId);
}

// --- Sources (G4; crawl policy fields WS8c) -------------------------------------------------

/** Per-run page/document budget ceiling (WS8c, matches ekoa-dev's tuned value - the crawl is
 *  resumable, so a big source is harvested across many runs rather than raising this further). */
const MAX_PAGES_CEILING = 200_000;
const MAX_LEVELS = 4;
const MAX_SEEDS = 5000;
const MAX_TEMPLATE_SEEDS = 100_000;

function safeUrlOrThrow(url: string, field = 'URL'): void {
  try {
    assertSafeUrl(url);
  } catch (e) {
    if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, `${field} não permitido.`);
    throw e;
  }
}

/** Validate an explicit seed list: http(s) + SSRF-safe URLs, bounded count. Undefined when
 *  absent/empty so the field is simply omitted. */
function validateSeeds(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new KnowledgeError('VALIDATION_FAILED', 400, 'seeds deve ser uma lista de URLs.');
  const seeds: string[] = [];
  for (const item of raw) {
    const u = typeof item === 'string' ? item.trim() : '';
    if (!u) continue;
    safeUrlOrThrow(u, 'seed');
    seeds.push(u);
  }
  if (seeds.length > MAX_SEEDS) throw new KnowledgeError('VALIDATION_FAILED', 400, `seeds: máximo ${MAX_SEEDS}.`);
  return seeds.length ? seeds : undefined;
}

/** Validate a seed template. Only the FIRST expansion is SSRF-checked (the host is constant
 *  across the range); bounded so a malformed record can never spin the expansion forever. */
function validateSeedTemplate(raw: SeedTemplate | null | undefined): SeedTemplate | undefined {
  if (raw === undefined || raw === null) return undefined;
  const { url, from, to, step } = raw;
  if (!url || !/\{n\}/i.test(url)) throw new KnowledgeError('VALIDATION_FAILED', 400, 'seedTemplate.url deve conter o marcador {n}.');
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) {
    throw new KnowledgeError('VALIDATION_FAILED', 400, 'seedTemplate: from/to inválidos (inteiros, from <= to).');
  }
  const stepN = step === undefined ? 1 : step;
  if (!Number.isSafeInteger(stepN) || stepN < 1) throw new KnowledgeError('VALIDATION_FAILED', 400, 'seedTemplate.step deve ser >= 1.');
  const count = Math.floor((to - from) / stepN) + 1;
  if (count > MAX_TEMPLATE_SEEDS) {
    throw new KnowledgeError('VALIDATION_FAILED', 400, `seedTemplate: expande para ${count} URLs (máximo ${MAX_TEMPLATE_SEEDS}).`);
  }
  safeUrlOrThrow(url.replace(/\{n\}/gi, String(from)), 'seedTemplate.url');
  return { url, from, to, step: stepN };
}

/** Validate a Domino harvest config (WS8c). */
function validateDomino(raw: DominoSourceConfig | undefined): DominoSourceConfig | undefined {
  if (raw === undefined) return undefined;
  safeUrlOrThrow(raw.baseUrl, 'domino.baseUrl');
  if (!Array.isArray(raw.databases) || raw.databases.length === 0) {
    throw new KnowledgeError('VALIDATION_FAILED', 400, 'domino.databases é obrigatório.');
  }
  if (raw.databases.length > 50) throw new KnowledgeError('VALIDATION_FAILED', 400, 'domino.databases: máximo 50.');
  for (const d of raw.databases) {
    if (!d.db || !/^[a-zA-Z0-9._/-]+\.nsf$/i.test(d.db)) {
      throw new KnowledgeError('VALIDATION_FAILED', 400, `domino.databases: db inválido (ex.: jstj.nsf): ${d.db}`);
    }
  }
  return raw;
}

export interface SourcePolicyInput {
  url: string;
  label?: string;
  kind?: 'crawl' | 'api' | 'domino';
  collection?: string;
  levels?: number;
  maxPages?: number;
  scope?: 'same-domain' | 'any';
  enabled?: boolean;
  render?: boolean;
  userAgent?: string;
  seeds?: string[];
  seedTemplate?: SeedTemplate | null;
  domino?: DominoSourceConfig;
  seedId?: string;
  disabledReason?: string;
}

/** Validate + normalize a full/partial source policy (WS8c). `partial` skips defaulting absent
 *  fields (used by `updateSource`, which merges onto the stored record) vs. filling them (used
 *  by `addSource`, which needs a complete row). Throws `KnowledgeError('VALIDATION_FAILED', ...)`
 *  on any invalid PRESENT field - mirrors ekoa-dev's `normalizeSourceInput`/`normalizeSourcePatch`. */
function normalizePolicy(input: Partial<SourcePolicyInput>, opts: { partial: boolean }): Partial<KnowledgeSourceDoc> {
  const out: Partial<KnowledgeSourceDoc> = {};

  if (input.url !== undefined) {
    safeUrlOrThrow(input.url);
    out.url = input.url;
  }
  if (input.label !== undefined) out.label = input.label;
  else if (!opts.partial && input.url) {
    // A source with no explicit label falls back to its hostname (matches ekoa-dev's
    // normalizeSourceInput default) so a hand-created source never renders a blank card title.
    try { out.label = new URL(input.url).hostname.replace(/^www\./, ''); } catch { /* url already validated above */ }
  }
  if (input.collection !== undefined) out.collection = input.collection;

  if (input.levels !== undefined || !opts.partial) {
    const levels = input.levels ?? 1;
    if (!Number.isInteger(levels) || levels < 1 || levels > MAX_LEVELS) {
      throw new KnowledgeError('VALIDATION_FAILED', 400, `levels deve ser entre 1 e ${MAX_LEVELS}.`);
    }
    out.levels = levels;
  }
  if (input.maxPages !== undefined || !opts.partial) {
    let maxPages = input.maxPages ?? 2000;
    if (!Number.isFinite(maxPages) || maxPages < 1) throw new KnowledgeError('VALIDATION_FAILED', 400, 'maxPages deve ser um inteiro positivo.');
    if (maxPages > MAX_PAGES_CEILING) maxPages = MAX_PAGES_CEILING;
    out.maxPages = maxPages;
  }
  if (input.scope !== undefined || !opts.partial) {
    const scope = input.scope ?? 'same-domain';
    if (scope !== 'same-domain' && scope !== 'any') throw new KnowledgeError('VALIDATION_FAILED', 400, "scope deve ser 'same-domain' ou 'any'.");
    out.scope = scope;
  }
  if (input.enabled !== undefined) out.enabled = input.enabled;
  else if (!opts.partial) out.enabled = true;
  if (input.render !== undefined) out.render = input.render;
  else if (!opts.partial) out.render = false;
  if (input.userAgent !== undefined) out.userAgent = input.userAgent;
  if (input.seeds !== undefined) out.seeds = validateSeeds(input.seeds) ?? [];
  if (input.seedTemplate !== undefined) out.seedTemplate = validateSeedTemplate(input.seedTemplate) ?? null;
  if (input.domino !== undefined) out.domino = validateDomino(input.domino);
  if (input.disabledReason !== undefined) out.disabledReason = input.disabledReason;

  // kind is inferred from the config supplied, else the explicit value.
  let kind = input.kind;
  if (input.domino) kind = 'domino';
  if (kind !== undefined) {
    if (kind === 'domino' && !(input.domino ?? out.domino)) {
      throw new KnowledgeError('VALIDATION_FAILED', 400, 'fonte domino requer configuração domino.databases.');
    }
    out.kind = kind;
  }

  return out;
}

/**
 * Wire view of a source (WS8c: the full crawl-policy surface, not just the G4 fields). `enabled`
 * defaults to true - a source with no explicit flag has always been crawled/considered, so `true`
 * is the honest read.
 */
export function sourceView(s: KnowledgeSourceDoc) {
  return {
    id: s._id,
    url: s.url,
    type: s.kind,
    collection: s.collection,
    enabled: s.enabled ?? true,
    ...(s.label ? { label: s.label } : {}),
    ...(s.levels !== undefined ? { levels: s.levels } : {}),
    ...(s.maxPages !== undefined ? { maxPages: s.maxPages } : {}),
    // Wire name `crawlScope` (never `scope` - reserved on this domain for the browse partition).
    ...(s.scope ? { crawlScope: s.scope } : {}),
    ...(s.render !== undefined ? { render: s.render } : {}),
    ...(s.userAgent ? { userAgent: s.userAgent } : {}),
    ...(s.seeds && s.seeds.length ? { seeds: s.seeds } : {}),
    seedTemplate: s.seedTemplate ?? null,
    ...(s.domino ? { domino: s.domino } : {}),
    ...(s.seedId ? { seedId: s.seedId } : {}),
    ...(s.disabledReason ? { disabledReason: s.disabledReason } : {}),
    ...(s.lastCrawledAt ? { lastCrawledAt: s.lastCrawledAt } : {}),
    ...(s.lastRefreshAt ? { lastRefreshAt: s.lastRefreshAt } : {}),
    ...(s.lastResult ? { lastResult: s.lastResult } : {}),
  };
}

export async function listSources(actor: Actor): Promise<KnowledgeSourceDoc[]> {
  return knowledgeSources.find({ orgId: actor.orgId }) as Promise<KnowledgeSourceDoc[]>;
}

export async function addSource(actor: Actor, input: SourcePolicyInput, deps: Deps): Promise<KnowledgeSourceDoc> {
  const norm = normalizePolicy(input, { partial: false });
  const id = deps.genId();
  const doc: KnowledgeSourceDoc = { _id: id, orgId: actor.orgId, url: input.url, ...norm };
  await knowledgeSources.insert(doc as never);
  return doc;
}

export async function getVisibleSource(actor: Actor, id: string): Promise<KnowledgeSourceDoc | null> {
  const s = (await knowledgeSources.get(id)) as KnowledgeSourceDoc | null;
  if (!s || s.orgId !== actor.orgId) return null; // cross-org → uniform 404
  return s;
}

/** Patch a source (F5, extended WS8c). Cross-org reads as not-found (uniform 404) before any
 *  write. A changed `url`/`seeds`/`seedTemplate`/`domino.baseUrl` is SSRF-validated exactly as
 *  `addSource` does - a patch must not be a bypass of that gate. */
export async function updateSource(actor: Actor, id: string, patch: Partial<SourcePolicyInput>): Promise<KnowledgeSourceDoc | null> {
  const s = await getVisibleSource(actor, id);
  if (!s) return null;
  const next = normalizePolicy(patch, { partial: true });
  return (await knowledgeSources.update(id, (cur) => ({ ...cur, ...next } as never))) as unknown as KnowledgeSourceDoc | null;
}

/** Patch crawl-state fields without re-validating the policy (WS8c - used by the crawl runner). */
export async function patchSourceState(
  id: string,
  patch: Partial<Pick<KnowledgeSourceDoc, 'lastCrawledAt' | 'lastRefreshAt' | 'lastResult'>>,
): Promise<void> {
  await knowledgeSources.update(id, (cur) => ({ ...cur, ...patch } as never));
}

/**
 * Look up a source by RAW id, no org filter (WS8c). Only for the crawl runner: `routes/
 * knowledge.ts` always checks `getVisibleSource(actor, id)` (org ownership) BEFORE ever starting
 * a crawl, so by the time the runner calls this the id is already proven to belong to the
 * caller's org - the runner then re-fetches by this unscoped lookup (rather than a closure over
 * the route's pre-fetch) so a long-running crawl sees the CURRENT row if it's edited/disabled
 * mid-run, not a stale snapshot from when it was triggered. `routes/` may not import `data/`
 * directly (FIXED-1 module tiers), so this is the domain-module seam it goes through instead.
 */
export async function getSourceByIdUnscoped(id: string): Promise<KnowledgeSourceDoc | null> {
  return (await knowledgeSources.get(id)) as KnowledgeSourceDoc | null;
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

/** F43: `listDocuments`'s browse row, sourced from `index.listDocsPage` (SQLite, never the
 *  filesystem) - see that function's doc for why `size` is deliberately absent here. */
function toSummary(d: index.IndexDocSummary, scope?: 'org' | 'shared') {
  return {
    id: d.docId,
    collection: d.collection,
    title: d.title,
    sourceUrl: d.sourceUrl,
    sourceType: d.sourceType,
    language: d.language,
    createdAt: d.createdAt,
    ...(scope ? { scope } : {}),
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
 *
 * WS8a - `opts.scope`: additive, defaults to `'org'` (byte-identical to the pre-WS8a behaviour -
 * the caller's own vault only). `'shared'` redirects the SAME browse to the reserved `_shared`
 * partition instead, read-only: neither function ever accepts a scope on a write path (ingest,
 * delete, upload all still address `actor.orgId` unconditionally), so there is no route through
 * this option that can mutate the corpus. Auth stays `user-or-key` for both scopes - no extra
 * gate - because every org's search already unions `_shared` for any authenticated actor (see
 * {@link searchDocuments}); browsing it explicitly grants no capability a caller did not already
 * have. `assertNotSharedActor` still refuses a caller whose OWN orgId is `_shared` regardless of
 * `opts.scope` - that invariant is about who is calling, not which partition they asked to browse.
 *
 * F43: paginated from `index.listDocsPage` (SQLite, indexed) rather than `vault.listDocs`
 * (filesystem, O(corpus) per page). The two are required to answer identically because they are
 * two views of the SAME data - the index is written transactionally alongside every vault write
 * (`ingestDocument`, `createUpload`, the crawler's ingest, `indexOrgFromVault`'s backfill), the
 * same trust the search capability has always placed in the index. Live-verified against the
 * operator's real 262,672-document `_shared` corpus: the identical `scope=shared&limit=20` call
 * dropped from ~57s to sub-second.
 */
export async function listDocuments(
  actor: Actor,
  opts: { collection?: string; offset?: number; limit?: number; scope?: 'org' | 'shared' },
): Promise<{ items: ReturnType<typeof toSummary>[]; total: number }> {
  assertNotSharedActor(actor);
  const shared = opts.scope === 'shared';
  const { items, total } = index.listDocsPage(shared ? SHARED_ORG_ID : actor.orgId, opts);
  return { items: items.map((d) => toSummary(d, shared ? 'shared' : 'org')), total };
}

export async function listCollections(actor: Actor, opts: { scope?: 'org' | 'shared' } = {}): Promise<string[]> {
  assertNotSharedActor(actor);
  return vault.listCollections(opts.scope === 'shared' ? SHARED_ORG_ID : actor.orgId);
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

/**
 * Audit a BROWSE read (list collections / list documents) — but ONLY when a gateway key made the
 * call. E5 review F1: the first cut left these two silent, and a leaked key could then page
 * `GET /documents?limit=500&offset=N` and harvest every document TITLE, collection and size for
 * the whole org with ZERO rows in activity_logs. Incident response could not say which key did it,
 * or that it happened at all. In a legal vault a title ("Insolvência — Cliente X") carries the same
 * confidentiality as the search string this module deliberately refuses to log, so an enumeration
 * of all of them is exactly the event the trail must hold.
 *
 * The key gate is what makes it affordable rather than a per-page-load write: a browser session
 * (JWT, no principal) is not audited here, so the dashboard's behaviour is byte-for-byte what it
 * was, while every non-browser client this slice newly admitted is fully attributed. The gate lives
 * HERE, once, so the routes cannot each re-decide it.
 *
 * `count`/`total`/`offset`/`limit` are recorded because the SHAPE of the paging is the harvest
 * signal; the titles themselves never are.
 */
export async function auditKnowledgeBrowse(
  ctx: KnowledgeCallContext,
  op: 'collections' | 'list',
  t0: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!ctx.principal) return;
  await auditKnowledge(ctx, op, 'ok', t0, extra);
}

/** Default page size for a capability search when the caller does not ask for one. */
export const SEARCH_DEFAULT_LIMIT = 10;
/**
 * A collection filter is applied AFTER the index query, because the FTS query has no collection
 * predicate and adding one would change the shape the agent tools already depend on. So a filtered
 * search over-fetches and narrows. The consequence is stated rather than hidden — and it is stated
 * in the CONTRACT too (shared/src/knowledge.ts, KnowledgeSearchRequest.collection), because it
 * changes what a client gets back: for an org whose matches are dominated by other collections, a
 * filtered search can UNDER-REPORT. It is a relevance-ordered narrowing, not a `WHERE` scan.
 *
 * COST NOTE: `index.search` itself over-fetches by 4x internally before its authority re-rank, so
 * the ceiling below is rows ASKED FOR, not rows scanned — 500 here means up to 2000 rows with a
 * snippet() computed on each. That 4x is why the ceiling is 500 and not larger.
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
  /** The corpus's verbatim stamp when it is NOT RFC-3339 (see {@link createdAtFields}). */
  createdAtRaw?: string;
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
    ...createdAtFields(doc.fm.createdAt),
    scope: doc.scope,
    contentMd: doc.body,
  };
}

/**
 * Split a vault frontmatter stamp into the contract's fields (E5 review F2). Every document this
 * service writes carries an RFC-3339 `createdAt`, but the `_shared` corpus does NOT come from
 * here: the offline importer preserves the SOURCE's stamp verbatim (api/scripts/migrate/knowledge/
 * importer.ts), filling from mtime only when it is absent — so a legal corpus with date-only
 * stamps ("2020-01-01") reaches this function unchanged. Passing that through produced an HTTP 200
 * whose body FAILED its own KnowledgeDocumentResponse: `IsoTimestamp` is
 * `z.string().datetime({ offset: true })`, which a date-only value does not satisfy.
 *
 * The guard is the CONTRACT SCHEMA ITSELF rather than a hand-rolled regex, so the two cannot drift.
 * A stamp that does not validate is not silently dropped either — it moves to `createdAtRaw`, which
 * the contract declares as a plain string for exactly this case. The client gets a body that always
 * validates AND still sees what the corpus actually says.
 */
function createdAtFields(raw: string | undefined): { createdAt?: string; createdAtRaw?: string } {
  if (!raw) return {};
  return IsoTimestamp.safeParse(raw).success ? { createdAt: raw } : { createdAtRaw: raw.slice(0, 128) };
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
