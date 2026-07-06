/**
 * Memory resolver (ch03 §3.8.19, ch09 §9.7.2 posture 2). Injects the caller's own memories
 * plus org-shared ones; a private memory of another user is invisible even to the org admin
 * (its existence appears only in Registo metadata, never content). Automatic extraction
 * (P-12) always writes `visibility: 'private'` — sharedness is never inferred. This module
 * makes NO model calls (the FAST extraction call is made by `agents/` through `llm/`).
 */
import { memories } from '../data/stores.js';
import { OwnerVisibilityScoped, type Actor } from '../data/scoped.js';
import type { Doc } from '../data/store.js';

export interface MemoryDoc extends Doc {
  orgId: string;
  userId?: string;
  visibility: 'private' | 'org';
  title?: string;
  content?: string;
  type?: string;
  tags?: string[];
  tier?: string;
  createdAt?: string;
  updatedAt?: string;
}

const scoped = new OwnerVisibilityScoped<MemoryDoc>(memories as never);

export function memoryView(m: MemoryDoc) {
  return { id: m._id, title: m.title, content: m.content, type: m.type, tags: m.tags, tier: m.tier, visibility: m.visibility, userId: m.userId };
}

export async function listVisibleMemories(actor: Actor): Promise<MemoryDoc[]> {
  return scoped.listVisible(actor);
}

export async function getVisibleMemory(actor: Actor, id: string): Promise<MemoryDoc | null> {
  return scoped.getVisible(actor, id);
}

export async function memoryWriteGuard(actor: Actor, id: string) {
  return scoped.writeGuard(actor, id);
}

/** Resolver injection block (ch03 §3.8.19): own + org-shared, formatted for a prompt section. */
export async function resolveMemoryBlock(actor: Actor): Promise<string> {
  const visible = await listVisibleMemories(actor);
  if (visible.length === 0) return '';
  return visible.map((m) => `- ${m.title ?? ''}: ${m.content ?? ''}`).join('\n');
}

// ---- Write operations (the memory router goes through the module, not data/ — ch02 §2.7) ----
export interface MemoryDeps { now: () => number; genId: () => string }

export async function createMemory(actor: Actor, body: Record<string, unknown>, deps: MemoryDeps): Promise<MemoryDoc> {
  const id = deps.genId();
  const now = new Date(deps.now()).toISOString();
  const doc: MemoryDoc = {
    _id: id,
    orgId: actor.orgId,
    userId: actor.userId,
    visibility: (body.visibility as 'private' | 'org') ?? 'private',
    title: body.title as string | undefined,
    content: body.content as string | undefined,
    type: body.type as string | undefined,
    tags: body.tags as string[] | undefined,
    tier: body.tier as string | undefined,
    createdAt: now,
    updatedAt: now,
  };
  await memories.insert(doc as never);
  return doc;
}

export async function updateMemory(id: string, patch: Record<string, unknown>, deps: MemoryDeps): Promise<MemoryDoc | null> {
  return (await memories.update(id, (m) => ({ ...m, ...patch, updatedAt: new Date(deps.now()).toISOString() } as never))) as unknown as MemoryDoc | null;
}

export async function deleteMemory(id: string): Promise<void> {
  await memories.delete(id);
}
