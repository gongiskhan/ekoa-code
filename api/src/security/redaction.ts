/**
 * security/redaction.ts — THE value-keyed redaction module (Cofre R-6; invariant I2).
 *
 * The executor knows the live secret values, so it — not the caller — is the party that can filter
 * every byte stream flowing toward a model, a log, an SSE frame or a persisted record. Before this
 * module there were two divergent private copies of that logic, each leaking in a different way:
 *
 *   - `integrations/http-template.ts` masked to `Bearer ***…1234` — a fixed PLAINTEXT SUFFIX of
 *     every secret, persisted forever, and enough to confirm a guess.
 *   - `automation/executors/api-call.ts` masked to `<redacted>` (no leak) but matched only the RAW
 *     literal, so a URL-encoded, base64'd or JSON-escaped occurrence walked straight through.
 *
 * Both also SILENTLY skipped any value shorter than four characters, which is the failure mode a
 * masker must never have: a secret that is quietly not masked reads exactly like one that was.
 *
 * The replacement is a run-scoped registry. Register a value, get an opaque handle; every stream
 * the run touches goes through `redact()`, which substitutes `[REDACTED:<handle>]` — no plaintext
 * fragment, no length hint, and the handle lets an operator correlate two occurrences in a log
 * without learning either value.
 *
 * ON SHORT VALUES (deliberate, and the opposite of a silent skip). Substituting a one- or two-char
 * value would destroy the surrounding output — masking "1" redacts every digit 1 in the stream, so
 * the log becomes useless and the incident it was meant to explain becomes unreadable. Values
 * shorter than MIN_MASKABLE_LENGTH are therefore NOT substituted, but they are recorded and
 * exposed on `unmaskable` so the condition is observable and assertable rather than silent. A
 * credential that short is a provisioning defect; the registry surfaces it instead of hiding it.
 */

/** Below this length a value cannot be substituted without destroying the surrounding stream.
 *  Such values are surfaced on `SecretRegistry.unmaskable`, never silently ignored. */
export const MIN_MASKABLE_LENGTH = 3;

/** Above this length a case-insensitive match is safe — a collision on 8+ characters of a real
 *  credential is not a realistic false positive, and some transports upper/lower-case tokens. */
const CASE_INSENSITIVE_MIN_LENGTH = 8;

/** Every encoding a registered value can plausibly wear by the time it reaches a stream. */
function encodedForms(value: string): string[] {
  const forms = new Set<string>([value]);
  try {
    forms.add(encodeURIComponent(value));
    forms.add(encodeURI(value));
  } catch {
    /* lone surrogates — the raw form still applies */
  }
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  forms.add(b64);
  forms.add(b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')); // base64url
  forms.add(JSON.stringify(value).slice(1, -1)); // JSON string-escaped
  return [...forms].filter((f) => f.length >= MIN_MASKABLE_LENGTH);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface RegisteredSecret {
  readonly handle: string;
  readonly value: string;
  readonly forms: readonly string[];
}

/**
 * A run-scoped set of live secret values and the single place that substitutes them out of a
 * stream. Scope it to the run (or the request) that resolved the credentials, never process-wide:
 * a process-wide registry would outlive the use window and quietly redact one tenant's output
 * using another tenant's values.
 */
export class SecretRegistry {
  /** Insertion-ordered; `orderedSecrets` sorts a longest-first view for substitution. */
  private readonly byValue = new Map<string, RegisteredSecret>();
  private readonly short = new Set<string>();
  private seq = 0;
  /** Invalidated whenever a value is registered. */
  private orderedCache: readonly RegisteredSecret[] | null = null;

  /**
   * Register a live secret value. Returns its stable handle, or null when the value is too short
   * to substitute safely (see the module docblock) — in which case it lands on `unmaskable`.
   * Registering the same value twice returns the original handle.
   */
  register(value: string): string | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    const existing = this.byValue.get(value);
    if (existing) return existing.handle;
    if (value.length < MIN_MASKABLE_LENGTH) {
      this.short.add(value);
      return null;
    }
    const handle = `s${++this.seq}`;
    this.byValue.set(value, { handle, value, forms: encodedForms(value) });
    this.orderedCache = null;
    return handle;
  }

  /** Register every string in a credential-field bag (the common case at a call site). */
  registerAll(values: Iterable<unknown>): void {
    for (const v of values) if (typeof v === 'string') this.register(v);
  }

  /** Values seen but too short to substitute. Never empty silently — assert on it in tests. */
  get unmaskable(): readonly string[] {
    return [...this.short];
  }

  get size(): number {
    return this.byValue.size;
  }

  /** Longest value first, so an overlapping shorter secret can never mask a longer one. */
  private get orderedSecrets(): readonly RegisteredSecret[] {
    if (!this.orderedCache) {
      this.orderedCache = [...this.byValue.values()].sort((a, b) => b.value.length - a.value.length);
    }
    return this.orderedCache;
  }

  /** Substitute every registered value, in every encoded form, out of `text`. */
  redact(text: string): string {
    if (typeof text !== 'string' || !text || this.byValue.size === 0) return text;
    let out = text;
    for (const secret of this.orderedSecrets) {
      const marker = `[REDACTED:${secret.handle}]`;
      // Longest form first for the same reason values are ordered longest-first: a base64 form can
      // contain a shorter form of the same value as a substring.
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

  /** Recursively redact a data tree. Object KEYS are redacted too — a credential used as a map key
   *  is still a credential. Non-string leaves pass through untouched. */
  redactDeep(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return this.redact(value);
    if (Array.isArray(value)) return value.map((v) => this.redactDeep(v));
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[this.redact(k)] = this.redactDeep(v);
      }
      return out;
    }
    return value;
  }

  /**
   * A registry NEVER serialises its contents. This is not decoration — it closes a live hole.
   *
   * The private state is a `Map` and a `Set`, which `JSON.stringify` renders as `{}`, so a registry
   * looked harmless in a `JSON.stringify(result)` assertion. But `orderedSecrets` memoises into
   * `orderedCache` as a plain ARRAY of `{ handle, value, forms }`, so the FIRST call to `redact()`
   * turns the same object into one that stringifies every live credential in plaintext — including
   * its base64 form. Registries are handed back on result objects (`typistLogin`,
   * `deliverSecretToDaemon`, `ensureSession`) precisely so a caller can filter its streams, and
   * those results are logged, persisted to step records and pushed onto SSE frames. A disclosure
   * that only appears after a redaction has run is the worst possible shape for one.
   *
   * `toJSON` is the interception point every serialiser honours (`JSON.stringify`, and anything
   * built on it), so the container is inert by construction rather than by every caller
   * remembering. Values remain reachable through `redact()` — which is the whole point of holding
   * one — and nowhere else.
   */
  toJSON(): { secrets: number; unmaskable: number } {
    return { secrets: this.byValue.size, unmaskable: this.short.size };
  }

  /** Same for `util.inspect` / `console.log`, which do not call `toJSON`. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `SecretRegistry(${this.byValue.size} secrets, ${this.short.size} unmaskable)`;
  }

  /** Redact every header VALUE (names are not secrets; values may be). */
  redactHeaderValues(headers: Record<string, string>): Record<string, string> {
    if (this.byValue.size === 0) return headers;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) out[k] = this.redact(v);
    return out;
  }
}

