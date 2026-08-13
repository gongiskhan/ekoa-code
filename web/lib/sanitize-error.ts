/**
 * User-facing error text, derived from a CODE — never from what the server said.
 *
 * HISTORY, because the posture changed and the reason matters. This module used to be a
 * DENYLIST: `sanitizeUserFacingError(text)` scanned a server-supplied string for provider-leak
 * markers (the engine's name, the vendor's name, 'oauth token', ...) and replaced it only on a
 * hit. On 2026-08-10 a user who asked the agent to build a website was answered, in the agent's
 * own message bubble, with:
 *
 *   "credential expired and refresh failed: OAuth refresh not configured
 *    (LLM_OAUTH_REFRESH_URL + stored refresh token required)"
 *
 * That string matches none of the markers, so the denylist passed it straight through. The
 * lesson is not "add a marker" — a denylist is open by construction, and every future internal
 * string is one nobody has added yet.
 *
 * THE POSTURE NOW: the server's terminal `error` event carries a `code` (`RunErrorCode` in
 * `shared/run-errors.ts`) and, for the few legitimately dynamic values, structured `params`.
 * The UI renders `runErrorMessage(code, locale, params)` and NEVER renders the event's
 * `message`. An unrecognised code degrades to UNKNOWN's generic branded text. Unknown input
 * therefore fails CLOSED: the worst case is a message that is too generic, never one that
 * exposes internals.
 *
 * `sanitizeUserFacingError` survives for the paths that genuinely only have a string (a locally
 * composed message, a fetch/transport failure with no code). It is defence in depth for those,
 * not the primary control. If you are reaching for it with a code in hand, use
 * `runErrorMessage` instead.
 */

import { runErrorText, isRetryableRunError } from '@ekoa/shared';

const PROVIDER_LEAK_MARKERS: readonly string[] = [
  'claude',
  // The leak DENYLIST needle — it keeps the provider name OUT of the UI. Product code, but
  // enforcement, not consumption: removing it would disable the client-side provider-leak
  // sentinel, i.e. weaken the very invariant the chokepoint gate exists to protect.
  'anthropic', // chokepoint-gate-allow
  'does not have access to claude',
  'organization does not have access',
  'please login again or contact your administrator',
  'api error:',
  'authentication_error',
  'invalid authentication credentials',
  'oauth token',
  'claude_code_oauth_token',
  // Added after the 2026-08-10 leak. These do NOT make the denylist sufficient — the code-first
  // path above is what makes it safe — but they harden the string-only fallback against the
  // shape of internal diagnostics we now know can reach it: env-var names, credential/token
  // vocabulary, and refresh plumbing.
  'credential',
  'refresh token',
  'refresh failed',
  'llm_',
  'process.env',
  'econnrefused',
  'enotfound',
  'stack trace',
  '    at ', // a stack frame's indentation
];

export function looksLikeProviderLeak(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return PROVIDER_LEAK_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * White-label a SUCCESSFUL assistant reply (ch12): redact engine-identifying terms to the EKOA
 * brand rather than destroying the whole answer. The provider persona (api/src/agents/context.ts)
 * is the primary enforcement; this is the client-side safety net for when the model self-identifies
 * anyway. NEVER use this on error text — that path uses `runErrorMessage`, which builds the whole
 * message from a code.
 */
export function redactProviderIdentity(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    // "Claude 4.6" / "Claude Sonnet" / "Claude" -> the brand (keep the sentence intact)
    .replace(/\bClaude(\s+(?:\d[\d.]*|Sonnet|Opus|Haiku|Instant))?\b/gi, () => 'Agente EKOA')
    .replace(/\bAnthropic\b/gi, () => 'EKOA')
    // a bare model-family name left dangling (e.g. "… / Sonnet") -> generic
    .replace(/\b(?:Sonnet|Opus|Haiku)\b/gi, () => 'EKOA');
}

export function genericUnavailableMessage(language?: string | null): string {
  return (language || 'pt').toLowerCase().startsWith('en')
    ? 'The EKOA Agent is temporarily unavailable. Please try again in a moment.'
    : 'O Agente EKOA está temporariamente indisponível. Por favor, tente novamente dentro de momentos.';
}

/**
 * THE ONE WAY to turn a terminal run error into text for the user.
 *
 * Takes the event's `code` and `params` and ignores its `message` entirely — that is the whole
 * point. Unknown codes render UNKNOWN's text (see `normalizeRunErrorCode` in shared).
 */
export function runErrorMessage(
  code: string | null | undefined,
  language?: string | null,
  params?: Record<string, string>,
): string {
  return runErrorText(code, language, params);
}

/** Whether to offer a "try again" affordance for this terminal code. */
export function runErrorIsRetryable(code: string | null | undefined): boolean {
  return isRetryableRunError(code);
}

/**
 * Last-resort guard for the paths that have only a string and no code (locally composed
 * messages, transport failures). Returns `text` unless it looks like an internal leak, in which
 * case it returns the generic branded message.
 *
 * Prefer `runErrorMessage`. Anything with a code should not be coming through here.
 */
export function sanitizeUserFacingError(
  text: string | null | undefined,
  language?: string | null,
): string {
  if (!text || looksLikeProviderLeak(text)) return genericUnavailableMessage(language);
  return String(text);
}
