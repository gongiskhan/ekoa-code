/**
 * Client-side defence-in-depth against provider/engine leaks.
 *
 * The backend (cortex/src/sse.ts + error-sanitizer) already strips any
 * provider/model/auth text from error/complete events before they hit the
 * wire. This guard is the second line: it catches anything that bypasses the
 * backend (a future code path, or a replayed/cached event from before the
 * fix) so the end user never sees that the engine is Claude/Anthropic.
 *
 * Keep this list in sync with cortex/src/services/error-sanitizer.ts.
 */

const PROVIDER_LEAK_MARKERS: readonly string[] = [
  'claude',
  'anthropic',
  'does not have access to claude',
  'organization does not have access',
  'please login again or contact your administrator',
  'api error:',
  'authentication_error',
  'invalid authentication credentials',
  'oauth token',
  'claude_code_oauth_token',
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
 * anyway. NEVER use this on error text — that path uses `sanitizeUserFacingError`, which replaces
 * the whole message with a generic branded one.
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
 * Returns `text` unless it looks like an internal provider/auth leak, in which
 * case it returns the generic branded message in the given language.
 */
export function sanitizeUserFacingError(
  text: string | null | undefined,
  language?: string | null,
): string {
  if (!text || looksLikeProviderLeak(text)) return genericUnavailableMessage(language);
  return String(text);
}
