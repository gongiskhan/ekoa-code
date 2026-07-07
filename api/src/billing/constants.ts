/**
 * Billing constants (ch06 §6.2.3, §6.5.2, §6.6.2). Config/env-overridable knobs for the
 * metering formula and the bill arithmetic, plus the fixed UI thresholds and the PT-PT
 * block message. The internal currency is metered tokens (§6.6).
 *
 * The knobs are read from env into a mutable config holder at first load and are genuinely
 * runtime-overridable (per §6.2.3/§6.6.2): weights and the cache factor are snapshotted onto
 * each ledger event at write time (tracker.ts), so changing them never re-writes history
 * (§6.5.2). Tests override deterministically via `__setBillingConfigForTests`.
 */

import { loadConfig, type LlmConfig } from '../config.js';

export type Tier = 'FAST' | 'WORKHORSE' | 'EXPERT';

export interface BillingConfig {
  periodDays: number;
  creditTokensPerUsd: number;
  platformDefaultBase: number;
  /** Hard-limit launch flag (P-20): ships default ON — blocks all spend past base regardless of
   *  credits/overage until the founder flips it off when paid overage goes live. */
  hardLimit: boolean;
  warningThreshold: number;
}

function num(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[billing] ${envName}=${raw} is not a non-negative number; using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

function flag(envName: string, fallback: boolean): boolean {
  const raw = process.env[envName];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function fromEnv(): BillingConfig {
  return {
    periodDays: num('EKOA_BILLING_PERIOD_DAYS', 30),
    creditTokensPerUsd: num('EKOA_BILLING_CREDIT_TOKENS_PER_USD', 100_000),
    platformDefaultBase: num('EKOA_BILLING_BASE_TOKENS', 10_000_000),
    hardLimit: flag('EKOA_BILLING_HARD_LIMIT', true),
    warningThreshold: num('EKOA_BILLING_WARNING_THRESHOLD', 0.85),
  };
}

let cfg: BillingConfig = fromEnv();

export function billingConfig(): BillingConfig {
  return cfg;
}
export function periodMs(): number {
  return cfg.periodDays * 24 * 60 * 60 * 1000;
}

/** The tier weights + cache-read factor are single-sourced from config.ts's `llm` block
 *  (ch06 §6.2.3: "weights live in config.ts") so the chokepoint's routing config and the bill
 *  never diverge. The metering call snapshots the weight onto each ledger event (§6.5.2). */
function llm(): LlmConfig {
  return loadConfig().llm;
}
export function tierWeight(tier: Tier): number {
  const t = llm().tiers[tier];
  if (t === undefined) throw new Error(`[billing] unknown tier: ${tier as string}`);
  return t.weight;
}
export function cacheReadFactor(): number {
  return llm().cacheReadFactor;
}

/** Test-only overrides for the env-overridable knobs (matches the repo `__*ForTests` pattern). */
export function __setBillingConfigForTests(patch: Partial<BillingConfig>): void {
  cfg = { ...cfg, ...patch };
}
export function __resetBillingConfigForTests(): void {
  cfg = fromEnv();
}

/** Gauge color thresholds (fractions of base), carried from the current surface. */
export const GAUGE_THRESHOLDS = { green: 0.7, amber: 0.85 } as const;

/** Billing page URL carried into every block payload (§6.6.3). */
export const BILLING_PAGE_URL = '/settings/billing';

/** The localized PT-PT block message the current UI expects (§6.6.3). */
export const BLOCKED_MESSAGE =
  'Limite de utilização atingido. Fale com o administrador ou aguarde o início do próximo período.';

export function gaugeColor(fraction: number): 'green' | 'amber' | 'red' {
  if (fraction < GAUGE_THRESHOLDS.green) return 'green';
  if (fraction < GAUGE_THRESHOLDS.amber) return 'amber';
  return 'red';
}
