/**
 * Token metering + ledger writer (ch06 §6.5). This is THE single recording API: the LLM
 * chokepoint (`llm/`) hands one completed call here and nothing else writes `token_events`
 * (§6.5.1 single-writer). It computes metered tokens (§6.5.2), writes one ledger event
 * (§6.5.3 shape), and folds the metered total into the billee's `billing_accounts` meter
 * with a lazy 30-day period reset (§6.6.2), CAS-safe credit deduction, and a fire-and-forget
 * usage push (§6.7). Non-Anthropic surfaces (STT, Pipedream) ride the same recorder (§6.5.6).
 * Non-token usage counters (voice, mega-run C2) ride `recordUsageCounters` below - same single
 * writer, separate `usage_events` ledger, never token-converted.
 */
import { randomUUID } from 'node:crypto';
import { tokenEvents, usageEvents, billingAccounts, settings, users } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import { billingConfig, cacheReadFactor, periodMs, type Tier, tierWeight } from './constants.js';

/**
 * Resolve the account that carries platform / gateway-key usage (§6.3 rule 3): usage with no
 * user billee (attributionKind 'platform', or a gateway API-key principal) ledgers against the
 * PLATFORM ADMIN, never an empty pseudo-account (`billeeUserId=''` / `billing_accounts._id=''`).
 * Injected in tests; the default resolves + caches the founder super-admin id from the users
 * store. Returns '' only when no super-admin exists (pre-seed) - the write still lands, on ''.
 */
let cachedPlatformBillee: string | null = null;
let platformBilleeResolver: () => Promise<string> = async () => {
  if (cachedPlatformBillee) return cachedPlatformBillee;
  const admins = await users.find({ role: 'super-admin' });
  cachedPlatformBillee = admins[0]?._id ?? '';
  return cachedPlatformBillee;
};
export function setPlatformBilleeResolver(fn: () => Promise<string>): void {
  platformBilleeResolver = fn;
  cachedPlatformBillee = null;
}
export function __resetPlatformBilleeForTests(): void {
  cachedPlatformBillee = null;
}
/** Public accessor for the platform-admin billee id, used by the chokepoint to key the rate
 *  cap for platform / gateway-key traffic (empty user billee) against the admin account. */
export async function resolvePlatformBillee(): Promise<string> {
  return platformBilleeResolver();
}

export type AttributionKind = 'user_work' | 'classifier' | 'platform';
export type { Tier } from './constants.js';

export interface TokenEventInput {
  billeeUserId: string;
  attributionKind: AttributionKind;
  agentType: string;
  artifactId?: string;
  sessionId?: string;
  runId?: string;
  model: string;
  tier: Tier;
  raw: { input: number; output: number; cacheCreate: number; cacheRead: number };
  /** injectable clock for tests; default Date.now() */
  now?: number;
}

/** `billing_accounts` document (ch04 §4.3.1; §6.6.1). One per user, `_id` = userId. */
export interface BillingAccountDoc extends Doc {
  monthlyBaseTokensUsed: number;
  creditBalanceUsd: number;
  overageEnabled: boolean;
  currentPeriodStart: number; // epoch ms
  tokenLimit: number | null; // null = platform default base
}

// ---------------------------------------------------------------------------
// Usage push seam (§6.7, ch02 §2.8 seam 1): billing/ never imports events/. The
// composition root (server.ts) injects the notifier at boot; default is a no-op.
// The push is a bare poke and must never fail the turn (fire-and-forget).
// ---------------------------------------------------------------------------
type UsageNotifier = (userId: string) => void;
let usageNotifier: UsageNotifier = () => {};
export function setUsageNotifier(fn: UsageNotifier): void {
  usageNotifier = fn;
}
export function __resetUsageNotifierForTests(): void {
  usageNotifier = () => {};
}

/** The metering formula (§6.5.2, normative). Single round over the weighted sum. */
export function computeMetered(tier: Tier, raw: TokenEventInput['raw']): number {
  const w = tierWeight(tier);
  return Math.round(
    w * (raw.input + raw.output + raw.cacheCreate) + w * cacheReadFactor() * raw.cacheRead,
  );
}

/** The zeroed account shape a user has before any metered call (also used by read-only
 *  views for users with no account row yet — no write side effect). */
export const defaultAccount = (userId: string, now: number): BillingAccountDoc => ({
  _id: userId,
  monthlyBaseTokensUsed: 0,
  creditBalanceUsd: 0,
  overageEnabled: false,
  currentPeriodStart: now,
  tokenLimit: null,
});

