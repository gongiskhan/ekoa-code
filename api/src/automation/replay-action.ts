/**
 * automation/replay-action.ts - the MOUNT: where an integration action's compiled recipe is
 * actually tried before the expensive path runs (slice P2.3).
 *
 * `executors/injected-call.ts` knows how to replay a recipe. This module is the small amount of
 * wiring that decides whether to, for a real action on a real run: it resolves the action (for its
 * origin posture), reads the recipe org-scoped, borrows the owner's authenticated browser, and
 * hands the whole thing to the executor.
 *
 * ── IT IS A PURE OPTIMISATION, AND IT FAILS OPEN INTO THE OLD PATH ───────────────────────────
 *
 * Every outcome other than `ok` and `write-gate` means "the caller should run the action the way it
 * always did". No recipe, an unreadable recipe, no daemon, an adversarial origin with no session,
 * a site that drifted - all of them fall through to the vision-driven automation. That asymmetry is
 * the whole safety argument for mounting this on the hot path at all: the worst case of a replay
 * that cannot proceed is the cost of the run before this slice existed.
 *
 * `write-gate` is the one exception: it is a REFUSAL, and falling through would run the write by
 * the other path, which would make the gate decorative.
 *
 * ── POSTURE IS A FUNCTION HERE, NOT A VALUE ──────────────────────────────────────────────────
 *
 * What this module hands the executor is `classify`, asked once per call about that call's own
 * origin. The first version resolved one classification - from the recipe's FIRST call - and
 * applied it to the whole list, so a recipe whose opening hop was permissive treated every later
 * hop as permissive too, including hosts nobody had classified. A posture is a statement about an
 * origin; the unit it is decided at has to be the origin.
 *
 * ── WHY THE RECIPE IS READ HERE AND NOT FROM THE RESOLVED DEFINITION ─────────────────────────
 *
 * The definition the rest of the system resolves has had its recipes STRIPPED - by construction,
 * at three separate boundaries (`actionsWithoutRecipes`), so a tenant's learning cannot reach the
 * wire or a published snapshot. The action doc read below is therefore used ONLY for its posture
 * declaration; the recipe comes from `recipe-store`, the org-scoped read that exists for this
 * caller. Reading both from one place would either leak recipes onto the wire or find none here.
 */
import { randomUUID } from 'node:crypto';
import type { Actor } from '@ekoa/shared';
import { integrationDefinitionStore } from '../integrations/definition-store.js';
import { integrationRecipeStore } from '../integrations/recipe-store.js';
import type { SecretRegistry } from '../security/redaction.js';
import { DaemonBrowserSession, releaseBrowserLease, type BrowserLease } from './browser-session.js';
import { replayCompiledAction, type ReplayInput, type ReplayResult } from './executors/injected-call.js';
import { classifyOrigin, type OriginClassification } from './origin-posture.js';
import { getDaemonConnection, loadEgressCandidates } from './seams.js';
import { residentialEgressPairings } from './egress-policy.js';
import { ensureSession } from './session-establishment.js';

