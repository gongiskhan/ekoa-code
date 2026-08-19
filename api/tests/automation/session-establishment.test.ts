import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import type { CofreItemDoc } from '../../src/cofre/index.js';
import { checkoutSession, CofreLockedError, listCofreItems } from '../../src/cofre/index.js';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  ensureSession,
  markSessionUnhealthy,
  SessionEstablishmentError,
  SessionEstablishmentFailure,
  type EnsureSessionDeps,
  type EnsureSessionInput,
} from '../../src/automation/session-establishment.js';
import { TypistUnknownPattern, type TypistDeps, type TypistLoginInput } from '../../src/automation/typist.js';
import {
  recipeForHost,
  loginUrlForHost,
  parseLoginUrls,
  RecipeRegistryError,
  __resetRecipeRegistryForTests,
} from '../../src/automation/login-recipes.js';
import { SecretRegistry } from '../../src/security/redaction.js';

/**
 * CS5 — the session-establishment ROUTING TABLE, its at-most-once rule, and its non-disclosure.
 *
 * Everything the module touches outside itself is injected, so most of this suite drives the real
 * decision code (`checkoutSession`, `recipeForHost`, `originsFromStorageState`) against fake storage
 * and a fake browser. No chromium: the point under test is WHICH branch runs and WHAT crosses the
 * boundary, and a real browser would only make that harder to observe.
 *
 * ONE block is deliberately NOT stubbed — `the establishment round-trip, end to end` runs against a
 * real in-memory Mongo with the REAL `captureSessionWithGrant` / `findSessionItemsForOrigin` /
 * `checkoutSession` / `unwrap`, because the property it proves (run 2 REUSES what run 1 captured)
 * is exactly the property a stubbed `unwrap` cannot see. That round-trip was broken — a captured
 * session was minted with no grant, so the reuse path failed closed with COFRE_LOCKED forever and
 * every run re-logged-in — and a stub is what hid it.
 *
 * The things this suite protects:
 *   1. A healthy session opens NO browser and touches NO password. The common case must be free,
 *      and it must actually be REACHABLE (the round-trip block).
 *   2. `attended`/`relay` produce a typed refusal, never a best-effort login. Establishment does not
 *      improvise, and no model is ever shown a login form.
 *   3. ONE automated login per call, ever — and the refusal says whether an attempt was SPENT, so a
 *      caller cannot burn N logins believing nothing was tried.
 *   4. The password is aimed by REVIEWED data, over https, at the host we landed on — not at the
 *      URL a caller asked for before the redirect chain ran.
 *   5. No credential value leaves, including through an error message from below.
 */

const NOW = Date.parse('2026-08-01T10:00:00.000Z');
const HOST = 'citius.tribunaisnet.mj.pt';
/** The REVIEWED login URL — the one in api/assets/login-recipes/recipes.json, not a caller's. */
const LOGIN_URL = `https://${HOST}/habilus/myhabilus/Login.aspx`;
const actor: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;

/** The PASSWORD. It must never appear in a result, a log, or a message this module composes.
 *  COMPOSED at runtime rather than written as one literal: a credential-shaped high-entropy string
 *  in the source trips the gitleaks secrets gate (correctly — the gate cannot know a literal is a
 *  fixture). Joining the parts keeps the sentinel unique and greppable in output, which is the only
 *  property this suite needs, without planting a token the scanner must be told to ignore. Do NOT
 *  "fix" this by allowlisting it: the gate stays sharp, the test stays honest. */
const SECRET = ['pw', 'CS5', 'NEVER', 'DISCLOSED', '0001'].join('-');
/** What the portal leaves in the jar after a successful login. Credential-EQUIVALENT, and the one
 *  thing the module is allowed to hand back. */
const STORAGE_STATE = {
  cookies: [{ name: 'ASP.NET_SessionId', value: 'sess-abc-123', domain: HOST, path: '/' }],
  origins: [],
};

const CLOUD_DATACENTER: Pick<SessionMetadata, 'establishedBy' | 'boundEgress'> = {
  establishedBy: { kind: 'cloud' },
  boundEgress: { kind: 'datacenter' },
};

function sessionItem(over: {
  id?: string;
  expiresAt?: string;
  metadata?: SessionMetadata | undefined;
  boundOrigins?: string[];
} = {}): CofreItemDoc {
  const meta: SessionMetadata | undefined =
    'metadata' in over
      ? over.metadata
      : { ...CLOUD_DATACENTER, establishedAt: new Date(NOW - 60_000).toISOString(), healthy: true };
  return {
    _id: over.id ?? 'itm_session_1',
    orgId: actor.orgId,
    userId: actor.userId,
    visibility: 'private',
    type: 'session',
    label: 'citius',
    boundOrigins: over.boundOrigins ?? [HOST],
    valueCiphertext: 'ct',
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: over.expiresAt ?? new Date(NOW + 86_400_000).toISOString(),
    ...(meta ? { sessionMetadata: meta as unknown as Record<string, unknown> } : {}),
  } as CofreItemDoc;
}

/**
 * A page the typist could be driven against. Records the navigations it was asked to make, and —
 * this is the point of `landAt` — models the fact that where a `goto` LANDS is the portal's choice,
 * not ours.
 */
function fakePage(landAt?: (requested: string) => string) {
  const navigations: string[] = [];
  let current = LOGIN_URL;
  const page = {
    url: () => current,
    goto: async (url: string) => {
      navigations.push(url);
      current = landAt ? landAt(url) : url;
      return null;
    },
    locator: () => ({ first: () => ({ isVisible: async () => true }) }),
    waitForLoadState: async () => undefined,
    context: () => ({ newCDPSession: async () => ({ send: async () => ({}), detach: async () => undefined }) }),
  };
  return { page: page as never, navigations };
}

const typistDeps: TypistDeps = {
  beginCredentialWindow: async () => async () => undefined,
  isSuppressed: () => true,
  withCaptureSuppressed: async (fn) => fn(),
};

interface Harness {
  deps: Partial<EnsureSessionDeps>;
  openBrowser: ReturnType<typeof vi.fn>;
  typist: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  unwrap: ReturnType<typeof vi.fn>;
  checkout: ReturnType<typeof vi.fn>;
  closed: () => number;
  navigations: string[];
  typistInputs: TypistLoginInput[];
}

