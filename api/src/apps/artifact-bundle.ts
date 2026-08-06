/**
 * Artifact bundle export / import / update-in-place (ch03 §3.8.9, ch07 §7.10).
 * Ported from the old services/artifact-bundle.ts, re-shaped to the ekoa-code
 * SHARED `ArtifactBundle` contract (shared/src/artifacts.ts):
 *   { manifestId, name?, slug?, files: [{path, content}], data?, version? }
 * The old base64 envelope is replaced by the normative shared schema (plaintext
 * file content) - the client keeps zip packing/parsing; the API sends/receives the
 * parsed bundle JSON.
 *
 * Update-in-place is the safety-net-FIRST flow (§7.10): an app-data snapshot and a
 * pre-update version commit are taken BEFORE the tree is touched, and their ids are
 * returned (`safetyNetSnapshotId`, `preUpdateVersionId`); a bundle whose manifest
 * id does not match the target is refused `409 MANIFEST_ID_MISMATCH` unless
 * `force`. A failed rebuild auto-restores the pre-update version.
 *
 * All git writes go through §7.9 (commit-guard's secret-guarded snapshot + the
 * per-repo lock) and all rebuilds through the builder entry (§7.2) - no side doors.
 *
 * DEVIATION (logged): binary/oversized files are skipped on export (the shared
 * schema's `content` is a plaintext string; the old base64 form is retired) and
 * featured seed-data is not carried into the bundle (seed lives in the featured
 * catalog and is applied by fork).
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
import { artifacts, slugs } from '../data/stores.js';
import type { Actor } from '../data/scoped.js';
import type { ArtifactBundle } from '@ekoa/shared';
import { generateSlug, type ArtifactDoc, type Deps } from './artifacts-service.js';
import { indexSlug } from './slug-index.js';
import { projectDirFor, newProjectDir } from './app-paths.js';
import { readManifest, createDefaultManifest, writeManifest, type AppManifest } from './manifest.js';
import { appBuilder } from './builder.js';
import { appRegistry } from './app-registry.js';
import { commitSnapshot, type SnapshotAudit } from '../services/commit-guard.js';
import { restoreVersion } from './versions.js';
import { AppDataBackups } from './backups.js';
import { AppDataAccess, type AppDataDeps, type AppDataDump } from './app-data-access.js';

const EXCLUDE_TOP = new Set(['dist', 'dist-backend', 'node_modules', '.git', 'app-data', '.sdk-session', '.versions']);
const MAX_FILE_BYTES = 1_500_000;
const NUL = String.fromCharCode(0);

export class ManifestIdMismatchError extends Error {
  constructor(incoming: string | undefined) {
    super(`bundle manifest.id "${incoming ?? '(none)'}" is not a revision of this app`);
    this.name = 'ManifestIdMismatchError';
  }
}

/** Per-artifact serialization lane for bundle updates (independent of the git lock). */
const appLocks = new Map<string, Promise<unknown>>();
function withAppLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const prev = appLocks.get(appId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  appLocks.set(appId, tail);
  void tail.then(() => { if (appLocks.get(appId) === tail) appLocks.delete(appId); });
  return run;
}

/** Collect scaffold text files (relative path + utf-8 content), excluding runtime dirs. */
async function collectFiles(root: string): Promise<Array<{ path: string; content: string }>> {
  if (!existsSync(root)) return [];
  const out: Array<{ path: string; content: string }> = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (!prefix && EXCLUDE_TOP.has(e.name)) continue;
      if (e.isDirectory()) {
        await walk(join(dir, e.name), rel);
      } else if (e.isFile()) {
        const full = join(dir, e.name);
        const s = await stat(full);
        if (s.size > MAX_FILE_BYTES) continue;
        const content = await readFile(full, 'utf-8');
        if (content.indexOf(NUL) !== -1) continue; // binary - not representable as plaintext
        out.push({ path: rel, content });
      }
    }
  }
  await walk(root, '');
  return out;
}

export async function exportArtifact(art: ArtifactDoc): Promise<ArtifactBundle> {
  const projectDir = projectDirFor(art);
  const files = await collectFiles(projectDir);
  const manifest = await readManifest(projectDir).catch(() => null);
  return {
    manifestId: art._id,
    name: art.name,
    ...(art.slug ? { slug: art.slug } : {}),
    files,
    version: manifest?.version ?? '1.0.0',
  };
}

/** Reject traversal/absolute paths; return the confined absolute dest or null. */
function safeDest(projectDir: string, relPath: string): string | null {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0 || parts.some((s) => s === '..' || s.startsWith('/'))) return null;
  const dest = resolve(projectDir, ...parts);
  if (dest !== projectDir && !dest.startsWith(projectDir + sep)) return null;
  return dest;
}

