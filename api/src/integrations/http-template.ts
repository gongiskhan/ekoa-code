/**
 * Shared HTTP-action templating for the two integration executors (platform-call.ts and
 * action-executor.ts): `{{name}}` placeholder interpolation with raw-value passthrough for
 * body templates, and credential-shaped redaction for the request/response dumps the
 * user-defined executor surfaces to the UI.
 *
 * The `$?` in the placeholder pattern lets Microsoft Graph OData params (`{{$top}}`,
 * `{{$filter}}`) interpolate; a plain `{{name}}` still matches.
 *
 * REDACTION (Cofre R-6): the value-keyed and name-pattern maskers that used to live here are now
 * `api/src/security/redaction.ts` — one implementation, shared with the automation executor, with
 * the historical `***…1234` plaintext-suffix leak and the silent sub-4-char skip both removed. The
 * wrappers below keep this module's published signatures for its existing call sites.
 */

import {
  SecretRegistry,
  secretRegistryFromValues,
  maskUnknownSecret,
  redactHeadersByName,
  redactBodyByName,
  redactUrlByName,
} from '../security/redaction.js';

export { SecretRegistry, secretRegistryFromValues };

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

/** @deprecated Use `maskUnknownSecret` from security/redaction.ts. Retained as a named re-export so
 *  the historical call sites keep compiling; the leaky `***…1234` suffix is GONE (Cofre R-6). */
export const maskValue = maskUnknownSecret;

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return redactHeadersByName(headers);
}

export function redactBody(raw: string): string {
  return redactBodyByName(raw);
}

/**
 * Redact a resolved request URL before it is persisted/surfaced on failure. A credential
 * interpolated into the query string (e.g. `?token=<secret>`) is otherwise stored in cleartext,
 * even when headers/body are redacted. Value-based: every occurrence of a decrypted credential
 * value is masked, then a secret-key-name pass catches conventionally-named params too.
 */
export function redactUrl(url: string, secretValues: string[]): string {
  return redactUrlByName(secretRegistryFromValues(secretValues).redact(url));
}

/** Mask every occurrence of a decrypted credential value in a string (value-based). */
export function redactSecretValuesIn(text: string, secretValues: string[]): string {
  return secretRegistryFromValues(secretValues).redact(text);
}

/**
 * Recursively mask any decrypted credential VALUE appearing in a returned data tree. Only the
 * CLIENT's own credential values are masked — a token the API legitimately RETURNS is a different
 * value and survives — so an integration that echoes the client's secret in a 2xx body cannot land
 * it in a captured/persisted step output (credential boundary, Codex G8).
 */
export function redactSecretsDeep(value: unknown, secretValues: string[]): unknown {
  if (!secretValues.length) return value;
  return secretRegistryFromValues(secretValues).redactDeep(value);
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
