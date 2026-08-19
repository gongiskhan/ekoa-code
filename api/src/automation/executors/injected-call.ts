/**
 * automation/executors/injected-call.ts - REPLAY a compiled recipe (slice P2.3).
 *
 * This is the module that makes the second run cheap. The first run watched the site talk to itself
 * and left behind the calls its own UI makes; this replays them, with no model in the loop at all.
 *
 * ── THE LADDER, CHEAPEST-RELIABLE FIRST ──────────────────────────────────────────────────────
 *
 *   1. IN-PAGE FETCH (`browser.injectCall`). The default, and it is first on RELIABILITY as much as
 *      on cost: a `fetch` running in the authenticated page inherits the origin, the cookie jar
 *      (HttpOnly and SameSite=Strict included), the TLS session and the IP. Nothing else does.
 *   2. RAW NODE HTTP, and only for a PERMISSIVE origin. It inherits none of the above, which is
 *      exactly why it is restricted: against a site that scores callers, a datacenter request with
 *      no cookie jar is not a slower path, it is a 401 and a detection event. `origin-posture.ts`
 *      answers whether the origin tolerates it, and its default is closed.
 *   3. SCRIPTED DOM STEPS with the recipe's learned locators, for what genuinely cannot be a call.
 *   4. VISION - NOT here. Rung 4 is the CALLER's fallthrough: this function answers `no-recipe` or
 *      `drift` and the ordinary vision-driven path runs, which is also what re-authors the recipe
 *      (`self-heal.ts`). Vision as a rung inside the replay would make a "deterministic" replay
 *      quietly cost model calls, which is precisely the property this slice exists to guarantee.
 *
 * ── POSTURE IS RESOLVED PER CALL, AGAINST THE ORIGIN THAT CALL TARGETS ───────────────────────
 *
 * A recipe is a LIST of calls and a flow routinely spans more than one host (the portal, then its
 * document CDN, then an identity provider). Resolving the posture once - from the first call, or
 * from the action - and applying it to the list would mean a permissive first hop authorising
 * server-side egress against every later hop, including hosts the author never classified. So
 * `classify` is a FUNCTION here, not a value, and it is asked once per call about that call's own
 * origin.
 *
 * The whole ladder is nevertheless resolved BEFORE the first call runs (`planRoutes`): a recipe
 * with one reachable call and one unreachable one answers `unavailable` having sent nothing, rather
 * than half-replaying and leaving the caller to reason about which half landed.
 *
 * ── THE ORIGIN BELONGS TO THE RECIPE, NEVER TO THE ARGUMENTS ─────────────────────────────────
 *
 * `{{input.*}}` holes are filled from the run's arguments, and an argument is caller data. A hole
 * inside the ORIGIN of a template would therefore let a caller point a replay - carrying the live
 * session of an authenticated page - at any host it liked. The compile never puts a hole there
 * (`network-capture.ts` templates path segments and query values only), and `resolveCall` re-proves
 * it: the resolved URL's origin must equal the template's literal origin, or the replay refuses.
 *
 * ── THE HOLES AND THE ARGUMENTS ARE THE SAME SET, PROVED BOTH WAYS ───────────────────────────
 *
 * A MISSING ARGUMENT IS A REFUSAL, NOT AN EMPTY STRING. `interpolate` renders an absent input as
 * ''. For a step description that is harmless; for a replayed query it silently WIDENS the call -
 * `?ref={{input.ref}}` with no `ref` becomes `?ref=`, which on most APIs means "everything". A
 * replay that fetches more than it was asked for is worse than a replay that does not happen, so
 * every hole a template names must be supplied (`assertHolesSupplied`).
 *
 * AND AN ARGUMENT WITH NO HOLE IS A REFUSAL TOO, for the mirror-image reason: a call with no hole
 * for it is a CONSTANT with respect to it, so the replay fetches whatever the recipe was compiled
 * around, hands it back, and reports SUCCESS while the caller's actual question went unasked. The
 * compile already refuses to LEARN that shape; refusing it only there leaves every recipe written
 * by an older build, and every caller that starts passing a new argument, replaying a constant
 * (`assertEveryArgumentHasAHole`).
 *
 * ── THE RECIPE IS READ THROUGH `recipe-store`, NEVER THROUGH `resolveDefinition` ──────────────
 *
 * The definition read projection deliberately STRIPS recipes (`actionsWithoutRecipes`) so a
 * tenant's learning cannot reach the wire or a published snapshot. A replay that resolved its
 * definition the ordinary way would therefore find no recipe and silently fall back to vision
 * forever - a performance bug that looks like a working system. `recipe-store.getRecipe` is the
 * org-scoped read that exists for exactly this caller.
 *
 * ── IDEMPOTENCY IS A GATE, NOT A HINT (trap T4) ──────────────────────────────────────────────
 *
 * `InjectedCall.idempotent` was decided ONCE, at compile time, from the method. A GET replays
 * freely - that is the whole point. Anything else is a WRITE, and an unattended replay of a write
 * is how one recipe becomes ten duplicate submissions. So is a SCRIPTED DOM STEP: a `click` on a
 * live authenticated page is a side effect whatever the recipe calls it, and the first version of
 * this module replayed those with no gate at all. Both stop at the same gate, and it is checked
 * BEFORE any call runs so a partial replay cannot leave the site half-mutated.
 *
 * ── WHAT THE GATE'S KEY IS, AND WHAT IT IS NOT ───────────────────────────────────────────────
 *
 * `writeAssent` is the answer the owner gave to this ACTION's write approval
 * (`integrations/action-consent.ts`), carried across the automation seam. It is deliberately NOT
 * treated as authority over an arbitrary compiled call set: approving "send_message may write" is
 * not approving "issue these four POSTs to these four URLs", and nothing in this slice ever shows a
 * human a compiled call set. So `learnFromRun` (`automation/service.ts`) refuses to STORE a recipe
 * containing a write at all, and this gate is the second, independent line - for a recipe written
 * by an older build, or one whose site turned a GET into a POST.
 *
 * WHAT HAPPENS AFTER THE REFUSAL IS THE CALLER'S DECISION, and it is the difference between a safe
 * optimisation and a permanently broken action: `runAutomationForAction` CLEARS the offending
 * recipe and runs the action's authored steps - which are what the human approved - rather than
 * failing the action forever on a consent nobody could give. The long note there explains why the
 * old `awaiting_consent` answer was unreachable-as-useful.
 */