async function writeBundleFiles(projectDir: string, bundle: ArtifactBundle): Promise<Set<string>> {
  const written = new Set<string>();
  for (const f of bundle.files ?? []) {
    const dest = safeDest(projectDir, f.path);
    if (!dest) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.content, 'utf-8');
    written.add(f.path.split(/[/\\]/).filter(Boolean).join('/'));
  }
  return written;
}

/**
 * Extract a canonical app-data dump (`{ collections }`) from a bundle's optional
 * `data` field, or null when there is nothing to seed. ADDITIVE by construction:
 * the shared `ArtifactBundle.data` is a free `Record<string, unknown>`, so we only
 * treat it as app-data when it is unmistakably a collections dump — either the
 * canonical `{ collections: {name: [...]} }` shape (what a prod export/converter
 * emits, and what AppDataAccess.exportAll produces) or a bare `{ name: [...] }`
 * collection map. Anything else (absent, or some other metadata bag) is ignored,
 * so the pre-2B-S5 behavior of a data-less bundle is exactly preserved.
 */
function collectionsFromBundleData(data: ArtifactBundle['data']): Record<string, Array<Record<string, unknown>>> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const candidate =
    record.collections && typeof record.collections === 'object' && !Array.isArray(record.collections)
      ? (record.collections as Record<string, unknown>)
      : record;
  const collections: Record<string, Array<Record<string, unknown>>> = {};
  for (const [name, items] of Object.entries(candidate)) {
    if (Array.isArray(items)) collections[name] = items as Array<Record<string, unknown>>;
  }
  return Object.keys(collections).length > 0 ? collections : null;
}

/**
 * Seed a freshly-imported app's app-data from `bundle.data` (2B-S5). Best-effort
 * and isolated: a seeding failure is logged and swallowed exactly like the
 * post-import build, never breaking the import (the operator-run salomao-import
 * driver verifies the data actually landed). Items keep their ids
 * (CollectionsEngine.create preserves `item.id`).
 */
