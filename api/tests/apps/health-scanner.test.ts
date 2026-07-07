import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts } from '../../src/data/stores.js';
import { scanUncheckedArtifacts } from '../../src/apps/health-scanner.js';

/**
 * Proactive app-health scanner (ch07 §7.11). Verifies it scans ONLY unchecked
 * non-featured registered artifacts, honours concurrency 4, never writes the store
 * itself (only the probe writes), and skips when the config toggle is set. The
 * page-loader + registry are injected stubs (no browser dependency).
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_health');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  await artifacts.deleteMany({});
});

async function seed(id: string, extra: Record<string, unknown> = {}) {
  await artifacts.insert({
    _id: id, name: id, slug: id, userId: 'u1', orgId: 'o1', visibility: 'private', status: 'active', ...extra,
  } as never);
}

describe('health-scanner (ch07 §7.11)', () => {
  it('scans only UNCHECKED, NON-FEATURED, REGISTERED artifacts; never writes the store', async () => {
    await seed('unchecked-reg');                          // scanned
    await seed('unchecked-unreg');                        // skipped (not registered)
    await seed('featured-reg', { featured: true });       // skipped (featured)
    await seed('checked-reg', { health: { status: 'healthy' } }); // skipped (already checked)

    const registered = new Set(['unchecked-reg', 'featured-reg', 'checked-reg']);
    const loaded: string[] = [];

    const result = await scanUncheckedArtifacts({
      loadPage: async (url) => { loaded.push(url); },
      baseUrl: 'http://localhost:4111',
      isRegistered: (id) => registered.has(id),
    });

    // Only the unchecked, non-featured, registered artifact was opened.
    expect(loaded).toEqual(['http://localhost:4111/apps/unchecked-reg/']);
    expect(result.scanned).toBe(1);
    expect(result.skippedUnregistered).toBe(1); // unchecked-unreg
    expect(result.skipped).toBe(false);

    // The scanner itself never persisted a verdict - health is still unset everywhere.
    for (const id of ['unchecked-reg', 'unchecked-unreg']) {
      const row = await artifacts.get(id);
      expect((row as { health?: unknown }).health).toBeUndefined();
    }
  });

  it('honours the concurrency ceiling (never more than N page loads in flight)', async () => {
    for (let i = 0; i < 12; i++) await seed(`app-${i}`);
    let inFlight = 0;
    let peak = 0;
    const result = await scanUncheckedArtifacts({
      loadPage: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--;
      },
      baseUrl: 'http://localhost:4111',
      concurrency: 4,
      isRegistered: () => true,
    });
    expect(result.scanned).toBe(12);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // proves it actually ran concurrently
  });

  it('the config toggle skips the whole scan (no page loads)', async () => {
    await seed('would-scan');
    const loaded: string[] = [];
    const result = await scanUncheckedArtifacts({
      loadPage: async (url) => { loaded.push(url); },
      baseUrl: 'http://localhost:4111',
      disabled: true,
      isRegistered: () => true,
    });
    expect(result.skipped).toBe(true);
    expect(result.scanned).toBe(0);
    expect(loaded).toHaveLength(0);
  });
});
