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
 * name-pattern pass, which then catches the conventionally named parameter whose value the registry
 * NEVER HELD - a token the site itself minted, which is the commonest thing a discovery pass sees
 * and the one thing value-keyed redaction is structurally unable to find.
 *
 * The URL composes the two here (`redactUrlByName` after `secrets.redact`); the bodies get the
 * SAME pair pre-composed as `redactStream`. Both orders are the same order, and both are pinned in
 * `tests/automation/network-capture.test.ts` against a value the registry does not hold.
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
    // `redactStream` IS the pair: registry first, then the name-pattern pass. It was wrapped in a
    // second `redactBodyByName` here, which is the same transform applied twice - idempotent, so
    // harmless in effect, but it re-parsed and re-serialised every captured body on the
    // capture-persist path (the one path `redactBodyByName`'s own performance note is about), and
    // it made the leg look like two independent legs when it is one.
    const body = (raw: string | undefined): string | undefined =>
      raw === undefined ? undefined : redactStream(raw, secrets);
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

/** What one compile decided. A refusal is an ANSWER, not an exception: "this pass learned nothing
 *  storable" is an ordinary outcome of discovery, and the caller logs `refusedBecause` and moves on. */
export interface CompiledCalls {
  calls: InjectedCall[];
  /** Present ⇔ `calls` is empty BY REFUSAL rather than for want of material. */
  refusedBecause?: string;
  /**
   * WHICH compiled call produced the learning run's own answer, if any did. Indexes `calls`.
   *
   * Absent with a non-empty `calls` means the run produced NO structured answer to correlate (see
   * `runOutput`), never "we could not find it": a run whose answer no captured call produced is a
   * REFUSAL above, because a recipe that cannot reproduce the answer is a recipe that changes it.
   */
  answerCallIndex?: number;
}

