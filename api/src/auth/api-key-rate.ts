/**
 * Per-key rate caps for `user-or-key` capability routes (slice E1). A SEPARATE calls-only
 * instance of the billing/rate-caps machinery — the LLM chokepoint owns its own limiter and
 * the two NEVER share counters (a burst of capability calls must not eat the model-call
 * budget, nor vice versa). Only the per-KEY window binds: user/org and spend caps sit at
 * Infinity because JWT sessions never pass through here — the key IS the throttled principal.
 */
import { RateLimiter, type RateCapConfig, type RateCapVerdict } from '../billing/rate-caps.js';

function num(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function capabilityRateCapConfig(): RateCapConfig {
  return {
    windowMs: 60_000,
    maxCallsPerUser: Infinity,
    maxCallsPerOrg: Infinity,
    maxSpendPerUser: Infinity,
    maxSpendPerOrg: Infinity,
    maxCallsPerKey: num('EKOA_RATECAP_CAPABILITY_CALLS_PER_KEY', 120),
    maxSpendPerKey: Infinity,
    burnAlertFraction: 0.8,
  };
}

/** A full config is always passed down, so the chokepoint's env-driven defaults never leak in. */
export function makeCapabilityRateLimiter(cfg?: Partial<RateCapConfig>): RateLimiter {
  return new RateLimiter({ ...capabilityRateCapConfig(), ...cfg });
}

export interface CapabilityCallKey {
  keyId: string;
  billeeUserId: string;
  orgId: string;
  now?: number;
}

// The default process-wide capability limiter the admission middleware uses.
let defaultLimiter = makeCapabilityRateLimiter();

/**
 * Check-and-count one capability call for an api-key principal. Only admitted calls are
 * recorded (a 429 must not extend the window). The key doc's own caps (`verdict.caps`) are
 * the LLM-gateway budget and deliberately do NOT override this window.
 */
export function admitCapabilityCall(key: CapabilityCallKey): RateCapVerdict {
  const verdict = defaultLimiter.check(key);
  if (verdict.ok) defaultLimiter.recordSpend({ ...key, metered: 0 });
  return verdict;
}

/** Rebuild the default limiter (re-reads env); an explicit cfg overrides per-test. */
export function __resetCapabilityRateForTests(cfg?: Partial<RateCapConfig>): void {
  defaultLimiter = makeCapabilityRateLimiter(cfg);
}
