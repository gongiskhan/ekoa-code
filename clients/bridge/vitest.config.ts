import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests boot an in-process ekoa-code bridge server + mongodb-memory-server and a
    // real daemon child process; run files serially in isolated forks (mirrors ekoa-code's config).
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
