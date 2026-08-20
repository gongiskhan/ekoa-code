/**
 * THE REMOVAL PATHS for `integration_action_evidence` (slice S1, verification rounds two and three).
 *
 * ── WHAT THIS EXISTS TO STOP HAPPENING AGAIN ─────────────────────────────────────────────────
 *
 * The collection landed with NO removal path at all (round two): `discardEvidence` had zero
 * production callers and a docblock naming two it did not have. The consequence was not untidiness:
 *
 *   - an evidence row holds one person's REAL request and REAL response body - the reproductions
 *     below use the shape this product actually captures, `Processo 1234/24.5T8LSB - Cliente:
 *     Maria Silva` - and it is durable, has no TTL and no other index;
 *   - an automation-backed row PINS its run out of the 7-day screenshot sweep
 *     (`pinnedRunIdsForRetention` -> `sweepExpiredScreenshots`), and that pin releases ONLY on a
 *     supersede or a discard. Once the action stops resolving neither can ever happen again, so the
 *     screenshots of an authenticated client-portal session are exempt from retention PERMANENTLY.
 *
 * ROUND THREE FOUND THE SAME ERROR ONE LEVEL UP, and that is what most of this file is now about.
 * The collector added in round two was scoped to `input.orgId` - the org that WROTE the definition -
 * while every evidence row is keyed by the org that RAN the action. Those differ exactly when the
 * `global` tier does its job: a super-admin publishes org A's definition, a user in org B resolves
 * it through `getForActor`, connects THEIR OWN credential and runs it, and the row lands under
 * `{orgId: orgB, ownerUserId: uB}`. Org A re-authoring without that action then ran a `deleteMany`
 * filtered on org A, which matched nothing. Same durable row, same permanent pin, same PII - only
 * now for a tenant that cannot even see the definition that ended it.
 *
 * A SECOND trigger came from the transition the round-two header dismissed BY NAME as not-a-removal-
 * path: `setVisibility` `global -> org` takes every action of the integration away from every
 * consumer at once, and `org -> private` does the same to every peer inside the author's own org.
 *
 * ── WHY THESE ENTRY POINTS ───────────────────────────────────────────────────────────────────
 *
 * The cases below enter at the REAL production callers - `saveAuthoredDefinition` (the builder
 * save), `IntegrationDefinitionStore.create(..., onConflict: 'replace')` (what `achieve`'s in-place
 * write calls), `IntegrationDefinitionStore.setVisibility` (the visibility chokepoint) and
 * `deleteConfig` (the DELETE route's service) - and never at the collector. A test that called the
 * collector itself would prove the collector works and prove nothing about whether production ever
 * reaches it, which is precisely the state round one shipped in.
 *
 * The one exception is the last describe, which enters at `discardEvidenceOfUnresolvableActions`
 * with injected deps because it pins the collector's FAILURE POSTURE - a decision that is not
 * reachable through a definition write without breaking Mongo, and that is labelled as its own kind
 * of claim rather than smuggled in beside the reachability ones.
 *
 * EVERYTHING IS COUNTED BY DOCUMENT, against the real collection. "Gone" is the number of rows in
 * `integration_action_evidence`, not the answer of a filtered read - a keyed assertion would have
 * been green throughout both failures this closes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationActionEvidence, integrationDefinitions, integrationConfigs } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { saveAuthoredDefinition } from '../../src/integrations/definition-save.js';
import {
  ActionEvidenceStore,
  discardEvidenceOfUnresolvableActions,
  type ActionEvidence,
  type ActionEvidenceOwnerRef,
  type ActionEvidenceKey,
} from '../../src/integrations/action-evidence-store.js';
import { createConfig, deleteConfig } from '../../src/integrations/service.js';
import type { IntegrationPackageConfig } from '../../src/integrations/definitions.js';

let mem: MongoMemoryServer;
let clock = 0;
const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const evidence = new ActionEvidenceStore(integrationActionEvidence, () => new Date(1_700_000_000_000 + clock++));

const ORG = 'orgA';
const OTHER_ORG = 'orgB';
const OWNER = 'u-owner';
const PEER = 'u-peer';
const CONSUMER = 'u-consumer';
// NOT a shipped baseline key: `saveAuthoredDefinition` refuses every reserved key, and a save that
// was refused would make every case below pass for the wrong reason.
const KEY = 'portal-probe';
const DOOMED = 'consultar_processo';
const SURVIVOR = 'arquivar_processo';
const author: Actor = { userId: OWNER, orgId: ORG, role: 'user' };
const superAdmin: Actor = { userId: 'u-super', orgId: 'org-platform', role: 'super-admin' };
const consumer: Actor = { userId: CONSUMER, orgId: OTHER_ORG, role: 'user' };

/**
 * The bytes this is about. Not a placeholder: the whole reason the row must go with the action is
 * that it holds a named client and a real processo number, captured from a live third-party call.
 */
