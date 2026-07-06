/**
 * App Files data plane (ch03 §3.9, FIXED-9) - binary upload/serve/delete for served apps,
 * backing `window.__ekoa.uploadFile` / `deleteFile`. Ported from cortex/src/routes/
 * app-files.ts + cortex/src/persistence/app-files.ts (A3 structural-template port).
 *
 * Scoping follows the app-data philosophy: no JWT, no per-user partition. Writes
 * (POST/DELETE) require the `X-Ekoa-App-Id` header injectAppContext stamps into every
 * served app; the returned `url` is a shareable relative serve path
 * `/api/app-files/{appId}/{id}`. Upload protocol: raw bytes in the body, metadata via
 * `X-Filename` (client encodeURIComponent's it; decoded + sanitized server-side) and
 * `Content-Type` (falls back to application/octet-stream). Amendment 2: every route
 * consults the artifact OWNER's activation (fail-closed CONV-2), exactly like served-data.
 *
 * Storage (carried convention): blobs live under the data dir, per-app, keyed by a
 * server-generated UUID (never the user-supplied name, so display names are never path
 * components): `<EKOA_DATA_DIR>/app-data/{appId}/files/{uuid}`, with a `{uuid}.json`
 * metadata sidecar alongside it.
 */
import { Router, raw as expressRaw, type Request, type Response } from 'express';
import { createReadStream } from 'node:fs';
import { writeFile, readFile, mkdir, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { collectionName } from '../data/collections-engine.js';
import { getActivation } from '../data/activation.js';
import { resolveApp } from './registry.js';

const SHARED_SCOPE_PREFIX = 'usr.';

export interface AppFileMeta { id: string; name: string; size: number; type: string; createdAt: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidFileId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Unicode-preserving display-name sanitizer (carried): keeps letters/digits in any script
 *  plus `._-() `, replaces everything else (path separators, quotes, control chars) with
 *  `_`, caps at 200 chars. PT-PT names like "Cartão de Cidadão.pdf" survive. */
export function sanitizeFilename(raw: string): string {
  const safe = raw.replace(/[^\p{L}\p{N}._\-() ]/gu, '_').substring(0, 200).trim();
  return safe || 'unnamed';
}

function dataDir(): string {
  // Carried convention: the operational data root is ~/.ekoa/data, NEVER a path
  // inside the repo (an in-tree default pollutes the source tree and restarts
  // watch-mode dev servers on the first upload).
  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
}
function filesDir(appId: string): string {
  return join(dataDir(), 'app-data', appId, 'files');
}
function blobPath(appId: string, id: string): string {
  return join(filesDir(appId), id);
}
function metaPath(appId: string, id: string): string {
  return join(filesDir(appId), `${id}.json`);
}

const appFilesStore = {
  /** Persist a blob + its metadata sidecar. Returns the public metadata. */
  async save(appId: string, name: string, type: string, bytes: Buffer): Promise<AppFileMeta> {
    const id = randomUUID();
    await mkdir(filesDir(appId), { recursive: true });
    await writeFile(blobPath(appId, id), bytes);
    const meta: AppFileMeta = { id, name: sanitizeFilename(name), size: bytes.length, type, createdAt: new Date().toISOString() };
    await writeFile(metaPath(appId, id), JSON.stringify(meta));
    return meta;
  },
  /** Look up a file's metadata + blob path. Null when either is missing. */
  async get(appId: string, id: string): Promise<{ meta: AppFileMeta; path: string } | null> {
    if (!isValidFileId(id)) return null;
    let meta: AppFileMeta;
    try {
      meta = JSON.parse(await readFile(metaPath(appId, id), 'utf8')) as AppFileMeta;
    } catch {
      return null;
    }
    const path = blobPath(appId, id);
    try { await stat(path); } catch { return null; }
    return { meta, path };
  },
  /** Remove blob + metadata. False when the id is unknown for this app. */
  async delete(appId: string, id: string): Promise<boolean> {
    if (!isValidFileId(id)) return false;
    let existed = false;
    try { await stat(metaPath(appId, id)); existed = true; } catch { existed = false; }
    if (!existed) return false;
    await unlink(metaPath(appId, id)).catch(() => {});
    await unlink(blobPath(appId, id)).catch(() => {});
    return true;
  },
};

/** Header-injection-safe Content-Disposition: ASCII fallback in `filename` plus RFC 5987
 *  `filename*` so non-ASCII (PT-PT) names round-trip. */
function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Charset-check the header/param (same rule as app-data: rejects the reserved shared
 *  namespace); gate a resolved artifact owner's activation. Writes the error response
 *  and returns null on refusal. Byte-compat: like /api/app-data, existence is NOT
 *  required - files are keyed by the (charset-checked) app id, so dev-serve and
 *  featured apps alike work; a resolved artifact still gates on its owner's activation. */
async function admitApp(idOrSlug: string, res: Response): Promise<{ appId: string } | null> {
  if (!collectionName.safeParse(idOrSlug).success || idOrSlug.startsWith(SHARED_SCOPE_PREFIX)) {
    res.status(400).json({ error: 'Missing or invalid X-Ekoa-App-Id header' });
    return null;
  }
  const app = await resolveApp(idOrSlug);
  // Second admission plane (Amendment 2): the ARTIFACT owner's activation gates
  // service, fail-closed CONV-2. Apps with no artifact owner (dev-serve or a raw
  // unregistered id) have no subject - admission skipped (carried old-plane behavior).
  if (app?.artifactBacked) {
    const activation = getActivation(app.ownerUserId);
    if (!activation || activation.active === false) {
      res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: 'A sua conta está bloqueada. Contacte o suporte.' } });
      return null;
    }
    if (activation.billingLocked) {
      res.status(402).json({ error: { code: 'BILLING_LOCKED', message: 'A sua conta tem um problema de faturação. Contacte o suporte.' } });
      return null;
    }
  }
  return { appId: app?.appId ?? idOrSlug };
}

