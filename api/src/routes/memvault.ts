/**
 * memvault router (slices E2 + E3): thin — admit (JWT or gateway key), validate against the
 * shared/ schemas, call the memvault service, shape the envelope. Reads/deletes address
 * notes via `?permalink=` (multi-segment permalinks do not fit an express `:param`; see
 * shared/src/memvault.ts). NOT_FOUND is uniform: missing, cross-tenant and jail-refused
 * paths answer the identical envelope.
 *
 * E3 adds POST /search (JSON) and GET /export (a tar of the caller's markdown). The export is
 * the one route here that commits to a binary body: the service collects the files BEFORE the
 * sink callback runs, so a refusal is still a clean JSON envelope, and a failure AFTER the
 * headers are out destroys the connection rather than appending an envelope to a torn tar.
 *
 * AUDIT-PER-CALL INCLUDES REFUSALS. A schema rejection here never reaches the service, so each
 * one goes through `deny()`: one activity row + one structured console line with verdict
 * 'denied', carrying the (capped) path the caller was aiming at. Traversal payloads die at this
 * layer — they were previously the ONLY calls on this surface that left no trace whatsoever
 * (E2 review F3).
 */
import { Router, type Response } from 'express';
import { NoteListQuery, NotePermalinkQuery, NoteSearchRequest, WriteNoteRequest } from '@ekoa/shared';
import { requireUserOrApiKey, type ApiKeyPrincipal } from '../auth/api-key-middleware.js';
import type { AuthedRequest } from '../auth/middleware.js';
import * as memvault from '../memvault/service.js';
import { notFound, sendError } from './helpers.js';

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

/** The path an invalid request was aiming at, for the audit line. Attacker-controlled text:
 *  recorded (capped) and never resolved, never echoed back on the wire. */
function attemptOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 128) : undefined;
}

/** Map a service refusal to its uniform wire envelope. */
function refuse(res: Response, code: memvault.MemvaultRefusal): void {
  if (code === 'NOT_FOUND') return notFound(res);
  if (code === 'INTERNAL') return sendError(res, 'INTERNAL', 'Erro interno.');
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

  /** A router-level schema refusal: audit it as `denied`, THEN answer the 400 envelope. */
  const deny = async (
    req: AuthedRequest,
    res: Response,
    op: string,
    attempt: unknown,
    issues: unknown,
  ): Promise<void> => {
    await memvault.auditDenied(ctxOf(req, res), op, attemptOf(attempt));
    sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues });
  };

  // writeNote — POST /api/v1/memvault/notes
  r.post('/notes', async (req: AuthedRequest, res: Response) => {
    const body = WriteNoteRequest.safeParse(req.body);
    if (!body.success) {
      const raw = req.body as { permalink?: unknown; folder?: unknown } | null;
      return deny(req, res, 'write', raw?.permalink ?? raw?.folder, body.error.issues);
    }
    const out = await memvault.writeNote(ctxOf(req, res), body.data);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // listNotes — GET /api/v1/memvault/notes
  r.get('/notes', async (req: AuthedRequest, res: Response) => {
    const q = NoteListQuery.safeParse(req.query);
    if (!q.success) return deny(req, res, 'list', req.query.folder, q.error.issues);
    const out = await memvault.listNotes(ctxOf(req, res), q.data);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // readNote — GET /api/v1/memvault/note?permalink=folder/slug
  r.get('/note', async (req: AuthedRequest, res: Response) => {
    const q = NotePermalinkQuery.safeParse(req.query);
    if (!q.success) return deny(req, res, 'read', req.query.permalink, q.error.issues);
    const out = await memvault.readNote(ctxOf(req, res), q.data.permalink);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // deleteNote — DELETE /api/v1/memvault/note?permalink=folder/slug
  r.delete('/note', async (req: AuthedRequest, res: Response) => {
    const q = NotePermalinkQuery.safeParse(req.query);
    if (!q.success) return deny(req, res, 'delete', req.query.permalink, q.error.issues);
    const out = await memvault.deleteNote(ctxOf(req, res), q.data.permalink);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // searchNotes — POST /api/v1/memvault/search
  r.post('/search', async (req: AuthedRequest, res: Response) => {
    const body = NoteSearchRequest.safeParse(req.body);
    if (!body.success) return deny(req, res, 'search', (req.body as { query?: unknown } | null)?.query, body.error.issues);
    const out = await memvault.searchNotes(ctxOf(req, res), body.data);
    if (!out.ok) return refuse(res, out.code);
    res.json(out.value);
  });

  // exportVault — GET /api/v1/memvault/export (tar of the caller's markdown, no .index/)
  r.get('/export', async (req: AuthedRequest, res: Response) => {
    try {
      const out = await memvault.exportVault(ctxOf(req, res), () => {
        res.status(200);
        res.setHeader('content-type', 'application/x-tar');
        // A constant filename: it must not carry the userId (or anything else) into a header.
        res.setHeader('content-disposition', 'attachment; filename="memvault.tar"');
        res.setHeader('cache-control', 'no-store');
        return res;
      });
      if (!out.ok) return refuse(res, out.code);
    } catch (e) {
      // Past the headers there is no envelope to send: kill the connection so the client sees a
      // truncated transfer instead of a tar with JSON glued to the end.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      throw e;
    }
  });

  return r;
}
