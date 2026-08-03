/**
 * integrations/authored-action.ts — THE LOCKED GUARDRAILS for an action the platform wrote
 * (slice D3, the `achieve` capability's author arm).
 *
 * ================================ WHAT THIS MODULE IS =======================================
 * `integration-achieve.ts` owns the FLOW (match -> execute, or draft -> verify -> persist). This
 * module owns the two things that must be true of the RESULT, and owns them as pure functions so
 * they can be exercised — and reverted — without a model, a socket or a database:
 *
 *   1. THE VERIFICATION. `verifyAuthoredAction` is the deterministic guardrail suite a draft must
 *      pass before a single byte of it is persisted. It is re-run over the parsed draft whatever
 *      the drafting turn claimed, because the draft is MODEL OUTPUT and the prompt is a hint, not
 *      a control. Every check is named, and the named verdict is frozen onto the action.
 *   2. THE PROVISIONAL/TRUSTED STATE MACHINE. What an authored action may do before a human has
 *      looked at it, what promotes it, and why a re-author silently un-promotes it.
 *
 * ================================ WHY PROVISIONAL IS NOT COSMETIC ===========================
 * A flag that only this module reads would be decoration. This one changes what the STORED BYTES
 * are, so it is enforced by machinery that has never heard of it:
 *
 *   - A provisional action is persisted with `mutates: true`, whatever the draft declared. C2's
 *     gate lives inside `executeUserIntegrationAction`, and `action-consent.ts`'s fail-closed rule
 *     is that only a literal `mutates: false` is a read — so a provisional action needs a human
 *     approval on EVERY rail (capability route, `achieve`, automation `integration` step, listener
 *     tick, agent tool), with no branch anywhere asking whether it was authored. That is the
 *     difference between a gate and a policy: the executor cannot forget this one.
 *     It is also the right FAIL-CLOSED reading of `mutates`. `action-consent.ts` already says
 *     `mutates` "comes off an unvalidated config.json or an AGENT-AUTHORED Mongo row" and must
 *     not be trusted; an action whose `mutates: false` was written by the model in the same breath
 *     as the request it describes is precisely that case.
 *   - `achieve` never auto-executes a provisional action (`isTrustedAction` is the filter on its
 *     match arm), so the platform can never author an action and run it in the same call.
 *
 * PROMOTION is a human act: `POST /api/v1/integrations/:key/actions/:actionName/trust`,
 * `auth: 'user'` — never `user-or-key`, for exactly the reason C2 gave for the three consent
 * descriptors. An agent refused at the gate must not be able to hand itself the state that
 * un-gates it. The promoter must be able to WRITE the definition (`canEditDefinitionRaw`), must
 * echo the SHAPE they were shown (the anti-TOCTOU half, `approveAction`'s own rule), and the
 * action must carry a PASSED verification for exactly those bytes.
 *
 * A RE-AUTHOR UN-PROMOTES, with nobody remembering to reset anything: `shape` is part of the
 * record, `isTrustedAction` compares it against `actionShape` of the action's CURRENT bytes, and a
 * mismatch reads as provisional. The same property makes a hand-forged `state: 'trusted'` record
 * inert unless its author also controlled the executable bytes it fingerprints.
 *
 * ================================ THE STATED LIMIT ==========================================
 * This state machine governs what `achieve` PRODUCES. A human driving the builder save
 * (`PUT /api/v1/integration-builder/package`, `auth: 'user'`) can write any package they like,
 * including one carrying a `trusted` record — as they always could, because that route requires a
 * human session and the human IS the authority a promotion asks for. What this closes is the
 * KEY-REACHABLE path: `achieve` is `user-or-key`, and nothing an API key can reach mints a trusted
 * action or approves one.
 */
import type { Actor } from '@ekoa/shared';
import { actionShape } from './action-consent.js';
import {
  redactSecrets,
  resolveBackingType,
  scrubSecretText,
  type IntegrationAction,
  type IntegrationActionAuthoring,
  type IntegrationActionAuthoringCheck,
  type IntegrationActionAuthoringVerification,
  type IntegrationActionHttpConfig,
  type IntegrationDefinition,
} from './definitions.js';
import { assertOriginAllowed, hostMatchesOrigin, originFromBaseUrl } from '../security/origin-binding.js';

