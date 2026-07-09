/**
 * Knowledge router (ch03 §3.8.20). Org-partitioned vault CRUD, sources, uploads, and the
 * org-admin heal operations. No human search endpoint by design — agents consume search/read via
 * in-process tools (the grounding builder), not REST. Persistence via the knowledge service.
 */
import { Router, raw as expressRaw, type Response } from 'express';
import { z } from 'zod';
import { CreateDocumentRequest, SourceInput as SourceInputSchema } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import {
  listSources, addSource, deleteSource, updateSource, getVisibleSource, sourceView, KnowledgeError,
  ingestDocument, listDocuments, listCollections, deleteDocument,
  createUpload, listUploads, deleteUpload, reindexOrg, indexStatus,
} from '../knowledge/service.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';

const SourceInput = z.object({ url: z.string(), kind: z.string().optional(), seedId: z.string().optional() });
const DocumentsQuery = z.object({
  collection: z.string().optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

// 50 MB default upload ceiling (ch03 §3.8.20 / ch03 §3.2).
const UPLOAD_LIMIT = process.env.EKOA_KNOWLEDGE_UPLOAD_MAX_SIZE || '50mb';

export function knowledgeRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  // --- Collections + documents ---
  r.get('/collections', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listCollections(actorOf(req)) });
  });

  r.get('/documents', async (req: AuthedRequest, res: Response) => {
    const q = DocumentsQuery.safeParse(req.query);
    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: q.error.issues });
    res.json(await listDocuments(actorOf(req), q.data));
  });

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
    const ok = await deleteDocument(actorOf(req), req.params.collection as string, req.params.id as string);
    if (!ok) return notFound(res);
    res.json({ ok: true });
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
    const out = await reindexOrg(actorOf(req));
    res.status(202).json(out);
  });

  r.get('/index-status', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    res.json(indexStatus(actorOf(req)));
  });

  return r;
}
