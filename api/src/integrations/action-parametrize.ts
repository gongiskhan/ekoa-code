/**
 * integrations/action-parametrize.ts - THE LOCKED GUARDRAILS for arguments a model filled in
 * (slice S4, the `achieve` reuse ladder's PARAMETRIZE rung).
 *
 * ================================ WHAT THIS MODULE IS =======================================
 * `matchActionForGoal` picks the ACTION and stays deterministic - the module's own text says why,
 * and nothing here changes it: "the thing being picked may be a WRITE … 'the model thought you
 * meant `delete_invoice`' is not a sentence this product should be able to say." What this rung
 * adds is strictly downstream of that pick: once a HUMAN-TRUSTED action has already been selected
 * by the lexical matcher, a model may propose VALUES for the arguments that action itself declares.
 *
 * This module owns the deterministic verdict on those values, as pure functions, in exactly the
 * shape `authored-action.ts` owns the verdict on a drafted action: a named check list, re-run over
 * the parsed plan whatever the drafting turn claimed, returning a verdict rather than throwing.
 *
 * ================================ WHY EACH CHECK IS REAL ====================================
 *
 * 1. `declared_args` - THIS IS THE ONLY CHECK THERE IS. `argsSchema` is documentation: grep
 *    `api/src` and it appears in the type, in `achieve`'s prompt, in `action-consent.ts`'s list of
 *    fields deliberately EXCLUDED from the approval fingerprint, and in a catalog summary. The
 *    EXECUTOR NEVER READS IT. `action-executor.ts` does `buildVars(input.args, resolvedFields)`,
 *    which merges every key of `args` into the one `{{name}}` namespace the request templates
 *    interpolate from. So an undeclared key is not a schema nicety - it is precisely how a
 *    model-filled argument would reach a placeholder nobody declared for it (a provider resolver's
 *    minted `{{api_base}}`, another action's argument name reused in this action's template). If
 *    this check is weak, nothing else catches it.
 *    Two more refusals ride the same check, both for reasons the executor cannot state:
 *      - a key that names a CONFIG (credential) field. `buildVars` merges credentials OVER args, so
 *        such a key is inert today; refusing it is refusing to depend on the merge order of a
 *        different module.
 *      - a key the CALLER already supplied. A human's argument is never overwritten by a model's.
 *
 * 2. `targeting` - DECISION D1, and the reason this rung is not simply "let the model fill args".
 *    An argument that lands in the request BODY is covered by the standing shape+destination
 *    approval exactly as a caller-supplied argument is today: the human approved this action
 *    sending this shape to this destination, and the body is the shape. An argument that lands in
 *    the resolved TARGET selects WHICH RESOURCE is acted on, under an approval whose dialog only
 *    ever showed `{{arg}}` - so it may be model-filled only when the action cannot write.
 *    `mutates === false` is read as a LITERAL, the fail-closed reading `action-consent.ts` fixed.
 *    D1 names path and query. Headers are counted as targeting too, for D1's own reason rather
 *    than by extension: the consent dialog shows the METHOD and the RESOLVED URL, and a header is
 *    no more visible in it than a path segment is, while `X-Account-Id: {{acct}}` selects a
 *    resource just as surely as `/accounts/{{acct}}` does.
 *
 * 3. `no_pasted_secret` - the same two-pass, POSITIONALLY ANCHORED scrub `authored-action.ts`
 *    check 7 applies to a draft, applied to the values instead. A model that answers a goal by
 *    inventing `Bearer sk-live-…` must not have it interpolated into a header.
 *
 * 4. `render` - the resolved URL is put through `assertOriginAllowed`, the same assertion the
 *    executor makes at call time. HONEST NOTE, because this one is defence in depth and not the
 *    only line: `action-executor.ts` already asserts the origin of the resolved URL before the
 *    request goes out. What this adds is WHEN and WHAT: the rung refuses with a coded refusal the
 *    caller can act on, before the write gate is consulted and before any credential is decrypted,
 *    instead of letting a plan that cannot be sent be discovered by trying to send it. The escape
 *    it actually catches is real - a path argument of `@evil.example` on a base of
 *    `https://api.host.example` re-authorities the URL - and it is caught here without unwrapping
 *    a credential.
 *
 * 5. `shape` - the plan is an object of SCALARS. `interpolateObj` passes a non-string raw value
 *    THROUGH into a JSON body when a template is exactly one bare `{{name}}`, so allowing objects
 *    and arrays here would let a model compose body sub-documents that no template author wrote.
 *    v1 says scalars; widening it is a decision someone takes deliberately, not a default.
 *
 * NOTHING HERE EXECUTES ANYTHING. The rung hands the verified arguments back to
 * `integration-achieve.ts`, which reaches the executor through the one call it already had - so
 * C2's write gate is inherited on exactly the terms every other rail meets it, with no new code.
 */
