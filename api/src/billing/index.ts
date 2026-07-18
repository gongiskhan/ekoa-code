/**
 * billing/ public entry (ch02 §2.6, ch06). The token-denominated billing domain: the single
 * metering/ledger writer (tracker), the pre-run allowance gate, the chokepoint rate/spend caps,
 * and the derived REST views + admin ops (service). `llm/` consumes `recordTokenEvent`,
 * `checkAllowance`, `checkRateCaps`/`recordSpend`; routes/ consumes the service.
 */
export {
  recordTokenEvent,
  recordUsageCounters,
  computeMetered,
  setUsageNotifier,
  setPlatformBilleeResolver,
  resolvePlatformBillee,
  readGlobalOverageEnabled,
  writeGlobalOverageEnabled,
  type TokenEventInput,
  type UsageCountersInput,
  type AttributionKind,
  type Tier,
  type BillingAccountDoc,
} from './tracker.js';

export { checkAllowance, allowanceMiddleware, type AllowanceVerdict } from './allowance.js';

export {
  RateLimiter,
  checkRateCaps,
  recordSpend,
  defaultRateCapConfig,
  type RateCapConfig,
  type RateCapVerdict,
  type RateCapKey,
} from './rate-caps.js';

export {
  usageFor,
  historyFor,
  breakdownFor,
  addCredits,
  setOverage,
  setGlobalOverage,
  adminListUsage,
  adminResetUsage,
  adminSetLimit,
} from './service.js';
