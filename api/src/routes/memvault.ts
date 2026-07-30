/**
 * memvault router (slice E2): thin — admit (JWT or gateway key), validate against the
 * shared/ schemas, call the memvault service, shape the envelope. Reads/deletes address
 * notes via `?permalink=` (multi-segment permalinks do not fit an express `:param`; see
 * shared/src/memvault.ts). NOT_FOUND is uniform: missing, cross-tenant and jail-refused
 * paths answer the identical envelope.
 */
import { Router, type Response } from 'express';
import { NoteListQuery, NotePermalinkQuery, WriteNoteRequest } from '@ekoa/shared';
import { requireUserOrApiKey, type ApiKeyPrincipal } from '../auth/api-key-middleware.js';
import type { AuthedRequest } from '../auth/middleware.js';
import * as memvault from '../memvault/service.js';
import { notFound, parseBody, sendError } from './helpers.js';

/** The Registo actor from the verified principal (logActivity needs a username, which the
 *  shared Actor type does not carry — same shape as routes/gateway-keys.ts). */
function activityActorOf(req: AuthedRequest): { userId: string; username: string; orgId: string } {
  const u = req.user!;
  return { userId: u.sub, username: u.username ?? u.sub, orgId: u.orgId ?? '' };
}

function principalOf(res: Response): memvault.MemvaultPrincipal | undefined {
  const p = res.locals.apiKeyPrincipal as ApiKeyPrincipal | undefined;
  return p ? { keyId: p.keyId, ...(p.xClient ? { xClient: p.xClient } : {}) } : undefined;
}

/** Map a service refusal to its uniform wire envelope. */
function refuse(res: Response, code: 'NOT_FOUND' | 'VALIDATION_FAILED'): void {
  if (code === 'NOT_FOUND') return notFound(res);
  sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.');
}

export function memvaultRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireUserOrApiKey);

  const ctxOf = (req: AuthedRequest, res: Response) => ({
    actor: activityActorOf(req),
    deps,
    principal: principalOf(res),
  });

  // writeNote — POST /api/v1/memvault/notes
  r.post('/notes', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, WriteNoteRequest, req.body);
    if (!body) return;
    const out = await memvault.writeNote(ctxOf(req, res), body);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // listNotes — GET /api/v1/memvault/notes
  r.get('/notes', async (req: AuthedRequest, res: Response) => {
    const q = NoteListQuery.safeParse(req.query);
    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
    const out = await memvault.listNotes(ctxOf(req, res), q.data);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // readNote — GET /api/v1/memvault/note?permalink=folder/slug
  r.get('/note', async (req: AuthedRequest, res: Response) => {
    const q = NotePermalinkQuery.safeParse(req.query);
    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
    const out = await memvault.readNote(ctxOf(req, res), q.data.permalink);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // deleteNote — DELETE /api/v1/memvault/note?permalink=folder/slug
  r.delete('/note', async (req: AuthedRequest, res: Response) => {
    const q = NotePermalinkQuery.safeParse(req.query);
    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
    const out = await memvault.deleteNote(ctxOf(req, res), q.data.permalink);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  return r;
}