import { RecipeShapeError, parseCompiledRecipe, type CompiledRecipe, type InjectedCall } from '../recipe.js';
import { parseResponseShape, shapeMismatch } from '../response-shape.js';
import { SECRET_SHAPED_INPUT_NAME } from '../engine.js';
import { guardedFetch } from '../../services/url-fetcher.js';
import type { SecretRegistry } from '../../security/redaction.js';
import type { OriginClassification } from '../origin-posture.js';
import type { BrowserSession } from '../browser-session.js';
import type { ApiCallMethod, InjectedCallResolved, Locator, PlaywrightAction } from '../types.js';

/** Cap on a replayed body kept for the caller. It becomes a step output and, on a drift, a prompt. */
export const MAX_REPLAY_BODY_CHARS = 256 * 1024;

/**
 * Scripted verbs that only OBSERVE the page. Everything else - click, fill, check, select - changes
 * it, and on an authenticated page changing it is a write. The list is deliberately tiny and
 * allow-shaped: a verb this build does not recognise counts as a write.
 */
const READ_ONLY_SCRIPTED_VERBS: ReadonlySet<string> = new Set(['hover', 'scroll', 'screenshot', 'wait', 'wait_for', 'noop']);

/** One replayed call's outcome, as the run record sees it. */
export interface ReplayedCall {
  resolved: InjectedCallResolved;
  status: number;
  /** Parsed when the answer was JSON, the raw text otherwise. VALUES - never persisted by this
   *  module; the caller decides what to do with them, exactly as the `api_call` executor does. */
  body: unknown;
  durationMs: number;
}

export type ReplayResult =
  /** Every call ran and every expectation held. `data` is the LAST call's body - the same "last
   *  meaningful output wins" rule `extractActionRunOutput` already applies to a run. */
  | { outcome: 'ok'; calls: ReplayedCall[]; data: unknown; recipeVersion: number }
  /**
   * No recipe, one this build cannot read, or one that cannot carry THIS run's arguments (a hole
   * nothing supplied, an argument no hole can take). The caller runs the ordinary vision path,
   * which sees every argument - so the answer is still right, it is merely not cheap.
   */
  | { outcome: 'no-recipe'; reason: string }
  /** The site answered differently than the recipe expects. Routes to `self-heal.ts`. */
  | { outcome: 'drift'; reason: string; recipeVersion: number; failedIndex: number }
  /**
   * Something in this recipe writes and no human has assented to it (trap T4).
   *
   * `blocked` names the offending call or step by its TEMPLATE - never by a resolved URL - because
   * this string reaches an error message and a resolved URL carries the caller's arguments.
   */
  | { outcome: 'write-gate'; blocked: string; recipeVersion: number }
  /**
   * THE RECIPE DOES NOT DO WHAT THE ACTION EXISTS TO DO (the read-learns-a-write shape).
   *
   * The action is declared `mutates`, and the recipe compiled from watching it contains no write at
   * all. Replaying it would issue the reads, answer `ok`, and report SUCCESS while the write never
   * happened - the worst failure shape this spine can have, because nobody finds out until somebody
   * checks the far system. So the replay refuses, and the caller runs the path that DOES write.
   */
  | { outcome: 'does-not-cover'; reason: string; recipeVersion: number }
  /** There is a readable recipe but no route that may carry it (no session, adversarial origin). */
  | { outcome: 'unavailable'; reason: string; recipeVersion: number };

export interface ReplayInput {
  /** The OWNING org. Never read off a request body - the run carries its owner's verified org. */
  orgId: string;
  integrationKey: string;
  actionName: string;
  /** The run's arguments; they fill the recipe's `{{input.*}}` holes. */
  args: Record<string, unknown>;
  /** The authenticated session. Absent ⇒ only a permissive origin can be replayed at all. */
  browser?: BrowserSession;
  /**
   * Resolve ONE origin's posture. A FUNCTION, and asked once per call: see the module header - a
   * recipe spans origins and a single verdict for the list is a verdict for the wrong unit.
   */
  classify: (origin: string) => OriginClassification;
  /** The run's registry. Used only to PROVE no credential rode into a resolved URL or body. */
  secrets?: SecretRegistry;
  /**
   * A human has already assented to this action's writes. Absent/false ⇒ anything non-idempotent
   * stops at the gate. Never defaulted true, in any mode.
   */
  writeAssent?: boolean;
  /**
   * THE ACTION'S DECLARED EFFECT (`IntegrationAction.mutates`), carried down from the executor.
   *
   * Distinct from `writeAssent`, which says a human APPROVED the write. This says the action IS one,
   * and it is what the coverage check below is judged against: a recipe with no write in it cannot
   * be the whole of an action that writes, however freely it replays.
   *
   * REQUIRED. The field is optional only at the seam the executor hands it across, where Rule 7
   * forbids an added field from changing an existing implementer; `runAutomationForAction` reads it
   * fail-closed there (only a literal `false` is a read - `integrations/action-consent.ts`) and
   * everything below is handed the answer. An OPTIONAL boolean here would mean this module had to
   * re-decide what an absent value means, and the first cut of it decided wrong: `=== true`, so an
   * action whose `mutates` never arrived - or arrived as `"false"`, or `0` - replayed a read-only
   * recipe and reported success for a write that never happened.
   */
  mutates: boolean;
}

