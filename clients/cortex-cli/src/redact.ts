/**
 * Secret scrubbing for anything this process is about to PRINT.
 *
 * The threat is not the server: it is a message built from bytes we did not author. Two real
 * paths carry the caller's key into a human-readable string:
 *
 *  1. An origin that reflects request headers in its error body. `CORTEX_BASE_URL` is caller
 *     supplied and deliberately unvalidated, so a typo'd or hostile origin gets the
 *     `Authorization: Bearer <key>` header on the FIRST call and can echo it straight back; the
 *     wrapper then quotes that body into a non-envelope error message.
 *  2. undici's own header validation, which QUOTES THE REJECTED VALUE in its error message - so a
 *     key with an interior newline (a line-wrapped secret, a CRLF from a Windows-authored env
 *     file) prints verbatim in a network error.
 *
 * From an error message it reaches stderr, and from stderr the agent transcript, CI logs and
 * journald. So: redact BY VALUE, wherever the value appears and in whatever position - never by
 * looking for the word "Bearer", which finds only the shape we happened to imagine.
 */

/** What a redacted secret is replaced with. Fixed length: it must not leak the secret's length. */
export const REDACTED = '<redacted>';

/**
 * Defence in depth ONLY. Catches a gateway key that is not the one we hold (another tenant's key
 * reflected by a shared proxy, a key in a server-side log line). The by-value pass above is the
 * mechanism; this is a net under it.
 */
const GATEWAY_KEY_SHAPE = /ekoa_gk_[A-Za-z0-9_-]{4,}/g;

/** Secrets shorter than this are ignored: redacting them would mangle ordinary text. */
const MIN_SECRET_LENGTH = 8;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a scrubber for a fixed set of secrets. Each secret is matched in two spellings: raw, and
 * JSON-escaped - a reflected body quotes the header value inside JSON, so a key containing a
 * newline appears there as `\n`, which the raw form would miss.
 */
export function makeRedactor(...secrets: ReadonlyArray<string | undefined>): (text: string) => string {
  const spellings = new Set<string>();
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_SECRET_LENGTH) continue;
    spellings.add(secret);
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) spellings.add(escaped);
  }
  const patterns = [...spellings].map((s) => new RegExp(escapeRegExp(s), 'g'));

  return (text: string): string => {
    let out = text;
    for (const pattern of patterns) out = out.replace(pattern, REDACTED);
    return out.replace(GATEWAY_KEY_SHAPE, REDACTED);
  };
}

/** Scrub a structured value by round-tripping it through the string form. */
export function redactValue<T>(redact: (text: string) => string, value: T): T {
  if (value === undefined) return value;
  const serialised = JSON.stringify(value);
  if (serialised === undefined) return value;
  return JSON.parse(redact(serialised)) as T;
}