/** The goal is provenance on a stored row, not a document: capped so a caller cannot use `achieve`
 *  as free storage, and scrubbed because it is caller-supplied free text. */
export const AUTHORED_GOAL_MAX_CHARS = 500;

/** The HTTP methods an authored action may declare. `HEAD`/`OPTIONS` are omitted deliberately —
 *  nothing in this product needs them, and a narrower set is one less thing to reason about. */
const AUTHORED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** `{{name}}` / `{{$odata}}` — the ONE placeholder grammar, matching `http-template.ts`'s. */
const PLACEHOLDER_RE = /\{\{(\$?\w+)\}\}/g;

/** A well-formed authored action name. Deliberately narrower than the executor accepts: an action
 *  the platform mints is addressed in a URL path segment and shown to a human in a consent dialog. */
const AUTHORED_ACTION_NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;

/** The synthetic value every placeholder renders to during the `render` check. Never a credential,
 *  never anything an origin check could mistake for a host. */
const RENDER_PROBE_VALUE = 'v';

/** The draft shape a drafting turn must produce. Everything here is UNTRUSTED model output; the
 *  suite below is what decides whether any of it is real. */
export interface AuthoredActionDraft {
  actionName: string;
  description: string;
  /** What the model claims about mutation. Recorded, never obeyed until a human promotes it. */
  mutates: boolean;
  httpConfig: IntegrationActionHttpConfig;
  argsSchema?: Record<string, unknown>;
}

export type AuthoredActionCheckName =
  | 'shape'
  | 'action_name'
  | 'backing'
  | 'transport'
  | 'origin'
  | 'placeholders'
  | 'no_pasted_secret'
  | 'render';

export type AuthoredActionVerification = IntegrationActionAuthoringVerification;

export interface VerifyAuthoredActionInput {
  integrationKey: string;
  draft: unknown;
  /** The definition the action is being added to — its existing actions and its config schema. */
  definition: Pick<IntegrationDefinition, 'actions' | 'configSchema'>;
  /** The credential's granted egress scope, resolved BEFORE this draft existed. Never empty here:
   *  `integration-achieve.ts` refuses to draft at all without a granted binding. */
  allowedOrigins: readonly string[];
  now?: () => number;
}

function check(name: AuthoredActionCheckName, ok: boolean, detail?: string): IntegrationActionAuthoringCheck {
  return detail === undefined || ok ? { name, ok } : { name, ok, detail };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every `{{placeholder}}` name appearing anywhere in a value (strings, arrays, nested objects). */
function placeholdersIn(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(PLACEHOLDER_RE)) into.add(m[1] as string);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) placeholdersIn(v, into);
    return;
  }
  if (isPlainObject(value)) {
    for (const v of Object.values(value)) placeholdersIn(v, into);
  }
}

/** Every string leaf of a value — what the pasted-secret scan walks. */
function stringsIn(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) stringsIn(v, into);
    return;
  }
  if (isPlainObject(value)) {
    for (const v of Object.values(value)) stringsIn(v, into);
  }
}

/** The `argsSchema` properties an action DECLARES it takes. A schema without a `properties` object
 *  declares nothing, which is honest: an undeclared arg cannot be named by a template. */
export function declaredArgsOf(action: Pick<IntegrationAction, 'argsSchema'>): string[] {
  const props = (action.argsSchema as { properties?: unknown } | undefined)?.properties;
  return isPlainObject(props) ? Object.keys(props) : [];
}

/**
 * The variable names an authored action may interpolate — RUN_SPEC criterion 3's "an authored
 * action cannot name a secret … outside the integration's granted scope", as a set:
 *
 *   - the definition's own `configSchema` keys. These are the credential fields the HUMAN typed at
 *     connect; naming one is what every shipped action already does.
 *   - the draft's OWN declared args. A caller passing an argument is not a secret.
 *   - names ALREADY interpolated by an existing action of the same definition. This is the one
 *     pragmatic widening, and it is contained by construction: a provider resolver mints extra
 *     fields at run time (`{{api_base}}`, `{{access_token}}` — action-executor.ts's
 *     `resolveProviderCredentials`) that no `configSchema` declares, so without this an authored
 *     action could not reuse a var the package it lives in already relies on. It can only ever
 *     name something the package named first, so it adds no reach.
 *
 * Anything else — `{{admin_api_key}}`, `{{other_integration_token}}` — is a violation. `buildVars`
 * merges args over the decrypted credential bundle, so an undeclared name is exactly the way an
 * authored action would reach a field the human never put in this integration's schema.
 */
