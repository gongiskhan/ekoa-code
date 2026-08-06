import { defineConfig, configDefaults } from 'vitest/config';

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
    // Vitest 4 removed poolOptions.forks.singleFork; fileParallelism:false is the
    // supported serializer (forces maxWorkers to 1, one isolated fork at a time).
    fileParallelism: false,
    /**
     * `assets/` holds SHIPPED APP SOURCE, not platform tests. A featured artifact's scaffold may
     * carry its own suite (the Cobranças app ships seven `node:test` files for its money/date/
     * escalation engines), and those are the APP's tests: they run against the app's own tooling,
     * assert the app's own invariants, and import `node:test` rather than vitest. The default
     * include glob swept them into this run, where they belong to nobody.
     *
     * Excluded rather than converted, deliberately: a scaffold is copied verbatim into every
     * instance a user builds, so rewriting its tests to vitest would fork the app's source away
     * from what actually ships. They stay runnable where they live (`node --test`).
     */
    exclude: [...configDefaults.exclude, 'assets/**'],
  },
});
