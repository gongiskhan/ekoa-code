/**
 * App DOCX API (ch07 document base v2, 2C-S4) - the served document-base app's window onto
 * its linked Word document (source + redlines managed by apps/document-source.ts over the
 * services/docx-redline engine). Ported from ekoa-dev cortex/src/routes/app-docx.ts.
 *
 * TRUST MODEL (state it plainly - this plane authenticates NO caller). Scoping follows app-files
 * EXACTLY: the `X-Ekoa-App-Id` header injectAppContext stamps into every served app (slug or
 * canonical id), no JWT, no session. Same trust model as /api/app-files: WHOEVER HOLDS THE APP ID
 * CAN READ AND MUTATE THAT APP'S OWN DOCUMENT. `admitApp` gates the resolved ARTIFACT OWNER's
 * activation - NOT the caller: a deactivated (403 ACCOUNT_DISABLED) or billing-locked (402
 * BILLING_LOCKED) owner's document is refused to everyone, fail-closed CONV-2 (Amendment 2, an
 * ekoa-code improvement over dev, KEPT). It performs no caller authentication whatsoever, so an
 * anonymous holder of an app id can read the full text (/projection), download the bytes
 * (/current, /clean) and PERSIST tracked changes (/edits) - and applyReview stamps the ARTIFACT
 * OWNER's username as the author of those changes. This is the pre-existing served-app posture,
 * NOT a safe boundary: see the KNOWN HIGH GAP `served-app-data-unauthenticated-writes` in
 * docs/findings.md + docs/security.md, which names this docx surface explicitly. The current
 * (unhardened) state is PINNED as a tripwire in tests/security/app-docx-authz.test.ts.
 *
 * The document-source service functions are INJECTED from the composition root (server.ts) -
 * the router hard-wires no service singleton (2C seam decision). Error taxonomy is mapped by the
 * error's own `name`/shape (the adobe-sign router's property-based precedent), so the router
 * needs no runtime import of document-source / docx-redline: a NoDocumentSourceError → 404, a
 * RedlineBatchError (per-op failures) → 422, anything else → 500.
 *
 * GET routes read state and derive downloads; POST /edits is the human review surface
 * (accept/reject a change, add a comment, reply to a thread, resolve/reopen a thread) - author
 * is resolved server-side inside applyReview (from the artifact owner), never from the client.
 * Bodies are plain JSON parsed by the global express.json() (no uploads here - linking a source
 * doc happens through the ekoa-docx MCP tools). Mount AFTER the global JSON body parser.
 */
import { Router, type Request, type Response } from 'express';
import { collectionName } from '../data/collections-engine.js';
import { getActivation } from '../data/activation.js';
import { resolveApp } from './registry.js';
import type { RedlineOp, RedlineReport } from '../services/docx-redline.js';
import type { DocumentSourceStatus } from './document-source.js';

const SHARED_SCOPE_PREFIX = 'usr.';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Review op types a served app may submit. Structural fields are validated by the engine. */
const REVIEW_OP_TYPES = new Set(['accept', 'reject', 'reply', 'modify', 'resolve', 'unresolve']);

/** The document-source operations the router drives, injected from the composition root
 *  (server.ts binds the real apps/document-source.ts functions; tests bind the same). */
export interface AppDocxDeps {
  getStatus: (appId: string) => Promise<DocumentSourceStatus>;
  getProjection: (appId: string) => Promise<{ markdown: string; fileName: string }>;
  getCurrent: (appId: string) => Promise<{ buffer: Buffer; fileName: string }>;
  getClean: (appId: string) => Promise<{ buffer: Buffer; fileName: string }>;
  applyReview: (
    appId: string,
    ops: RedlineOp[],
  ) => Promise<{ report: RedlineReport; projection: string; fileName: string }>;
}

/**
 * Header-injection-safe Content-Disposition: ASCII fallback in `filename` plus RFC 5987
 * `filename*` so PT-PT names round-trip. (app-files.ts's contentDisposition, attachment-only.)
 */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Admission: app-files.ts `admitApp` VERBATIM. Charset-checks the header (rejects the reserved
 * `usr.` namespace), then gates the RESOLVED artifact owner's activation (fail-closed CONV-2).
 * Apps with no artifact owner (dev-serve or a raw unregistered id) have no subject - admission
 * skips the gate and keys on the header (carried old-plane behavior). NOTE the remanence
 * consequence: deleteArtifact removes only the artifact row, so a DELETED app's id resolves to
 * null, `artifactBacked` is false, this gate is SKIPPED, and the orphaned document under
 * <EKOA_DATA_DIR>/app-data/{appId}/docx stays readable to anyone holding the id (recorded in the
 * findings gap). Writes the error response and returns null on refusal.
 */
