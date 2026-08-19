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
 *   EKOA_AUTOMATION_LOCAL_BROWSER   kill switch for the in-process (hosted) Playwright browser; ON
 *                                   outside production, OFF in production. The GATE is the origin
 *                                   posture, not this - see the field docblock.
 *   EKOA_AUTOMATION_DATA_DIR        root for per-run step screenshots (§13.4)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AutomationConfig {
  /** Running Ekoa frontend origin. A navigate/browser step pointing at a stale localhost port
   *  the planner guessed is rebased onto this (self-url.ts). */
  appOrigin: string;
  /**
   * The in-process (hosted Chromium) browser's ENV KILL SWITCH. Default ON outside production, OFF
   * in production - UNCHANGED, deliberately. P4 changed what this flag MEANS, not what it defaults
   * to.
   *
   * WHAT IT USED TO MEAN. It was the ONLY answer to "may this step run in the hosted browser",
   * which made the DEPLOYMENT ENVIRONMENT the answer to a question about a SITE: outside production
   * every target silently ran hosted, including the portals that score datacenter IPs, and
   * production only looked correct because the flag happened to be off there.
   *
   * WHAT IT MEANS NOW. An operator kill switch, and nothing more. The GATE is the ORIGIN POSTURE,
   * applied per step in `locality.ts`, in every environment - a permissive origin may be carried by
   * the hosted browser, an adversarial one never is, and posture defaults closed, so every
   * automation authored before posture existed is bridge-only whatever this flag says.
   *
   * SO WHY NOT DEFAULT IT ON EVERYWHERE, now that posture is the gate? Because relative to the
   * shipped system that is an OPENING: hosted Chromium would go from categorically unreachable in
   * production to reachable for every origin some declaration calls permissive - on a slice whose
   * entire purpose is to narrow where a browser may run. A slice that narrows must not widen
   * anything on the way past. Turning it on in production is a deliberate operator act
   * (`EKOA_AUTOMATION_LOCAL_BROWSER=true`), taken when the fleet and the posture declarations are
   * ready for it, and not a side effect of this change. Pinned by `tests/automation/config.test.ts`
   * in both environments.
   *
   * It is also the switch the credential gate's TYPIST reads (`engine.ts` builds its hosted-browser
   * permit from it): with the hosted browser off, a password is not quietly typed into one either.
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
