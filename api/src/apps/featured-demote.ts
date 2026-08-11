/**
 * Featured-artifact demotion (WS10 Stage B). Converts a boot-seeded featured
 * artifact into an ordinary artifact permanently owned by the live super-admin:
 * materialises the read-only scaffold into a real sandbox working copy, strips
 * every featured/seeded marker from the row, and deletes the source scaffold
 * directory so the boot-time seeder (featured-seeder.ts) can never resurrect it.
 * Mechanism only - which ids to demote is a WS10 Stage A decision (the
 * disposition ledger), not this module's concern; it demotes whatever id it is
 * given, and refuses anything that is not currently a boot-seeded featured
 * artifact.
 *
 * ORDER OF OPERATIONS MATTERS - each step must fully succeed before the next
 * runs:
 *   1. copy the scaffold -> a new sandbox working dir (the source stays
 *      read-only and untouched until step 3);
 *   2. flip the row in ONE CAS update: featured=false, drop featuredRank,
 *      clear every seed/U1 marker (seededFrom, seededVersion, updateAvailable,
 *      ignoredVersion, customized), record the new working dir, and reassign
 *      ownership to a LIVE super-admin;
 *   3. remove the on-disk asset dir, and the (regenerable, cache-only)
 *      featured-builds mirror if one exists - IMMEDIATELY after step 2, with
 *      no I/O-heavy work between them (see CRASH SAFETY below for why);
 *   4. register + build the working dir so the (now ordinary) artifact serves
 *      exactly like any other, from the SAME id/slug. This runs LAST because
 *      it reads from the new working dir, not from the asset dir - it has no
 *      ordering dependency on step 3, so it does not need to sit inside the
 *      hazard window that matters (see below).
 *
 * WHY 2-then-3 - two independent bugs this avoids, both verified by reading
 * `seedFeaturedArtifacts()` (featured-seeder.ts):
 *  - If the marker is cleared but the asset dir survives, the NEXT BOOT's
 *    seeder still walks that dir (its main loop iterates disk manifests, not
 *    rows) and its "existing row, needs a patch" branch unconditionally sets
 *    `featured: true` again on any row whose `featured !== true` - undoing the
 *    demotion. Removing the asset dir is what stops the seeder from ever
 *    visiting this id again.
 *  - If the asset dir is removed first, or the marker is cleared in a SEPARATE
 *    step before the dir removal lands, a boot that races the gap sees a row
 *    with `featured===true` (or the marker still set) whose disk dir is gone -
 *    exactly what the seeder's orphan sweep deletes outright.
 *
 * CRASH SAFETY - what happens on a run that dies partway through, per step:
 *  - Dies during step 1 (copy): the row is completely untouched (still
 *    featured, still marked). `targetDir` may hold partial files, but nothing
 *    reads it yet. Re-running `demoteFeaturedArtifact(id)` is safe - it will
 *    still pass the seeded-featured precondition and simply re-copy (each
 *    file overwrites deterministically from the same scaffold source).
 *  - Dies during step 2 (the CAS update): `Store.update` -> Mongo `replaceOne`
 *    is atomic at the document level - it either fully applies or not at all,
 *    there is no torn write. If it never applied, the row is exactly as if
 *    step 1 were the last thing that happened: safe to re-run for the same
 *    reason as above.
 *  - Dies between step 2 and step 3 (row flipped, asset dir not yet removed)
 *    - THE ONE REMAINING UNSAFE WINDOW, and the reason step 3 was moved to
 *      run immediately after step 2 rather than after the (slower) build:
 *      this window is now just two back-to-back `await`s, but it is not
 *      literally zero. If the live API server boots in this exact window,
 *      the seeder's per-manifest loop still finds the asset dir, finds the
 *      row, sees `featured !== true`, and patches `featured: true` back on -
 *      but it does NOT restore `data.seededFrom` (the patch branch only ever
 *      touches `featured`/`featuredRank`/`sharedData`/`seededVersion`/
 *      `updateAvailable`). The row lands in a detectable, recoverable
 *      inconsistent state: `featured:true` with NO `seededFrom` marker. A
 *      re-run of THIS script will refuse it (`isSeededFeatured` requires
 *      BOTH `featured===true` AND the marker, so it now reads as "not a
 *      seeded featured artifact" and throws `NotAFeaturedSeedError`) - the
 *      correct recovery is a plain `setFeaturedFlag(id, false)`
 *      (app-paths.ts), since the copy/ownership/projectDir work from steps
 *      1-2 already landed correctly; nothing else needs to be redone.
 *  - Dies during or after step 3 (asset dir removed) but before/during step 4
 *    (register/build): the row and disk state are already fully, durably
 *    demoted - this is a build-quality problem (fix with a normal rebuild of
 *    the artifact), never a data-safety one. `demoteFeaturedArtifact` itself
 *    treats a register/build failure as non-fatal for exactly this reason
 *    (see the DemotionResult.built/buildErrors fields).
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Doc } from '../data/store.js';
import { artifacts, users } from '../data/stores.js';
import type { ArtifactDoc } from './artifacts-service.js';
import { newProjectDir } from './app-paths.js';
import { featuredArtifactDir } from './featured-seeder.js';
import { featuredBuildsRoot } from '../services/safe-path.js';
import { appBuilder } from './builder.js';
import { appRegistry } from './app-registry.js';

const SEEDED_FROM = 'assets/featured-artifacts';
/** The seed-lifecycle subset of RESERVED_ARTIFACT_DATA_KEYS (artifacts-service.ts) that must
 *  not survive a demotion - everything U1 version-reconciliation ever wrote onto this row. */
