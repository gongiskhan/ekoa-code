/**
 * Shareability lookup for `/apps/:idOrSlug` and `/build/:slug` (ch07 §7.7;
 * carryover services-sweep `share-lookup` row - adapted to the ported stores).
 *
 *   { kind: 'ok', appId }  - direct registry hit OR slug resolves AND the artifact
 *                            is featured OR has shareable: true.
 *   { kind: 'revoked' }    - resolves to a real artifact whose owner flipped
 *                            shareable off. Distinct from not-found so callers can
 *                            render the authored PT "link revoked" page.
 *   { kind: 'not-found' }  - slug does not resolve OR no artifact exists.
 *
 * Featured artifacts are always treated as shareable regardless of the flag (seed
 * entries with shareable=false still serve). Per-request re-check, never cached.
 */
import { appRegistry } from './app-registry.js';
import { getAppIdBySlug } from './slug-index.js';
import { artifacts } from '../data/stores.js';

export type ShareLookup =
  | { kind: 'ok'; appId: string }
  | { kind: 'revoked' }
  | { kind: 'not-found' };

export async function lookupShareable(appIdOrSlug: string): Promise<ShareLookup> {
  let appId = appIdOrSlug;
  if (!appRegistry.getApp(appId)) {
    const resolved = getAppIdBySlug(appIdOrSlug);
    if (!resolved) return { kind: 'not-found' };
    appId = resolved;
  }
  const artifact = await artifacts.get(appId);
  if (!artifact) return { kind: 'not-found' };
  if (artifact.featured) return { kind: 'ok', appId };
  if (artifact.shareable !== true) return { kind: 'revoked' };
  return { kind: 'ok', appId };
}