import {
  redactSecrets,
  scrubSecretText,
  type IntegrationAction,
  type IntegrationActionHttpConfig,
  type IntegrationDefinition,
} from './definitions.js';
import { declaredArgsOf } from './authored-action.js';
import { assertOriginAllowed } from '../security/origin-binding.js';

/** `{{name}}` / `{{$odata}}` - the ONE placeholder grammar, matching `http-template.ts`'s. */
const PLACEHOLDER_RE = /\{\{(\$?\w+)\}\}/g;

/** The synthetic value an UNSUPPLIED placeholder renders to during the render probe. Never a
 *  credential, and never anything an origin check could mistake for a host. */
const RENDER_PROBE_VALUE = 'v';

/** A model-filled value is a scalar. See check 5 in the header. */
export type PlannedArgValue = string | number | boolean | null;

/** The plan a `PlanDrafter` turn produces. UNTRUSTED until the suite below has judged it. */
export interface PlannedArgs {
  args: Record<string, PlannedArgValue>;
}

/**
 * WHERE a `{{name}}` lands in this action's request.
 *
 *   `targeting` - the authority, the path, a query parameter or a header: it participates in
 *                 selecting the resource, and is not shown resolved in the consent dialog.
 *   `body`      - the request body only: the SHAPE the human approved.
 *   `unused`    - the action's templates never name it. Not an error by itself (the argument is
 *                 simply inert), but it is not `body` either, so it cannot buy a targeting pass.
 *
 * TARGETING WINS. A name appearing in both the path and the body is targeting, because the path
 * occurrence is the one that decides what gets acted on.
 */
export type ArgSlot = 'targeting' | 'body' | 'unused';

function namesIn(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(PLACEHOLDER_RE)) into.add(m[1] as string);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) namesIn(v, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) namesIn(v, into);
  }
}

/** Every `{{name}}` this action interpolates, by the slot it lands in. */
export function argSlotsOf(http: IntegrationActionHttpConfig | undefined): Record<string, ArgSlot> {
  const slots: Record<string, ArgSlot> = {};
  if (!http) return slots;
  const targeting = new Set<string>();
  namesIn(http.baseUrl, targeting);
  namesIn(http.path, targeting);
  namesIn(http.queryParams ?? {}, targeting);
  namesIn(http.headers ?? {}, targeting);
  for (const n of targeting) slots[n] = 'targeting';
  const body = new Set<string>();
  namesIn(http.bodyTemplate ?? {}, body);
  for (const n of body) if (slots[n] === undefined) slots[n] = 'body';
  return slots;
}

/** The slot a single name lands in, `unused` when the templates never name it. */
export function slotOf(http: IntegrationActionHttpConfig | undefined, name: string): ArgSlot {
  return argSlotsOf(http)[name] ?? 'unused';
}

/**
 * May this rung run at all for this action, and for which arguments?
 *
 * The rung is offered only for arguments the action DECLARES and the caller did NOT supply. A
 * caller who passed every declared argument has already said what they want; asking a model to
 * improve on that would be spending a model call to second-guess a human.
 */
export function missingDeclaredArgs(
  action: Pick<IntegrationAction, 'argsSchema'>,
  callerArgs: Record<string, unknown>,
): string[] {
  return declaredArgsOf(action).filter((name) => !Object.prototype.hasOwnProperty.call(callerArgs, name));
}

export type ParametrizeCheckName = 'shape' | 'declared_args' | 'targeting' | 'no_pasted_secret' | 'render';

export interface ParametrizeCheck {
  name: ParametrizeCheckName;
  ok: boolean;
  detail?: string;
}

export interface ParametrizeVerdict {
  passed: boolean;
  checks: ParametrizeCheck[];
  /** The arguments to MERGE UNDER the caller's own, or null when the verdict did not pass. */
  args: Record<string, PlannedArgValue> | null;
}

export interface VerifyPlannedArgsInput {
  action: IntegrationAction;
  /** The definition the action belongs to - its `configSchema` keys are refused as argument names. */
  definition: Pick<IntegrationDefinition, 'configSchema'>;
  /** The model's plan, straight off the parser. UNTRUSTED. */
  planned: unknown;
  /** What the CALLER supplied. Never overwritten, and never re-judged: it is theirs. */
  callerArgs: Record<string, unknown>;
  /** The credential's granted egress scope, resolved BEFORE the plan existed. */
  allowedOrigins: readonly string[];
}