const CLIENT_PII = 'Processo 1234/24.5T8LSB - Cliente: Maria Silva';

const apiCall = (marker: string): ActionEvidence => ({
  kind: 'api-call',
  request: { method: 'GET', url: 'https://portal.example/processos/1234', headers: { accept: 'application/json' } },
  response: { status: 200, body: `{"resumo":"${marker}"}`, bodyIsJson: true },
});

/**
 * An automation-backed sample: POINTERS into a run, which is what makes the row a retention PIN.
 *
 * `status` IS A `RunStatus` MEMBER. The production writer is `collectRunEvidence`, which copies
 * `RunRecord.status` straight through, and `RunStatus` has no `succeeded` - it has `completed`. The
 * first cut of this fixture said `succeeded`, which nothing here asserts and nothing here typechecks
 * (`AutomationEvidence.status` is `string?`), so it would have been copied into the first case that
 * DID assert a run status and been wrong there instead.
 */
const automation = (runId: string, marker: string = CLIENT_PII): ActionEvidence => ({
  kind: 'automation',
  runId,
  status: 'completed',
  steps: [{ stepIndex: 0, screenshotUrl: `/automation-screenshots/aut-1/${runId}/step-0.png`, excerpt: marker }],
});

function actions(names: string[]) {
  return names.map((actionName) => ({
    actionName,
    description: `acao ${actionName}`,
    mutates: false,
    httpConfig: { method: 'GET', baseUrl: 'https://portal.example', path: `/${actionName}` },
  }));
}

function definitionRow(
  names: string[],
  opts: { orgId?: string; userId?: string; visibility?: 'private' | 'org' | 'global' } = {},
): IntegrationDefinitionCreate {
  return {
    orgId: opts.orgId ?? ORG,
    userId: opts.userId ?? OWNER,
    key: KEY,
    visibility: opts.visibility ?? 'org',
    authType: 'none',
    configSchema: [],
    actions: actions(names) as IntegrationDefinitionCreate['actions'],
    skillMd: `# ${KEY}\n`,
  };
}

/** What the BUILDER posts - the canonical package shape `saveAuthoredDefinition` consumes. */
function packageConfig(names: string[]): IntegrationPackageConfig {
  return {
    integrationKey: KEY,
    displayName: KEY,
    authType: 'none',
    configSchema: [],
    actions: actions(names),
  } as unknown as IntegrationPackageConfig;
}

const record = (key: Partial<ActionEvidenceKey> & { actionName: string }, ev: ActionEvidence, shape = 'shape-1') =>
  evidence.recordEvidence(
    {
      orgId: key.orgId ?? ORG,
      ownerUserId: key.ownerUserId ?? OWNER,
      integrationKey: key.integrationKey ?? KEY,
      actionName: key.actionName,
    },
    { backingType: ev.kind === 'api-call' ? 'api-call' : 'browser-steps', shape, evidence: ev },
  );

const rowsInCollection = () => integrationActionEvidence.find({});
/**
 * WHOSE row, for WHICH integration, for WHICH action - the whole key except the parts that are not
 * identity. Every term is printed, including `integrationKey`, so two rows of different integrations
 * can never collapse to the same label and make a surviving row look like a removed one.
 */
const evidenceIndex = async (): Promise<string[]> =>
  (await rowsInCollection())
    .map((r) => (r as unknown as { orgId: string; ownerUserId: string; integrationKey: string; actionName: string }))
    .map((r) => `${r.orgId}/${r.ownerUserId}/${r.integrationKey}/${r.actionName}`)
    .sort();
/** The same label, for a row this file expects to still be there. */
const at = (orgId: string, ownerUserId: string, actionName: string, integrationKey = KEY) =>
  `${orgId}/${ownerUserId}/${integrationKey}/${actionName}`;