/** Build a registry from a resolved integration credential bag (`{ [key]: { [field]: value } }`). */
export function secretRegistryFromFields(
  integrationFields: Record<string, Record<string, string>> | undefined,
): SecretRegistry {
  const registry = new SecretRegistry();
  if (!integrationFields) return registry;
  for (const fields of Object.values(integrationFields)) {
    if (fields && typeof fields === 'object') registry.registerAll(Object.values(fields));
  }
  return registry;
}

/** Build a registry from a flat list of known secret values. */
export function secretRegistryFromValues(values: Iterable<unknown>): SecretRegistry {
  const registry = new SecretRegistry();
  registry.registerAll(values);
  return registry;
}

// ---------------------------------------------------------------------------
// Name-pattern redaction — the SECOND leg, for values we do NOT know.
//
// The registry masks values the executor holds. A conventionally-named header or field can carry a
// secret the executor never resolved (a provider echoing a token back, a user-supplied header), and
// there is nothing to register. Those are masked by NAME, and because the value is unknown the mask
// is total: no prefix, no suffix, no length. The auth SCHEME is preserved because it is public and
// makes an error message legible ("Bearer" vs "Basic" is a real debugging signal).
// ---------------------------------------------------------------------------

const SECRET_HEADER_PATTERNS = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /api[-_]?key/i,
  /^x-api-token$/i,
  /^x-auth-token$/i,
  /token/i,
  /secret/i,
  /^cookie$/i,
  /^set-cookie$/i,
];

const SECRET_KEY_PATTERN =
  /(?:secret|token|password|passwd|api[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key|auth(?:orization)?)/i;

/** The scheme of an `Authorization`-style value ("Bearer", "Basic", …) when there is one. */
const AUTH_SCHEME = /^([A-Za-z][A-Za-z0-9-]{0,14}) +\S/;

/**
 * Mask a value we cannot enumerate. Total — NO plaintext fragment of the secret survives. The
 * historical implementation appended the last four characters, which is a persisted partial
 * disclosure of every credential the platform ever proxied; that suffix is gone deliberately.
 */
export function maskUnknownSecret(v: string): string {
  if (!v) return v;
  const scheme = AUTH_SCHEME.exec(v)?.[1];
  return scheme ? `${scheme} [REDACTED]` : '[REDACTED]';
}

/** Mask header values whose NAME matches a credential-carrying convention. */
export function redactHeadersByName(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADER_PATTERNS.some((re) => re.test(k)) ? maskUnknownSecret(v) : v;
  }
  return out;
}

/** Mask conventionally-named fields in a JSON tree or a form-encoded body. */
export function redactBodyByName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJsonTreeByName(JSON.parse(raw)), null, 2);
    } catch {
      /* not JSON — fall through to the form-encoded pass */
    }
  }
  return raw.replace(/([\w.-]+)=([^&\s]+)/g, (match, key: string, value: string) =>
    SECRET_KEY_PATTERN.test(key) ? `${key}=${maskUnknownSecret(safeDecode(value))}` : match,
  );
}

/** Mask conventionally-named query parameters in a URL. */
export function redactUrlByName(url: string): string {
  return url.replace(/([?&][\w.-]+)=([^&#\s]+)/g, (match, prefixKey: string, value: string) =>
    SECRET_KEY_PATTERN.test(prefixKey) ? `${prefixKey}=${maskUnknownSecret(safeDecode(value))}` : match,
  );
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function redactJsonTreeByName(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonTreeByName);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) && typeof v === 'string' ? maskUnknownSecret(v) : redactJsonTreeByName(v);
    }
    return out;
  }
  return value;
}

/**
 * BOTH legs at once, in the order that matters: value-keyed first (it is exact and authoritative),
 * then name-pattern (it catches what the executor never held). This is the entry point a stream
 * filter should call.
 */
export function redactStream(text: string, registry: SecretRegistry | undefined): string {
  const valueRedacted = registry ? registry.redact(text) : text;
  return redactBodyByName(valueRedacted);
}
