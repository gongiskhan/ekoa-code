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
 * ── A MISSING ARGUMENT IS A REFUSAL, NOT AN EMPTY STRING ─────────────────────────────────────
 *
 * `interpolate` renders an absent input as ''. For a step description that is harmless; for a
 * replayed query it silently WIDENS the call - `?ref={{input.ref}}` with no `ref` becomes `?ref=`,
 * which on most APIs means "everything". A replay that fetches more than it was asked for is worse
 * than a replay that does not happen, so every hole a template names must be supplied.
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
import { interpolate } from '../template-vars.js';
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
  /** No recipe, or one this build cannot read. The caller runs the ordinary vision path. */
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

  // ── THE WRITE GATE, BEFORE ANYTHING RUNS (trap T4) ────────────────────────────────────────
  // Checked over the WHOLE recipe - both halves of it - not per call as the ladder reaches it:
  // stopping at call four of six would leave the site with three calls already applied and a run
  // that has to be resumed into an unknown state.
  if (!input.writeAssent) {
    const blocked = firstWrite(recipe);
    if (blocked) return { outcome: 'write-gate', blocked, recipeVersion: recipe.version };
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

/** Every `{{input.<name>}}` a template names. The gate for "was this hole actually supplied". */
const INPUT_HOLE_RE = /\{\{\s*input\.([a-zA-Z0-9_]+)\s*\}\}/g;

export function inputHolesOf(template: string): string[] {
  return [...new Set([...template.matchAll(INPUT_HOLE_RE)].map((m) => m[1]!))];
}

/** One call's templates, filled and proven, before a rung has been chosen for it. */
interface FilledCall {
  url: string;
  origin: string;
  body?: string;
}

/**
 * Fill one call's holes, or throw.
 *
 * Two refusals live here and both are about what an ARGUMENT may decide. It may not leave a hole
 * empty (`assertHolesSupplied`), and it may not move the host: the template's literal origin is
 * read BEFORE substitution and the resolved URL must still be on it.
 */
export function fillCall(call: Pick<InjectedCall, 'urlTemplate' | 'bodyTemplate'>, args: Record<string, unknown>): FilledCall {
  assertHolesSupplied(call, args);

  let templateOrigin: string;
  try {
    templateOrigin = new URL(call.urlTemplate).origin;
  } catch {
    throw new RecipeShapeError('a compiled call did not resolve to an absolute URL');
  }

  let absolute: string;
  let origin: string;
  try {
    const parsed = new URL(interpolate(call.urlTemplate, args));
    absolute = parsed.toString();
    origin = parsed.origin;
  } catch {
    throw new RecipeShapeError('a compiled call did not resolve to an absolute URL');
  }
  if (origin !== templateOrigin) {
    // An argument moved the HOST. The recipe decides where a replay goes; a caller-supplied value
    // that changes it would point the authenticated page's own fetch at somebody else's server.
    throw new RecipeShapeError('a replayed call\'s arguments changed its origin - refusing to send it');
  }

  const body = call.bodyTemplate === undefined ? undefined : interpolate(call.bodyTemplate, args);
  return { url: absolute, origin, ...(body !== undefined ? { body } : {}) };
}

/**
 * FAIL CLOSED ON A MISSING ARGUMENT.
 *
 * `interpolate` renders an unsupplied `{{input.ref}}` as the empty string. On a step description
 * that is a cosmetic gap; in a replayed query string it is a semantic change - `?ref=` means "all
 * of them" on most APIs - so the replay would quietly fetch a superset of what it was asked for and
 * report success. Every hole a template names must be supplied, or nothing is sent.
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