export interface ReplayActionInput {
  orgId: string;
  ownerUserId: string;
  integrationKey: string;
  actionName: string;
  args: Record<string, unknown>;
  /**
   * THIS REPLAY'S EXECUTION ID, minted by the caller.
   *
   * It is the id the browser lease is taken under and the id every frame this replay sends is
   * ledgered against on the machine - and it is also the `runId` the caller puts in the answer's
   * envelope, because a replay must answer in the same envelope as the run it replaces. Minting it
   * here instead would give the caller nothing to name the execution with, and an id invented at
   * the envelope would name nothing an operator could look up.
   *
   * Optional so the un-threaded unit callers keep working; absent means "nobody needs to correlate
   * this attempt", and the session helper mints its own.
   */
  runId?: string;
  /** The run's live credential values. Passed straight through so `assertNoCredentialRodeIn` runs
   *  against the values that actually exist on this run, not only where a test built a registry. */
  secrets?: SecretRegistry;
  /** The owner's answer to this action's write approval, carried down from the executor's gate. */
  writeAssent?: boolean;
  /**
   * The mount's REPLAY_BUDGET abort (K6 review fix). The budget race abandons the attempt's
   * promise; without this signal the abandoned attempt kept issuing its remaining calls and held
   * the owner's browser lease, so the authored run the budget fell through to queued behind the
   * very attempt it was rescuing the action from. Checked between calls, never mid-transport.
   */
  signal?: AbortSignal;
  /**
   * The action's DECLARED effect (`IntegrationAction.mutates`). Not the assent - see `ReplayInput`.
   *
   * REQUIRED, not optional, and that is the point: the field is optional at the SEAM
   * (`ActionRunInput`, `AutomationBackedHandler`) because Rule 7 says an added field may not change
   * an existing implementer, and it is normalised to a definite boolean once, fail-closed, in
   * `runAutomationForAction`. Leaving it optional here as well would mean the repo's reading of
   * `mutates` - only a literal `false` is a read - was stated in two places and could disagree in
   * one of them; a required boolean makes "the caller forgot" a compile error instead.
   */
  mutates: boolean;
}

export interface ReplayActionDeps {
  /** Injected for the unit lane; defaults resolve the real stores and the real daemon. */
  loadAction?: (actor: Actor, key: string, actionName: string) => Promise<PostureAndOrigin | null>;
  loadRecipe?: (orgId: string, key: string, actionName: string) => Promise<unknown>;
  openSession?: (input: ReplayActionInput, sessionState?: unknown) => Promise<OpenedSession | null>;
  /**
   * The stored session for the origin this recipe replays against, resolved through the SAME
   * `ensureSession` the authored run uses (Rule 1). Injected only by tests; the default reads the
   * Cofre. See `resolveReplaySession` for why a replay may only ever REUSE one.
   */
  resolveSession?: (input: ReplayActionInput, origin: string) => Promise<unknown | null>;
}

/** What the mount needs off an action: enough to classify its origin, and nothing else. */
export interface PostureAndOrigin {
  posture?: 'permissive' | 'adversarial';
  authProfile?: { attended: boolean };
  httpConfig?: { baseUrl?: string };
}

export interface OpenedSession {
  browser: NonNullable<ReplayInput['browser']>;
  /** Called whether the replay worked or not. Never throws - it runs in a `finally`. */
  close: () => Promise<void>;
}

/**
 * Try the compiled recipe. Answers a `ReplayResult` the caller dispatches on.
 *
 * NOTE THE ORDER: the recipe is read BEFORE a browser is opened. Opening a headed browser costs
 * seconds and takes the machine's lease; doing it for an action that has never been discovered
 * would make the un-discovered case SLOWER than it is today, which is the one regression this
 * optimisation must not have.
 */
