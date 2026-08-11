import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startCrawl, cancelCrawl, cancelCrawlAndWait, isCrawlRunning, getCrawlProgress, __resetCrawlRunnerForTests,
} from '../../../src/knowledge/crawl/runner.js';
import { closeIndex } from '../../../src/knowledge/index-store.js';
import { SHARED_ORG_ID } from '../../../src/knowledge/paths.js';
import type { KnowledgeSourceDoc } from '../../../src/knowledge/service.js';

/**
 * WS8c - the crawl runner's LIFECYCLE guarantees: the already-running guard, dispatch by
 * `source.kind`, and the declared-but-unimplemented `kind: 'api'` refusal.
 *
 * NO NETWORK, deliberately: `startCrawl` has no `fetchImpl` injection point (only `engine.ts`/
 * `domino.ts` accept one directly, which is what `engine.test.ts`/`domino.test.ts` exercise
 * against local fixtures). Pointing a runner-level test at a real hostname - even one that would
 * eventually be SSRF-refused - is still an attempted live request, exactly what this task was
 * told never to do. Every source here uses a LOOPBACK URL instead: `assertSafeUrl` rejects it
 * SYNCHRONOUSLY inside the crawl's async body, before any socket ever opens. That is enough to
 * exercise the runner's reservation/release lifecycle end to end, because `active.set(sourceId,
 * ...)` happens BEFORE the first `await` in `startCrawl` - the guard is provably synchronous
 * regardless of how (or how fast) the background work later resolves.
 */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-crawl-runner-'));
  process.env.EKOA_DATA_DIR = dir;
  closeIndex();
  __resetCrawlRunnerForTests();
});

afterEach(async () => {
  closeIndex();
  delete process.env.EKOA_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** A source whose crawl fails FAST and with zero network I/O: `assertSafeUrl` refuses a loopback
 *  URL before any fetch is attempted (see the module doc). */
function source(over: Partial<KnowledgeSourceDoc> = {}): KnowledgeSourceDoc {
  return { _id: 'src-1', orgId: SHARED_ORG_ID, url: 'http://127.0.0.1:1/refused-by-ssrf', collection: 'jurisprudencia', maxPages: 10, ...over } as KnowledgeSourceDoc;
}

async function lookupOf(s: KnowledgeSourceDoc) {
  return async (id: string) => (id === s._id ? s : null);
}

describe('startCrawl: the already-running guard', () => {
  it('reserves the slot SYNCHRONOUSLY - isCrawlRunning is true immediately, before any await', async () => {
    const s = source();
    const promise = startCrawl(s._id, await lookupOf(s));
    // No await yet: `active.set(sourceId, ...)` happens before the first `await lookup(...)` in
    // `startCrawl`, so this genuinely observes the pre-lookup state, not a race.
    expect(isCrawlRunning(s._id)).toBe(true);
    await promise;
  });

  it('a second start while one is in flight is a no-op ({ alreadyRunning: true }), not a second run', async () => {
    const s = source();
    const first = startCrawl(s._id, await lookupOf(s));
    const second = await startCrawl(s._id, await lookupOf(s));
    expect(second).toEqual({ started: false, alreadyRunning: true });
    expect(await first).toEqual({ started: true, alreadyRunning: false });
  });

  it('the slot releases once the (failing) background run settles, and the failure is recorded honestly', async () => {
    const s = source();
    await startCrawl(s._id, await lookupOf(s));
    // Poll briefly for the background async body to settle - it fails fast (no network), so this
    // should resolve on the first or second tick, never hang.
    for (let i = 0; i < 50 && isCrawlRunning(s._id); i++) await new Promise((r) => setTimeout(r, 5));
    expect(isCrawlRunning(s._id)).toBe(false);
    const progress = getCrawlProgress(s._id);
    expect(progress?.state).toBe('error');
    expect(progress?.error).toBeTruthy();
  });

  it('a source that has gone (deleted) between reserving and looking up releases the slot and throws', async () => {
    const lookup = async () => null;
    await expect(startCrawl('gone', lookup)).rejects.toThrow(/não encontrada/);
    expect(isCrawlRunning('gone')).toBe(false);
  });

  it('`kind: "api"` is refused SYNCHRONOUSLY (before any I/O) - a declared-but-unimplemented OPEN item, never silently mis-run', async () => {
    const s = source({ kind: 'api' });
    await expect(startCrawl(s._id, await lookupOf(s))).rejects.toThrow(/não têm execução implementada/i);
    expect(isCrawlRunning(s._id)).toBe(false); // the slot was released, not left dangling
  });

  it('`kind: "domino"` with no domino config also settles as an error, not a hang or a fabricated success', async () => {
    const s = source({ kind: 'domino', domino: undefined });
    await startCrawl(s._id, await lookupOf(s));
    for (let i = 0; i < 50 && isCrawlRunning(s._id); i++) await new Promise((r) => setTimeout(r, 5));
    const progress = getCrawlProgress(s._id);
    expect(progress?.state).toBe('error');
  });
});

describe('cancelCrawl / cancelCrawlAndWait', () => {
  it('cancelCrawl on a source with nothing running returns false', () => {
    expect(cancelCrawl('nothing-running')).toBe(false);
  });

  it('cancelCrawlAndWait resolves immediately (false) when nothing is running', async () => {
    expect(await cancelCrawlAndWait('nothing-running')).toBe(false);
  });

  it('cancelCrawl on an active run returns true, and cancelCrawlAndWait deterministically observes it settle', async () => {
    const s = source();
    await startCrawl(s._id, await lookupOf(s));
    expect(cancelCrawl(s._id)).toBe(true);
    await cancelCrawlAndWait(s._id);
    expect(isCrawlRunning(s._id)).toBe(false);
  });
});