export interface ReplayDeps {
  /** The org-scoped recipe read. Injected so the unit lane needs no store. */
  loadRecipe: (orgId: string, key: string, actionName: string) => Promise<unknown>;
  now?: () => number;
  fetchImpl?: (url: string, opts: { method: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) => Promise<{ status: number; text: () => Promise<string>; headers?: { get(name: string): string | null } }>;
}

/** One call, resolved and routed, before anything has been sent. */
interface PlannedCall {
  call: InjectedCall;
  resolved: InjectedCallResolved;
}

/**
 * Replay one action's compiled recipe.
 *
 * EVERY non-`ok` outcome is a FALL-THROUGH, not a failure: the caller runs the action the ordinary
 * way. That asymmetry is deliberate - a replay is an optimisation, and an optimisation that can
 * break an action is worse than no optimisation. The one exception is `write-gate`, which is a
 * refusal the caller must surface rather than route around.
 */
export async function replayCompiledAction(input: ReplayInput, deps: ReplayDeps): Promise<ReplayResult> {
  const now = deps.now ?? Date.now;
  const stored = await deps.loadRecipe(input.orgId, input.integrationKey, input.actionName);
  if (stored === null || stored === undefined) {
    return { outcome: 'no-recipe', reason: 'this action has never been discovered' };
  }
  const recipe = parseCompiledRecipe(stored);
  if (!recipe) {
    // A stored recipe this build cannot read is sent back through discovery rather than
    // half-executed. It is replayed against a live authenticated session; a half-understood one is
    // the one case where "do less" is unambiguously right.
    return { outcome: 'no-recipe', reason: 'the stored recipe is not in a shape this build can replay' };
  }
  if (recipe.injectedCalls.length === 0) {
    return { outcome: 'no-recipe', reason: 'the recipe compiled no replayable call (this flow is DOM-only)' };
  }

  // ── DOES THIS RECIPE DO THE ACTION'S JOB? ─────────────────────────────────────────────────
  //
  // Checked BEFORE the write gate, because the two answers mean opposite things and the caller
  // dispatches on them differently: `write-gate` says "this recipe writes and nobody approved it",
  // `does-not-cover` says "this recipe does NOT write and the action must". Only the second is a
  // reason to go and run the expensive path so the write actually happens.
  //
  // `learnFromRun` refuses to STORE either shape for a mutating action, so in a healthy system this
  // never fires. It is the second, independent line - for a recipe written by an older build, or
  // one whose action was re-declared `mutates` after it was learned.
  if (input.mutates && firstWrite(recipe) === undefined) {
    return {
      outcome: 'does-not-cover',
      reason:
        'this action is declared as writing and its compiled recipe contains no write - replaying it '
        + 'would report success without performing the action',
      recipeVersion: recipe.version,
    };
  }

  // ── THE WRITE GATE, BEFORE ANYTHING RUNS (trap T4) ────────────────────────────────────────
  // Checked over the WHOLE recipe - both halves of it - not per call as the ladder reaches it:
  // stopping at call four of six would leave the site with three calls already applied and a run
  // that has to be resumed into an unknown state.
  if (!input.writeAssent) {
    const blocked = firstWrite(recipe);
    if (blocked) return { outcome: 'write-gate', blocked, recipeVersion: recipe.version };
  }

  // ── EVERY ARGUMENT MUST BE ABLE TO REACH THE WIRE ─────────────────────────────────────────
  // Checked over the WHOLE recipe, before the per-call fill: an argument may legitimately be
  // honoured by the third call and by no other, so the question "can this argument land anywhere"
  // has no answer at the level of one call. See `assertEveryArgumentHasAHole`.
  try {
    assertEveryArgumentHasAHole(recipe, input.args);
  } catch (err) {
    return { outcome: 'no-recipe', reason: err instanceof Error ? err.message : String(err) };
  }

  // ── RESOLVE AND ROUTE EVERY CALL FIRST ────────────────────────────────────────────────────
  const planned: PlannedCall[] = [];
  for (const call of recipe.injectedCalls) {
    let filled: FilledCall;
    try {
      filled = fillCall(call, input.args);
    } catch (err) {
      // A template that will not resolve - not absolute, an unsupplied hole, an origin the
      // arguments moved - is a recipe problem, not a site problem: back through the ordinary path.
      return { outcome: 'no-recipe', reason: err instanceof Error ? err.message : String(err) };
    }
    // POSTURE, FOR THIS CALL'S OWN ORIGIN. Asked here rather than once for the recipe, because a
    // flow spans hosts and the first hop's classification says nothing about the third's.
    const route = chooseRoute(input, filled.origin);
    if (route === null) {
      return {
        outcome: 'unavailable',
        reason: input.browser
          ? 'the session cannot replay a call in the page'
          : `no authenticated session, and ${filled.origin} is ${input.classify(filled.origin).posture} so a server-side request is not permitted`,
        recipeVersion: recipe.version,
      };
    }
    const resolved: InjectedCallResolved = {
      kind: 'injected_call',
      method: call.method as ApiCallMethod,
      url: filled.url,
      headerNames: [...call.headerNames],
      ...(filled.body !== undefined ? { body: filled.body } : {}),
      idempotent: call.idempotent,
      route: route.route,
      posture: route.posture,
      recipeVersion: recipe.version,
    };
    assertNoCredentialRodeIn(resolved, input.secrets);
    planned.push({ call, resolved });
  }

  const calls: ReplayedCall[] = [];
  for (let index = 0; index < planned.length; index += 1) {
    const { call, resolved } = planned[index]!;
    const startedAt = now();
    let status: number;
    let text: string;
    try {
      ({ status, text } = resolved.route === 'in-page'
        ? await runInPage(input.browser!, resolved)
        : await runOverHttp(resolved, deps));
    } catch (err) {
      // The call could not be MADE. That is drift too - a route that used to work no longer does -
      // and it is the self-heal path rather than a run failure.
      return {
        outcome: 'drift',
        reason: `replayed call ${index + 1} could not be made: ${err instanceof Error ? err.message : String(err)}`,
        recipeVersion: recipe.version,
        failedIndex: index,
      };
    }

    if (status < 200 || status >= 300) {
      return {
        outcome: 'drift',
        reason: `replayed call ${index + 1} answered ${status}`,
        recipeVersion: recipe.version,
        failedIndex: index,
      };
    }

    const body = parseBody(text);
    const mismatch = expectationMismatch(call, body);
    if (mismatch.length > 0) {
      return {
        outcome: 'drift',
        reason: `replayed call ${index + 1} no longer carries ${mismatch.slice(0, 5).join(', ')}`,
        recipeVersion: recipe.version,
        failedIndex: index,
      };
    }
    calls.push({ resolved, status, body, durationMs: now() - startedAt });
  }

  await runScriptedSteps(recipe, input.browser);
  return { outcome: 'ok', calls, data: calls[calls.length - 1]?.body, recipeVersion: recipe.version };
}

// ------------------------------------------------------------------------------------------
// the write gate
// ------------------------------------------------------------------------------------------

/**
 * The first thing in this recipe that WRITES, described by its template, or undefined.
 *
 * Both halves are checked. The injected calls declare `idempotent` at compile time; the scripted
 * steps declare nothing, so they are judged by their verb against a tiny read-only allow-list -
 * and an unrecognised verb counts as a write, because the alternative is a new verb arriving in a
 * stored recipe and replaying ungated.
 */
function firstWrite(recipe: CompiledRecipe): string | undefined {
  for (const call of recipe.injectedCalls) {
    if (!call.idempotent) return `${call.method} ${call.urlTemplate}`;
  }
  for (const step of recipe.scriptedSteps) {
    if (!READ_ONLY_SCRIPTED_VERBS.has(step.action)) return `the scripted step "${step.action}"`;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------
// the rungs
// ------------------------------------------------------------------------------------------

/**
 * Which rung may carry THIS call, and what its origin was classified as.
 *
 * POSTURE IS RESOLVED FOR EVERY CALL ON EVERY RUNG, which it was not: the first version returned
 * `in-page` before asking, so a replay holding a browser session never classified anything at all
 * and the run record could not say what the system believed about the hosts it spoke to.
 *
 * WHAT POSTURE DOES AND DOES NOT DECIDE HERE, stated at the decision point because a reviewer
 * reading a posture-gated ladder will otherwise assume it gates both rungs:
 *
 *   - `node-http` IS gated by it. A server-side request inherits no session and arrives from a
 *     datacenter, so against an adversarial origin it is not a fallback, it is a 401 and a
 *     detection event. Closed by default.
 *   - `in-page` IS NOT, deliberately. In-page is the rung an adversarial origin REQUIRES - it is
 *     the site's own page making the call it already makes - so refusing it for adversarial would
 *     disable the ladder precisely where it is the only thing that works, and a multi-origin
 *     recipe (portal, then its document CDN) would stop at the second hop. What bounds this rung is
 *     not posture but PROVENANCE: every origin in a recipe was compiled from traffic the site's own
 *     page generated, `recipe-store` refuses a recipe carrying a value, and `fillCall` refuses an
 *     argument that moves the host. Nobody outside the site chooses where this rung goes.
 *
 * There is no "no session, adversarial origin, try HTTP anyway": that combination answers null and
 * the caller falls back to the ordinary path, which is where the daemon and credential rails get
 * their chance to ask for what is missing.
 */
function chooseRoute(
  input: ReplayInput,
  origin: string,
): { route: 'in-page' | 'node-http'; posture: 'permissive' | 'adversarial' } | null {
  const posture = input.classify(origin).posture;
  if (input.browser && typeof input.browser.injectCall === 'function') return { route: 'in-page', posture };
  if (posture === 'permissive') return { route: 'node-http', posture };
  return null;
}

async function runInPage(
  browser: BrowserSession,
  resolved: InjectedCallResolved,
): Promise<{ status: number; text: string }> {
  const result = await browser.injectCall!({
    method: resolved.method,
    url: resolved.url,
    headerNames: resolved.headerNames,
    ...(resolved.body !== undefined ? { body: resolved.body, contentType: 'application/json' } : {}),
  });
  return { status: result.status, text: result.bodyText };
}

/**
 * The server-side rung. `guardedFetch` rather than bare `fetch`, so the SSRF guard that every other
 * server-side request in this repo passes applies here too - a recipe is authored from a captured
 * URL and a captured URL is data, so "the recipe said so" is not a reason to dial an address.
 *
 * NO CREDENTIAL IS ATTACHED, and none can be: this rung forwards no header values because there is
 * nowhere hosted-side that holds them. It works for a permissive origin whose data is reachable
 * without a session, and it is honest about being nothing more than that.
 */
async function runOverHttp(
  resolved: InjectedCallResolved,
  deps: ReplayDeps,
): Promise<{ status: number; text: string }> {
  const doFetch = deps.fetchImpl
    ?? (async (url, opts) => guardedFetch(url, {
      method: opts.method,
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    }));
  const res = await doFetch(resolved.url, {
    method: resolved.method,
    ...(resolved.body !== undefined ? { headers: { 'content-type': 'application/json' }, body: resolved.body } : {}),
  });
  const text = await res.text();
  return { status: res.status, text: text.length > MAX_REPLAY_BODY_CHARS ? text.slice(0, MAX_REPLAY_BODY_CHARS) : text };
}

/**
 * Rung 3: the learned DOM interactions, after the calls.
 *
 * AFTER, not interleaved, and that ordering is the honest reading of what a scripted step is for in
 * this design: the calls fetch, the DOM work is whatever the flow needs a real page for (a
 * download, a form the site has no API for). A recipe compiled by the learn path carries none - the
 * compile is calls-only - so this loop is normally empty, and it exists so a hand-authored or later
 * compiled recipe is not silently ignored. Anything it can run that is not read-only has already
 * been through the write gate above.
 */
async function runScriptedSteps(recipe: CompiledRecipe, browser?: BrowserSession): Promise<void> {
  if (recipe.scriptedSteps.length === 0 || !browser) return;
  for (const step of recipe.scriptedSteps) {
    await browser.act(playwrightActionFor(step.action, step.locator, step.value));
  }
}

/** A scripted step's `(kind, locator, value)` back to the engine's action union. Only the verbs a
 *  locator-plus-value can express are honoured; anything else is skipped rather than approximated
 *  into a different action. */
function playwrightActionFor(kind: string, locator: Locator, value?: string): PlaywrightAction {
  switch (kind) {
    case 'fill': return { kind: 'fill', locator, value: value ?? '' };
    case 'select': return { kind: 'select', locator, value: value ?? '' };
    case 'dblclick': return { kind: 'dblclick', locator };
    case 'check': return { kind: 'check', locator };
    case 'uncheck': return { kind: 'uncheck', locator };
    case 'hover': return { kind: 'hover', locator };
    case 'click': return { kind: 'click', locator };
    default: return { kind: 'noop', reason: `scripted step verb "${kind}" is not replayable` };
  }
}

// ------------------------------------------------------------------------------------------
// internals
// ------------------------------------------------------------------------------------------

/** Every `{{input.<name>}}` a template names. Global, and therefore only ever used with `replace`
 *  and `matchAll` - `test`/`exec` on a `/g` regex carries `lastIndex` between calls. */
const INPUT_HOLE_RE = /\{\{\s*input\.([a-zA-Z0-9_]+)\s*\}\}/g;
/** ANY placeholder, of any family. What a URL template may contain is a strict subset of this. */
const ANY_HOLE_RE = /\{\{[^}]*\}\}/g;
/** The one placeholder shape a URL template may carry, anchored. Non-global on purpose. */
const INPUT_HOLE_EXACT = /^\{\{\s*input\.[a-zA-Z0-9_]+\s*\}\}$/;
/**
 * `scheme://authority[path][?query][#fragment]`, split WITHOUT `new URL`.
 *
 * A URL template is not a URL: `{` and `}` are in the WHATWG path percent-encode set, so
 * `new URL('https://h/api/cases/{{input.id}}').pathname` is `/api/cases/%7B%7Binput.id%7D%7D` and
 * every path hole silently stops being one. (Query holes survive, which is exactly why this was
 * invisible - the compile's commonest output is a query hole.) So the template is taken apart by
 * grammar and only the pieces that are real URLs are handed to the parser.
 */
const URL_TEMPLATE_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/;

/** The stand-in a hole gets in the CONTROL render. Hole-free, encoding-stable, never empty - so the
 *  control's structure is the template's structure with the arguments taken out of it. */
const HOLE_SENTINEL = 'a';

/** What `structureOf` puts where a hole was, so the two renders can differ there and nowhere else.
 *  A RAW SPACE, which a parsed pathname can never contain (the parser encodes one as `%20`), so it
 *  cannot collide with a real segment. Named rather than inlined: the first version used a literal
 *  NUL, which works and makes the file BINARY to git and to every grep-based gate. */
const MASKED_SEGMENT = ' ';

export function inputHolesOf(template: string): string[] {
  return [...new Set([...template.matchAll(INPUT_HOLE_RE)].map((m) => m[1]!))];
}

/** One call's templates, filled and proven, before a rung has been chosen for it. */
interface FilledCall {
  url: string;
  origin: string;
  body?: string;
}

/** A URL template taken apart into what an argument may and may not decide. */
interface UrlTemplateParts {
  /** Literal, always, and already normalised by the URL parser. The destination is the recipe's. */
  origin: string;
  /** The raw path, holes and all. Never `''` - a template with no path has the path `/`. */
  path: string;
  /** The raw query INCLUDING its `?`, holes and all, or `''`. */
  search: string;
}

/**
 * Fill one call's holes, or throw.
 *
 * ── WHAT AN ARGUMENT MAY DECIDE: A VALUE. NOTHING ELSE. ──────────────────────────────────────
 *
 * A replay runs inside the user's LIVE AUTHENTICATED PAGE. That is the whole point of the in-page
 * rung and it is also exactly what makes an argument that can move the request dangerous: an
 * argument choosing the endpoint is an SSRF with the user's session already attached. So the fill is
 * STRUCTURAL rather than a string interpolation:
 *
 *   - the ORIGIN is taken from the template and never rendered. A template with a hole anywhere in
 *     its origin is refused outright rather than filled;
 *   - each PATH SEGMENT is rendered separately and its value percent-encoded, so a `/` in an
 *     argument becomes `%2F` and cannot open a new segment;
 *   - each QUERY PARAMETER NAME is literal and only its value is rendered, encoded, so an `&` or an
 *     `=` in an argument cannot add or rename a parameter;
 *   - and then the result is PROVEN against a CONTROL render of the same template with the
 *     arguments taken out of it: same origin, same path-segment count, every hole-free segment
 *     identical, same query parameter names in the same order. That proof catches what encoding
 *     cannot - `..` needs no special character to walk up a path.
 *
 * The earlier version rendered the whole template with `interpolate` and then compared origins.
 * `…/cases/{{input.id}}` with `id=../../admin/secrets` passed that check and resolved to
 * `…/admin/secrets`: same origin, different endpoint, live session attached.
 *
 * The other refusal here is about an argument that is not there at all - see `assertHolesSupplied`.
 */
export function fillCall(call: Pick<InjectedCall, 'urlTemplate' | 'bodyTemplate'>, args: Record<string, unknown>): FilledCall {
  assertHolesSupplied(call, args);
  const template = parseUrlTemplate(call.urlTemplate);
  const url = renderUrlTemplate(template, args);
  const body = call.bodyTemplate === undefined ? undefined : renderBodyTemplate(call.bodyTemplate, args);
  return { url: url.toString(), origin: url.origin, ...(body !== undefined ? { body } : {}) };
}

/** Take a stored template apart, refusing every shape whose fill could not be proven afterwards. */
function parseUrlTemplate(urlTemplate: string): UrlTemplateParts {
  const match = URL_TEMPLATE_RE.exec(urlTemplate);
  if (!match) throw new RecipeShapeError('a compiled call did not resolve to an absolute URL');
  const scheme = match[1]!.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    throw new RecipeShapeError('a compiled call names a scheme this build will not replay');
  }
  const authority = match[2] ?? '';
  if (authority.includes('@')) {
    throw new RecipeShapeError('a compiled call carries userinfo in its URL - refusing to replay it');
  }
  // A hole in the ORIGIN means the recipe let an argument choose the host. The compile can no longer
  // produce one; a recipe written by an older build still can, and it is refused rather than filled.
  if (authority.includes('{{')) {
    throw new RecipeShapeError('a compiled call puts an argument in its ORIGIN - refusing to replay it');
  }
  let origin: string;
  try {
    origin = new URL(`${scheme}://${authority}/`).origin;
  } catch {
    throw new RecipeShapeError('a compiled call did not resolve to an absolute URL');
  }
  if (origin === 'null' || origin === '') {
    throw new RecipeShapeError('a compiled call did not resolve to an absolute URL');
  }
  // A template with no path has the path `/` - so the segment count the proof below compares is the
  // one the parser will produce, rather than `[''].length`.
  const path = match[3] === undefined || match[3] === '' ? '/' : match[3];
  const search = match[4] ?? '';

  // Only the `{{input.*}}` family is fillable. Anything else would be rendered as a literal and go
  // out on the wire looking like a placeholder nobody filled.
  for (const hole of `${path}${search}`.matchAll(ANY_HOLE_RE)) {
    if (!INPUT_HOLE_EXACT.test(hole[0])) {
      throw new RecipeShapeError('a compiled call names a placeholder this build cannot fill');
    }
  }
  // A hole in a parameter NAME lets a caller choose WHICH parameter it is filling. A bare flag
  // (`?archived`, no `=`) is all name, so a hole anywhere in it is a hole in a name.
  for (const pair of queryPairs(search)) {
    if (nameOfPair(pair).includes('{{')) {
      throw new RecipeShapeError('a compiled call puts an argument in a query parameter NAME - refusing to replay it');
    }
  }
  return { origin, path, search };
}

/**
 * Render the fillable parts, then PROVE what the arguments were allowed to do - against a CONTROL.
 *
 * The control is the same template rendered with every hole replaced by one inert character, so it
 * is this template's structure with the arguments taken out of it. Both go through the same parser,
 * so the comparison is between two normalised URLs rather than between a URL and a hand-rolled
 * expectation of what the parser would have done.
 *
 * TWO PROPERTIES, AND THEY ARE GENUINELY DIFFERENT QUESTIONS - which is why they are two checks and
 * not five overlapping ones:
 *
 *   1. THE STRUCTURE IS THE TEMPLATE'S (`structureOf`). Origin, path-segment count, every hole-free
 *      segment, and the query parameter names in order. Stated once, compared once: an earlier cut
 *      spread this over three separate `if`s, each of which happened to catch every case the others
 *      did, so no one of them could be shown to matter.
 *   2. WHAT LANDED IN A HOLE IS STILL A SEGMENT. A different question - it is about the VALUE at a
 *      position the template chose, not about the shape. `.` and `..` are ordinary characters no
 *      encoding escapes, and an empty one turns `…/cases/{id}` into the collection endpoint.
 */
function renderUrlTemplate(template: UrlTemplateParts, args: Record<string, unknown>): URL {
  const actual = buildUrl(template, (name) => encodeURIComponent(String(args[name])));
  const control = buildUrl(template, () => HOLE_SENTINEL);

  const holeAt = template.path.split('/').map((segment) => segment.includes('{{'));
  if (structureOf(actual, holeAt) !== structureOf(control, holeAt)) {
    throw new RecipeShapeError('a replayed call\'s arguments changed its shape, not just its values - refusing to send it');
  }
  actual.pathname.split('/').forEach((filled, i) => {
    if (!holeAt[i]) return;
    if (filled === '' || filled === '.' || filled === '..') {
      throw new RecipeShapeError('a replayed call\'s arguments emptied or walked a path segment - refusing to send it');
    }
  });
  return actual;
}

/**
 * Everything about a URL that a filled VALUE must not have changed, as one comparable string.
 *
 * Hole positions are blanked, because that is exactly where a value is allowed to differ. Everything
 * else - the origin, how many segments there are, what the hole-free ones say, which parameters
 * exist and in what order - is the template's decision and has to survive the fill unchanged.
 */
function structureOf(url: URL, holeAt: readonly boolean[]): string {
  const segments = url.pathname.split('/').map((segment, i) => (holeAt[i] ? MASKED_SEGMENT : segment));
  const names = queryPairs(url.search).map(nameOfPair);
  return JSON.stringify([url.origin, segments, names]);
}

/** One render of the template. `fill` decides what a hole becomes; everything else is copied. */
function buildUrl(template: UrlTemplateParts, fill: (name: string) => string): URL {
  const path = template.path.replace(INPUT_HOLE_RE, (_match, name: string) => fill(name));
  const search = template.search === ''
    ? ''
    : `?${queryPairs(template.search).map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      return `${pair.slice(0, eq)}=${pair.slice(eq + 1).replace(INPUT_HOLE_RE, (_m, name: string) => fill(name))}`;
    }).join('&')}`;
  try {
    return new URL(`${template.origin}${path}${search}`);
  } catch {
    throw new RecipeShapeError('a compiled call did not resolve to an absolute URL');
  }
}

/** `?a=1&b` -> `['a=1', 'b']`, and `''` -> `[]`. */
function queryPairs(search: string): string[] {
  return search === '' ? [] : search.slice(1).split('&');
}

function nameOfPair(pair: string): string {
  const eq = pair.indexOf('=');
  return eq < 0 ? pair : pair.slice(0, eq);
}

/**
 * The body, filled in its own escaping context.
 *
 * A JSON template gets JSON-STRING escaping, so a `"` in an argument cannot close the string it sits
 * in and open a sibling field; and the filled body must still parse, which is the proof that it did
 * not. Anything else (a form post, a site's own invention) is percent-encoded, which is the escaping
 * that shape uses. `interpolate` did neither, and a JSON body is where an injected field would land.
 */
function renderBodyTemplate(bodyTemplate: string, args: Record<string, unknown>): string {
  let templateIsJson = false;
  try {
    JSON.parse(bodyTemplate);
    templateIsJson = true;
  } catch {
    templateIsJson = false;
  }
  const escape = templateIsJson
    ? (value: string): string => JSON.stringify(value).slice(1, -1)
    : encodeURIComponent;
  const filled = bodyTemplate.replace(INPUT_HOLE_RE, (_match, name: string) => escape(String(args[name])));
  if (templateIsJson) {
    try {
      JSON.parse(filled);
    } catch {
      throw new RecipeShapeError('a replayed call\'s arguments broke its JSON body - refusing to send it');
    }
  }
  return filled;
}

/**
 * FAIL CLOSED ON AN ARGUMENT THE RECIPE HAS NO HOLE FOR - the other half of `assertHolesSupplied`.
 *
 * The two together say one thing: THE RECIPE'S HOLES AND THE RUN'S ARGUMENTS ARE THE SAME SET.
 * `assertHolesSupplied` proves `args ⊇ holes` (a hole nobody filled would widen the query);
 * this proves `holes ⊇ args` (an argument nothing can carry).
 *
 * ── WHY AN IGNORED ARGUMENT IS A REFUSAL AND NOT A SHRUG ─────────────────────────────────────
 *
 * A compiled call with no hole for an argument is a CONSTANT with respect to it. Replaying it
 * fetches whatever the recipe was compiled around, hands that back, and the run reports success -
 * so a caller asking for case 2025-9 is answered with case 2024-1 and nothing anywhere says
 * otherwise. That is the same silent-wrong-answer failure the COMPILE already refuses
 * (`network-capture.ts`, "an argument this pass could not find refuses the whole compile"), and
 * refusing it only at compile time leaves it wide open at replay: a recipe compiled by an older
 * build, one compiled for a narrower argument set, or an action whose caller simply passes a new
 * argument, all reach this function with a recipe that cannot honour what was asked.
 *
 * The refusal is a FALL-THROUGH (`no-recipe`), exactly as the missing-argument refusal is: the
 * caller then runs the action's authored steps, which DO see every argument. Refusing the replay
 * costs the optimisation; replaying regardless costs the answer.
 *
 * ── THE TWO EXEMPTIONS ARE THE COMPILE'S OWN, AND HAVE TO BE ─────────────────────────────────
 *
 * `inputHoles` (`network-capture.ts`) declines to hole two families, so a recipe legitimately has
 * no hole for them and demanding one here would refuse every replay of a perfectly good recipe:
 *
 *   - a SECRET-SHAPED argument NAME. Never holed (a recipe that says "put the password here" is a
 *     recipe that needs a password) and never required to be found, because a credential correctly
 *     appears nowhere in a URL. Read through the same `SECRET_SHAPED_INPUT_NAME` the compile uses,
 *     so the two sides cannot disagree about which names those are;
 *   - an argument that is `null`/`undefined`. It carries nothing to look for and the compile
 *     ignores it, so it is not an argument this recipe is failing to honour.
 *
 * A NON-SCALAR argument is refused rather than exempted, which is again the compile's own answer
 * (`unlocatable`): there is no verbatim form of an object to have templated, so no recipe can be
 * shown to honour one - and if a hole DID happen to bear its name, `String(value)` would put
 * `[object Object]` on the wire. Both readings say refuse.
 */
function assertEveryArgumentHasAHole(recipe: CompiledRecipe, args: Record<string, unknown>): void {
  const holes = new Set<string>();
  for (const call of recipe.injectedCalls) {
    for (const name of inputHolesOf(call.urlTemplate)) holes.add(name);
    if (call.bodyTemplate !== undefined) for (const name of inputHolesOf(call.bodyTemplate)) holes.add(name);
  }
  const unusable: string[] = [];
  const ignored: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    if (SECRET_SHAPED_INPUT_NAME.test(name)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      unusable.push(name);
      continue;
    }
    if (!holes.has(name)) ignored.push(name);
  }
  // Reported separately because they are different facts about the run, and the operator's fix
  // differs: one is an argument shape no recipe can carry, the other a recipe that predates it.
  if (unusable.length > 0) {
    throw new RecipeShapeError(
      `the replayed call was given argument(s) ${unusable.sort().join(', ')} that are not scalar values, `
      + 'so no compiled call can be shown to honour them - refusing to replay it',
    );
  }
  if (ignored.length > 0) {
    throw new RecipeShapeError(
      `the replayed call has no hole for argument(s) ${ignored.sort().join(', ')}, so it would return the `
      + 'data it was compiled around whatever this caller asked for - refusing to replay it',
    );
  }
}

