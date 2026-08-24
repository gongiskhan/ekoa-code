import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { captureSessionWithGrant } from '../../src/cofre/index.js';
import { evaluateCredentialGate } from '../../src/automation/credential-gate.js';
import type { Step } from '../../src/automation/types.js';

/**
 * SECURITY SUITE (Rule 5, memvault class) - THE GENERALIZED SESSION GATE IS PER-USER (S-inject;
 * docs/decisions.md 2026-08-24, D-ADHOC-3 and D-ADHOC-4).
 *
 * WHAT CHANGED, AND WHY IT NEEDS ITS OWN SUITE. Until this slice, a step that declared no
 * `credentialRefs` reached no Cofre read at all - "not gated" was enforced by the gate returning
 * before it touched anything. S-inject opens a SECOND path into stored sessions, driven by an
 * origin the RUN resolved for itself rather than by anything an author declared, and an ad-hoc
 * origin is by definition one nobody curated. That is a new read of credential material keyed by
 * something a run can influence, so the tenancy of that read has to be pinned rather than assumed.
 *
 * IT RUNS AGAINST THE REAL COFRE, deliberately - a real in-memory Mongo, the real
 * `captureSessionWithGrant`, the real `findSessionItemsForOrigin` / `checkoutSession` / `unwrap`
 * behind the real `ensureSession`. A stubbed `ensure` would let this suite pass with the owner
 * scope removed, because the stub is what would be doing the scoping. The property under test is
 * that the OWNER SCOPE IS REAL, and only the real repo path can show that.
 *
 * THE PROPERTIES:
 *   1. Owner A's run receives owner A's session for the origin it resolved.
 *   2. Owner B's run, against the IDENTICAL origin, receives nothing - not a refusal that names the
 *      item, not an error that differs from "there is nothing here". No cross-user oracle.
 *   3. The ad-hoc path can only ever produce `ready` or `not-applicable`. It cannot halt a run, ask
 *      for a person, or reach the typist.
 *   4. No queryable origin index is consulted or created (D-ADHOC-4): the lookup goes through the
 *      owner-scoped listing and nothing else.
 */

const HOST = 'portal.adhoc.example';
const OTHER_HOST = 'other.adhoc.example';

const alice: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
/** SAME ORG as Alice, on purpose. Cross-ORG isolation is a weaker property and is already covered
 *  elsewhere; the dangerous case for a shared workspace is two colleagues whose org matches. */
const bob: Actor = { userId: 'bob', orgId: 'orgA', role: 'user' } as Actor;

const ALICE_COOKIE = 'alice-session-cookie-0001';
const BOB_COOKIE = 'bob-session-cookie-0002';

const storageStateFor = (value: string, host = HOST): unknown => ({
  cookies: [{ name: 'SESSIONID', value, domain: host, path: '/' }],
  origins: [],
});

const METADATA: SessionMetadata = {
  establishedBy: { kind: 'cloud' },
  boundEgress: { kind: 'datacenter' },
  establishedAt: new Date().toISOString(),
  healthy: true,
} as SessionMetadata;

/** An UNDECLARED browser run: a navigate the run resolved for itself, and a step that names no
 *  credential at all. Exactly the shape an ad-hoc adversarial run has. */
function adhocSteps(host = HOST): Step[] {
  return [
    { id: 's1', description: 'go to the portal', type: 'navigate', url: `https://${host}/inbox` } as Step,
    { id: 's2', description: 'read the page', type: 'browser' } as Step,
  ];
}

/** The gate as the run loop calls it for an ad-hoc step: no declaration, no hosted-browser permit,
 *  and `sessionUnresolved` true because no browser is open and no session is in hand yet. */
function adhocGate(actor: Actor, steps: Step[] = adhocSteps(), index = 1) {
  return evaluateCredentialGate(
    { actor, runId: `run_${actor.userId}`, automationName: 'ad-hoc', steps, index, sessionUnresolved: true },
    // Only the DECLARATION seam is stubbed - an ad-hoc origin has no integration action to load.
    // `ensure` is deliberately NOT stubbed: it is the code under test.
    { loadActionDeclaration: async () => null },
  );
}

