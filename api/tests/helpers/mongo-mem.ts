import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Robust MongoMemoryServer factory for the contract/unit suites.
 *
 * The default mongod launch timeout (10s) is too tight on a busy CI box (or a dev
 * machine running several agents at once): mongod cold-start under CPU contention
 * routinely exceeds 10s and the suite then fails at `beforeAll` for an infra reason,
 * never a code one. We raise `launchTimeout` and retry once on a launch failure so an
 * environment hiccup does not read as a red gate. Behaviour is otherwise identical to
 * `MongoMemoryServer.create()` — same instance, same `getUri()`/`stop()`.
 */
export async function createMem(): Promise<MongoMemoryServer> {
  const opts = { instance: { launchTimeout: 60_000 } } as const;
  try {
    return await MongoMemoryServer.create(opts);
  } catch {
    // one retry — a slow first cold-start often succeeds on the second attempt
    return await MongoMemoryServer.create(opts);
  }
}

export type { MongoMemoryServer } from 'mongodb-memory-server';
