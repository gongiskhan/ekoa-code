/**
 * automation/network-capture.ts - the hosted half of the capture layer (slice P2.2).
 *
 * Discovery drives a page vision-first. UNDERNEATH it, the machine records what the page's own
 * JavaScript asks the server for (`clients/bridge/src/browser/capture.ts`) and drains those
 * exchanges onto each observation. This module is what happens to them on arrival: the second
 * redaction boundary, the learner that distils them into lessons and replayable calls, and the
 * writer into the captures collection.
 *
 * ── THE SECOND REDACTION BOUNDARY (trap T8) ──────────────────────────────────────────────────
 *
 * The machine's leg (`OutboundRedactor`) knows every credential DELIVERED to that machine. This leg
 * knows every credential the RUN resolved - the Cofre bag the engine seeded into `RunContext.secrets`.
 * Neither is a superset of the other: a session cookie the site minted was never delivered to the
 * machine, and a credential the run resolved for a DIFFERENT integration was never on that page. So
 * both run, in that order, and the store then REFUSES anything that still matches
 * (`captured-calls-store.assertNoLiveSecret`). Three chances to catch a value, and the last one
 * fails the write rather than repairing it.
 *
 * Header NAMES survive all of it, deliberately. "Which header carries the session token" is the
 * learning that makes a replay possible; the token is worth nothing next run and is a durable
 * disclosure if written down. The wire shape has no field for a value, this module never constructs
 * one, and `automation/recipe.ts` brands the names so a value cannot be smuggled in as one.
 *
 * ── WHAT "LEARNING" MEANS HERE ───────────────────────────────────────────────────────────────
 *
 * Three things, and nothing model-authored: which of the site's own calls look like its internal
 * API (`internalApiCalls`), what those calls are shaped like (`compileInjectedCalls`), and a handful
 * of plain-English notes a later human or model can read (`deriveLessons`). All three are pure
 * functions over the captured exchanges - no LLM is involved in compiling a recipe, which is
 * exactly why the SECOND run costs no model calls.
 */
import type { LocalBrowserCapture } from '@ekoa/shared';
import {
  redactBodyByName,
  redactStream,
  redactUrlByName,
  type SecretRegistry,
} from '../security/redaction.js';
import type { CapturedCallInput } from '../integrations/captured-calls-store.js';
import { SECRET_SHAPED_INPUT_NAME } from './engine.js';
import { injectedCallFromExchange, type InjectedCall } from './recipe.js';
import { describeResponseShape } from './response-shape.js';
import type { ApiCallMethod } from './types.js';

/** One exchange, redacted hosted-side and ready either to be stored as evidence or to be distilled
 *  into a replayable call. Structurally a `CapturedCallInput` (so it goes straight to the store)
 *  plus the parsed helpers the learner needs. */
export interface CapturedExchange extends CapturedCallInput {
  method: string;
  url: string;
  requestHeaderNames: string[];
  responseHeaderNames: string[];
}

/** The header names that, when present on a site's own API call, are worth telling a human about.
 *  Not an authorisation input and not a filter - a NOTE. Which of these a site uses is the single
 *  most useful thing a discovery pass learns about it. */
const SESSION_BEARING_HEADERS: ReadonlySet<string> = new Set([
  'authorization', 'cookie', 'x-csrf-token', 'x-xsrf-token', 'x-auth-token',
  'x-api-key', 'x-session-id', 'x-requested-with', 'x-access-token', 'x-token',
]);

/** Query-parameter names that mean "there is more of this". A recipe that does not know a list is
 *  paginated replays page one forever and reports success. */
const PAGINATION_PARAMS: ReadonlySet<string> = new Set([
  'page', 'offset', 'limit', 'per_page', 'perpage', 'pagesize', 'page_size',
  'cursor', 'skip', 'take', 'start', 'count', 'from',
]);

/** Response header names that say the origin meters callers. Worth a lesson: a replay that fans out
 *  against a metered API is how a working recipe gets an account blocked. */
const RATE_HEADERS: ReadonlySet<string> = new Set([
  'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'x-rate-limit-limit',
]);

const API_CALL_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** How many distinct calls one compile may put in a recipe. Far below the store's own 200-call
 *  ceiling: a recipe that needs fifty calls has not been distilled, it has been transcribed. */
export const MAX_COMPILED_CALLS = 24;

/**
 * REDACT AND NORMALISE one frame's worth of exchanges.
 *
 * `secrets` is the run's registry - optional only because a discovery pass on an origin needing no
 * stored credential resolves none. When present, every URL and body passes it BEFORE the
 * name-pattern legs (`redactUrlByName` / `redactBodyByName`), which then catch the conventionally
 * named parameter whose value the registry never held.
 *
 * Header names that are not names are DROPPED here rather than refused. The machine already
 * filtered them and a live capture legitimately carries HTTP/2 pseudo-headers; refusing would make
 * an ordinary capture unusable. The REFUSING checks live at the two stores, where a name is
 * asserted to be one.
 */
