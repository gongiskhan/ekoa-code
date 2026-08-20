import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationActionEvidence, integrationDefinitions } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore, type DefinitionVisibility } from '../../src/integrations/definition-store.js';
import { actionEvidenceStore } from '../../src/integrations/action-evidence-store.js';
import { listActionEvidenceFor } from '../../src/integrations/action-evidence-view.js';
import type { Actor } from '@ekoa/shared';

/**
 * THE EVIDENCE READ's ISOLATION suite (slice S2) - the Rule 5 suite, of the class of
 * `memvault-isolation.test.ts`, for the READ this slice adds over slice S1's collection.
 *
 * ── WHY A SECOND SUITE, WHEN S1 ALREADY SHIPPED ONE ──────────────────────────────────────────
 *
 * S1's `action-evidence-isolation.test.ts` attacks the STORE, and it proves what the store can
 * prove: no org and no other USER reaches a row, on the point read or the list read, because
 * `orgId` and `ownerUserId` are both terms of the deterministic `_id` and of every filter.
 *
 * This suite attacks the two things the store cannot prove about the READ:
 *
 *   - that the read passes the CALLER'S OWN owner term. The store's signature makes an org-wide
 *     read a compile error, but nothing in the store can tell whether the view handed it the
 *     verified actor's user id or something else, and a view that got that wrong would answer
 *     every caller an empty list (or, worse, a fixed user's rows) with no other suite noticing;
 *   - that a row whose action is NOT on the caller's own resolved definition does not surface,
 *     which is this module's own control and is nothing the store knows about.
 *
 * ── WHY THE DEFINITION FILTER IS STILL LOAD-BEARING UNDER AN OWNER-SCOPED STORE ──────────────
 *
 * Because the two keys move INDEPENDENTLY. A row is addressed by an action NAME, and the package
 * naming that action is a separate document with its own lifecycle, so a caller's own rows outlive
 * the definition that produced them: an action re-authored out of the package leaves its row until
 * it is superseded, discarded or aged out at 90 days, and `resolveDefinition` answers a reader
 * their own `private` row before any `org`/`global`/baseline one - so gaining a private package, or
 * having an org one replaced by a narrower revision, silently narrows what they resolve while the
 * older rows stay exactly where they were. Read the collection straight and the page renders one
 * real request and one real response body beside an action the caller can no longer see, cannot run
 * and cannot name. THE SAME-OWNER FIXTURE BELOW IS THAT CASE, and it is deliberately same-owner:
 * after the owner term is threaded, a cross-user fixture proves nothing about this filter, because
 * the store already refuses it one layer down.
 *
 * ── THE CONTROLS, AND WHAT REMOVING EACH COSTS (measured, 2026-08-22) ────────────────────────
 *
 *   - the OWNER term (`actor.userId` passed to `listForIntegration`)  -> 6 cases red here
 *   - the VISIBLE-ACTION filter (`visible.has(row.actionName)`)       -> 2 cases red here
 *   - the RESOLUTION gate (`if (!resolved.ok) return resolved`)       -> 3 cases red here
 *
 * The filter's two are the SAME-OWNER pair, which is the point of the redesign: the previous
 * revision of this file made its case with a cross-user fixture, and against an owner-keyed store
 * that fixture is refused by the store one layer down - so deleting the filter left the suite green
 * and the Rule 5 claim was vacuous. The two cases it reddens now are rows the caller genuinely owns.
 *
 * The CROSS-ORG case below is deliberately NOT claimed as proof of a control in this module: it is
 * inherited from S1's store (which has its own deliberate-red proof) and from the resolution gate.
 * It is here as the standing regression, and it is stated as such.
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s2_evidence_view_isolation');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  __resetConfigForTests();
});

beforeEach(async () => {
  await integrationActionEvidence.deleteMany({});
  await integrationDefinitions.deleteMany({});
});

const KEY = 's2-view-probe';
/** On every package below - the action a reader legitimately sees. */
const SHARED_ACTION = 'consultar_processo';
/** NOT on the narrowed package: the action whose sample must not survive its own definition. */
const DROPPED_ACTION = 'exportar_clientes';

const actorOf = (userId: string, orgId: string): Actor => ({ userId, orgId, role: 'user' });

