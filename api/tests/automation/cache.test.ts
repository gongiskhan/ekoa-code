import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import {
  writeActionCache,
  lookupActionCache,
  writeAssertionCache,
  lookupAssertionCache,
  evictCacheForFingerprint,
} from '../../src/automation/cache.js';
import { fingerprintFromParts } from '../../src/automation/fingerprint.js';
import { memories, tokenEvents } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb } from '../agents/_setup.js';
import type { PlaywrightAction, PlaywrightAssertion } from '../../src/automation/types.js';

/**
 * Memory-backed action/assertion cache (carryover-audit B8; invisible-behaviors §13.3) + the
 * zero-token replay contract (§5.6.7): a cache HIT replays deterministically with NO model call.
 * The cache rows are ordinary memory rows (no parallel store), written/read through the memory/
 * public surface. This suite asserts round-trip, fingerprint discrimination, successCount growth
 * without duplication, eviction, org-shared visibility, and — the load-bearing property — that a
 * cache write/read records ZERO model-call ledger events.
 */
const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' };
const fpA = fingerprintFromParts({ url: 'https://x.com/a', title: 'A', headingText: 'h', shapeSketch: 'tags:body=1|roles:|landmarks:0', viewport: { w: 1280, h: 800 } });
const fpB = fingerprintFromParts({ url: 'https://x.com/b', title: 'B', headingText: 'h', shapeSketch: 'tags:body=1|roles:|landmarks:0', viewport: { w: 1280, h: 800 } });
const action: PlaywrightAction = { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Save' } };
const assertion: PlaywrightAssertion = { kind: 'expect_url', pattern: '/inbox' };

describe('memory-backed automation cache (§13.3, §5.6.7)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_cache'));
  afterAll(shutdownAgentTestDb);
  afterEach(async () => { await memories.deleteMany({}); await tokenEvents.deleteMany({}); });

  it('writes and reads an action back for the matching fingerprint — with ZERO model calls', async () => {
    await writeActionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, action, actor, confidence: 'high' });

    const hit = await lookupActionCache('a1', 's1', fpA, actor);
    expect(hit).not.toBeNull();
    expect(hit!.action).toEqual(action);
    expect(hit!.confidence).toBe('high');
    expect(hit!.successCount).toBe(1);

    // Zero-token replay contract: no model-call ledger events for a cache write/read.
    expect(await tokenEvents.find({})).toHaveLength(0);
    // The cache row is an ordinary memory row (no parallel store).
    const rows = await memories.find({});
    expect(rows).toHaveLength(1);
  });

  it('does not hit on a different page fingerprint (cross-entity discrimination)', async () => {
    await writeActionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, action, actor, confidence: 'high' });
    expect(await lookupActionCache('a1', 's1', fpB, actor)).toBeNull();
  });

  it('a repeat write increments successCount in place — no duplicate row', async () => {
    await writeActionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, action, actor, confidence: 'high' });
    await writeActionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, action, actor, confidence: 'medium' });

    const hit = await lookupActionCache('a1', 's1', fpA, actor);
    expect(hit!.successCount).toBe(2);
    expect(hit!.confidence).toBe('medium');
    expect(await memories.find({})).toHaveLength(1);
  });

  it('evicts the fingerprint-matched entries (step-feedback eviction, §11.6)', async () => {
    await writeActionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, action, actor, confidence: 'high' });
    await writeAssertionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, assertion, actor });

    const removed = await evictCacheForFingerprint('a1', 's1', fpA, actor);
    expect(removed).toEqual({ actionsRemoved: 1, assertionsRemoved: 1 });
    expect(await lookupActionCache('a1', 's1', fpA, actor)).toBeNull();
    expect(await lookupAssertionCache('a1', 's1', fpA, actor)).toBeNull();
    expect(await memories.find({})).toHaveLength(0);
  });

  it('a shared (org) cache entry is visible to another user in the same org', async () => {
    await writeActionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, action, actor, confidence: 'high', shared: true });
    const other: Actor = { userId: 'u2', orgId: 'o1', role: 'user' };
    const hit = await lookupActionCache('a1', 's1', fpA, other);
    expect(hit).not.toBeNull();
    expect(hit!.action).toEqual(action);
  });

  it('a private cache entry is NOT visible to another user (owner scoping)', async () => {
    await writeActionCache({ automationId: 'a1', stepId: 's1', fingerprint: fpA, action, actor, confidence: 'high' });
    const other: Actor = { userId: 'u2', orgId: 'o1', role: 'user' };
    expect(await lookupActionCache('a1', 's1', fpA, other)).toBeNull();
  });
});
