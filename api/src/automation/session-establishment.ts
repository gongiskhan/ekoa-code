/**
 * automation/session-establishment.ts — the pre-run session gate (Cofre G-4/G-5 + F-2 wiring).
 *
 * WHAT THIS EXISTS FOR. Two pieces were built, security-tested, and wired to NOTHING: `typistLogin`
 * (the trusted credential-filling primitive) and `checkoutSession` (the pure health-then-egress
 * decision). Neither is useful alone — one decides, the other acts, and the thing that was missing
 * is the small, deterministic module that puts them in the right order. This is that module, and it
 * is deliberately the ONLY place where "the session is stale" turns into "log in again".
 *
 * THE FLOW, and why it is exactly this shape:
 *   1. Find the actor's `session` items bound to the origin, and ask `checkoutSession` about them.
 *      HEALTH BEFORE EGRESS, because a dead session reported as "no route out" sends the operator to
 *      look at the network when the problem is the credential.
 *   2. `ok` -> unwrap the stored storageState and hand it back. No browser is opened at all: the
 *      overwhelmingly common case must cost nothing and must not touch a password.
 *   3. `reestablish` with route `typist` -> open a browser, navigate to the login page, and run the
 *      typist. The typist is the whole credential-handling story (origin check before unwrap,
 *      out-of-band CDP fill, screencast suppression, fill-and-submit as one unit); this module adds
 *      nothing to it and is careful to subtract nothing either.
 *   4. Route `attended` or `relay` -> a TYPED REFUSAL. Establishment never improvises: it does not
 *      "try the typist anyway" against a portal that wanted a card reader, and it never puts a login
 *      form in front of a model. A refusal that names its route is something the caller can act on;
 *      a best-effort attempt is how accounts get locked.
 *
 * ================================ THE CALLER CONTRACT ================================
 * A `needs-human` refusal carries `attempted`, and it is REQUIRED because the three ways to reach
 * that status are not the same event:
 *
 *   attempted:false — NOTHING was typed. Checkout asked for a ceremony this module will not
 *                     improvise, there was no credential reference to replay, or the run had
 *                     already spent its one login. The portal never saw a request. A caller may
 *                     retry after a human supplies whatever was missing.
 *   attempted:true  — A PASSWORD WAS SUBMITTED and the portal did not accept it into a logged-in
 *                     state. This is the wrong-password / changed-form signature, and it is
 *                     indistinguishable from the outside from a failed authentication.
 *
 * A CALLER MUST TREAT `attempted:true` AS A CONSUMED LOGIN ATTEMPT AND MUST NOT RETRY WITHOUT HUMAN
 * INPUT. The lock-out policies of the portals this targets (Caixa Citius among them) are unknown
 * and unforgiving; N automated retries against a portal that just refused a password is how an
 * account is locked. When this module cannot tell whether a credential was submitted it reports
 * `true`: over-reporting costs one manual re-run, under-reporting costs an account.
 *
 * AT MOST ONCE — the rule that keeps accounts unlocked. One call re-establishes AT MOST ONE time.
 * There is no loop, no retry, and no re-checkout after a successful login. A caller that wants a
 * run-level budget rather than a per-call one passes `allowReestablish: false` on subsequent calls
 * and gets the typed refusal instead of a login.
 *
 * HEALTH-ON-USE. A session can die mid-run: the portal bounces a request back to the login page and
 * everything after that is nonsense. `markSessionUnhealthy(actor, itemId)` is the write for that
 * observation — the caller marks the item, and the NEXT `ensureSession` sees `unhealthy` and routes.
 * It is a separate function on purpose: this module must not be able to notice a redirect and
 * silently re-authenticate in the middle of a run.
 *
 * A LOCKED ITEM IS NOT A REASON TO LOG IN AGAIN. If `unwrap` refuses the stored session with
 * COFRE_LOCKED on the reuse path, that is the USER deliberately locking their own credential —
 * lock-now / lock-all is the kill switch for exactly this. It is surfaced as the typed
 * `CofreLockedError`, never converted into "well, re-establish it then": a module that answers a
 * revocation by re-authenticating has no kill switch at all.
 *
 * WHAT NEVER LEAVES HERE. No credential VALUE, in a return, a log, or an error. The things handed
 * back are the storageState handle the caller passes to a browser context (itself
 * credential-equivalent, and treated as such by the Cofre), a status, an item id, and — on
 * `reestablished` only — the typist's `SecretRegistry`, which exists precisely so the caller can
 * REDACT the value out of its own streams. Every message this module composes is built from the
 * host, the route and the item id; a failure message from below that this module cannot vouch for
 * is replaced rather than repeated (see `sanitizeLoginFailure`).
 */
