/**
 * Artifacts router (ch03 §3.8.9-3.8.11). CRUD via the apps artifacts-service, plus
 * the artifact FAMILY: fork / export / import / bundle-update / featured-update /
 * featured toggle / files / versions / backups / backend / download / pdf. Single
 * list shape `{ items, featured }` (landmine 7). Thin: validate, call one apps/
 * module, shape the response (CONV-2 error envelope throughout).
 */
import { Router, type Response } from 'express';
import {
  ArtifactPatch,
  ImportArtifactRequest,
  BundleUpdateRequest,
  SetFeaturedRequest,
  ReadFileQuery,
  WriteFileRequest,
  BackupPointRef,
  BackendSetEnabledRequest,
  BackendSampleRunRequest,
  PaginationQuery,
} from '@ekoa/shared';
import { z } from 'zod';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { can } from '../auth/capabilities.js';
import { loadConfig } from '../config.js';
import {
  listArtifacts, createArtifact, getVisibleArtifact, patchArtifact, deleteArtifact,
  artifactView, stripReservedDataKeys, type ArtifactDoc,
} from '../apps/artifacts-service.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';
import type { SnapshotAudit } from '../services/commit-guard.js';
import { SecretCommitError } from '../services/commit-guard.js';
import type { AppDataDeps } from '../apps/app-data-access.js';
import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag } from '../apps/app-paths.js';
import { forkArtifact } from '../apps/artifact-fork.js';
import { exportArtifact, importArtifact, updateArtifactFromBundle, ManifestIdMismatchError } from '../apps/artifact-bundle.js';
import { applyFeaturedUpdate, ignoreFeaturedUpdate } from '../apps/artifact-featured-update.js';
import { listVersions, restoreAndRebuild } from '../apps/versions.js';
import { listArtifactFiles, readArtifactFile, writeArtifactFile, FilePathError } from '../apps/artifact-files.js';
import { AppDataBackups } from '../apps/backups.js';
import {
  getArtifactBackendRuntime, readDeclaredBackend, type BackendLogEntry, type InvocationRecord,
} from '../apps/backend-runtime/index.js';
import { renderArtifactPdf, isSafePdfBasename } from '../apps/pdf.js';
import { collectAppFiles, streamFiles, safeZipName } from '../services/app-archive.js';

const CreateArtifact = z.object({ name: z.string(), visibility: z.enum(['private', 'org']).optional() });
const ForkBody = z.object({ name: z.string().optional() });