beforeAll(async () => {
  // `createConfig` envelope-encrypts through the real KMS wrapper, which loads the real config.
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s1_evidence_removal');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 0;
  await integrationActionEvidence.deleteMany({});
  await integrationDefinitions.deleteMany({});
  await integrationConfigs.deleteMany({});
});

describe('an ordinary builder save that DROPS an action takes its evidence with it', () => {
  beforeEach(async () => {
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    // Two OWNERS have run the doomed action, because the definition is `org`-visible and each of
    // them ran it under their own credential. Both rows are that person's private data.
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII), 'shape-doomed');
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('Cliente: Joao Peer'), 'shape-doomed');
    // The CONTROLS: an action the save keeps, and another tenant that resolves the same action name
    // through a definition of ITS OWN - which the save under test must not be able to reach.
    await record({ actionName: SURVIVOR }, apiCall('kept'), 'shape-survivor');
    await definitions.create(definitionRow([DOOMED], { orgId: OTHER_ORG, userId: CONSUMER }), { actor: consumer });
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall('other tenant'), 'shape-other-org');
    expect(await rowsInCollection()).toHaveLength(4);
  });

  it('through the REAL builder save: the dropped action leaves no row, for ANY owner', async () => {
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // The action really is gone from the definition - otherwise this proves nothing about removal.
    expect(saved.doc.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);

    // Counted at the collection. BOTH owners' rows for the dropped action are gone; the surviving
    // action's row stands, and so does the other tenant's - because THEIR definition still names it.
    expect(await evidenceIndex()).toEqual([
      at(ORG, OWNER, SURVIVOR),
      at(OTHER_ORG, CONSUMER, DOOMED),
    ]);
  });

  it('and the client PII is not merely unreachable - it is not in the database', async () => {
    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);
    // The failure this closes was a row that stayed readable through `getEvidence` with the exact
    // string below still in it, for an action that no longer existed anywhere.
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('a RENAME is the same removal - the incoming set simply no longer names it', async () => {
    // What an agent re-authoring an integration does routinely. A rename is indistinguishable from a
    // removal followed by an unrelated creation, and must collect the same way.
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR, 'consultar_processo_v2']), `# ${KEY}\n`, definitions);
    expect(saved.ok).toBe(true);

    expect(await evidenceIndex()).toEqual([
      at(ORG, OWNER, SURVIVOR),
      at(OTHER_ORG, CONSUMER, DOOMED),
    ]);
  });

  it('a save that KEEPS every action keeps every row - the collector is not a sweep', async () => {
    // THE CONTROL for all of the above. Without it "the rows are gone" would also be satisfied by a
    // save that simply deleted every row for the key on every write - which, now that the collector
    // reads ACROSS tenants, is the exact mistake most worth catching.
    const saved = await saveAuthoredDefinition(author, packageConfig([DOOMED, SURVIVOR]), `# ${KEY} v2\n`, definitions);
    expect(saved.ok).toBe(true);
    expect(await rowsInCollection()).toHaveLength(4);
  });

  it('another INTEGRATION\'s row for the same action name is not the reconciler\'s business', async () => {
    // The reconciler reads across TENANTS, so the terms that still bound it deserve a control.
    //
    // GUARDED TWICE, AND RECORDED AS SUCH RATHER THAN LEFT TO LOOK LOAD-BEARING: the listing filters
    // on `integrationKey`, AND the discard is issued with the RECONCILED key rather than with a key
    // carried on the ref (`ActionEvidenceOwnerRef` deliberately has none). So dropping the listing's
    // key term leaves this case green - it reddens `listOwnerRefsForKey`'s own case in
    // action-evidence.test.ts instead (measured) - and no single mutation makes this one fail. It is
    // kept because the day a key IS carried on the ref, this is the case that catches it being used.
    await record({ integrationKey: 'outra-integracao', actionName: DOOMED }, apiCall('another integration'));

    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);

    expect(await evidenceIndex()).toEqual([
      at(ORG, OWNER, SURVIVOR),
      at(ORG, OWNER, DOOMED, 'outra-integracao'),
      at(OTHER_ORG, CONSUMER, DOOMED),
    ].sort());
  });

  it('the FIRST save of a key (an insert, not a replace) collects nothing', async () => {
    // The insert branch never had an `existing`, so nothing it can have narrowed. Asserted so a
    // future collector placed one line higher - outside the replace branch - is caught.
    await integrationDefinitions.deleteMany({});
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.created).toBe(true);
    expect(await rowsInCollection()).toHaveLength(4);
  });
});

