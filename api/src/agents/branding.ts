/**
 * White-label redaction for the thinking channel (ch12). The EKOA persona (context.ts) governs
 * what the model SAYS, but not what it THINKS — working commentary freely self-identifies as
 * the engine ("I'm Claude Sonnet, deployed as..."), so the run pipeline redacts every
 * thinking_chunk before it reaches the wire. Answers keep the existing posture (persona as
 * primary enforcement, client-side net in web/lib/sanitize-error.ts); keep this replacement
 * list in sync with `redactProviderIdentity` there.
 */

/** Redact engine-identifying terms to the EKOA brand, keeping the sentence intact. */
export function redactEngineIdentity(text: string): string {
  if (!text) return '';
  return text
    // "Claude 4.6" / "Claude Sonnet" / "Claude" -> the brand (keep the sentence intact)
    .replace(/\bClaude(\s+(?:\d[\d.]*|Sonnet|Opus|Haiku|Instant))?\b/gi, () => 'Agente EKOA')
    .replace(/\bAnthropic\b/gi, () => 'EKOA')
    // a bare model-family name left dangling (e.g. "… / Sonnet") -> generic
    .replace(/\b(?:Sonnet|Opus|Haiku)\b/gi, () => 'EKOA');
}

/**
 * Streaming variant for chunked channels. A per-chunk regex pass would let a term straddling a
 * chunk boundary through in halves ("…Claude Son" + "net…") — neither half matches, both reach
 * the wire, and the client reassembles the name. Defence (mirrors the markers.ts §5.7.2 shape):
 * redact the WHOLE accumulated buffer first — so a complete term can never be split by the
 * release slice — then hold back the trailing HOLD chars, which is where a PARTIAL term (its
 * remainder still arriving) can live; the next push completes and redacts it in place. Emitted
 * text is therefore always a prefix of a fully-redacted buffer. `end()` flushes the tail.
 */
const REDACT_HOLD_BACK = 23; // ≥ longest partial engine term a chunk boundary can leave behind

export class StreamingIdentityRedactor {
  private buffer = '';

  /** Feed one chunk; returns the redacted text safe to emit now. */
  push(chunk: string): string {
    if (chunk) this.buffer = redactEngineIdentity(this.buffer + chunk);
    if (this.buffer.length <= REDACT_HOLD_BACK) return '';
    const emit = this.buffer.slice(0, this.buffer.length - REDACT_HOLD_BACK);
    this.buffer = this.buffer.slice(this.buffer.length - REDACT_HOLD_BACK);
    return emit;
  }

  /** Flush the held-back tail, redacted. */
  end(): string {
    const out = redactEngineIdentity(this.buffer);
    this.buffer = '';
    return out;
  }
}
