/**
 * Memory-backed cache for resolved Playwright actions and assertions (carryover-audit B8;
 * invisible-behaviors §13.3). Cache entries live in the organizational memory system as tagged
 * rows — no parallel store — exactly as the old Cortex engine did. The keying logic
 * (`fingerprintKey`) ports unchanged.
 *
 * Re-pointing (B8): the old code went through `memoryStore` + `resolver.listMemoriesByEntity`;
 * the rebuild goes through the `memory/` PUBLIC surface only (`createMemory` / `updateMemory` /
 * `deleteMemory` / `listVisibleMemories`), per the G8 brief and ch02 §2.7 (automation/ may import
 * memory/). The structured payload (fingerprint, action/assertion, successCount, confidence) is
 * stored in a dedicated `cachePayload` field the resolver never term-scores — preserving §13.3's
 * "so the resolver never term-scores it"; `content` holds only the short human summary (which the
 * old design also term-scored).
 *
 * Cache key dimensions (unchanged): automationId (tag `automation:<id>`), stepId (tag
 * `step:<id>`), kind (tag `action-cache` | `assertion-cache`), fingerprintKey (in payload).
 *
 * Model economics (§5.6.7): a cache HIT replays deterministically with ZERO tokens (no vision
 * call); only a MISS resolves via vision.
 */
import { randomUUID } from 'node:crypto';
import type { Actor } from '@ekoa/shared';
import { createMemory, updateMemory, deleteMemory, listVisibleMemories, type MemoryDoc } from '../memory/index.js';
import { fingerprintKey } from './fingerprint.js';
import type {
  Locator,
  PageFingerprint,
  PlaywrightAction,
  PlaywrightAssertion,
} from './types.js';

// The memory writers take a `{ now, genId }` deps bag; the cache is not on a hot path (writes
// happen only on a vision resolution), so a module-local wall-clock/uuid bag is fine.
const deps = { now: () => Date.now(), genId: () => randomUUID() };

// ============================================================================
// Payloads (stored under the memory row's `cachePayload` field, not term-scored)
// ============================================================================

export interface ActionCachePayload {
  kind: 'action-cache';
  fingerprint: PageFingerprint;
  fingerprintKey: string;
  action: PlaywrightAction;
  successCount: number;
  lastUsedAt: string;
  confidence: 'high' | 'medium';
}

export interface AssertionCachePayload {
  kind: 'assertion-cache';
  fingerprint: PageFingerprint;
  fingerprintKey: string;
  assertion: PlaywrightAssertion;
  successCount: number;
  lastUsedAt: string;
}

/** A memory row carrying a cache payload (the field the resolver does not term-score). */
type CacheMemory = MemoryDoc & { cachePayload?: ActionCachePayload | AssertionCachePayload };

function makeTags(automationId: string, stepId: string, kind: 'action-cache' | 'assertion-cache'): string[] {
  return [`automation:${automationId}`, `step:${stepId}`, kind];
}

/**
 * Find the cache memory for a (automation, step, kind, fingerprint) via the memory PUBLIC surface:
 * list the actor's visible memories, filter by the exact tag set, then match the fingerprintKey in
 * the payload. (A tag-scoped store query would be cheaper but is not exposed on memory/'s public
 * surface — see the G8 report note; correctness is unaffected.)
 */
async function findCacheRecord(
  automationId: string,
  stepId: string,
  kind: 'action-cache' | 'assertion-cache',
  fpKey: string,
  actor: Actor,
): Promise<CacheMemory | null> {
  const wanted = makeTags(automationId, stepId, kind);
  const visible = (await listVisibleMemories(actor)) as CacheMemory[];
  for (const m of visible) {
    const tags = m.tags ?? [];
    if (!wanted.every((t) => tags.includes(t))) continue;
    if (m.cachePayload && m.cachePayload.fingerprintKey === fpKey) return m;
  }
  return null;
}

// ============================================================================
// Public API
// ============================================================================

