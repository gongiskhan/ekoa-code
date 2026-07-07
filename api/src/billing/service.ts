/**
 * Billing read/write service (ch03 §3.8.21, ch06 §6.6). Owns the `billing_accounts`/`token_events`
 * store access for the billing router (routes/ never touches data/ — ch02 §2.7). The metering
 * WRITE path is the tracker (§6.5); this service holds the derived views (usage, breakdown,
 * history) and the account/admin mutations (credits, overage, per-user limits + reset).
 */
import { billingAccounts, tokenEvents } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import {
  applyLazyReset,
  baseFor,
  creditTokensOf,
  ensureAccount,
  overagePermitted,
  readGlobalOverageEnabled,
  writeGlobalOverageEnabled,
  type BillingAccountDoc,
} from './tracker.js';
import { billingConfig, periodMs, gaugeColor } from './constants.js';

/** Load the account, applying (and persisting) the lazy period reset if a boundary was crossed. */
async function loadWithReset(userId: string, now: number): Promise<BillingAccountDoc> {
  const acct = await ensureAccount(userId, now);
  const reset = applyLazyReset(acct, now);
  if (!reset.didReset) return acct;
  const updated = await billingAccounts.update(userId, (curDoc) => {
    const cur = curDoc as BillingAccountDoc;
    const r = applyLazyReset(cur, now);
    return { ...cur, monthlyBaseTokensUsed: r.used, currentPeriodStart: r.periodStart } as BillingAccountDoc as unknown as Doc;
  });
  return (updated as BillingAccountDoc | null) ?? { ...acct, monthlyBaseTokensUsed: 0, currentPeriodStart: now };
}

/**
 * The derived GET /billing/usage view (§6.6.2). Satisfies the shared `BillingUsage` schema
 * (tokensUsed/tokenLimit/balanceUsd/overageEnabled) and carries the full gauge surface the
 * current UI renders (reference/operations-inventory §20).
 */
export async function usageFor(userId: string, now: number = Date.now()) {
  const acct = await loadWithReset(userId, now);
  const globalOverage = await readGlobalOverageEnabled();
  const used = acct.monthlyBaseTokensUsed;
  const base = baseFor(acct);
  const remaining = Math.max(0, base - used);
  const creditTokens = creditTokensOf(acct.creditBalanceUsd);
  const permitted = overagePermitted(acct.overageEnabled, globalOverage);
  const effectiveTotal = base + (permitted ? creditTokens : 0);
  const fraction = base > 0 ? used / base : 1;
  return {
    // shared BillingUsage (required)
    tokensUsed: used,
    tokenLimit: acct.tokenLimit,
    balanceUsd: acct.creditBalanceUsd,
    overageEnabled: acct.overageEnabled,
    // derived view (ops-inventory §20 gauge surface)
    tokensBase: base,
    tokensRemaining: remaining,
    effectiveTotal,
    usagePercentage: fraction,
    percentage: Math.round(fraction * 100),
    creditBalanceUsd: acct.creditBalanceUsd,
    creditTokens,
    globalOverageEnabled: globalOverage,
    overagePermitted: permitted,
    currentPeriodStart: new Date(acct.currentPeriodStart).toISOString(),
    periodResetDate: new Date(acct.currentPeriodStart + periodMs()).toISOString(),
    gaugeColor: gaugeColor(fraction),
    showWarning: fraction >= billingConfig().warningThreshold,
  };
}

/**
 * GET /billing/history (§3.8.21). The user's ledger events as transaction rows validating the
 * shared `BillingHistoryEntry` shape. Newest first; paginated by the router.
 */
export async function historyFor(userId: string, opts: { limit?: number; offset?: number } = {}) {
  const rows = (await tokenEvents.find({ billeeUserId: userId }, { timestamp: -1 })) as Array<
    Doc & { agentType?: string; metered?: number; timestamp?: number }
  >;
  const total = rows.length;
  const offset = opts.offset ?? 0;
  const page = rows.slice(offset, offset + (opts.limit ?? total));
  const items = page.map((e) => ({
    id: e._id,
    type: e.agentType ?? 'unknown',
    amountUsd: 0,
    createdAt: new Date(e.timestamp ?? 0).toISOString(),
    description: `${e.metered ?? 0} tokens`,
    tokens: e.metered ?? 0,
  }));
  return { items, total };
}

