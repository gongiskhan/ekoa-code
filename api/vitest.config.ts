import { defineConfig } from 'vitest/config';

/**
 * api test config. bcrypt cost 12 (ch09 §9.7) is deliberately slow, and several contract
 * tests do multiple real logins over mongodb-memory-server, so the per-test timeout is
 * raised. Test FILES run serially (single fork) to avoid CPU contention starving bcrypt
 * across the in-memory-Mongo suites.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
