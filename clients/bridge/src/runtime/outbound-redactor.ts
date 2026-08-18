/**
 * runtime/outbound-redactor.ts - the value-keyed filter on EVERY frame this daemon sends.
 *
 * THE MIRROR IMAGE OF CORTEX'S INGRESS FILTER. `api/src/bridge/ingress-redaction.ts` scrubs frames
 * as they ARRIVE hosted-side, keyed on the values Cortex delivered. This is the same idea one hop
 * earlier: scrub them as they LEAVE the machine. Two filters for one hazard is not redundancy - the
 * ingress one protects Cortex's persistence, its SSE stream and the model; this one means the value
 * never crosses the network at all, which is the only version that also survives a proxy log, a
 * packet capture, or a Cortex that was not the one that delivered it.
 *
 * IT WRAPS `send`, NOT THE CALL SITES. `DaemonRuntime` builds ONE wrapped sender in its constructor
 * and every outbound frame in the process goes through it - a `tool.result` carrying child
 * stdout/stderr, a browser observation's text, a `denial.reason`, a `delegation_result.answer`, a
 * `provider_request.body` on its way to the model. Filtering at the call sites instead would mean
 * the filter is only as good as the next person's memory, and the frame that gets forgotten is
 * exactly the one that carries the echo.
 *
 * WHAT IS DELIBERATELY NOT FILTERED.
 *  - STRUCTURAL IDs (invocationId, taskId, correlationId, sha256, byte counts): substituting inside
 *    a join key corrupts the join to protect a field that cannot contain a secret.
 *  - `session.push.storageState`: that payload IS a credential, and Cortex must receive it byte-
 *    exact to store a working session. Mangling it would silently mint a broken Cofre item - a
 *    failure that only surfaces later, somewhere else, as a login that does not work.
 *  - The screenshot: it is an image. Credential-bearing REGIONS are a browser-side masking concern.
 *
 * DEPTH IS BOUNDED, copied from the ingress redactor's guard: an outbound body can contain
 * arbitrary child output, and an unbounded walk over a crafted structure is a denial of service
 * against the daemon itself.
 */
import type { BridgeFrame } from '../wire/index.js';

/** Below this length a value cannot be substituted without destroying the surrounding stream (a
 *  two-character secret would redact half the output). Matches Cortex's `MIN_MASKABLE_LENGTH`. */
const MIN_MASKABLE_LENGTH = 3;

/** Above this, a case-insensitive match is safe: colliding on 8+ characters of a real credential is
 *  not a realistic false positive, and transports do upper/lower-case tokens. */
const CASE_INSENSITIVE_MIN_LENGTH = 8;

const MAX_WALK_DEPTH = 12;

interface Registered {
  handle: string;
  value: string;
  forms: string[];
}

/**
 * Every encoding a value can plausibly wear by the time a child has echoed it: raw, URI-encoded,
 * base64, base64url, JSON-escaped. A filter that only matches the raw literal is the failure mode
 * this whole class exists to avoid - `curl` prints URL-encoded, a stack trace prints JSON-escaped,
 * and a config dump prints base64.
 */