/**
 * THE ROUND-THREE FAILURE, reproduced end to end: the row is in the org that RAN the action, and the
 * write that ends it happens in the org that WROTE the definition.
 */
describe('a GLOBAL definition: the consumer org\'s evidence goes when the author drops the action', () => {
  beforeEach(async () => {
    // Only a super-admin may publish to the cross-org tier - the real gate, not a fixture shortcut.
    await definitions.create(definitionRow([DOOMED, SURVIVOR], { visibility: 'global' }), { actor: superAdmin });
    // …and the consumer really does reach it, through the one resolver production runs actions
    // through. Without this the rest of the describe would be a statement about nothing.
    const resolved = await definitions.getForActor(consumer, KEY);
    expect(resolved?.orgId).toBe(ORG);
    expect(resolved?.actions.map((a) => a.actionName)).toEqual([DOOMED, SURVIVOR]);
  });

  it('the consumer\'s row, its PII and its retention pin all go with the action', async () => {
    // Their own run, under their OWN credential, against their OWN clients' data.
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, automation('run-consumer'), 'shape-doomed');
    // The surviving row carries a DIFFERENT marker, so "the PII is gone" below is a statement about
    // the removed row rather than about the fixture having only ever held one string.
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: SURVIVOR }, automation('run-keeps', 'Cliente: outro'), 'shape-survivor');
    expect(await evidence.pinnedRunIdsForRetention()).toEqual(new Set(['run-consumer', 'run-keeps']));

    await definitions.create(definitionRow([SURVIVOR], { visibility: 'global' }), { actor: superAdmin, onConflict: 'replace' });

    // The measured failure was: 2 rows left, both org B's, PII intact, `run-consumer` still pinned.
    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, SURVIVOR)]);
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
    // THE POINT OF THE WHOLE FIX. `sweepExpiredScreenshots` spares every run this set names, and the
    // set shrinks only on a supersede or a discard - neither of which can happen again for an action
    // that now resolves for nobody. Without the reconciler those screenshots of an authenticated
    // client-portal session were exempt from the 7-day sweep permanently.
    expect(await evidence.pinnedRunIdsForRetention()).toEqual(new Set(['run-keeps']));
  });

  it('every consumer org is reconciled, not just the first one found', async () => {
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall(CLIENT_PII));
    await record({ orgId: 'orgC', ownerUserId: 'u-third', actionName: DOOMED }, apiCall('Cliente: terceiro'));
    await record({ actionName: DOOMED }, apiCall('the author\'s own run'));

    await definitions.create(definitionRow([SURVIVOR], { visibility: 'global' }), { actor: superAdmin, onConflict: 'replace' });

    expect(await evidenceIndex()).toEqual([]);
  });

  it('a tenant that resolves the SAME action name through its OWN definition keeps its row', async () => {
    // THE TENANCY CONTROL, and the reason the collector asks `getForActor` instead of matching on
    // (key, action). `getForActor` prefers an org's own row, so org B is not running org A's
    // definition at all - and one org's write must never be able to destroy another's sample.
    await definitions.create(definitionRow([DOOMED], { orgId: OTHER_ORG, userId: CONSUMER }), { actor: consumer });
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall('org B\'s own run'));
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    await definitions.create(definitionRow([SURVIVOR], { visibility: 'global' }), { actor: superAdmin, onConflict: 'replace' });

    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED)]);
  });
});

/**
 * `setVisibility` - the transition the round-two header dismissed by name as NOT a removal path
 * ("hides a definition without dropping any action"). True of the definition; false of what a
 * consumer can reach, which is the only thing an evidence row's life depends on.
 */
