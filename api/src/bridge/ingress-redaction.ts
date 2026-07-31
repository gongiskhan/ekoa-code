/**
 * bridge/ingress-redaction.ts — the value-keyed filter on inbound bridge frames (Cofre H-4).
 *
 * WHY THE FILTER LIVES ON THIS SIDE. When Cortex delivers a credential to a machine (J-3), a bash
 * step on that machine can trivially echo it — `env | grep`, a curl that fails and prints its own
 * argv, a stack trace with the connection string in it. That output comes back as a frame and is
 * then persisted to the run record, streamed to the browser over SSE, and (for a `provider_request`)
 * forwarded to the model. Frames were parsed and dispatched RAW.
 *
 * The bridge itself cannot fix this: the daemon does not know which of the strings in its own
 * output is a secret, and asking it to guess produces exactly the pattern-matching-a-value problem
 * that value-keyed redaction exists to avoid. CORTEX knows, because Cortex delivered the value
 * seconds earlier. So the filter belongs at ingress, keyed on the values this process handed out —
 * and the daemon's own obligation stays the simpler one: never log payloads at all.
 *
 * SCOPE. Per PAIRING, because that is the unit a delivery targets and the unit a frame arrives on.
 * A value is registered when it is delivered and released when the pairing's socket drops, so the
 * filter's lifetime is the lifetime of the machine's ability to echo it.
 *
 * WHAT IS FILTERED, AND WHAT DELIBERATELY IS NOT. Every free-text field a frame carries that can
 * reach persistence, the SSE stream or the model: a delegation result's `answer`, a denial's
 * `reason`, a tool result's output, a provider request's body. NOT the structural fields (taskId,
 * correlationId, byte counts) — substituting inside an id would corrupt a join key to protect a
 * string that cannot contain a secret. The `path` on a ledger row is left ALONE too: it is never
 * persisted hosted-side (§18.2 / FC-407, and J-6's audit has no path field), so redacting it would
 * be work done on a value already headed for the bin.
 */
import type { BridgeFrame } from '@ekoa/shared';
import { SecretRegistry, redactStream } from '../security/redaction.js';

/** pairingId -> the values Cortex has delivered to that machine and not yet released. */
const byPairing = new Map<string, SecretRegistry>();

/** Register a delivered value so anything the machine echoes back is filtered (J-3 calls this). */
export function registerDeliveredSecrets(pairingId: string, values: Iterable<string>): void {
  let reg = byPairing.get(pairingId);
  if (!reg) {
    reg = new SecretRegistry();
    byPairing.set(pairingId, reg);
  }
  reg.registerAll(values);
}

/** The filter for a pairing, or undefined when nothing was ever delivered to it. */
export function registryFor(pairingId: string): SecretRegistry | undefined {
  return byPairing.get(pairingId);
}

/** Drop a pairing's registry — its socket is gone, so it can no longer echo anything. */
export function releasePairingSecrets(pairingId: string): void {
  byPairing.delete(pairingId);
}

/**
 * Redact an inbound frame in place of its free-text fields.
 *
 * Returns a NEW frame rather than mutating: the caller dispatches the redacted copy, so there is no
 * window in which the raw object is reachable by a later handler that forgot to filter. Frames with
 * no free text are returned as-is.
 *
 * Runs unconditionally, not only when a delivery happened: `redactStream` also applies the
 * NAME-pattern leg (`redactBodyByName`), which reaches a credential the executor never held — a
 * token the user's own script fetched, for instance. A registry-only filter would miss exactly the
 * secrets Cortex never saw.
 *
 * RESIDUAL, stated because it is easy to assume otherwise: that name leg understands JSON keys and
 * `key=value` pairs. A colon-separated header line in free-text stdout (`Authorization: Bearer x`)
 * matches neither and survives it — such a value is only removed when Cortex DELIVERED it and the
 * registry leg recognises it. Widening the name leg to colon-separated pairs was considered and
 * rejected: it would fire on ordinary prose, including any `word: value` line in a document
 * excerpt, and a filter that mangles legitimate output is one people route around. Pinned in both
 * directions by `bridge-ingress-redaction.test.ts` and logged in `docs/findings.md`.
 */
export function redactInboundFrame(pairingId: string, frame: BridgeFrame): BridgeFrame {
  const reg = byPairing.get(pairingId);
  const scrub = (text: string): string => redactStream(text, reg);

  switch (frame.type) {
    case 'delegation_result': {
      const r = frame.result;
      return {
        ...frame,
        result: {
          ...r,
          ...(r.answer !== undefined ? { answer: scrub(r.answer) } : {}),
          // Citation RANGES are numeric spans and paths are not persisted; but a citation `path`
          // still reaches the client, so it goes through the name-pattern leg like any other text.
          citations: r.citations.map((c) => ({ ...c, path: scrub(c.path) })),
        },
      };
    }
    case 'denial':
      return { ...frame, reason: scrub(frame.reason) };
    case 'tool.result':
      return {
        ...frame,
        ...(typeof frame.output === 'string' ? { output: scrub(frame.output) } : {}),
        ...(frame.error !== undefined ? { error: scrub(frame.error) } : {}),
      };
    case 'provider_request':
      // The body is on its way to the model through the chokepoint. Anonymisation there covers
      // PII; this covers the credential THIS process delivered, which anonymisation has no way to
      // recognise because it is not a pattern, it is a value.
      return { ...frame, body: redactUnknown(frame.body, scrub) };
    default:
      return frame;
  }
}

/** Walk an arbitrary JSON-ish body, redacting every string. Depth-bounded: a frame is attacker-
 *  influenced input, and an unbounded walk on a crafted structure is a denial of service. */
function redactUnknown(value: unknown, scrub: (t: string) => string, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((v) => redactUnknown(v, scrub, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactUnknown(v, scrub, depth + 1);
    return out;
  }
  return value;
}

/** Test/boot helper. */
export function __resetIngressRedactionForTests(): void {
  byPairing.clear();
}
