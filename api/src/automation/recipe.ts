/**
 * automation/recipe.ts - THE COMPILED RECIPE, engine side (slice P2.0).
 *
 * A browser-steps action re-derives its whole flow on every run today. The engine spine being built
 * around this file inverts that: the FIRST run discovers the flow vision-first and captures the
 * private API underneath it, and every later run replays the captured calls deterministically with
 * no model calls. This module is the shape of what that first run leaves behind. Discovery itself
 * (P2.1), the capture layer (P2.2), the replay executor (P2.3) and self-heal (P2.4) consume it.
 *
 * ── THE ONE SAFETY PROPERTY ──────────────────────────────────────────────────────────────────
 *
 * "Which header carries the session token" is the LEARNING and is worth keeping. The token is worth
 * nothing next run (it has expired) and is a durable credential disclosure if it is written down.
 * So the recipe carries header NAMES and never header VALUES - and that is enforced three ways,
 * because a rule this load-bearing must not rest on a code review noticing:
 *
 *   1. `HeaderName` is a BRANDED string. A raw `string` is not assignable to it, so
 *      `headerNames: [...Object.values(headers)]` does not compile;
 *   2. the only constructors are `headerNameOf` (which validates the RFC 7230 token grammar and a
 *      length bound) and `injectedCallFromExchange` (which is handed the whole header map and reads
 *      its KEYS - the single place values are in scope, and they leave it unreferenced);
 *   3. `integrations/recipe-store.ts` re-proves it at the persistence boundary against the run's
 *      `SecretRegistry` and the repo's literal-secret predicate, and REFUSES the write otherwise.
 *
 * Layer 1 is a compile-time fence, layer 2 a construction fence, layer 3 the runtime proof. The
 * brand alone would be defeated by a cast; the store alone would depend on every caller being
 * careful. Together, a value reaching storage needs a deliberate cast AND a store that failed.
 *
 * ── WHY THESE TYPES EXTEND THE STORED ONES ───────────────────────────────────────────────────
 *
 * The persisted shape is `IntegrationActionRecipe` (`integrations/definitions.ts`, tier 3), where
 * `method`/`locator`/`action` are widened to `string`/`unknown` because tier 3 may not import this
 * tier-5 module (docs/architecture.md). The types here EXTEND those interfaces and narrow those
 * three members back to the engine's own unions. Extension rather than a parallel declaration is
 * deliberate: TypeScript then refuses any divergence between the stored shape and the engine shape
 * at compile time, so "the store and the engine agree" is not a comment anyone has to maintain.
 * The import is type-only and runs DOWN the tier table, so it adds no runtime edge.
 */
import type {
  IntegrationActionInjectedCall,
  IntegrationActionRecipe,
  IntegrationActionScriptedStep,
} from '../integrations/definitions.js';
import type { ApiCallMethod, Locator, PlaywrightAction } from './types.js';

/** Thrown when a recipe is assembled from something that is not the shape it claims. */
export class RecipeShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeShapeError';
  }
}

// ============================================================================================
// Header NAMES - the branded half of the safety property
// ============================================================================================

declare const HeaderNameBrand: unique symbol;

/**
 * An HTTP header name that has been PROVEN to be a name. Nominal on purpose: `string` is not
 * assignable to it, so the only way to get one is through a constructor below, and every one of
 * those either validates the grammar or never sees a value in the first place.
 */
export type HeaderName = string & { readonly [HeaderNameBrand]: true };

/** RFC 7230 `token`, bounded. The bound is not cosmetic: the token grammar alone accepts a JWT
 *  (dots, dashes and underscores are all token characters), and 64 characters is far above any
 *  real header name and far below the credential shapes that would otherwise slip through it. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

export function isHeaderName(raw: string): raw is HeaderName {
  return HEADER_NAME_RE.test(raw);
}

/** Prove one header name, or refuse. The message names the POSITION, never the offending text -
 *  a rejected "name" is very likely a credential value, and an error message is a log line. */
export function headerNameOf(raw: string, position = 'header name'): HeaderName {
  if (!isHeaderName(raw)) {
    throw new RecipeShapeError(`${position} is not an HTTP header name (length ${raw.length})`);
  }
  return raw;
}

/**
 * The header names of a live exchange, read from the map's KEYS.
 *
 * This is the function that makes "names, never values" structural: it is handed the whole header
 * map - the one place in the recipe path where values are in scope - and the values leave it
 * unreferenced. Nothing downstream ever holds them.
 *
 * A key that is not a header name is DROPPED here rather than refused, and that is the one place in
 * this module where dropping is right: a live capture legitimately carries HTTP/2 pseudo-headers
 * (`:method`, `:path`, `:authority`), which are not names a replay can forward and are not values
 * either. Refusing would make an ordinary capture unusable. The refusing check lives one layer down,
 * where a name is asserted to BE one (`headerNameOf`, and the store's own re-proof).
 */
