/**
 * integrations/integration-achieve.ts — `achieve`: EXECUTE-OR-AUTHOR (slice D3, the last one).
 *
 * ================================ WHAT THIS IS ==============================================
 * RUN_SPEC criterion 7's third capability: a caller states a GOAL. If an action already satisfies
 * it, execute it. If none does, AUTHOR one, VERIFY it, and persist it — behind locked guardrails.
 * This is the slice where the platform extends itself, so the module is written as guardrails with
 * a flow between them rather than a flow with guardrails attached.
 *
 * ================================ THE SIX LOCKS =============================================
 *
 * 1. THE WRITE GATE IS INHERITED, NEVER REACHED PAST. The execute arm calls
 *    `executeIntegrationCapabilityAction` — which calls `executeUserIntegrationAction`, which is
 *    where C2 put `checkActionConsent`, before any credential is read. `achieve` therefore meets
 *    the gate on exactly the terms every other rail meets it. This module imports neither
 *    `checkActionConsent` nor `approveAction`, and does not execute anything itself; the static
 *    guard in `api/tests/integrations/integration-achieve.test.ts` pins that, because a future
 *    "optimisation" that inlined the check here would make this rail's behaviour independent of
 *    the executor's — the exact drift C2's own guard exists to prevent one file over.
 *
 * 2. IT NEVER RUNS WHAT IT JUST AUTHORED. The author arm returns; it does not fall through to the
 *    execute arm. And the execute arm only ever runs a TRUSTED action (`isTrustedAction`), so a
 *    provisional action cannot be reached by a second `achieve` call either. An authored
 *    `mutates` action needs a human twice over: once to promote it out of provisional, and once at
 *    C2's gate — and the authored action is stored `mutates: true` whatever it claimed, so the
 *    second one is unavoidable even if the first were somehow granted (`authored-action.ts`).
 *
 * 3. IT NEVER SELF-APPROVES. `achieve` is `user-or-key`; `POST …/approval` (C2) and
 *    `POST …/trust` (this slice) are both `auth: 'user'`. An agent refused at either gate cannot
 *    hand itself the exemption it was just quoted. Nothing in this module writes an approval or a
 *    trusted state.
 *
 * 4. COPY-ON-AUTHOR FORK. An authored action on a `global` integration lands in the ACTING
 *    TENANT'S OWN copy — never in the global row, which is edited only through the publish flow
 *    (`published_row`), including by its author. See `resolveAuthoringTarget`.
 *
 * 5. AN AUTHORED ACTION CANNOT WIDEN AN ORIGIN. The credential's granted egress scope is resolved
 *    BEFORE the draft exists, through the one custodian rule (`resolveCredentialEgressBinding`),
 *    and the draft's host must already be in it. A `refused` or `unbound` binding refuses the
 *    authoring outright rather than authoring into the branch the executor cannot enforce.
 *
 * 6. ONLY THE CUSTODIAN AUTHORS. For an org-shared config the definition governing the credential
 *    is resolved as its CUSTODIAN, not as the reader — so a peer's authored action would be BOTH
 *    the exfiltration shape that rule closed AND, since execution resolves as the custodian,
 *    unreachable. `achieve` refuses to author for anyone who is not the principal the definition
 *    resolves as.
 *
 * ================================ THE MODEL CALL ============================================
 * The drafting turn goes through D2's shared authoring core (`agents/authoring-core.ts`) — Rule 1,
 * no third authoring path. `integrations/` is tier 3 and `agents/` is tier 5, so the core arrives
 * as an INJECTED SEAM (`ActionDrafter`) bound once by the composition root, exactly as the
 * automation seam reaches `action-executor.ts`. Absent that seam, `achieve` still EXECUTES and
 * refuses to author with a coded `authoring_unavailable` — an honest default, never a silent
 * degradation into some other authoring path. Everything below the seam (the prompt, the parse,
 * the verification, the persistence) is ordinary testable code in this module, so nothing that
 * decides what gets STORED lives in a lambda in `server.ts`.
 *
 * The draft is UNTRUSTED. The prompt states every constraint, and then `verifyAuthoredAction`
 * re-checks every one of them deterministically; the prompt is a hint, the suite is the control.
 */
import type { Actor } from '@ekoa/shared';
import { checkAllowance } from '../billing/index.js';
import { decideForTask, type LlmAttribution, type RouterDecision } from '../llm/index.js';
import {
  type IntegrationAction,
  type IntegrationConfigField,
  type IntegrationDefinition,
} from './definitions.js';
import {
  canEditDefinitionRaw,
  definitionFromDoc,
  resolveSkillMd,
} from './definition-registry.js';
import {
  definitionIdFor,
  integrationDefinitionStore,
  IntegrationDefinitionStore,
  IntegrationDefinitionStoreError,
  type IntegrationDefinitionDoc,
} from './definition-store.js';
import { resolveCredentialEgressBinding } from './credential-cofre.js';
import { actionShape } from './action-consent.js';
import {
  authoringStateOf,
  isTrustedAction,
  promoteToTrusted,
  provisionalActionFrom,
  verifyAuthoredAction,
  type AuthoredActionDraft,
  type AuthoredActionVerification,
} from './authored-action.js';
// SLICE S1 (branch `feat/s1-s3-integration-surface`) - the evidence row the graduation prerequisite
// reads. See the call-site comment in `trustAuthoredAction`; this import and that call are the whole
// of S1's footprint in this file.
import { actionEvidenceStore } from './action-evidence-store.js';
import {
  executeIntegrationCapabilityAction,
  resolveCapabilityDefinition,
  type CapabilityContext,
  type CapabilityOutcome,
} from './integration-capability.js';
import type { ExecuteIntegrationActionResult } from './action-executor.js';
import { logActivity } from '../data/activity.js';

