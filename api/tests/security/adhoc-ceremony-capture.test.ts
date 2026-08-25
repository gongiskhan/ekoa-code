import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor, BridgeFrame } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import * as registry from '../../src/bridge/registry.js';
import {
  requestAttendedCeremony,
  requestCeremonyCapture,
  acceptSessionPush,
  AttendedError,
  __resetCeremoniesForTests,
} from '../../src/bridge/attended.js';
import { unwrap, findSessionItemsForOrigin } from '../../src/cofre/index.js';
import { ADHOC_SESSION_GRANT, DEFAULT_SESSION_TTL_MS } from '../../src/cofre/sessions.js';
import { cofreGrants } from '../../src/cofre/store.js';
import { evaluateCredentialGate } from '../../src/automation/credential-gate.js';
import {
  registerCredentialWaiter,
  setCredentialResumeDriver,
  onCredentialEstablished,
  __resetCredentialWaitersForTests,
} from '../../src/automation/credential-waiters.js';
import {
  setCredentialEstablishedNotifier,
  __resetCredentialNotifierForTests,
} from '../../src/cofre/notify.js';
import type { Step } from '../../src/automation/types.js';

/**
 * SECURITY SUITE (Rule 5, memvault class) - THE AD-HOC CEREMONY CAPTURE (S-cap; docs/decisions.md
 * 2026-08-24, D-ADHOC-1/2/3).
 *
 * WHAT IS NEW HERE, AND WHY IT NEEDS PINNING SEPARATELY FROM `attended-ceremony.test.ts`. That suite
 * pins the DECLARED rail: a card ceremony mints a LOCKED item, because a credential a user hands
 * over stays locked until they unlock it. The ad-hoc rail cannot work that way and must not quietly
 * become the same thing: the run that opened the ceremony is re-dispatched the instant the capture
 * lands, so an item with no grant would wake it straight back into the halt it just came from. So
 * this capture arrives ARMED - and the moment a capture arms itself, three questions become
 * security questions rather than plumbing:
 *
 *   1. HOW LONG. A bounded TTL (D-ADHOC-2), never the declared rail's standing `until_locked`. An
 *      origin someone reached once from a free-text goal must not accumulate permanent access.
 *   2. WHO DECIDES. The REQUESTER, at ceremony-open time. A grant named on the push would be the
 *      machine choosing how long its own capture lives.
 *   3. WHOSE. The ceremony's actor and no other (D-ADHOC-3), which is what stops a capture on one
 *      person's machine from ever reaching another person's run.
 *
 * Everything runs against a real in-memory Mongo, the real Cofre and the real waiter registry. The
 * wire is the only thing faked, and only so no socket is needed.
 */

let mem: MongoMemoryServer;

const alice: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
/** SAME ORG as Alice on purpose: cross-ORG isolation is the weaker property, and the dangerous case
 *  for a shared workspace is two colleagues whose org matches. */
const bob: Actor = { userId: 'bob', orgId: 'orgA', role: 'user' } as Actor;

const PAIRING = 'pair-1';
const ORIGIN = 'orders.adhoc.example';
/** A domain the JAR carries but the CEREMONY never named: an analytics host on an honest login, and
 *  the site a confused daemon would rather bind to on a dishonest one. */
const OTHER = 'tracker.elsewhere.example';
const ALICE_COOKIE = 'alice-adhoc-ceremony-cookie-0001';
const OTHER_COOKIE = 'a-cookie-for-somewhere-else-0003';

const storageState = (value = ALICE_COOKIE, domain = ORIGIN) => ({
  cookies: [{ name: 'SESSIONID', value, domain, path: '/' }],
  origins: [],
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_adhoc_ceremony');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  const { cofreItems } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  __resetCeremoniesForTests();
  __resetCredentialWaitersForTests();
  __resetCredentialNotifierForTests();
  vi.restoreAllMocks();
});