export async function replayIntegrationAction(
  input: ReplayActionInput,
  deps: ReplayActionDeps = {},
): Promise<ReplayResult> {
  const loadRecipe = deps.loadRecipe ?? ((orgId, key, actionName) => integrationRecipeStore.getRecipe(orgId, key, actionName));
  const stored = await loadRecipe(input.orgId, input.integrationKey, input.actionName);
  if (stored === null || stored === undefined) {
    return { outcome: 'no-recipe', reason: 'this action has never been discovered' };
  }

  const loadAction = deps.loadAction ?? defaultLoadAction;
  const actor: Actor = { userId: input.ownerUserId, orgId: input.orgId, role: 'user' };
  const action = await loadAction(actor, input.integrationKey, input.actionName);
  const classify = classifierFor(action);

  // THE STORED SESSION, BEFORE THE BROWSER. A replay drives the page from inside an authenticated
  // context or it does not run at all: opening the lease first and discovering the jar is empty is
  // what made an unauthenticated 401 look like the site had moved (see `resolveReplaySession`).
  const replayOrigin = originForReplay(action, stored);
  const sessionState = replayOrigin
    ? await (deps.resolveSession ?? resolveReplaySession)(input, replayOrigin)
    : null;

  const openSession = deps.openSession ?? openOwnerBrowserSession;
  // The whole input, so the session helper reads THIS attempt's execution id off it (see `runId`).
  const session = await openSession(input, sessionState ?? undefined);
  try {
    return await replayCompiledAction(
      {
        // So the executor can tell an authenticated jar from a bare lease - see `sessionDelivered`.
        sessionDelivered: sessionState !== null && sessionState !== undefined,
        orgId: input.orgId,
        integrationKey: input.integrationKey,
        actionName: input.actionName,
        args: input.args,
        classify,
        ...(session ? { browser: session.browser } : {}),
        // THE RUN'S LIVE VALUES, ALL THE WAY DOWN. `assertNoCredentialRodeIn` is inert without
        // them, so this hop is the difference between a proof and a comment. It is pinned by
        // `replay-mount.test.ts` ("a credential that rode in on an ARGUMENT never reaches the
        // page"), which asserts the CONSEQUENCE - the machine was never asked to make the call.
        ...(input.secrets !== undefined ? { secrets: input.secrets } : {}),
        ...(input.writeAssent !== undefined ? { writeAssent: input.writeAssent } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        mutates: input.mutates,
      },
      { loadRecipe: async () => stored },
    );
  } finally {
    if (session) await session.close();
  }
}

// ------------------------------------------------------------------------------------------
// defaults
// ------------------------------------------------------------------------------------------

async function defaultLoadAction(actor: Actor, key: string, actionName: string): Promise<PostureAndOrigin | null> {
  const doc = await integrationDefinitionStore.getForActor(actor, key);
  const action = (doc?.actions ?? []).find((a) => a.actionName === actionName);
  if (!action) return null;
  return {
    ...(action.posture !== undefined ? { posture: action.posture } : {}),
    ...(action.authProfile !== undefined ? { authProfile: action.authProfile } : {}),
    ...(action.httpConfig !== undefined ? { httpConfig: { ...(action.httpConfig.baseUrl !== undefined ? { baseUrl: action.httpConfig.baseUrl } : {}) } } : {}),
  };
}

/**
 * Borrow the owner's authenticated browser for the replay.
 *
 * A LEASE OF ITS OWN, minted per attempt. A replay is not a step inside somebody else's run - it is
 * the whole execution of one action - so it neither joins a call tree's lease nor leaves one behind:
 * the `finally` releases it whatever happened. Answering `null` when no daemon is paired is not a
 * failure; the executor then decides whether a permissive origin can be reached without one.
 */
export async function openOwnerBrowserSession(
  input: { ownerUserId: string; runId?: string },
  sessionState?: unknown,
): Promise<OpenedSession | null> {
  const conn = getDaemonConnection(input.ownerUserId);
  if (!conn) return null;
  // The CALLER'S execution id when it has one, so the frames the machine ledgers and the `runId`
  // the caller answers with are the same string. A local one otherwise - the unit callers.
  const runId = input.runId ?? `replay-${randomUUID()}`;
  const lease: BrowserLease = { id: runId, used: false };
  // THE SESSION TRAVELS UNDER THIS ATTEMPT'S OWN ID. The daemon holds delivered sessions keyed by
  // runId, and a replay mints its own (`replay-<uuid>`) - so the authored run's delivery, made under
  // a different id, was never found. Without this the replay drove a signed-out jar.
  const browser = new DaemonBrowserSession({
    connection: conn,
    runId,
    ownerUserId: input.ownerUserId,
    lease,
    ...(sessionState !== undefined ? { sessionState } : {}),
  });
  return {
    browser,
    close: async () => {
      await browser.dispose().catch(() => undefined);
      // Only when something actually took it. `used` is set on the first frame the session sends,
      // so a replay that never reached the machine does not send a release for a lease nobody has.
      if (lease.used) await releaseBrowserLease(conn, { leaseId: lease.id, ownerUserId: input.ownerUserId, runId });
    },
  };
}

/**
 * THE ORIGIN THIS RECIPE REPLAYS AGAINST, for the one purpose of finding a session for it.
 *
 * The action's declared base URL when it has one (an api-call action); otherwise the first call the
 * recipe compiled, which for a browser-steps action is the only statement of where it goes. Answers
 * null for a recipe whose first call is templated or unparseable - and a null origin means no
 * session lookup and no adversarial refusal, i.e. exactly the behaviour before this existed.
 */
function originForReplay(action: PostureAndOrigin | null, stored: unknown): string | null {
  const declared = originOfUrl(action?.httpConfig?.baseUrl);
  if (declared) return declared;
  // `injectedCalls` is the STORED field name (`recipe-store.ts`); the `calls` on the wire view is a
  // display projection of `METHOD urlTemplate` strings and is not what `getRecipe` answers with.
  // Reading the wire name here returned null for every browser-steps action - the exact shape this
  // whole path exists for - and a null origin skipped the session lookup silently.
  const calls = (stored as { injectedCalls?: unknown } | null)?.injectedCalls;
  if (!Array.isArray(calls)) return null;
  for (const call of calls) {
    const url = (call as { urlTemplate?: unknown } | null)?.urlTemplate;
    const origin = originOfUrl(typeof url === 'string' ? url : undefined);
    if (origin) return origin;
  }
  return null;
}

/** Scheme + host + port, or null for a templated / unparseable / non-http URL. */
function originOfUrl(raw: string | undefined): string | null {
  if (!raw || raw.includes('{{')) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The stored session for `origin`, or null - and REUSE IS THE ONLY ACCEPTABLE OUTCOME.
 *
 * `ensureSession` is the one implementation of "what session may this actor use here" (Rule 1), so
 * the replay asks it rather than growing a second checkout. But a replay is an OPTIMISATION on the
 * hot path: it may not log anybody in, may not open a ceremony, and may not spend a credential. It
 * passes no `credentialRef` and no `hostedTypist` permit, which leaves the typist route unreachable
 * by construction, and it then accepts ONLY `reused`. Every other verdict - needs-human,
 * needs-egress, a locked Cofre, a throw - answers null, and the caller falls through to the
 * authored run, which is what those verdicts mean anyway.
 *
 * `residentialAvailable` is read from the SAME fleet predicate the engine uses. Omitting it would
 * default to `[]`, and a ceremony session is stamped `boundEgress: residential` - so checkout would
 * refuse every attended session and no session-gated recipe could ever replay.
 */
export async function resolveReplaySession(input: ReplayActionInput, origin: string): Promise<unknown | null> {
  const actor: Actor = { userId: input.ownerUserId, orgId: input.orgId, role: 'user' };
  try {
    const verdict = await ensureSession({
      actor,
      integrationKey: input.integrationKey,
      origin,
      runId: input.runId ?? `replay-${randomUUID()}`,
      residentialAvailable: residentialEgressPairings((await loadEgressCandidates(input.orgId)) ?? [], input.orgId),
    });
    return verdict.status === 'reused' ? verdict.storageState : null;
  } catch {
    // A replay must never fail an action that worked before it existed. Whatever went wrong -
    // a locked Cofre, an origin refusal, a store outage - the authored run still answers.
    return null;
  }
}

/**
 * The per-call posture resolver.
 *
 * `classifyOrigin` folds in the action's declaration and applies its own rule: a declaration
 * attached to an action WITH a declared base URL classifies only THAT origin, so a `permissive`
 * label cannot follow the recipe onto a third-party host it happened to call. An action nobody
 * classified, or an origin that will not parse, gets the closed answer.
 */
export function classifierFor(action: PostureAndOrigin | null): (origin: string) => OriginClassification {
  return (origin: string) => classifyOrigin(origin, action ?? undefined);
}
