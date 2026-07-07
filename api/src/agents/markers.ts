/**
 * In-band marker machinery, server-side ONLY (ch05 §5.7.2). The model still signals handoffs
 * and context in-band because the signal originates inside generated text, but ALL parsing is
 * here in the run pipeline and NO marker — partial or whole — may ever reach a `text_chunk`
 * (a contract-test assertion, §5.7.2). The marker vocabulary is a prompt-side contract shipped
 * with the agent context (ch08); the literals below are the server half of that contract.
 *
 * Three signals (carried machinery, reference/invisible-behaviors.md §7.1):
 *   - Build handoff: buffered start-of-stream detection of the build marker → `build_intent` +
 *     `complete.delegate`; the chat run emits no prose.
 *   - Integration-builder handoff: regex strip of the integration marker anywhere in the stream
 *     → `integration_build_intent`; surrounding prose still streams.
 *   - Context blocks `<ekoa-context>…</ekoa-context>`: extracted and persisted server-side,
 *     never streamed; the last valid one wins.
 *
 * Split-marker safety: a tail of (maxMarkerLen − 1) characters is held back on every push, so a
 * marker straddling a chunk boundary is never partially emitted (§5.7.2 tail hold-back).
 */

export const BUILD_MARKER = '[[EKOA_BUILD]]';
export const INTEGRATION_MARKER = '[[EKOA_INTEGRATION_BUILD]]';
export const CONTEXT_OPEN = '<ekoa-context>';
export const CONTEXT_CLOSE = '</ekoa-context>';

const MAX_MARKER_LEN = Math.max(BUILD_MARKER.length, INTEGRATION_MARKER.length, CONTEXT_OPEN.length, CONTEXT_CLOSE.length);
const HOLD_BACK = MAX_MARKER_LEN - 1;

export interface MarkerFindings {
  /** A build delegation was detected at start-of-stream; carries the request description. */
  build?: { description: string };
  /** An integration-builder handoff was detected; optional hint. */
  integration?: { hint?: string };
  /** Extracted `<ekoa-context>` block bodies in stream order (last valid one is persisted). */
  contextBlocks: string[];
}

/**
 * Streaming marker processor. Feed it de-tokenized text deltas; it returns only text that is
 * safe to place in a `text_chunk`. Call `end()` to flush the held-back tail and read findings.
 */
export class MarkerProcessor {
  private buffer = '';
  private emittedAnyText = false;
  private startResolved = false;
  private buildMode = false;
  private buildRequest = '';
  private integration: { hint?: string } | undefined;
  private contextBlocks: string[] = [];

  /** Process one text delta; returns the prose safe to emit now (marker-free). */
  push(chunk: string): string {
    if (this.buildMode) {
      // Once a build delegation is detected, the remaining stream is the request payload and
      // no prose is emitted on the chat run (the answer is the delegation).
      this.buildRequest += chunk;
      return '';
    }
    this.buffer += chunk;

    if (!this.startResolved) {
      const resolved = this.resolveStart();
      if (!resolved) return ''; // still buffering to decide start-of-stream
    }

    return this.drain(false);
  }

  /** Flush the tail and return the accumulated findings. */
  end(): { text: string; findings: MarkerFindings } {
    let text = '';
    if (this.buildMode) {
      // fall through: no prose
    } else {
      if (!this.startResolved) this.resolveStart(true);
      if (!this.buildMode) text = this.drain(true);
    }
    const findings: MarkerFindings = { contextBlocks: this.contextBlocks };
    if (this.buildMode) findings.build = { description: this.buildRequest.trim() };
    if (this.integration) findings.integration = this.integration;
    return { text, findings };
  }

  /**
   * Decide whether the stream begins with the build marker. Returns true once resolved (either
   * a build delegation is entered, or start-of-stream detection is abandoned and normal
   * processing proceeds). Returns false while still buffering an inconclusive leading prefix.
   */
  private resolveStart(force = false): boolean {
    const lead = this.buffer.replace(/^\s+/, '');
    if (lead.length === 0) {
      if (force) { this.startResolved = true; return true; }
      return false; // only whitespace so far
    }
    if (lead.startsWith(BUILD_MARKER)) {
      this.buildMode = true;
      this.startResolved = true;
      this.buildRequest = lead.slice(BUILD_MARKER.length);
      this.buffer = '';
      return true;
    }
    // Could the lead still GROW into the build marker? (a strict prefix of it)
    const couldBe = BUILD_MARKER.startsWith(lead);
    if (couldBe && !force) return false; // keep buffering
    // Not a build marker — proceed with normal processing.
    this.startResolved = true;
    return true;
  }