const SEED_MARKER_KEYS = ['seededFrom', 'seededVersion', 'updateAvailable', 'ignoredVersion', 'customized'] as const;

/** Top-level entries a scaffold copy never carries (same set fork/featured-update exclude). */
const EXCLUDE_TOP = new Set(['dist', 'dist-backend', 'node_modules', '.git', 'app-data', '.sdk-session', '.versions']);

export class ArtifactNotFoundError extends Error {}
export class NotAFeaturedSeedError extends Error {}
export class NoLiveSuperAdminError extends Error {}
export class FeaturedScaffoldMissingError extends Error {}

function isSeededFeatured(art: ArtifactDoc): boolean {
  const data = (art.data ?? {}) as Record<string, unknown>;
  return art.featured === true && data.seededFrom === SEEDED_FROM;
}

/** `users.find({role:'super-admin', active:true})[0]` - the same lookup featured-seeder.ts uses
 *  to decide ownership at seed time. Demotion refuses to run without a LIVE admin rather than
 *  falling back to the seeder's `'system'` placeholder - a demoted artifact needs a real owner. */
async function getLiveSuperAdmin(): Promise<{ userId: string; orgId: string }> {
  const rows = await users.find({ role: 'super-admin', active: true });
  const sa = rows[0];
  if (!sa) throw new NoLiveSuperAdminError('No active super-admin exists to own the demoted artifact.');
  return { userId: sa._id, orgId: (sa.orgId as string) ?? 'system' };
}

async function loadSeededFeatured(id: string): Promise<ArtifactDoc> {
  const art = (await artifacts.get(id)) as ArtifactDoc | null;
  if (!art) throw new ArtifactNotFoundError(`Artifact not found: ${id}`);
  if (!isSeededFeatured(art)) {
    const data = (art.data ?? {}) as Record<string, unknown>;
    throw new NotAFeaturedSeedError(
      `${id} is not a boot-seeded featured artifact (featured=${art.featured}, seededFrom=${String(data.seededFrom)}) - refusing (already demoted, or never was one).`,
    );
  }
  return art;
}

/** Recursively copy every scaffold file into `destDir`, same runtime-dir exclusions as fork. */
async function copyScaffold(scaffoldDir: string, destDir: string): Promise<void> {
  async function walk(rel: string): Promise<void> {
    const abs = rel ? join(scaffoldDir, rel) : scaffoldDir;
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      if (!rel && EXCLUDE_TOP.has(e.name)) continue;
      const childRel = rel ? join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        await walk(childRel);
      } else if (e.isFile()) {
        const destPath = join(destDir, childRel);
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, await readFile(join(scaffoldDir, childRel)));
      }
    }
  }
  await mkdir(destDir, { recursive: true });
  await walk('');
}

export interface DemotionPlan {
  id: string;
  name: string;
  currentOwner: { userId: string; orgId: string };
  newOwner: { userId: string; orgId: string };
  assetDir: string;
  scaffoldDir: string;
  targetDir: string;
  targetDirAlreadyExists: boolean;
}

/**
 * Read-only preview of what `demoteFeaturedArtifact` would do - no writes, no fs mutation.
 * Throws the same typed errors a real run would (not-found / not-a-seeded-featured / no live
 * admin), so a dry-run CLI can report the exact reason a demotion would fail.
 */