import type { Page } from 'playwright';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import {
  boundOriginsForEstablishedHost,
  captureSessionWithGrant,
  checkoutSession,
  CofreLockedError,
  CofreNotFoundError,
  CredentialOriginError,
  findSessionItemsForOrigin,
  hasStandingGrant,
  markSessionUnhealthy as persistSessionUnhealthy,
  originsFromStorageState,
  unwrap,
  type CheckoutDecision,
  type CofreItemDoc,
  type ReestablishRoute,
  type UnwrappedCredential,
  type UsageContext,
  type UnwrapOptions,
} from '../cofre/index.js';
import type { SecretRegistry } from '../security/redaction.js';
import { beginCredentialWindowForTrace, traceIsSuppressed } from '../streaming/registry.js';
import { loginUrlForHost, recipeForHost } from './login-recipes.js';
import { getLocalBrowserContext } from './seams.js';
import {
  typistLogin,
  TypistNotSuppressed,
  TypistUnknownPattern,
  type TypistDeps,
  type TypistLoginInput,
  type TypistRecipe,
  type TypistResult,
} from './typist.js';

/** A caller error terminal for the step: the request itself is unsafe or incoherent. */
export class SessionEstablishmentError extends Error {
  readonly code = 'SESSION_ESTABLISHMENT_REFUSED';
  constructor(message: string) {
    super(`session establishment: ${message}`);
    this.name = 'SessionEstablishmentError';
  }
}

/**
 * A login failed with an error this module cannot vouch for the TEXT of.
 *
 * The failures below this point come from Playwright, CDP and the page itself, and the call that
 * produced them was holding a decrypted password. A protocol error routinely echoes the parameters
 * of the request that failed, and `Input.dispatchKeyEvent` carries the characters being typed — so
 * a raw message from that layer is an untrusted string on the one channel where an untrusted string
 * can be the credential. This module holds no registry with which to redact it (the typist's
 * registry only exists on the SUCCESS path), and "we could not redact it" must not resolve to "so
 * we printed it". The message is therefore replaced, not repeated.
 *
 * What survives is the failing error's CLASS NAME — code-controlled, not data-controlled — so an
 * operator still learns whether this was a timeout, a protocol error or something else.
 *
 * `attempted` is conservatively TRUE: the failure happened inside the typist call, which may have
 * submitted the form before it threw. See the caller contract at the top of the file.
 */
export class SessionEstablishmentFailure extends Error {
  readonly code = 'SESSION_ESTABLISHMENT_FAILED';
  /** A credential MAY have been submitted before this failure. Treat it as a spent attempt. */
  readonly attempted = true;
  /** The failing error's class name — a name, never its message. */
  readonly failureName: string;
  constructor(host: string, failureName: string) {
    super(`session establishment: the login on ${host} failed (${failureName})`);
    this.name = 'SessionEstablishmentFailure';
    this.failureName = failureName;
  }
}

/**
 * Error classes whose messages this codebase composes and therefore vouches for. Each is built from
 * ids, hosts and fixed text, and each is one the CALLER must be able to branch on:
 * `CofreLockedError` routes to the unlock page, `CredentialOriginError` to the binding the user can
 * fix, `TypistUnknownPattern` to the relay. Passing these through unchanged is what keeps the
 * routing table usable; everything else is replaced.
 */
const MESSAGE_SAFE_FAILURES: ReadonlyArray<new (...args: never[]) => Error> = [
  SessionEstablishmentError,
  CofreLockedError,
  CofreNotFoundError,
  CredentialOriginError,
  TypistUnknownPattern,
  TypistNotSuppressed,
];

