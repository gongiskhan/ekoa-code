import { defineConfig } from 'vitest/config';

/**
 * cortex-cli test config. The e2e suite boots the REAL api routers in-process over
 * mongodb-memory-server and drives the BUILT binary as a child process, so files run serially
 * (one mongod at a time) and the hooks get the same generous timeouts the api suite uses.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