/**
 * FAIL CLOSED ON A MISSING ARGUMENT.
 *
 * `interpolate` renders an unsupplied `{{input.ref}}` as the empty string. On a step description
 * that is a cosmetic gap; in a replayed query string it is a semantic change - `?ref=` means "all
 * of them" on most APIs - so the replay would quietly fetch a superset of what it was asked for and
 * report success. Every hole a template names must be supplied, or nothing is sent.
 *
 * The mirror of `assertEveryArgumentHasAHole` above; read the two together.
 */
function assertHolesSupplied(call: Pick<InjectedCall, 'urlTemplate' | 'bodyTemplate'>, args: Record<string, unknown>): void {
  const named = [...inputHolesOf(call.urlTemplate), ...(call.bodyTemplate ? inputHolesOf(call.bodyTemplate) : [])];
  const missing = [...new Set(named)].filter(
    (name) => !Object.prototype.hasOwnProperty.call(args, name) || args[name] === null || args[name] === undefined,
  );
  if (missing.length > 0) {
    throw new RecipeShapeError(
      `the replayed call needs argument(s) ${missing.sort().join(', ')}, which this run did not supply`,
    );
  }
}

/**
 * THE LAST PROOF THAT A REPLAY CARRIES NO CREDENTIAL.
 *
 * A recipe cannot hold one (`recipe-store.assertCarriesNoValues` refused the write), but the
 * RESOLVED form is new bytes: `{{input.x}}` was filled from this run's arguments, and an argument
 * can be anything the caller passed. If a live credential ends up in a URL or body here, the call
 * is refused - a resolved credential in a URL is a query-string disclosure into the site's logs.
 *
 * Throws rather than returning a verdict: there is no sensible way for a caller to continue past it.
 * The mount is what makes it real - it passes the RUN's registry (`service.ts`), so this runs
 * against live values in production and not only where a test remembered to build one.
 */
