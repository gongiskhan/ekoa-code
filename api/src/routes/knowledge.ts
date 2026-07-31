/**
 * Knowledge router (ch03 §3.8.20). Org-partitioned vault CRUD, sources, uploads, and the
 * org-admin heal operations. Persistence via the knowledge service.
 *
 * SLICE E5 — the router now has TWO admission tiers, and the split is the point:
 *
 *   1. A `user-or-key` CAPABILITY READ surface, mounted FIRST (Capability Contract rule 4):
 *      collections, the document list, search and read-one. A gateway-key client browses and
 *      reads; nothing here writes. Search/read are the same index/vault calls the in-process
 *      agent tools make (api/src/agents/), now reachable over REST — the in-process path is
 *      untouched, and neither surface takes an org from its arguments.
 *   2. Everything below `r.use(requireAuth)` — ingest, delete, sources, uploads and the
 *      org-admin heal ops — stays platform-session-only. Opening INGESTION to keys is a separate
 *      decision this slice does not make.
 *
 * Express runs middleware in mount order, so registering the tier-1 routes before the router-wide
 * `requireAuth` is what keeps the two tiers apart (the same shape automations.ts uses for its SSE
 * route). `requireUserOrApiKey` delegates to `requireAuth` untouched for a non-key bearer, so a
 * dashboard JWT reaches these four routes exactly as it did before.
 *
 * ORG SCOPE COMES FROM `actorOf(req)` AND NOWHERE ELSE. No handler here reads an org/tenant from a
 * body, query or header — there is no such field in any knowledge schema, and zod strips unknown
 * keys, so naming one is silently inert rather than influential.
 */
import { Router, raw as expressRaw, type Response } from 'express';
import { z } from 'zod';
import {
  CreateDocumentRequest,
  KnowledgeDocParams,
  KnowledgeSearchRequest,
  SourceInput as SourceInputSchema,
} from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { requireUserOrApiKey, type ApiKeyPrincipal } from '../auth/api-key-middleware.js';
import {
  listSources, addSource, deleteSource, updateSource, getVisibleSource, sourceView, KnowledgeError,
  ingestDocument, listDocuments, listCollections, deleteDocument,
  createUpload, listUploads, deleteUpload, reindexOrg, indexStatus,
  searchDocuments, readDocument, auditKnowledgeDenied, auditKnowledgeBrowse, type KnowledgeCallContext,
} from '../knowledge/service.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';

const SourceInput = z.object({ url: z.string(), kind: z.string().optional(), seedId: z.string().optional() });
const DocumentsQuery = z.object({
  collection: z.string().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

/** The Registo actor from the verified principal (logActivity needs a username, which the shared
 *  Actor type does not carry — same shape as routes/memvault.ts). */
function activityActorOf(req: AuthedRequest): { userId: string; username: string; orgId: string } {
  const u = req.user!;
  return { userId: u.sub, username: u.username ?? u.sub, orgId: u.orgId ?? '' };
}

/** The key principal a gateway-key admission left on res.locals — trace only (rule 3). */
function principalOf(res: Response): { keyId: string; xClient?: string } | undefined {
  const p = res.locals.apiKeyPrincipal as ApiKeyPrincipal | undefined;
  return p ? { keyId: p.keyId, ...(p.xClient ? { xClient: p.xClient } : {}) } : undefined;
}

/** Text a refused request was aiming at, for the audit line. Attacker-controlled: recorded
 *  (capped by the service) and never resolved, never echoed back on the wire. */
function attemptOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 128) : undefined;
}

// 50 MB default upload ceiling (ch03 §3.8.20 / ch03 §3.2).
const UPLOAD_LIMIT = process.env.EKOA_KNOWLEDGE_UPLOAD_MAX_SIZE || '50mb';