export function headerNamesOf(headers: Readonly<Record<string, string>>): HeaderName[] {
  return Object.keys(headers)
    .filter((name) => isHeaderName(name))
    .map((name) => name.toLowerCase() as HeaderName)
    .sort();
}

// ============================================================================================
// The recipe
// ============================================================================================

/** Methods whose replay is safe to repeat unattended (Trap T4). A write replays only through the
 *  same consent gate an `api_call` write hits - the recipe declares which it is, once, at compile
 *  time, so the replay path never has to re-derive it from a method string. */
export const IDEMPOTENT_METHODS: readonly ApiCallMethod[] = ['GET', 'HEAD', 'OPTIONS'];

export function isIdempotentMethod(method: ApiCallMethod): boolean {
  return IDEMPOTENT_METHODS.includes(method);
}

/** A replayable internal call: the stored shape with the engine's own unions restored. */
export interface InjectedCall extends IntegrationActionInjectedCall {
  method: ApiCallMethod;
  headerNames: HeaderName[];
}

/** A learned DOM interaction, for what genuinely cannot be done as a call. */
export interface ScriptedStep extends IntegrationActionScriptedStep {
  locator: Locator;
  action: PlaywrightAction['kind'];
}

/** What one discovery pass compiled: bounded, replayable, and carrying no values. */
export interface CompiledRecipe extends IntegrationActionRecipe {
  injectedCalls: InjectedCall[];
  scriptedSteps: ScriptedStep[];
}

/**
 * Build an injected call from a captured exchange, dropping every value on the way through.
 *
 * The capture layer (P2.2) hands this the live request; what comes back is templated and nameless.
 * Callers do not assemble `InjectedCall`s by hand - they cannot, without minting `HeaderName`s
 * themselves - so this is the one door, and it is the door that discards the header values.
 */
export function injectedCallFromExchange(exchange: {
  method: ApiCallMethod;
  /** origin+path, already templated by the caller. Never a resolved-secret-bearing URL. */
  urlTemplate: string;
  /** The live request headers. ONLY their keys survive this call. */
  headers: Readonly<Record<string, string>>;
  bodyTemplate?: string;
  expectShape?: unknown;
}): InjectedCall {
  return {
    method: exchange.method,
    urlTemplate: exchange.urlTemplate,
    headerNames: headerNamesOf(exchange.headers),
    ...(exchange.bodyTemplate !== undefined ? { bodyTemplate: exchange.bodyTemplate } : {}),
    ...(exchange.expectShape !== undefined ? { expectShape: exchange.expectShape } : {}),
    idempotent: isIdempotentMethod(exchange.method),
  };
}

// ============================================================================================
// Reading a recipe back
// ============================================================================================

const API_CALL_METHODS: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const LOCATOR_STRATEGIES: readonly string[] = ['role', 'text', 'label', 'placeholder', 'testid', 'css', 'altText', 'title'];

/**
 * Every verb a STORED scripted step may claim.
 *
 * Exported because it is the census the write gate is judged against: `scriptedStepWrites`
 * classifies each of these as read-only or not, and the suite iterates THIS list rather than a
 * hand-written copy of it - so a verb added here without a classification fails the suite instead
 * of silently replaying ungated.
 */
export const PLAYWRIGHT_ACTION_KINDS: readonly string[] = [
  'navigate', 'click', 'dblclick', 'fill', 'press', 'select', 'check', 'uncheck',
  'hover', 'wait', 'wait_for', 'scroll', 'screenshot', 'noop',
];

/**
 * Narrow a STORED recipe back to the engine shape, or answer null.
 *
 * The stored form is the widened one (and, being a Mongo document, is `unknown` as far as this
 * process is concerned - it may predate any field this version knows). Replay therefore re-validates
 * instead of casting: an unrecognised method, a locator strategy this build does not implement, or a
 * "header name" that is not one, answers null and sends the action back through discovery. That is
 * the safe direction - a recipe is replayed against a live authenticated session, so a half-understood
 * one must never be half-executed.
 */
