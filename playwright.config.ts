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
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['line']],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
});
