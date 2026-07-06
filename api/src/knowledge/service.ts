/**
 * Knowledge service (ch03 §3.8.20, ch04 §4.4.1). Org-partitioned: the firm's documents
 * never pool across orgs. Sources carry a user-supplied URL and are SSRF-validated at write
 * time (ch09 invariant 8). The vault + FTS index are a filesystem/SQLite exception (built
 * out in the ingest phase); this phase lands the org-scoped source/document CRUD surface.
 */
import { knowledgeSources, knowledgeUploads } from '../data/stores.js';
import { assertSafeUrl, SsrfError } from '../services/url-safety.js';
import type { Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';

export interface KnowledgeSourceDoc extends Doc {
  orgId: string;
  url: string;
  kind?: string;
  seedId?: string;
  crawlConfig?: Record<string, unknown>;
}

export interface Deps { now: () => number; genId: () => string }

export class KnowledgeError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

export function sourceView(s: KnowledgeSourceDoc) {
  return { id: s._id, url: s.url, kind: s.kind, seedId: s.seedId };
}

export async function listSources(actor: Actor): Promise<KnowledgeSourceDoc[]> {
  return knowledgeSources.find({ orgId: actor.orgId }) as Promise<KnowledgeSourceDoc[]>;
}

export async function addSource(actor: Actor, input: { url: string; kind?: string; seedId?: string }, deps: Deps): Promise<KnowledgeSourceDoc> {
  // SSRF-validate the user-supplied URL at write time (ch09 invariant 8).
  try {
    assertSafeUrl(input.url);
  } catch (e) {
    if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'URL não permitido.');
    throw e;
  }
  const id = deps.genId();
  const doc: KnowledgeSourceDoc = { _id: id, orgId: actor.orgId, url: input.url, kind: input.kind, seedId: input.seedId };
  await knowledgeSources.insert(doc as never);
  return doc;
}

export async function getVisibleSource(actor: Actor, id: string): Promise<KnowledgeSourceDoc | null> {
  const s = (await knowledgeSources.get(id)) as KnowledgeSourceDoc | null;
  if (!s || s.orgId !== actor.orgId) return null; // cross-org → uniform 404
  return s;
}

export async function deleteSource(actor: Actor, id: string): Promise<boolean> {
  const s = await getVisibleSource(actor, id);
  if (!s) return false;
  return knowledgeSources.delete(id);
}

export async function listUploads(actor: Actor) {
  return knowledgeUploads.find({ orgId: actor.orgId });
}