/** Ensure the billee has an account row, tolerating a concurrent first-write race. */
export async function ensureAccount(userId: string, now: number): Promise<BillingAccountDoc> {
  const existing = (await billingAccounts.get(userId)) as BillingAccountDoc | null;
  if (existing) return existing;
  await billingAccounts.insert(defaultAccount(userId, now) as unknown as Doc);
  return ((await billingAccounts.get(userId)) as BillingAccountDoc | null) ?? defaultAccount(userId, now);
}

/**
 * CAS-update the account with a bounded OUTER retry on top of `Store.update`'s inner retry
 * (§6.6.1: CAS with bounded retry, never double-apply). The store throws after its 5 inner
 * tries; under a thundering herd (many concurrent records on one account) that ceiling is too
 * low, so we retry the whole read-modify-write a few more times with a little jitter to let the
 * herd drain. The mutator is pure over the freshly-read doc, so every retry re-applies exactly
 * once — no double-apply. The account is guaranteed to exist (ensureAccount ran first).
 */
async function casUpdateAccount(userId: string, mutate: (cur: BillingAccountDoc) => BillingAccountDoc): Promise<void> {
  const OUTER = 10;
  for (let attempt = 0; attempt < OUTER; attempt++) {
    try {
      await billingAccounts.update(userId, (curDoc) => mutate(curDoc as BillingAccountDoc) as unknown as Doc);
      return;
    } catch (err) {
      if (attempt === OUTER - 1) throw err;
      await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 4)));
    }
  }
}

/** Pure lazy-reset computation (§6.6.2): a period boundary zeroes the meter and advances the
 *  start. `used`/`periodStart` are the effective values to read or persist; `didReset` says a
 *  boundary was crossed (so a read can persist the zeroing). */
export function applyLazyReset(
  acct: BillingAccountDoc,
  now: number,
): { used: number; periodStart: number; didReset: boolean } {
  if (now - acct.currentPeriodStart >= periodMs()) {
    return { used: 0, periodStart: now, didReset: true };
  }
  return { used: acct.monthlyBaseTokensUsed, periodStart: acct.currentPeriodStart, didReset: false };
}

export function baseFor(acct: Pick<BillingAccountDoc, 'tokenLimit'>): number {
  return acct.tokenLimit ?? billingConfig().platformDefaultBase;
}

export function creditTokensOf(creditBalanceUsd: number): number {
  return Math.floor(creditBalanceUsd * billingConfig().creditTokensPerUsd);
}

/** overagePermitted(u) = overageEnabled AND globalOverageEnabled AND NOT HARD_LIMIT (§6.6.2). */
export function overagePermitted(overageEnabled: boolean, globalOverageEnabled: boolean): boolean {
  return overageEnabled && globalOverageEnabled && !billingConfig().hardLimit;
}

/** The admin global overage kill-switch (§6.6.2), stored on the platform `settings` singleton
 *  (`_id:'default'`, `billing.globalOverageEnabled`). Unset defaults to ENABLED (carried: a
 *  missing switch is "not disabled"). Read defensively — a settings read must never throw. */
export async function readGlobalOverageEnabled(): Promise<boolean> {
  try {
    const s = (await settings.get('default')) as { billing?: { globalOverageEnabled?: boolean } } | null;
    return s?.billing?.globalOverageEnabled !== false;
  } catch {
    return true;
  }
}

/** Write the admin global overage kill-switch onto the platform settings singleton. */
export async function writeGlobalOverageEnabled(enabled: boolean): Promise<boolean> {
  const cur = (await settings.get('default')) as (Doc & { billing?: Record<string, unknown> }) | null;
  const nextBilling = { ...(cur?.billing ?? {}), globalOverageEnabled: enabled };
  await settings.put({ ...(cur ?? {}), _id: 'default', billing: nextBilling } as unknown as Doc);
  return enabled;
}

/**
 * Record ONE completed model (or non-model) call: metered per §6.5.2, snapshot `tierWeight`,
 * write one `token_events` doc (§6.5.3), then fold the metered total into the billee's meter
 * with a lazy period reset + credit deduction under CAS (§6.6.2). Returns { metered }.
 */
