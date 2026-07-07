/**
 * llm/router.ts — deterministic tier selection (ch06 §6.2, §6.2.3).
 *
 * Pure code: complexity hints, tier floors, file-count and keyword scoring, default FAST.
 * NO model call. Ported from the old zero-import tier classifier (carryover-audit A11,
 * `llm-router.ts`) with three deliberate changes fixed by ch06:
 *   - The old REASONING_LIGHT tier is RETIRED with its only caller (§6.4.3 site 22); the
 *     rebuild has exactly three tiers FAST/WORKHORSE/EXPERT (§6.2.3).
 *   - The dead `escalate()` export and the never-passed `previousFailures` input are NOT
 *     carried (§6.2, conflict 6).
 *   - Model ids + billing weights + `effort` live in config.ts (`config.llm.tiers`), never
 *     hardcoded here; tier configs carry `effort` ONLY (thinking budgets were dead on the
 *     wire — conflict 5).
 *
 * The scoring keeps four internal keyword buckets (the old T1..T4 sets, ported verbatim so
 * the classification assertions hold) but collapses the retired middle bucket onto FAST:
 * bucket levels map 1->FAST, 2->FAST, 3->WORKHORSE, 4->EXPERT.
 */
import { loadConfig, type LlmTierConfig } from '../config.js';

/** The three execution tiers (ch06 §6.2.3). String union so it is structurally identical to
 *  `billing/`'s `Tier` and rides the metering call without a mapping table. */
export type Tier = 'FAST' | 'WORKHORSE' | 'EXPERT';

export const TIERS: readonly Tier[] = ['FAST', 'WORKHORSE', 'EXPERT'] as const;

/** Ordinal for floor comparisons (higher = stronger/costlier). */
const TIER_ORDER: Record<Tier, number> = { FAST: 1, WORKHORSE: 2, EXPERT: 3 };

/** Optional context passed to the classifier to influence tier selection. The old
 *  `isCodeGen` (dead integration-builder flag, conflict 9) and `previousFailures` (never
 *  passed, conflict 6) inputs are NOT carried. */
export interface ClassificationContext {
  /** Explicit complexity hint from the calling agent (overrides keyword analysis). */
  complexityHint?: 'trivial' | 'low' | 'medium' | 'high' | 'critical';
  /** Number of files the task is expected to touch. */
  estimatedFileCount?: number;
  /** Estimated output length in tokens (rough hint). */
  estimatedOutputTokens?: number;
}

/** Everything a chokepoint entry needs to issue a call. There is NO default: a missing
 *  decision is a compile error at the call site, not an expensive Opus fallback (§6.2.1,
 *  conflict 13). */
export interface RouterDecision {
  tier: Tier;
  model: string;
  effort: LlmTierConfig['effort'];
  weight: number;
}

// --- Keyword sets (ported verbatim from the old classifier) ---------------------------

/** Tier-1 (fast lookup / classification) verbs+nouns. */
const TIER1_KEYWORDS = new Set([
  'classify', 'route', 'detect', 'match', 'lookup', 'parse', 'validate',
  'extract', 'format', 'convert', 'list', 'filter', 'sort', 'count',
  'intent', 'label', 'tag', 'category', 'status', 'check',
]);

/** Tier-2 (light reasoning). Retired REASONING_LIGHT bucket — scores collapse onto FAST. */
const TIER2_KEYWORDS = new Set([
  'plan', 'configure', 'orchestrate', 'decide', 'evaluate', 'recommend',
  'summarize', 'explain', 'compare', 'assess', 'prioritize', 'diagnose',
  'triage', 'merge', 'resolve', 'respond', 'answer', 'fallback',
]);

/** Tier-3 (small fixes, single-file edits). */
const TIER3_KEYWORDS = new Set([
  'edit', 'fix', 'code', 'function', 'endpoint', 'handler',
  'script', 'test', 'migrate', 'transform', 'tweak', 'adjust',
  'rename', 'move', 'update', 'change', 'patch',
  // Deliverable nouns: producing one of these FROM data/a file is generation, never a FAST
  // lookup (a quote/proposal is at minimum a WORKHORSE document). Biases up on the rare
  // keyword-fallback path (PT-Brazil-facing product; EN + PT). A false escalation costs
  // only $/latency; a false demotion ruins the output.
  'quote', 'quotation', 'proposal', 'invoice',
  'cotação', 'cotacao', 'cotações', 'cotacoes',
  'proposta', 'propostas', 'orçamento', 'orcamento', 'fatura',
]);

/** Tier-4 (builds, features, complex tasks). */
const TIER4_KEYWORDS = new Set([
  'build', 'template', 'implement',
  'dashboard', 'application', 'feature', 'integration', 'deploy',
  'refactor', 'architect', 'redesign', 'debug complex', 'multi-file',
  'cross-file', 'deep analysis', 'novel', 'complex', 'critical',
  'security audit',
]);

