/**
 * tools/tier2/index.ts — the Tier-2 (automation) registry. DELIBERATELY SEPARATE from the Tier-1
 * file-tool vocabulary (`src/tools/registry.ts`): the two registries are never merged, so a file-tier
 * delegation cannot reach bash/browser (its TaskProgram schema has no such step → S3 refusal), which
 * is the structural half of ADR-002. This module exists only for the automation task type, which is
 * off by default and per-session enabled.
 *
 * BUILD-ONLY this run: exported for the automation task path + its smoke tests; excluded from the
 * custody map, the trust chip, and every user-facing claim (the publish gate blocks automation copy).
 */
import { bash } from './bash.js';
import { browse } from './browser.js';

export { bash, bashArgv } from './bash.js';
export type { BashOptions, BashArgvOptions, BashResult } from './bash.js';
export { browse } from './browser.js';
export type { BrowseOptions, BrowseResult } from './browser.js';
export { AutomationEnablement, Tier2Error, ledgerAutomation } from './context.js';
export type { Tier2Context } from './context.js';

/** The Tier-2 vocabulary — bash + browser only. NEVER merged with the Tier-1 registry. */
export const tier2Registry = {
  bash,
  browser: browse,
} as const;

export const TIER2_TOOL_NAMES = ['bash', 'browser'] as const;