// ---------------------------------------------------------------------------
// The drafting seam
// ---------------------------------------------------------------------------

/**
 * One drafting turn, as `agents/authoring-core.ts` performs it — a NON-GENERIC projection of
 * `authorWithRepair` specialised to this module's draft. Declared structurally (no import from
 * `agents/`) so the tier-3 -> tier-5 direction is never reversed: `server.ts` binds it with
 * `(input) => authorWithRepair({ ...input, emptyReply: 'unavailable' })`.
 */
export type ActionDrafter = (input: {
  contentSections: readonly string[];
  outputContract: string;
  userText: (violations: readonly string[] | null) => string;
  decision: RouterDecision;
  attribution: LlmAttribution;
  parse: (text: string) => { draft: AuthoredActionDraft | null; violations: string[] };
  repairs?: number;
}) => Promise<ActionDraftTurn>;

export type ActionDraftTurn =
  | { status: 'authored'; text: string; draft: AuthoredActionDraft | null; violations: string[]; attempts: number }
  | { status: 'unavailable'; reason: 'transport' | 'empty' | 'aborted'; detail: string; cause?: unknown; attempts: number };

export interface AchieveContext extends CapabilityContext {
  /** The authoring seam. Absent ⇒ `achieve` executes but cannot author (see the module header). */
  draftAction?: ActionDrafter;
  /** Injected clock, so the persisted timestamps are deterministic under test. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// The wire result
// ---------------------------------------------------------------------------

/**
 * Why a goal could not be executed or authored. Every one of these is a REFUSAL of the whole call,
 * distinct from an executor result (a remote 500 is an answer, not a refusal).
 *
 *   `ambiguous_goal`        several actions fit and none fits best. Naming the candidates is the
 *                           honest answer; picking one would be a coin flip that might be a write.
 *   `provisional_match`     the best fit is an action the platform authored and no human has
 *                           promoted. `achieve` does not run those (lock 2).
 *   `not_custodian`         lock 6.
 *   `published_row`         the definition is `global` — edited through the publish flow only.
 *   `baseline_package`      a shipped package. A tenant forks it under a key of their own (A3's
 *                           reserved-key rule); `achieve` does not create a second policy for it.
 *   `not_writable`          a peer's row the caller may read but not write.
 *   `origin_refused`        the credential is locked, revoked or unresolvable — nothing may be
 *                           authored against it, exactly as nothing may be sent with it.
 *   `origin_unbound`        no bound host to check a draft against (the templated-baseUrl class).
 *   `authoring_unavailable` the drafting seam is not wired in this process.
 *   `billing_blocked`       the caller's allowance refuses a model call.
 *   `authoring_failed`      the chokepoint could not produce a draft (outage, abort, empty).
 *   `verification_failed`   a draft arrived and did NOT pass the guardrail suite. Nothing stored.
 *   `persist_failed`        the verified action could not be written (a concurrent write, a store
 *                           gate). Never silent — an unpersisted action is not an authored one.
 */
export type AchieveRefusalCode =
  | 'ambiguous_goal'
  | 'provisional_match'
  | 'not_custodian'
  | 'published_row'
  | 'baseline_package'
  | 'not_writable'
  | 'origin_refused'
  | 'origin_unbound'
  | 'authoring_unavailable'
  | 'billing_blocked'
  | 'authoring_failed'
  | 'verification_failed'
  | 'persist_failed';

export type AchieveResult =
  /** An existing TRUSTED action satisfied the goal and was run through the gated executor. */
  | { outcome: 'executed'; actionName: string; result: ExecuteIntegrationActionResult }
  /** No action satisfied it; one was authored, verified and persisted as PROVISIONAL. */
  | {
      outcome: 'authored';
      actionName: string;
      state: 'provisional';
      /** True when the action landed in a fresh COPY of a `global` integration (criterion 7). */
      forked: boolean;
      verification: AuthoredActionVerification;
      /** Always true: a provisional action is stored `mutates: true`, so it is gated. */
      requiresApproval: true;
    }
  | { outcome: 'refused'; code: AchieveRefusalCode; message: string; violations?: string[]; candidates?: string[] };

function refused(code: AchieveRefusalCode, message: string, extra: { violations?: string[]; candidates?: string[] } = {}): CapabilityOutcome<AchieveResult> {
  return { ok: true, value: { outcome: 'refused', code, message, ...extra } };
}

// ---------------------------------------------------------------------------
// Goal matching
// ---------------------------------------------------------------------------

/**
 * Stopwords, PT + EN. Small on purpose: this is a tokeniser for short action names and one-line
 * descriptions, not an NLP pipeline, and every word removed here is a word that can no longer
 * distinguish two actions from each other.
 */
const GOAL_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'you', 'your', 'our', 'get', 'set',
  'please', 'want', 'need', 'can', 'could', 'would', 'should', 'about', 'via',
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'uma', 'um', 'que', 'por', 'como', 'meu', 'minha',
  'quero', 'preciso', 'pode', 'podes', 'sobre', 'este', 'esta', 'isso', 'todos', 'todas',
]);

function goalTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !GOAL_STOPWORDS.has(t));
}

export type GoalMatch =
  | { kind: 'none' }
  | { kind: 'one'; action: IntegrationAction }
  | { kind: 'ambiguous'; candidates: string[] };

/**
 * Does an existing action satisfy the goal? DETERMINISTIC, and deliberately so.
 *
 * A model could pick more cleverly, but the thing being picked may be a WRITE against a third
 * party's account under the caller's own credential, and "the model thought you meant
 * `delete_invoice`" is not a sentence this product should be able to say.
 *
 * THE RULE IS COVERAGE, NOT OVERLAP, and the difference is the whole safety argument. An overlap
 * score matched `consultar_processo` against "arquivar um processo antigo" on the shared word
 * "processo" — i.e. it would have picked CONSULT for a goal that says ARCHIVE, and on another pair
 * of actions the same near-miss picks a write. So an action is a candidate only when the goal names
 * EVERY token of the action's own name; a goal that omits the verb omits the action.
 *
 *   1. An exact naming wins outright (`"submeter_peca"`, `"Submeter Peça"`).
 *   2. Otherwise: candidates are the actions whose name is FULLY covered by the goal. Among them,
 *      the longer name wins (it is the more specific reading), with description overlap as the
 *      tiebreak — a description can only ever separate two candidates, never create one.
 *   3. A TIE at the top is `ambiguous`, not a pick, and not a licence to author a duplicate: the
 *      caller is told which actions fit and asked to name one.
 *
 * Everything else is `none`, which routes to the author arm — where the guardrail suite, not this
 * function, decides whether anything is stored.
 */
export function matchActionForGoal(goal: string, actions: readonly IntegrationAction[]): GoalMatch {
  const goalSet = new Set(goalTokens(goal));
  if (goalSet.size === 0 || actions.length === 0) return { kind: 'none' };

  const canonicalGoal = [...goalTokens(goal)].join('_');
  const named = actions.filter((a) => goalTokens(a.actionName).join('_') === canonicalGoal);
  if (named.length === 1) return { kind: 'one', action: named[0] as IntegrationAction };
  if (named.length > 1) return { kind: 'ambiguous', candidates: named.map((a) => a.actionName).sort() };

  const scored = actions
    .map((action) => {
      const nameTokens = goalTokens(action.actionName);
      const covered = nameTokens.length > 0 && nameTokens.every((t) => goalSet.has(t));
      const descHits = goalTokens(action.description ?? '').filter((t) => goalSet.has(t)).length;
      return { action, covered, score: nameTokens.length * 2 + descHits };
    })
    .filter((s) => s.covered);
  if (scored.length === 0) return { kind: 'none' };
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  if (top.length > 1) return { kind: 'ambiguous', candidates: top.map((s) => s.action.actionName).sort() };
  return { kind: 'one', action: (top[0] as { action: IntegrationAction }).action };
}

// ---------------------------------------------------------------------------
// Where an authored action may land
// ---------------------------------------------------------------------------

export type AuthoringTarget =
  /** The actor's own-org row, writable by them: the action is appended to it in place. */
  | { kind: 'in_place'; doc: IntegrationDefinitionDoc }
  /** A `global` row authored in ANOTHER org: COPY-ON-AUTHOR (criterion 7). */
  | { kind: 'fork'; sourceId: string; source: IntegrationDefinition }
  | { kind: 'refused'; code: 'published_row' | 'baseline_package' | 'not_writable' };

/**
 * THE COPY-ON-AUTHOR FORK, and the three cases that are NOT one.
 *
 *   - No stored row at all -> the shipped disk BASELINE. Refused. A tenant row shadowing a shipped
 *     key is exactly what A3's save path refuses ("the tenant either keeps the shipped package or
 *     forks it under a distinct key of their own"), and `achieve` must not become a second policy
 *     for the same question (Rule 1). Forking here would ALSO be the only fork in this function
 *     that reuses a RESERVED key.
 *   - A row of ANOTHER org -> by the A1 visibility gate that can only be a `global`, i.e. PUBLISHED
 *     row. FORK: a fresh `private` row in the acting tenant's org, seeded from the CROSS-ORG view
 *     (the frozen published snapshot, scrubbed — E2's rule for what another org may read), with the
 *     authored action appended. The global row is not read for a write, not opened for a write, and
 *     not written: it is a different document with a different `_id`, in a different org.
 *   - The actor's OWN-ORG row that is `global` -> refused `published_row`. It cannot be forked
 *     either, because a fork's `_id` is `definitionIdFor(orgId, key)` — the very row being
 *     published. A published definition is edited through the publish flow, including by its
 *     author (`definition-save.ts`, `canEditDefinitionRaw`); this is the same rule, not a new one.
 *   - The actor's own-org row they may not write -> `not_writable`. `canEditDefinitionRaw` is the
 *     SAME predicate the builder save admits, so `achieve` grants no write reach a builder save
 *     would not.
 */