/** Ambiguous verbs: a lone hit is usually a small single-file task, so they score T3, not
 *  T4 (they still reach T4 via multi-word patterns or when combined with other T4 signals). */
const TIER3_AMBIGUOUS = new Set([
  'create', 'generate', 'component', 'design', 'performance',
  'optimise', 'optimize', 'write',
]);

/** Demotion markers — cap the tier at WORKHORSE. Deliberately conservative (context-blind
 *  matching): a false demotion stranding heavy work on Haiku hurts more than a miss. */
const DEMOTION_KEYWORDS = new Set([
  'just', 'simple', 'small', 'quick', 'trivial', 'tiny', 'minor', 'little',
]);

/** Map an internal keyword level (1..4) to a public tier — the retired level-2 collapses onto
 *  FAST (Haiku either way, as the old REASONING_LIGHT was Haiku + a dead thinking budget). */
function levelToTier(level: 1 | 2 | 3 | 4): Tier {
  return level === 4 ? 'EXPERT' : level === 3 ? 'WORKHORSE' : 'FAST';
}

/**
 * Classify a task description into a tier. Priority order:
 *   1. Explicit complexityHint from the caller
 *   2. Estimated file count heuristic
 *   3. Keyword analysis of the task description
 *   4. Default to FAST
 */
export function classify(taskDescription: string, context?: ClassificationContext): Tier {
  // 1. Explicit complexity hint takes precedence.
  if (context?.complexityHint) {
    switch (context.complexityHint) {
      case 'trivial': return 'FAST';
      case 'low': return 'FAST';        // retired REASONING_LIGHT collapses onto FAST
      case 'medium': return 'WORKHORSE';
      case 'high':
      case 'critical': return 'EXPERT';
    }
  }

  // 2. File-count heuristic.
  if (context?.estimatedFileCount) {
    if (context.estimatedFileCount > 5) return 'EXPERT';
    if (context.estimatedFileCount > 1) return 'WORKHORSE';
  }

  // 3. Keyword analysis.
  const lower = taskDescription.toLowerCase();
  const words = lower.split(/\s+/);
  const scores: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  let hasDemotion = false;
  for (const word of words) {
    if (DEMOTION_KEYWORDS.has(word)) hasDemotion = true;
    if (TIER1_KEYWORDS.has(word)) scores[1]++;
    if (TIER2_KEYWORDS.has(word)) scores[2]++;
    if (TIER3_KEYWORDS.has(word)) scores[3]++;
    if (TIER3_AMBIGUOUS.has(word)) scores[3]++; // ambiguous verbs score T3, not T4
    if (TIER4_KEYWORDS.has(word)) scores[4]++;
  }

  // Multi-word T4 patterns (e.g. "security audit", "multi-file") count double.
  for (const pattern of TIER4_KEYWORDS) {
    if (pattern.includes(' ') && lower.includes(pattern)) scores[4] += 2;
  }

  // Large-output hints nudge toward higher tiers.
  if (context?.estimatedOutputTokens && context.estimatedOutputTokens > 2000) scores[3]++;
  if (context?.estimatedOutputTokens && context.estimatedOutputTokens > 8000) scores[4]++;

  // Pick the highest-scoring level (ties broken toward the cheapest / lowest level).
  let bestLevel: 1 | 2 | 3 | 4 = 1;
  let bestScore = 0;
  for (const level of [1, 2, 3, 4] as const) {
    if (scores[level] > bestScore) { bestScore = scores[level]; bestLevel = level; }
  }

  let tier = levelToTier(bestLevel);

  // A single T4 keyword hit is not enough for EXPERT: a lone build/refactor verb is a
  // WORKHORSE (Sonnet) task, never a Haiku one — floor it at WORKHORSE.
  if (tier === 'EXPERT' && scores[4] < 2) tier = 'WORKHORSE';

  // Demotion: "just"/"simple"/etc cap even a strong build at WORKHORSE.
  if (hasDemotion && TIER_ORDER[tier] > TIER_ORDER.WORKHORSE) tier = 'WORKHORSE';

  return tier;
}

/** Resolve a full `RouterDecision` from config for a chosen tier. */
export function decideForTier(tier: Tier): RouterDecision {
  const cfg = loadConfig().llm.tiers[tier];
  return { tier, model: cfg.model, effort: cfg.effort, weight: cfg.weight };
}

/**
 * Classify a task and return a complete `RouterDecision`. `minTier` applies a floor (e.g.
 * WORKHORSE for chat, EXPERT for builds) — the caller's tier can only be raised, never lowered.
 */
export function decideForTask(
  taskDescription: string,
  context?: ClassificationContext,
  minTier?: Tier,
): RouterDecision {
  let tier = classify(taskDescription, context);
  if (minTier && TIER_ORDER[tier] < TIER_ORDER[minTier]) tier = minTier;
  return decideForTier(tier);
}
