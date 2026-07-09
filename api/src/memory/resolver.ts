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
  verified?: boolean;
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

/**
 * The ONE memory response shape — all four memory routes emit through it, so it alone decides
 * whether they satisfy the shared `Memory` contract (shared/src/memories.ts). Three fields the
 * contract requires were wrong: `orgId` was never emitted; `tags` and `tier` were passed straight
 * through and are `undefined` on real documents. `tags` is absent on every extracted memory
 * (extraction writes none). `tier` is absent because the contract itself sanctions omitting it:
 * `MemoryCreateRequest.tier` is optional while `Memory.tier` is required, so any client may
 * legitimately create a tier-less memory — and legacy documents already exist without one.
 *
 * The defaults are honest, not cosmetic: `[]` is the true empty tag set, and `'active'` is what
 * extraction itself assigns and what every existing reader (this module's own bucketing below,
 * the dashboard) already infers for a missing tier. An explicit `'archive'` is passed through
 * untouched. `createMemory` persists the same default, so the store and the wire agree.
 */
export function memoryView(m: MemoryDoc) {
  return {
    id: m._id,
    title: m.title,
    content: m.content,
    type: m.type,
    tags: m.tags ?? [],
    tier: m.tier ?? 'active',
    visibility: m.visibility,
    userId: m.userId,
    orgId: m.orgId,
    // `verified` is written by PATCH but was never read back, so the dashboard's badge was dead.
    ...(m.verified !== undefined ? { verified: m.verified } : {}),
  };
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

/**
 * Resolver injection block (ch03 §3.8.19): own + org-shared, formatted for a prompt section.
 * Shares the ONE taxonomy with `resolveMemoryInjection` — archived memories are never injected and
 * guardrails render as RULE lines. Keeping a second, laxer copy here is how the archived-memory
 * bug would silently reopen the moment this function is wired up.
 */
export async function resolveMemoryBlock(actor: Actor): Promise<string> {
  const visible = (await listVisibleMemories(actor)).filter(isInjectable);
  if (visible.length === 0) return '';
  const lines: string[] = [];
  for (const m of visible.filter(isGuardrail)) lines.push(`RULE: ${m.content ?? m.title ?? ''}`);
  for (const m of visible.filter((m) => !isGuardrail(m))) lines.push(`- ${m.title ?? ''}: ${m.content ?? ''}`);
  return lines.join('\n');
}

/** The ONE guardrail predicate: the dashboard writes `tags:['guardrail']`; legacy rows use type/tier. */
function isGuardrail(m: MemoryDoc): boolean {
  return m.type === 'guardrail' || m.tier === 'guardrail' || (m.tags ?? []).includes('guardrail');
}
/** Archived memories are hidden in the dashboard and must not steer the model either. */
function isInjectable(m: MemoryDoc): boolean {
  return m.tier !== 'archive';
}

/** Split text into a lowercase term set for the deterministic overlap resolver (no model call). */
function terms(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9à-ú]+/i)
      .filter((w) => w.length > 2),
  );
}

const MAX_ACTIVE_INJECTED = 8;

/**
 * Deterministic term-overlap memory injection (ch05 §5.5.2 layer 1). No model call: guardrail
 * memories render first as non-negotiable RULE lines; core-tier memories are always injected;
 * active-tier memories are scored by term overlap with the query and the top ones injected. The
 * resolver's write-on-read side effect (a usage-count bump per resolved memory) is carried as a
 * conscious decision — applied here through the store. Returns '' when nothing resolves.
 */
export async function resolveMemoryInjection(actor: Actor, query: string, deps: MemoryDeps): Promise<string> {
  const visible = await listVisibleMemories(actor);
  if (visible.length === 0) return '';
  const q = terms(query);

  // A guardrail is anything the product calls a guardrail. The dashboard writes them as
  // `{ type:'preference', tier:'core', tags:['guardrail'] }` and lists them by that tag, so
  // matching only `type`/`tier` classified every UI-created guardrail as an ordinary memory and
  // injected it as a plain bullet instead of a non-negotiable RULE line: the user saw it listed
  // under "Guardrails" and believed it was enforced. The three writers must agree.
  const injectable = visible.filter(isInjectable);
  const guardrails = injectable.filter(isGuardrail);
  const core = injectable.filter((m) => m.tier === 'core' && !guardrails.includes(m));
  const active = injectable.filter((m) => !guardrails.includes(m) && !core.includes(m));

  const scored = active
    .map((m) => {
      const mt = terms(`${m.title ?? ''} ${m.content ?? ''} ${(m.tags ?? []).join(' ')}`);
      let overlap = 0;
      for (const t of q) if (mt.has(t)) overlap++;
      return { m, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, MAX_ACTIVE_INJECTED)
    .map((s) => s.m);

  const resolved = [...guardrails, ...core, ...scored];
  if (resolved.length === 0) return '';

  // Write-on-read: bump usage count per resolved memory (carried side effect, §5.5.2). Failures
  // are swallowed — injection must never fail a run on a bookkeeping write.
  for (const m of resolved) {
    memories
      .update(m._id, (cur) => ({ ...cur, usageCount: (((cur as MemoryDoc).usageCount as number) ?? 0) + 1, lastUsedAt: new Date(deps.now()).toISOString() } as never))
      .catch(() => {});
  }

  const lines: string[] = [];
  for (const m of guardrails) lines.push(`RULE: ${m.content ?? m.title ?? ''}`);
  for (const m of [...core, ...scored]) lines.push(`- ${m.title ?? ''}: ${m.content ?? ''}`);
  return lines.join('\n');
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
    // Persist the SAME tier the response reports (memoryView defaults a missing one to 'active').
    // Defaulting only at read time left the store and the wire disagreeing: a future byTier
    // aggregation reading documents would bucket these rows as undefined.
    tier: (body.tier as string | undefined) ?? 'active',
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