export function allowedTemplateVars(
  definition: Pick<IntegrationDefinition, 'actions' | 'configSchema'>,
  draftArgs: readonly string[],
): Set<string> {
  const allowed = new Set<string>(draftArgs);
  for (const field of definition.configSchema ?? []) if (field?.key) allowed.add(field.key);
  for (const action of definition.actions ?? []) {
    for (const name of declaredArgsOf(action)) allowed.add(name);
    const used = new Set<string>();
    placeholdersIn(action.httpConfig ?? {}, used);
    for (const name of used) allowed.add(name);
  }
  return allowed;
}

/**
 * THE GUARDRAIL SUITE. Deterministic, model-free, and re-run over the parsed draft regardless of
 * what the drafting turn said about itself.
 *
 * It returns a verdict rather than throwing, and the verdict is PERSISTED: "which checks did this
 * action pass, and when" is a property of the artifact, not of the request that produced it —
 * the same reasoning E2 applied to recording its model pass on the published snapshot.
 */
export function verifyAuthoredAction(input: VerifyAuthoredActionInput): {
  verification: AuthoredActionVerification;
  draft: AuthoredActionDraft | null;
} {
  const at = new Date((input.now ?? Date.now)()).toISOString();
  const checks: IntegrationActionAuthoringCheck[] = [];
  const done = (draft: AuthoredActionDraft | null) => ({
    verification: { verifiedAt: at, passed: checks.every((c) => c.ok), checks },
    draft,
  });

  // 1. SHAPE — is this even an api-call action document?
  const raw = input.draft;
  const httpConfig = isPlainObject(raw) ? raw.httpConfig : undefined;
  const shapeProblems: string[] = [];
  if (!isPlainObject(raw)) shapeProblems.push('the draft is not an object');
  else {
    if (typeof raw.actionName !== 'string' || raw.actionName.trim() === '') shapeProblems.push('actionName is missing');
    if (typeof raw.description !== 'string' || raw.description.trim() === '') shapeProblems.push('description is missing');
    if (typeof raw.mutates !== 'boolean') shapeProblems.push('mutates must be a literal true or false');
    if (!isPlainObject(httpConfig)) shapeProblems.push('httpConfig is missing');
    else {
      if (typeof httpConfig.method !== 'string' || !AUTHORED_METHODS.has(httpConfig.method)) {
        shapeProblems.push(`httpConfig.method must be one of ${[...AUTHORED_METHODS].join(', ')}`);
      }
      if (typeof httpConfig.baseUrl !== 'string' || httpConfig.baseUrl === '') shapeProblems.push('httpConfig.baseUrl is missing');
      if (typeof httpConfig.path !== 'string') shapeProblems.push('httpConfig.path is missing');
      for (const key of ['headers', 'queryParams'] as const) {
        if (httpConfig[key] !== undefined && !isPlainObject(httpConfig[key])) shapeProblems.push(`httpConfig.${key} must be an object`);
      }
      if (httpConfig.bodyTemplate !== undefined && !isPlainObject(httpConfig.bodyTemplate)) shapeProblems.push('httpConfig.bodyTemplate must be an object');
    }
    if (raw.argsSchema !== undefined && !isPlainObject(raw.argsSchema)) shapeProblems.push('argsSchema must be an object');
  }
  checks.push(check('shape', shapeProblems.length === 0, shapeProblems.join('; ')));
  // Nothing below can be judged on a malformed document, and guessing at a repair is how a
  // guardrail suite starts inventing the artifact it is supposed to be judging.
  if (shapeProblems.length > 0) return done(null);

  const draft = raw as unknown as AuthoredActionDraft;
  const http = draft.httpConfig;

  // 2. ACTION NAME — well-formed, and NEW. An authored action never overwrites an existing one:
  // that would silently re-point an action a human already approved (and, through `actionShape`,
  // invalidate their approval by editing rather than by asking).
  const nameOk = AUTHORED_ACTION_NAME_RE.test(draft.actionName);
  const taken = (input.definition.actions ?? []).some(
    (a) => a.actionName.toLowerCase() === draft.actionName.toLowerCase(),
  );
  checks.push(check(
    'action_name',
    nameOk && !taken,
    !nameOk
      ? `"${draft.actionName}" is not a valid action name (2-49 chars, lowercase letters, digits and underscores, starting with a letter)`
      : taken ? `"${draft.actionName}" already exists on this integration — authoring never overwrites an existing action` : undefined,
  ));

  // 3. BACKING — api-call ONLY. `achieve` does not mint bash-cli (a command on the user's paired
  // machine) or browser-steps (a materialised automation): both run somewhere this module cannot
  // reason about the destination of, and neither is what "call this API for me" needs.
  // A SHAPE PROBE, not the action that gets stored: `resolveBackingType` reads only the backing
  // fields, so `mutates` is carried through verbatim here. The one place `mutates` is FORCED is
  // `provisionalActionFrom` below, and it stays the only one (pinned statically by the suite).
  const candidate: IntegrationAction = {
    actionName: draft.actionName,
    description: draft.description,
    mutates: draft.mutates,
    httpConfig: http,
    backingType: 'api-call',
    transport: 'http',
    ...(draft.argsSchema !== undefined ? { argsSchema: draft.argsSchema } : {}),
  };
  const declaredBinding = (raw as Record<string, unknown>).automationBinding;
  const declaredBacking = (raw as Record<string, unknown>).backingType;
  let backingOk = declaredBinding === undefined && (declaredBacking === undefined || declaredBacking === 'api-call');
  let backingDetail = backingOk ? undefined : 'an authored action is api-call-backed only — it may declare no automationBinding and no other backingType';
  if (backingOk) {
    try {
      backingOk = resolveBackingType(candidate) === 'api-call';
      if (!backingOk) backingDetail = 'the draft does not resolve to an api-call action';
    } catch (err) {
      backingOk = false;
      backingDetail = err instanceof Error ? err.message : String(err);
    }
  }
  checks.push(check('backing', backingOk, backingDetail));

  // 4. TRANSPORT — http only. A package may legitimately declare `imap`; the executor refuses it,
  // so authoring one would mint an action that is unrunnable by construction.
  const declaredTransport = (raw as Record<string, unknown>).transport;
  checks.push(check(
    'transport',
    declaredTransport === undefined || declaredTransport === 'http',
    'an authored action runs over http; the executor refuses every other transport',
  ));

  // 5. ORIGIN — THE GUARDRAIL THIS SLICE EXISTS FOR.
  //
  // The exfiltration closed on 2026-08-03 was a peer authoring an action whose declared host they
  // chose, and the reason it worked is that for a config with no Cofre item the credential's
  // allow-list IS derived from the definition's own action base URLs. So on that branch, ADDING AN
  // ACTION WIDENS THE ALLOW-LIST — the artifact being authorised and the artifact granting the
  // authorisation are one file.
  //
  // The rule that closes it in both branches at once: an authored action may only point at a host
  // the credential was ALREADY bound to. `allowedOrigins` is resolved by
  // `resolveCredentialEgressBinding` BEFORE the draft exists (integration-achieve.ts), so:
  //   - with a Cofre item, it is the scope fixed when the human typed the credentials, and an
  //     authored action cannot extend it;
  //   - without one, it is the set of hosts the definition ALREADY declared, so an authored action
  //     can reuse a host but can never add one. The set is a pre-image; it cannot grow to fit.
  // A TEMPLATED baseUrl is refused outright: `{{api_base}}` binds to nothing, which is exactly the
  // `unbound` class the executor documents as its one un-enforced branch.
  const templatedBase = http.baseUrl.includes('{{');
  const host = templatedBase ? null : originFromBaseUrl(http.baseUrl);
  const originOk = !templatedBase
    && host !== null
    && input.allowedOrigins.length > 0
    && input.allowedOrigins.some((allowed) => hostMatchesOrigin(host, allowed));
  checks.push(check(
    'origin',
    originOk,
    templatedBase
      ? 'httpConfig.baseUrl may not be templated — an authored action must name a host that is already bound to this credential'
      : host === null
        ? `httpConfig.baseUrl "${http.baseUrl}" is not a usable absolute URL`
        : `host ${host} is not one of the hosts this credential is already bound to (${input.allowedOrigins.join(', ') || 'none'})`,
  ));

  // 6. PLACEHOLDERS — see `allowedTemplateVars`. The other half of criterion 3.
  const used = new Set<string>();
  placeholdersIn(http, used);
  const allowedVars = allowedTemplateVars(input.definition, declaredArgsOf(draft));
  const strayVars = [...used].filter((name) => !allowedVars.has(name)).sort();
  checks.push(check(
    'placeholders',
    strayVars.length === 0,
    `these template variables are not declared by this integration or by the action's own args: ${strayVars.join(', ')}`,
  ));

  // 7. NO PASTED SECRET — a literal credential in the draft rather than a `{{placeholder}}`.
  //
  // The test is the REPO'S OWN SCRUB, run over the draft and compared for equality: if the
  // read-path scrub would change any byte of this httpConfig, the draft is carrying credential
  // material. Two passes because the scrub has two, and each anchors POSITIONALLY:
  //   - `redactSecrets` — the value of a credential-NAMED key (`authorization`, `token`, `api_key`)
  //     that is not a pure `{{template}}`;
  //   - `scrubSecretText` per string leaf — a literal after an auth scheme word, or a
  //     `name: value` pair inside one.
  // Deliberately NOT `looksLikePastedSecret` applied to every token: that predicate is UNANCHORED
  // (it answers "could this run be a key"), so a 24-char URL PATH satisfies it. Anchoring is the
  // whole reason the shipped scrub is built the way it is; borrowing the predicate without the
  // position would have refused ordinary drafts and taught nobody anything.
  const literals: string[] = [];
  stringsIn(http, literals);
  const scrubbedWhole = JSON.stringify(redactSecrets(http)) === JSON.stringify(http);
  const scrubbedLeaves = literals.every((s) => scrubSecretText(s) === s);
  checks.push(check(
    'no_pasted_secret',
    scrubbedWhole && scrubbedLeaves,
    'the draft carries what looks like a literal credential; a credential is named with a {{placeholder}}, never pasted',
  ));

  // 8. RENDER — the action is actually interpolated with synthetic values and the resulting URL is
  // put through `assertOriginAllowed`, the SAME assertion the executor makes at call time. Check 5
  // judged the declared base; this judges what the request will really be, so a path or query that
  // somehow produced a different authority cannot pass by being declared politely.
  let renderDetail: string | undefined;
  let renderOk = false;
  if (originOk) {
    try {
      const vars: Record<string, string> = {};
      for (const name of used) vars[name] = RENDER_PROBE_VALUE;
      const rendered = new URL(
        `${renderTemplate(http.baseUrl, vars)}${renderTemplate(http.path, vars)}`,
      );
      for (const [key, tpl] of Object.entries(http.queryParams ?? {})) {
        rendered.searchParams.set(key, renderTemplate(String(tpl), vars));
      }
      assertOriginAllowed(rendered.toString(), { allowedOrigins: [...input.allowedOrigins] });
      renderOk = true;
    } catch (err) {
      renderDetail = err instanceof Error ? err.message : String(err);
    }
  } else {
    renderDetail = 'not rendered: the declared origin was already refused';
  }
  checks.push(check('render', renderOk, renderDetail));

  return done(draft);
}