/**
 * DISTIL the site's own calls into replayable ones.
 *
 * `inputs` is what the run was given. Every input value found in the URL is replaced by a
 * `{{input.<name>}}` hole, which is what turns "the call discovery happened to make" into "the call
 * this action makes for any argument". Longest values first, so a short input that is a substring
 * of a longer one cannot punch a hole through the middle of it.
 *
 * ── A HOLE IS A VALUE SLOT, AND ONLY EVER A VALUE SLOT ───────────────────────────────────────
 *
 * The URL is templated COMPONENT-WISE (`templateUrl`), not by search-and-replace over the whole
 * string, and that is a security property rather than tidiness. A replay runs inside the user's
 * live authenticated page, so WHICH endpoint it calls must be decided here, at compile time, and
 * never by an argument at run time. So:
 *
 *   - the ORIGIN is copied literally and is never offered a hole. The previous whole-string pass
 *     would happily template `https://{{input.tenant}}.portal.example/...` out of a URL whose host
 *     contained an argument, which is a recipe whose destination is caller data;
 *   - a QUERY PARAMETER NAME is copied literally; only its value is holed. A hole in a name lets a
 *     caller decide which parameter it is filling;
 *   - a PATH SEGMENT is holed as a whole segment (or within one), and `fillCall` re-proves at replay
 *     that the filled URL still has the same segment count and the same parameter names.
 *
 * ── AN ARGUMENT THIS PASS COULD NOT FIND REFUSES THE WHOLE COMPILE ───────────────────────────
 *
 * If an input value appears nowhere in what the site fetched, no hole is placed for it - and the
 * compiled call is then a CONSTANT. Every later run would replay the first run's exact request and
 * hand back the first run's data whatever the caller asked for: a silent wrong answer, which is
 * strictly worse than no recipe at all. So the compile refuses. Refusing to learn is a cost;
 * learning something that ignores its input is a defect that never surfaces.
 *
 * ── …AND SO DOES AN ARGUMENT THAT REACHES THE WIRE BUT NOT THE ANSWER ────────────────────────
 *
 * The check above is over the WHOLE recipe: an argument placed by ANY compiled call passes it. That
 * is the right unit for "can this argument reach the wire at all", and it is the WRONG unit for the
 * only question a caller can see the answer to. `answerCallIndex` names ONE call, `answerOf`
 * (`executors/injected-call.ts`) hands back THAT call's body, and nothing chains one replayed call
 * into the next: every template is filled from the run's arguments alone. So an argument absent from
 * the answer-bearing call cannot change what this action RETURNS, however faithfully the other calls
 * carry it.
 *
 * The shape is ordinary. A page fetches `GET /api/cases?ref=2024-1` and a `GET /api/summary` whose
 * body is the same document (a default view, a dashboard endpoint, a one-off page state), the run's
 * answer identity-matches both, LAST MATCH WINS names the summary - and the summary has no hole at
 * all. Every check passed: `ref` was placed by call 0, so the recipe-wide rule saw nothing missing,
 * and the replay's coverage rule was recipe-wide too. A later caller asking about `2025-9` then got
 * the 2024-1 document under `success: true, replayed: true`, with no drift (the calls still 200 with
 * the same shape), nothing to clear it, and no other symptom anywhere.
 *
 * So when a compile names an answer-bearing call, THAT call must carry every hole, or the compile
 * refuses. The two rules are one rule at two units and both are needed: the recipe-wide one is the
 * only one there is when the run answered nothing (no pointer, nothing to be wrong about), and the
 * answer-call one is the only one that speaks about the answer. `argumentCoverage`
 * (`executors/injected-call.ts`) now runs the same pair at REPLAY, because refusing only here leaves
 * every recipe an older build already stored - which is where this defect's population lives.
 *
 * A non-scalar argument (an object, an array) refuses for the same reason and one more: there is no
 * verbatim form of it to look for, so "it was honoured" is not a claim this compile can make.
 * Secret-shaped names are neither holed nor required to be found - see `inputHoles`.
 *
 * WHAT IS REFUSED RATHER THAN TEMPLATED (trap T8): a body whose field NAME is secret-shaped
 * (`SECRET_SHAPED_INPUT_NAME` - the same vocabulary the verifier may not extract into) never
 * becomes a `bodyTemplate`. A login POST is exactly the call a discovery pass captures first and
 * exactly the one that must not be replayable from a stored document; the call is dropped from the
 * compile, not stored with its body blanked, because a login with no password is not a call worth
 * replaying.
 *
 * ── AND THE COMPILE DECIDES WHICH CALL IS THE ANSWER ─────────────────────────────────────────
 *
 * `runOutput` is what the learning run ITSELF answered (`automation/service.ts`
 * `extractActionRunOutput`), and it is REQUIRED rather than optional - a caller that cannot say
 * would otherwise silently teach the recipe to answer nothing. Three cases, and the difference
 * between them is the difference between a replay and a lie:
 *
 *   - the run answered nothing (`undefined`): there is nothing to correlate and nothing to
 *     reproduce. `answerCallIndex` is absent and the replay answers nothing too, exactly as the
 *     run it replaces did. Every browser-only automation this repo ships is this case.
 *   - the run's answer IS one of the captured bodies: that call is the answer-bearing one. Matched
 *     by IDENTITY (canonical JSON), because anything looser - "the same shape", "the last JSON
 *     call" - is a guess that answers a different question on the run where it is wrong.
 *   - the run answered something no captured call produced: REFUSED. The recipe could only ever
 *     answer with some other call's body, so learning it would change what this action returns.
 *     Paying for the expensive path forever is the cheaper mistake.
 */