export async function lookupActionCache(
  automationId: string,
  stepId: string,
  fingerprint: PageFingerprint,
  actor: Actor,
): Promise<ActionCachePayload | null> {
  const fpKey = fingerprintKey(fingerprint);
  const record = await findCacheRecord(automationId, stepId, 'action-cache', fpKey, actor);
  return (record?.cachePayload as ActionCachePayload | undefined) ?? null;
}

export async function writeActionCache(input: {
  automationId: string;
  stepId: string;
  fingerprint: PageFingerprint;
  action: PlaywrightAction;
  actor: Actor;
  confidence: 'high' | 'medium';
  shared?: boolean;
}): Promise<void> {
  const fpKey = fingerprintKey(input.fingerprint);
  const existing = await findCacheRecord(input.automationId, input.stepId, 'action-cache', fpKey, input.actor);
  const now = new Date().toISOString();

  if (existing) {
    const prev = existing.cachePayload as ActionCachePayload | undefined;
    const successCount = (prev?.successCount ?? 0) + 1;
    const payload: ActionCachePayload = {
      kind: 'action-cache',
      fingerprint: input.fingerprint,
      fingerprintKey: fpKey,
      action: input.action,
      successCount,
      lastUsedAt: now,
      confidence: input.confidence,
    };
    await updateMemory(existing._id, { content: summariseAction(input.action), cachePayload: payload }, deps);
    return;
  }

  const created = await createMemory(
    input.actor,
    {
      title: `Action cache: ${stepLabel(input.stepId)} @ ${fpKey.slice(0, 16)}`,
      content: summariseAction(input.action),
      type: 'fact',
      tags: makeTags(input.automationId, input.stepId, 'action-cache'),
      tier: 'active',
      visibility: input.shared ? 'org' : 'private',
    },
    deps,
  );
  const payload: ActionCachePayload = {
    kind: 'action-cache',
    fingerprint: input.fingerprint,
    fingerprintKey: fpKey,
    action: input.action,
    successCount: 1,
    lastUsedAt: now,
    confidence: input.confidence,
  };
  await updateMemory(created._id, { cachePayload: payload, origin: 'auto-extraction', score: 60 }, deps);
}

export async function lookupAssertionCache(
  automationId: string,
  stepId: string,
  fingerprint: PageFingerprint,
  actor: Actor,
): Promise<AssertionCachePayload | null> {
  const fpKey = fingerprintKey(fingerprint);
  const record = await findCacheRecord(automationId, stepId, 'assertion-cache', fpKey, actor);
  return (record?.cachePayload as AssertionCachePayload | undefined) ?? null;
}

export async function writeAssertionCache(input: {
  automationId: string;
  stepId: string;
  fingerprint: PageFingerprint;
  assertion: PlaywrightAssertion;
  actor: Actor;
  shared?: boolean;
}): Promise<void> {
  const fpKey = fingerprintKey(input.fingerprint);
  const existing = await findCacheRecord(input.automationId, input.stepId, 'assertion-cache', fpKey, input.actor);
  const now = new Date().toISOString();

  if (existing) {
    const prev = existing.cachePayload as AssertionCachePayload | undefined;
    const successCount = (prev?.successCount ?? 0) + 1;
    const payload: AssertionCachePayload = {
      kind: 'assertion-cache',
      fingerprint: input.fingerprint,
      fingerprintKey: fpKey,
      assertion: input.assertion,
      successCount,
      lastUsedAt: now,
    };
    await updateMemory(existing._id, { content: summariseAssertion(input.assertion), cachePayload: payload }, deps);
    return;
  }

  const created = await createMemory(
    input.actor,
    {
      title: `Assertion cache: ${stepLabel(input.stepId)} @ ${fpKey.slice(0, 16)}`,
      content: summariseAssertion(input.assertion),
      type: 'fact',
      tags: makeTags(input.automationId, input.stepId, 'assertion-cache'),
      tier: 'active',
      visibility: input.shared ? 'org' : 'private',
    },
    deps,
  );
  const payload: AssertionCachePayload = {
    kind: 'assertion-cache',
    fingerprint: input.fingerprint,
    fingerprintKey: fpKey,
    assertion: input.assertion,
    successCount: 1,
    lastUsedAt: now,
  };
  await updateMemory(created._id, { cachePayload: payload, origin: 'auto-extraction', score: 60 }, deps);
}