/** Local interpolation for the render probe. Deliberately NOT `http-template.interpolate`: that
 *  one substitutes a MISSING variable with the empty string, which is right at call time and wrong
 *  here — a probe that silently blanks an unknown variable would render a URL the real call never
 *  makes. Every name found by `placeholdersIn` is in `vars`, so nothing is ever missing. */
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (_m, key: string) => vars[key] ?? `{{${key}}}`);
}

/**
 * Build the action that is PERSISTED, from a draft that passed the suite.
 *
 * `mutates: true` is FORCED here and nowhere else, so the one line that decides "an authored
 * action is gated until a human says otherwise" is a line, not a convention.
 */
export function provisionalActionFrom(input: {
  integrationKey: string;
  draft: AuthoredActionDraft;
  actor: Actor;
  goal: string;
  verification: AuthoredActionVerification;
  now?: () => number;
}): IntegrationAction {
  const base: IntegrationAction = {
    actionName: input.draft.actionName,
    description: input.draft.description,
    // THE FORCED GATE. Not `input.draft.mutates` — see the module header.
    mutates: true,
    httpConfig: input.draft.httpConfig,
    backingType: 'api-call',
    transport: 'http',
    ...(input.draft.argsSchema !== undefined ? { argsSchema: input.draft.argsSchema } : {}),
  };
  const authoring: IntegrationActionAuthoring = {
    state: 'provisional',
    authoredBy: input.actor.userId,
    authoredAt: new Date((input.now ?? Date.now)()).toISOString(),
    goal: scrubSecretText(input.goal).slice(0, AUTHORED_GOAL_MAX_CHARS),
    declaredMutates: input.draft.mutates,
    // `actionShape` fingerprints (key, name, backing, transport, httpConfig, automationBinding) —
    // none of which `authoring` is part of, so the fingerprint of `base` IS the fingerprint of the
    // action returned below, and stays valid across the `mutates` flip a promotion performs.
    shape: actionShape(input.integrationKey, base),
    verification: input.verification,
  };
  return { ...base, authoring };
}