/**
 * GET /billing/breakdown (§3.8.21, super-admin): group the ledger by `agentType` (§6.3 rule 4).
 * Platform-wide across all billees, matching the super-admin usage page the endpoint mounts on.
 */
export async function breakdownFor() {
  const rows = (await tokenEvents.find({})) as Array<Doc & { agentType?: string; metered?: number }>;
  const byAgent = new Map<string, number>();
  let total = 0;
  for (const e of rows) {
    const m = e.metered ?? 0;
    byAgent.set(e.agentType ?? 'unknown', (byAgent.get(e.agentType ?? 'unknown') ?? 0) + m);
    total += m;
  }
  const items = Array.from(byAgent.entries())
    .map(([agentType, tokens]) => ({ agentType, tokens, percentage: total > 0 ? (tokens / total) * 100 : 0 }))
    .sort((a, b) => b.tokens - a.tokens);
  return { items };
}

/** POST /billing/credits: increment the user's credit balance (§6.6.2). */
export async function addCredits(userId: string, amountUsd: number, now: number = Date.now()) {
  await ensureAccount(userId, now);
  const updated = await billingAccounts.update(userId, (curDoc) => {
    const cur = curDoc as BillingAccountDoc;
    return { ...cur, creditBalanceUsd: cur.creditBalanceUsd + amountUsd } as BillingAccountDoc as unknown as Doc;
  });
  const newBalance = (updated as BillingAccountDoc | null)?.creditBalanceUsd ?? amountUsd;
  return { success: true, newBalance };
}

/** PUT /billing/overage: the user's own overage toggle (§6.6.2, one of the three switches). */
export async function setOverage(userId: string, enabled: boolean, now: number = Date.now()) {
  await ensureAccount(userId, now);
  await billingAccounts.update(userId, (curDoc) => ({ ...(curDoc as BillingAccountDoc), overageEnabled: enabled }) as unknown as Doc);
  return { overageEnabled: enabled };
}

/** PUT /billing/admin/overage: the admin global overage kill-switch (§6.6.2). */
export async function setGlobalOverage(enabled: boolean) {
  const globalOverageEnabled = await writeGlobalOverageEnabled(enabled);
  return { globalOverageEnabled };
}

/** GET /billing/admin/usage: per-user rows (§6.6.2). Reset-aware display (does not persist). */
export async function adminListUsage(now: number = Date.now()) {
  const rows = (await billingAccounts.find({})) as BillingAccountDoc[];
  const items = rows.map((acct) => {
    const { used } = applyLazyReset(acct, now);
    return {
      userId: acct._id,
      tokensUsed: used,
      tokenLimit: acct.tokenLimit ?? null,
      balanceUsd: acct.creditBalanceUsd,
      overageEnabled: acct.overageEnabled,
    };
  });
  return { items };
}

/** POST /billing/admin/usage/:userId/reset: zero the meter + advance the period (§6.6.2). */
export async function adminResetUsage(userId: string, now: number = Date.now()) {
  await ensureAccount(userId, now);
  await billingAccounts.update(userId, (curDoc) => ({
    ...(curDoc as BillingAccountDoc),
    monthlyBaseTokensUsed: 0,
    currentPeriodStart: now,
  }) as unknown as Doc);
  return { userId, tokensUsed: 0 };
}

/** PUT /billing/admin/limits/:userId: set (or clear → null = platform default) the base (§6.6.2). */
export async function adminSetLimit(userId: string, tokenLimit: number | null, now: number = Date.now()) {
  await ensureAccount(userId, now);
  await billingAccounts.update(userId, (curDoc) => ({ ...(curDoc as BillingAccountDoc), tokenLimit }) as unknown as Doc);
  return { userId, tokenLimit };
}