async function admitApp(idOrSlug: string, res: Response): Promise<{ appId: string } | null> {
  if (!collectionName.safeParse(idOrSlug).success || idOrSlug.startsWith(SHARED_SCOPE_PREFIX)) {
    res.status(400).json({ error: 'Missing or invalid X-Ekoa-App-Id header' });
    return null;
  }
  const app = await resolveApp(idOrSlug);
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

function headerId(req: Request): string {
  return (req.headers['x-ekoa-app-id'] as string | undefined) || '';
}

/** Map a document-source error to a sanitized HTTP response (property-based, like adobe-sign):
 *  a NoDocumentSourceError → 404 (the app has no linked document), anything else → 500. */
function sendError(res: Response, err: unknown): void {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'NoDocumentSourceError') {
    res.status(404).json({ error: e.message ?? 'Nenhum documento Word está associado a esta aplicação.' });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[app-docx]', msg);
  res.status(500).json({ error: msg });
}

export function appDocxRouter(deps: AppDocxDeps): Router {
  const r = Router();

  r.options(/^\/api\/app-docx(\/|$)/, (_req, res) => {
    res.status(204).end();
  });

  r.get('/api/app-docx/status', async (req, res) => {
    const admitted = await admitApp(headerId(req), res);
    if (!admitted) return;
    try {
      const status = await deps.getStatus(admitted.appId);
      res.json({ hasSource: status.hasSource, fileName: status.fileName, updatedAt: status.updatedAt });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/api/app-docx/projection', async (req, res) => {
    const admitted = await admitApp(headerId(req), res);
    if (!admitted) return;
    try {
      const { markdown, fileName } = await deps.getProjection(admitted.appId);
      res.json({ markdown, fileName });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get('/api/app-docx/current', async (req, res) => {
    const admitted = await admitApp(headerId(req), res);
    if (!admitted) return;
    try {
      const { buffer, fileName } = await deps.getCurrent(admitted.appId);
      res.setHeader('Content-Type', DOCX_MIME);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', contentDisposition(fileName));
      res.send(buffer);
    } catch (err) {
      sendError(res, err);
    }
  });

  r.post('/api/app-docx/clean', async (req, res) => {
    const admitted = await admitApp(headerId(req), res);
    if (!admitted) return;
    try {
      const { buffer, fileName } = await deps.getClean(admitted.appId);
      res.setHeader('Content-Type', DOCX_MIME);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', contentDisposition(fileName));
      res.send(buffer);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Human review surface: accept/reject a tracked change, add a comment, reply to a comment
  // thread, resolve/reopen a thread. Author is resolved server-side inside applyReview.
  r.post('/api/app-docx/edits', async (req, res) => {
    const admitted = await admitApp(headerId(req), res);
    if (!admitted) return;
    const ops = (req.body as { ops?: unknown })?.ops;
    if (!Array.isArray(ops) || ops.length === 0) {
      res.status(400).json({ error: 'Corpo inválido: é necessária uma lista de alterações (ops).' });
      return;
    }
    const badOp = ops.find(
      (op) => !op || typeof op !== 'object' || !REVIEW_OP_TYPES.has((op as { type?: unknown }).type as string),
    );
    if (badOp !== undefined) {
      res.status(400).json({ error: 'Corpo inválido: alteração com tipo não suportado.' });
      return;
    }
    try {
      const { report, projection, fileName } = await deps.applyReview(admitted.appId, ops as RedlineOp[]);
      res.json({ markdown: projection, fileName, report });
    } catch (err) {
      const e = err as { name?: string; message?: string; failures?: unknown } | null;
      if (e?.name === 'RedlineBatchError' && Array.isArray(e.failures)) {
        // Ambiguous/failed target - the app surfaces the reason so the user can pick a cleaner
        // span or correct the action. Not a server error (accepted flat {error,failures}).
        res.status(422).json({ error: e.message, failures: e.failures });
        return;
      }
      sendError(res, err);
    }
  });

  return r;
}