export function artifactsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  const auditOf = (req: AuthedRequest): SnapshotAudit => ({
    actor: { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId },
    deps: { now: deps.now, genId: deps.genId },
  });
  const appDeps: AppDataDeps = { now: deps.now, genId: deps.genId };

  /** Load an artifact the actor may read; write 404 + return null otherwise. */
  async function readable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    const art = await loadReadable(actorOf(req), req.params.id as string);
    if (!art) { notFound(res); return null; }
    return art;
  }
  /** Load an artifact the actor may write; write 404/403 + return null otherwise. */
  async function writable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
    if (verdict === 'notfound') { notFound(res); return null; }
    if (verdict === 'forbidden') { sendError(res, 'FORBIDDEN', 'Sem permissão.'); return null; }
    return art!;
  }

  // ---- base CRUD (ch03 §3.8.9) ----
  r.get('/', async (req: AuthedRequest, res: Response) => {
    const { items, featured } = await listArtifacts(actorOf(req));
    res.json({ items: items.map(artifactView), featured: featured.map(artifactView) });
  });

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
    if (!body) return;
    // H1 capability gate: creating an artifact requires canCreateArtifacts (held by user +
    // org-admin + super-admin — this is the base "artifacts area" capability, distinct from the
    // app build/edit capabilities). Refusal is the FORBIDDEN envelope + details.capability.
    if (!can(actorOf(req), 'canCreateArtifacts')) {
      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
    }
    res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
  });

  // ---- import must precede GET/:id-style matches (distinct verb+path) ----
  r.post('/import', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ImportArtifactRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle } | undefined;
    if (!body) return;
    const created = await importArtifact(body.bundle, actorOf(req), deps);
    res.status(201).json(artifactView(created));
  });

  r.get('/:id', async (req: AuthedRequest, res: Response) => {
    const a = await getVisibleArtifact(actorOf(req), req.params.id as string);
    if (!a) return notFound(res);
    res.json(artifactView(a));
  });

  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ArtifactPatch, req.body) as Record<string, unknown> | undefined;
    if (!body) return;
    // Strip server-owned reserved keys (e.g. `projectDir`) from any client `data` at the boundary
    // before they reach the store — a client must never influence the build sandbox path (ch09).
    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
      body.data = stripReservedDataKeys(body.data as Record<string, unknown>);
    }
    const result = await patchArtifact(actorOf(req), req.params.id as string, body);
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') {
      if (typeof body.slug === 'string') return sendError(res, 'SLUG_TAKEN', 'Slug já em uso.');
      return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    }
    res.json(artifactView(result.artifact!));
  });

  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
    const id = req.params.id as string;
    // Revoke the backend BEFORE removing the row so no queued/in-flight invoke can
    // run against a deleted artifact (C05-20 post-DELETE refusal, B19).
    await getArtifactBackendRuntime().revoke(id);
    const verdict = await deleteArtifact(actorOf(req), id);
    if (verdict === 'notfound') return notFound(res);
    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    res.json({ ok: true });
  });

  // ---- fork / featured toggle ----
  r.post('/:id/fork', async (req: AuthedRequest, res: Response) => {
    const src = await readable(req, res);
    if (!src) return;
    const body = parseBody(res, ForkBody, req.body ?? {}) as { name?: string } | undefined;
    if (!body) return;
    const { artifact } = await forkArtifact(src._id, actorOf(req), deps, body.name);
    res.status(201).json({ id: artifact._id, slug: artifact.slug });
  });

  r.put('/:id/featured', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SetFeaturedRequest, req.body) as { featured: boolean; featuredRank?: number } | undefined;
    if (!body) return;
    const existing = await getArtifactById(req.params.id as string);
    if (!existing) return notFound(res);
    const updated = await setFeaturedFlag(req.params.id as string, body.featured, body.featuredRank);
    res.json(artifactView(updated!));
  });

  // ---- bundle export / import / update-in-place ----
  r.get('/:id/export', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    res.json(await exportArtifact(art));
  });

  r.post('/:id/bundle-update', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
    if (!body) return;
    try {
      const result = await updateArtifactFromBundle(
        art, body.bundle,
        { force: body.force, authorName: req.user!.username, audit: auditOf(req), appDeps },
        deps,
      );
      res.json({ artifact: artifactView(result.artifact), safetyNetSnapshotId: result.safetyNetSnapshotId, preUpdateVersionId: result.preUpdateVersionId });
    } catch (err) {
      if (err instanceof ManifestIdMismatchError) return sendError(res, 'MANIFEST_ID_MISMATCH', 'O pacote não corresponde a esta app. Confirme para atualizar mesmo assim.');
      throw err;
    }
  });

  r.post('/:id/featured-update/apply', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    await applyFeaturedUpdate(art._id, { authorName: req.user!.username, audit: auditOf(req), appDeps });
    res.json({ ok: true });
  });

  r.post('/:id/featured-update/ignore', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    await ignoreFeaturedUpdate(art._id);
    res.json({ ok: true });
  });

  // ---- versions ----
  r.get('/:id/versions', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const q = PaginationQuery.safeParse(req.query);
    const limit = q.success && q.data.limit ? q.data.limit : 100;
    res.json({ items: await listVersions(projectDirFor(art), limit) });
  });

  r.post('/:id/versions/:sha/restore', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    const authorName = req.user!.username;
    const result = await restoreAndRebuild(
      art._id,
      { projectDir: projectDirFor(art), sha: req.params.sha as string, authorName, authorEmail: `${authorName}@ekoa.local` },
      art.name,
    );
    res.json({ newHeadSha: result.newHeadSha });
  });

  // ---- files (project-relative, confined server-side; P-15) ----
  r.get('/:id/files', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const projectDir = projectDirFor(art);
    res.json({ files: await listArtifactFiles(projectDir), projectDir });
  });

  r.get('/:id/file', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const q = ReadFileQuery.safeParse(req.query);
    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
    try {
      res.json({ content: await readArtifactFile(projectDirFor(art), q.data.path) });
    } catch (err) {
      if (err instanceof FilePathError) return notFound(res);
      throw err;
    }
  });

  r.put('/:id/file', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    const body = parseBody(res, WriteFileRequest, req.body) as { path: string; content: string } | undefined;
    if (!body) return;
    try {
      const result = await writeArtifactFile(projectDirFor(art), body.path, body.content, req.user!.username, auditOf(req), { appId: art._id, appName: art.name });
      res.json({ path: result.path, size: result.size, committed: result.committed, ...(result.warning ? { warning: result.warning } : {}) });
    } catch (err) {
      if (err instanceof FilePathError) return sendError(res, 'VALIDATION_FAILED', 'Caminho inválido.');
      throw err;
    }
  });

  // ---- download (zip; 422 on a planted credential) ----
  r.get('/:id/download', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const projectDir = projectDirFor(art);
    let files;
    try {
      files = await collectAppFiles(projectDir); // secret-scan BEFORE any bytes go out
    } catch (err) {
      if (err instanceof SecretCommitError) {
        return sendError(res, 'SECRET_GUARD_BLOCKED', 'Descarregamento bloqueado: a app contém uma credencial que tem de ser removida.');
      }
      throw err;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeZipName(art.slug || art.name || 'app')}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    try {
      await streamFiles(files, res);
    } catch {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    }
  });

  // ---- pdf (id charset-guarded; it becomes the output basename) ----
  r.get('/:id/pdf', async (req: AuthedRequest, res: Response) => {
    const id = req.params.id as string;
    if (!isSafePdfBasename(id)) return sendError(res, 'VALIDATION_FAILED', 'Identificador inválido.');
    const art = await readable(req, res);
    if (!art) return;
    // Render against the api's OWN loopback origin, NEVER the client-controlled Host header (Codex
    // checkpoint): a spoofed Host would point the server-side render browser at an attacker origin
    // (SSRF + attacker-controlled PDF content). The served-app plane is on this same process.
    const origin = process.env.RENDER_ORIGIN ?? `http://127.0.0.1:${loadConfig().port}`;
    try {
      const result = await renderArtifactPdf({ url: `${origin}/apps/${id}/` }, id);
      res.redirect(302, result.url);
    } catch (err) {
      // Chromium unavailable / render failure - degrade explicitly (ch07 §7.12).
      sendError(res, 'UPSTREAM_UNAVAILABLE', `Não foi possível gerar o PDF: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ---- app-data backups (ch03 §3.8.10) ----
  r.get('/:id/backups', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    res.json(new AppDataBackups(appDeps).status(art._id));
  });

  r.post('/:id/backups', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    res.json(await new AppDataBackups(appDeps).saveSnapshot(art._id, 'manual'));
  });

  r.get('/:id/backups/export', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    res.json(await new AppDataBackups(appDeps).exportAll(art._id));
  });

  r.post('/:id/backups/preview', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
    if (!body) return;
    try {
      res.json(await new AppDataBackups(appDeps).previewAsOf(art._id, body));
    } catch (err) {
      return sendError(res, 'NOT_FOUND', err instanceof Error ? err.message : 'Ponto de restauro não encontrado.');
    }
  });

  r.post('/:id/backups/restore', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
    if (!body) return;
    res.json(await new AppDataBackups(appDeps).restoreTo(art._id, body));
  });

  // ---- artifact backend (ch03 §3.8.11) ----
  r.get('/:id/backend', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const declared = await readDeclaredBackend(art);
    const status = getArtifactBackendRuntime().getStatus(art._id);
    res.json({ hasBackend: !!declared, status: status.state, declared: declared ?? null, runtime: status });
  });

  r.get('/:id/backend/logs', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const q = PaginationQuery.safeParse(req.query);
    const limit = q.success && q.data.limit ? q.data.limit : 100;
    res.json({ items: getArtifactBackendRuntime().getRecentLogs(art._id, limit).map(logView) });
  });

  r.get('/:id/backend/invocations', async (req: AuthedRequest, res: Response) => {
    const art = await readable(req, res);
    if (!art) return;
    const q = PaginationQuery.safeParse(req.query);
    const limit = q.success && q.data.limit ? q.data.limit : 20;
    res.json({ items: getArtifactBackendRuntime().getInvocations(art._id, limit).map(invocationView) });
  });

  r.put('/:id/backend/enabled', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    const body = parseBody(res, BackendSetEnabledRequest, req.body) as { enabled: boolean } | undefined;
    if (!body) return;
    getArtifactBackendRuntime().setEnabled(art._id, body.enabled);
    res.json({ enabled: body.enabled });
  });

  r.post('/:id/backend/sample-run', async (req: AuthedRequest, res: Response) => {
    const art = await writable(req, res);
    if (!art) return;
    const body = parseBody(res, BackendSampleRunRequest, req.body) as { entrypoint: string; input: unknown } | undefined;
    if (!body) return;
    const declared = await readDeclaredBackend(art);
    const entrypoint = (body.entrypoint || declared?.handlers?.[0] || '').trim();
    if (!entrypoint) return sendError(res, 'VALIDATION_FAILED', 'É necessário um entrypoint (nenhum handler declarado).');
    const result = await getArtifactBackendRuntime().invoke(art._id, entrypoint, body.input, { dryRun: true, invokedBy: 'sample' });
    res.json({ result, ...(result.dryRunEffects ? { dryRunEffects: result.dryRunEffects } : {}) });
  });

  return r;
}

function logView(l: BackendLogEntry) {
  return { at: l.at, level: l.level, message: l.msg, ...(l.meta ? { meta: l.meta } : {}) };
}
function invocationView(i: InvocationRecord) {
  return { id: i.invokeId, entrypoint: i.entrypoint, at: i.startedAt, status: i.ok ? 'ok' : 'error', durationMs: i.durationMs };
}