function assertNoCredentialRodeIn(resolved: { url: string; body?: string }, secrets?: SecretRegistry): void {
  if (!secrets) return;
  for (const [what, text] of [['url', resolved.url], ['body', resolved.body]] as const) {
    if (typeof text !== 'string') continue;
    if (secrets.redact(text) !== text) {
      throw new RecipeShapeError(`a replayed call's ${what} resolved to a live credential value - refusing to send it`);
    }
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** What the recipe counted on and no longer gets. Empty when there is no expectation to check -
 *  "no evidence" is never drift. */
function expectationMismatch(call: InjectedCall, body: unknown): string[] {
  if (call.expectShape === undefined) return [];
  const expected = parseResponseShape(call.expectShape);
  if (!expected) return [];
  return shapeMismatch(expected, body);
}

/**
 * Does this scripted step CHANGE the page?
 *
 * The one predicate for that question, shared by the replay's own gate above and by `self-heal.ts`
 * (which must not let a re-learned `click` go live unattended). Allow-shaped: a verb this build
 * does not recognise counts as a write, so a new verb arriving in a stored recipe is gated rather
 * than waved through. Takes a bare `string` because the STORED shape widens `action` to one.
 */
export function scriptedStepWrites(step: { action: string }): boolean {
  return !READ_ONLY_SCRIPTED_VERBS.has(step.action);
}
