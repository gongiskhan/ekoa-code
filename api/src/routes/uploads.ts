/**
 * Chat-attachment staging router (`shared/src/uploads.ts`, WS4a). One route: raw file body +
 * `X-Filename` (required) / `X-Folder` (optional, a picked folder's batch) headers, same protocol
 * as `routes/knowledge.ts`'s `/uploads` sub-route. Platform-session only (`auth: 'user'` in the
 * descriptor - no gateway-key admission): a composer attachment is a dashboard-only act.
 */
import { Router, raw as expressRaw, type Response } from 'express';
import { UploadResult } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { actorOf, sendError } from './helpers.js';
import { stageUpload } from '../uploads/service.js';

// Same default ceiling as knowledge uploads (routes/knowledge.ts); composer attachments are
// smaller in practice but share the risk profile (one authenticated user's raw POST body).
const UPLOAD_LIMIT = process.env.EKOA_UPLOAD_MAX_SIZE || '50mb';

export function uploadsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.post('/', expressRaw({ type: '*/*', limit: UPLOAD_LIMIT }), async (req: AuthedRequest, res: Response) => {
    const rawName = req.headers['x-filename'];
    if (typeof rawName !== 'string' || !rawName) return sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Filename em falta.');
    let filename = rawName;
    try { filename = decodeURIComponent(rawName); } catch { /* keep raw */ }
    const folderHeader = req.headers['x-folder'];
    const folder = typeof folderHeader === 'string' && folderHeader ? folderHeader : undefined;
    // A non-Buffer body with a non-zero Content-Length means another parser consumed the stream
    // (same guard as knowledge.ts's upload route - the raw-body middleware above should always
    // win against Content-Type: application/octet-stream, but never trust that silently).
    const declaredLen = parseInt((req.headers['content-length'] as string | undefined) || '0', 10) || 0;
    if (!Buffer.isBuffer(req.body) && declaredLen > 0) {
      return sendError(res, 'VALIDATION_FAILED', 'Corpo do pedido inválido (foi consumido por outro parser).');
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const out = await stageUpload(actorOf(req).userId, { filename, folder, bytes }, deps);
    const parsed = UploadResult.parse(out); // shape guard: the response MUST match the contract
    res.status(201).json(parsed);
  });

  return r;
}
