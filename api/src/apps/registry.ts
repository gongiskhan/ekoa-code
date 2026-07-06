/**
 * App registry (ch07, ch04 §4.2.6). Resolves a served-app scope from the `X-Ekoa-App-Id`
 * header (slug OR canonical id; slug resolved server-side to the canonical id). Holds the
 * per-app compiled collection rules (from the manifest). In-memory (FIXED-8) + backed by the
 * `artifacts`/`slugs` stores. A client-supplied id starting with `usr.` is rejected upstream.
 */
import { artifacts, slugs } from '../data/stores.js';
import type { CollectionsBlock } from '../data/collections-engine.js';

export interface ResolvedApp {
  appId: string; // canonical artifact id
  ownerUserId: string;
  sharedData: boolean;
  collections?: CollectionsBlock;
}

/** Resolve a slug-or-id header to a canonical app. Returns null if unknown. */
export async function resolveApp(idOrSlug: string): Promise<ResolvedApp | null> {
  // Try slug first (the slugs reservation collection maps slug → artifactId).
  const slugRow = await slugs.get(idOrSlug);
  const artifactId = slugRow ? (slugRow.artifactId as string) : idOrSlug;
  const art = await artifacts.get(artifactId);
  if (!art) return null;
  return {
    appId: art._id,
    ownerUserId: (art.userId as string) ?? '',
    sharedData: Boolean(art.sharedData),
    collections: art.collections as CollectionsBlock | undefined,
  };
}