async function seedDefinition(
  orgId: string,
  ownerUserId: string,
  visibility: DefinitionVisibility,
  actionNames: string[],
): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId: ownerUserId, visibility, key: KEY,
      displayName: 'S2 View Probe', configSchema: [],
      actions: actionNames.map((actionName) => ({
        actionName,
        description: `faz ${actionName}`,
        mutates: false,
        httpConfig: { method: 'GET' as const, baseUrl: 'https://portal.example', path: `/${actionName}` },
      })),
      skillMd: '# S2 View Probe\n',
    },
    {
      // The store refuses a `global` create from anything but a super-admin, which is the real
      // publish rule - the fixture is written AS a super-admin rather than around the gate.
      actor: { userId: ownerUserId, orgId, role: visibility === 'global' ? 'super-admin' : 'user' },
      onConflict: 'replace',
    },
  );
}

/**
 * A real row through the REAL store, carrying a marker that identifies whose data it is.
 *
 * THE KEY IS THE PRODUCTION KEY, all four terms. `ActionEvidenceKey` requires `ownerUserId` and the
 * production writer (`action-executor` -> `server.ts`'s `recordActionEvidence`) always supplies it,
 * so a fixture that omitted it would plant a row shaped like nothing the system writes - and would
 * only write at all because `assertKey`'s emptiness check lets `undefined` through.
 */
async function seedEvidence(orgId: string, ownerUserId: string, actionName: string, marker: string): Promise<void> {
  await actionEvidenceStore.recordEvidence(
    { orgId, ownerUserId, integrationKey: KEY, actionName },
    {
      backingType: 'api-call',
      shape: `sha-${actionName}`,
      evidence: {
        kind: 'api-call',
        request: { method: 'GET', url: `https://portal.example/${actionName}`, headers: { accept: 'application/json' } },
        response: { status: 200, body: `{"tenant":"${marker}"}`, bodyIsJson: true },
      },
    },
  );
}

/**
 * THE OUTLIVED-DEFINITION FIXTURE, and it is what the visible-action filter is for.
 *
 * ONE owner, TWO rows of their own, and a package that carries only ONE of the two actions -
 * exactly the state an action re-authored out of the package (or a narrower private row resolving
 * ahead of a wider org one) leaves behind. The withheld row is the CALLER'S OWN, so the store's
 * owner term cannot be what refuses it: only this module's filter can.
 */
async function seedOutlivedDefinition(): Promise<void> {
  await seedDefinition('orgA', 'ownerA', 'private', [SHARED_ACTION]);
  await seedEvidence('orgA', 'ownerA', SHARED_ACTION, 'ownerA-shared');
  await seedEvidence('orgA', 'ownerA', DROPPED_ACTION, 'ownerA-dropped');
}

describe('S2 evidence read - a sample never outlives the definition that names its action', () => {
  it('THE CONTROL: with the action back on the package, BOTH of the owner\'s rows come back', async () => {
    // Same two rows, same owner, same key - only the package is the wide one. If this case ever
    // goes red the case below proves nothing, because the rows would be unreachable regardless.
    await seedDefinition('orgA', 'ownerA', 'private', [SHARED_ACTION, DROPPED_ACTION]);
    await seedEvidence('orgA', 'ownerA', SHARED_ACTION, 'ownerA-shared');
    await seedEvidence('orgA', 'ownerA', DROPPED_ACTION, 'ownerA-dropped');

    const out = await listActionEvidenceFor(actorOf('ownerA', 'orgA'), KEY);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.value.map((r) => r.actionName).sort()).toEqual([DROPPED_ACTION, SHARED_ACTION].sort());
  });

  it('withholds the row of an action the caller\'s OWN resolution no longer carries', async () => {
    await seedOutlivedDefinition();

    const out = await listActionEvidenceFor(actorOf('ownerA', 'orgA'), KEY);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.value.map((r) => r.actionName)).toEqual([SHARED_ACTION]);
  });

  it('and not one byte of it - asserted on the CONTENT, not only the name', async () => {
    await seedOutlivedDefinition();

    const out = await listActionEvidenceFor(actorOf('ownerA', 'orgA'), KEY);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    // The name filter and the body leak are separate failures: a projection that dropped the
    // action name while keeping the sample would pass the case above and fail this one.
    const serialised = JSON.stringify(out.value);
    expect(serialised).toContain('ownerA-shared');
    expect(serialised).not.toContain('ownerA-dropped');
    expect(serialised).not.toContain(DROPPED_ACTION);
  });
});

