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
 * AT MOST ONCE — the rule that keeps accounts unlocked. One call re-establishes AT MOST ONE time.
 * There is no loop, no retry, and no re-checkout after a successful login: a portal that just
 * refused a password is the last thing that should receive a second automated attempt, and the
 * lock-out policies of the portals this targets (Caixa Citius among them) are unknown and
 * unforgiving. A caller that wants a run-level budget rather than a per-call one passes
 * `allowReestablish: false` on subsequent calls and gets the typed refusal instead of a login.
 *
 * HEALTH-ON-USE. A session can die mid-run: the portal bounces a request back to the login page and
 * everything after that is nonsense. `markSessionUnhealthy(actor, itemId)` is the write for that
 * observation — the caller marks the item, and the NEXT `ensureSession` sees `unhealthy` and routes.
 * It is a separate function on purpose: this module must not be able to notice a redirect and
 * silently re-authenticate in the middle of a run.
 *
 * WHAT NEVER LEAVES HERE. No credential VALUE, in a return, a log, or an error. The only thing
 * handed back is the storageState handle the caller passes to a browser context (itself
 * credential-equivalent, and treated as such by the Cofre) plus a status and an item id. Every
 * message this module composes is built from the host, the route and the item id.
 */
import type { Page } from 'playwright';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import {
  captureSessionToCofre,
  checkoutSession,
  findSessionItemsForOrigin,
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
import { beginCredentialWindowForTrace, traceIsSuppressed } from '../streaming/registry.js';
import { recipeForHost } from './login-recipes.js';
import { getLocalBrowserContext } from './seams.js';
import {
  typistLogin,
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
 * re-established" can silently mean "the old cookies were still there and nothing was proven".
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
 * `withCaptureSuppressed` is the identity here and that is HONEST, not a stub: the page this module
 * opens belongs to this module, and the engine's screenshot loop (the thing `withCaptureSuppressed`
 * silences) never runs against it. A caller that drives the typist against a page the engine IS
 * capturing must pass its own session's suppressor — which is exactly why this is injected.
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
  /** Where the typist starts. Must be https and must be on `origin`. */
  loginUrl: string;
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
}

/**
 * The outcome. FOUR members, because the three failure shapes are genuinely different problems and
 * collapsing them would send operators to the wrong place:
 *   - `needs-human` — the credential ceremony needs a person (card reader, or a code they receive).
 *   - `needs-egress` — the session is FINE; there is no compatible way out of the network for it.
 *     A human at a card reader cannot fix a missing residential pairing, so it is not `needs-human`.
 *   - anything else terminal (a locked item, an origin refusal, a login form the typist cannot
 *     drive with a known pattern beyond `relay`) THROWS, unchanged, so the caller can distinguish.
 */
export type EnsureSessionResult =
  /** A stored session checked out clean. No browser was opened and no password was touched. */
  | { status: 'reused'; itemId: string; storageState: unknown }
  /** The typist logged in and the fresh session was captured back to the Cofre. */
  | { status: 'reestablished'; itemId: string; storageState: unknown }
  /** Only a person can produce this session. `route` says which ceremony. */
  | { status: 'needs-human'; route: Exclude<ReestablishRoute, 'typist'>; reason: string; itemId?: string }
  /** Healthy session, no compatible egress. The CALLER applies the run's offline policy. */
  | { status: 'needs-egress'; itemId: string; required: { kind: 'residential'; pairingId: string } };

export interface EnsureSessionDeps {
  checkout: typeof checkoutSession;
  findSessionItems: (actor: Actor, origin: string) => Promise<CofreItemDoc[]>;
  unwrap: (itemId: string, actor: Actor, usage: UsageContext, opts?: UnwrapOptions) => Promise<UnwrappedCredential>;
  openBrowser: BrowserOpener;
  typist: (input: TypistLoginInput, deps: TypistDeps) => Promise<TypistResult>;
  typistDeps: TypistDeps;
  capture: typeof captureSessionToCofre;
  recipes: (host: string) => TypistRecipe | undefined;
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
  capture: captureSessionToCofre,
  recipes: recipeForHost,
  clock: () => Date.now(),
};

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
 * Ensure there is a usable session for `origin`, re-establishing it AT MOST ONCE if there is not.
 *
 * Errors are thrown rather than folded into the result union whenever the caller must distinguish
 * them: `CofreLockedError` (route the user to unlock), `CredentialOriginError` (a binding the user
 * can fix), `SessionEstablishmentError` (an incoherent request). Only the two states a RUN can
 * legitimately continue past — "a person is needed" and "no way out of the network" — are values.
 */
