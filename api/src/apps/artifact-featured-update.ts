/**
 * Featured artifact update-by-consent (ch03 §3.8.9, ch07 §7.13). Ported from the
 * old services/featured-update.ts, adapted to the ekoa-code stores + pipeline.
 *
 * A user who customized a featured artifact is NEVER silently overwritten. On
 * explicit consent, `applyFeaturedUpdate` re-applies the current featured scaffold
 * onto the user's working copy with the SAME safety order as a bundle update:
 *   1. app-data safety-net snapshot;
 *   2. pre-update version commit of the working copy;
 * then the scaffold replaces the working files and the app rebuilds; a failed
 * build auto-restores the pre-update version. For a NON-customized instance this
 * is a no-op success (the boot mirror refresh already tracks the latest version).
 * `ignoreFeaturedUpdate` stamps `ignoredVersion` and clears the update badge.
 *
 * The wire response is `{ ok: true }` (ch03 §3.8.9); the snapshot pair is taken
 * server-side for safety and not surfaced on this route.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
import { artifacts } from '../data/stores.js';
import type { ArtifactDoc } from './artifacts-service.js';
import { newProjectDir, patchArtifactData } from './app-paths.js';
import { featuredArtifactDir } from './featured-seeder.js';
import { commitSnapshot, type SnapshotAudit } from '../services/commit-guard.js';
import { restoreVersion } from './versions.js';
import { AppDataBackups } from './backups.js';
import type { AppDataDeps } from './app-data-access.js';
import { appBuilder } from './builder.js';
import { appRegistry } from './app-registry.js';

const SEEDED_FROM = 'assets/featured-artifacts';
const MAX_FILE_BYTES = 1_500_000;
const EXCLUDE_TOP = new Set(['dist', 'dist-backend', 'node_modules', '.git', 'app-data', '.sdk-session', '.versions']);

function isSeededFeatured(art: ArtifactDoc): boolean {
  const data = (art.data ?? {}) as Record<string, unknown>;
  return art.featured === true && data.seededFrom === SEEDED_FROM;
}

function scaffoldDirFor(art: ArtifactDoc): string {
  return join(featuredArtifactDir(art._id), 'scaffold');
}

/** Working copy for a customized featured instance. */
function workingDirFor(art: ArtifactDoc): string {
  const data = (art.data ?? {}) as Record<string, unknown>;
  const recorded = data.projectDir;
  if (typeof recorded === 'string' && recorded.length > 0) return recorded;
  return newProjectDir(art.userId, art._id);
}

/** Relative paths of scaffold-tracked files under `root` (runtime dirs / oversize excluded). */
async function collectScaffoldPaths(root: string, prefix = ''): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (!prefix && EXCLUDE_TOP.has(e.name)) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await collectScaffoldPaths(join(root, e.name), rel)));
    } else if (e.isFile()) {
      const s = await stat(join(root, e.name));
      if (s.size > MAX_FILE_BYTES) continue;
      out.push(rel);
    }
  }
  return out;
}

async function readManifestVersion(art: ArtifactDoc): Promise<string> {
  try {
    const raw = await readFile(join(featuredArtifactDir(art._id), 'manifest.json'), 'utf-8');
    const m = JSON.parse(raw) as { version?: string };
    if (typeof m.version === 'string' && m.version) return m.version;
  } catch { /* fall through */ }
  return '1.0.0';
}

export interface ApplyFeaturedResult {
  updated: boolean;
  safetyNetSnapshotId: string;
  preUpdateVersionId: string;
}

/**
 * Apply the current featured scaffold onto a customized instance's working copy.
 * No-op success for a non-customized instance. Requires `audit` (for the pre-update
 * secret-guarded commit) + `appDeps` (for the app-data snapshot).
 */
