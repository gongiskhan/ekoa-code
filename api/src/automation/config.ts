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
 *   EKOA_AUTOMATION_LOCAL_BROWSER   kill switch for the in-process Playwright fallback (the GATE is
 *                                   the origin posture - see the field docblock)
 *   EKOA_AUTOMATION_DATA_DIR        root for per-run step screenshots (§13.4)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AutomationConfig {
  /** Running Ekoa frontend origin. A navigate/browser step pointing at a stale localhost port
   *  the planner guessed is rebased onto this (self-url.ts). */
  appOrigin: string;
  /**
   * The in-process LocalBrowserSession fallback's ENV KILL SWITCH. Default ON, in EVERY
   * environment - and it is deliberately NOT the gate.
   *
   * P4.1: this used to default to `!isProd`, which made the DEPLOYMENT ENVIRONMENT the answer to
   * "may this step run in the hosted browser". That is the wrong question asked of the wrong
   * thing: outside production every target silently ran hosted, including the portals that score
   * datacenter IPs, and production only looked correct because the flag happened to be off there.
   * The gate is the ORIGIN POSTURE, applied per step in `locality.ts`, in every environment - a
   * permissive origin may be carried by the hosted browser, an adversarial one never is, and
   * posture defaults closed, so every automation authored before posture existed is bridge-only.
   * What remains here is an operator kill switch: false turns the fallback off even for permissive
   * origins.
   */
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
  cached = {
    appOrigin: process.env.EKOA_APP_ORIGIN || 'http://localhost:3000',
    localBrowserEnabled: envBool('EKOA_AUTOMATION_LOCAL_BROWSER', true),
    dataDir: process.env.EKOA_AUTOMATION_DATA_DIR || join(homedir(), '.ekoa', 'data'),
  };
  return cached;
}

/** Test helper: reset the memoized automation config. */
export function __resetAutomationConfigForTests(): void {
  cached = undefined;
}