describe('a visibility write that NARROWS reach collects the evidence it stranded', () => {
  it('global -> org: every consumer loses every action at once, and every consumer row goes', async () => {
    await definitions.create(definitionRow([DOOMED, SURVIVOR], { visibility: 'global' }), { actor: superAdmin });
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, automation('run-consumer-a'));
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: SURVIVOR }, automation('run-consumer-b'));
    // The author's own org keeps resolving the row at `org` visibility, so its evidence must stand.
    await record({ actionName: DOOMED }, apiCall('the author still has this'));

    const retired = await definitions.setVisibility(definitionIdFor(ORG, KEY), superAdmin, 'org');
    expect(retired.verdict).toBe('ok');
    expect(await definitions.getForActor(consumer, KEY)).toBeNull();

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
    // Both of the consumer's pins released. Nothing else could ever have released them: the
    // definition they name is unreachable for that org, so no run can supersede the rows.
    expect(await evidence.pinnedRunIdsForRetention()).toEqual(new Set());
  });

  it('org -> private: the PEER inside the author\'s own org loses reach, and their row goes', async () => {
    // The same error one tier down, and reachable by an ordinary user with no super-admin anywhere
    // in the story: an org-shared definition two colleagues both ran, made private by its owner.
    await definitions.create(definitionRow([DOOMED]), { actor: author });
    await record({ actionName: DOOMED }, apiCall('the owner\'s own run'));
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall(CLIENT_PII));

    const hidden = await definitions.setVisibility(definitionIdFor(ORG, KEY), author, 'private');
    expect(hidden.verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('private -> org WIDENS reach, so it strands nothing and collects nothing', async () => {
    // THE CONTROL. A visibility write that gives more people access must not be an excuse to delete
    // anybody's sample, and the reconciler answers that correctly without a transition table.
    await definitions.create(definitionRow([DOOMED], { visibility: 'private' }), { actor: author });
    await record({ actionName: DOOMED }, apiCall('the owner\'s own run'));

    expect((await definitions.setVisibility(definitionIdFor(ORG, KEY), author, 'org')).verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
  });
});

describe('the OTHER production caller of the same branch: achieve\'s in-place write', () => {
  it('an in-place definition rewrite that drops an action collects its evidence too', async () => {
    // `integration-achieve.ts` writes through `create(..., onConflict: 'replace')` rather than
    // through `saveAuthoredDefinition`, so it reaches the collector by being the same branch and not
    // by remembering to call it. Entered at the store to prove exactly that.
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    await definitions.create(definitionRow([SURVIVOR]), { actor: author, onConflict: 'replace' });

    expect(await rowsInCollection()).toEqual([]);
  });

  it('a replace by an ORG-ADMIN collects the owner\'s evidence just the same', async () => {
    // The write gate admits a same-org admin, so the collector must not be scoped to the authoring
    // user - the action is gone for everyone regardless of who removed it.
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    const admin: Actor = { userId: 'u-admin', orgId: ORG, role: 'org-admin' };
    await definitions.create(definitionRow([SURVIVOR]), { actor: admin, onConflict: 'replace' });

    expect(await rowsInCollection()).toEqual([]);
  });

  it('a REFUSED replace collects nothing - the evidence outlives a write that never landed', async () => {
    // The order the branch states: the discard runs AFTER the put. A caller that is not allowed to
    // overwrite the row never reaches it, so a forbidden save cannot be used to destroy another
    // tenant's sample.
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    const stranger: Actor = { userId: 'u-stranger', orgId: OTHER_ORG, role: 'user' };
    await expect(definitions.create(definitionRow([SURVIVOR]), { actor: stranger, onConflict: 'replace' }))
      .rejects.toBeTruthy();

    expect(await rowsInCollection()).toHaveLength(1);
  });
});

/**
 * THE OWNER'S ERASURE CONTROL - path 3, and the one the round-two header claimed was "recorded as a
 * gap in docs/findings.md" when the only erasure entry there was about the screenshot TREE.
 *
 * Connect an integration, run an action once, disconnect: the definition still resolves, so the
 * reconciler correctly keeps the row - and without this the person who connected the credential had
 * no way to remove the sample of their own third-party account and no way to supersede it either
 * (that needs re-connecting and re-running).
 */
describe('disconnecting the credential removes the samples it produced', () => {
  const cfgDeps = { now: () => 1_700_000_000_000, genId: () => `cfg-${++clock}` };

  it('through the REAL deleteConfig: the owner\'s rows for that integration go, and nobody else\'s', async () => {
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { token: 'x' }, secretKeys: ['token'] }, cfgDeps);
    await record({ actionName: DOOMED }, automation('run-owner'));
    await record({ actionName: SURVIVOR }, apiCall(CLIENT_PII));
    // The CONTROLS: a colleague's rows for the same integration, and the owner's row for another one.
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('the peer is still connected'));
    await record({ integrationKey: 'outra-integracao', actionName: DOOMED }, apiCall('another integration'));

    expect((await deleteConfig(author, KEY)).verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED, 'outra-integracao'), at(ORG, PEER, DOOMED)]);
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
    // The pin the row held is released, which is what makes this an erasure rather than a hide.
    expect(await evidence.pinnedRunIdsForRetention()).toEqual(new Set());
  });

  it('the definition is untouched, so this is the CREDENTIAL\'s erasure and not the action\'s', async () => {
    await definitions.create(definitionRow([DOOMED]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { token: 'x' }, secretKeys: ['token'] }, cfgDeps);
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    await deleteConfig(author, KEY);

    // The action still resolves - a reconcile would have kept the row, which is exactly why the
    // erasure control is a second, differently-scoped call rather than a fifth trigger for the first.
    expect((await definitions.getForActor(author, KEY))?.actions.map((a) => a.actionName)).toEqual([DOOMED]);
    expect(await rowsInCollection()).toEqual([]);
  });

  it('a delete that is REFUSED erases nothing', async () => {
    // `canWriteConfig` refuses a peer's owner-stamped config, and the erasure must sit behind that
    // gate rather than beside it - otherwise the DELETE route is a way to destroy a colleague's data.
    await definitions.create(definitionRow([DOOMED]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { token: 'x' }, secretKeys: ['token'] }, cfgDeps);
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    const peer: Actor = { userId: PEER, orgId: ORG, role: 'user' };
    expect((await deleteConfig(peer, KEY)).verdict).toBe('forbidden');

    expect(await rowsInCollection()).toHaveLength(1);
  });
});