function captureWire(): BridgeFrame[] {
  const sent: BridgeFrame[] = [];
  vi.spyOn(registry, 'sendToPairing').mockImplementation((_p: string, frame: BridgeFrame) => {
    sent.push(frame);
    return true;
  });
  return sent;
}

/** The ad-hoc ceremony exactly as `POST /cofre/sessions/establish` opens one. */
const openAdhoc = (actor: Actor = alice, origin = ORIGIN) =>
  requestAttendedCeremony(actor, {
    pairingId: PAIRING,
    kind: 'login',
    origin,
    reason: `Iniciar sessão em ${origin} para continuar a automação`,
    label: `${origin} session`,
    grant: ADHOC_SESSION_GRANT,
  });

/** The declared ceremony, unchanged - the control this suite measures the ad-hoc one against. */
const openDeclared = () =>
  requestAttendedCeremony(alice, {
    pairingId: PAIRING,
    kind: 'card_login',
    origin: ORIGIN,
    reason: 'Iniciar sessão com o cartão',
    label: 'Declared portal',
  });

/**
 * The ad-hoc gate as the run loop calls it: nothing declared, no browser open, no session in hand.
 *
 * `residentialAvailable` NAMES THE CEREMONY MACHINE, and it is not decoration. A ceremony capture is
 * stamped `boundEgress: { kind: 'residential', pairingId }`, so `checkoutSession` releases it only
 * while that machine is still reachable - a session established on somebody's laptop is not
 * replayable from a datacenter, which is exactly the pattern portals flag. The run loop supplies
 * this from the same fleet listing locality resolves against; omitting it here would make every case
 * below pass for the wrong reason (`needs-egress`, which the ad-hoc path maps to not-applicable).
 */
function adhocGate(actor: Actor, origin = ORIGIN) {
  const steps: Step[] = [
    { id: 's1', description: 'open the portal', type: 'navigate', url: `https://${origin}/orders` } as Step,
    { id: 's2', description: 'read the page', type: 'browser' } as Step,
  ];
  return evaluateCredentialGate(
    {
      actor,
      runId: `run_${actor.userId}`,
      automationName: 'ad-hoc',
      steps,
      index: 1,
      sessionUnresolved: true,
      residentialAvailable: [PAIRING],
    },
    { loadActionDeclaration: async () => null },
  );
}