export async function ensureSession(
  input: EnsureSessionInput,
  deps: Partial<EnsureSessionDeps> = {},
): Promise<EnsureSessionResult> {
  const d: EnsureSessionDeps = { ...REAL_DEPS, ...deps };
  const { actor, integrationKey, runId } = input;
  const host = hostOf(input.origin);
  if (!host) throw new SessionEstablishmentError('an origin is required');

  const now = d.clock();

  // ---- 1. The stored session, and what checkout says about it ---------------
  const candidates = await d.findSessionItems(actor, host);
  let chosen: CofreItemDoc | undefined;
  let decision: CheckoutDecision | undefined;
  for (const item of candidates) {
    const verdict = d.checkout({
      item,
      residentialAvailable: input.residentialAvailable ?? [],
      datacenterAvailable: input.datacenterAvailable ?? true,
      now,
    });
    if (verdict.ok) {
      chosen = item;
      decision = verdict;
      break;
    }
    // Remember the FIRST refusal: newest-first ordering means it is the most informative one, and
    // it is the item whose route the caller will have to act on.
    if (!decision) {
      chosen = item;
      decision = verdict;
    }
  }

  // ---- 2. Healthy: reuse. No browser, no password. -------------------------
  if (decision?.ok && chosen) {
    const stored = await d.unwrap(chosen._id, actor, { kind: 'browser', origin: host }, { runId });
    return { status: 'reused', itemId: chosen._id, storageState: parseStorageState(stored.value, chosen._id) };
  }

  // ---- 3/4. Healthy-but-unreachable, then the re-establishment route -------
  let route: ReestablishRoute;
  if (decision && !decision.ok) {
    if (decision.reason === 'egress-unavailable') {
      // Healthy but unreachable: the caller's offline policy decides, not this module.
      return { status: 'needs-egress', itemId: chosen?._id ?? '', required: decision.required };
    }
    route = decision.route;
  } else {
    // No stored session at all is FIRST ESTABLISHMENT, not unknown provenance: the caller named a
    // login URL and a password reference, which is the statement that this portal is
    // typist-loginable. Without a reference there is nothing to replay, so it falls to a person.
    route = input.credentialRef ? 'typist' : 'attended';
  }

  if (route !== 'typist') {
    return {
      status: 'needs-human',
      route,
      reason: `${host} needs a ${route} ceremony to re-establish its session`,
      ...(chosen ? { itemId: chosen._id } : {}),
    };
  }
  if (!input.credentialRef) {
    return {
      status: 'needs-human',
      route: 'attended',
      reason: `${host} has no credential reference to replay unattended`,
      ...(chosen ? { itemId: chosen._id } : {}),
    };
  }
  if (input.allowReestablish === false) {
    // The run already spent its one re-establishment. Refusing is the whole point.
    return {
      status: 'needs-human',
      route: 'relay',
      reason: `${host} already re-established once in this run — refusing a second automated login`,
      ...(chosen ? { itemId: chosen._id } : {}),
    };
  }

  // ---- 5. THE ONE ATTEMPT --------------------------------------------------
  return establishWithTypist(input, d, { host, credentialRef: input.credentialRef, integrationKey });
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

  // The login URL is checked BEFORE a browser exists. A caller that asks to establish `citius…` but
  // points the typist at another site would be a confused deputy aiming a credential elsewhere; the
  // typist's own origin check would catch it at unwrap time, but refusing here costs nothing and
  // keeps the two checks from being one deep.
  let loginUrl: URL;
  try {
    loginUrl = new URL(input.loginUrl);
  } catch {
    throw new SessionEstablishmentError(`login URL is not a URL: ${input.loginUrl}`);
  }
  if (loginUrl.protocol !== 'https:') {
    throw new SessionEstablishmentError(`refusing to replay a credential over ${loginUrl.protocol}//`);
  }
  if (!sameSite(loginUrl.hostname.toLowerCase(), host)) {
    throw new SessionEstablishmentError(`login URL host ${loginUrl.hostname} is not on ${host}`);
  }

  const traceId = input.traceId ?? runId;
  const recipe = d.recipes(loginUrl.hostname);

  const browser = await d.openBrowser({ ownerUserId: actor.userId });
  try {
    await browser.page.goto(loginUrl.toString(), { waitUntil: 'domcontentloaded' });

    // The typist owns everything from here to a submitted form: origin check before unwrap,
    // suppressed observation channels, out-of-band CDP fill, fill-and-submit as one unit. This
    // module contributes the recipe lookup and nothing else.
    await d.typist(
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

    // Round-trip the fresh session straight back into the Cofre. The storageState is
    // credential-equivalent — it walks past the password AND the MFA prompt — so it is stored the
    // same way a password is, and its bound origins are DERIVED from its own cookies rather than
    // guessed from the URL we happened to navigate to.
    const storageState = await browser.storageState();
    const boundOrigins = originsFromStorageState(storageState);
    if (boundOrigins.length === 0) {
      throw new SessionEstablishmentError(
        `the login on ${host} produced no cookies — there is no session to store`,
      );
    }

    const vantage: EstablishmentVantage = input.vantage ?? {
      establishedBy: { kind: 'cloud' },
      boundEgress: { kind: 'datacenter' },
    };
    const item = await d.capture(actor, {
      label: ctx.integrationKey,
      boundOrigins,
      storageState,
      metadata: {
        ...vantage,
        establishedAt: new Date(d.clock()).toISOString(),
        healthy: true,
      },
      ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
    });

    // Deliberately NOT re-running checkout on the item we just made. A second verdict here would be
    // an invitation to a second login, and one automated attempt per call is the rule.
    return { status: 'reestablished', itemId: item._id, storageState };
  } catch (err) {
    // A form the FIXED pattern cannot drive is the one failure that has a human answer: the relay.
    // It is never handed to a model to guess at — that is the line the typist exists to hold.
    if (err instanceof TypistUnknownPattern) {
      return {
        status: 'needs-human',
        route: 'relay',
        reason: `the login form on ${host} does not match a known pattern`,
      };
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
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