export function redactCaptures(
  captures: readonly LocalBrowserCapture[],
  secrets?: SecretRegistry,
): CapturedExchange[] {
  return captures.map((capture) => {
    const body = (raw: string | undefined): string | undefined =>
      raw === undefined ? undefined : redactBodyByName(redactStream(raw, secrets));
    const requestBody = body(capture.requestBody);
    const responseBody = body(capture.responseBody);
    return {
      method: (capture.method ?? 'GET').toUpperCase(),
      url: redactUrlByName(secrets ? secrets.redact(capture.url) : capture.url),
      requestHeaderNames: normaliseNames(capture.requestHeaderNames),
      responseHeaderNames: normaliseNames(capture.responseHeaderNames),
      ...(capture.status !== undefined ? { status: capture.status } : {}),
      ...(requestBody !== undefined && requestBody !== '' ? { requestBody } : {}),
      ...(responseBody !== undefined && responseBody !== '' ? { responseBody } : {}),
      ...(capture.contentType !== undefined ? { contentType: capture.contentType } : {}),
      ...(capture.resourceType !== undefined ? { resourceType: capture.resourceType } : {}),
      ...(capture.durationMs !== undefined ? { durationMs: capture.durationMs } : {}),
    };
  });
}

/**
 * The exchanges that look like the site talking to ITSELF - the only ones a recipe replays.
 *
 * Three tests, all structural: it was issued by script (`xhr`/`fetch`, which is what an internal API
 * call is), it answered successfully, and it answered JSON. A `document` navigation is excluded even
 * though it is captured, because replaying it would fetch a page rather than data; a 302, a 404 and
 * an HTML error page are excluded because a recipe built from one replays a failure.
 */
export function internalApiCalls(exchanges: readonly CapturedExchange[]): CapturedExchange[] {
  return exchanges.filter((x) => {
    if (x.resourceType !== 'xhr' && x.resourceType !== 'fetch') return false;
    if (x.status === undefined || x.status < 200 || x.status >= 300) return false;
    if (!API_CALL_METHODS.has(x.method)) return false;
    const type = (x.contentType ?? '').toLowerCase();
    return type.includes('json');
  });
}

/**
 * DISTIL the site's own calls into replayable ones.
 *
 * `inputs` is what the run was given. Every string input value found in a URL is replaced by a
 * `{{input.<name>}}` hole, which is what turns "the call discovery happened to make" into "the call
 * this action makes for any argument". Longest values first, so a short input that is a substring
 * of a longer one cannot punch a hole through the middle of it.
 *
 * WHAT IS REFUSED RATHER THAN TEMPLATED (trap T8): a body whose field NAME is secret-shaped
 * (`SECRET_SHAPED_INPUT_NAME` - the same vocabulary the verifier may not extract into) never
 * becomes a `bodyTemplate`. A login POST is exactly the call a discovery pass captures first and
 * exactly the one that must not be replayable from a stored document; the call is dropped from the
 * compile, not stored with its body blanked, because a login with no password is not a call worth
 * replaying.
 */