describe('S2 evidence read - the caller\'s own owner term, and nobody else\'s', () => {
  /**
   * ONE org, TWO members, one row EACH for the same action - and two different packages behind the
   * same key, because divergent resolution is the state that used to be argued about here:
   *   - `ownerA` holds orgA's own PRIVATE row for `KEY`, carrying BOTH actions;
   *   - `peerA` is refused that row by the read gate (private, not theirs), falls through to the
   *     cross-org GLOBAL row, and resolves a package carrying the SHARED action only.
   * Both members have run the shared action, so both have a row of their own and the peer's answer
   * is non-vacuous: it is not "the peer sees nothing", it is "the peer sees THEIRS".
   */
  async function seedTwoMembers(): Promise<void> {
    await seedDefinition('orgA', 'ownerA', 'private', [SHARED_ACTION, DROPPED_ACTION]);
    await seedDefinition('orgGlobal', 'publisher', 'global', [SHARED_ACTION]);
    await seedEvidence('orgA', 'ownerA', SHARED_ACTION, 'ownerA-shared');
    await seedEvidence('orgA', 'ownerA', DROPPED_ACTION, 'ownerA-dropped');
    await seedEvidence('orgA', 'peerA', SHARED_ACTION, 'peerA-own');
  }

  it('answers the OWNER their own rows (the control: the rows exist and are reachable)', async () => {
    await seedTwoMembers();

    const out = await listActionEvidenceFor(actorOf('ownerA', 'orgA'), KEY);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.value.map((r) => r.actionName).sort()).toEqual([DROPPED_ACTION, SHARED_ACTION].sort());
    expect(JSON.stringify(out.value)).toContain('ownerA-shared');
  });

  it('answers a same-org PEER their own row and never the colleague\'s, for the same action', async () => {
    await seedTwoMembers();

    const out = await listActionEvidenceFor(actorOf('peerA', 'orgA'), KEY);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.value.map((r) => r.actionName)).toEqual([SHARED_ACTION]);
    // The same action name, two members, two DIFFERENT third-party sessions: the body is the part
    // that matters, so it is what is asserted. `ownerA-dropped` is doubly withheld (owner AND
    // filter) and `ownerA-shared` is withheld by the owner term alone - the row the peer's own
    // resolution does carry.
    const serialised = JSON.stringify(out.value);
    expect(serialised).toContain('peerA-own');
    expect(serialised).not.toContain('ownerA-shared');
    expect(serialised).not.toContain('ownerA-dropped');
  });
});

describe('S2 evidence read - the resolution gate', () => {
  it('refuses an actor whose principal names no org, before any row is read', async () => {
    await seedOutlivedDefinition();

    const out = await listActionEvidenceFor(actorOf('ownerA', ''), KEY);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    // Fail CLOSED and say which: since A2 the org SELECTS which definition resolves, so an
    // org-less actor would match no own row and EVERY global row.
    expect(out.refusal).toBe('no_tenant');
  });

  it('refuses an actor whose principal names no user, for the same reason', async () => {
    await seedOutlivedDefinition();

    const out = await listActionEvidenceFor(actorOf('', 'orgA'), KEY);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.refusal).toBe('no_tenant');
  });

  it('answers not_found for a key that does not resolve for this actor, rather than an empty list', async () => {
    await seedEvidence('orgA', 'ownerA', SHARED_ACTION, 'ownerA-shared');

    // No definition at all for this key: the evidence row EXISTS and belongs to this very caller,
    // and the answer is still not_found - the read follows the definition, never the collection.
    const out = await listActionEvidenceFor(actorOf('ownerA', 'orgA'), KEY);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.refusal).toBe('not_found');
  });
});

describe('S2 evidence read - cross-org (inherited from the S1 store + the resolution gate, kept as regression)', () => {
  it('shows another org nothing, even when both orgs hold a definition for the same key', async () => {
    await seedDefinition('orgA', 'ownerA', 'org', [SHARED_ACTION]);
    await seedDefinition('orgB', 'ownerB', 'org', [SHARED_ACTION]);
    await seedEvidence('orgA', 'ownerA', SHARED_ACTION, 'orgA-shared');

    // The CONTROL: org A does see its own row.
    const mine = await listActionEvidenceFor(actorOf('ownerA', 'orgA'), KEY);
    expect(mine.ok && mine.value).toHaveLength(1);

    const theirs = await listActionEvidenceFor(actorOf('ownerB', 'orgB'), KEY);
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) throw new Error('unreachable');
    expect(theirs.value).toEqual([]);
  });
});