/** A class name is code, not data — but it is still read off an object, so it is bounded. */
function safeErrorName(err: unknown): string {
  const raw = (err as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return typeof raw === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(raw) ? raw : 'Error';
}

/** Pass through what we vouch for; replace everything else. Never logs, never wraps as `cause`. */
function sanitizeLoginFailure(err: unknown, host: string): unknown {
  if (MESSAGE_SAFE_FAILURES.some((ctor) => err instanceof ctor)) return err;
  return new SessionEstablishmentFailure(host, safeErrorName(err));
}

// ---------------------------------------------------------------------------
// The browser seam
// ---------------------------------------------------------------------------

/**
 * A browser the typist can be driven against, plus the ONE thing this module needs afterwards: the
 * context's `storageState()`.
 *
 * Not `BrowserSession` (browser-session.ts) on purpose. That interface is the ENGINE's view — acts,
 * assertions and observations, all of which either round-trip through the daemon or feed the vision
 * tier. The typist needs a real `Page` (it dispatches CDP key events at the input layer), and
 * capture needs the CONTEXT's cookie jar. Neither is expressible through the observation envelope,
 * and widening `BrowserSession` to expose a raw page would hand every engine step the primitive the
 * typist exists to keep scarce.
 */
export interface EstablishmentBrowser {
  /** The live page the typist drives. */
  page: Page;
  /** The context's storageState AFTER the login — the captured session. */
  storageState(): Promise<unknown>;
  /** Tear the context down. Always called, including on failure. */
  close(): Promise<void>;
}

export type BrowserOpener = (input: { ownerUserId: string }) => Promise<EstablishmentBrowser>;

/**
 * The real opener: a FRESH context from the automation browser seam.
 *
 * Fresh, never persistent: a login must start from an empty cookie jar, or "the session was
 * re-established" can silently mean "the old cookies were still there and nothing was proven" — and
 * `storageState()` below would capture the owner's whole cross-site jar rather than this portal's
 * session. The seam's contract says so (automation/seams.ts) and a lifecycle suite pins it.
 */
const defaultOpenBrowser: BrowserOpener = async ({ ownerUserId }) => {
  const context = await getLocalBrowserContext(ownerUserId);
  const page = await context.newPage();
  return {
    page,
    storageState: () => context.storageState() as Promise<unknown>,
    close: async () => {
      // Best-effort: teardown must never mask the outcome of the login itself.
      await context.close().catch(() => {});
    },
  };
};

/**
 * The typist's observation-channel deps, bound to the live streaming registry.
 *
 * `withCaptureSuppressed` is the identity here, and that is honest FOR `defaultOpenBrowser` AND
 * NOTHING ELSE: the page that opener creates belongs to this module, and the engine's screenshot
 * loop (the thing `withCaptureSuppressed` silences) never runs against it. Against any other page
 * it is a lie that reads as a control. The two knobs are therefore inseparable — injecting
 * `openBrowser` without a matching `typistDeps` is refused in `ensureSession` rather than quietly
 * running the typist with a pass-through suppressor (deps merge shallowly, so the partial
 * combination used to be one keystroke away).
 */
const defaultTypistDeps: TypistDeps = {
  beginCredentialWindow: beginCredentialWindowForTrace,
  isSuppressed: traceIsSuppressed,
  withCaptureSuppressed: (fn) => fn(),
};

// ---------------------------------------------------------------------------
// Input / output
// ---------------------------------------------------------------------------

/** Where THIS process is establishing from. Recorded on the item so checkout can match it later. */
export interface EstablishmentVantage {
  establishedBy: SessionMetadata['establishedBy'];
  boundEgress: SessionMetadata['boundEgress'];
}

export interface EnsureSessionInput {
  actor: Actor;
  /** The integration/portal this session belongs to. Becomes the Cofre item label. */
  integrationKey: string;
  /** The portal host (bare host or full origin) the session must be replayable against. */
  origin: string;
  /**
   * `cofre:<itemId>` for the PASSWORD the typist would replay. A REFERENCE — this module, like the
   * typist, never accepts a value. Absent means no unattended re-establishment is possible.
   */
  credentialRef?: string;
  /**
   * Where the typist starts. OPTIONAL, and NOT the authority: a host whose recipe declares a login
   * URL uses the recipe's, and a caller-supplied URL that disagrees with it is REFUSED rather than
   * trusted (see `resolveLoginUrl`). Must be https and on `origin` in either case.
   */
  loginUrl?: string;
  /** A non-secret username filled alongside the password, when the form has one. */
  username?: string;
  runId: string;
  /** The live-view trace whose screencast must be suppressed. Defaults to the run id. */
  traceId?: string;
  /** Pairing ids that can currently provide residential egress for this org. */
  residentialAvailable?: readonly string[];
  datacenterAvailable?: boolean;
  /** Defaults to a cloud-established, datacenter-bound session. */
  vantage?: EstablishmentVantage;
  /** Session TTL for a freshly captured item; defaults to the Cofre's. */
  ttlMs?: number;
  /**
   * Run-level at-most-once. `false` turns the typist route into a `needs-human` refusal, so a caller
   * that has already re-established once in this run cannot accidentally do it twice.
   */
  allowReestablish?: boolean;
  /**
   * The origin's login is OTP / MFA / CAPTCHA gated (`origin-posture.ts` `requiresAttendedAuth`).
   *
   * ABSENT MEANS FALSE, which is today's behaviour, and that is the one direction this default may
   * fail in: `true` only ever REMOVES the typist route. The caller resolves it (posture is a fact
   * about the action being run, and this module does not know the action); this module's job is to
   * make it un-overridable once it arrives — see `decideReauthRoute`.
   */
  requiresAttendedAuth?: boolean;
}

/**
 * The outcome. FOUR members, because the failure shapes are genuinely different problems and
 * collapsing them would send operators to the wrong place:
 *   - `needs-human` — a person is needed. `attempted` says whether a login attempt was SPENT
 *     getting here; see the caller contract at the top of the file.
 *   - `needs-egress` — the session is FINE; there is no compatible way out of the network for it.
 *     A human at a card reader cannot fix a missing residential pairing, so it is not `needs-human`.
 *   - anything else terminal (a locked item, an origin refusal, an incoherent request, a failure
 *     from the browser layer) THROWS, typed, so the caller can distinguish.
 */
export type EnsureSessionResult =
  /** A stored session checked out clean. No browser was opened and no password was touched. */
  | { status: 'reused'; itemId: string; storageState: unknown }
  /**
   * The typist logged in and the fresh session was captured back to the Cofre, with a grant.
   * `secrets` is the typist's registry: it HOLDS the value that was typed, so the caller can filter
   * it out of the run's streams (security/redaction.ts). It is returned rather than dropped because
   * dropping it does not make the value stop existing — it only removes the caller's ability to
   * redact it. Nothing here serialises it; `JSON.stringify` of a registry is `{}`.
   */
  | { status: 'reestablished'; itemId: string; storageState: unknown; secrets: SecretRegistry }
  /** Only a person can produce this session. `route` says which ceremony, `attempted` whether a
   *  credential was already submitted trying. */
  | {
      status: 'needs-human';
      route: Exclude<ReestablishRoute, 'typist'>;
      reason: string;
      /** TRUE only when a credential was actually submitted. NEVER retry a true without a human. */
      attempted: boolean;
      itemId?: string;
    }
  /** Healthy session, no compatible egress. The CALLER applies the run's offline policy. */
  | { status: 'needs-egress'; itemId: string; required: { kind: 'residential'; pairingId: string } };

export interface EnsureSessionDeps {
  checkout: typeof checkoutSession;
  findSessionItems: (actor: Actor, origin: string) => Promise<CofreItemDoc[]>;
  unwrap: (itemId: string, actor: Actor, usage: UsageContext, opts?: UnwrapOptions) => Promise<UnwrappedCredential>;
  openBrowser: BrowserOpener;
  typist: (input: TypistLoginInput, deps: TypistDeps) => Promise<TypistResult>;
  typistDeps: TypistDeps;
  /** Capture AND arm: a session minted with no grant is one this module can never reuse. */
  capture: typeof captureSessionWithGrant;
  recipes: (host: string) => TypistRecipe | undefined;
  /** The REVIEWED login URL for a host, when the asset declares one. */
  recipeLoginUrl: (host: string) => string | undefined;
  /** Does the credential carry a grant that outlives one run? The re-auth policy's other input. */
  hasStandingGrant: (actor: Actor, itemId: string, now: number) => Promise<boolean>;
  clock: () => number;
}

/** The production wiring. A caller passes run params only; a test replaces any single seam. */
const REAL_DEPS: EnsureSessionDeps = {
  checkout: checkoutSession,
  findSessionItems: findSessionItemsForOrigin,
  unwrap,
  openBrowser: defaultOpenBrowser,
  typist: typistLogin,
  typistDeps: defaultTypistDeps,
  capture: captureSessionWithGrant,
  recipes: recipeForHost,
  recipeLoginUrl: loginUrlForHost,
  hasStandingGrant: (actor, itemId, now) => hasStandingGrant(actor, itemId, now),
  clock: () => Date.now(),
};

// ---------------------------------------------------------------------------
// The re-auth policy (P3.3)
// ---------------------------------------------------------------------------

/** What may re-establish a session that checkout refused. */
export type ReauthRoute = 'typist' | 'ceremony';

/**
 * THE RE-AUTH TABLE, as a function, because it is two booleans and everyone must read them the
 * same way.
 *
 *   attended | standing grant | route
 *   ---------+----------------+---------
 *   false    | yes            | typist    <- the silent re-login this exists to allow
 *   false    | no             | ceremony  <- nobody authorised an unattended replay
 *   true     | yes            | ceremony  <- ATTENDED WINS, whatever the grant says
 *   true     | no             | ceremony
 *
 * THE THIRD ROW IS THE WHOLE POINT. A live `until_locked` grant is the user saying "you may use
 * this credential without asking me again" — it is NOT the user saying "you may solve my OTP", and
 * on an OTP-gated portal the typist cannot: it would fill the password, submit, meet a code prompt
 * it has no answer for, and leave a spent login attempt against a portal with an unknown lock-out
 * policy. So the attended flag is checked FIRST and nothing downstream can re-open it.
 *
 * `this_run` grants are not "standing" — see `hasStandingGrant` (`cofre/service.ts`).
 */
export function decideReauthRoute(input: {
  requiresAttendedAuth: boolean;
  grantAllowsUnattendedRelogin: boolean;
}): ReauthRoute {
  if (input.requiresAttendedAuth) return 'ceremony';
  return input.grantAllowsUnattendedRelogin ? 'typist' : 'ceremony';
}

/** The `cofre:<itemId>` reference's item id, or null when the string is not a reference. */
function itemIdOfRef(ref: string): string | null {
  const m = /^cofre:(.+)$/.exec(ref.trim());
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// ensureSession
// ---------------------------------------------------------------------------

/** The bare host of an origin written either as a host or as a full URL. */
function hostOf(origin: string): string {
  const trimmed = origin.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      /* not a URL after all — fall through */
    }
  }
  return (trimmed.split('/')[0] ?? '').split(':')[0] ?? '';
}

