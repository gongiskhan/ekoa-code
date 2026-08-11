/**
 * agents/run-failure.ts — the ONE place a thrown exception becomes a terminal run-error CODE.
 *
 * Why it exists: every run pipeline (chat, build, brand-research) ends in a catch-all, and the
 * tempting one-liner is `finishError('ADAPTER_ERROR', err.message)`. That is exactly how, on
 * 2026-08-10, a user who asked for a website was answered — in the agent's own message bubble —
 * with:
 *
 *   "credential expired and refresh failed: OAuth refresh not configured
 *    (LLM_OAUTH_REFRESH_URL + stored refresh token required)"
 *
 * Classifying instead of echoing buys two things beyond not leaking. It makes the failure
 * HONEST (a dead platform credential is not "try again in a moment" — it is operator-actionable
 * and retry will fail until someone acts), and it makes the retry affordance meaningful, since
 * `RUN_ERROR_RETRYABLE` keys off the code.
 *
 * Detail is not discarded — callers log the original error with the run id. Honest inside,
 * white-labelled outside (ch09 invariant 2).
 */
import type { RunErrorCode } from '@ekoa/shared';
import { CredentialError, LlmAbortedError, LlmRateCapError, LlmTransportError } from '../llm/index.js';

/**
 * Map a thrown value onto the terminal run-error vocabulary.
 *
 * Deliberately structural (instanceof / status), never string-matching on `err.message`:
 * matching on message text is the same fragile denylist thinking that let the leak through,
 * and it would silently reclassify the day a message is reworded.
 *
 * The default is ADAPTER_ERROR — retryable and generic. Anything genuinely terminal must be
 * recognised HERE by its type, so an unrecognised throw degrades to "try again" rather than
 * to a wrong claim about what went wrong.
 */
export function classifyRunFailure(err: unknown): RunErrorCode {
  // Terminal: the platform's model credential is missing, expired, or unrefreshable. Only an
  // operator re-arming it fixes this, so it must not be dressed up as a transient blip.
  if (err instanceof CredentialError) return 'AUTH_ERROR';
  if (err instanceof LlmRateCapError) return 'RATE_LIMITED';
  if (err instanceof LlmAbortedError) return 'TIMEOUT';
  if (err instanceof LlmTransportError) {
    if (err.status === 401 || err.status === 403) return 'AUTH_ERROR';
    if (err.status === 429) return 'RATE_LIMITED';
    return 'PROVIDER_UNAVAILABLE';
  }
  return 'ADAPTER_ERROR';
}