/**
 * THE COLLECTOR'S FAILURE POSTURE, entered directly and labelled as such.
 *
 * Deletion here is irreversible and the row is somebody's only copy, so every uncertainty must keep
 * it. The inverse posture would turn one Mongo blip during an ordinary save into silent data loss
 * across every tenant that had ever run the integration - which is a worse outcome than the leak the
 * collector exists to prevent, and is the one direction no other case in this file can measure.
 */
describe('discardEvidenceOfUnresolvableActions fails towards KEEPING', () => {
  const refs: ActionEvidenceOwnerRef[] = [
    { orgId: ORG, ownerUserId: OWNER, actionName: DOOMED },
    { orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED },
  ];

  it('a resolution that THROWS keeps that owner\'s rows, and does not abandon the other owner', async () => {
    const discarded: string[] = [];
    const count = await discardEvidenceOfUnresolvableActions(
      KEY,
      async (owner) => {
        if (owner.orgId === ORG) throw new Error('mongo is unhappy');
        return new Set<string>();
      },
      {
        listOwnerRefsForKey: async () => refs,
        discardEvidence: async (key) => { discarded.push(`${key.orgId}/${key.ownerUserId}`); return true; },
      },
    );

    expect(discarded).toEqual([`${OTHER_ORG}/${CONSUMER}`]);
    expect(count).toBe(1);
  });

  it('a listing that THROWS collects nothing at all', async () => {
    const discarded: string[] = [];
    const count = await discardEvidenceOfUnresolvableActions(
      KEY,
      async () => new Set<string>(),
      {
        listOwnerRefsForKey: async () => { throw new Error('mongo is unhappy'); },
        discardEvidence: async (key) => { discarded.push(key.actionName); return true; },
      },
    );

    expect(discarded).toEqual([]);
    expect(count).toBe(0);
  });

  it('resolves ONCE PER OWNER, not once per row', async () => {
    // Not an optimisation detail: `getForActor` is a database read, and an owner with a dozen actions
    // would otherwise pay a dozen of them on every ordinary save.
    const asked: string[] = [];
    await discardEvidenceOfUnresolvableActions(
      KEY,
      async (owner) => { asked.push(`${owner.orgId}/${owner.ownerUserId}`); return new Set([SURVIVOR]); },
      {
        listOwnerRefsForKey: async () => [
          { orgId: ORG, ownerUserId: OWNER, actionName: DOOMED },
          { orgId: ORG, ownerUserId: OWNER, actionName: SURVIVOR },
          { orgId: ORG, ownerUserId: OWNER, actionName: 'terceira' },
        ],
        discardEvidence: async () => true,
      },
    );

    expect(asked).toEqual([`${ORG}/${OWNER}`]);
  });
});
