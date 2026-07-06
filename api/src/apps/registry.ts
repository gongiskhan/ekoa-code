/**
 * App registry (ch07, ch04 §4.2.6). Resolves a served-app scope from the `X-Ekoa-App-Id`
 * header (slug OR canonical id; slug resolved server-side to the canonical id). Holds the
 * per-app compiled collection rules (from the manifest). In-memory (FIXED-8) + backed by the
 * `artifacts`/`slugs` stores. A client-supplied id starting with `usr.` is rejected upstream.
 */
import { artifacts, slugs } from '../data/stores.js';
import type { CollectionsBlock } from '../data/collections-engine.js';
import { appRegistry } from './app-registry.js';

export interface ResolvedApp {
  appId: string; // canonical artifact id (or the registry id for registry-only apps)
  ownerUserId: string;
  sharedData: boolean;
  /** True when a persisted artifact record backs the app. False for REGISTRY-ONLY
   *  apps (the dev-serve surface, hard-off in production): they have no artifact
   *  owner, so the Amendment 2 owner-activation admission has no subject and the
   *  callers skip it - carried old-plane behavior for that dev-only surface. */
  artifactBacked: boolean;
  collections?: CollectionsBlock;
}

/** Resolve a slug-or-id header to a canonical app. Returns null if unknown. */
export async function resolveApp(idOrSlug: string): Promise<ResolvedApp | null> {
  // Try slug first (the slugs reservation collection maps slug → artifactId).
  const slugRow = await slugs.get(idOrSlug);
  const artifactId = slugRow ? (slugRow.artifactId as string) : idOrSlug;
  const art = await artifacts.get(artifactId);
  if (art) {
    return {
      appId: art._id,
      ownerUserId: (art.userId as string) ?? '',
      sharedData: Boolean(art.sharedData),
      artifactBacked: true,
      collections: art.collections as CollectionsBlock | undefined,
    };
  }
  // Registry-only fallback (dev-serve, ch07 §7.4 trigger 6): a running app with no
  // artifact record. The old plane keyed data on the raw header with no artifact
  // requirement; this keeps that surface working without weakening the artifact-
  // backed admission (the flag tells callers which world they are in).
  const reg = appRegistry.getApp(idOrSlug);
  if (!reg) return null;
  return {
    appId: reg.id,
    ownerUserId: reg.userId,
    sharedData: (reg.manifest as { sharedData?: boolean } | null)?.sharedData === true,
    artifactBacked: false,
  };
}