/** `host` is `allowed` or a subdomain of it — the same rule origin binding uses. */
function sameSite(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * A URL-ish string reduced to protocol + hostname, for an error message.
 *
 * NEVER the userinfo, the path or the query: `https://user:hunter2@host/x?token=…` is a perfectly
 * ordinary URL and every part of it except the scheme and the host can be a credential. An error
 * message is a log line, and a log line is forever.
 */
function safeUrlEcho(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    // It did not parse, so there is no hostname to name — echo the scheme shape and nothing else.
    const scheme = /^([a-z][a-z0-9+.-]{0,31}):/i.exec(raw.trim())?.[1];
    return scheme ? `${scheme.toLowerCase()}://…` : '(unparseable)';
  }
}

/**
 * Ensure there is a usable session for `origin`, re-establishing it AT MOST ONCE if there is not.
 *
 * Errors are thrown rather than folded into the result union whenever the caller must distinguish
 * them: `CofreLockedError` (route the user to unlock — never an excuse to log in again),
 * `CredentialOriginError` (a binding the user can fix), `SessionEstablishmentError` (an incoherent
 * or unsafe request), `SessionEstablishmentFailure` (the browser layer failed, message replaced).
 * Only the two states a RUN can legitimately continue past — "a person is needed" and "no way out
 * of the network" — are values.
 */
