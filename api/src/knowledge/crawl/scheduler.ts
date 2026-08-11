/**
 * Knowledge nightly scheduler (WS8c, ported from ekoa-dev's `cortex/src/services/
 * knowledge-scheduler.ts`) - re-crawls every ENABLED source once a day in incremental mode, so
 * updated pages are re-indexed and new entries discovered without a manual scan.
 *
 * Self-rolled (no node-cron dependency): `computeNextRunMs` is a pure function returning the
 * delay to the next HH:00 local occurrence of the configured hour; `startKnowledgeScheduler`
 * arms a one-shot timer for that delay, runs the refresh, then re-arms. The timer is unref'd so
 * it never holds the process open. A manual "refresh all" call exercises the same path
 * (`refreshAllEnabled`) on demand.
 */
import { knowledgeSources } from '../../data/stores.js';
import { startCrawl, type StartResult } from './runner.js';
import type { KnowledgeSourceDoc } from '../service.js';

const DEFAULT_HOUR = 3; // 03:00 local
const STAGGER_MS = 5000; // space out per-source kickoffs so we don't hit several sites at once

function refreshHour(): number {
  const h = Number(process.env.EKOA_KNOWLEDGE_REFRESH_HOUR);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_HOUR;
}

/** Milliseconds from `now` until the next occurrence of `hour`:00 local time. Pure. */
export function computeNextRunMs(now: Date, hour: number): number {
  const next = new Date(now.getTime());
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export interface ScheduleInfo {
  enabled: boolean;
  hour: number;
  nextRunAt: string;
}

/** The configured schedule + the next computed run time (for the UI). */
export function getScheduleInfo(now: Date = new Date()): ScheduleInfo {
  const hour = refreshHour();
  return {
    enabled: process.env.EKOA_KNOWLEDGE_REFRESH_DISABLED !== '1',
    hour,
    nextRunAt: new Date(now.getTime() + computeNextRunMs(now, hour)).toISOString(),
  };
}

async function sourceLookup(id: string): Promise<KnowledgeSourceDoc | null> {
  return (await knowledgeSources.get(id)) as KnowledgeSourceDoc | null;
}

/**
 * Trigger an incremental refresh of every ENABLED source across every org (the scheduler is a
 * platform-wide boot obligation, not scoped to one actor - same posture as the FTS backfill).
 * Each refresh runs in the background via the crawl runner (guarding against double-runs),
 * spaced out by `staggerMs` to stay polite. Returns the source ids it actually triggered.
 * `trigger` is injectable for tests.
 */
export async function refreshAllEnabled(
  trigger: (id: string) => Promise<StartResult> = (id) => startCrawl(id, sourceLookup),
  staggerMs = STAGGER_MS,
): Promise<string[]> {
  const all = (await knowledgeSources.find({})) as KnowledgeSourceDoc[];
  const enabled = all.filter((s) => s.enabled !== false);
  const triggered: string[] = [];
  for (let i = 0; i < enabled.length; i++) {
    const source = enabled[i] as KnowledgeSourceDoc;
    try {
      const result = await trigger(source._id);
      if (result.started) triggered.push(source._id);
    } catch (err) {
      console.warn(`[knowledge-scheduler] failed to start refresh for ${source._id}:`, err instanceof Error ? err.message : err);
    }
    if (staggerMs > 0 && i < enabled.length - 1) await new Promise((r) => setTimeout(r, staggerMs));
  }
  return triggered;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
// Bumped on every stop; the re-arm path checks it so a timer/refresh that fires after a stop (or
// restart) does not resurrect or duplicate the loop.
let generation = 0;

/** Arm the nightly refresh loop. Idempotent - a second call is a no-op. */
export function startKnowledgeScheduler(): void {
  if (started) return;
  if (process.env.EKOA_KNOWLEDGE_REFRESH_DISABLED === '1') {
    console.log('[knowledge-scheduler] disabled via EKOA_KNOWLEDGE_REFRESH_DISABLED');
    return;
  }
  started = true;
  const myGen = ++generation;

  const arm = () => {
    if (!started || generation !== myGen) return;
    const hour = refreshHour();
    const delay = computeNextRunMs(new Date(), hour);
    timer = setTimeout(() => {
      void (async () => {
        try {
          if (generation !== myGen) return;
          const ids = await refreshAllEnabled();
          console.log(`[knowledge-scheduler] nightly refresh triggered ${ids.length} source(s)`);
        } catch (err) {
          console.warn('[knowledge-scheduler] nightly refresh failed:', err instanceof Error ? err.message : err);
        } finally {
          arm();
        }
      })();
    }, delay);
    timer.unref?.();
    console.log(`[knowledge-scheduler] next refresh in ${Math.round(delay / 60_000)} min (target ${hour}:00)`);
  };

  arm();
}

/** Stop the scheduler (tests / shutdown). Bumps the generation so any in-flight timer/refresh
 *  callback won't re-arm. */
export function stopKnowledgeScheduler(): void {
  generation += 1;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  started = false;
}