async function applyImportedAppData(appId: string, bundle: ArtifactBundle, deps: Deps): Promise<void> {
  const collections = collectionsFromBundleData(bundle.data);
  if (!collections) return; // no app-data in the bundle → current behavior unchanged.
  try {
    const dump: AppDataDump = { collections, counts: {}, totalItems: 0, at: new Date(deps.now()).toISOString() };
    const written = await new AppDataAccess(deps).importDump(appId, dump);
    console.info(`[import-artifact] seeded ${written} app-data item(s) for ${appId} from bundle.data`);
  } catch (err) {
    console.warn(`[import-artifact] app-data seeding failed for ${appId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Adopt the bundle's own `manifest.json` (re-stamping id + name for this instance), or write a
 * default when the bundle carried none.
 *
 * A manifest that is PRESENT but INVALID is a hard failure, deliberately. The manifest is where
 * an app declares its server-side backend (`backend.handlers`, e.g. `onEmail`), the base it
 * extends, and its workspace-proxy opt-in; substituting a default for it silently would import
 * an app that LOOKS fine, serves its UI, and has quietly lost its email handler and its Graph
 * access - a failure nobody sees until the feature does not fire in production. Refusing names
 * the real problem while it is still fixable.
 */
async function ensureManifest(projectDir: string, id: string, name: string): Promise<void> {
  let existing: AppManifest | null;
  try {
    existing = await readManifest(projectDir);
  } catch (err) {
    throw new Error(`Bundle manifest.json is invalid, so the import was refused rather than silently dropping what it declares: ${err instanceof Error ? err.message : String(err)}`);
  }
  const manifest = existing ?? createDefaultManifest(id, name);
  manifest.id = id;
  manifest.name = name;
  await writeManifest(projectDir, manifest);
}

export async function importArtifact(
  bundle: ArtifactBundle,
  owner: Actor,
  deps: Deps,
): Promise<ArtifactDoc> {
  const newId = deps.genId();
  const name = bundle.name ?? bundle.manifestId ?? 'App';
  const slug = await generateSlug(name, deps);
  await slugs.put({ _id: slug, artifactId: newId });
  indexSlug(slug, newId);

  const projectDir = newProjectDir(owner.userId, newId);
  await mkdir(projectDir, { recursive: true });
  await writeBundleFiles(projectDir, bundle);
  await ensureManifest(projectDir, newId, name);

  const now = new Date(deps.now()).toISOString();
  const doc: ArtifactDoc = {
    _id: newId,
    name,
    slug,
    userId: owner.userId,
    orgId: owner.orgId,
    visibility: 'private',
    featured: false,
    shareable: true,
    status: 'draft',
    data: { appUrl: `/apps/${newId}/`, projectDir, importedFrom: bundle.manifestId },
    createdAt: now,
    updatedAt: now,
  } as ArtifactDoc;
  await artifacts.insert(doc as never);

  // Seed app-data from bundle.data BEFORE the build so the served instance boots
  // with its data (2B-S5, additive: no-op when the bundle carries no data).
  await applyImportedAppData(newId, bundle, deps);

  // Build + register so the imported app is immediately viewable.
  try {
    const result = await appBuilder.build(newId, projectDir);
    await appRegistry.register(newId, projectDir, owner.userId, name);
    if (result.success) {
      await artifacts.update(newId, (a) => ({ ...a, status: 'active', updatedAt: new Date(deps.now()).toISOString() }));
      doc.status = 'active';
    }
  } catch (err) {
    console.warn(`[import-artifact] post-import build failed for ${newId}:`, err instanceof Error ? err.message : err);
  }
  return doc;
}

export interface UpdateFromBundleResult {
  artifact: ArtifactDoc;
  safetyNetSnapshotId: string;
  preUpdateVersionId: string;
}

/**
 * Replace an artifact's source from a bundle IN PLACE (id/slug/URL/app-data
 * preserved). Safety-nets first (both must succeed before the tree is touched):
 *   1. app-data safety-net snapshot;
 *   2. pre-update version commit of the current scaffold.
 * Then the new files replace the old (files absent from the bundle are deleted;
 * runtime dirs never touched) and the app rebuilds. A failed build auto-restores
 * the pre-update version.
 */
export async function updateArtifactFromBundle(
  art: ArtifactDoc,
  bundle: ArtifactBundle,
  opts: { force?: boolean; authorName?: string; audit: SnapshotAudit; appDeps: AppDataDeps },
  deps: Deps,
): Promise<UpdateFromBundleResult> {
  const data = (art.data ?? {}) as Record<string, unknown>;
  const knownIds = new Set([art._id, data.importedFrom].filter((v): v is string => typeof v === 'string'));
  if (!opts.force && (!bundle.manifestId || !knownIds.has(bundle.manifestId))) {
    throw new ManifestIdMismatchError(bundle.manifestId);
  }

  const projectDir = projectDirFor(art);
  const authorName = opts.authorName || 'ekoa';
  const authorEmail = `${authorName}@ekoa.local`;

  return withAppLock(art._id, async () => {
    // ---- Safety net first; both must succeed before any file mutates. ----
    const backups = new AppDataBackups(opts.appDeps);
    const snapshot = await backups.saveSnapshot(art._id, 'safety-net');

    const pre = await commitSnapshot({ projectDir, message: 'pre-update snapshot', authorName, authorEmail, audit: opts.audit });
    const preUpdateVersionId = pre.sha;
    if (!preUpdateVersionId) {
      throw new Error('PreUpdateSnapshotFailed: no current scaffold to snapshot; import as a new artifact instead');
    }

    try {
      // Write new files; delete scaffold files the bundle no longer carries.
      const keep = await writeBundleFiles(projectDir, bundle);
      keep.add('manifest.json');
      await ensureManifest(projectDir, art._id, bundle.name ?? art.name);
      for (const f of await collectFiles(projectDir)) {
        if (keep.has(f.path) || f.path === '.gitignore') continue;
        await rm(join(projectDir, ...f.path.split('/')), { force: true });
      }

      try { await appBuilder.unwatch(art._id); } catch { /* not watched */ }
      const result = await appBuilder.build(art._id, projectDir);
      if (!result.success) throw new Error(`BuildFailed: the updated bundle did not compile (${result.errors.join('; ')})`);
    } catch (err) {
      let note = 'the previous version was restored';
      try {
        await restoreVersion({ projectDir, sha: preUpdateVersionId, authorName, authorEmail });
        await appBuilder.build(art._id, projectDir);
      } catch (restoreErr) {
        note = `restoring the previous version also failed: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}`;
      }
      throw new Error(`${err instanceof Error ? err.message : String(err)}; ${note}`);
    }

    // The update itself becomes a revision the user can roll back from.
    await commitSnapshot({ projectDir, message: 'update from bundle', authorName, authorEmail, audit: opts.audit });

    const now = new Date(deps.now()).toISOString();
    const updated = (await artifacts.update(art._id, (a) => ({
      ...a,
      name: bundle.name ?? a.name,
      status: a.status === 'archived' ? a.status : 'active',
      updatedAt: now,
      data: { ...((a.data as Record<string, unknown>) ?? {}), lastBundleUpdateAt: now },
    }))) as ArtifactDoc;
    if (updated.slug) indexSlug(updated.slug, art._id);
    try {
      await appRegistry.register(art._id, projectDir, art.userId, updated.name);
    } catch (err) {
      console.warn(`[update-artifact] post-update register failed for ${art._id}:`, err instanceof Error ? err.message : err);
    }

    return { artifact: updated, safetyNetSnapshotId: snapshot.pointId, preUpdateVersionId };
  });
}
