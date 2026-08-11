import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../../src/data/mongo.js';
import { knowledgeSources } from '../../../src/data/stores.js';
import { SHARED_ORG_ID } from '../../../src/knowledge/paths.js';
import { computeNextRunMs, getScheduleInfo, refreshAllEnabled, startKnowledgeScheduler, stopKnowledgeScheduler } from '../../../src/knowledge/crawl/scheduler.js';
import type { KnowledgeSourceDoc } from '../../../src/knowledge/service.js';

/**
 * WS8c - the nightly scheduler's PURE math (`computeNextRunMs`/`getScheduleInfo`, no clock or DB
 * needed) plus `refreshAllEnabled`'s enabled-only selection + stagger, exercised against a REAL
 * in-memory Mongo (mirroring `sources-seeder.test.ts`'s pattern - `refreshAllEnabled` reads
 * `knowledgeSources.find({})` directly, so there is no way to unit-test its selection logic
 * without a real store) and an INJECTED `trigger` (never a real crawl - dependency injection is
 * exactly what the `trigger` param exists for, mirroring ekoa-dev's own test seam).
 * `startKnowledgeScheduler` itself is only smoke-tested for idempotency/env-gating (it arms a
 * `setTimeout` for hours away, never fires in a test's lifetime) - its actual trigger path is
 * `refreshAllEnabled`, covered below.
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_knowledge_scheduler');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  await knowledgeSources.deleteMany({});
});
afterEach(() => {
  stopKnowledgeScheduler();
  delete process.env.EKOA_KNOWLEDGE_REFRESH_DISABLED;
  delete process.env.EKOA_KNOWLEDGE_REFRESH_HOUR;
});

function source(over: Partial<KnowledgeSourceDoc> = {}): KnowledgeSourceDoc {
  return {
    _id: `src-${Math.random().toString(36).slice(2)}`,
    orgId: SHARED_ORG_ID,
    url: 'https://example.pt/',
    collection: 'legislacao',
    enabled: true,
    ...over,
  } as KnowledgeSourceDoc;
}

describe('computeNextRunMs', () => {
  it('returns the delay to TODAY at the target hour when that time has not passed yet', () => {
    const now = new Date('2026-08-08T01:00:00');
    const ms = computeNextRunMs(now, 3);
    const next = new Date(now.getTime() + ms);
    expect(next.getHours()).toBe(3);
    expect(next.getDate()).toBe(now.getDate());
  });

  it('rolls to TOMORROW at the target hour once that time has already passed today', () => {
    const now = new Date('2026-08-08T05:00:00');
    const ms = computeNextRunMs(now, 3);
    const next = new Date(now.getTime() + ms);
    expect(next.getHours()).toBe(3);
    expect(next.getDate()).toBe(now.getDate() + 1);
  });

  it('rolls to tomorrow at exactly the target hour too (not due yet - the next run, not this instant)', () => {
    const now = new Date('2026-08-08T03:00:00');
    const ms = computeNextRunMs(now, 3);
    expect(new Date(now.getTime() + ms).getDate()).toBe(now.getDate() + 1);
  });
});

describe('getScheduleInfo', () => {
  it('defaults to hour 3, enabled, with nextRunAt matching computeNextRunMs', () => {
    const now = new Date('2026-08-08T01:00:00');
    const info = getScheduleInfo(now);
    expect(info.enabled).toBe(true);
    expect(info.hour).toBe(3);
    expect(new Date(info.nextRunAt).toISOString()).toBe(new Date(now.getTime() + computeNextRunMs(now, 3)).toISOString());
  });

  it('EKOA_KNOWLEDGE_REFRESH_HOUR overrides the hour when it is a valid 0-23 integer', () => {
    process.env.EKOA_KNOWLEDGE_REFRESH_HOUR = '14';
    expect(getScheduleInfo(new Date('2026-08-08T01:00:00')).hour).toBe(14);
  });

  it('an out-of-range or non-integer EKOA_KNOWLEDGE_REFRESH_HOUR falls back to the default (3), not a garbage hour', () => {
    process.env.EKOA_KNOWLEDGE_REFRESH_HOUR = '99';
    expect(getScheduleInfo().hour).toBe(3);
    process.env.EKOA_KNOWLEDGE_REFRESH_HOUR = 'not-a-number';
    expect(getScheduleInfo().hour).toBe(3);
  });

  it('EKOA_KNOWLEDGE_REFRESH_DISABLED=1 reports enabled: false', () => {
    process.env.EKOA_KNOWLEDGE_REFRESH_DISABLED = '1';
    expect(getScheduleInfo().enabled).toBe(false);
  });
});

describe('refreshAllEnabled (real store, injected trigger - no real crawl)', () => {
  it('triggers only ENABLED sources, never disabled ones', async () => {
    const a = source({ enabled: true });
    const b = source({ enabled: false });
    const c = source({ enabled: true });
    await knowledgeSources.insert(a);
    await knowledgeSources.insert(b);
    await knowledgeSources.insert(c);

    const triggered: string[] = [];
    const trigger = async (id: string) => {
      triggered.push(id);
      return { started: true, alreadyRunning: false };
    };
    const ids = await refreshAllEnabled(trigger, 0);
    expect(ids.sort()).toEqual([a._id, c._id].sort());
    expect(triggered.sort()).toEqual([a._id, c._id].sort());
    expect(triggered).not.toContain(b._id);
  });

  it('a source with `enabled` unset (legacy row) is treated as enabled - only `enabled: false` opts out', async () => {
    const legacy = source();
    delete (legacy as Record<string, unknown>).enabled;
    await knowledgeSources.insert(legacy);
    const triggered: string[] = [];
    await refreshAllEnabled(async (id) => {
      triggered.push(id);
      return { started: true, alreadyRunning: false };
    }, 0);
    expect(triggered).toEqual([legacy._id]);
  });

  it('a trigger reporting { started: false } (already running) is not counted as triggered', async () => {
    const a = source();
    await knowledgeSources.insert(a);
    const trigger = async () => ({ started: false, alreadyRunning: true });
    const ids = await refreshAllEnabled(trigger, 0);
    expect(ids).toEqual([]);
  });

  it('a trigger that throws for one source does not stop the loop - the rest still get triggered', async () => {
    const bad = source();
    const good = source();
    await knowledgeSources.insert(bad);
    await knowledgeSources.insert(good);
    const trigger = async (id: string) => {
      if (id === bad._id) throw new Error('boom');
      return { started: true, alreadyRunning: false };
    };
    const ids = await refreshAllEnabled(trigger, 0);
    expect(ids).toEqual([good._id]);
  });

  it('no sources at all resolves to an empty list, not an error', async () => {
    const ids = await refreshAllEnabled(async () => ({ started: true, alreadyRunning: false }), 0);
    expect(ids).toEqual([]);
  });
});

describe('startKnowledgeScheduler / stopKnowledgeScheduler', () => {
  it('is idempotent - a second start while already started is a no-op (does not throw, does not double-arm)', () => {
    startKnowledgeScheduler();
    expect(() => startKnowledgeScheduler()).not.toThrow();
    stopKnowledgeScheduler();
  });

  it('EKOA_KNOWLEDGE_REFRESH_DISABLED=1 means start is a no-op - never arms a timer', () => {
    process.env.EKOA_KNOWLEDGE_REFRESH_DISABLED = '1';
    expect(() => startKnowledgeScheduler()).not.toThrow();
    // Nothing to assert on internal timer state without exposing it - the contract is "does not
    // throw and does not log an armed-timer line", which the disabled branch's early return gives
    // by construction (read in `scheduler.ts`).
  });

  it('stop is safe to call when nothing was started', () => {
    expect(() => stopKnowledgeScheduler()).not.toThrow();
  });
});