async function captureFor(actor: Actor, value: string, host = HOST): Promise<string> {
  const { item } = await captureSessionWithGrant(actor, {
    label: host,
    boundOrigins: [host],
    storageState: storageStateFor(value, host),
    metadata: METADATA,
  });
  return item._id;
}

describe('the ad-hoc session gate is owner-scoped', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
    process.env.JWT_SECRET ??= 'test-jwt-secret';
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_sec_adhoc_session');
  }, 60_000);

  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  beforeEach(async () => {
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  it("injects the OWNER'S OWN session for an origin the run resolved, with nothing declared", async () => {
    const itemId = await captureFor(alice, ALICE_COOKIE);

    const verdict = await adhocGate(alice);

    expect(verdict.kind).toBe('ready');
    expect(verdict.kind === 'ready' && verdict.itemId).toBe(itemId);
    expect(verdict.kind === 'ready' && verdict.storageState).toEqual(storageStateFor(ALICE_COOKIE));
  });

  it("NEVER hands owner B a session owner A captured for the same origin", async () => {
    await captureFor(alice, ALICE_COOKIE);

    const verdict = await adhocGate(bob);

    // THE PROPERTY. Not "a different session" and not "a refusal naming Alice's item" - nothing at
    // all, indistinguishable from the case where no session exists anywhere. `unwrap` and
    // `findSessionItems` are both actor-scoped, so Bob's run cannot see the row, let alone open it.
    expect(verdict).toEqual({ kind: 'not-applicable' });
    expect(JSON.stringify(verdict)).not.toContain(ALICE_COOKIE);
  });

  it('gives each owner their OWN session when both hold one for the same origin', async () => {
    const aliceItem = await captureFor(alice, ALICE_COOKIE);
    const bobItem = await captureFor(bob, BOB_COOKIE);

    const forAlice = await adhocGate(alice);
    const forBob = await adhocGate(bob);

    expect(forAlice.kind === 'ready' && forAlice.itemId).toBe(aliceItem);
    expect(forAlice.kind === 'ready' && forAlice.storageState).toEqual(storageStateFor(ALICE_COOKIE));
    expect(forBob.kind === 'ready' && forBob.itemId).toBe(bobItem);
    expect(forBob.kind === 'ready' && forBob.storageState).toEqual(storageStateFor(BOB_COOKIE));
  });

  it('answers identically for an origin NOBODY holds a session for - no existence oracle', async () => {
    await captureFor(alice, ALICE_COOKIE);

    // Bob against Alice's origin, and Bob against an origin with no session anywhere, must be
    // indistinguishable. A difference between them is a probe: it would let one tenant enumerate
    // which portals another tenant is logged into, one origin at a time.
    const bobAtAlicesOrigin = await adhocGate(bob);
    const bobAtAnUnknownOrigin = await adhocGate(bob, adhocSteps(OTHER_HOST));

    expect(bobAtAlicesOrigin).toEqual(bobAtAnUnknownOrigin);
    expect(bobAtAlicesOrigin).toEqual({ kind: 'not-applicable' });
  });
});