export function knowledgeRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  const ctxOf = (req: AuthedRequest, res: Response): KnowledgeCallContext => ({
    actor: activityActorOf(req),
    deps,
    principal: principalOf(res),
  });

  // =============================================================================================
  // TIER 1 — the `user-or-key` capability READ surface (slice E5). Mounted BEFORE the router-wide
  // requireAuth below; everything after it is platform-session-only.
  // =============================================================================================

  /**
   * The two BROWSE reads. They are audited only for a KEY-admitted caller (auditKnowledgeBrowse
   * owns that rule): a leaked key paging `/documents?limit=500&offset=N` harvests every document
   * title and collection in the org, and that must not be invisible to incident response — while a
   * dashboard page load, which is the same call under a JWT, must not write a row (E5 review F1).
   */
  r.get('/collections', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const t0 = Date.now();
    try {
      const items = await listCollections(actorOf(req));
      await auditKnowledgeBrowse(ctxOf(req, res), 'collections', t0, { count: items.length });
      res.json({ items });
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'FORBIDDEN', e.message);
      throw e;
    }
  });

  r.get('/documents', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const t0 = Date.now();
    const q = DocumentsQuery.safeParse(req.query);
    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: q.error.issues });
    try {
      const page = await listDocuments(actorOf(req), q.data);
      // The paging SHAPE is the harvest signal; the titles it returned are never recorded.
      await auditKnowledgeBrowse(ctxOf(req, res), 'list', t0, {
        count: page.items.length,
        total: page.total,
        ...(q.data.offset !== undefined ? { offset: q.data.offset } : {}),
        ...(q.data.limit !== undefined ? { limit: q.data.limit } : {}),
        ...(q.data.collection ? { collection: q.data.collection.slice(0, 128) } : {}),
      });
      res.json(page);
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'FORBIDDEN', e.message);
      throw e;
    }
  });

  /**
   * searchKnowledge — POST /api/v1/knowledge/search. The org partition rides the actor into the
   * service; `orgId` is not a field of KnowledgeSearchRequest, and zod strips unknown keys, so a
   * body/query/header naming one changes nothing about which partition is searched.
   *
   * Audited on EVERY call regardless of credential (one activity row + one structured console
   * line, refusals included) — unlike the two browse routes above, whose row is key-gated.
   */
  r.post('/search', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const body = KnowledgeSearchRequest.safeParse(req.body);
    if (!body.success) {
      const raw = req.body as { collection?: unknown } | null;
      await auditKnowledgeDenied(ctxOf(req, res), 'search', attemptOf(raw?.collection));
      return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: body.error.issues });
    }
    try {
      res.json(await searchDocuments(ctxOf(req, res), body.data));
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'FORBIDDEN', e.message);
      throw e;
    }
  });

  /**
   * readKnowledgeDoc — GET /api/v1/knowledge/documents/:collection/:docId. Two ordinary express
   * params: a collection and a docId are each ONE vault path segment (KnowledgeSegment mirrors
   * paths.ts SEGMENT_RE), so '/' is unrepresentable in either and no wildcard/query-param
   * workaround is needed — unlike memvault's multi-segment permalinks. Contract-invalid segments
   * (including '.' / '..') are a 400 here; a document that is missing, unreadable or another
   * org's is the identical uniform 404.
   */
  r.get('/documents/:collection/:docId', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const params = KnowledgeDocParams.safeParse(req.params);
    if (!params.success) {
      await auditKnowledgeDenied(ctxOf(req, res), 'read', attemptOf(`${req.params.collection}/${req.params.docId}`));
      return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: params.error.issues });
    }
    try {
      const doc = await readDocument(ctxOf(req, res), params.data.collection, params.data.docId);
      if (!doc) return notFound(res);
      res.json(doc);
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'FORBIDDEN', e.message);
      throw e;
    }
  });

  // =============================================================================================
  // TIER 2 — WRITE + admin, platform session only. A gateway key is refused here by omission:
  // requireAuth rejects an `ekoa_gk_` bearer as an unparseable JWT.
  // =============================================================================================
  r.use(requireAuth);

  r.post('/documents', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateDocumentRequest, req.body);
    if (!body) return;
    try {
      const out = await ingestDocument(actorOf(req), body, deps);
      res.status(201).json(out);
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'VALIDATION_FAILED', e.message);
      throw e;
    }
  });

  r.delete('/collections/:collection/documents/:id', async (req: AuthedRequest, res: Response) => {
    try {
      const ok = await deleteDocument(actorOf(req), req.params.collection as string, req.params.id as string);
      if (!ok) return notFound(res);
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'FORBIDDEN', e.message);
      throw e;
    }
  });

  // --- Sources (G4) ---
  r.get('/sources', async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listSources(actorOf(req))).map(sourceView) });
  });

  r.post('/sources', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SourceInput, req.body);
    if (!body) return;
    try {
      const s = await addSource(actorOf(req), body as { url: string; kind?: string; seedId?: string }, deps);
      res.status(201).json(sourceView(s));
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'VALIDATION_FAILED', e.message);
      throw e;
    }
  });

  // F5: patch a source (contract path). Cross-org reads as 404 before any write.
  r.patch('/sources/:id', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SourceInputSchema.partial(), req.body);
    if (body === undefined) return;
    try {
      const s = await updateSource(actorOf(req), req.params.id as string, body as never);
      if (!s) return notFound(res);
      res.json(sourceView(s));
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'VALIDATION_FAILED', e.message);
      throw e;
    }
  });

  /**
   * F5 crawl endpoints. There is NO crawler in this build. Per the F5 brief these answer their
   * declared shape with truthful "nothing happened" values — never a fabricated completed crawl.
   * A source the caller cannot see 404s first, so these do not leak another org's source ids.
   */
  r.post('/sources/:id/crawl', async (req: AuthedRequest, res: Response) => {
    const s = await getVisibleSource(actorOf(req), req.params.id as string);
    if (!s) return notFound(res);
    res.json({ started: false, alreadyRunning: false });
  });

  r.get('/sources/:id/crawl', async (req: AuthedRequest, res: Response) => {
    const s = await getVisibleSource(actorOf(req), req.params.id as string);
    if (!s) return notFound(res);
    res.json({ running: false, stats: { reason: 'crawler not implemented in this build' } });
  });

  // F5: no refresh scheduler exists — `null` is the honest schedule, not an invented cadence.
  r.get('/refresh-schedule', async (_req: AuthedRequest, res: Response) => {
    res.json({ schedule: null });
  });

  r.delete('/sources/:id', async (req: AuthedRequest, res: Response) => {
    const ok = await deleteSource(actorOf(req), req.params.id as string);
    if (!ok) return notFound(res);
    res.json({ ok: true });
  });

  // --- Uploads (raw file body + X-Filename / X-Collection headers) ---
  r.get('/uploads', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listUploads(actorOf(req)) });
  });

  r.post('/uploads', expressRaw({ type: '*/*', limit: UPLOAD_LIMIT }), async (req: AuthedRequest, res: Response) => {
    const rawName = req.headers['x-filename'];
    if (typeof rawName !== 'string' || !rawName) return sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Filename em falta.');
    let filename = rawName;
    try { filename = decodeURIComponent(rawName); } catch { /* keep raw */ }
    const collectionHeader = req.headers['x-collection'];
    const collection = typeof collectionHeader === 'string' && collectionHeader ? collectionHeader : undefined;
    const contentType = (req.headers['content-type'] as string | undefined) || 'application/octet-stream';
    // A non-Buffer body with a non-zero Content-Length means another parser consumed the stream.
    const declaredLen = parseInt((req.headers['content-length'] as string | undefined) || '0', 10) || 0;
    if (!Buffer.isBuffer(req.body) && declaredLen > 0) {
      return sendError(res, 'VALIDATION_FAILED', 'Corpo do pedido inválido (foi consumido por outro parser).');
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try {
      const out = await createUpload(actorOf(req), { filename, collection, contentType, bytes }, deps);
      res.status(201).json(out);
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'VALIDATION_FAILED', e.message);
      throw e;
    }
  });

  r.delete('/uploads/:id', async (req: AuthedRequest, res: Response) => {
    const out = await deleteUpload(actorOf(req), req.params.id as string);
    if (!out.removed) return notFound(res);
    res.json(out);
  });

  // --- Org-admin heal operations (backend-only, kept for ops — ch03 §3.8.20 C3) ---
  r.post('/reindex', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    try {
      const out = await reindexOrg(actorOf(req));
      res.status(202).json(out);
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'FORBIDDEN', e.message);
      throw e;
    }
  });

  r.get('/index-status', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    res.json(indexStatus(actorOf(req)));
  });

  return r;
}
