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
import { resolveWithinJail, sandboxRoot, UnsafePathError } from '../services/safe-path.js';
import { featuredArtifactDir } from './featured-seeder.js';

const SEEDED_FROM = 'assets/featured-artifacts';

/** The deterministic sandbox layout the registry boot-scan expects — always inside the jail. */
function defaultProjectDir(art: ArtifactDoc): string {
  return join(sandboxRoot(), `user-${art.userId}`, art._id);
}

/**
 * The jail-resolved `data.projectDir` a row records, or undefined when absent or escaping.
 * `data` is a client-influenced bag, so NO consumer may read `data.projectDir` raw: resolve it
 * through the owner sandbox jail (ch09 invariant 10, FIXED-8) and drop it if it escapes — never
 * hand back the attacker path. This closes the follow-up build sandbox-escape vector where a
 * PATCHed `data.projectDir` would otherwise become an agent run's cwd/HOME or a build source.
 */
export function recordedProjectDir(data: Record<string, unknown>): string | undefined {
  const recorded = data.projectDir;
  if (typeof recorded !== 'string' || recorded.length === 0) return undefined;
  try {
    return resolveWithinJail(sandboxRoot(), recorded);
  } catch (err) {
    if (!(err instanceof UnsafePathError)) throw err;
    return undefined;
  }
}

/** The on-disk working copy for an artifact's source tree (see file header). */
export function projectDirFor(art: ArtifactDoc): string {
  const data = (art.data ?? {}) as Record<string, unknown>;
  // Seeded featured artifacts serve from the versioned scaffold dir (server-derived, already safe).
  if (art.featured === true && data.seededFrom === SEEDED_FROM) {
    return join(featuredArtifactDir(art._id), 'scaffold');
  }
  // A recorded projectDir wins (session-keyed builds record it explicitly), jail-resolved.
  return recordedProjectDir(data) ?? defaultProjectDir(art);
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

/**
 * Is this artifact a BUILT app — a code sandbox the app build/edit capabilities govern (H1 HIGH-2)?
 * The primary, reliable signal is a recorded `data.projectDir`: ONLY an artifact produced by the
 * build pipeline (`prepareFirstBuild`) carries one — a bare `POST /artifacts` record does not, and
 * that projectDir is what feeds every code-editing route (`projectDirFor`). The secondary signal is
 * a stored `data.artifactType === 'app'` (a pre-build row that named its type before a sandbox
 * existed). An artifact matching NEITHER is a non-app artifact a plain `user` may still manage
 * (canCreateArtifacts) — the gates below only tighten APP build/edit, never generic artifact CRUD.
 */
export function isAppArtifact(art: ArtifactDoc): boolean {
  const data = (art.data ?? {}) as Record<string, unknown>;
  if (typeof data.projectDir === 'string' && data.projectDir.length > 0) return true;
  return data.artifactType === 'app';
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