export async function recordTokenEvent(e: TokenEventInput): Promise<{ metered: number }> {
  const now = e.now ?? Date.now();
  const weight = tierWeight(e.tier);
  const metered = computeMetered(e.tier, e.raw);

  // Platform / gateway-key usage (empty billee) ledgers against the platform admin, never ''
  // (§6.3 rule 3). user_work/classifier calls always carry a real billee and pass through.
  const billeeUserId = e.billeeUserId || (await platformBilleeResolver());

  // 1. The one ledger write (§6.5.3 shape). token_events has a single writer (§6.5.1).
  await tokenEvents.insert({
    _id: randomUUID(),
    billeeUserId,
    attributionKind: e.attributionKind,
    agentType: e.agentType,
    ...(e.artifactId ? { artifactId: e.artifactId } : {}),
    ...(e.sessionId ? { sessionId: e.sessionId } : {}),
    ...(e.runId ? { runId: e.runId } : {}),
    model: e.model,
    tier: e.tier,
    tierWeight: weight,
    raw: { input: e.raw.input, output: e.raw.output, cacheCreate: e.raw.cacheCreate, cacheRead: e.raw.cacheRead },
    metered,
    timestamp: now,
  } as unknown as Doc);

  // 2. Fold into the billee's meter under CAS. globalOverageEnabled is resolved BEFORE the
  //    CAS mutator (which must stay synchronous/pure so it re-runs cleanly on _rev drift).
  await ensureAccount(billeeUserId, now);
  const globalOverage = await readGlobalOverageEnabled();
  await casUpdateAccount(billeeUserId, (cur) => {
    const { used, periodStart } = applyLazyReset(cur, now);
    const base = baseFor(cur);
    const newUsed = used + metered;

    let newCredit = cur.creditBalanceUsd;
    if (newUsed > base && overagePermitted(cur.overageEnabled, globalOverage)) {
      // Only the tokens beyond base draw down credit (§6.6.2). max(used, base) avoids
      // charging base tokens when this event straddles the boundary.
      const overageTokens = newUsed - Math.max(used, base);
      if (overageTokens > 0) {
        const costUsd = overageTokens / billingConfig().creditTokensPerUsd;
        newCredit = Math.max(0, cur.creditBalanceUsd - costUsd);
      }
    }

    return {
      ...cur,
      monthlyBaseTokensUsed: newUsed,
      creditBalanceUsd: newCredit,
      currentPeriodStart: periodStart,
    };
  });

  // 3. Usage push (§6.7): fire-and-forget, never fails the turn.
  try {
    usageNotifier(billeeUserId);
  } catch {
    /* never fail a turn on a notify error */
  }

  return { metered };
}

// ---------------------------------------------------------------------------
// Non-token usage counters (mega-run C2; BRIEF §5 "Shared surface"). The SAME single
// metering writer records quantities that are NOT tokens: today the voice counters
// (voice_stt_ms, voice_tts_chars) per org per session, as SEPARATE counters - decided,
// NO token conversion, never folded into the token meter / credit math above. One
// `usage_events` doc per (source, session), upserted so a re-recorded session close is
// idempotent. ONE COHERENT SCHEMA by design: Part D's assistant-turn metering (D6) adds
// a counter key under its own `source` on this same record shape through this same
// function - a new counter never needs a new ledger concept or a migration.
// ---------------------------------------------------------------------------

export interface UsageCountersInput {
  /** Org attribution, from the VERIFIED token of the session - never client-supplied. */
  orgId: string;
  /** User attribution, from the verified token (token_events' billee naming). */
  billeeUserId: string;
  sessionId: string;
  /** Producing surface: 'voice' today; D6 adds its own. */
  source: string;
  /** Canonical counter name -> amount. Non-finite / non-positive entries are dropped. */
  counters: Record<string, number>;
  /** injectable clock for tests; default Date.now() */
  now?: number;
}

/** Record one session's non-token usage counters. Returns { recorded: false } when no
 *  counter survives sanitisation (a zero-usage session writes no ledger row). */
export async function recordUsageCounters(e: UsageCountersInput): Promise<{ recorded: boolean }> {
  const counters: Record<string, number> = {};
  for (const [name, amount] of Object.entries(e.counters)) {
    if (Number.isFinite(amount) && amount > 0) counters[name] = Math.round(amount);
  }
  if (Object.keys(counters).length === 0) return { recorded: false };
  await usageEvents.put({
    // Org-scoped key: server-minted session ids do not collide across orgs, but keying by
    // org too keeps per-org idempotency correct by construction (a reused id can never
    // overwrite another org's usage row).
    _id: `${e.source}:${e.orgId}:${e.sessionId}`,
    orgId: e.orgId,
    billeeUserId: e.billeeUserId,
    sessionId: e.sessionId,
    source: e.source,
    counters,
    timestamp: e.now ?? Date.now(),
  });
  return { recorded: true };
}