export async function resolveAuthoringTarget(
  actor: Actor,
  integrationKey: string,
  store: Pick<IntegrationDefinitionStore, 'getForActor'> = integrationDefinitionStore,
): Promise<AuthoringTarget> {
  const doc = await store.getForActor(actor, integrationKey);
  if (!doc) return { kind: 'refused', code: 'baseline_package' };
  if (doc.orgId !== actor.orgId) {
    return { kind: 'fork', sourceId: doc._id, source: definitionFromDoc(doc, actor) };
  }
  if (doc.visibility === 'global') return { kind: 'refused', code: 'published_row' };
  if (!canEditDefinitionRaw(doc, actor)) return { kind: 'refused', code: 'not_writable' };
  return { kind: 'in_place', doc };
}

/** Content fields carried from a FORK SOURCE. Absent optionals are OMITTED rather than written as
 *  `undefined` — the Mongo driver serialises that as `null`, which the shared read schemas reject
 *  (definition-save.ts's `fieldsFromPackageConfig` documents the same hazard). */
function forkContentFrom(source: IntegrationDefinition): Record<string, unknown> {
  return {
    ...(source.displayName !== undefined ? { displayName: source.displayName } : {}),
    ...(source.description !== undefined ? { description: source.description } : {}),
    ...(source.version !== undefined ? { version: source.version } : {}),
    ...(source.authType !== undefined ? { authType: source.authType } : {}),
    ...(source.provider !== undefined ? { provider: source.provider } : {}),
    ...(source.category !== undefined ? { category: source.category } : {}),
    ...(source.credentialGuide !== undefined ? { credentialGuide: source.credentialGuide } : {}),
    ...(source.sessionConnect !== undefined ? { sessionConnect: source.sessionConnect } : {}),
    ...(source.webhookConfig !== undefined ? { webhookConfig: source.webhookConfig } : {}),
    ...(source.listenerConfig !== undefined ? { listenerConfig: source.listenerConfig } : {}),
  };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/** Config-field NAMES, never values — the same facts `GET /api/v1/integrations` already publishes
 *  in `configSchema`. The definition holds no credential VALUE to leak here in the first place. */
function credentialFieldLines(fields: readonly IntegrationConfigField[]): string {
  if (fields.length === 0) return '(this integration declares no credential fields)';
  return fields.map((f) => `- {{${f.key}}} — ${f.label}${f.required ? ' (required)' : ''}`).join('\n');
}

function existingActionLines(actions: readonly IntegrationAction[]): string {
  if (actions.length === 0) return '(no actions yet)';
  return actions
    .map((a) => {
      const where = a.httpConfig ? ` [${a.httpConfig.method} ${a.httpConfig.baseUrl}${a.httpConfig.path}]` : '';
      return `- ${a.actionName} — ${a.description}${where}`;
    })
    .join('\n');
}

/**
 * The output contract, ALWAYS the last system section (the authoring core's one prompt rule).
 *
 * Every constraint stated here is ALSO enforced deterministically by `verifyAuthoredAction`. The
 * prompt exists so the first turn is usually right; the suite exists because the prompt is not a
 * control. Where the two could disagree, the suite wins and the draft is refused.
 */
function outputContractFor(allowedOrigins: readonly string[]): string {
  return [
    '# Output contract',
    'Reply with EXACTLY ONE fenced ```action-json block and no other fenced block. Inside it, a',
    'single JSON object describing ONE new HTTP action:',
    '',
    '```action-json',
    '{',
    '  "actionName": "snake_case_name",',
    '  "description": "one line, in the language of the goal",',
    '  "mutates": true,',
    '  "httpConfig": {',
    '    "method": "GET|POST|PUT|PATCH|DELETE",',
    '    "baseUrl": "https://<one of the allowed hosts>",',
    '    "path": "/resource/{{arg_name}}",',
    '    "headers": { "authorization": "Bearer {{credential_field}}" },',
    '    "queryParams": { "limit": "{{limit}}" },',
    '    "bodyTemplate": { "field": "{{arg_name}}" }',
    '  },',
    '  "argsSchema": { "type": "object", "properties": { "arg_name": { "type": "string" } } }',
    '}',
    '```',
    '',
    '# Hard rules (a draft that breaks any of these is refused and nothing is stored)',
    `1. baseUrl MUST be a literal https URL on one of these hosts: ${allowedOrigins.join(', ')}.`,
    '   It may NOT contain a {{placeholder}}.',
    '2. Every {{placeholder}} must name a credential field listed above or a property you declare',
    '   in argsSchema. No other name is permitted.',
    '3. Never paste a literal credential. A credential is always a {{placeholder}}.',
    '4. actionName must be new (not one of the existing actions), lowercase letters, digits and',
    '   underscores, starting with a letter.',
    '5. Set "mutates" honestly: true if the call creates, changes, sends or deletes anything.',
    '   It is recorded, and a human confirms it before the action can ever run.',
    '6. Declare no automationBinding, no backingType and no transport: this is an HTTP action.',
  ].join('\n');
}

/** Extract the single ```action-json block and parse it. No JSON repair pass: a malformed block is
 *  a VIOLATION the core's repair turn feeds back, which fixes it with the model's own eyes rather
 *  than with a second copy of `agents/`'s repair heuristics (Rule 1). */
export function parseActionDraft(text: string): { draft: AuthoredActionDraft | null; violations: string[] } {
  const block = text.match(/```action-json\s*\n([\s\S]*?)```/);
  if (!block) return { draft: null, violations: ['no ```action-json block in the reply'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse((block[1] as string).trim());
  } catch (err) {
    return { draft: null, violations: [`the action-json block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { draft: null, violations: ['the action-json block must contain a single JSON object'] };
  }
  return { draft: parsed as AuthoredActionDraft, violations: [] };
}

// ---------------------------------------------------------------------------
// achieve
// ---------------------------------------------------------------------------

/**
 * EXECUTE-OR-AUTHOR. See the module header for the six locks; the body below is deliberately
 * linear so the ORDER of the refusals is readable, and the order is load-bearing:
 *
 *   tenant -> definition (resolved AS THE CUSTODIAN, exactly as execution does) -> match ->
 *   [execute] | custodian check -> writable target -> egress binding -> allowance -> draft ->
 *   verify -> persist.
 *
 * Everything that can refuse WITHOUT paying for a model call is checked before the model call.
 */
export async function achieveIntegrationGoal(
  ctx: AchieveContext,
  integrationKey: string,
  goal: string,
  args: Record<string, unknown> = {},
  store: IntegrationDefinitionStore = integrationDefinitionStore,
): Promise<CapabilityOutcome<AchieveResult>> {
  const resolved = await resolveCapabilityDefinition(ctx.actor, integrationKey);
  if (!resolved.ok) return resolved;
  const { definition, config, definitionActor } = resolved.value;

  // --- MATCH -------------------------------------------------------------------------------
  const match = matchActionForGoal(goal, definition.actions ?? []);
  if (match.kind === 'ambiguous') {
    return refused(
      'ambiguous_goal',
      'several actions fit this goal equally well — name the one you want',
      { candidates: match.candidates },
    );
  }
  if (match.kind === 'one') {
    if (!isTrustedAction(integrationKey, match.action)) {
      return refused(
        'provisional_match',
        `action "${match.action.actionName}" was authored by the platform and has not been confirmed by a person yet — confirm it before it can be run`,
        { candidates: [match.action.actionName] },
      );
    }
    const out = await executeIntegrationCapabilityAction(ctx, integrationKey, match.action.actionName, args);
    if (!out.ok) return out;
    return { ok: true, value: { outcome: 'executed', actionName: match.action.actionName, result: out.value } };
  }

  // --- AUTHOR ------------------------------------------------------------------------------
  // LOCK 6. The definition governing this credential resolves as its CUSTODIAN; if that is not the
  // acting user, an authored action would be both the exfiltration shape the custodian rule closed
  // (a peer choosing the hosts an admin's credential is spent against) and unreachable, since the
  // executor would never resolve the peer's row. Refuse rather than mint a trap.
  if (definitionActor.userId !== ctx.actor.userId) {
    return refused(
      'not_custodian',
      'this integration\'s credentials were set up by somebody else in your organisation — ask them to extend it',
    );
  }

  const target = await resolveAuthoringTarget(definitionActor, integrationKey, store);
  if (target.kind === 'refused') {
    return refused(target.code, AUTHORING_TARGET_MESSAGES[target.code]);
  }

  // LOCK 5. The granted egress scope, resolved BEFORE the draft exists and through the ONE rule
  // both executor rails project (`resolveCredentialEgressBinding`). `granted` is the pre-image the
  // draft's host must already be inside; the other two answers refuse authoring outright.
  const binding = await resolveCredentialEgressBinding(ctx.actor, config, integrationKey);
  if (binding.kind === 'refused') {
    return refused('origin_refused', 'this integration\'s credential is locked or unreachable — nothing can be authored against it');
  }
  if (binding.kind === 'unbound') {
    return refused(
      'origin_unbound',
      'this integration declares no fixed host, so there is nothing to bind a new action to — add the first action in the integration builder',
    );
  }

  if (!ctx.draftAction) {
    return refused('authoring_unavailable', 'authoring new actions is not available in this deployment');
  }
  const allowance = await checkAllowance(ctx.actor.userId);
  if (!allowance.ok) {
    return refused('billing_blocked', allowance.message ?? 'Faturação bloqueada.');
  }

  const skillMd = await resolveSkillMd(definitionActor, integrationKey);
  const contentSections = [
    [
      '# The integration you are extending',
      `key: ${definition.key}`,
      `name: ${definition.displayName ?? definition.key}`,
      `description: ${definition.description ?? '(none)'}`,
      `auth type: ${definition.authType ?? 'none'}`,
    ].join('\n'),
    `# Credential fields you may reference (names only — you never see a value)\n${credentialFieldLines(definition.configSchema ?? [])}`,
    `# Actions that already exist (do not duplicate one)\n${existingActionLines(definition.actions ?? [])}`,
    `# Hosts this integration's credential is bound to\n${binding.origins.map((o) => `- ${o}`).join('\n')}`,
    ...(skillMd ? [`# What is known about this integration\n${skillMd}`] : []),
  ];

  const turn = await ctx.draftAction({
    contentSections,
    outputContract: outputContractFor(binding.origins),
    userText: (violations) =>
      violations && violations.length > 0
        ? [
          'Your previous draft was refused. Fix exactly these problems and re-emit the whole action-json block:',
          ...violations.map((v) => `- ${v}`),
          '',
          `The goal is still: ${goal}`,
        ].join('\n')
        : `Write ONE new action that achieves this goal:\n\n${goal}`,
    decision: decideForTask(goal, undefined, 'WORKHORSE'),
    attribution: authoringAttribution(ctx.actor),
    parse: parseActionDraft,
    // ONE repair turn. A generic retry produces identical garbage; the violations are what make a
    // retry fix anything (the authoring core's own rule). More than one turn of feedback on a
    // deterministic suite is paying twice for the same answer.
    repairs: 1,
  });

  if (turn.status === 'unavailable') {
    return refused('authoring_failed', `the authoring model was unavailable (${turn.reason})`);
  }

  // THE SUITE IS RE-RUN OVER THE PARSED DRAFT, whatever the turn reported. `turn.violations` is
  // the PARSER's verdict (was there a well-formed block); the guardrails are this module's.
  const { verification, draft } = verifyAuthoredAction({
    integrationKey,
    draft: turn.draft,
    definition,
    allowedOrigins: binding.origins,
    ...(ctx.now ? { now: ctx.now } : {}),
  });
  if (!verification.passed || !draft) {
    const violations = [
      ...turn.violations,
      ...verification.checks.filter((c) => !c.ok).map((c) => c.detail ?? `${c.name} failed`),
    ];
    return refused('verification_failed', 'the authored action did not pass the guardrails and was not stored', { violations });
  }

  const action = provisionalActionFrom({
    integrationKey,
    draft,
    actor: ctx.actor,
    goal,
    verification,
    ...(ctx.now ? { now: ctx.now } : {}),
  });

  try {
    await persistAuthoredAction(ctx.actor, integrationKey, target, action, skillMd ?? '', store);
  } catch (err) {
    const detail = err instanceof IntegrationDefinitionStoreError ? err.message : 'the authored action could not be stored';
    return refused('persist_failed', detail);
  }

  await auditAuthored(ctx, integrationKey, action, target.kind === 'fork');
  return {
    ok: true,
    value: {
      outcome: 'authored',
      actionName: action.actionName,
      state: 'provisional',
      forked: target.kind === 'fork',
      verification,
      requiresApproval: true,
    },
  };
}

const AUTHORING_TARGET_MESSAGES: Record<'published_row' | 'baseline_package' | 'not_writable', string> = {
  published_row: 'this integration is published to every organisation — a published definition is changed through the publish flow, not by authoring',
  baseline_package: 'this is a platform integration — copy it under a key of your own in the integration builder before extending it',
  not_writable: 'this integration belongs to somebody else in your organisation — ask them to extend it',
};

/**
 * Persist the verified action. TWO WRITES, ONE STORE GATE: both go through
 * `IntegrationDefinitionStore.create`, the same gated write path the builder save uses — never the
 * raw collection, so the actor/row congruence checks, the super-admin-only `global` tier and the
 * replace gate all still run underneath.
 *
 * THE FORK IS `onConflict: 'reject'`. `resolveAuthoringTarget` established there is no own-org row;
 * if one appeared in between, refusing is right — a fork must never overwrite a row it did not read.
 *
 * THE IN-PLACE WRITE IS `onConflict: 'replace'` and carries every field of the row forward, which
 * is exactly `definition-save.ts`'s re-save semantics. The known window is stated rather than
 * implied: a concurrent edit of the SAME row between the read above and this write is last-writer-
 * wins, as it already is for a builder re-save. It is not made narrower here because doing so would
 * mean a second write path into this collection, and two write paths is the problem this repo keeps
 * paying for.
 */
async function persistAuthoredAction(
  actor: Actor,
  integrationKey: string,
  target: Exclude<AuthoringTarget, { kind: 'refused' }>,
  action: IntegrationAction,
  /** The knowledge body as THIS reader is entitled to it — the same scrubbed cross-org view the
   *  prompt was given, so a fork copies exactly what its author could already read. */
  skillMd: string,
  store: IntegrationDefinitionStore,
): Promise<void> {
  if (target.kind === 'fork') {
    await store.create(
      {
        orgId: actor.orgId,
        userId: actor.userId,
        // PRIVATE BY DEFAULT (A1/A3). A fork is a copy for the acting tenant, not a publication;
        // sharing it is E1's explicit act.
        visibility: 'private',
        key: integrationKey,
        ...forkContentFrom(target.source),
        configSchema: target.source.configSchema ?? [],
        actions: [...(target.source.actions ?? []), action],
        skillMd,
        origin: {
          kind: 'forked',
          // The source ROW id only. `sourceOrgId` is deliberately NOT recorded: a cross-org
          // `global` row must not tell the reader which org authored it (definition-registry's
          // projection rule), and a fork is not a reason to write that fact down inside the
          // reader's own tenant.
          sourceDefinitionId: target.sourceId,
          forkedAt: action.authoring?.authoredAt ?? new Date().toISOString(),
        },
      },
      { actor, onConflict: 'reject' },
    );
    return;
  }

  const doc = target.doc;
  await store.create(
    {
      orgId: doc.orgId,
      userId: doc.userId,
      visibility: doc.visibility,
      key: doc.key,
      ...(doc.displayName !== undefined ? { displayName: doc.displayName } : {}),
      ...(doc.description !== undefined ? { description: doc.description } : {}),
      ...(doc.version !== undefined ? { version: doc.version } : {}),
      ...(doc.authType !== undefined ? { authType: doc.authType } : {}),
      ...(doc.provider !== undefined ? { provider: doc.provider } : {}),
      ...(doc.category !== undefined ? { category: doc.category } : {}),
      configSchema: doc.configSchema ?? [],
      actions: [...(doc.actions ?? []), action],
      ...(doc.credentialGuide !== undefined ? { credentialGuide: doc.credentialGuide } : {}),
      skillMd: doc.skillMd,
      ...(doc.lessons !== undefined ? { lessons: doc.lessons } : {}),
      ...(doc.sessionConnect !== undefined ? { sessionConnect: doc.sessionConnect } : {}),
      ...(doc.webhookConfig !== undefined ? { webhookConfig: doc.webhookConfig } : {}),
      ...(doc.listenerConfig !== undefined ? { listenerConfig: doc.listenerConfig } : {}),
      ...(doc.origin !== undefined ? { origin: doc.origin } : {}),
      ...(doc.publishedSnapshot !== undefined ? { publishedSnapshot: doc.publishedSnapshot } : {}),
      createdAt: doc.createdAt,
    },
    { actor, onConflict: 'replace' },
  );
}

/**
 * Attribution for the drafting turn. `user_work`, billed to the CALLING USER — the platform is not
 * paying to extend a tenant's integration, and Rule 4 means there is always a user to bill.
 *
 * `agentType` is `integration-builder`, which is the truth rather than a convenience: this is the
 * same authoring core, on the same content kind, producing the same artifact class as the builder
 * chat. A new tag would have meant editing `llm/attribution.ts`, i.e. the chokepoint, for a call
 * that is not a new kind of work.
 */
function authoringAttribution(actor: Actor): LlmAttribution {
  return { kind: 'user_work', agentType: 'integration-builder', billeeUserId: actor.userId };
}

/**
 * ONE activity row per AUTHOR. "The platform wrote code for this tenant" is exactly the event an
 * audit trail has to be able to answer afterwards, and unlike an execute it leaves a durable
 * artifact behind. Recorded: which integration, which action, whether it forked, and the key
 * principal when a gateway key drove it. NOT recorded: the goal text or the action's templates —
 * caller free text and executable content belong on the row, not duplicated into an audit log.
 *
 * Fire-and-forget in the sense that matters: an audit failure must not undo a stored action.
 */
async function auditAuthored(
  ctx: AchieveContext,
  integrationKey: string,
  action: IntegrationAction,
  forked: boolean,
): Promise<void> {
  try {
    await logActivity(
      { userId: ctx.actor.userId, username: ctx.username ?? ctx.actor.userId, orgId: ctx.actor.orgId },
      'integrations',
      'capability_achieve_author',
      ctx.deps,
      {
        integrationKey,
        actionName: action.actionName,
        state: 'provisional',
        forked,
        ...(ctx.principal ? { keyId: ctx.principal.keyId } : {}),
        ...(ctx.principal?.xClient ? { xClient: ctx.principal.xClient } : {}),
      },
    );
  } catch (err) {
    console.warn(`[integration-achieve] audit write failed for ${integrationKey}.${action.actionName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// provisional -> trusted
// ---------------------------------------------------------------------------

export type TrustAuthoredActionResult =
  | { verdict: 'ok'; actionName: string; state: 'trusted'; mutates: boolean; alreadyTrusted: boolean }
  /** The integration, or the action on it, does not resolve for this actor. No existence oracle. */
  | { verdict: 'notfound' }
  /** Visible, not writable — including every `global` row (the publish flow owns those). */
  | { verdict: 'forbidden' }
  /** The echoed shape is not this action's current shape: it changed since it was shown. */
  | { verdict: 'shape_mismatch' }
  /** The action was written by a human; there is nothing to promote. */
  | { verdict: 'not_authored' }
  /** Re-authored since it was verified, or its frozen verification did not pass. */
  | { verdict: 'unverified' }
  /**
   * SLICE S1 (branch `feat/s1-s3-integration-surface`) - the action has never had a validated run,
   * or its last one exercised different bytes.
   *
   * Distinct from `unverified` deliberately: that one means "the DRAFT no longer checks out", this
   * one means "the draft checks out and has never actually run". Collapsing them would tell a user
   * to re-author an action whose only problem is that nobody has tried it yet.
   */
  | { verdict: 'unvalidated' };

/**
 * PROMOTE an authored action to trusted — the human half of this slice.
 *
 * Its descriptor is `auth: 'user'`, deliberately not `user-or-key`, for the reason C2 gave for the
 * three consent descriptors and C3 gave for lessons: a gate that grants its own exemption is not a
 * gate, and `achieve` itself is key-reachable.
 *
 * Four gates, all of which already exist elsewhere and none of which is re-derived here:
 *   1. `canEditDefinitionRaw` — the SAME admission set the builder save accepts (and it refuses
 *      every `global` row, so a published action is not promoted through this door either).
 *   2. The echoed SHAPE must be the action's current shape — `approveAction`'s anti-TOCTOU rule,
 *      for the same reason: the human answered about the action they were shown.
 *   3. The record's own fingerprint must still match — otherwise the action was re-authored since
 *      it was verified, and the verification describes bytes that are gone.
 *   4. The frozen verification must have PASSED.
 *
 * Not-found and not-visible are the same answer, as everywhere else in this domain.
 */
export async function trustAuthoredAction(
  actor: Actor,
  integrationKey: string,
  actionName: string,
  shape: string,
  store: IntegrationDefinitionStore = integrationDefinitionStore,
  now: () => number = Date.now,
): Promise<TrustAuthoredActionResult> {
  const doc = await store.getForActor(actor, integrationKey);
  // A row of another org (necessarily `global`) is not promotable here, and answering `notfound`
  // rather than `forbidden` keeps this door from reporting anything about another tenant's rows.
  if (!doc || doc.orgId !== actor.orgId) return { verdict: 'notfound' };
  if (!canEditDefinitionRaw(doc, actor)) return { verdict: 'forbidden' };

  const index = (doc.actions ?? []).findIndex((a) => a.actionName === actionName);
  const action = index >= 0 ? (doc.actions[index] as IntegrationAction) : null;
  if (!action) return { verdict: 'notfound' };
  if (!action.authoring) return { verdict: 'not_authored' };
  if (actionShape(integrationKey, action) !== shape) return { verdict: 'shape_mismatch' };

  // ── SLICE S1 CALL-SITE CHANGE (branch `feat/s1-s3-integration-surface`) ────────────────────────
  // This is the ONLY edit that slice makes to this file, and it is here because there is nowhere
  // else it can be: `promoteToTrusted` is the one producer of `state: 'trusted'` and this is its one
  // production caller, so a graduation prerequisite wired anywhere else would be a gate in a
  // consumer that any future caller bypasses.
  //
  // Promotion used to prove SHAPE and never BEHAVIOUR - an action could graduate to `trusted`, and
  // so become auto-runnable by `achieve`, having never run once. The LAST VALIDATED RUN is now the
  // prerequisite: `integration_action_evidence` holds one live row per (org, OWNER, integration,
  // action), written by the executor on a successful run and stamped with the action shape that run
  // exercised. `promoteToTrusted` refuses when it is missing or names different bytes.
  //
  // THE EVIDENCE READ IS THE PROMOTING ACTOR'S OWN, and the owner term is what makes that true. A
  // definition shared at `org` visibility is run by different people under DIFFERENT credentials
  // (`findConfigForOwner` resolves per owner) against different third-party accounts, so with an
  // org-only key user A could promote an action to `trusted` - and thereby make it auto-runnable by
  // `achieve` - on the strength of a run user B made against B's OWN account. The gate now asks
  // whether the person granting the trust has themselves seen this action work.
  const evidence = await actionEvidenceStore.getEvidence({
    orgId: actor.orgId,
    ownerUserId: actor.userId,
    integrationKey,
    actionName,
  });
  const promoted = promoteToTrusted(integrationKey, action, actor, evidence, now);
  if (!promoted.ok) {
    if (promoted.reason === 'not_authored') return { verdict: 'not_authored' };
    return { verdict: promoted.reason === 'unvalidated' ? 'unvalidated' : 'unverified' };
  }

  if (!promoted.alreadyTrusted) {
    const actions = [...doc.actions];
    actions[index] = promoted.action;
    await store.create(
      {
        ...doc,
        actions,
        // Re-stated rather than spread-and-hoped: `create` derives the `_id` from (orgId, key), and
        // the replace gate re-judges the write against the row as it stands.
        orgId: doc.orgId,
        userId: doc.userId,
        visibility: doc.visibility,
        key: doc.key,
        createdAt: doc.createdAt,
      },
      { actor, onConflict: 'replace' },
    );
  }
  return {
    verdict: 'ok',
    actionName,
    state: 'trusted',
    mutates: promoted.action.mutates,
    alreadyTrusted: promoted.alreadyTrusted,
  };
}

/** Re-exported so a caller that only imports this module can read an action's state without
 *  reaching for the guardrail module directly. */
export { authoringStateOf, isTrustedAction, definitionIdFor };