function check(name: ParametrizeCheckName, ok: boolean, detail?: string): ParametrizeCheck {
  return detail === undefined || ok ? { name, ok } : { name, ok, detail };
}

function isScalar(v: unknown): v is PlannedArgValue {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * THE GUARDRAIL SUITE for model-filled arguments. Deterministic, model-free, and re-run over the
 * parsed plan regardless of what the drafting turn said about itself - `authored-action.ts`'s rule,
 * for `authored-action.ts`'s reason: the prompt is a hint, the suite is the control.
 */
export function verifyPlannedArgs(input: VerifyPlannedArgsInput): ParametrizeVerdict {
  const checks: ParametrizeCheck[] = [];
  const done = (args: Record<string, PlannedArgValue> | null): ParametrizeVerdict => ({
    passed: checks.every((c) => c.ok),
    checks,
    args: checks.every((c) => c.ok) ? args : null,
  });

  // 1. SHAPE - `{ "args": { name: scalar, … } }`, and nothing else.
  const raw = input.planned;
  const bag = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).args
    : undefined;
  const shapeProblems: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) shapeProblems.push('the plan is not an object');
  else if (bag === null || typeof bag !== 'object' || Array.isArray(bag)) shapeProblems.push('the plan carries no "args" object');
  else {
    for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
      if (!isScalar(v)) shapeProblems.push(`args.${k} must be a string, number, boolean or null`);
    }
  }
  checks.push(check('shape', shapeProblems.length === 0, shapeProblems.join('; ')));
  // Nothing below can be judged on a malformed plan, and guessing at a repair is how a guardrail
  // suite starts inventing the artifact it is supposed to be judging (`authored-action.ts`).
  if (shapeProblems.length > 0) return done(null);

  const args = bag as Record<string, PlannedArgValue>;
  const names = Object.keys(args);

  // 2. DECLARED ARGS - the only check there is. See the header.
  const declared = new Set(declaredArgsOf(input.action));
  const configKeys = new Set((input.definition.configSchema ?? []).map((f) => f?.key).filter(Boolean) as string[]);
  const undeclared = names.filter((n) => !declared.has(n)).sort();
  const credentialNamed = names.filter((n) => configKeys.has(n)).sort();
  const overwrites = names.filter((n) => Object.prototype.hasOwnProperty.call(input.callerArgs, n)).sort();
  const declaredProblems: string[] = [];
  if (undeclared.length > 0) {
    declaredProblems.push(
      `these arguments are not declared by the action's argsSchema: ${undeclared.join(', ')}`,
    );
  }
  if (credentialNamed.length > 0) {
    declaredProblems.push(
      `these arguments name credential fields of the integration and may never be model-filled: ${credentialNamed.join(', ')}`,
    );
  }
  if (overwrites.length > 0) {
    declaredProblems.push(`these arguments were supplied by the caller and are not re-decided: ${overwrites.join(', ')}`);
  }
  checks.push(check('declared_args', declaredProblems.length === 0, declaredProblems.join('; ')));

  // 3. TARGETING - decision D1. A literal `mutates === false` is the only read.
  const slots = argSlotsOf(input.action.httpConfig);
  const targeting = names.filter((n) => (slots[n] ?? 'unused') === 'targeting').sort();
  const isRead = input.action.mutates === false;
  checks.push(check(
    'targeting',
    targeting.length === 0 || isRead,
    `these arguments select which resource is acted on (they land in the URL, the query string or a header) and "${input.action.actionName}" can write, so a person supplies them: ${targeting.join(', ')}`,
  ));

  // 4. NO PASTED SECRET - `authored-action.ts` check 7, applied to values. Two passes, because the
  // repo's scrub has two, and each anchors POSITIONALLY (a bare 24-char token is not a secret; a
  // token after an auth scheme word is).
  const scrubbedWhole = JSON.stringify(redactSecrets(args as Record<string, unknown>)) === JSON.stringify(args);
  const scrubbedLeaves = names.every((n) => {
    const v = args[n];
    return typeof v !== 'string' || scrubSecretText(v) === v;
  });
  checks.push(check(
    'no_pasted_secret',
    scrubbedWhole && scrubbedLeaves,
    'one of these values looks like a literal credential; a credential is named with a {{placeholder}} the executor resolves, never passed as an argument',
  ));

  // 5. RENDER - what the request will really address, through the executor's own assertion.
  let renderDetail: string | undefined;
  let renderOk = false;
  const http = input.action.httpConfig;
  if (!http) {
    // A non-api-call action (an automation-backed one) has no URL to probe. There is nothing to
    // assert rather than nothing asserted: it does not reach `assertOriginAllowed` at call time
    // either, and pretending to probe it would be a check that cannot fail.
    renderOk = true;
  } else {
    try {
      const vars: Record<string, string> = {};
      const used = new Set<string>();
      namesIn(http.baseUrl, used);
      namesIn(http.path, used);
      namesIn(http.queryParams ?? {}, used);
      for (const name of used) {
        const supplied = Object.prototype.hasOwnProperty.call(args, name)
          ? args[name]
          : Object.prototype.hasOwnProperty.call(input.callerArgs, name)
            ? input.callerArgs[name]
            : undefined;
        vars[name] = supplied === undefined || supplied === null ? RENDER_PROBE_VALUE : String(supplied);
      }
      const rendered = new URL(`${renderTemplate(http.baseUrl, vars)}${renderTemplate(http.path, vars)}`);
      for (const [key, tpl] of Object.entries(http.queryParams ?? {})) {
        rendered.searchParams.set(key, renderTemplate(String(tpl), vars));
      }
      assertOriginAllowed(rendered.toString(), { allowedOrigins: [...input.allowedOrigins] });
      renderOk = true;
    } catch (err) {
      renderDetail = err instanceof Error ? err.message : String(err);
    }
  }
  checks.push(check('render', renderOk, renderDetail));

  return done(args);
}