export function compileInjectedCalls(
  exchanges: readonly CapturedExchange[],
  opts: { inputs?: Record<string, unknown>; max?: number; runOutput: unknown },
): CompiledCalls {
  const { holes, unlocatable } = inputHoles(opts.inputs ?? {});
  if (unlocatable.length > 0) {
    return {
      calls: [],
      refusedBecause:
        `argument(s) ${unlocatable.sort().join(', ')} are not scalar values, so a compiled call cannot be ` +
        'proven to honour them - refusing to learn a recipe that would ignore them',
    };
  }
  /** Compiled-call index by `METHOD template`. The dedup key doubles as the correlation key: an
   *  exchange that repeats a call already in the recipe still names that call. */
  const indexByKey = new Map<string, number>();
  const out: InjectedCall[] = [];
  const placed = new Set<string>();
  /** What each KEPT call placed, by its index in `out`; `placed` is the union of these. Recorded
   *  per call because the answer-bearing one is judged on its own (see the header) - and the union
   *  cannot answer a question about one member of it. */
  const placedByCall: Array<Set<string>> = [];
  const max = opts.max ?? MAX_COMPILED_CALLS;
  /** The compiled call whose captured body IS the run's answer. LAST match wins, the same "last
   *  meaningful output" rule the run's own answer is read by.
   *
   *  IT IS NOT AN ARBITRARY CHOICE AMONG EQUALS, which is what this comment used to claim ("with
   *  identical bodies the choice is only about which template is recorded, never about what the
   *  caller gets back"). Two calls with the same body TODAY are two different calls tomorrow: one
   *  may carry the caller's argument and the other may be a constant. Which is why the check below
   *  exists - the tie is broken here, and then the winner has to prove it can carry the arguments. */
  let answerCallIndex: number | undefined;

  for (const exchange of internalApiCalls(exchanges)) {
    if (exchange.requestBody !== undefined && bodyIsSecretShaped(exchange.requestBody)) continue;
    // A URL this module cannot take apart is not one it may template: the whole safety argument
    // below rests on origin/path/query being separable.
    const templated = templateUrl(exchange.url, holes);
    if (!templated) continue;
    // Deduplicate on the TEMPLATE, not the URL: a paginated list issues the same call ten times
    // with a different page, and once holed those are one call. Deduplicating on the raw URL would
    // put all ten in the recipe.
    const key = `${exchange.method} ${templated.template}`;
    let index = indexByKey.get(key);
    if (index === undefined) {
      // The CEILING stops the recipe GROWING, not the scan: an exchange past it is still asked
      // whether it carried the run's answer, and if it did the compile refuses below rather than
      // storing a recipe that answers with something else. Nothing else is computed for it - a
      // body past the ceiling is never templated.
      if (out.length < max) {
        // Both halves record what they placed into a LOCAL set, merged only if the call is kept: an
        // argument located solely in a call this compile then drops is not an argument the recipe
        // honours, and counting it would let the located-argument check below pass on a call that
        // is not in the recipe.
        const bodyPlaced = new Set<string>();
        const bodyTemplate = exchange.requestBody === undefined
          ? undefined
          : templateBody(exchange.requestBody, holes, bodyPlaced);
        index = out.length;
        indexByKey.set(key, index);
        for (const name of templated.placed) placed.add(name);
        for (const name of bodyPlaced) placed.add(name);
        // The same names again, kept APART by call. `placedByCall[index]` is pushed in lockstep
        // with `out`, so the two stay aligned for the answer-call check below.
        placedByCall.push(new Set([...templated.placed, ...bodyPlaced]));
        const expectShape = expectShapeOf(exchange);
        out.push(
          injectedCallFromExchange({
            method: exchange.method as ApiCallMethod,
            urlTemplate: templated.template,
            // THE ONE PLACE A HEADER MAP WOULD BE, AND THERE IS NONE. What arrives from the machine
            // is already names; they are re-offered as a map with empty values purely because
            // `injectedCallFromExchange` is the single constructor of a `HeaderName`, and it reads keys.
            headers: Object.fromEntries(exchange.requestHeaderNames.map((n) => [n, ''])),
            ...(bodyTemplate !== undefined ? { bodyTemplate } : {}),
            ...(expectShape !== undefined ? { expectShape } : {}),
          }),
        );
      }
    }
    if (index !== undefined && isTheRunsAnswer(exchange, opts.runOutput)) answerCallIndex = index;
  }

  if (out.length === 0) return { calls: [] };
  const missed = holes.filter((h) => !placed.has(h.name)).map((h) => h.name);
  if (missed.length > 0) {
    return {
      calls: [],
      refusedBecause:
        `argument(s) ${[...new Set(missed)].sort().join(', ')} appear nowhere in what this pass captured, so the ` +
        'compiled call would be a constant that returns this run\'s data for every later caller - refusing to learn it',
    };
  }
  // ── THE ANSWER MUST BE REPRODUCIBLE, OR THERE IS NO RECIPE ───────────────────────────────
  // A run that answered something none of these calls returned cannot be replayed by them: the
  // replay would hand back a DIFFERENT call's body under the same `success: true`. That is the one
  // failure mode a caller cannot see, so it is refused here rather than discovered in production.
  if (opts.runOutput !== undefined && answerCallIndex === undefined) {
    return {
      calls: [],
      refusedBecause:
        'the run answered with something none of the captured calls returned, so a replay of them could only ever '
        + 'answer with a different call\'s body - refusing to learn a recipe that changes this action\'s answer',
    };
  }
  // ── …AND THE CALL THAT CARRIES IT MUST CARRY THE ARGUMENTS TOO ───────────────────────────
  // `missed` above is the RECIPE's coverage; this is the ANSWER's. Nothing chains one replayed
  // call into the next, so an argument the answer-bearing call has no hole for cannot change what
  // this action returns - the replay would hand every later caller this run's answer. See the
  // header: that is the same silent-wrong-answer failure the rule above refuses, at the one unit
  // the caller can actually observe.
  if (answerCallIndex !== undefined) {
    const answerPlaced = placedByCall[answerCallIndex] ?? new Set<string>();
    const constant = holes.filter((h) => !answerPlaced.has(h.name)).map((h) => h.name);
    if (constant.length > 0) {
      return {
        calls: [],
        refusedBecause:
          `argument(s) ${[...new Set(constant)].sort().join(', ')} reach the wire but not the call that produced this `
          + 'run\'s answer, so every later caller would be handed this run\'s answer whatever they asked for '
          + '- refusing to learn it',
      };
    }
  }
  return { calls: out, ...(answerCallIndex !== undefined ? { answerCallIndex } : {}) };
}

