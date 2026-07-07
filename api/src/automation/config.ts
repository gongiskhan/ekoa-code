/**
 * automation/ local config (ch05 §5.6.7). The rebuilt config.ts (ch02 §2.6) does not yet carry
 * the automation tunables the ported engine needs (the running-frontend origin used to rebase a
 * planner-guessed self URL, and the in-process local-browser fallback toggle), so — per the G8
 * worker brief — this module reads them from env with the same defaulting discipline as
 * config.ts's `envInt`, rather than editing the shared config singleton. Every value here is a
 * named config read once and memoized; nothing inline-literals a tunable at a call site.
 *
 * Env keys (noted in the G8 report for later promotion into config.ts):
 *   EKOA_APP_ORIGIN                 running frontend origin for self-URL rebasing (self-url.ts)
 *   EKOA_AUTOMATION_LOCAL_BROWSER   in-process Playwright fallback when no daemon is paired
 *   EKOA_AUTOMATION_DATA_DIR        root for per-run step screenshots (§13.4)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AutomationConfig {
  /** Running Ekoa frontend origin. A navigate/browser step pointing at a stale localhost port
   *  the planner guessed is rebased onto this (self-url.ts). */
  appOrigin: string;
  /** In-process LocalBrowserSession fallback when no local daemon is paired. Default ON outside
   *  production, OFF in production (production keeps the daemon model — invisible-behaviors §13.1). */
  localBrowserEnabled: boolean;
  /** Root directory for per-run step screenshots (§13.4). Best-effort; failures never fail a run. */
  dataDir: string;
}

function envBool(name: string, dflt: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  return raw !== 'false' && raw !== '0';
}

let cached: AutomationConfig | undefined;

export function loadAutomationConfig(): AutomationConfig {
  if (cached) return cached;
  const isProd = process.env.NODE_ENV === 'production';
  cached = {
    appOrigin: process.env.EKOA_APP_ORIGIN || 'http://localhost:3000',
    localBrowserEnabled: envBool('EKOA_AUTOMATION_LOCAL_BROWSER', !isProd),
    dataDir: process.env.EKOA_AUTOMATION_DATA_DIR || join(homedir(), '.ekoa', 'data'),
  };
  return cached;
}

/** Test helper: reset the memoized automation config. */
export function __resetAutomationConfigForTests(): void {
  cached = undefined;
}