export async function ensureSession(
  input: EnsureSessionInput,
  deps: Partial<EnsureSessionDeps> = {},
): Promise<EnsureSessionResult> {
  // FAIL CLOSED ON A HALF-INJECTED BROWSER. `deps` merges shallowly, so a caller that supplies its
  // own `openBrowser` and forgets `typistDeps` gets the DEFAULT suppressor — which is the identity
  // function, honest only for the page `defaultOpenBrowser` creates. That combination silently
  // disables capture suppression on a page the engine may well be screenshotting, which is exactly
  // the disclosure the typist's credential window exists to prevent. Refuse it.
  if (deps.openBrowser && !deps.typistDeps?.withCaptureSuppressed) {
    throw new SessionEstablishmentError(
      'openBrowser was injected without a matching typistDeps.withCaptureSuppressed — the default ' +
        'suppressor is a pass-through and is only honest for the browser this module opens itself',
    );
  }

  const d: EnsureSessionDeps = { ...REAL_DEPS, ...deps };
  const { actor, integrationKey, runId } = input;
  const host = hostOf(input.origin);
  if (!host) throw new SessionEstablishmentError('an origin is required');

  const now = d.clock();

  // ---- 1. The stored session, and what checkout says about it ---------------
  // FIRST REFUSAL WINS when several candidates exist. `findSessionItems` returns newest-first, so
  // the first candidate to pass checkout is used and the rest are not even judged; if none passes,
  // the FIRST refusal — the newest item's — is the one reported. That is deliberate: the newest
  // capture is the most informative row (it is the one whose provenance and egress reflect how this
  // portal was last reached), and the caller acts on ONE route, so scoring every candidate and
  // picking a "best" refusal would only invent a decision nobody asked for. It also means the
  // reported `itemId` is always the item the reported route belongs to.
  const candidates = await d.findSessionItems(actor, host);
  let evaluated: { item: CofreItemDoc; verdict: CheckoutDecision } | undefined;
  for (const item of candidates) {
    const verdict = d.checkout({
      item,
      residentialAvailable: input.residentialAvailable ?? [],
      datacenterAvailable: input.datacenterAvailable ?? true,
      now,
    });
    if (verdict.ok) {
      evaluated = { item, verdict };
      break;
    }
    evaluated ??= { item, verdict };
  }

  // ---- 2/3/4. Reuse, healthy-but-unreachable, then the re-establishment route
  // The item and the verdict travel as ONE value so that every branch that reports an item id has
  // the item the verdict actually judged. (This used to be `chosen?._id ?? ''`, which typed an
  // empty string as a real id on a path where the item is always present.)
  let route: ReestablishRoute;
  if (!evaluated) {
    // No stored session at all is FIRST ESTABLISHMENT, not unknown provenance: the caller named a
    // portal and a password reference, which is the statement that this portal is typist-loginable.
    // Without a reference there is nothing to replay, so it falls to a person.
    route = input.credentialRef ? 'typist' : 'attended';
  } else if (evaluated.verdict.ok) {
    // Healthy: reuse. No browser, no password.
    // A COFRE_LOCKED refusal here propagates UNCHANGED. The user locked their own credential and
    // lock-now/lock-all is the kill switch for exactly this state; answering a revocation with an
    // automated re-login would mean the kill switch does not exist.
    const { item } = evaluated;
    const stored = await d.unwrap(item._id, actor, { kind: 'browser', origin: host }, { runId });
    return { status: 'reused', itemId: item._id, storageState: parseStorageState(stored.value, item._id) };
  } else if (evaluated.verdict.reason === 'egress-unavailable') {
    // Healthy but unreachable: the caller's offline policy decides, not this module.
    return { status: 'needs-egress', itemId: evaluated.item._id, required: evaluated.verdict.required };
  } else {
    route = evaluated.verdict.route;
  }

  const chosen = evaluated?.item;

  if (route !== 'typist') {
    return {
      status: 'needs-human',
      route,
      reason: `${host} needs a ${route} ceremony to re-establish its session`,
      attempted: false, // checkout refused before anything was tried
      ...(chosen ? { itemId: chosen._id } : {}),
    };
  }
  if (!input.credentialRef) {
    return {
      status: 'needs-human',
      route: 'attended',
      reason: `${host} has no credential reference to replay unattended`,
      attempted: false, // there was nothing to submit
      ...(chosen ? { itemId: chosen._id } : {}),
    };
  }
  if (input.allowReestablish === false) {
    // The run already spent its one re-establishment. Refusing is the whole point.
    return {
      status: 'needs-human',
      route: 'relay',
      reason: `${host} already re-established once in this run — refusing a second automated login`,
      attempted: false, // THIS call submitted nothing; an earlier one in the run may have
      ...(chosen ? { itemId: chosen._id } : {}),
    };
  }

  // ---- 4b. THE RE-AUTH POLICY (P3.3) ---------------------------------------
  // Everything above decided that a typist login is what this PORTAL's state calls for. This is the
  // separate question of whether an unattended login is permitted at all, and it is asked here —
  // after the route, before the browser — so that a refusal costs nothing and, crucially, so that
  // no password is unwrapped on a path that was never going to be allowed to submit one.
  const credentialItemId = itemIdOfRef(input.credentialRef);
  const standingGrant = credentialItemId
    ? await d.hasStandingGrant(actor, credentialItemId, now)
    : false;
  if (
    decideReauthRoute({
      requiresAttendedAuth: input.requiresAttendedAuth === true,
      grantAllowsUnattendedRelogin: standingGrant,
    }) === 'ceremony'
  ) {
    return {
      status: 'needs-human',
      route: 'attended',
      reason: input.requiresAttendedAuth === true
        ? `${host} requires an attended login (OTP / MFA / CAPTCHA) — the typist never runs against it`
        : `${host} has no standing grant on its credential — an unattended re-login is not authorised`,
      attempted: false, // nothing was unwrapped and nothing was typed
      ...(chosen ? { itemId: chosen._id } : {}),
    };
  }

  // ---- 5. THE ONE ATTEMPT --------------------------------------------------
  return establishWithTypist(input, d, { host, credentialRef: input.credentialRef, integrationKey });
}