function harness(opts: {
  items?: CofreItemDoc[];
  /** Override the real checkout (used only for the `relay` route, which no provenance produces). */
  checkout?: EnsureSessionDeps['checkout'];
  /** What the fake typist does. Defaults to a clean login. */
  typistImpl?: (input: TypistLoginInput) => Promise<unknown>;
  /** What the fake unwrap does. Defaults to handing back the stored storageState. */
  unwrapImpl?: (itemId: string) => Promise<unknown>;
  storageState?: unknown;
  /** Where a `goto` actually lands (redirects are the portal's choice). */
  landAt?: (requested: string) => string;
  /** P3.3: whether the credential carries a grant that outlives one run. Defaults to yes. */
  hasStandingGrant?: EnsureSessionDeps['hasStandingGrant'];
} = {}): Harness {
  const { page, navigations } = fakePage(opts.landAt);
  const typistInputs: TypistLoginInput[] = [];
  let closes = 0;

  const openBrowser = vi.fn(async () => ({
    page,
    storageState: async () => ('storageState' in opts ? opts.storageState : STORAGE_STATE),
    close: async () => {
      closes += 1;
    },
  }));

  const typist = vi.fn(async (input: TypistLoginInput) => {
    typistInputs.push(input);
    if (opts.typistImpl) return opts.typistImpl(input);
    // Mirror the real return: the registry holds the value the typist filled, so a caller can
    // filter its streams.
    const secrets = new SecretRegistry();
    secrets.register(SECRET);
    return { secrets, itemId: 'itm_password_1', submittedVia: 'button' as const };
  });

  // The real seam is captureSessionWithGrant: an item AND the grant that makes it reusable.
  const capture = vi.fn(async (_a: Actor, input: { label: string; boundOrigins: string[] }) => ({
    item: {
      ...sessionItem({ id: 'itm_session_fresh' }),
      label: input.label,
      boundOrigins: input.boundOrigins,
    },
    grant: { _id: 'grt_1', itemId: 'itm_session_fresh', scope: 'until_locked' as const },
  }));

  const unwrap = vi.fn(async (itemId: string) => {
    if (opts.unwrapImpl) return opts.unwrapImpl(itemId);
    return { itemId, type: 'session' as const, value: JSON.stringify(STORAGE_STATE) };
  });

  const checkout = vi.fn(opts.checkout ?? checkoutSession);

  return {
    deps: {
      findSessionItems: async () => opts.items ?? [],
      checkout: checkout as unknown as EnsureSessionDeps['checkout'],
      unwrap: unwrap as unknown as EnsureSessionDeps['unwrap'],
      openBrowser: openBrowser as unknown as EnsureSessionDeps['openBrowser'],
      typist: typist as unknown as EnsureSessionDeps['typist'],
      typistDeps,
      capture: capture as unknown as EnsureSessionDeps['capture'],
      // P3.3: this harness's subject is the ROUTING table, and every case in it presupposes that an
      // unattended re-login is authorised — that is what the pre-policy behaviour was. The policy
      // itself (grant present/absent x attended required) has its own table suite,
      // `session-reauth-policy.test.ts`, where this dep is the variable rather than the constant.
      hasStandingGrant: opts.hasStandingGrant ?? (async () => true),
      clock: () => NOW,
    },
    openBrowser,
    typist,
    capture,
    unwrap,
    checkout,
    closed: () => closes,
    navigations,
    typistInputs,
  };
}

function runInput(over: Partial<EnsureSessionInput> = {}): EnsureSessionInput {
  return {
    actor,
    integrationKey: 'citius',
    origin: HOST,
    credentialRef: 'cofre:itm_password_1',
    loginUrl: LOGIN_URL,
    runId: 'run_1',
    // THE HOSTED-TYPIST PERMIT (P4.1). Stated here because it now DEFAULTS CLOSED: without it every
    // case below that expects a login gets `needs-human` instead, which is the whole point of the
    // field. The `hosted-typist permit` suite at the end of this file drives the absent case.
    hostedTypist: {},
    ...over,
  };
}

let logs: string[] = [];
let spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  __resetRecipeRegistryForTests();
  logs = [];
  const capture = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  spies = [
    vi.spyOn(console, 'log').mockImplementation(capture),
    vi.spyOn(console, 'info').mockImplementation(capture),
    vi.spyOn(console, 'warn').mockImplementation(capture),
    vi.spyOn(console, 'error').mockImplementation(capture),
  ];
});

afterEach(() => {
  for (const s of spies) s.mockRestore();
});

// ---------------------------------------------------------------------------

describe('the Caixa Citius recipe is in the registry', () => {
  it('exposes exactly the three live-verified selectors', () => {
    // Fetched from the real login page on 2026-08-01 — the only live-verified facts in this slice.
    expect(recipeForHost(HOST)).toEqual({
      usernameSelector: '#txtUserName',
      passwordSelector: '#txtUserPass',
      submitSelector: '#ImBtnLogin',
    });
  });

  it('a subdomain inherits it, and an unrelated host does not', () => {
    expect(recipeForHost(`sub.${HOST}`)?.passwordSelector).toBe('#txtUserPass');
    expect(recipeForHost('citius.example')).toBeUndefined();
  });

  it('declares the login URL beside the selectors, and it is on the host it is keyed under', () => {
    // The selectors decide which FIELD receives the password; the URL decides which HOST does,
    // which is the more dangerous of the two and was the only one left to the caller.
    expect(loginUrlForHost(HOST)).toBe(LOGIN_URL);
    expect(new URL(loginUrlForHost(HOST)!).protocol).toBe('https:');
    expect(loginUrlForHost(`sub.${HOST}`)).toBe(LOGIN_URL);
    expect(loginUrlForHost('webmail.oa.pt')).toBeUndefined();
  });

  it('the loader refuses a login URL that points off the host it is keyed under', () => {
    // The load-bearing check. Without it this map would be a reviewed-looking place to write
    // "while establishing citius, go type the password over there" — the exact confused-deputy
    // shape the module exists to prevent, wearing the clothes of fixed data.
    expect(() => parseLoginUrls({ loginUrls: { 'citius.pt': 'https://evil.example/Login' } })).toThrow(
      RecipeRegistryError,
    );
    expect(() => parseLoginUrls({ loginUrls: { 'citius.pt': 'http://citius.pt/Login' } })).toThrow(/must be https/);
    expect(() => parseLoginUrls({ loginUrls: { 'citius.pt': 'https://u:p@citius.pt/Login' } })).toThrow(/userinfo/);
    expect(() => parseLoginUrls({ loginUrls: { 'citius.pt': 'not a url' } })).toThrow(RecipeRegistryError);
    // Subdomains of the key are fine — that is the same-site rule the rest of the module uses.
    expect(parseLoginUrls({ loginUrls: { 'citius.pt': 'https://login.citius.pt/x' } }).get('citius.pt')).toBe(
      'https://login.citius.pt/x',
    );
    // Absent is fine: most hosts declare selectors only.
    expect(parseLoginUrls({ recipes: {} }).size).toBe(0);
  });
});

