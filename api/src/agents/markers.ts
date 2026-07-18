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

const ALL_MARKERS = [BUILD_MARKER, INTEGRATION_MARKER, CONTEXT_OPEN, CONTEXT_CLOSE];
const MAX_MARKER_LEN = Math.max(...ALL_MARKERS.map((m) => m.length));
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
      // End-of-stream: an UNCLOSED `<ekoa-context>` internal state block (the generation ended
      // before its close tag) is still in the buffer after stripSignals. It must NEVER flush to
      // the wire - it is internal state, not answer prose. Drop from the open tag to end and
      // record the truncated body as a context block (codex checkpoint finding: the live-path
      // fix left the flush path leaking an unclosed block at end-of-stream).
      for (;;) {
        const openIdx = this.buffer.indexOf(CONTEXT_OPEN);
        if (openIdx === -1) break;
        // stripSignals already removed every COMPLETE block, so any remaining open is unclosed.
        const body = this.buffer.slice(openIdx + CONTEXT_OPEN.length);
        if (body) this.contextBlocks.push(body);
        this.buffer = this.buffer.slice(0, openIdx);
      }
      // The hold-back no longer protects the tail, so a generation that ends exactly on a strict
      // prefix of a marker would flush it to the wire. §5.7.2 forbids any marker fragment in a
      // `text_chunk`, so drop the longest trailing suffix of the buffer that is a strict prefix
      // of any marker.
      this.dropTrailingMarkerPrefix();
      emit = this.buffer;
      this.buffer = '';
    } else {
      let emitEnd = this.buffer.length - Math.min(HOLD_BACK, this.buffer.length);
      // stripSignals already extracted every depth-BALANCED context block, so ANY remaining
      // `<ekoa-context>` open is unclosed/unbalanced internal state. The fixed HOLD_BACK only
      // protects the trailing ~marker-length chars, so such an open's body would otherwise
      // stream to the live text_chunk wire (and be spoken by TTS) before its balancing close
      // lands. Hold back from the open tag itself until it balances - the full block is then
      // stripped by stripSignals and never reaches the wire (codex checkpoint finding).
      const openIdx = this.buffer.indexOf(CONTEXT_OPEN);
      if (openIdx !== -1) emitEnd = Math.min(emitEnd, openIdx);
      emit = this.buffer.slice(0, emitEnd);
      this.buffer = this.buffer.slice(emitEnd);
    }
    if (emit) this.emittedAnyText = true;
    return emit;
  }

  /** Drop the longest trailing suffix of the buffer that is a strict prefix of any marker —
   *  only ever called at flush, where the split-marker hold-back no longer applies. */
  private dropTrailingMarkerPrefix(): void {
    const max = Math.min(HOLD_BACK, this.buffer.length);
    for (let len = max; len > 0; len--) {
      const tail = this.buffer.slice(this.buffer.length - len);
      if (ALL_MARKERS.some((m) => m.length > len && m.startsWith(tail))) {
        this.buffer = this.buffer.slice(0, this.buffer.length - len);
        return;
      }
    }
  }

  /** Remove any complete integration marker (+ optional hint), `<ekoa-context>` blocks, and any
   *  BUILD marker that surfaces AFTER start-of-stream — all that are fully present in the buffer.
   *  Partial trailing markers stay buffered (hold-back covers the split case). */
  private stripSignals(): void {
    // Build marker mid-stream (§5.7.2): a start-of-stream build marker is consumed by
    // resolveStart() and drives the delegation path; ANY later occurrence is an adversarial or
    // drifted emission that must never reach a `text_chunk`, so strip every complete instance.
    for (;;) {
      const idx = this.buffer.indexOf(BUILD_MARKER);
      if (idx === -1) break;
      this.buffer = this.buffer.slice(0, idx) + this.buffer.slice(idx + BUILD_MARKER.length);
    }
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
    // Context blocks: extract every complete `<ekoa-context>…</ekoa-context>`. Uses DEPTH-
    // BALANCED matching (not first-open/first-close): a malformed nested emission like
    // `<ekoa-context>outer <ekoa-context>INNER</ekoa-context> SECRET</ekoa-context>` must strip
    // the WHOLE outer span, never mis-pair the outer open with the inner close and leak the
    // trailing internal state as prose (codex checkpoint finding). An open that never balances
    // stays in the buffer (the drain live-path holds it; the flush-path drops it).
    for (;;) {
      const open = this.buffer.indexOf(CONTEXT_OPEN);
      if (open === -1) break;
      let depth = 0;
      let i = open;
      let endClose = -1;
      while (i < this.buffer.length) {
        const nextOpen = this.buffer.indexOf(CONTEXT_OPEN, i);
        const nextClose = this.buffer.indexOf(CONTEXT_CLOSE, i);
        if (nextClose === -1) break; // unclosed - leave for the caller (hold live / drop flush)
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          i = nextOpen + CONTEXT_OPEN.length;
        } else {
          depth--;
          i = nextClose + CONTEXT_CLOSE.length;
          if (depth === 0) { endClose = nextClose; break; }
        }
      }
      if (endClose === -1) break; // not yet balanced - wait for the balancing close
      const body = this.buffer.slice(open + CONTEXT_OPEN.length, endClose);
      this.contextBlocks.push(body);
      this.buffer = this.buffer.slice(0, open) + this.buffer.slice(endClose + CONTEXT_CLOSE.length);
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