/** Local interpolation for the render probe, `authored-action.ts`'s: a name that is NOT in `vars`
 *  stays a literal `{{name}}` rather than collapsing to '', because a probe that silently blanks a
 *  variable renders a URL the real call never makes. */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (_m, key: string) => vars[key] ?? `{{${key}}}`);
}

/**
 * Extract the single ```args-json block and parse it. No JSON repair pass: a malformed block is a
 * VIOLATION the authoring core's repair turn feeds back, which fixes it with the model's own eyes
 * rather than with a second copy of `agents/`'s repair heuristics (Rule 1).
 */
export function parseArgsPlan(text: string): { draft: PlannedArgs | null; violations: string[] } {
  const block = text.match(/```args-json\s*\n([\s\S]*?)```/);
  if (!block) return { draft: null, violations: ['no ```args-json block in the reply'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse((block[1] as string).trim());
  } catch (err) {
    return { draft: null, violations: [`the args-json block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { draft: null, violations: ['the args-json block must contain a single JSON object'] };
  }
  return { draft: parsed as PlannedArgs, violations: [] };
}

/**
 * The output contract, ALWAYS the last system section (the authoring core's one prompt rule).
 * Every constraint stated here is ALSO enforced by `verifyPlannedArgs`; where the two could
 * disagree, the suite wins and the plan is refused.
 */
export function argsOutputContractFor(action: IntegrationAction, fillable: readonly string[]): string {
  const slots = argSlotsOf(action.httpConfig);
  return [
    '# Output contract',
    'Reply with EXACTLY ONE fenced ```args-json block and no other fenced block. Inside it, a single',
    'JSON object carrying ONE key, "args":',
    '',
    '```args-json',
    '{ "args": { "argument_name": "value" } }',
    '```',
    '',
    '# Hard rules (a plan that breaks any of these is refused and NOTHING runs)',
    `1. You may name ONLY these arguments: ${fillable.join(', ')}.`,
    '2. Every value is a string, a number, a boolean or null. No objects, no arrays.',
    '3. Never write a credential, a token or a password as a value. Credentials are resolved by the',
    '   platform from the connection the person set up; they are never arguments.',
    '4. Omit an argument you cannot determine from the goal. An omitted argument is honest; an',
    '   invented one is not.',
    '5. You are not choosing the action. The action below was already selected and confirmed by a',
    '   person; you are only supplying the values it declares.',
    // The slot table is stated ONLY for an action that has a request to state it about. An
    // automation-backed action addresses no URL from here, so every name would read `unused` -
    // which is not "this argument goes nowhere", it is "this module cannot see where it goes", and
    // telling a model the first when the second is true is how a prompt starts lying to it.
    ...(action.httpConfig
      ? ['', '# Where each argument lands in the request', ...fillable.map((n) => `- ${n}: ${slots[n] ?? 'unused'}`)]
      : []),
  ].join('\n');
}