describe('the routing table', () => {
  it('HEALTHY -> reused, and no browser is ever opened', async () => {
    const h = harness({ items: [sessionItem()] });
    const result = await ensureSession(runInput(), h.deps);

    expect(result).toMatchObject({ status: 'reused', itemId: 'itm_session_1' });
    expect(result.status === 'reused' && result.storageState).toEqual(STORAGE_STATE);
    // The whole point of the fast path: nothing is opened and no password is touched.
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    // The stored session is read through the SAME seam a password is — origin included, so the
    // item's own boundOrigins decide.
    expect(h.unwrap).toHaveBeenCalledWith('itm_session_1', actor, { kind: 'browser', origin: HOST }, { runId: 'run_1' });
  });

  it('EXPIRED (typist provenance) -> one login, captured back to the Cofre WITH a grant', async () => {
    const h = harness({ items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })] });
    const result = await ensureSession(runInput(), h.deps);

    expect(result).toMatchObject({ status: 'reestablished', itemId: 'itm_session_fresh' });
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
    expect(h.typist).toHaveBeenCalledTimes(1);
    expect(h.navigations).toEqual([LOGIN_URL]);
    // The browser is torn down even on the happy path — a live authenticated context must not
    // outlive the establishment.
    expect(h.closed()).toBe(1);

    // The typist got a REFERENCE and the registry recipe; never a value.
    const sent = h.typistInputs[0]!;
    expect(sent.credentialRef).toBe('cofre:itm_password_1');
    expect(sent.recipe).toEqual({
      usernameSelector: '#txtUserName',
      passwordSelector: '#txtUserPass',
      submitSelector: '#ImBtnLogin',
    });

    // Captured through the capture-AND-GRANT seam: a session minted with no grant is one this
    // module could never unwrap again.
    expect(h.capture).toHaveBeenCalledTimes(1);
    const [, captured] = h.capture.mock.calls[0] as [Actor, { label: string; boundOrigins: string[]; storageState: unknown; metadata: SessionMetadata }];
    expect(captured.label).toBe('citius');
    expect(captured.boundOrigins).toEqual([HOST]);
    expect(captured.storageState).toEqual(STORAGE_STATE);
    expect(captured.metadata).toMatchObject({ healthy: true, ...CLOUD_DATACENTER });
  });

  it('UNHEALTHY with card provenance -> attended refusal, no browser', async () => {
    const item = sessionItem({
      metadata: {
        establishedBy: { kind: 'machine', pairingId: 'm1' },
        boundEgress: { kind: 'residential', pairingId: 'm1' },
        establishedAt: new Date(NOW - 60_000).toISOString(),
        healthy: false,
      },
    });
    const h = harness({ items: [item] });
    const result = await ensureSession(runInput({ residentialAvailable: ['m1'] }), h.deps);

    expect(result).toMatchObject({ status: 'needs-human', route: 'attended', itemId: 'itm_session_1' });
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('RELAY route -> relay refusal, no browser', async () => {
    // No provenance yields `relay` today, so the route is stubbed at the checkout seam: the
    // assertion under test is that establishment REFUSES it rather than trying the typist anyway.
    const h = harness({
      items: [sessionItem()],
      checkout: () => ({ ok: false, reason: 'expired', route: 'relay' }),
    });
    const result = await ensureSession(runInput(), h.deps);

    expect(result).toMatchObject({ status: 'needs-human', route: 'relay' });
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('EGRESS-UNAVAILABLE -> its own refusal, naming the item checkout judged', async () => {
    const item = sessionItem({
      metadata: {
        establishedBy: { kind: 'machine', pairingId: 'm1' },
        boundEgress: { kind: 'residential', pairingId: 'm1' },
        establishedAt: new Date(NOW - 60_000).toISOString(),
        healthy: true,
      },
    });
    const h = harness({ items: [item] });
    const result = await ensureSession(runInput({ residentialAvailable: [] }), h.deps);

    // A person at a card reader cannot conjure a residential pairing, so folding this into
    // needs-human would send the operator to the wrong place. The item id is the REAL one — this
    // path used to report `''` as if it were an id.
    expect(result).toEqual({
      status: 'needs-egress',
      itemId: 'itm_session_1',
      required: { kind: 'residential', pairingId: 'm1' },
    });
    expect(h.openBrowser).not.toHaveBeenCalled();
  });

  it('NO stored session + a credential reference -> first establishment', async () => {
    const h = harness({ items: [] });
    const result = await ensureSession(runInput(), h.deps);

    expect(result.status).toBe('reestablished');
    expect(h.typist).toHaveBeenCalledTimes(1);
  });

  it('NO stored session and NO credential reference -> a person is needed', async () => {
    const h = harness({ items: [] });
    const result = await ensureSession(runInput({ credentialRef: undefined }), h.deps);

    expect(result).toMatchObject({ status: 'needs-human', route: 'attended' });
    expect(h.openBrowser).not.toHaveBeenCalled();
  });

  // The newest-first ORDER is the lookup helper's job (cofre/sessions.ts); what is asserted here is
  // that establishment stops at the first candidate checkout accepts rather than scoring them all.
  it('stops at the first candidate that checks out', async () => {
    const stale = { ...sessionItem({ id: 'itm_old' }), createdAt: new Date(NOW - 900_000).toISOString() };
    const fresh = { ...sessionItem({ id: 'itm_new' }), createdAt: new Date(NOW - 10_000).toISOString() };
    const h = harness({ items: [fresh, stale] });
    const result = await ensureSession(runInput(), h.deps);

    expect(result).toMatchObject({ status: 'reused', itemId: 'itm_new' });
    expect(h.checkout).toHaveBeenCalledTimes(1);
  });

  // FIRST-REFUSAL-WINS, the documented companion to the rule above: when nothing checks out, the
  // NEWEST candidate's refusal is the one reported, and the reported id is that candidate's.
  it('when nothing checks out, the FIRST refusal is the one reported', async () => {
    const newer = sessionItem({ id: 'itm_new', expiresAt: new Date(NOW - 1_000).toISOString() });
    const older = {
      ...sessionItem({
        id: 'itm_old',
        metadata: {
          establishedBy: { kind: 'machine', pairingId: 'm1' },
          boundEgress: { kind: 'residential', pairingId: 'm1' },
          establishedAt: new Date(NOW - 900_000).toISOString(),
          healthy: false,
        },
      }),
    };
    const h = harness({ items: [newer, older] });
    // The newer row's route is `typist` (cloud/datacenter provenance), so it re-establishes rather
    // than reporting the older row's `attended`.
    const result = await ensureSession(runInput({ allowReestablish: false }), h.deps);
    expect(result).toMatchObject({ status: 'needs-human', route: 'relay', itemId: 'itm_new' });
  });
});

describe('at most ONE automated login per call', () => {
  it('does not re-check out (or re-log-in) the session it just captured', async () => {
    const expired = sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() });
    const h = harness({ items: [expired] });
    await ensureSession(runInput(), h.deps);

    // One checkout (the stored candidate), one login, one capture. A verdict on the FRESH item
    // would be an invitation to a second login against a portal we just authenticated to.
    expect(h.checkout).toHaveBeenCalledTimes(1);
    expect(h.typist).toHaveBeenCalledTimes(1);
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
  });

  it('a login the typist cannot drive fails to the RELAY — it is not retried', async () => {
    const h = harness({
      items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })],
      typistImpl: async () => {
        throw new TypistUnknownPattern('no password field found — pausing for the relay');
      },
    });
    const result = await ensureSession(runInput(), h.deps);

    expect(result).toMatchObject({ status: 'needs-human', route: 'relay' });
    expect(h.typist).toHaveBeenCalledTimes(1);
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.closed()).toBe(1); // the browser is closed even when the login failed
  });

  it('allowReestablish:false turns the typist route into a refusal (run-level budget)', async () => {
    const h = harness({ items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })] });
    const result = await ensureSession(runInput({ allowReestablish: false }), h.deps);

    expect(result).toMatchObject({ status: 'needs-human', route: 'relay' });
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('a message-safe failure is surfaced UNCHANGED, never retried', async () => {
    // A CofreLockedError raised INSIDE the typist (the item the password lives in is locked) is one
    // the caller must be able to branch on to route the user to the unlock page, and its message is
    // one this codebase composed from an item id. It passes through untouched.
    const h = harness({
      items: [],
      typistImpl: async () => {
        throw new CofreLockedError('credential itm_password_1 is locked: no active grant for this use');
      },
    });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(/is locked/);
    await expect(ensureSession(runInput(), h.deps)).rejects.toBeInstanceOf(CofreLockedError);
    expect(h.typist).toHaveBeenCalledTimes(2); // one per call; never twice within a call
    expect(h.closed()).toBe(2);
  });
});

