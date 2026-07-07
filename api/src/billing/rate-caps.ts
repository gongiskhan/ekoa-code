/**
 * Chokepoint rate limits + spend caps (ch06 §6.6.4, FIXED-14; security addendum B.5). Distinct
 * from the allowance gate (§6.6.3, a period budget): this is a security control against unbounded
 * consumption — per-ORG and per-USER sliding-window call-rate limits and metered-token spend caps,
 * with an alert on anomalous burn. It is nearly free here because attribution (§6.3) already
 * carries billee + org on every call, so the counters group over data the chokepoint already has.
 *
 * The window, caps, and burn-alert threshold are config-overridable (env, or per-instance for
 * tests) and the clock is injectable. Counters are in-memory sliding windows keyed by billee and
 * by org; the chokepoint calls `check()` before admitting a call and `recordSpend()` after it
 * completes (with the provider-reported metered total).
 */

export interface RateCapConfig {
  windowMs: number;
  maxCallsPerUser: number;
  maxCallsPerOrg: number;
  maxSpendPerUser: number; // metered tokens per window
  maxSpendPerOrg: number; // metered tokens per window
  /** Fraction of a cap whose crossing raises a burn alert (0..1). */
  burnAlertFraction: number;
}

export interface RateCapVerdict {
  ok: boolean;
  reason?: string;
  scope?: 'user' | 'org';
  kind?: 'rate' | 'spend';
}

export interface RateCapKey {
  billeeUserId: string;
  orgId: string;
  now?: number;
}

type BurnAlert = (info: { scope: 'user' | 'org'; kind: 'rate' | 'spend'; key: string; value: number; cap: number }) => void;

function num(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function defaultRateCapConfig(): RateCapConfig {
  return {
    windowMs: num('EKOA_RATECAP_WINDOW_MS', 60_000),
    maxCallsPerUser: num('EKOA_RATECAP_CALLS_PER_USER', 60),
    maxCallsPerOrg: num('EKOA_RATECAP_CALLS_PER_ORG', 300),
    maxSpendPerUser: num('EKOA_RATECAP_SPEND_PER_USER', 5_000_000),
    maxSpendPerOrg: num('EKOA_RATECAP_SPEND_PER_ORG', 20_000_000),
    burnAlertFraction: num('EKOA_RATECAP_BURN_FRACTION', 0.8),
  };
}

interface WindowEntry {
  ts: number;
  metered: number;
}

/** A sliding-window rate + spend limiter. In-memory; the window self-prunes on each touch. */
export class RateLimiter {
  private readonly cfg: RateCapConfig;
  private readonly onBurn: BurnAlert;
  private readonly userWindows = new Map<string, WindowEntry[]>();
  private readonly orgWindows = new Map<string, WindowEntry[]>();
  private readonly alerted = new Set<string>();

  constructor(cfg?: Partial<RateCapConfig>, onBurn?: BurnAlert) {
    this.cfg = { ...defaultRateCapConfig(), ...cfg };
    this.onBurn =
      onBurn ??
      ((info) =>
        console.warn(
          `[billing] anomalous burn: ${info.scope}/${info.kind} ${info.key} at ${info.value}/${info.cap}`,
        ));
  }

  private prune(list: WindowEntry[], now: number): WindowEntry[] {
    const cutoff = now - this.cfg.windowMs;
    return list.filter((e) => e.ts > cutoff);
  }

  private countAndSpend(list: WindowEntry[]): { count: number; spend: number } {
    let spend = 0;
    for (const e of list) spend += e.metered;
    return { count: list.length, spend };
  }

  /**
   * Pre-admission check (§6.6.4). Returns ok:false with the tripped scope+kind when adding one
   * more call would exceed a rate cap, or when the window's metered spend already sits at/above a
   * spend cap. Rate is checked against the count BEFORE this call (>= cap ⇒ this call is the
   * over-the-line one); spend is checked against accumulated metered tokens.
   */
  check(key: RateCapKey): RateCapVerdict {
    const now = key.now ?? Date.now();
    const users = this.prune(this.userWindows.get(key.billeeUserId) ?? [], now);
    const orgs = this.prune(this.orgWindows.get(key.orgId) ?? [], now);
    this.userWindows.set(key.billeeUserId, users);
    this.orgWindows.set(key.orgId, orgs);

    const u = this.countAndSpend(users);
    const o = this.countAndSpend(orgs);

    if (u.count >= this.cfg.maxCallsPerUser) return { ok: false, scope: 'user', kind: 'rate', reason: 'per-user call rate exceeded' };
    if (o.count >= this.cfg.maxCallsPerOrg) return { ok: false, scope: 'org', kind: 'rate', reason: 'per-org call rate exceeded' };
    if (u.spend >= this.cfg.maxSpendPerUser) return { ok: false, scope: 'user', kind: 'spend', reason: 'per-user spend cap exceeded' };
    if (o.spend >= this.cfg.maxSpendPerOrg) return { ok: false, scope: 'org', kind: 'spend', reason: 'per-org spend cap exceeded' };
    return { ok: true };
  }

  /**
   * Record a completed call's metered spend into both windows (§6.6.4). Call after the chokepoint
   * meters the provider-reported usage. Raises a burn alert once per window-key when usage crosses
   * `burnAlertFraction` of a cap.
   */
  recordSpend(key: RateCapKey & { metered: number }): void {
    const now = key.now ?? Date.now();
    const users = this.prune(this.userWindows.get(key.billeeUserId) ?? [], now);
    const orgs = this.prune(this.orgWindows.get(key.orgId) ?? [], now);
    users.push({ ts: now, metered: key.metered });
    orgs.push({ ts: now, metered: key.metered });
    this.userWindows.set(key.billeeUserId, users);
    this.orgWindows.set(key.orgId, orgs);

    const u = this.countAndSpend(users);
    const o = this.countAndSpend(orgs);
    this.maybeAlert('user', 'rate', key.billeeUserId, u.count, this.cfg.maxCallsPerUser);
    this.maybeAlert('org', 'rate', key.orgId, o.count, this.cfg.maxCallsPerOrg);
    this.maybeAlert('user', 'spend', key.billeeUserId, u.spend, this.cfg.maxSpendPerUser);
    this.maybeAlert('org', 'spend', key.orgId, o.spend, this.cfg.maxSpendPerOrg);
  }

  private maybeAlert(scope: 'user' | 'org', kind: 'rate' | 'spend', key: string, value: number, cap: number): void {
    if (cap <= 0) return;
    const alertKey = `${scope}:${kind}:${key}`;
    if (value >= cap * this.cfg.burnAlertFraction) {
      if (!this.alerted.has(alertKey)) {
        this.alerted.add(alertKey);
        this.onBurn({ scope, kind, key, value, cap });
      }
    } else {
      this.alerted.delete(alertKey);
    }
  }

  reset(): void {
    this.userWindows.clear();
    this.orgWindows.clear();
    this.alerted.clear();
  }
}

// The default process-wide limiter the chokepoint uses.
let defaultLimiter = new RateLimiter();
export function checkRateCaps(key: RateCapKey): RateCapVerdict {
  return defaultLimiter.check(key);
}
export function recordSpend(key: RateCapKey & { metered: number }): void {
  defaultLimiter.recordSpend(key);
}
export function __resetRateCapsForTests(): void {
  defaultLimiter = new RateLimiter();
}