describe('an ad-hoc ceremony captures a session the halted run can actually use', () => {
  it('sends a `login` ceremony to the machine, declaring the origin Cortex resolved', async () => {
    const sent = captureWire();
    await openAdhoc();

    expect(sent).toHaveLength(1);
    const frame = sent[0] as Extract<BridgeFrame, { type: 'attended.request' }>;
    expect(frame.type).toBe('attended.request');
    expect(frame.kind).toBe('login');
    // Declared by Cortex, never chosen by the daemon: the whole value of the rail is that the
    // session coming back is the session for the portal we asked about.
    expect(frame.origin).toBe(ORIGIN);
  });

  it('arms the capture with a BOUNDED TTL - not until_locked, not this_run', async () => {
    captureWire();
    const requestId = await openAdhoc();
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });

    const grants = await cofreGrants.listVisible(alice);
    expect(grants).toHaveLength(1);
    const grant = grants[0]!;
    expect(grant.itemId).toBe(item._id);
    // D-ADHOC-2, all three halves. `until_locked` would be standing access to a site nobody curated;
    // `this_run` dies with the run that ASKED, and the run that asks is the one that halted - it
    // comes back as a new pass, so the grant would already be gone and the pause loop would reopen.
    expect(grant.scope).toBe('ttl');
    expect(grant.duration).toBe('2_weeks');
    expect(grant.expiresAt).toBeDefined();
  });

  it('expires WITH the session it unlocks, not before or after it', async () => {
    captureWire();
    const requestId = await openAdhoc();
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });
    const grant = (await cofreGrants.listVisible(alice))[0]!;

    // A grant outliving its item is a live permission over nothing; an item outliving its grant is a
    // stored credential nothing can use. Both are silent, and both look fine until a run halts for a
    // reason nobody can explain. Same clock, same span - compared with a tolerance because the two
    // are stamped by separate `Date.now()` reads inside one call.
    const drift = Math.abs(Date.parse(grant.expiresAt!) - Date.parse(item.expiresAt!));
    expect(drift).toBeLessThan(2_000);
    expect(Date.parse(item.expiresAt!) - Date.now()).toBeGreaterThan(DEFAULT_SESSION_TTL_MS - 60_000);
  });

  it('comes back USABLE, which is the whole point of arming it', async () => {
    captureWire();
    const requestId = await openAdhoc();
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });

    // The declared rail's capture is refused here until a human unlocks it (pinned in
    // `attended-ceremony.test.ts`). This one must not be: the run is re-dispatched the moment this
    // lands, and a locked item would wake it into the same halt it just came from.
    const { value } = await unwrap(item._id, alice, { kind: 'browser', origin: `https://${ORIGIN}` });
    expect(JSON.parse(value)).toEqual(storageState());
  });

  it('leaves the DECLARED ceremony locked exactly as it was', async () => {
    captureWire();
    const requestId = await openDeclared();
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });

    // The control. A capture arms itself only when the code that OPENED the ceremony asked for it;
    // a default here would have silently turned every card ceremony into a standing unlock.
    expect(await cofreGrants.listVisible(alice)).toHaveLength(0);
    await expect(unwrap(item._id, alice, { kind: 'browser', origin: `https://${ORIGIN}` })).rejects.toThrow();
  });

  /**
   * THE BINDING COMES FROM THE CEREMONY, NOT FROM THE JAR (review round F1).
   *
   * `boundOrigins` decides what the item is USABLE for, and it used to be every cookie domain in the
   * pushed jar. The only origin check compares the ceremony's origin to `input.origin` - a field the
   * DAEMON declares - so it never constrained the binding at all: a machine could agree with itself
   * about `input.origin` and push a jar for somewhere else, and on this rail the resulting item is
   * armed with a live grant. An honest login produces the softer version of the same thing, because
   * a real jar carries analytics, CDN, SSO and parent-domain cookies beside the portal's own.
   */
  it('binds ONLY to the ceremony origin, never to the other domains the jar carries', async () => {
    captureWire();
    const requestId = await openAdhoc();
    const item = await acceptSessionPush({
      requestId,
      pairingId: PAIRING,
      origin: ORIGIN,
      storageState: {
        cookies: [
          { name: 'SESSIONID', value: ALICE_COOKIE, domain: ORIGIN, path: '/' },
          { name: '_ga', value: OTHER_COOKIE, domain: OTHER, path: '/' },
        ],
        origins: [],
      },
    });

    expect(item.boundOrigins).toEqual([ORIGIN]);
    // The portal the ceremony was about: usable, which is the point of arming it.
    await expect(unwrap(item._id, alice, { kind: 'browser', origin: `https://${ORIGIN}` })).resolves.toBeDefined();
    // The domain that merely rode along in the jar: not usable, and not even FINDABLE - a run
    // targeting it must not discover this item, or the grant would make it live there too.
    await expect(unwrap(item._id, alice, { kind: 'browser', origin: `https://${OTHER}` })).rejects.toThrow();
    expect(await findSessionItemsForOrigin(alice, OTHER)).toEqual([]);
  });

  it('REFUSES a jar that covers no cookie for the ceremony origin, rather than minting one', async () => {
    captureWire();
    const requestId = await openAdhoc();

    // The confused-or-compromised daemon of this module's own threat model: it controls BOTH the
    // `origin` field and the jar, so it declares the ceremony's origin to pass the field comparison
    // and pushes cookies for somewhere else. With the binding derived from the ceremony there is
    // nothing left to bind to, and an empty binding is refused at capture (I6) instead of minting a
    // valid, encrypted, GRANTED item for a site the user never curated.
    await expect(
      acceptSessionPush({
        requestId,
        pairingId: PAIRING,
        origin: ORIGIN,
        storageState: { cookies: [{ name: '_ga', value: OTHER_COOKIE, domain: OTHER, path: '/' }], origins: [] },
      }),
    ).rejects.toThrow(/origins it may be replayed against/i);

    const { cofreItems } = await import('../../src/cofre/store.js');
    expect(await cofreItems.listVisible(alice)).toEqual([]);
    expect(await cofreGrants.listVisible(alice)).toHaveLength(0);
  });

  it('narrows the DECLARED card ceremony too - the grant is the only difference left', async () => {
    captureWire();
    const requestId = await openDeclared();
    const item = await acceptSessionPush({
      requestId,
      pairingId: PAIRING,
      origin: ORIGIN,
      storageState: {
        cookies: [
          { name: 'JSESSIONID', value: ALICE_COOKIE, domain: ORIGIN, path: '/' },
          { name: '_ga', value: OTHER_COOKIE, domain: OTHER, path: '/' },
        ],
        origins: [],
      },
    });

    // The declared rail was less EXPOSED by the wide binding (its item is locked) but bound just as
    // widely. Narrowing it is strictly better, and it leaves exactly one difference between the two
    // errands - whether the capture is armed - which is the difference that was designed.
    expect(item.boundOrigins).toEqual([ORIGIN]);
    expect(await cofreGrants.listVisible(alice)).toHaveLength(0);
  });

  it('still refuses a push for an origin the ceremony did not declare', async () => {
    captureWire();
    const requestId = await openAdhoc();

    // Unchanged by the ad-hoc kind, and the most dangerous of the rail's three refusals: a mismatched
    // push would mint a perfectly valid, correctly-encrypted, ARMED item for the WRONG SITE.
    await expect(
      acceptSessionPush({
        requestId,
        pairingId: PAIRING,
        origin: 'attacker.example',
        storageState: storageState(ALICE_COOKIE, 'attacker.example'),
      }),
    ).rejects.toBeInstanceOf(AttendedError);
    expect(await cofreGrants.listVisible(alice)).toHaveLength(0);
  });
});