export function parseCompiledRecipe(stored: unknown): CompiledRecipe | null {
  if (stored === null || typeof stored !== 'object') return null;
  const raw = stored as Partial<IntegrationActionRecipe>;
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) return null;
  if (typeof raw.goal !== 'string' || typeof raw.compiledAt !== 'string') return null;
  if (!Array.isArray(raw.injectedCalls) || !Array.isArray(raw.scriptedSteps) || !Array.isArray(raw.lessons)) return null;
  if (raw.lessons.some((l) => typeof l !== 'string')) return null;

  const injectedCalls: InjectedCall[] = [];
  for (const call of raw.injectedCalls) {
    const parsed = parseInjectedCall(call);
    if (!parsed) return null;
    injectedCalls.push(parsed);
  }
  const scriptedSteps: ScriptedStep[] = [];
  for (const step of raw.scriptedSteps) {
    const parsed = parseScriptedStep(step);
    if (!parsed) return null;
    scriptedSteps.push(parsed);
  }
  // THE ANSWER POINTER IS RANGE-CHECKED, never trusted. It selects WHICH replayed body becomes the
  // action's answer, so a pointer off the end of the call list - an older document, a hand-edited
  // row, a compile that lost a call - must not degrade to "no answer" and must certainly not slide
  // onto a neighbouring call. A recipe that names an answer it cannot point at is one this build
  // cannot replay, so it goes back through discovery like any other unreadable recipe.
  const answers = parseAnswersWith(raw.answersWith, injectedCalls.length);
  if (answers === 'invalid') return null;
  return {
    version: raw.version,
    goal: raw.goal,
    injectedCalls,
    scriptedSteps,
    ...(answers !== undefined ? { answersWith: answers } : {}),
    lessons: [...raw.lessons],
    ...(typeof raw.capturedCallsRef === 'string' ? { capturedCallsRef: raw.capturedCallsRef } : {}),
    compiledAt: raw.compiledAt,
    ...(parseSupersedes(raw.supersedes) ?? {}),
  };
}

/** `undefined` = the recipe names no answer (the run it was learned from produced none);
 *  `'invalid'` = it names one this build cannot honour, which invalidates the whole recipe. */
function parseAnswersWith(
  raw: unknown,
  callCount: number,
): CompiledRecipe['answersWith'] | 'invalid' {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return 'invalid';
  const { callIndex, matchedBy } = raw as { callIndex?: unknown; matchedBy?: unknown };
  if (typeof callIndex !== 'number' || !Number.isInteger(callIndex) || callIndex < 0 || callIndex >= callCount) return 'invalid';
  if (matchedBy !== 'run-output-identity' && matchedBy !== 'declared-return-shape') return 'invalid';
  return { callIndex, matchedBy };
}

function parseSupersedes(raw: unknown): { supersedes: { version: number; reason: string } } | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { version, reason } = raw as { version?: unknown; reason?: unknown };
  if (typeof version !== 'number' || !Number.isInteger(version) || typeof reason !== 'string') return null;
  return { supersedes: { version, reason } };
}

function parseInjectedCall(raw: unknown): InjectedCall | null {
  if (raw === null || typeof raw !== 'object') return null;
  const call = raw as Partial<IntegrationActionInjectedCall>;
  if (typeof call.method !== 'string' || !API_CALL_METHODS.includes(call.method)) return null;
  if (typeof call.urlTemplate !== 'string' || call.urlTemplate === '') return null;
  if (typeof call.idempotent !== 'boolean') return null;
  if (!Array.isArray(call.headerNames)) return null;
  const headerNames: HeaderName[] = [];
  for (const name of call.headerNames) {
    // A stored "name" that is not a name is the exact shape of the leak this module exists to
    // prevent, so it invalidates the whole recipe rather than being quietly dropped: silently
    // repairing it would hide a capture-side defect that is still writing values somewhere.
    if (typeof name !== 'string' || !isHeaderName(name)) return null;
    headerNames.push(name);
  }
  if (call.bodyTemplate !== undefined && typeof call.bodyTemplate !== 'string') return null;
  return {
    method: call.method as ApiCallMethod,
    urlTemplate: call.urlTemplate,
    headerNames,
    ...(call.bodyTemplate !== undefined ? { bodyTemplate: call.bodyTemplate } : {}),
    ...(call.expectShape !== undefined ? { expectShape: call.expectShape } : {}),
    idempotent: call.idempotent,
  };
}

function parseScriptedStep(raw: unknown): ScriptedStep | null {
  if (raw === null || typeof raw !== 'object') return null;
  const step = raw as Partial<IntegrationActionScriptedStep>;
  if (typeof step.action !== 'string' || !PLAYWRIGHT_ACTION_KINDS.includes(step.action)) return null;
  if (step.value !== undefined && typeof step.value !== 'string') return null;
  const locator = step.locator;
  if (locator === null || typeof locator !== 'object') return null;
  const strategy = (locator as { strategy?: unknown }).strategy;
  if (typeof strategy !== 'string' || !LOCATOR_STRATEGIES.includes(strategy)) return null;
  return {
    locator: locator as Locator,
    action: step.action as PlaywrightAction['kind'],
    ...(step.value !== undefined ? { value: step.value } : {}),
  };
}