/**
 * Did THIS exchange produce the run's own answer?
 *
 * Identity over the parsed JSON, key order made irrelevant (`canonicalJson`) because two encodings
 * of the same document are the same answer and a re-serialisation between the run record and the
 * capture is not a difference the caller can ever see. Anything looser is a guess.
 */
function isTheRunsAnswer(exchange: CapturedExchange, runOutput: unknown): boolean {
  if (runOutput === undefined) return false;
  if (exchange.responseBody === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(exchange.responseBody);
  } catch {
    // Not JSON. `internalApiCalls` already filtered to JSON content types, so this is a truncated or
    // malformed body - which teaches nothing and certainly does not prove it carried the answer.
    return false;
  }
  return canonicalJson(parsed) === canonicalJson(runOutput);
}

/** A stable string for a JSON value: object keys sorted, array order preserved. `undefined` members
 *  and non-JSON leaves collapse the same way on both sides, which is all identity needs here. */
function canonicalJson(value: unknown): string {
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 32 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((entry) => walk(entry, depth + 1));
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = walk((v as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  };
  return JSON.stringify(walk(value, 0)) ?? 'undefined';
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

/** One argument, and the hole that stands in for it. */
interface InputHole {
  name: string;
  value: string;
  hole: string;
}

/**
 * The shortest value this compile will look for INSIDE a longer string.
 *
 * A whole path segment or a whole query value is matched exactly at any length - `?page=1` is an
 * unambiguous placement. An EMBEDDED match is a guess ("2024-1" inside the slug "case-2024-1"), and
 * below three characters it is a guess that fires everywhere.
 */
const MIN_EMBEDDED_HOLE_CHARS = 3;

/**
 * Every argument that can become a hole, longest first, plus the ones that cannot be looked for.
 *
 * `unlocatable` is the refusal list: a non-scalar argument has no verbatim form in a URL, so no
 * compile can show it was honoured. A `null`/`undefined` argument carries nothing to find and is
 * simply not an argument this pass saw - it is neither holed nor refused.
 *
 * A secret-shaped input NAME is excluded from BOTH lists. It never becomes a hole, because a hole is
 * a reference the replay resolves and a recipe that says "put the password here" is a recipe that
 * needs a password; and it is never required to be found, because a credential legitimately appears
 * nowhere in a URL.
 */
function inputHoles(inputs: Record<string, unknown>): { holes: InputHole[]; unlocatable: string[] } {
  const holes: InputHole[] = [];
  const unlocatable: string[] = [];
  for (const [name, value] of Object.entries(inputs)) {
    if (SECRET_SHAPED_INPUT_NAME.test(name)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      holes.push({ name, value: String(value), hole: `{{input.${name}}}` });
      continue;
    }
    unlocatable.push(name);
  }
  return { holes: holes.sort((a, b) => b.value.length - a.value.length), unlocatable };
}

/** A URL taken apart, templated component by component, and put back together. `null` for anything
 *  this module cannot separate into origin/path/query - which is the only shape it may template. */
function templateUrl(raw: string, holes: readonly InputHole[]): { template: string; placed: string[] } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // USERINFO IS A CREDENTIAL IN A URL. Never templated and never stored - the call is dropped.
  if (url.username !== '' || url.password !== '') return null;

  const placed = new Set<string>();
  // THE ORIGIN IS COPIED, NEVER OFFERED A HOLE. See the header of `compileInjectedCalls`.
  const path = url.pathname.split('/').map((segment) => holeInValue(segment, holes, placed)).join('/');
  const query = url.search === ''
    ? ''
    : `?${url.search.slice(1).split('&').map((pair) => holeInPair(pair, holes, placed)).join('&')}`;
  // The FRAGMENT is dropped: it never reaches the server, so templating it would be a hole whose
  // filling changes nothing and whose presence would make `fillCall` demand an argument for it.
  return { template: `${url.origin}${path}${query}`, placed: [...placed] };
}

/** One `name=value` pair. The NAME is copied literally - an argument may not choose which parameter
 *  it is filling - and a bare flag (`?archived`) has no value slot at all. */
function holeInPair(pair: string, holes: readonly InputHole[], placed: Set<string>): string {
  const eq = pair.indexOf('=');
  if (eq < 0) return pair;
  return `${pair.slice(0, eq)}=${holeInValue(pair.slice(eq + 1), holes, placed)}`;
}

/** One value slot - a path segment or a query value. Exact match first (at any length), then an
 *  embedded match for values long enough to be more than a coincidence. */
function holeInValue(text: string, holes: readonly InputHole[], placed: Set<string>): string {
  if (text === '') return text;
  const decoded = safeDecode(text);
  for (const h of holes) {
    if (text === h.value || decoded === h.value) {
      placed.add(h.name);
      return h.hole;
    }
  }
  let out = text;
  for (const h of holes) {
    if (h.value.length < MIN_EMBEDDED_HOLE_CHARS) continue;
    const encoded = encodeURIComponent(h.value);
    if (out.includes(h.value)) {
      out = out.split(h.value).join(h.hole);
      placed.add(h.name);
    } else if (encoded !== h.value && out.includes(encoded)) {
      out = out.split(encoded).join(h.hole);
      placed.add(h.name);
    }
  }
  return out;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The request body, templated by substring.
 *
 * Unlike the URL there is no structure to lean on - a body is JSON, or a form, or something a site
 * invented - so this stays a search-and-replace, and `fillCall` re-proves at replay that a filled
 * JSON body is still the same JSON document rather than a new one an argument wrote.
 */
function templateBody(raw: string, holes: readonly InputHole[], placed: Set<string>): string {
  let out = raw;
  for (const h of holes) {
    if (h.value.length < 2) continue;
    if (out.includes(h.value)) {
      out = out.split(h.value).join(h.hole);
      placed.add(h.name);
    }
    const encoded = encodeURIComponent(h.value);
    if (encoded !== h.value && out.includes(encoded)) {
      out = out.split(encoded).join(h.hole);
      placed.add(h.name);
    }
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
