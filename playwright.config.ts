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
  /**
   * THE PER-TEST BUDGET, raised from Playwright's 30s default because thirty specs in this estate
   * were quietly exceeding it.
   *
   * Those specs pick per-assertion budgets deliberately and document why: the demo-spine removal
   * walks ~24 collections then reloads (90s), a legal chain runs end to end (120s), the bridge
   * handshake takes ~20s on a first step (60s). Every one of those was DEAD CODE past 30s — the
   * test was killed by the global cap first, and the output said so on two adjacent lines:
   *
   *     Test timeout of 30000ms exceeded.
   *     Expect "toHaveCount" with timeout 90000ms
   *
   * That reads as a product hang and is nothing of the sort, which is why it kept being triaged as
   * "flaky under load": the closer the machine gets to the cap, the more of these tip over. It is
   * also why `demos.spec.ts` had all 28 of its tours failing at their first step.
   *
   * 180s is above the longest legitimate wait (120s) with headroom. It is a BACKSTOP, not the
   * bound: each assertion still fails at its own budget, so a genuinely stuck test surfaces at the
   * assertion that stuck rather than at an arbitrary global. Specs needing more still say so with
   * `test.setTimeout` (part-b-proof 1500s, voice-proof 480s, demos 300s), which overrides this.
   */
  timeout: 180_000,
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
