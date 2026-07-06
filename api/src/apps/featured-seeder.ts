/**
 * Featured-artifacts seeder (ch07 §7.13, carried; reference/invisible-behaviors §5.1/8.4).
 * Reads `api/assets/featured-artifacts/{id}/manifest.json` at boot (sequential
 * migrations phase) and ensures a matching artifact record exists with
 * `featured: true`, owned by the bootstrap super-admin. Sweeps orphans whose
 * source directory disappeared (only rows we seeded - the `seededFrom` marker).
 * Idempotent every boot.
 *
 * U1 version reconciliation (carried): a customized instance is NEVER silently
 * overwritten - when the manifest version moves past the last-synced one (and the
 * user has not ignored it) the row gets `data.updateAvailable = { version }` and
 * the user consents via featured-update/apply. Non-customized instances keep the
 * auto-refresh behaviour (the prebuilder re-copies the scaffold); the seeder just
 * bookkeeps `seededVersion` and clears stale flags.
 *
 * Adaptation to the new stores (logged): the scaffold manifest's `sharedData`
 * opt-in is stamped onto the artifact row - the new data plane resolves the
 * shared-namespace opt-in from the artifact record, where the old one read the
 * registry manifest. The slug is written to BOTH the `slugs` reservation
 * collection and the in-memory serving index, keeping every resolver consistent.
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifacts, slugs, users } from '../data/stores.js';
import { indexSlug, unindexSlug } from './slug-index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDED_FROM = 'assets/featured-artifacts';

export interface FeaturedArtifactManifest {
  id: string;
  name: string;
  description?: string;
  extends?: string;
  outputKind?: string;
  icon?: string;
  featuredRank?: number;
  version?: string;
}

/** The versioned featured catalog inside the repository (resolves from BOTH
 *  api/src/apps and api/dist/apps - assets/ sits at the api package root). */
export function featuredArtifactsDir(): string {
  return process.env.EKOA_FEATURED_ARTIFACTS_DIR || join(__dirname, '..', '..', 'assets', 'featured-artifacts');
}

export function featuredArtifactDir(id: string): string {
  return join(featuredArtifactsDir(), id);
}

async function getSuperAdmin(): Promise<{ id: string; orgId: string } | null> {
  const rows = await users.find({ role: 'super-admin', active: true });
  const sa = rows[0];
  return sa ? { id: sa._id, orgId: (sa.orgId as string) ?? 'system' } : null;
}

/** Read the scaffold manifest's opt-ins that must ride the artifact record. */
async function readScaffoldFlags(root: string, id: string): Promise<{ sharedData: boolean }> {
  try {
    const raw = await readFile(join(root, id, 'scaffold', 'manifest.json'), 'utf-8');
    const m = JSON.parse(raw) as Record<string, unknown>;
    return { sharedData: m.sharedData === true };
  } catch {
    return { sharedData: false };
  }
}

export interface SeedResult {
  seeded: number;
  refreshed: number;
  orphansRemoved: number;
}

/** @param overrideRoot test hook only - production callers must not pass it. */
export async function seedFeaturedArtifacts(overrideRoot?: string): Promise<SeedResult> {
  const root = overrideRoot ?? featuredArtifactsDir();
  const result: SeedResult = { seeded: 0, refreshed: 0, orphansRemoved: 0 };
  if (!existsSync(root)) return result;

  const dirEntries = await readdir(root, { withFileTypes: true });
  const dirs = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);

  const superAdmin = await getSuperAdmin();
  const existingRows = await artifacts.find({ featured: true });
  const validDiskIds = new Set<string>();

  for (const dirName of dirs) {
    const manifestPath = join(root, dirName, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: FeaturedArtifactManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as FeaturedArtifactManifest;
    } catch {
      console.warn(`[featured-seeder] invalid manifest in ${dirName}, skipping`);
      continue;
    }
    if (!manifest.id) {
      console.warn(`[featured-seeder] manifest missing id in ${dirName}, skipping`);
      continue;
    }
    validDiskIds.add(manifest.id);

    const manifestVersion = manifest.version || '1.0.0';
    const { sharedData } = await readScaffoldFlags(root, dirName);
    const existing = await artifacts.get(manifest.id);

    if (existing) {
      // Refresh featured flag + rank + opt-ins in case the manifest evolved,
      // and reconcile versions (U1) without ever clobbering a customization.
      const data = (existing.data ?? {}) as Record<string, unknown>;
      const seededVersion = typeof data.seededVersion === 'string' ? data.seededVersion : undefined;
      const ignoredVersion = typeof data.ignoredVersion === 'string' ? data.ignoredVersion : undefined;
      const customized = data.customized === true;
      const newData = { ...data };
      let dataChanged = false;

      if (!customized) {
        if (seededVersion !== manifestVersion) { newData.seededVersion = manifestVersion; dataChanged = true; }
        if (newData.updateAvailable != null) { newData.updateAvailable = null; dataChanged = true; }
      } else if (seededVersion === undefined) {
        newData.seededVersion = manifestVersion;
        dataChanged = true;
      } else if (manifestVersion !== seededVersion && manifestVersion !== ignoredVersion) {
        const already =
          data.updateAvailable != null && (data.updateAvailable as { version?: string }).version === manifestVersion;
        if (!already) { newData.updateAvailable = { version: manifestVersion }; dataChanged = true; }
      }

      const needsPatch =
        existing.featured !== true ||
        existing.featuredRank !== manifest.featuredRank ||
        existing.sharedData !== sharedData ||
        dataChanged;
      if (needsPatch) {
        await artifacts.update(manifest.id, (a) => ({
          ...a,
          featured: true,
          sharedData,
          ...(manifest.featuredRank !== undefined ? { featuredRank: manifest.featuredRank } : {}),
          ...(dataChanged ? { data: newData } : {}),
        }));
        result.refreshed++;
      }
      // Always (re)index the slug - idempotent, and the seeder may race the
      // parallel-boot loadSlugIndex on first startup (carried note).
      const slug = (existing.slug as string) || manifest.id;
      await slugs.put({ _id: slug, artifactId: manifest.id });
      indexSlug(slug, manifest.id);
      continue;
    }

    await artifacts.insert({
      _id: manifest.id,
      name: manifest.name,
      slug: manifest.id,
      userId: superAdmin?.id ?? 'system',
      orgId: superAdmin?.orgId ?? 'system',
      visibility: 'org',
      status: 'active',
      featured: true,
      ...(manifest.featuredRank !== undefined ? { featuredRank: manifest.featuredRank } : {}),
      shareable: true,
      sharedData,
      data: {
        description: manifest.description,
        icon: manifest.icon,
        outputKind: manifest.outputKind,
        typeId: manifest.extends ?? 'app-auth-persistent',
        seededFrom: SEEDED_FROM,
        seededVersion: manifestVersion,
      },
    } as never);
    await slugs.put({ _id: manifest.id, artifactId: manifest.id });
    indexSlug(manifest.id, manifest.id);
    result.seeded++;
  }

  // Orphan sweep: only rows WE seeded (marker) whose source directory is gone.
  for (const row of existingRows) {
    const isOurs =
      typeof row.data === 'object' && row.data !== null &&
      (row.data as Record<string, unknown>).seededFrom === SEEDED_FROM;
    if (!isOurs) continue;
    if (validDiskIds.has(row._id)) continue;
    await artifacts.delete(row._id);
    if (row.slug) {
      await slugs.delete(row.slug as string);
      unindexSlug(row.slug as string);
    }
    result.orphansRemoved++;
    console.log(`[featured-seeder] removed orphan featured artifact: ${row._id} (${row.name})`);
  }

  return result;
}