/**
 * A stored session value is a JSON-encoded storageState. A row that does not parse is CORRUPT, not
 * "empty": handing back `{}` would produce a browser context with no cookies that then fails at the
 * portal as if the session had expired, which is a diagnosis nobody can follow back to here.
 */
function parseStorageState(value: string, itemId: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // The message carries the ITEM ID only. The value is the credential.
    throw new SessionEstablishmentError(`stored session ${itemId} is not a readable storageState`);
  }
}

/**
 * Decide where the password will actually be typed.
 *
 * THE RECIPE WINS. The selectors — which field on the page receives the value — have always been
 * fixed, reviewed data in `api/assets/login-recipes/recipes.json`. The URL — which HOST receives it
 * — is strictly more dangerous and was the one parameter left free-form at the caller, so it now
 * lives beside the selectors. For a host whose asset declares a login URL:
 *   - a caller that passes none gets the reviewed one;
 *   - a caller that passes one on the SAME origin gets the reviewed one anyway (same destination,
 *     and the reviewed path is the verified one);
 *   - a caller that passes one on a DIFFERENT origin is REFUSED. `sameSite` accepts any subdomain,
 *     so "still on the portal" is not a strong enough statement about where a password goes; a
 *     caller and a reviewed asset disagreeing about the destination is a confused deputy, and the
 *     safe response to a disagreement about where a credential goes is to send it nowhere.
 */
