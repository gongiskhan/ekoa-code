/**
 * Artifacts service (ch03 §3.8.9). Owner+visibility scoped (private|org). Slug uniqueness via
 * the `slugs` reservation collection (deterministic-_id insert). Featured surfaces regardless
 * of owner. Deterministic slug generation (no model call — FIXED-3, ch07 §7.8).
 */
import { artifacts, slugs } from '../data/stores.js';
import { OwnerVisibilityScoped, type Actor } from '../data/scoped.js';
import type { Doc } from '../data/store.js';
import { indexSlug } from './slug-index.js';

export interface ArtifactDoc extends Doc {
  name: string;
  slug?: string;
  userId: string;
  orgId: string;
  visibility: 'private' | 'org';
  featured?: boolean;
  shareable?: boolean;
  status?: string;
  data?: Record<string, unknown>;
  sharedData?: boolean;
}

export interface Deps { now: () => number; genId: () => string }

/**
 * Keys inside an artifact's `data` bag that ONLY server build/fork/bundle/featured machinery may
 * write. A client PATCH must never set these: `data.projectDir` in particular feeds
 * `projectDirFor()` and thus the follow-up build sandbox cwd/HOME (a path-injection →
 * sandbox-escape vector, ch09). The route strips them at the boundary and `patchArtifact` strips
 * them again before merging onto the existing bag (defense in depth), so a client can neither
 * overwrite nor wipe them.
 */
export const RESERVED_ARTIFACT_DATA_KEYS: readonly string[] = [
  'projectDir', 'appUrl', 'sessionId', 'sdkSessionId',
  'seededFrom', 'seededVersion', 'updateAvailable',
  'importedFrom', 'forkedFrom', 'lastBundleUpdateAt', 'customized',
];

/** Drop every server-owned reserved key from a client-supplied `data` bag (see the constant). */
export function stripReservedDataKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!RESERVED_ARTIFACT_DATA_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

const scoped = new OwnerVisibilityScoped<ArtifactDoc>(artifacts as never);

export function artifactView(a: ArtifactDoc) {
  return { id: a._id, name: a.name, slug: a.slug, userId: a.userId, orgId: a.orgId, visibility: a.visibility, featured: !!a.featured, shareable: !!a.shareable, status: a.status };
}

const STOPWORDS = new Set(['a', 'o', 'de', 'da', 'do', 'the', 'and', 'e']);

/** Deterministic slug (ch07 §7.8): 2-4 lowercase hyphenated words, strip stop-words,
 *  numeric suffix on collision. No model call. */
export async function generateSlug(name: string, deps: Deps): Promise<string> {
  const words = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter((w) => w && !STOPWORDS.has(w)).slice(0, 4);
  const base = words.join('-') || 'app';
  if (await slugs.insert({ _id: base, artifactId: '' })) return base;
  for (let n = 2; n <= 99; n++) {
    if (await slugs.insert({ _id: `${base}-${n}`, artifactId: '' })) return `${base}-${n}`;
  }
  return `${base}-${deps.now().toString(36)}`;
}

export async function listArtifacts(actor: Actor): Promise<{ items: ArtifactDoc[]; featured: ArtifactDoc[] }> {
  const visible = await scoped.listVisible(actor);
  const featured = ((await artifacts.find({ featured: true })) as ArtifactDoc[]);
  return { items: visible, featured };
}

export async function createArtifact(actor: Actor, input: { name: string; visibility?: 'private' | 'org' }, deps: Deps): Promise<ArtifactDoc> {
  const id = deps.genId();
  const slug = await generateSlug(input.name, deps);
  await slugs.put({ _id: slug, artifactId: id }); // point the reservation at the new artifact
  indexSlug(slug, id); // keep the in-memory serving index current (ch07 §7.8)
  const doc: ArtifactDoc = { _id: id, name: input.name, slug, userId: actor.userId, orgId: actor.orgId, visibility: input.visibility ?? 'private', status: 'draft' };
  await artifacts.insert(doc as never);
  return doc;
}

export async function getVisibleArtifact(actor: Actor, id: string): Promise<ArtifactDoc | null> {
  return scoped.getVisible(actor, id);
}

export async function patchArtifact(actor: Actor, id: string, patch: Record<string, unknown>): Promise<{ verdict: 'ok' | 'notfound' | 'forbidden'; artifact?: ArtifactDoc }> {
  const guard = await scoped.writeGuard(actor, id);
  if (guard.verdict !== 'ok') return { verdict: guard.verdict };
  // slug change checks uniqueness via the reservation collection.
  if (typeof patch.slug === 'string' && patch.slug !== guard.row!.slug) {
    const ok = await slugs.insert({ _id: patch.slug, artifactId: id });
    if (!ok) return { verdict: 'forbidden' }; // slug taken — surfaced as SLUG_TAKEN at the route
    indexSlug(patch.slug, id); // serving resolves the new slug immediately (edits never orphan data)
  }
  const updated = (await artifacts.update(id, (a) => {
    const next = { ...a, ...patch } as ArtifactDoc;
    // A client `data` patch MERGES onto the existing bag (never a wholesale replace) with the
    // server-owned reserved keys stripped, so the client can neither overwrite nor wipe them.
    if (patch.data && typeof patch.data === 'object' && !Array.isArray(patch.data)) {
      const existing = (a.data as Record<string, unknown> | undefined) ?? {};
      next.data = { ...existing, ...stripReservedDataKeys(patch.data as Record<string, unknown>) };
    }
    return next;
  })) as ArtifactDoc;
  return { verdict: 'ok', artifact: updated };
}

export async function deleteArtifact(actor: Actor, id: string): Promise<'ok' | 'notfound' | 'forbidden'> {
  const guard = await scoped.writeGuard(actor, id);
  if (guard.verdict !== 'ok') return guard.verdict;
  await artifacts.delete(id);
  return 'ok';
}