describe('the capture belongs to the actor whose ceremony it was (Rule 5, D-ADHOC-3)', () => {
  it("reaches its OWN owner's run and no other, for the identical origin", async () => {
    captureWire();
    const requestId = await openAdhoc(alice);
    await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });

    const forAlice = await adhocGate(alice);
    const forBob = await adhocGate(bob);

    expect(forAlice.kind).toBe('ready');
    expect(forAlice.kind === 'ready' && forAlice.storageState).toEqual(storageState());
    // Not a different session, not a refusal that names Alice's item - nothing at all,
    // indistinguishable from an origin no session exists for anywhere.
    expect(forBob).toEqual({ kind: 'not-applicable' });
    expect(JSON.stringify(forBob)).not.toContain(ALICE_COOKIE);
  });

  it('wakes only the halted runs of the owner whose ceremony it was', async () => {
    const woken: string[] = [];
    setCredentialResumeDriver((runId) => woken.push(runId));
    // The composition root's own binding (`server.ts`), made here so the path under test is the
    // whole path: a Cofre mint announces, the registry matches, the driver re-dispatches. Wiring the
    // registry alone would test the matcher while leaving the announcement free to be deleted.
    setCredentialEstablishedNotifier(onCredentialEstablished);
    registerCredentialWaiter({ runId: 'run_alice', orgId: 'orgA', userId: 'alice', origin: ORIGIN });
    registerCredentialWaiter({ runId: 'run_bob', orgId: 'orgA', userId: 'bob', origin: ORIGIN });

    captureWire();
    const requestId = await openAdhoc(alice);
    await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });

    // THE LOOP CLOSING, and the tenancy of it in one assertion. Alice's run is re-dispatched with no
    // further human action; Bob's run - parked on the same host, in the same org - is not, because
    // waking it would assert a relationship the Cofre does not have and could only halt again.
    expect(woken).toContain('run_alice');
    expect(woken).not.toContain('run_bob');
  });
});

