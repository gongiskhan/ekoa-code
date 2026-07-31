import { defineConfig } from 'vitest/config';

/**
 * shared test config.
 *
 * The only thing this exists for: keep the suite off the build output. Vitest 4 narrowed the
 * default `exclude` to `node_modules` and `.git` — the dist glob is NOT excluded any more — so
 * with no config at all the runner collected every compiled `dist/<name>.test.js` in addition to
 * its `src/` original. The suite therefore ran each shared test twice and its reported count moved
 * with the state of a BUILD ARTIFACT: 5 files/130 tests on a stale dist, 6/144 after a rebuild,
 * 3/72 on a clean checkout. Counts that drift with local build state are worthless as a census,
 * and both the suite ledger and commit messages quote them.
 *
 * `shared/tsconfig.json` now also excludes tests from the build, so dist holds no test file to
 * collect. This is the belt to that pair of braces: collection stays correct even if a future
 * build change puts them back.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