export async function applyFeaturedUpdate(
  artifactId: string,
  opts: { authorName?: string; audit: SnapshotAudit; appDeps: AppDataDeps },
): Promise<ApplyFeaturedResult> {
  const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
  if (!art) throw new Error(`ArtifactNotFound: ${artifactId}`);
  if (!art.featured) throw new Error('NotFeatured: only featured artifacts can be updated from source');
  if (!isSeededFeatured(art)) throw new Error('FeaturedSourceMissing: no featured scaffold to update from');

  const data = (art.data ?? {}) as Record<string, unknown>;
  const manifestVersion = await readManifestVersion(art);

  // Non-customized: nothing to apply in place - report success to dismiss the badge.
  if (data.customized !== true) {
    return { updated: false, safetyNetSnapshotId: '', preUpdateVersionId: '' };
  }

  const workingDir = workingDirFor(art);
  const scaffoldDir = scaffoldDirFor(art);
  if (!existsSync(scaffoldDir)) throw new Error(`FeaturedScaffoldMissing: no scaffold on disk for ${artifactId}`);

  const authorName = opts.authorName || 'ekoa';
  const authorEmail = `${authorName}@ekoa.local`;

  // ---- Safety net first; both must succeed before any file mutates. ----
  const backups = new AppDataBackups(opts.appDeps);
  const snapshot = await backups.saveSnapshot(artifactId, 'safety-net');
  const pre = await commitSnapshot({ projectDir: workingDir, message: 'pre-update snapshot', authorName, authorEmail, audit: opts.audit });
  const preUpdateVersionId = pre.sha;
  if (!preUpdateVersionId) throw new Error('PreUpdateSnapshotFailed: no current working copy to snapshot');

  try {
    // Copy the new scaffold over the working copy; remove files it no longer carries.
    const keep = new Set<string>(['manifest.json']);
    for (const rel of await collectScaffoldPaths(scaffoldDir)) {
      const parts = rel.split('/').filter(Boolean);
      if (parts.some((s) => s === '..' || s.startsWith('/'))) continue;
      const dest = resolve(workingDir, ...parts);
      if (dest !== workingDir && !dest.startsWith(workingDir + sep)) continue;
      keep.add(parts.join('/'));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(join(scaffoldDir, rel)));
    }
    for (const rel of await collectScaffoldPaths(workingDir)) {
      if (keep.has(rel) || rel === '.gitignore') continue;
      await rm(join(workingDir, ...rel.split('/')), { force: true });
    }

    try { await appBuilder.unwatch(artifactId); } catch { /* not watched */ }
    const result = await appBuilder.build(artifactId, workingDir);
    if (!result.success) throw new Error(`BuildFailed: the updated source did not compile (${result.errors.join('; ')})`);
  } catch (err) {
    let note = 'the previous version was restored';
    try {
      await restoreVersion({ projectDir: workingDir, sha: preUpdateVersionId, authorName, authorEmail });
      await appBuilder.build(artifactId, workingDir);
    } catch (restoreErr) {
      note = `restoring the previous version also failed: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}`;
    }
    throw new Error(`${err instanceof Error ? err.message : String(err)}; ${note}`);
  }

  await commitSnapshot({ projectDir: workingDir, message: 'update from source', authorName, authorEmail, audit: opts.audit });
  await patchArtifactData(artifactId, { projectDir: workingDir, customized: true, seededVersion: manifestVersion, updateAvailable: null });
  try {
    await appRegistry.register(artifactId, workingDir, art.userId, art.name);
  } catch (err) {
    console.warn(`[featured-update] post-update register failed for ${artifactId}:`, err instanceof Error ? err.message : err);
  }
  return { updated: true, safetyNetSnapshotId: snapshot.pointId, preUpdateVersionId };
}

/**
 * Record the user's choice to keep their version: stamp `ignoredVersion` with the
 * offered version and clear `updateAvailable` so the badge disappears until a
 * still-newer manifest ships.
 */
export async function ignoreFeaturedUpdate(artifactId: string): Promise<ArtifactDoc> {
  const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
  if (!art) throw new Error(`ArtifactNotFound: ${artifactId}`);
  if (!art.featured) throw new Error('NotFeatured: only featured artifacts have update flags');
  const data = (art.data ?? {}) as Record<string, unknown>;
  const offered =
    data.updateAvailable && typeof data.updateAvailable === 'object'
      ? (data.updateAvailable as { version?: string }).version
      : undefined;
  const patch: Record<string, unknown> = { updateAvailable: null };
  if (offered) patch.ignoredVersion = offered;
  return (await patchArtifactData(artifactId, patch)) as ArtifactDoc;
}