/** `none` (human-written), `provisional`, or `trusted`. A `trusted` record whose fingerprint no
 *  longer matches the action's bytes reads as `provisional`: the action was re-authored, and a
 *  promotion is about specific bytes. */
export function authoringStateOf(
  integrationKey: string,
  action: IntegrationAction,
): 'none' | 'provisional' | 'trusted' {
  const record = action.authoring;
  if (!record) return 'none';
  if (record.state !== 'trusted') return 'provisional';
  return record.shape === actionShape(integrationKey, action) ? 'trusted' : 'provisional';
}

/**
 * May `achieve` auto-execute this action? TRUE for every action a human wrote (Rule 7: nothing
 * that worked yesterday needs promoting), FALSE for a provisional one.
 *
 * This is the second load-bearing half of the state, and it is what stops the worst defect this
 * slice could ship: `achieve` authors, and then `achieve` runs what it just authored.
 */
export function isTrustedAction(integrationKey: string, action: IntegrationAction): boolean {
  return authoringStateOf(integrationKey, action) !== 'provisional';
}

export type PromoteAuthoredActionResult =
  | { ok: true; action: IntegrationAction; alreadyTrusted: boolean }
  | { ok: false; reason: 'not_authored' | 'unverified' };

/**
 * The pure half of a promotion: provisional -> trusted, letting the DECLARED `mutates` take effect.
 *
 * Refuses `unverified` when the record's fingerprint no longer matches the action's bytes (it was
 * re-authored since it was verified) or when the frozen verification did not pass. The caller owns
 * the authorisation half — who may promote, and the shape the human echoed back.
 */
export function promoteToTrusted(
  integrationKey: string,
  action: IntegrationAction,
  actor: Actor,
  now: () => number = Date.now,
): PromoteAuthoredActionResult {
  const record = action.authoring;
  if (!record) return { ok: false, reason: 'not_authored' };
  if (!record.verification?.passed) return { ok: false, reason: 'unverified' };
  if (record.shape !== actionShape(integrationKey, action)) return { ok: false, reason: 'unverified' };
  if (record.state === 'trusted') return { ok: true, action, alreadyTrusted: true };
  return {
    ok: true,
    alreadyTrusted: false,
    action: {
      ...action,
      // The promotion is what lets the draft's own claim take effect. Until now the action has
      // been stored as a write whatever it claimed.
      mutates: record.declaredMutates,
      authoring: {
        ...record,
        state: 'trusted',
        trustedBy: actor.userId,
        trustedAt: new Date(now()).toISOString(),
      },
    },
  };
}
