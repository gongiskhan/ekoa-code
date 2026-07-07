/**
 * The pre-run allowance gate (ch06 §6.6.3). A period-budget admission check: it runs BEFORE a
 * model call is admitted and answers "does this user have budget left this period?". It is
 * pre-run only — a run admitted under its allowance may finish even if it crosses the limit
 * mid-run; there is no mid-run kill (carried).
 *
 * The activation checks (ACCOUNT_DISABLED/BILLING_LOCKED) precede this at every entry and are
 * owned by auth/ (ch09) — this gate does NOT duplicate them.
 *
 * Two forms: a callable `checkAllowance` (for run-creating entries that surface a block as a
 * terminal stream error) and an Express `allowanceMiddleware` (for synchronous request/response
 * entries that return the 402 error envelope).
 */
import type { Request, Response, NextFunction } from 'express';
import { billingAccounts } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import {
  applyLazyReset,
  baseFor,
  creditTokensOf,
  ensureAccount,
  overagePermitted,
  readGlobalOverageEnabled,
  type BillingAccountDoc,
} from './tracker.js';
import { BILLING_PAGE_URL, BLOCKED_MESSAGE } from './constants.js';

export interface AllowanceVerdict {
  ok: boolean;
  message?: string;
  billingUrl?: string;
}

/**
 * Pre-run admission (§6.6.3). Blocked → { ok:false, message:<PT-PT>, billingUrl }.
 * A read that observes a crossed period boundary persists the lazy reset (§6.6.2).
 */
export async function checkAllowance(userId: string, now?: number): Promise<AllowanceVerdict> {
  const clock = now ?? Date.now();
  const acct = await ensureAccount(userId, clock);
  const reset = applyLazyReset(acct, clock);
  // Persist the zeroing so a read is a genuine reset point, not just a view (§6.6.2).
  if (reset.didReset) {
    await billingAccounts.update(userId, (curDoc) => {
      const cur = curDoc as BillingAccountDoc;
      const r = applyLazyReset(cur, clock);
      return { ...cur, monthlyBaseTokensUsed: r.used, currentPeriodStart: r.periodStart } as BillingAccountDoc as unknown as Doc;
    });
  }

  const used = reset.used;
  const base = baseFor(acct);
  const remaining = Math.max(0, base - used);
  if (remaining > 0) return { ok: true };

  // Base exhausted. Spending past base needs all three overage switches (§6.6.2).
  const globalOverage = await readGlobalOverageEnabled();
  if (overagePermitted(acct.overageEnabled, globalOverage)) {
    const effectiveTotal = base + creditTokensOf(acct.creditBalanceUsd);
    if (used < effectiveTotal) return { ok: true };
  }
  return { ok: false, message: BLOCKED_MESSAGE, billingUrl: BILLING_PAGE_URL };
}

interface AuthedLike extends Request {
  user?: { sub: string };
}

/**
 * Express allowance gate for SYNCHRONOUS request/response entries (§6.6.3): the integration-
 * builder chat route, served-app assistant chat, and gateway messages. A block returns the
 * ch03 error envelope with code BILLING_BLOCKED and HTTP 402. Mount AFTER requireAuth (which
 * populates `req.user` and runs the activation checks first).
 */
export function allowanceMiddleware(getUserId: (req: Request) => string | undefined = defaultUserId) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = getUserId(req);
    if (!userId) {
      next();
      return;
    }
    checkAllowance(userId)
      .then((verdict) => {
        if (verdict.ok) {
          next();
          return;
        }
        res.status(402).json({
          error: {
            code: 'BILLING_BLOCKED',
            message: verdict.message ?? BLOCKED_MESSAGE,
            details: { billingUrl: verdict.billingUrl ?? BILLING_PAGE_URL },
          },
        });
      })
      .catch((err) => next(err));
  };
}

function defaultUserId(req: Request): string | undefined {
  return (req as AuthedLike).user?.sub;
}
