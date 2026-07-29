import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the ported e2e estate (ch13 §13.2, carried discipline §2.1):
 * one worker, not fully parallel, per-spec real-UI login (no shared auth fixture).
 * The baseURL follows the running web app; the ledger runner (scripts/suite-ledger-run.mjs)
 * decides WHICH specs run at the current gate — everything not yet due is reported
 * `skipped (awaiting G<N>)` and is never handed to Playwright until its stack exists.
 */
export default defineConfig({
  testDir: './web/e2e',
  testMatch: '**/*.spec.ts',
  // Seed the legal shared spine once before the byte-compat suite (see the file
  // header): the satellite legal apps READ the Núcleo's seed, which a fresh per-run
  // Mongo does not carry. Harness setup only - no assertion is touched.
  globalSetup: './web/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['line']],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    /**
     * Tracing is OFF by default (Cofre G-6).
     *
     * Every spec in this estate logs in for real — that is the standing rule, no protocol stubs and
     * no shared auth fixture. A Playwright trace of a logged-in run captures the session: the
     * request headers carrying the bearer token, and a storage snapshot holding whatever the app
     * put in localStorage. `on-first-retry` therefore wrote a live session blob to `test-results/`
     * on exactly the runs people keep and share, which is the opposite of what you want from a
     * failure artefact. The plan calls this low severity and it is — the directory is gitignored —
     * but I2 cannot be claimed while a session lands on disk as a side effect of a flake.
     *
     * Set EKOA_E2E_TRACE=1 to turn it back on for a debugging session. Deliberately an opt-in an
     * engineer types, not a default that quietly accumulates: the artefact is genuinely useful, it
     * just should not be produced by every retry on every machine forever.
     */
    trace: process.env.EKOA_E2E_TRACE === '1' ? 'on-first-retry' : 'off',
  },
});