function resolveLoginUrl(input: EnsureSessionInput, d: EnsureSessionDeps, host: string): URL {
  const declared = d.recipeLoginUrl(host);
  const reviewed = declared ? new URL(declared) : undefined;

  if (input.loginUrl === undefined) {
    if (!reviewed) {
      throw new SessionEstablishmentError(
        `no login URL for ${host}: pass one, or declare it in the login-recipe asset`,
      );
    }
    return reviewed;
  }

  // The caller's URL is checked on its own terms first, so its refusals stay the specific ones.
  let supplied: URL;
  try {
    supplied = new URL(input.loginUrl);
  } catch {
    throw new SessionEstablishmentError(`login URL is not a URL: ${safeUrlEcho(input.loginUrl)}`);
  }
  if (supplied.protocol !== 'https:') {
    throw new SessionEstablishmentError(`refusing to replay a credential over ${supplied.protocol}//`);
  }
  if (!sameSite(supplied.hostname.toLowerCase(), host)) {
    throw new SessionEstablishmentError(`login URL host ${supplied.hostname} is not on ${host}`);
  }
  if (reviewed && reviewed.origin !== supplied.origin) {
    throw new SessionEstablishmentError(
      `login URL ${safeUrlEcho(supplied.href)} disagrees with the reviewed login URL for ${host} ` +
        `(${safeUrlEcho(reviewed.href)}) — refusing to aim a credential at a caller-chosen host`,
    );
  }
  return reviewed ?? supplied;
}

/**
 * Open a browser, log in once, capture the result. Called from exactly one place, and it neither
 * loops nor retries: a failed automated login is terminal for this call by construction.
 */