// ============================================================================
// Eviction (per submit-step-feedback rule; §13.3, §11.6)
// ============================================================================

/**
 * Evict the cache entries (action and assertion) for a step whose fingerprint matched on a given
 * run. Other cache entries for the same step at different fingerprints are untouched.
 */
export async function evictCacheForFingerprint(
  automationId: string,
  stepId: string,
  fingerprint: PageFingerprint,
  actor: Actor,
): Promise<{ actionsRemoved: number; assertionsRemoved: number }> {
  const fpKey = fingerprintKey(fingerprint);
  let actionsRemoved = 0;
  let assertionsRemoved = 0;

  for (const kind of ['action-cache', 'assertion-cache'] as const) {
    const record = await findCacheRecord(automationId, stepId, kind, fpKey, actor);
    if (record) {
      await deleteMemory(record._id);
      if (kind === 'action-cache') actionsRemoved++;
      else assertionsRemoved++;
    }
  }
  return { actionsRemoved, assertionsRemoved };
}

// ============================================================================
// Helpers (ported verbatim)
// ============================================================================

function stepLabel(stepId: string): string {
  return stepId.length > 8 ? stepId.slice(0, 8) : stepId;
}

function summariseAction(action: PlaywrightAction): string {
  switch (action.kind) {
    case 'navigate': return `navigate to ${action.url}`;
    case 'click': return `click ${describeLocator(action.locator)}`;
    case 'dblclick': return `double-click ${describeLocator(action.locator)}`;
    case 'fill': return `fill ${describeLocator(action.locator)} with "${action.value.slice(0, 40)}"`;
    case 'press': return action.locator
      ? `press ${action.key} on ${describeLocator(action.locator)}`
      : `press ${action.key}`;
    case 'select': return `select "${action.value}" in ${describeLocator(action.locator)}`;
    case 'check': return `check ${describeLocator(action.locator)}`;
    case 'uncheck': return `uncheck ${describeLocator(action.locator)}`;
    case 'hover': return `hover ${describeLocator(action.locator)}`;
    case 'wait': return `wait ${action.durationMs}ms`;
    case 'wait_for': return `wait for ${describeLocator(action.locator)} to be ${action.state}`;
    case 'scroll': return `scroll ${action.direction}${action.pixels ? ` ${action.pixels}px` : ''}`;
    case 'screenshot': return `screenshot`;
    case 'noop': return `noop (${action.reason})`;
  }
}

function summariseAssertion(assertion: PlaywrightAssertion): string {
  switch (assertion.kind) {
    case 'expect_visible': return `expect ${describeLocator(assertion.locator)} visible`;
    case 'expect_hidden': return `expect ${describeLocator(assertion.locator)} hidden`;
    case 'expect_text': return `expect ${describeLocator(assertion.locator)} contains "${assertion.contains}"`;
    case 'expect_url': return `expect URL contains "${assertion.pattern}"`;
    case 'expect_title': return `expect title contains "${assertion.contains}"`;
  }
}

function describeLocator(loc: Locator): string {
  switch (loc.strategy) {
    case 'role': return `role=${loc.role}${loc.name ? `[name="${loc.name}"]` : ''}`;
    case 'text': return `text="${loc.value}"`;
    case 'label': return `label="${loc.value}"`;
    case 'placeholder': return `placeholder="${loc.value}"`;
    case 'testid': return `testid="${loc.value}"`;
    case 'altText': return `altText="${loc.value}"`;
    case 'title': return `title="${loc.value}"`;
    case 'css': return `css="${loc.selector}"`;
  }
}