  /**
   * Strip integration markers + context blocks from the buffer and return the prose safe to
   * emit. When `flush` is false, holds back the last (maxMarkerLen − 1) chars so a marker split
   * across the next chunk boundary is never partially emitted.
   */
  private drain(flush: boolean): string {
    this.stripSignals();
    let emit: string;
    if (flush) {
      emit = this.buffer;
      this.buffer = '';
    } else {
      const hold = Math.min(HOLD_BACK, this.buffer.length);
      emit = this.buffer.slice(0, this.buffer.length - hold);
      this.buffer = this.buffer.slice(this.buffer.length - hold);
    }
    if (emit) this.emittedAnyText = true;
    return emit;
  }

  /** Remove any complete integration marker (+ optional hint) and `<ekoa-context>` blocks that
   *  are fully present in the buffer. Partial trailing markers stay buffered (hold-back covers
   *  the split case). */
  private stripSignals(): void {
    // Integration marker: `[[EKOA_INTEGRATION_BUILD]]` optionally followed by `(hint)`.
    for (;;) {
      const idx = this.buffer.indexOf(INTEGRATION_MARKER);
      if (idx === -1) break;
      let end = idx + INTEGRATION_MARKER.length;
      let hint: string | undefined;
      const rest = this.buffer.slice(end);
      const hintMatch = /^\s*\(([^)]*)\)/.exec(rest);
      if (hintMatch) {
        hint = hintMatch[1]?.trim() || undefined;
        end += hintMatch[0].length;
      }
      this.integration = { ...(hint ? { hint } : {}) };
      this.buffer = this.buffer.slice(0, idx) + this.buffer.slice(end);
    }
    // Context blocks: extract every complete `<ekoa-context>…</ekoa-context>`.
    for (;;) {
      const open = this.buffer.indexOf(CONTEXT_OPEN);
      if (open === -1) break;
      const close = this.buffer.indexOf(CONTEXT_CLOSE, open + CONTEXT_OPEN.length);
      if (close === -1) break; // wait for the close tag
      const body = this.buffer.slice(open + CONTEXT_OPEN.length, close);
      this.contextBlocks.push(body);
      this.buffer = this.buffer.slice(0, open) + this.buffer.slice(close + CONTEXT_CLOSE.length);
    }
  }
}

// --- Provider-error scanners (§5.3.7) ----------------------------------------------------

/** Auth-error / org-access-loss strings the SDK can return AS result text (carried). */
const AUTH_ERROR_PATTERNS: RegExp[] = [
  /\b401\b/,
  /unauthor(i|í)z/i,
  /invalid[\s_-]*(api[\s_-]*key|token|credential)/i,
  /authentication[\s_-]*(failed|error)/i,
  /oauth[\s_-]*token[\s_-]*(expired|invalid)/i,
  /access[\s\w]{0,20}(revoked|denied|lost)/i,
  /organization[\s\w]{0,30}(revoked|removed|lost)/i,
];

/** Transient / rate-limit provider errors (429/529/overloaded), incl. the consumer-plan message. */
const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /\b429\b/,
  /\b529\b/,
  /overloaded/i,
  /rate[\s_-]*limit/i,
  /too[\s_-]*many[\s_-]*requests/i,
  /temporarily[\s_-]*unavailable/i,
  /usage[\s_-]*limit[\s_-]*reached/i,
  /you'?ve reached your usage limit/i,
];

export type ProviderErrorClass = 'auth' | 'transient' | null;

/** Classify a piece of text (a stream event or a final result) as a provider error, or null.
 *  A match reroutes an error-as-result to the error path and blocks persisting the text (§5.3.7). */
export function scanProviderError(text: string): ProviderErrorClass {
  if (!text) return null;
  if (AUTH_ERROR_PATTERNS.some((re) => re.test(text))) return 'auth';
  if (TRANSIENT_ERROR_PATTERNS.some((re) => re.test(text))) return 'transient';
  return null;
}

/** True when text matches EITHER scanner — the "do not persist this assistant message" gate. */
export function looksLikeProviderError(text: string): boolean {
  return scanProviderError(text) !== null;
}