describe('the ad-hoc session gate returns no halting verdict', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
    process.env.JWT_SECRET ??= 'test-jwt-secret';
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_sec_adhoc_session_halt');
  }, 60_000);

  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  beforeEach(async () => {
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  it('an origin with NO stored session is not-applicable, not a needs-credentials halt', async () => {
    // The declared path would answer `needs-credentials` here and stop the run to ask for a person.
    // A run that declared nothing must not acquire that halt: it proceeds unauthenticated, which is
    // exactly what it did before this path existed. The PAUSE half of the lifecycle is a separate
    // slice with its own gate (D-ADHOC-5) and deliberately does not ride in on this one.
    const verdict = await adhocGate(alice);
    expect(verdict).toEqual({ kind: 'not-applicable' });
  });

  it('a LOCKED session is withheld silently rather than failing the run', async () => {
    const itemId = await captureFor(alice, ALICE_COOKIE);
    const { lockItem } = await import('../../src/cofre/index.js');
    expect(await lockItem(alice, itemId)).toBe(1);

    // The declared path lets `CofreLockedError` propagate, because a step that NAMED the credential
    // is honestly failed by its absence. This step named none, so "withheld" is the whole of the
    // correct answer - and for a lock specifically, withholding IS what the user asked for.
    const verdict = await adhocGate(alice);
    expect(verdict).toEqual({ kind: 'not-applicable' });
  });

  it('never reaches the typist: no credentialRef and no hosted-browser permit are ever passed', async () => {
    await captureFor(alice, ALICE_COOKIE);
    // Typed with its ARGUMENT, so `mock.calls[0][0]` is the input the gate built rather than the
    // empty tuple a zero-arg `vi.fn` would infer - which is the difference between asserting on the
    // real call and asserting on nothing.
    const ensure = vi.fn(async (_input: Record<string, unknown>) => ({
      status: 'reused' as const,
      itemId: 'x',
      storageState: {},
    }));

    await evaluateCredentialGate(
      {
        actor: alice,
        runId: 'run_1',
        automationName: 'ad-hoc',
        steps: adhocSteps(),
        index: 1,
        sessionUnresolved: true,
        // Offered by the caller and expected to be IGNORED. Even when the run loop resolved a
        // hosted browser, an ad-hoc origin must not be handed the typist's permit: the login of an
        // undeclared, adversarial portal happens on the owner's machine or not at all.
        hostedBrowser: {},
      },
      { loadActionDeclaration: async () => null, ensure: ensure as never },
    );

    expect(ensure).toHaveBeenCalledTimes(1);
    const passed = ensure.mock.calls[0]![0];
    expect(passed['credentialRef']).toBeUndefined();
    expect(passed['hostedTypist']).toBeUndefined();
    // The actor it looked up under is the RUN'S OWN actor and no other. This is the assertion the
    // owner scope hangs from at THIS layer; the suite above proves the layer below honours it.
    expect(passed['actor']).toBe(alice);
  });

  it('costs nothing at all when the run already has a session or an open browser', async () => {
    await captureFor(alice, ALICE_COOKIE);
    const ensure = vi.fn();

    // `sessionUnresolved` omitted - the run loop saying a lookup could change nothing. A Cofre read
    // per step for a value nothing would consume is the cost this guard exists to refuse.
    const verdict = await evaluateCredentialGate(
      { actor: alice, runId: 'run_1', automationName: 'ad-hoc', steps: adhocSteps(), index: 1 },
      { loadActionDeclaration: async () => null, ensure: ensure as never },
    );

    expect(verdict).toEqual({ kind: 'not-applicable' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('does not fire on a step that cannot drive a page', async () => {
    await captureFor(alice, ALICE_COOKIE);
    const ensure = vi.fn();

    const steps: Step[] = [
      { id: 's1', description: 'go', type: 'navigate', url: `https://${HOST}/inbox` } as Step,
      { id: 's2', description: 'run something', type: 'local_command' } as Step,
    ];
    const verdict = await evaluateCredentialGate(
      { actor: alice, runId: 'run_1', automationName: 'ad-hoc', steps, index: 1, sessionUnresolved: true },
      { loadActionDeclaration: async () => null, ensure: ensure as never },
    );

    expect(verdict).toEqual({ kind: 'not-applicable' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('does not fire on a PERMISSIVE origin - a portable credential is not spent unasked', async () => {
    await captureFor(alice, ALICE_COOKIE);
    const ensure = vi.fn();

    const steps: Step[] = [
      {
        id: 's1',
        description: 'call the api',
        type: 'integration',
        integrationKey: 'acme',
        integrationAction: 'fetch',
      } as Step,
      { id: 's2', description: 'read the page', type: 'browser' } as Step,
    ];
    const verdict = await evaluateCredentialGate(
      { actor: alice, runId: 'run_1', automationName: 'ad-hoc', steps, index: 1, sessionUnresolved: true },
      {
        loadActionDeclaration: async () => ({ httpConfig: { baseUrl: `https://${HOST}` }, posture: 'permissive' }) as never,
        ensure: ensure as never,
      },
    );

    expect(verdict).toEqual({ kind: 'not-applicable' });
    expect(ensure).not.toHaveBeenCalled();
  });
});
