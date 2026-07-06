/**
 * In-memory slug index (ch07 §7.8): slug -> canonical artifact id, loaded from the
 * `slugs` reservation collection at boot, O(1) lookups, new slugs indexed on
 * assignment. Serving resolves slugs through this index on every request; the
 * data plane resolves through the store (registry.resolveApp) - both agree because
 * assignment writes through here AND the store.
 */
import { slugs } from '../data/stores.js';

const index = new Map<string, string>();

/** O(1): the canonical artifact id for a slug, or undefined (including when the
 *  argument is already a canonical id - callers use `getAppIdBySlug(x) || x`). */
export function getAppIdBySlug(slug: string): string | undefined {
  return index.get(slug) || undefined;
}

/** Index a slug on assignment (called wherever a slug is reserved/repointed). */
export function indexSlug(slug: string, artifactId: string): void {
  if (artifactId) index.set(slug, artifactId);
}

export function unindexSlug(slug: string): void {
  index.delete(slug);
}

/** Boot load (ch07 §7.16 parallel boot block). */
export async function loadSlugIndex(): Promise<void> {
  index.clear();
  const rows = await slugs.find({});
  for (const row of rows) {
    const artifactId = (row as { artifactId?: string }).artifactId;
    if (artifactId) index.set(row._id, artifactId);
  }
  console.log(`[slug-index] loaded ${index.size} slug(s)`);
}

export function __resetSlugIndexForTests(): void {
  index.clear();
}