export function appFilesRouter(): Router {
  const r = Router();
  const maxSize = process.env.EKOA_APP_FILES_MAX_SIZE || '25mb';

  r.options(/^\/(?:$|.+)/, (_req, res) => { res.status(204).end(); });

  r.post('/', expressRaw({ type: '*/*', limit: maxSize }), async (req: Request, res: Response) => {
    const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
    const admitted = await admitApp(headerId, res);
    if (!admitted) return;
    const rawName = req.headers['x-filename'];
    if (typeof rawName !== 'string' || !rawName) { res.status(400).json({ error: 'Missing X-Filename header' }); return; }
    let decodedName = rawName;
    try { decodedName = decodeURIComponent(rawName); } catch { /* keep raw */ }
    const type = (req.headers['content-type'] as string | undefined) || 'application/octet-stream';
    // A non-Buffer body with a non-zero Content-Length means another parser consumed the
    // stream (middleware misordering). Fail loud: a silent empty-blob 201 is undetectable data loss.
    const declaredLen = parseInt((req.headers['content-length'] as string | undefined) || '0', 10) || 0;
    if (!Buffer.isBuffer(req.body) && declaredLen > 0) {
      res.status(400).json({ error: 'Raw body required — request body was consumed by another parser (middleware misconfiguration)' });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try {
      const meta = await appFilesStore.save(admitted.appId, decodedName, type, bytes);
      res.status(201).json({
        success: true,
        data: { id: meta.id, url: `/api/app-files/${admitted.appId}/${meta.id}`, name: meta.name, size: meta.size, type: meta.type },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.get('/:appId/:id', async (req: Request, res: Response) => {
    const { appId, id } = req.params as { appId: string; id: string };
    if (!collectionName.safeParse(appId).success || appId.startsWith(SHARED_SCOPE_PREFIX) || !isValidFileId(id)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const admitted = await admitApp(appId, res);
    if (!admitted) return; // 404/403/402 already written
    const found = await appFilesStore.get(admitted.appId, id);
    if (!found) { res.status(404).json({ error: 'Not found' }); return; }
    const kind = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', found.meta.type);
    res.setHeader('Content-Length', String(found.meta.size));
    res.setHeader('Content-Disposition', contentDisposition(kind, found.meta.name));
    const stream = createReadStream(found.path);
    stream.on('error', () => {
      if (!res.headersSent) res.status(404).json({ error: 'Not found' });
      else res.destroy();
    });
    stream.pipe(res);
  });

  r.delete('/:appId/:id', async (req: Request, res: Response) => {
    const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
    const admitted = await admitApp(headerId, res);
    if (!admitted) return;
    const { appId, id } = req.params as { appId: string; id: string };
    // Resolve the path param to its canonical id too, then compare (byte-compat guard).
    const paramApp = collectionName.safeParse(appId).success && !appId.startsWith(SHARED_SCOPE_PREFIX) ? await resolveApp(appId) : null;
    if (!paramApp || paramApp.appId !== admitted.appId) {
      res.status(403).json({ error: 'X-Ekoa-App-Id does not match the requested app' });
      return;
    }
    const deleted = await appFilesStore.delete(admitted.appId, id);
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ success: true });
  });

  return r;
}
