/**
 * Billing read service (ch03 §3.8.21). Owns the `billing_accounts`/`token_events` store
 * access for the billing router (routes/ never touches data/ — ch02 §2.7).
 */
import { billingAccounts, tokenEvents } from '../data/stores.js';

export async function usageFor(userId: string) {
  const acct = (await billingAccounts.get(userId)) ?? {};
  return {
    monthlyBaseTokensUsed: (acct as { monthlyBaseTokensUsed?: number }).monthlyBaseTokensUsed ?? 0,
    creditBalanceUsd: (acct as { creditBalanceUsd?: number }).creditBalanceUsd ?? 0,
    overageEnabled: (acct as { overageEnabled?: boolean }).overageEnabled ?? false,
  };
}

export async function historyFor(userId: string) {
  const rows = await tokenEvents.find({ userId }, { timestamp: -1 });
  return { items: rows, total: rows.length };
}
