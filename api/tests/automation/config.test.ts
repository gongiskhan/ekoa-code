import { describe, it, expect, afterEach } from 'vitest';
import { loadAutomationConfig, __resetAutomationConfigForTests } from '../../src/automation/config.js';

/**
 * THE HOSTED BROWSER'S KILL SWITCH, AND WHAT P4 DID *NOT* CHANGE ABOUT IT.
 *
 * P4 moved the GATE for "may this step run in the hosted browser" from this flag to the origin's
 * posture (`locality.ts`), which is the right move: a deployment environment is not an answer to a
 * question about a SITE. The first cut of the slice went one step further and defaulted the flag ON
 * everywhere, on the reasoning that it was now "only a kill switch".
 *
 * THAT STEP IS AN OPENING, and this suite exists to keep it from being taken by accident. Relative
 * to the shipped system, defaulting it on in production takes hosted Chromium from CATEGORICALLY
 * UNREACHABLE there to reachable for every origin some declaration calls permissive - on a slice
 * whose whole purpose is to narrow where a browser may run. A slice that narrows must not widen
 * anything on the way past, so the production default stays closed and turning it on stays a
 * deliberate operator act.
 *
 * The env var is read at load and memoized, so every case resets the memo and restores the process
 * environment it found.
 */
const KEY = 'EKOA_AUTOMATION_LOCAL_BROWSER';

function withEnv(env: { NODE_ENV?: string; flag?: string }, fn: () => void): void {
  const priorNodeEnv = process.env['NODE_ENV'];
  const priorFlag = process.env[KEY];
  try {
    if (env.NODE_ENV === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = env.NODE_ENV;
    if (env.flag === undefined) delete process.env[KEY];
    else process.env[KEY] = env.flag;
    __resetAutomationConfigForTests();
    fn();
  } finally {
    if (priorNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = priorNodeEnv;
    if (priorFlag === undefined) delete process.env[KEY];
    else process.env[KEY] = priorFlag;
    __resetAutomationConfigForTests();
  }
}

afterEach(() => __resetAutomationConfigForTests());

describe('the in-process browser kill switch', () => {
  it('is CLOSED in production when nothing says otherwise', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      expect(loadAutomationConfig().localBrowserEnabled).toBe(false);
    });
  });

  it('is open outside production, so local development still runs browser steps', () => {
    withEnv({ NODE_ENV: 'development' }, () => {
      expect(loadAutomationConfig().localBrowserEnabled).toBe(true);
    });
    withEnv({}, () => {
      expect(loadAutomationConfig().localBrowserEnabled).toBe(true);
    });
  });

  it('an operator can open it in production DELIBERATELY, and only that way', () => {
    withEnv({ NODE_ENV: 'production', flag: 'true' }, () => {
      expect(loadAutomationConfig().localBrowserEnabled).toBe(true);
    });
  });

  it('...and can close it outside production too - the switch cuts both ways', () => {
    withEnv({ NODE_ENV: 'development', flag: 'false' }, () => {
      expect(loadAutomationConfig().localBrowserEnabled).toBe(false);
    });
  });

  it('an empty value is not a decision, so the environment default stands', () => {
    withEnv({ NODE_ENV: 'production', flag: '' }, () => {
      expect(loadAutomationConfig().localBrowserEnabled).toBe(false);
    });
  });
});
