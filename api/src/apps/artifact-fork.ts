/**
 * Artifact fork (ch03 §3.8.9, ch07 §7.10). Copies a source artifact's working
 * copy into a fresh artifact owned by the caller, generates a deterministic slug,
 * rebuilds, and registers. Every fork is independent - no upstream link, no
 * dedup. Ported from the old services/artifact-fork.ts, adapted to the ekoa-code
 * stores (ArtifactDoc) + deterministic slug pipeline (artifacts-service +
 * slug-index) + build/registry entries.
 *
 * The source tree is only READ (cp copies FROM it), so a fork never mutates the
 * source working copy - the C07 criterion-11 invariant (source byte-identical
 * before/after). Runtime/build dirs never travel into the fork.
 *
 * DEVIATION (logged): the old service had a GitHub generate-from-template fast
 * path (provider abstraction, B18). This slice ports the on-disk clone as the
 * authoritative path (deterministic, works without a GitHub remote) and fires the
 * gated GitHub mirror push for the new fork after cloning; the template-fork
 * optimization is deferred.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { artifacts, slugs } from '../data/stores.js';
import type { Actor } from '../data/scoped.js';
import { generateSlug, type ArtifactDoc, type Deps } from './artifacts-service.js';
import { indexSlug } from './slug-index.js';
import { projectDirFor, newProjectDir } from './app-paths.js';
import { appBuilder } from './builder.js';
import { appRegistry } from './app-registry.js';
import { backupAppRepoSafe } from '../services/github/backup.js';

/** Top-level entries that never travel into a fork (ephemeral runtime/build state). */
const EXCLUDE_TOP = new Set(['dist', 'dist-backend', 'node_modules', '.git', 'app-data', '.sdk-session', '.versions']);

/** Clone the source tree into the fork's project dir, excluding runtime state. */
async function cloneProjectDir(sourceDir: string, destDir: string): Promise<boolean> {
  if (!existsSync(sourceDir)) return false;
  await mkdir(dirname(destDir), { recursive: true });
  await cp(sourceDir, destDir, {
    recursive: true,
    filter: (path) => {
      const rel = path.slice(sourceDir.length).replace(/^[/\\]+/, '');
      if (!rel) return true; // root
      const top = rel.split(/[/\\]/)[0] as string;
      return !EXCLUDE_TOP.has(top);
    },
  });
  return true;
}

export interface ForkResult {
  artifact: ArtifactDoc;
  cloned: boolean;
  built: boolean;
}

/**
 * Fork `sourceId` into a new artifact owned by `newOwner`. The caller is
 * responsible for authorization (own/org-shared for the API route; shareable/
 * featured for `/build/:slug`); this resolves the source by id directly so the
 * fork-per-click share flow can copy another user's shareable artifact.
 */
export async function forkArtifact(
  sourceId: string,
  newOwner: Actor,
  deps: Deps,
  newName?: string,
): Promise<ForkResult> {
  const source = (await artifacts.get(sourceId)) as ArtifactDoc | null;
  if (!source) throw new Error(`Artifact not found: ${sourceId}`);

  const newId = deps.genId();
  const baseName = newName?.trim() || `${source.name} (cópia)`;
  const slug = await generateSlug(baseName, deps);
  await slugs.put({ _id: slug, artifactId: newId });
  indexSlug(slug, newId);

  const projectDir = newProjectDir(newOwner.userId, newId);
  const sourceDir = projectDirFor(source);

  // Clone the working copy (source is read-only here - byte-identical invariant).
  let cloned = false;
  try {
    cloned = await cloneProjectDir(sourceDir, projectDir);
  } catch (err) {
    console.warn('[fork] clone failed:', err instanceof Error ? err.message : err);
  }

  const now = new Date(deps.now()).toISOString();
  const doc: ArtifactDoc = {
    _id: newId,
    name: baseName,
    slug,
    userId: newOwner.userId,
    orgId: newOwner.orgId,
    visibility: 'private',
    featured: false,
    shareable: true,
    status: 'draft',
    data: { appUrl: `/apps/${newId}/`, projectDir, forkedFrom: sourceId },
    createdAt: now,
    updatedAt: now,
  } as ArtifactDoc;
  await artifacts.insert(doc as never);

  // Register + build so the fork is immediately servable. Build failure is
  // non-fatal (the record exists either way; the error HTML serves).
  let built = false;
  if (cloned) {
    try {
      await appRegistry.register(newId, projectDir, newOwner.userId, baseName);
      const result = await appBuilder.build(newId, projectDir);
      built = result.success;
      if (built) {
        await artifacts.update(newId, (a) => ({ ...a, status: 'active', updatedAt: new Date(deps.now()).toISOString() }));
        doc.status = 'active';
      }
    } catch (err) {
      console.warn('[fork] register/build failed:', err instanceof Error ? err.message : err);
    }
    // Gated GitHub mirror push for the new fork (§7.9; no-op when push disabled).
    backupAppRepoSafe(projectDir, { appId: newId, appName: baseName });
  }

  return { artifact: doc, cloned, built };
}
