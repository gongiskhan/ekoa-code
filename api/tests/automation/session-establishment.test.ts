import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import type { CofreItemDoc } from '../../src/cofre/index.js';
import { checkoutSession } from '../../src/cofre/index.js';
import {
  ensureSession,
  markSessionUnhealthy,
  SessionEstablishmentError,
  type EnsureSessionDeps,
  type EnsureSessionInput,
} from '../../src/automation/session-establishment.js';
import { TypistUnknownPattern, type TypistDeps, type TypistLoginInput } from '../../src/automation/typist.js';
import { recipeForHost, __resetRecipeRegistryForTests } from '../../src/automation/login-recipes.js';
import { SecretRegistry } from '../../src/security/redaction.js';

/**
 * CS5 — the session-establishment ROUTING TABLE, its at-most-once rule, and its non-disclosure.
 *
 * Everything the module touches outside itself is injected, so this suite drives the real decision
 * code (`checkoutSession`, `recipeForHost`, `originsFromStorageState`) against fake storage and a
 * fake browser. No Mongo, no chromium: the point under test is WHICH branch runs and WHAT crosses
 * the boundary, and a real browser would only make that harder to observe.
 *
 * The three things this suite is actually protecting:
 *   1. A healthy session opens NO browser and touches NO password. The common case must be free.
 *   2. `attended`/`relay` produce a typed refusal, never a best-effort login. Establishment does not
 *      improvise, and no model is ever shown a login form.
 *   3. ONE automated login per call, ever. Portal lock-out policies are unknown and unforgiving, so
 *      "it failed, try again" is the one thing this module must be incapable of.
 */

const NOW = Date.parse('2026-08-01T10:00:00.000Z');
const HOST = 'citius.tribunaisnet.mj.pt';
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

/** A page the typist could be driven against. Records the navigations it was asked to make. */
function fakePage() {
  const navigations: string[] = [];
  const page = {
    url: () => LOGIN_URL,
    goto: async (url: string) => {
      navigations.push(url);
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
  storageState?: unknown;
} = {}): Harness {
  const { page, navigations } = fakePage();
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
    // filter its streams. ensureSession must not pass it on.
    const secrets = new SecretRegistry();
    secrets.register(SECRET);
    return { secrets, itemId: 'itm_password_1', submittedVia: 'button' as const };
  });

  const capture = vi.fn(async (_a: Actor, input: { label: string; boundOrigins: string[] }) => ({
    ...sessionItem({ id: 'itm_session_fresh' }),
    label: input.label,
    boundOrigins: input.boundOrigins,
  }));

  const unwrap = vi.fn(async (itemId: string) => ({
    itemId,
    type: 'session' as const,
    value: JSON.stringify(STORAGE_STATE),
  }));

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

  it('EXPIRED (typist provenance) -> one login, captured back to the Cofre', async () => {
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

    // Captured back with origins DERIVED from the session's own cookies, not from the URL.
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

  it('EGRESS-UNAVAILABLE -> its own refusal, not needs-human', async () => {
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
    // needs-human would send the operator to the wrong place.
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

  it('a failure that is not an unknown pattern is surfaced UNCHANGED, never retried', async () => {
    const h = harness({
      items: [],
      typistImpl: async () => {
        throw new Error('credential itm_password_1 is locked: no active grant for this use');
      },
    });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(/is locked/);
    expect(h.typist).toHaveBeenCalledTimes(1);
    expect(h.closed()).toBe(1);
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

describe('the request itself is checked before a browser exists', () => {
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

  it('a login that produced no cookies is not stored as a session', async () => {
    const h = harness({ items: [], storageState: { cookies: [], origins: [] } });
    await expect(ensureSession(runInput(), h.deps)).rejects.toThrow(/no cookies/);
    expect(h.capture).not.toHaveBeenCalled();
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

    // The typist's SecretRegistry (which DOES hold the value) is not forwarded: the result is a
    // status, an item id and the storageState handle.
    expect(Object.keys(result).sort()).toEqual(['itemId', 'status', 'storageState']);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(h.capture.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(h.typistInputs)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
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
    const h = harness({ items: [sessionItem()] });
    const badUnwrap = vi.fn(async (itemId: string) => ({ itemId, type: 'session' as const, value: 'not-json' }));
    await expect(
      ensureSession(runInput(), { ...h.deps, unwrap: badUnwrap as unknown as EnsureSessionDeps['unwrap'] }),
    ).rejects.toThrow(/itm_session_1 is not a readable storageState/);
  });
});
