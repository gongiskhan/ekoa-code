import { defineConfig } from 'vitest/config';

/**
 * web/ default unit run covers only src/**. The ported frontend estate under web/__tests__
 * (17 surviving unit files) is committed but ledger-scoped: it imports the un-migrated
 * frontend and cannot run until the web migration (G9). The suite-ledger runner
 * (scripts/suite-ledger-run.mjs) executes it when its gate arrives; the CI default run
 * excludes it so it is a tracked skip, never a silent break.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['__tests__/**', 'e2e/**', 'node_modules/**', 'dist/**'],
  },
});