/**
 * FIX 2 — an authentication attempt that was SPENT must be unmissable in the type. Three code paths
 * used to return the identical `{status:'needs-human', route:'relay'}`, one of which had submitted a
 * password; `allowReestablish` defaults to allow, so a per-step caller reading them as equivalent
 * burns one login per step against a portal whose lock-out policy is unknown.
 */
describe('a refusal says whether a login attempt was SPENT', () => {
  it('checkout asked for a ceremony -> attempted:false (nothing was tried)', async () => {
    const h = harness({
      items: [sessionItem()],
      checkout: () => ({ ok: false, reason: 'expired', route: 'relay' }),
    });
    const result = await ensureSession(runInput(), h.deps);
    expect(result).toMatchObject({ status: 'needs-human', route: 'relay', attempted: false });
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('no credential reference -> attempted:false (there was nothing to submit)', async () => {
    const h = harness({ items: [] });
    const result = await ensureSession(runInput({ credentialRef: undefined }), h.deps);
    expect(result).toMatchObject({ status: 'needs-human', route: 'attended', attempted: false });
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('allowReestablish:false -> attempted:false (this call submitted nothing)', async () => {
    const h = harness({ items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })] });
    const result = await ensureSession(runInput({ allowReestablish: false }), h.deps);
    expect(result).toMatchObject({ status: 'needs-human', route: 'relay', attempted: false });
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('TypistUnknownPattern -> attempted:TRUE (a password may already have been submitted)', async () => {
    // The typist raises this both for "no password field" and for "a password field is STILL there
    // after submit" — the wrong-password signature. From out here they are indistinguishable, and
    // the conservative direction is the one that does not lock an account.
    const h = harness({
      items: [],
      typistImpl: async () => {
        throw new TypistUnknownPattern('a password field is still present after submit');
      },
    });
    const result = await ensureSession(runInput(), h.deps);
    expect(result).toMatchObject({ status: 'needs-human', route: 'relay', attempted: true });
    expect(h.typist).toHaveBeenCalledTimes(1);
  });

  it('a failure from below also reports a spent attempt, on the thrown value', async () => {
    const h = harness({
      items: [],
      typistImpl: async () => {
        throw new Error('Protocol error (Input.dispatchKeyEvent): Target closed');
      },
    });
    const err = await ensureSession(runInput(), h.deps).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionEstablishmentFailure);
    expect((err as SessionEstablishmentFailure).attempted).toBe(true);
  });
});

describe('health-on-use', () => {
  it('marking an item unhealthy is what makes the NEXT call re-establish', async () => {
    const item = sessionItem();
    const h = harness({ items: [item] });

    expect((await ensureSession(runInput(), h.deps)).status).toBe('reused');

    // The caller saw the portal bounce it back to the login page.
    const mark = vi.fn(async () => {
      (item.sessionMetadata as unknown as SessionMetadata).healthy = false;
      return true;
    });
    expect(await markSessionUnhealthy(actor, 'itm_session_1', { mark })).toBe(true);
    expect(mark).toHaveBeenCalledWith(actor, 'itm_session_1');

    expect((await ensureSession(runInput(), h.deps)).status).toBe('reestablished');
    expect(h.typist).toHaveBeenCalledTimes(1); // one login, on the second call only
  });

  it('marking an item that is not the actor\'s reports false, not an error', async () => {
    expect(await markSessionUnhealthy(actor, 'itm_someone_else', { mark: async () => false })).toBe(false);
  });
});

describe('where the password is aimed', () => {
  it('refuses a login URL off the origin it was asked to establish', async () => {
    const h = harness({ items: [] });
    await expect(
      ensureSession(runInput({ loginUrl: 'https://evil.example/Login.aspx' }), h.deps),
    ).rejects.toBeInstanceOf(SessionEstablishmentError);
    expect(h.openBrowser).not.toHaveBeenCalled();
  });

  it('refuses to replay a credential over cleartext http', async () => {
    const h = harness({ items: [] });
    await expect(
      ensureSession(runInput({ loginUrl: `http://${HOST}/Login.aspx` }), h.deps),
    ).rejects.toThrow(/refusing to replay a credential over http/);
    expect(h.openBrowser).not.toHaveBeenCalled();
  });

  // FIX 5 — the recipe owns the URL. `sameSite` accepts ANY subdomain, so "still on the portal" is
  // not a strong enough statement about where a password goes.
  it('REFUSES a caller URL on a different subdomain than the reviewed one', async () => {
    const h = harness({ items: [] });
    await expect(
      ensureSession(runInput({ loginUrl: `https://sub.${HOST}/Login.aspx` }), h.deps),
    ).rejects.toThrow(/disagrees with the reviewed login URL/);
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('PREFERS the reviewed URL when the caller supplies none', async () => {
    const h = harness({ items: [] });
    const result = await ensureSession(runInput({ loginUrl: undefined }), h.deps);
    expect(result.status).toBe('reestablished');
    expect(h.navigations).toEqual([LOGIN_URL]);
  });

  it('refuses when neither the caller nor the asset names a login URL', async () => {
    const h = harness({ items: [] });
    await expect(
      ensureSession(runInput({ origin: 'webmail.oa.pt', loginUrl: undefined }), h.deps),
    ).rejects.toThrow(/no login URL for webmail\.oa\.pt/);
    expect(h.openBrowser).not.toHaveBeenCalled();
  });

  // FIX 3 — everything above is a statement about the URL we ASKED for. A redirect happens between
  // the check and the typing.
  it('refuses AFTER navigation when a same-host redirect downgraded to http', async () => {
    const h = harness({ items: [], landAt: () => `http://${HOST}/Login.aspx` });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(
      /refusing to type a credential: .* redirected the login page to http:/,
    );
    // The browser was opened (we had to navigate to find out) but NOTHING was typed.
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
    expect(h.typist).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.closed()).toBe(1);
  });

  it('refuses AFTER navigation when the login page landed on another host', async () => {
    const h = harness({ items: [], landAt: () => 'https://evil.example/Login.aspx' });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(/landed on evil\.example/);
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('accepts a same-site redirect that stays on https', async () => {
    const h = harness({ items: [], landAt: () => `https://www.${HOST}/habilus/Login.aspx` });
    expect((await ensureSession(runInput(), h.deps)).status).toBe('reestablished');
    expect(h.typist).toHaveBeenCalledTimes(1);
  });

  // LOW 8 — the raw URL echo.
  it('an unparseable login URL is echoed as protocol only — never its userinfo', async () => {
    const h = harness({ items: [] });
    // Composed at runtime: a literal credential-in-a-URL trips the gitleaks gate.
    const withUserinfo = `https://someone:${SECRET}@${HOST}:notaport/Login.aspx`;
    const err = await ensureSession(runInput({ loginUrl: withUserinfo }), h.deps).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(SessionEstablishmentError);
    expect(err!.message).toContain('login URL is not a URL');
    expect(err!.message).not.toContain(SECRET);
    expect(err!.message).not.toContain('someone');
    expect(logs.join('\n')).not.toContain(SECRET);
  });
});

/**
 * FIX 4 — a jar is not a binding. `originsFromStorageState` reports every cookie domain a real
 * login leaves behind: analytics, CDNs, and whatever parent domain the portal scopes its own
 * cookies to. Binding the captured session to all of them makes a Citius session findable — and
 * unwrappable — under `google-analytics.com` and under every sibling host of `mj.pt`.
 */
describe('the captured session is bound to the host it was established against, and nothing else', () => {
  it('drops the third-party domain AND the broad parent domain', async () => {
    const h = harness({
      items: [],
      storageState: {
        cookies: [
          { name: 'ASP.NET_SessionId', value: 'sess-abc-123', domain: HOST, path: '/' },
          { name: '_ga', value: 'GA1.2.x', domain: '.google-analytics.com', path: '/' },
          { name: 'shared', value: 'y', domain: '.mj.pt', path: '/' },
        ],
        origins: [{ origin: 'https://cdn.example.net', localStorage: [] }],
      },
    });
    expect((await ensureSession(runInput(), h.deps)).status).toBe('reestablished');

    const [, captured] = h.capture.mock.calls[0] as [Actor, { boundOrigins: string[] }];
    expect(captured.boundOrigins).toEqual([HOST]);
    expect(captured.boundOrigins).not.toContain('google-analytics.com');
    expect(captured.boundOrigins).not.toContain('mj.pt');
    expect(captured.boundOrigins).not.toContain('cdn.example.net');
  });

  it('a login that produced no cookies is not stored as a session', async () => {
    const h = harness({ items: [], storageState: { cookies: [], origins: [] } });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(/no cookies/);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('a jar with cookies but NONE covering the portal is not stored either', async () => {
    const h = harness({
      items: [],
      storageState: { cookies: [{ name: '_ga', value: 'x', domain: '.google-analytics.com', path: '/' }], origins: [] },
    });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(/left no cookie scoped to it/);
    expect(h.capture).not.toHaveBeenCalled();
  });
});

/**
 * FIX 6 — the two observation-channel knobs are inseparable, and the redaction registry is handed
 * back rather than dropped.
 */
describe('the observation channel and the redaction registry', () => {
  it('returns the typist SecretRegistry so the caller can arm redaction', async () => {
    const h = harness({ items: [] });
    const result = await ensureSession(runInput(), h.deps);

    expect(result.status).toBe('reestablished');
    const secrets = result.status === 'reestablished' ? result.secrets : undefined;
    expect(secrets).toBeInstanceOf(SecretRegistry);
    // It is ARMED: the caller can now filter the value out of the run's streams. Dropping the
    // registry never made the value stop existing — it only removed the ability to redact it.
    expect(secrets!.redact(`log line containing ${SECRET} here`)).not.toContain(SECRET);

    // …and it STILL does not serialise, specifically AFTER a redact() has run. That ordering is
    // the whole test: the registry memoises its ordered view into a plain array of
    // {handle, value, forms}, so before this was closed the first redact() turned the result into
    // one that JSON.stringify'd every live credential in plaintext (SecretRegistry.toJSON).
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(secrets)).toBe('{"secrets":1,"unmaskable":0}');
    // `util.inspect` (what console.log actually uses) does not call toJSON — it has its own hook.
    const { inspect } = await import('node:util');
    expect(inspect(secrets)).not.toContain(SECRET);
    expect(inspect({ result })).not.toContain(SECRET);
  });

  it('REFUSES an injected openBrowser without a matching capture suppressor', async () => {
    // Deps merge shallowly: `openBrowser` alone leaves the DEFAULT `withCaptureSuppressed`, which
    // is the identity function — honest only for the page this module opens itself. Running the
    // typist against someone else's page with a pass-through suppressor is the disclosure the
    // credential window exists to prevent.
    const openBrowser = vi.fn();
    await expect(
      ensureSession(runInput(), { openBrowser: openBrowser as unknown as EnsureSessionDeps['openBrowser'] }),
    ).rejects.toThrow(/without a matching typistDeps\.withCaptureSuppressed/);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('accepts the pair', async () => {
    const h = harness({ items: [] });
    expect((await ensureSession(runInput(), h.deps)).status).toBe('reestablished');
  });
});

describe('NEGATIVE: no credential value ever leaves this module', () => {
  it('the reused result carries the session handle and nothing else secret', async () => {
    const h = harness({ items: [sessionItem()] });
    const result = await ensureSession(runInput(), h.deps);

    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('the re-established result, the capture call and every log stay clean', async () => {
    const h = harness({ items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })] });
    const result = await ensureSession(runInput(), h.deps);

    // A status, an item id, the storageState handle, and the redaction registry — nothing else.
    expect(Object.keys(result).sort()).toEqual(['itemId', 'secrets', 'status', 'storageState']);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(h.capture.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(h.typistInputs)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  /**
   * FIX 7 — the GENUINELY risky channel. An error MESSAGE from the browser/CDP layer is untrusted
   * text produced by a call that was holding a decrypted password: a protocol error routinely
   * echoes the parameters of the request that failed, and `Input.dispatchKeyEvent` carries the
   * characters being typed. This module holds no registry with which to redact it, so it must not
   * repeat it. (The old assertion could not fail: the sentinel only ever lived inside a Map, which
   * `JSON.stringify` renders as `{}`.)
   */
  it('a typist error whose MESSAGE carries the credential does not surface it anywhere', async () => {
    const h = harness({
      items: [],
      typistImpl: async () => {
        throw new Error(`Protocol error (Input.dispatchKeyEvent): invalid parameters text=${SECRET}`);
      },
    });
    const err = await ensureSession(runInput(), h.deps).then(
      () => null,
      (e: unknown) => e as SessionEstablishmentFailure,
    );

    expect(err).toBeInstanceOf(SessionEstablishmentFailure);
    expect(err!.message).not.toContain(SECRET);
    expect(String(err)).not.toContain(SECRET);
    expect(err!.stack ?? '').not.toContain(SECRET);
    // Not smuggled through `cause`, an enumerable property, or the class name.
    expect((err as unknown as { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(SECRET);
    expect(err!.failureName).toBe('Error');
    // …and nothing on the way out wrote it to a console.
    expect(logs.join('\n')).not.toContain(SECRET);
    // The browser is still torn down.
    expect(h.closed()).toBe(1);
  });

  it('the same holds for a sentinel smuggled through the error NAME', async () => {
    const h = harness({
      items: [],
      typistImpl: async () => {
        const e = new Error('boom');
        e.name = SECRET;
        throw e;
      },
    });
    const err = await ensureSession(runInput(), h.deps).then(
      () => null,
      (e: unknown) => e as SessionEstablishmentFailure,
    );
    expect(err!.message).not.toContain(SECRET);
    expect(err!.failureName).toBe('Error'); // the CLASS name, not the settable instance field
  });

  it('every refusal message this module composes is built from host and route only', async () => {
    const cases: Array<Promise<{ status: string }>> = [
      ensureSession(runInput({ credentialRef: undefined }), harness({ items: [] }).deps),
      ensureSession(
        runInput({ allowReestablish: false }),
        harness({ items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })] }).deps,
      ),
      ensureSession(
        runInput(),
        harness({
          items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })],
          typistImpl: async () => {
            throw new TypistUnknownPattern('no password field found');
          },
        }).deps,
      ),
    ];
    for (const p of cases) {
      const result = (await p) as { status: string; reason?: string };
      expect(result.status).toBe('needs-human');
      expect(result.reason).toContain(HOST);
      expect(result.reason).not.toContain(SECRET);
    }
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('an establishment error names the item, never the value', async () => {
    const h = harness({ items: [sessionItem()], unwrapImpl: async (itemId) => ({ itemId, type: 'session', value: 'not-json' }) });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(
      /itm_session_1 is not a readable storageState/,
    );
  });
});

/**
 * THE ROUND-TRIP, with the real Cofre underneath.
 *
 * Everything above stubs `unwrap`, and a stubbed `unwrap` cannot see the defect this block exists
 * for: `mintCofreItem` issues NO grant, so a session this module captured was one `unwrap()` then
 * refused forever with COFRE_LOCKED. The "overwhelmingly common, must-cost-nothing" reuse path was
 * unreachable for every item the module itself created, and every run re-logged-in against a portal
 * with an unknown lock-out policy.
 *
 * So this block injects only the browser and the typist. `findSessionItemsForOrigin`,
 * `checkoutSession`, `captureSessionWithGrant` and `unwrap` are the real ones, over a real
 * in-memory Mongo and the real envelope encryption.
 */
describe('the establishment round-trip, end to end', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
    process.env.JWT_SECRET ??= 'test-jwt-secret';
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_cs5_session_establishment');
  }, 60_000);

  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  beforeEach(async () => {
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
    // The PASSWORD `runInput()` points at, for real (P3.3). It used to exist only as a string in
    // the input while the fake typist papered over its absence — which was fine while nothing read
    // it, and stopped being fine when the re-auth policy started asking whether that credential
    // carries a standing grant. Minting it with an `until_locked` grant is what a real deployment
    // looks like after the user stores a password, so the round-trip now proves the round-trip
    // against the real answer instead of a hole.
    const { mintCofreItem, issueGrant } = await import('../../src/cofre/index.js');
    await mintCofreItem(
      actor,
      { type: 'password', label: 'citius', value: SECRET, boundOrigins: [HOST] },
      { genId: () => 'itm_password_1' },
    );
    await issueGrant(actor, 'itm_password_1', 'until_locked');
  });

  /** Only the browser and the typist are fake. Everything the Cofre owns is real. */
  function realHarness() {
    const { page, navigations } = fakePage();
    let closes = 0;
    const typist = vi.fn(async () => {
      const secrets = new SecretRegistry();
      secrets.register(SECRET);
      return { secrets, itemId: 'itm_password_1', submittedVia: 'button' as const };
    });
    const deps: Partial<EnsureSessionDeps> = {
      openBrowser: (async () => ({
        page,
        storageState: async () => STORAGE_STATE,
        close: async () => {
          closes += 1;
        },
      })) as unknown as EnsureSessionDeps['openBrowser'],
      typist: typist as unknown as EnsureSessionDeps['typist'],
      typistDeps,
      clock: () => NOW,
    };
    return { deps, typist, navigations, closed: () => closes };
  }

  /** Narrows the union AND asserts it in one place — `expect(...).toBe()` does not narrow. */
  function established(result: Awaited<ReturnType<typeof ensureSession>>): string {
    expect(result.status).toBe('reestablished');
    if (result.status !== 'reestablished') throw new Error('not reestablished');
    return result.itemId;
  }

  it('run 1 establishes; run 2 REUSES through the real unwrap and the typist is not called again', async () => {
    const h = realHarness();

    const firstId = established(await ensureSession(runInput(), h.deps));
    expect(h.typist).toHaveBeenCalledTimes(1);

    const second = await ensureSession(runInput({ runId: 'run_2' }), h.deps);
    // THE assertion: a real `unwrap` — four gates, grant included — handed the session back.
    expect(second.status).toBe('reused');
    expect(second.status === 'reused' && second.storageState).toEqual(STORAGE_STATE);
    expect(second.status === 'reused' && second.itemId).toBe(firstId);
    // No second login, no second browser: the common case cost nothing.
    expect(h.typist).toHaveBeenCalledTimes(1);
    expect(h.closed()).toBe(1);
  });

  it('the grant is an until_locked grant, on the item that was just captured', async () => {
    const h = realHarness();
    const itemId = established(await ensureSession(runInput(), h.deps));

    const { cofreGrants } = await import('../../src/cofre/store.js');
    const grants = await cofreGrants.listVisible(actor, { itemId });
    expect(grants).toHaveLength(1);
    expect(grants[0]!.scope).toBe('until_locked');
    expect(grants[0]!.itemId).toBe(itemId);
    expect(grants[0]!.revokedAt).toBeUndefined();

    // …and the user SEES it as an indefinite unlock, not as a timed one they never asked for.
    const view = await listCofreItems(actor);
    expect(view.find((i) => i.id === itemId)?.state).toBe('unlocked_until_locked');
  });

  it('the captured item is bound to the portal host only', async () => {
    const h = realHarness();
    const itemId = established(await ensureSession(runInput(), h.deps));
    const view = await listCofreItems(actor);
    expect(view.find((i) => i.id === itemId)?.boundOrigins).toEqual([HOST]);
  });

  it('LOCKING the session makes reuse a typed COFRE_LOCKED refusal — never a silent re-login', async () => {
    const h = realHarness();
    const itemId = established(await ensureSession(runInput(), h.deps));

    // The user pressed "bloquear". That is the kill switch; a module that answers it by logging in
    // again has no kill switch at all.
    const { lockItem } = await import('../../src/cofre/index.js');
    expect(await lockItem(actor, itemId)).toBe(1);

    await expect(ensureSession(runInput({ runId: 'run_2' }), h.deps)).rejects.toBeInstanceOf(CofreLockedError);
    expect(h.typist).toHaveBeenCalledTimes(1); // no second login was attempted
  });

  it('a session another user established is invisible here (tenancy)', async () => {
    const h = realHarness();
    const aliceItem = established(await ensureSession(runInput(), h.deps));

    // Same org, different owner: Cofre items are OWNER-scoped, so nothing is found and mallory's
    // call is a first establishment of her own, not a reuse of alice's session. She needs her OWN
    // granted password to get there — alice's is invisible to her, which is the property under
    // test seen from the credential side (P3.3 reads the grant through the same owner scope).
    const mallory: Actor = { userId: 'mallory', orgId: 'orgA', role: 'user' } as Actor;
    const { mintCofreItem: mint, issueGrant: grant } = await import('../../src/cofre/index.js');
    await mint(mallory, { type: 'password', label: 'citius', value: SECRET, boundOrigins: [HOST] }, {
      genId: () => 'itm_password_mallory',
    });
    await grant(mallory, 'itm_password_mallory', 'until_locked');

    const malloryItem = established(
      await ensureSession(runInput({ actor: mallory, credentialRef: 'cofre:itm_password_mallory' }), h.deps),
    );
    expect(malloryItem).not.toBe(aliceItem);
    // Her password + her session; alice's two rows are invisible.
    expect(await listCofreItems(mallory)).toHaveLength(2);
  });
});

/**
 * P4.2 — WHERE THE SESSION WAS MADE IS REPORTED, NOT DECIDED.
 *
 * `sessionMetadata.establishedBy.pairingId` has been stamped on machine-established sessions since
 * the attended ceremony landed, and nothing ever read it. It is the only fact this module owes the
 * router: whether it becomes a routing PREFERENCE is a posture question, answered one layer up
 * (`credential-gate.ts`), because a permissive origin's credential is portable and pinning it to a
 * laptop would cost availability for nothing.
 */
describe('the establishing machine travels back with a reused session', () => {
  it('a machine-established session reports its pairing', async () => {
    const h = harness({
      items: [sessionItem({
        metadata: {
          // THE SHAPE `bridge/attended.ts` ACTUALLY WRITES: the only production writer of
          // `establishedBy: machine` stamps `boundEgress: residential` from the SAME pairing id
          // beside it. This fixture used to pair machine+datacenter so checkout would pass with no
          // fleet input at all - a variant nothing in the product can emit, and part of why nobody
          // noticed the run loop never supplied `residentialAvailable`.
          establishedBy: { kind: 'machine', pairingId: 'pair_home' },
          boundEgress: { kind: 'residential', pairingId: 'pair_home' },
          establishedAt: new Date(NOW - 60_000).toISOString(),
          healthy: true,
        },
      })],
    });
    // ...and because it IS that shape, checkout needs the machine to be available. Supplying that
    // is the run loop's job, and `engine.ts` doing it is what makes this path reachable at all.
    const result = await ensureSession(runInput({ residentialAvailable: ['pair_home'] }), h.deps);
    expect(result).toMatchObject({ status: 'reused', establishedByPairingId: 'pair_home' });
  });

  it('a cloud-established session reports none — there is no machine to prefer', async () => {
    const h = harness({ items: [sessionItem()] });
    const result = await ensureSession(runInput(), h.deps);
    expect(result.status).toBe('reused');
    expect(result).not.toHaveProperty('establishedByPairingId');
  });

  it('a row written before session metadata existed reports none rather than throwing', async () => {
    // The same shape `reestablishRouteFor` already guards: `markSessionUnhealthy` can stamp
    // `healthy` onto a row with no `establishedBy` at all.
    const h = harness({ items: [sessionItem({ metadata: undefined })] });
    const result = await ensureSession(runInput(), h.deps);
    expect(result.status).toBe('reused');
    expect(result).not.toHaveProperty('establishedByPairingId');
  });

  it('a fresh capture reports the vantage it was established FROM', async () => {
    const h = harness({ items: [sessionItem({ expiresAt: new Date(NOW - 1_000).toISOString() })] });
    const result = await ensureSession(
      runInput({
        vantage: {
          establishedBy: { kind: 'machine', pairingId: 'pair_office' },
          boundEgress: { kind: 'residential', pairingId: 'pair_office' },
        },
      }),
      h.deps,
    );
    expect(result).toMatchObject({ status: 'reestablished', establishedByPairingId: 'pair_office' });
  });
});

/**
 * The field this reads is `establishedBy`, and it matters which one.
 *
 * `sessionMetadata` is persisted as an opaque record (`cofre/types.ts`) and nothing re-validates it
 * on the way back, so the read is defensive on purpose: a discriminant that does not say `machine`
 * names no machine, whatever else the row happens to carry next to it.
 */
describe('the establishing machine is read off establishedBy and nothing else', () => {
  it('a cloud establishment bound to a machine\'s residential line still reports NO machine', async () => {
    const h = harness({
      items: [sessionItem({
        metadata: {
          establishedBy: { kind: 'cloud' },
          boundEgress: { kind: 'residential', pairingId: 'pair_home' },
          establishedAt: new Date(NOW - 60_000).toISOString(),
          healthy: true,
        },
      })],
    });
    const result = await ensureSession(runInput({ residentialAvailable: ['pair_home'] }), h.deps);
    expect(result.status).toBe('reused');
    // `boundEgress` answers "where may it leave from"; `establishedBy` answers "where was it made".
    // Only the second is a statement about which machine can reproduce this identity.
    expect(result).not.toHaveProperty('establishedByPairingId');
  });

  it('a stored discriminant that is not "machine" is ignored even when a pairingId sits beside it', async () => {
    const item = sessionItem();
    (item as unknown as { sessionMetadata: Record<string, unknown> }).sessionMetadata = {
      establishedBy: { kind: 'cloud', pairingId: 'pair_smuggled' },
      boundEgress: { kind: 'datacenter' },
      establishedAt: new Date(NOW - 60_000).toISOString(),
      healthy: true,
    };
    const h = harness({ items: [item] });
    const result = await ensureSession(runInput(), h.deps);
    expect(result.status).toBe('reused');
    expect(result).not.toHaveProperty('establishedByPairingId');
  });
});

/**
 * THE HOSTED-TYPIST PERMIT (P4.1) - the check whose absence let this module open a datacenter
 * browser against an adversarial portal and submit a password into it.
 *
 * WHAT WAS WRONG. `ensureSession` asked posture exactly one question - `requiresAttendedAuth` - and
 * asked NOTHING about whether a browser might be opened at all. Everything else it needed to reach
 * `establishWithTypist` (a stored session that failed checkout, a `cofre:` reference, a standing
 * grant) is ordinary state a nightly automation has, so an origin nobody had ever classified would
 * get `defaultOpenBrowser` -> `getLocalBrowserContext(ownerUserId)` with no route argument at all:
 * hosted Chromium, datacenter IP, password submitted.
 *
 * WHAT THE PERMIT IS. A statement by the CALLER - which is the only layer that knows the origin's
 * posture and the run's locality - that the hosted browser is an acceptable place for this login,
 * and by which route out. Absent means no, and absent is what a caller that never thought about it
 * supplies.
 */
describe('the hosted-typist permit', () => {
  it('WITHOUT a permit, a typist-routed login opens nothing and asks for a person', async () => {
    const h = harness({ items: [] }); // no stored session ⇒ first establishment ⇒ typist route
    const result = await ensureSession(runInput({ hostedTypist: undefined }), h.deps);

    expect(result.status).toBe('needs-human');
    expect(result.status === 'needs-human' && result.route).toBe('attended');
    // `attempted: false` is load-bearing: it is what tells a caller no credential was SPENT, and
    // the refusal happens before anything is unwrapped, navigated to, or typed.
    expect(result.status === 'needs-human' && result.attempted).toBe(false);
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('...and says so in terms of WHERE, not of what the password is', async () => {
    const h = harness({ items: [] });
    const result = await ensureSession(runInput({ hostedTypist: undefined }), h.deps);
    expect(result.status === 'needs-human' && result.reason).toMatch(/hosted browser/);
    expect(result.status === 'needs-human' && result.reason).toMatch(/your own machines/);
  });

  it('WITH a permit the login runs exactly as before - the permit adds a gate, not a behaviour', async () => {
    const h = harness({ items: [] });
    const result = await ensureSession(runInput(), h.deps);
    expect(result.status).toBe('reestablished');
    expect(h.typist).toHaveBeenCalledTimes(1);
  });

  it('the permit\'s ROUTE reaches the browser opener, so a login leaves by the run\'s own door', async () => {
    const h = harness({ items: [] });
    const egress = { outcome: 'machine' as const, pairingId: 'pair_home', proxyUrl: 'http://100.64.0.7:1080' };
    await ensureSession(runInput({ hostedTypist: { egress } }), h.deps);
    // Before P4.1 the opener took an owner id and nothing else, so every login left from the
    // datacenter whatever the run had resolved - including a run whose STEPS were proxied.
    expect(h.openBrowser).toHaveBeenCalledWith({ ownerUserId: actor.userId, egress });
  });

  it('a permit with no route opens the ordinary (datacenter) context, as it always did', async () => {
    const h = harness({ items: [] });
    await ensureSession(runInput({ hostedTypist: {} }), h.deps);
    expect(h.openBrowser).toHaveBeenCalledWith({ ownerUserId: actor.userId });
  });

  it('a HEALTHY session is unaffected: reuse never wanted a browser in the first place', async () => {
    const h = harness({ items: [sessionItem()] });
    const result = await ensureSession(runInput({ hostedTypist: undefined }), h.deps);
    expect(result.status).toBe('reused');
    expect(h.openBrowser).not.toHaveBeenCalled();
  });
});