export function compileInjectedCalls(
  exchanges: readonly CapturedExchange[],
  opts: { inputs?: Record<string, unknown>; max?: number } = {},
): InjectedCall[] {
  const holes = inputHoles(opts.inputs ?? {});
  const seen = new Set<string>();
  const out: InjectedCall[] = [];
  const max = opts.max ?? MAX_COMPILED_CALLS;

  for (const exchange of internalApiCalls(exchanges)) {
    if (out.length >= max) break;
    if (exchange.requestBody !== undefined && bodyIsSecretShaped(exchange.requestBody)) continue;
    const urlTemplate = applyHoles(exchange.url, holes);
    const bodyTemplate = exchange.requestBody === undefined ? undefined : applyHoles(exchange.requestBody, holes);
    // Deduplicate on the TEMPLATE, not the URL: a paginated list issues the same call ten times
    // with a different page, and once holed those are one call. Deduplicating on the raw URL would
    // put all ten in the recipe.
    const key = `${exchange.method} ${urlTemplate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const expectShape = expectShapeOf(exchange);
    out.push(
      injectedCallFromExchange({
        method: exchange.method as ApiCallMethod,
        urlTemplate,
        // THE ONE PLACE A HEADER MAP WOULD BE, AND THERE IS NONE. What arrives from the machine is
        // already names; they are re-offered as a map with empty values purely because
        // `injectedCallFromExchange` is the single constructor of a `HeaderName`, and it reads keys.
        headers: Object.fromEntries(exchange.requestHeaderNames.map((n) => [n, ''])),
        ...(bodyTemplate !== undefined ? { bodyTemplate } : {}),
        ...(expectShape !== undefined ? { expectShape } : {}),
      }),
    );
  }
  return out;
}

/**
 * The plain-English notes a discovery pass leaves behind.
 *
 * Deliberately few and deliberately not model-authored. Each one answers a question a later run (or
 * a later human) would otherwise have to re-derive by reading captures that no longer exist,
 * because the raw evidence is discarded once the recipe is compiled.
 */
export function deriveLessons(exchanges: readonly CapturedExchange[]): string[] {
  const api = internalApiCalls(exchanges);
  const lessons: string[] = [];

  const sessionHeaders = new Set<string>();
  for (const call of api) {
    for (const name of call.requestHeaderNames) if (SESSION_BEARING_HEADERS.has(name)) sessionHeaders.add(name);
  }
  if (sessionHeaders.size > 0) {
    lessons.push(`the session travels on ${[...sessionHeaders].sort().join(', ')} (header names; values are read live at replay)`);
  }

  const pagination = new Set<string>();
  for (const call of api) {
    for (const param of queryParamNames(call.url)) if (PAGINATION_PARAMS.has(param.toLowerCase())) pagination.add(param);
  }
  if (pagination.size > 0) {
    lessons.push(`results are paginated by ${[...pagination].sort().join(', ')}`);
  }

  const rate = new Set<string>();
  let throttled = false;
  for (const call of exchanges) {
    if (call.status === 429) throttled = true;
    for (const name of call.responseHeaderNames) if (RATE_HEADERS.has(name)) rate.add(name);
  }
  if (throttled) lessons.push('the origin answered 429 during discovery - replay must not fan out');
  else if (rate.size > 0) lessons.push(`the origin meters callers (${[...rate].sort().join(', ')})`);

  const origins = new Set<string>();
  for (const call of api) {
    const origin = originOf(call.url);
    if (origin) origins.add(origin);
  }
  if (origins.size > 1) {
    lessons.push(`the flow spans ${origins.size} origins: ${[...origins].sort().join(', ')}`);
  }
  return lessons;
}

// ------------------------------------------------------------------------------------------
// internals
// ------------------------------------------------------------------------------------------

/** RFC 7230 token, bounded - the grammar `automation/recipe.ts` brands and both stores re-prove. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

function normaliseNames(names: readonly string[] | undefined): string[] {
  return [...new Set((names ?? []).filter((n) => typeof n === 'string' && HEADER_NAME_RE.test(n)).map((n) => n.toLowerCase()))].sort();
}

function expectShapeOf(exchange: CapturedExchange): unknown {
  if (exchange.responseBody === undefined) return undefined;
  try {
    return describeResponseShape(JSON.parse(exchange.responseBody));
  } catch {
    // A body that will not parse teaches no shape. `undefined` means "no expectation", which the
    // drift check reads as "no evidence" - never as "the site changed".
    return undefined;
  }
}

/** Every string input value, longest first, paired with the hole that replaces it. */
function inputHoles(inputs: Record<string, unknown>): Array<{ value: string; hole: string }> {
  return Object.entries(inputs)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length >= 2)
    // A secret-shaped input NAME never becomes a hole, because a hole is a reference the replay
    // resolves - and a recipe that says "put the password here" is a recipe that needs a password.
    .filter(([name]) => !SECRET_SHAPED_INPUT_NAME.test(name))
    .map(([name, value]) => ({ value, hole: `{{input.${name}}}` }))
    .sort((a, b) => b.value.length - a.value.length);
}

function applyHoles(text: string, holes: ReadonlyArray<{ value: string; hole: string }>): string {
  let out = text;
  for (const { value, hole } of holes) {
    out = out.split(value).join(hole);
    // The URL-encoded form too: an input reaches a query string percent-encoded, and a recipe that
    // only holed the raw form would carry one tenant's argument as a literal.
    const encoded = encodeURIComponent(value);
    if (encoded !== value) out = out.split(encoded).join(hole);
  }
  return out;
}

/** True when any FIELD NAME in the body is secret-shaped. Names, not values: the body has already
 *  been redacted, so a surviving value proves nothing, while `"password":` proves what the call is. */
function bodyIsSecretShaped(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return anySecretShapedKey(parsed, 0);
  } catch {
    // Not JSON - a form post. `password=…` is the overwhelmingly common shape and is exactly what
    // must not be compiled, so the whole body is tested against the same vocabulary.
    return SECRET_SHAPED_INPUT_NAME.test(body);
  }
}

function anySecretShapedKey(value: unknown, depth: number): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => anySecretShapedKey(v, depth + 1));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_SHAPED_INPUT_NAME.test(k)) return true;
    if (anySecretShapedKey(v, depth + 1)) return true;
  }
  return false;
}

function queryParamNames(url: string): string[] {
  try {
    return [...new URL(url).searchParams.keys()];
  } catch {
    return [];
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
