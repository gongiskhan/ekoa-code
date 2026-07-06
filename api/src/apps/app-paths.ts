/**
 * Shared project-directory resolution + artifact ownership helpers for the
 * artifact FAMILY (ch07 §7.9-7.13). Ported from the old `resolveSourceProjectDir`
 * / `projectDirFor` logic (services/artifact-fork.ts, services/artifact-bundle.ts),
 * adapted to the ekoa-code `artifacts` store (ArtifactDoc) and the injected-seam
 * boundaries.
 *
 * A registered app lives at `<sandboxRoot>/user-<userId>/<appId>` unless the row
 * records its own `data.projectDir` (the common case for chat-session builds).
 * A seeded featured artifact serves from `<featuredArtifactDir(id)>/scaffold`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts } from '../data/stores.js';
import type { ArtifactDoc } from './artifacts-service.js';
import type { Actor } from '../data/scoped.js';
import { sandboxRoot } from '../services/safe-path.js';
import { featuredArtifactDir } from './featured-seeder.js';

const SEEDED_FROM = 'assets/featured-artifacts';

/** The on-disk working copy for an artifact's source tree (see file header). */
export function projectDirFor(art: ArtifactDoc): string {
  const data = (art.data ?? {}) as Record<string, unknown>;
  // Seeded featured artifacts serve from the versioned scaffold dir.
  if (art.featured === true && data.seededFrom === SEEDED_FROM) {
    return join(featuredArtifactDir(art._id), 'scaffold');
  }
  // A recorded projectDir wins (session-keyed builds record it explicitly).
  const recorded = data.projectDir;
  if (typeof recorded === 'string' && recorded.length > 0) return recorded;
  // Default sandbox layout the registry boot-scan expects.
  return join(sandboxRoot(), `user-${art.userId}`, art._id);
}

/** The fresh working-copy dir a NEW artifact (fork/import) owns. */
export function newProjectDir(ownerUserId: string, appId: string): string {
  return join(sandboxRoot(), `user-${ownerUserId}`, appId);
}

/** Absolute path to an artifact's built backend bundle, or null when absent. */
export function backendBundlePath(art: ArtifactDoc): string | null {
  const bundle = join(projectDirFor(art), 'dist-backend', 'backend.mjs');
  return existsSync(bundle) ? bundle : null;
}

export type OwnershipVerdict = 'ok' | 'notfound' | 'forbidden';

/**
 * Load an artifact the actor may READ: own (any visibility) or org-shared. A
 * private row of another user (and any cross-org row) is a uniform not-found
 * (ownership-mismatch parity, ch04). Mirrors OwnerVisibilityScoped.getVisible.
 */
export async function loadReadable(actor: Actor, id: string): Promise<ArtifactDoc | null> {
  const art = (await artifacts.get(id)) as ArtifactDoc | null;
  if (!art) return null;
  if (art.orgId !== actor.orgId) return null;
  if (art.userId === actor.userId) return art;
  if (art.visibility === 'org') return art;
  return null;
}

/**
 * Load an artifact the actor may WRITE: own always, org-shared by any org member.
 * A private row of another user → forbidden; a missing/cross-org row → notfound.
 * Mirrors OwnerVisibilityScoped.writeGuard.
 */
export async function loadWritable(
  actor: Actor,
  id: string,
): Promise<{ verdict: OwnershipVerdict; art?: ArtifactDoc }> {
  const art = (await artifacts.get(id)) as ArtifactDoc | null;
  if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
  if (art.userId === actor.userId) return { verdict: 'ok', art };
  if (art.visibility === 'org') return { verdict: 'ok', art };
  return { verdict: 'forbidden', art };
}

/** Merge a patch into an artifact's `data` bag and persist. */
export async function patchArtifactData(
  id: string,
  patch: Record<string, unknown>,
): Promise<ArtifactDoc | null> {
  return (await artifacts.update(id, (a) => {
    const data = { ...((a.data as Record<string, unknown>) ?? {}), ...patch };
    return { ...a, data };
  })) as ArtifactDoc | null;
}

/** Cross-org fetch by id (super-admin platform paths only; the route enforces the role). */
export async function getArtifactById(id: string): Promise<ArtifactDoc | null> {
  return (await artifacts.get(id)) as ArtifactDoc | null;
}

/** Platform-wide featured toggle + rank (ch07 §7.13; super-admin only, route-enforced). */
export async function setFeaturedFlag(
  id: string,
  featured: boolean,
  featuredRank?: number,
): Promise<ArtifactDoc | null> {
  return (await artifacts.update(id, (a) => ({
    ...a,
    featured,
    ...(featuredRank !== undefined ? { featuredRank } : {}),
  }))) as ArtifactDoc | null;
}