export async function planDemotion(id: string): Promise<DemotionPlan> {
  const art = await loadSeededFeatured(id);
  const newOwner = await getLiveSuperAdmin();
  const assetDir = featuredArtifactDir(id);
  const scaffoldDir = join(assetDir, 'scaffold');
  const targetDir = newProjectDir(newOwner.userId, id);
  return {
    id,
    name: art.name,
    currentOwner: { userId: art.userId, orgId: art.orgId },
    newOwner,
    assetDir,
    scaffoldDir,
    targetDir,
    targetDirAlreadyExists: existsSync(targetDir),
  };
}

export interface DemotionResult {
  id: string;
  targetDir: string;
  built: boolean;
  buildErrors: string[];
  assetDirRemoved: boolean;
  newOwner: { userId: string; orgId: string };
}

/**
 * Demote one featured artifact in place (same id, same slug, same row). Refuses anything that
 * is not currently a boot-seeded featured artifact - a second run, or a run against an id that
 * was never one, fails loudly instead of silently re-copying the scaffold over live user edits.
 */
export async function demoteFeaturedArtifact(id: string): Promise<DemotionResult> {
  const art = await loadSeededFeatured(id);
  const assetDir = featuredArtifactDir(id);
  const scaffoldDir = join(assetDir, 'scaffold');
  if (!existsSync(scaffoldDir)) {
    throw new FeaturedScaffoldMissingError(`FeaturedScaffoldMissing: no scaffold on disk for ${id}`);
  }
  const newOwner = await getLiveSuperAdmin();
  const targetDir = newProjectDir(newOwner.userId, id);

  // 1. Materialise the scaffold into a real working copy before anything else changes.
  //    The scaffold dir is read-only-in-spirit up to this point (nothing has mutated yet).
  await copyScaffold(scaffoldDir, targetDir);

  // 2. Flip the row to an ordinary artifact in one CAS update: drop `featured` + `featuredRank`
  //    + every seed marker, record the new working dir, reassign ownership. `Store.update` does
  //    a full-document replace (not a $set merge) - a key the mutator's return value omits is
  //    genuinely gone from the stored doc, not left behind nulled.
  await artifacts.update(id, (a) => {
    const { featuredRank: _drop, ...rest } = a as Doc & { featuredRank?: number };
    const data = { ...((a.data as Record<string, unknown> | undefined) ?? {}) };
    for (const key of SEED_MARKER_KEYS) delete data[key];
    data.projectDir = targetDir;
    return {
      ...rest,
      featured: false,
      userId: newOwner.userId,
      orgId: newOwner.orgId,
      data,
      updatedAt: new Date().toISOString(),
    };
  });

  // 3. Remove the source asset dir IMMEDIATELY after the row flip - back-to-back awaits, no
  //    I/O-heavy work between them - so the boot seeder can never revisit this id. This runs
  //    BEFORE register/build (which is slower and reads from `targetDir`, not `assetDir`/
  //    `scaffoldDir`, so it has no ordering dependency on the asset dir at all) specifically to
  //    keep the "row already flipped, disk dir still present" window as short as physically
  //    possible - see the file header for why that window is the one real hazard here. Also
  //    removes the (regenerable, cache-only) featured-builds mirror if the prebuilder had made
  //    one; that one carries no seeder-visible risk either way, cleaned up here for tidiness.
  await rm(assetDir, { recursive: true, force: true });
  const mirrorDir = join(featuredBuildsRoot(), id);
  await rm(mirrorDir, { recursive: true, force: true }).catch(() => {});

  // 4. Register + build so it serves exactly like any other artifact from here on. `register()`
  //    tears down whatever this id was previously registered under (the featured-builds mirror
  //    dir, if the prebuilder had run) before pointing at the new sandbox dir - same id, so no
  //    separate unregister call is needed. A failure here is non-fatal and does not roll back:
  //    by this point the row and disk state are already fully, durably demoted (steps 1-3
  //    committed) - a broken build is a build-quality problem to fix with a normal rebuild, not
  //    a reason to leave the artifact mis-classified as featured.
  let built = false;
  let buildErrors: string[] = [];
  try {
    await appRegistry.register(id, targetDir, newOwner.userId, art.name);
    const result = await appBuilder.build(id, targetDir);
    built = result.success;
    buildErrors = result.errors;
  } catch (err) {
    buildErrors = [err instanceof Error ? err.message : String(err)];
    console.warn(
      `[featured-demote] register/build failed for ${id} (row already demoted, scaffold already copied - re-run appBuilder.build manually):`,
      buildErrors[0],
    );
  }

  return {
    id,
    targetDir,
    built,
    buildErrors,
    assetDirRemoved: !existsSync(assetDir),
    newOwner,
  };
}