function encodedForms(value: string): string[] {
  const forms = new Set<string>([value]);
  try {
    forms.add(encodeURIComponent(value));
    forms.add(encodeURI(value));
  } catch {
    /* lone surrogates - the raw form still applies */
  }
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  forms.add(b64);
  forms.add(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  forms.add(JSON.stringify(value).slice(1, -1));
  return [...forms].filter((f) => f.length >= MIN_MASKABLE_LENGTH);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class OutboundRedactor {
  private readonly byValue = new Map<string, Registered>();
  private readonly short = new Set<string>();
  private seq = 0;
  private ordered: Registered[] | null = null;

  /**
   * Arm the filter with delivered values. Takes Buffers because that is how `SecretHold` owns them
   * - the redactor must derive its own independent string copy (it needs one to match against), and
   * taking it from the Buffer rather than from the caller keeps the hold as the single owner.
   */
  register(values: Iterable<Buffer | string>): void {
    for (const v of values) {
      const value = typeof v === 'string' ? v : v.toString('utf8');
      if (!value) continue;
      if (this.byValue.has(value)) continue;
      if (value.length < MIN_MASKABLE_LENGTH) {
        // Recorded, never silently ignored: a credential this short is a provisioning defect and
        // the condition must be observable rather than looking identical to "nothing to redact".
        this.short.add(value);
        continue;
      }
      this.byValue.set(value, { handle: `s${++this.seq}`, value, forms: encodedForms(value) });
      this.ordered = null;
    }
  }

  /** Values seen but too short to substitute. Asserted on in tests, never empty silently. */
  get unmaskable(): readonly string[] {
    return [...this.short];
  }

  get size(): number {
    return this.byValue.size;
  }

  /** Forget everything (the values were zeroized; the filter has nothing left to protect). */
  clear(): void {
    this.byValue.clear();
    this.short.clear();
    this.ordered = null;
  }

  private get orderedSecrets(): Registered[] {
    if (!this.ordered) {
      // Longest first, so an overlapping shorter secret can never mask a longer one.
      this.ordered = [...this.byValue.values()].sort((a, b) => b.value.length - a.value.length);
    }
    return this.ordered;
  }

  /** Substitute every registered value, in every encoded form, out of `text`. */
  redactText(text: string): string {
    if (typeof text !== 'string' || text.length === 0 || this.byValue.size === 0) return text;
    let out = text;
    for (const secret of this.orderedSecrets) {
      const marker = `[REDACTED:${secret.handle}]`;
      const forms = [...secret.forms].sort((a, b) => b.length - a.length);
      for (const form of forms) {
        if (out.includes(form)) out = out.split(form).join(marker);
      }
      if (secret.value.length >= CASE_INSENSITIVE_MIN_LENGTH) {
        const ci = new RegExp(escapeRegExp(secret.value), 'gi');
        if (ci.test(out)) out = out.replace(ci, marker);
      }
    }
    return out;
  }

  /** Walk an arbitrary JSON-ish value, redacting every string. Depth-bounded (see the docblock). */
  redactUnknown(value: unknown, depth = 0): unknown {
    if (depth > MAX_WALK_DEPTH) return value;
    if (typeof value === 'string') return this.redactText(value);
    if (Array.isArray(value)) return value.map((v) => this.redactUnknown(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      // KEYS too: a credential used as a map key is still a credential.
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[this.redactText(k)] = this.redactUnknown(v, depth + 1);
      }
      return out;
    }
    return value;
  }

  /**
   * Return a scrubbed COPY of an outbound frame. A copy rather than a mutation so there is no
   * window in which the raw object is still reachable by something that runs after the filter.
   * Frames with no free text are returned as-is.
   */
  redactFrame(frame: BridgeFrame): BridgeFrame {
    if (this.byValue.size === 0) return frame;
    switch (frame.type) {
      case 'tool.result':
        return {
          ...frame,
          ...(frame.output !== undefined ? { output: this.redactUnknown(frame.output) } : {}),
          ...(frame.error !== undefined ? { error: this.redactText(frame.error) } : {}),
        };
      case 'denial':
        return { ...frame, reason: this.redactText(frame.reason) };
      case 'delegation_result': {
        const r = frame.result;
        return {
          ...frame,
          result: {
            ...r,
            ...(r.answer !== undefined ? { answer: this.redactText(r.answer) } : {}),
            citations: r.citations.map((c) => ({ ...c, path: this.redactText(c.path) })),
            ...(r.patches !== undefined
              ? { patches: r.patches.map((p) => ({ ...p, path: this.redactText(p.path), diff: this.redactText(p.diff) })) }
              : {}),
          },
        };
      }
      case 'provider_request':
        // On its way to the model through Cortex's chokepoint. Anonymisation there covers PII; a
        // delivered credential is not a pattern, it is a value, so only this leg catches it.
        return { ...frame, body: this.redactUnknown(frame.body) };
      case 'ledger_row':
        // A read row's `path` is free text from the user's filesystem. Cortex leaves it alone on
        // ingress (it is not persisted hosted-side); scrubbing it on the way OUT costs nothing and
        // means a credential that ended up in a filename does not ride the wire.
        return { ...frame, row: { ...frame.row, path: this.redactText(frame.row.path) } };
      default:
        // hello / session.push / ping / pong / the hosted-to-daemon members. See the docblock for
        // why session.push.storageState is deliberately left byte-exact.
        return frame;
    }
  }

  /**
   * Wrap a raw sender so nothing can reach the socket unfiltered. This is the ONE composition point
   * - see the docblock on why it is not done at the call sites.
   */
  wrapSend(send: (frame: BridgeFrame) => boolean): (frame: BridgeFrame) => boolean {
    return (frame: BridgeFrame): boolean => send(this.redactFrame(frame));
  }
}