async function establishWithTypist(
  input: EnsureSessionInput,
  d: EnsureSessionDeps,
  ctx: { host: string; credentialRef: string; integrationKey: string },
): Promise<EnsureSessionResult> {
  const { actor, runId } = input;
  const { host, credentialRef } = ctx;

  // The destination is settled BEFORE a browser exists. A caller that asks to establish `citius…`
  // but points the typist at another site would be a confused deputy aiming a credential elsewhere;
  // the typist's own origin check would catch it at unwrap time, but refusing here costs nothing
  // and keeps the two checks from being one deep.
  const loginUrl = resolveLoginUrl(input, d, host);

  const traceId = input.traceId ?? runId;
  const recipe = d.recipes(loginUrl.hostname) ?? d.recipes(host);

  const browser = await d.openBrowser({ ownerUserId: actor.userId });
  try {
    await browser.page.goto(loginUrl.toString(), { waitUntil: 'domcontentloaded' });

    // RE-CHECK WHERE WE ACTUALLY LANDED. Everything above was a statement about the URL we asked
    // for; a same-host `https -> http` downgrade or a hop to an unrelated host is one 302 away, and
    // it happens BETWEEN the check and the typing. Without this, the module refuses cleartext in
    // its error text while typing a password into a cleartext page. The typist's own check is at
    // the item's boundOrigins, which says nothing about the SCHEME.
    assertStillOnSecureHost(browser.page.url(), host);

    // The typist owns everything from here to a submitted form: origin check before unwrap,
    // suppressed observation channels, out-of-band CDP fill, fill-and-submit as one unit. This
    // module contributes the recipe lookup and nothing else.
    let login: TypistResult;
    try {
      login = await d.typist(
        {
          page: browser.page,
          actor,
          traceId,
          runId,
          credentialRef,
          ...(input.username ? { username: input.username } : {}),
          ...(recipe ? { recipe } : {}),
        },
        d.typistDeps,
      );
    } catch (err) {
      // A form the FIXED pattern cannot drive is the one failure that has a human answer: the
      // relay. It is never handed to a model to guess at — that is the line the typist exists to
      // hold. `attempted` is TRUE because the typist raises this both when it found no password
      // field AND when a password field is still on the page AFTER a submit; from out here those
      // are indistinguishable, and the second one is the wrong-password signature.
      if (err instanceof TypistUnknownPattern) {
        return {
          status: 'needs-human',
          route: 'relay',
          reason: `the login form on ${host} does not match a known pattern`,
          attempted: true,
        };
      }
      throw sanitizeLoginFailure(err, host);
    }

    // Round-trip the fresh session straight back into the Cofre. The storageState is
    // credential-equivalent — it walks past the password AND the MFA prompt — so it is stored the
    // same way a password is, and its binding is derived from its own cookies INTERSECTED with the
    // host we established against (a jar also holds analytics domains and the portal's parent
    // domain; binding to those would make this session unwrappable under every one of them).
    const storageState = await browser.storageState();
    if (originsFromStorageState(storageState).length === 0) {
      throw new SessionEstablishmentError(
        `the login on ${host} produced no cookies — there is no session to store`,
      );
    }
    const boundOrigins = boundOriginsForEstablishedHost(storageState, host);
    if (boundOrigins.length === 0) {
      throw new SessionEstablishmentError(
        `the login on ${host} left no cookie scoped to it — there is no session for this portal to store`,
      );
    }

    const vantage: EstablishmentVantage = input.vantage ?? {
      establishedBy: { kind: 'cloud' },
      boundEgress: { kind: 'datacenter' },
    };
    // CAPTURE AND GRANT AS ONE STEP. A minted item carries no grant, so a session captured without
    // one is a session `unwrap()` refuses on the very next run — the reuse path would fail closed
    // with COFRE_LOCKED forever and every run would re-log-in. Establishing the session IS the
    // consent ceremony; the grant is `until_locked`, and lock-now/lock-all still ends it.
    const { item } = await d.capture(
      actor,
      {
        label: ctx.integrationKey,
        boundOrigins,
        storageState,
        metadata: {
          ...vantage,
          establishedAt: new Date(d.clock()).toISOString(),
          healthy: true,
        },
        ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
      },
      { now: d.clock },
    );

    // Deliberately NOT re-running checkout on the item we just made. A second verdict here would be
    // an invitation to a second login, and one automated attempt per call is the rule.
    return { status: 'reestablished', itemId: item._id, storageState, secrets: login.secrets };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * The post-navigation half of the https guarantee. Refuses without typing anything.
 *
 * Both halves matter and neither replaces the other: the pre-navigation check refuses an unsafe
 * REQUEST before a browser is even opened, this one refuses an unsafe LANDING before a key is
 * pressed. A redirect chain is the portal's to choose, not ours.
 */
function assertStillOnSecureHost(currentUrl: string, host: string): void {
  let landed: URL;
  try {
    landed = new URL(currentUrl);
  } catch {
    throw new SessionEstablishmentError(`the login page for ${host} did not land on a readable URL`);
  }
  if (landed.protocol !== 'https:') {
    throw new SessionEstablishmentError(
      `refusing to type a credential: ${host} redirected the login page to ${landed.protocol}//`,
    );
  }
  if (!sameSite(landed.hostname.toLowerCase(), host)) {
    throw new SessionEstablishmentError(
      `refusing to type a credential: the login page for ${host} landed on ${landed.hostname}`,
    );
  }
}

/**
 * Health-on-use: record that a session was rejected by the portal mid-run (G-4).
 *
 * The caller that noticed the login-page redirect calls this; the NEXT `ensureSession` then sees
 * `unhealthy` and routes. Split from `ensureSession` on purpose — a module that could both observe a
 * redirect and re-authenticate would re-authenticate in a loop, which is precisely the account-lock
 * shape the at-most-once rule exists to prevent.
 *
 * Returns false when the item is not the actor's (uniform not-found, never an existence oracle).
 */
export async function markSessionUnhealthy(
  actor: Actor,
  itemId: string,
  deps: { mark?: (actor: Actor, itemId: string) => Promise<boolean> } = {},
): Promise<boolean> {
  return (deps.mark ?? persistSessionUnhealthy)(actor, itemId);
}