/**
 * "DONE - CAPTURE NOW" (D-CEREMONY-DONE, 2026-08-25): a SECOND TRIGGER for the same capture, and the
 * tenancy question it raises.
 *
 * WHY IT EXISTS. Until now the capture could be triggered only by the human CLOSING the headed
 * ceremony window, and that window is raised by the OS on every top-level navigation - so an OTP
 * login, the flow this rail exists for, is a focus fight the person loses, with nothing on screen
 * saying that closing is what captures. Live, the operator logged in and the ceremony expired
 * holding nothing.
 *
 * WHY IT BELONGS IN THIS SUITE. The new trigger is reachable from an HTTP endpoint, and the ceremony
 * it ends mints a credential-equivalent artefact under SOMEBODY'S actor. The question is therefore
 * not "does the frame go out" (the contract test covers that) but "whose ceremony can a caller
 * finish". The answer must be: their own, on their own machine, or none - and it is structural
 * rather than checked, because the lookup is keyed on the caller's own actor and there is no
 * requestId on the request to name anyone else's with.
 */
describe('the Done signal can only finish the CALLER OWN ceremony (D-CEREMONY-DONE)', () => {
  it('relays a capture naming the ceremony this caller opened on this machine', async () => {
    const sent = captureWire();
    const requestId = await openAdhoc(alice);

    const outcome = await requestCeremonyCapture(alice, { pairingId: PAIRING, origin: ORIGIN });

    expect(outcome).toEqual({ requested: true, origin: ORIGIN });
    expect(sent.filter((f) => f.type === 'ceremony.capture')).toEqual([{ type: 'ceremony.capture', requestId }]);
  });

  /**
   * TWO CEREMONIES, ONE MACHINE - the case no tiebreak can get right (review round 2026-08-25,
   * F3/F5/F6, and the reason there is no tiebreak here any more).
   *
   * Cortex keeps one pending ceremony per REQUEST; the daemon holds one at a TIME. Which one it is
   * holding depends on how the pair came to exist, and BOTH orders are ordinary:
   *
   *   DOUBLE OPEN over a live window - the daemon refused the second and is still holding the FIRST,
   *   so sending the newest is a guaranteed no-op.
   *   RETRY after a dead window - the daemon finished with the first and is holding the SECOND,
   *   while the first sits in the map unswept for the rest of its 10-minute TTL, so sending the
   *   oldest is a guaranteed no-op for up to ten minutes on the "that did not work, try again" path.
   *
   * Either tiebreak breaks one of them. Relaying to every candidate breaks neither: the daemon
   * finishes the one it is holding and no-ops the rest, which is enforced there and pinned by
   * `clients/bridge/test/attended/done-capture.test.ts`.
   */
  it('relays the capture to EVERY ceremony this caller has open for the origin, oldest first', async () => {
    const sent = captureWire();
    const first = await openAdhoc(alice);
    const second = await openAdhoc(alice);
    expect(first).not.toBe(second);

    const outcome = await requestCeremonyCapture(alice, { pairingId: PAIRING, origin: ORIGIN });

    expect(outcome).toEqual({ requested: true, origin: ORIGIN });
    // Both ids travel, so whichever the daemon is really holding is reached. Oldest-first only so
    // the machine's own log reads in the order the person's attempts happened.
    expect(sent.filter((f) => f.type === 'ceremony.capture')).toEqual([
      { type: 'ceremony.capture', requestId: first },
      { type: 'ceremony.capture', requestId: second },
    ]);
  });

  it('fans out only across the CALLER OWN ceremonies, never across owners or origins', async () => {
    // The fan-out widens WHICH of the caller's own ceremonies are signalled and nothing else. Each
    // frame is an instruction to end a ceremony, so a candidate list that reached past the caller
    // would be exactly the confused deputy this rail's owner scoping exists to prevent.
    const sent = captureWire();
    const mine = await openAdhoc(alice, ORIGIN);
    const otherOrigin = await openAdhoc(alice, OTHER);
    const bobs = await openAdhoc(bob, ORIGIN);

    await requestCeremonyCapture(alice, { pairingId: PAIRING, origin: ORIGIN });

    const ids = sent
      .filter((f) => f.type === 'ceremony.capture')
      .map((f) => (f as { requestId: string }).requestId);
    expect(ids).toEqual([mine]);
    expect(ids).not.toContain(otherOrigin);
    expect(ids).not.toContain(bobs);
  });

  it("REFUSES to finish another user's ceremony on that user's machine", async () => {
    // The case that would matter. Bob is in Alice's org and names her machine and her origin; if the
    // ceremony were resolved by anything but the caller's own actor, his Done would end her window
    // and mint HER session - under her actor, which is exactly what would make it invisible to her.
    const sent = captureWire();
    await openAdhoc(alice);

    const outcome = await requestCeremonyCapture(bob, { pairingId: PAIRING, origin: ORIGIN });

    expect(outcome).toEqual({ requested: false, reason: 'no_open_ceremony' });
    expect(sent.filter((f) => f.type === 'ceremony.capture')).toHaveLength(0);
  });

  it('refuses when the caller has no ceremony open for THAT origin', async () => {
    const sent = captureWire();
    await openAdhoc(alice, ORIGIN);

    const outcome = await requestCeremonyCapture(alice, { pairingId: PAIRING, origin: OTHER });

    expect(outcome).toEqual({ requested: false, reason: 'no_open_ceremony' });
    expect(sent.filter((f) => f.type === 'ceremony.capture')).toHaveLength(0);
  });

  it('refuses for a machine that is not the one the ceremony was opened on', async () => {
    // The pairing is resolved server-side from the actor, so this is the state after a re-pair: the
    // ceremony is held against the OLD machine, and finishing it from the new one would ask a daemon
    // that never opened a window to end one.
    const sent = captureWire();
    await openAdhoc(alice);

    const outcome = await requestCeremonyCapture(alice, { pairingId: 'another-machine', origin: ORIGIN });

    expect(outcome).toEqual({ requested: false, reason: 'no_open_ceremony' });
    expect(sent.filter((f) => f.type === 'ceremony.capture')).toHaveLength(0);
  });

  it('reports a dead socket as a refusal rather than a capture nobody was asked to make', async () => {
    captureWire();
    await openAdhoc(alice);
    // The socket dies AFTER the window was opened - the machine went to sleep while the human was
    // logging in - which is the only interesting ordering here.
    vi.spyOn(registry, 'sendToPairing').mockImplementation(() => false);

    expect(await requestCeremonyCapture(alice, { pairingId: PAIRING, origin: ORIGIN })).toEqual({
      requested: false,
      reason: 'unreachable',
    });
  });

  it('leaves the ceremony OPEN, so the window close still captures and Done can be pressed again', async () => {
    // The Done request is not the capture. A daemon that answers it with nothing - an empty jar, a
    // login the human had not actually finished - must leave every other way out intact.
    const sent = captureWire();
    const requestId = await openAdhoc(alice);

    await requestCeremonyCapture(alice, { pairingId: PAIRING, origin: ORIGIN });
    await requestCeremonyCapture(alice, { pairingId: PAIRING, origin: ORIGIN });
    expect(sent.filter((f) => f.type === 'ceremony.capture')).toHaveLength(2);

    // ...and the push, whenever it arrives, is the ordinary one: same requestId, same custody, same
    // narrow binding, minted under the ceremony's own actor.
    const item = await acceptSessionPush({ requestId, pairingId: PAIRING, origin: ORIGIN, storageState: storageState() });
    expect(item.userId).toBe('alice');
    expect(item.boundOrigins).toEqual([ORIGIN]);
  });
});
