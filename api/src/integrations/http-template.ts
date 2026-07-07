/**
 * Shared HTTP-action templating for the two integration executors (platform-call.ts and
 * action-executor.ts): `{{name}}` placeholder interpolation with raw-value passthrough for
 * body templates, and credential-shaped redaction for the request/response dumps the
 * user-defined executor surfaces to the UI.
 *
 * The `$?` in the placeholder pattern lets Microsoft Graph OData params (`{{$top}}`,
 * `{{$filter}}`) interpolate; a plain `{{name}}` still matches.
 */

const PLACEHOLDER = /\{\{(\$?\w+)\}\}/g;
const BARE_PLACEHOLDER = /^\{\{(\$?\w+)\}\}$/;

/** Substitute `{{name}}` occurrences from `vars` (missing → ''). */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_m, key: string) => vars[key] ?? '');
}

/**
 * Interpolate an object template. A string that is exactly one bare `{{name}}` and whose raw
 * value is non-string (array/object/number) is substituted by that raw value, preserving type
 * in a JSON body; every other string is text-interpolated.
 */
export function interpolateObj(
  obj: Record<string, unknown>,
  vars: Record<string, string>,
  rawVars: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = interpolateValue(v, vars, rawVars);
  }
  return out;
}

function interpolateValue(v: unknown, vars: Record<string, string>, rawVars: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    const bare = BARE_PLACEHOLDER.exec(v);
    if (bare) {
      const raw = rawVars[bare[1] as string];
      if (raw !== undefined && typeof raw !== 'string') return raw;
    }
    return interpolate(v, vars);
  }
  if (Array.isArray(v)) return v.map((item) => interpolateValue(item, vars, rawVars));
  if (v !== null && typeof v === 'object') return interpolateObj(v as Record<string, unknown>, vars, rawVars);
  return v;
}

/** Build `{ stringVars, rawVars }` from args + credential fields: string forms for
 *  path/query/header interpolation, raw forms preserved for body-template passthrough. */
export function buildVars(
  args: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): { stringVars: Record<string, string>; rawVars: Record<string, unknown> } {
  const rawVars: Record<string, unknown> = { ...args, ...extra };
  const stringVars: Record<string, string> = Object.fromEntries(
    Object.entries(rawVars).map(([k, v]) => [k, v == null ? '' : String(v)]),
  );
  return { stringVars, rawVars };
}

// ---------------------------------------------------------------------------
// Redaction — mask credential-shaped values before a request/response dump is
// surfaced to the UI or persisted (never let a secret reach a log/transcript).
// ---------------------------------------------------------------------------

const SECRET_HEADER_PATTERNS = [/^authorization$/i, /^proxy-authorization$/i, /api[-_]?key/i, /^x-api-token$/i, /^x-auth-token$/i, /token/i, /secret/i, /^cookie$/i, /^set-cookie$/i];
const SECRET_KEY_PATTERN = /(?:secret|token|password|passwd|api[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key|auth(?:orization)?)/i;

export function maskValue(v: string): string {
  if (!v) return v;
  const space = v.indexOf(' ');
  const head = space > 0 && space <= 12 ? v.slice(0, space + 1) : '';
  const rest = head ? v.slice(head.length) : v;
  const tail = rest.length > 4 ? rest.slice(-4) : '';
  return `${head}***${tail ? `…${tail}` : ''}`;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADER_PATTERNS.some((re) => re.test(k)) ? maskValue(v) : v;
  }
  return out;
}

export function redactBody(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJsonTree(JSON.parse(raw)), null, 2);
    } catch {
      /* not JSON — fall through */
    }
  }
  return raw.replace(/([\w.-]+)=([^&\s]+)/g, (match, key: string, value: string) =>
    SECRET_KEY_PATTERN.test(key) ? `${key}=${maskValue(decodeURIComponent(value))}` : match,
  );
}

/**
 * Redact a resolved request URL before it is persisted/surfaced on failure. A credential
 * interpolated into the query string (e.g. `?token=<secret>`) is otherwise stored in cleartext,
 * even when headers/body are redacted. Value-based: every occurrence of a decrypted credential
 * value is masked, then a secret-key-name pass catches conventionally-named params too.
 */
export function redactUrl(url: string, secretValues: string[]): string {
  let out = url;
  for (const secret of secretValues) {
    if (!secret || secret.length < 4) continue;
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      if (out.includes(form)) out = out.split(form).join(maskValue(secret));
    }
  }
  return out.replace(/([?&][\w.-]+)=([^&#\s]+)/g, (match, prefixKey: string, value: string) =>
    SECRET_KEY_PATTERN.test(prefixKey) ? `${prefixKey}=${maskValue(decodeURIComponent(value))}` : match,
  );
}

function redactJsonTree(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(redactJsonTree);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) && typeof v === 'string' ? maskValue(v) : redactJsonTree(v);
    }
    return out;
  }
  return node;
}

export function truncateForDisplay(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… [truncated, ${s.length - max} more bytes]`;
}

/** Encode a flat-ish object as application/x-www-form-urlencoded (Stripe array/nested convention). */
export function formUrlEncode(obj: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) appendForm(params, k, v);
  return params.toString();
}
function appendForm(params: URLSearchParams, key: string, value: unknown): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendForm(params, key, item);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) appendForm(params, `${key}[${k}]`, v);
    return;
  }
  params.append(key, String(value));
}

export function findHeaderValue(headers: Record<string, string>, name: string): string | undefined {
  const lc = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lc) return v;
  return undefined;
}
