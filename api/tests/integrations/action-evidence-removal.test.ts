/**
 * THE REMOVAL RULE for `integration_action_evidence` (slice S1, verification rounds two to four).
 *
 * ── WHAT THIS FILE EXISTS TO STOP HAPPENING AGAIN ─────────────────────────────────────────────
 *
 * The collection landed with NO removal path (round two): a durable row holding one person's REAL
 * request and REAL response body - the reproductions below use the shape this product actually
 * captures, `Processo 1234/24.5T8LSB - Cliente: Maria Silva` - with no TTL, no other index, and,
 * for an automation-backed row, a PIN that exempts its run's screenshots from the 7-day sweep for
 * as long as the row lives.
 *
 * Round two's collector diffed action sets in the WRITING org, so every consumer of a `global`
 * definition was orphaned. Round three widened it to reconcile ACROSS TENANTS, and produced the
 * opposite and worse failure: A WRITE BY ONE ORG DELETING ANOTHER ORG'S DATA, twice over.
 *
 *   - IT ASKED FOR THE LIVE ROW while a consumer resolves the FROZEN `publishedSnapshot`. A
 *     published definition's live actions and its snapshot's actions diverge by design (the replace
 *     branch carries the snapshot forward, and `setVisibility` re-promotes without re-scrubbing), so
 *     org A's write destroyed org B's only copy of a sample for an action ORG B COULD STILL RUN.
 *   - IT ASKED AS THE RUNNER while an ORG-SHARED credential resolves the definition as the
 *     CUSTODIAN (`definitionActorForCredential`: "never as the reader"). The runner cannot see the
 *     custodian's private row, so the answer was the empty set and every peer's evidence was wiped
 *     by a re-save that dropped nothing at all.
 *
 * ── THE SHAPE THIS SUITE PINS ─────────────────────────────────────────────────────────────────
 *
 * "Who can still resolve this action" has a genuinely different answer per reader, so it is never
 * answered at write time on behalf of a reader the writer cannot see:
 *
 *   1. THE READER COLLECTS ITS OWN. `executeUserIntegrationAction` resolves through the one
 *      production path and drops the CALLER'S rows when the integration or the action is no longer
 *      reachable FOR THEM.
 *   2. THE WRITE COLLECTS INSIDE ITS OWN TENANT ONLY, asking that same production resolution.
 *   3. EVERYTHING ELSE FAILS TOWARDS RETAINING, bounded by the retention sweep, the owner's erasure
 *      control and the credential-disconnection erasure.
 *
 * ── WHY THESE ENTRY POINTS, AND WHY THE FIXTURE USES THE PRODUCTION WRITERS ───────────────────
 *
 * Every case enters at a REAL production caller - `saveAuthoredDefinition`,
 * `IntegrationDefinitionStore.create(..., 'replace')`, `setVisibility`, `publishDefinition`,
 * `executeUserIntegrationAction`, `deleteConfig` - and never at a collector, with one labelled
 * exception at the end that pins the collector's FAILURE POSTURE (a decision not reachable through a
 * write without breaking Mongo).
 *
 * AND THE GLOBAL TIER IS BUILT BY `publishDefinition`, NOT BY `create({visibility:'global'})`. That
 * substitution is what hid the round-three blocker: a row created straight at `global` has NO
 * snapshot, so `publishedViewOf` silently falls back to the live content and every cross-org case
 * described a world where live and published can never disagree - which is the one thing that
 * mattered. With the real writer the same fixture describes a deletion that destroys still-runnable
 * evidence, so the cases below run the action AFTER the write to prove reachability rather than
 * asserting it from a resolver.
 *
 * EVERYTHING IS COUNTED BY DOCUMENT, against the real collection. "Gone" is the number of rows in
 * `integration_action_evidence`, not the answer of a filtered read.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationActionEvidence, integrationDefinitions, integrationConfigs } from '../../src/data/stores.js';
import {
  integrationDefinitionStore,
  definitionIdFor,
  __resetDefinitionEvidenceReconcilerForTests,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { saveAuthoredDefinition } from '../../src/integrations/definition-save.js';
import { publishDefinition } from '../../src/integrations/publish-scrub.js';
import {
  actionEvidenceStore,
  type ActionEvidence,
  type ActionEvidenceKey,
} from '../../src/integrations/action-evidence-store.js';
import {
  bindDefinitionEvidenceReconciler,
  reconcileOwnOrgEvidence,
  MAX_RECONCILED_OWNERS,
} from '../../src/integrations/evidence-reconcile.js';
import { createConfig, deleteConfig } from '../../src/integrations/service.js';
import {
  executeUserIntegrationAction,
  type ExecutorDeps,
  type FetchLike,
} from '../../src/integrations/action-executor.js';
import type { IntegrationPackageConfig } from '../../src/integrations/definitions.js';

let mem: MongoMemoryServer;
let seq = 0;
const cfgDeps = { now: () => 1_700_000_000_000, genId: () => `cfg-${++seq}` };

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
const HOST = 'https://portal.example';
const author: Actor = { userId: OWNER, orgId: ORG, role: 'user' };
const superAdmin: Actor = { userId: 'u-super', orgId: 'org-platform', role: 'super-admin' };
const consumer: Actor = { userId: CONSUMER, orgId: OTHER_ORG, role: 'user' };

/**
 * The bytes this is about. Not a placeholder: the whole reason a row must not be destroyed by
 * somebody else's write is that it holds a named client and a real processo number, captured from a
 * live third-party call, and there is exactly one copy of it.
 */
const CLIENT_PII = 'Processo 1234/24.5T8LSB - Cliente: Maria Silva';

const apiCall = (marker: string): ActionEvidence => ({
  kind: 'api-call',
  request: { method: 'GET', url: `${HOST}/processos/1234`, headers: { accept: 'application/json' } },
  response: { status: 200, body: `{"resumo":"${marker}"}`, bodyIsJson: true },
});

/**
 * An automation-backed sample: POINTERS into a run, which is what makes the row a retention PIN.
 * `status` IS a `RunStatus` member - the production writer `collectRunEvidence` copies
 * `RunRecord.status` straight through, and `RunStatus` has no `succeeded`, it has `completed`.
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
    httpConfig: { method: 'GET', baseUrl: HOST, path: `/${actionName}` },
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
    authType: 'api_key',
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
    authType: 'api_key',
    configSchema: [],
    actions: actions(names),
  } as unknown as IntegrationPackageConfig;
}

/**
 * PUBLISH THE WAY PRODUCTION PUBLISHES: the author submits, a super-admin publishes, and the frozen
 * snapshot is written by `publishSnapshot` from a real scrub. `modelPass: null` takes the documented
 * floor-only path so the suite stays hermetic - it changes what the scrub REMOVES, never whether a
 * snapshot exists, which is the property every cross-org case here depends on.
 */
async function publish(note = 'please publish'): Promise<void> {
  const id = definitionIdFor(ORG, KEY);
  expect((await integrationDefinitionStore.requestPublish(id, author, note)).verdict).toBe('ok');
  const published = await publishDefinition(superAdmin, id, { modelPass: null }, integrationDefinitionStore);
  expect(published.verdict).toBe('ok');
}

const record = (key: Partial<ActionEvidenceKey> & { actionName: string }, ev: ActionEvidence, shape = 'shape-1') =>
  actionEvidenceStore.recordEvidence(
    {
      orgId: key.orgId ?? ORG,
      ownerUserId: key.ownerUserId ?? OWNER,
      integrationKey: key.integrationKey ?? KEY,
      actionName: key.actionName,
    },
    { backingType: ev.kind === 'api-call' ? 'api-call' : 'browser-steps', shape, evidence: ev },
  );

const rowsInCollection = () => integrationActionEvidence.find({});
/** WHOSE row, for WHICH integration, for WHICH action - every identity term printed, so two rows of
 *  different integrations can never collapse to one label. */
const evidenceIndex = async (): Promise<string[]> =>
  (await rowsInCollection())
    .map((r) => (r as unknown as { orgId: string; ownerUserId: string; integrationKey: string; actionName: string }))
    .map((r) => `${r.orgId}/${r.ownerUserId}/${r.integrationKey}/${r.actionName}`)
    .sort();
const at = (orgId: string, ownerUserId: string, actionName: string, integrationKey = KEY) =>
  `${orgId}/${ownerUserId}/${integrationKey}/${actionName}`;

/** The transport seam, faked; everything else on the run path is real. */
const okFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: { forEach: () => undefined },
  text: async () => `{"resumo":"${CLIENT_PII}"}`,
} as unknown as Response);

/** The evidence seams, bound exactly as `server.ts` binds them onto its ONE executor deps bundle. */
const evidenceDeps: Pick<ExecutorDeps, 'recordActionEvidence' | 'discardOwnActionEvidence'> = {
  recordActionEvidence: (key, input) => actionEvidenceStore.recordEvidence(key, input),
  discardOwnActionEvidence: (scope) => actionEvidenceStore.discardOwnerEvidence(scope),
};

const run = (orgId: string, ownerUserId: string, actionName: string) =>
  executeUserIntegrationAction(
    { orgId, ownerUserId, integrationKey: KEY, actionName, args: {} },
    { fetchImpl: okFetch, ...evidenceDeps },
  );

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 'test-jwt-secret';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s1_evidence_removal');
  // THE PRODUCTION BINDING, entered at the ONE named binder `buildApp` calls. Not a re-composition:
  // `tests/automation/composition-root-action-seam.test.ts` is what proves the composition root
  // calls this same function, and this file is what proves the function does the right thing.
  bindDefinitionEvidenceReconciler();
}, 60_000);

afterAll(async () => {
  __resetDefinitionEvidenceReconcilerForTests();
  await closeMongo();
  await mem.stop();
  __resetConfigForTests();
});

beforeEach(async () => {
  await integrationActionEvidence.deleteMany({});
  await integrationDefinitions.deleteMany({});
  await integrationConfigs.deleteMany({});
});

/**
 * THE INVARIANT. Every case here is a write inside org A, and every assertion is about org B's rows
 * still being there afterwards.
 */
describe('a write by ONE org never deletes ANOTHER org\'s evidence', () => {
  beforeEach(async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await publish();
    await createConfig(consumer, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
  });

  it('the consumer reaches the action through the FROZEN SNAPSHOT, and keeps reaching it after the author drops it', async () => {
    // THE ROUND-THREE BLOCKER, reproduced end to end and asserted the other way round.
    const first = await run(OTHER_ORG, CONSUMER, DOOMED);
    expect(first.success).toBe(true);
    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED)]);

    // Org A re-authors without the action. A published row cannot be edited in place, so this is the
    // real production sequence: un-publish, edit, re-publish through the visibility route - which
    // deliberately does NOT re-scrub, so consumers keep reading the reviewed artifact.
    const id = definitionIdFor(ORG, KEY);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');
    expect((await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore)).ok).toBe(true);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'global')).verdict).toBe('ok');

    // The LIVE row no longer names it…
    expect((await integrationDefinitionStore.getForActor(author, KEY))?.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);

    // THE RETENTION CLAIM IS ASSERTED HERE, BEFORE ANYTHING RE-RECORDS. Three writes by org A, and
    // org B's row is exactly where it was. Asserting it after the re-run below would be UNFAILABLE:
    // a successful run writes the row back at the same deterministic id, so a collector that had
    // just destroyed it would look identical.
    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED)]);
    expect(JSON.stringify(await rowsInCollection())).toContain(CLIENT_PII);

    // …and org B CAN STILL RUN IT, because the snapshot is what org B resolves. This is what makes
    // the deletion round three shipped indefensible rather than merely out of scope: the row it
    // destroyed was evidence for an action that still worked.
    const still = await run(OTHER_ORG, CONSUMER, DOOMED);
    expect(still.success).toBe(true);
  });

  it('a demotion that DOES end the consumer\'s reach still does not delete their row - their own path does', async () => {
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, automation('run-consumer'));
    await record({ actionName: SURVIVOR }, apiCall('the author\'s own row'));

    expect((await integrationDefinitionStore.setVisibility(definitionIdFor(ORG, KEY), superAdmin, 'org')).verdict).toBe('ok');

    // The consumer really has lost reach…
    expect(await integrationDefinitionStore.getForActor(consumer, KEY)).toBeNull();
    // …and the row is STILL THERE, because a write in org A may not reach org B's data even when it
    // is right about what org B can see. Retention is the recoverable side of the trade.
    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED), at(ORG, OWNER, SURVIVOR)].sort());
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set(['run-consumer']));

    // The consumer's OWN next run collects it - the only place the answer was ever knowable.
    const refused = await run(OTHER_ORG, CONSUMER, DOOMED);
    expect(refused.code).toBe('unknown_integration');
    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, SURVIVOR)]);
    // …and the pin goes with it, which is what makes this an erasure rather than a hide.
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set());
  });

  it('a RE-PUBLISH that narrows the snapshot leaves the consumer\'s row standing too', async () => {
    // `publishSnapshot` was dismissed by name as "only WIDENS reach". A re-publish with fewer
    // actions is how a published definition stops offering one to every org at once - and it is
    // still not a licence to delete their rows from here.
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall(CLIENT_PII));
    await record({ orgId: 'orgC', ownerUserId: 'u-third', actionName: DOOMED }, apiCall('Cliente: terceiro'));

    const id = definitionIdFor(ORG, KEY);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');
    expect((await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore)).ok).toBe(true);
    await publish('narrowed');

    expect(await evidenceIndex()).toEqual([at('orgC', 'u-third', DOOMED), at(OTHER_ORG, CONSUMER, DOOMED)].sort());
  });

  it('a tenant that resolves the same action through its OWN definition is untouched either way', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED], { orgId: OTHER_ORG, userId: CONSUMER }), { actor: consumer });
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall('org B\'s own run'));

    expect((await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore)).ok).toBe(false);
    expect((await integrationDefinitionStore.setVisibility(definitionIdFor(ORG, KEY), superAdmin, 'org')).verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED)]);
  });
});

/**
 * THE WRITING ORG'S OWN ROWS, which is the one tenant a definition write may collect - and where the
 * question is answerable because the production resolution can be asked for real principals the
 * writer's own tenant contains.
 */
describe('an ordinary builder save collects the writing org\'s OWN rows', () => {
  beforeEach(async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    // Two OWNERS ran the doomed action - the definition is `org`-visible and each ran it under their
    // own credential, so both rows are that person's private data.
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII), 'shape-doomed');
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('Cliente: Joao Peer'), 'shape-doomed');
    await record({ actionName: SURVIVOR }, apiCall('kept'), 'shape-survivor');
    // The CONTROL: another tenant with a definition of its own, which this save must not reach.
    await integrationDefinitionStore.create(definitionRow([DOOMED], { orgId: OTHER_ORG, userId: CONSUMER }), { actor: consumer });
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall('other tenant'), 'shape-other-org');
    expect(await rowsInCollection()).toHaveLength(4);
  });

  it('through the REAL builder save: the dropped action leaves no row, for ANY owner in that org', async () => {
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.doc.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, SURVIVOR), at(OTHER_ORG, CONSUMER, DOOMED)].sort());
  });

  it('and the client PII is not merely unreachable - it is not in the database', async () => {
    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('a RENAME is the same removal - the incoming set simply no longer names it', async () => {
    expect((await saveAuthoredDefinition(author, packageConfig([SURVIVOR, 'consultar_processo_v2']), `# ${KEY}\n`, integrationDefinitionStore)).ok).toBe(true);
    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, SURVIVOR), at(OTHER_ORG, CONSUMER, DOOMED)].sort());
  });

  it('a save that KEEPS every action keeps every row - the collector is not a sweep', async () => {
    // THE CONTROL for all of the above: without it, "the rows are gone" would also be satisfied by a
    // collector that deleted everything for the key on every write.
    expect((await saveAuthoredDefinition(author, packageConfig([DOOMED, SURVIVOR]), `# ${KEY} v2\n`, integrationDefinitionStore)).ok).toBe(true);
    expect(await rowsInCollection()).toHaveLength(4);
  });

  it('another INTEGRATION\'s row for the same action name is not this write\'s business', async () => {
    await record({ integrationKey: 'outra-integracao', actionName: DOOMED }, apiCall('another integration'));
    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);
    expect(await evidenceIndex()).toEqual([
      at(ORG, OWNER, SURVIVOR),
      at(ORG, OWNER, DOOMED, 'outra-integracao'),
      at(OTHER_ORG, CONSUMER, DOOMED),
    ].sort());
  });

  it('the FIRST save of a key (an insert, not a replace) collects nothing', async () => {
    await integrationDefinitions.deleteMany({});
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.created).toBe(true);
    expect(await rowsInCollection()).toHaveLength(4);
  });
});

describe('the other production callers of the same branch', () => {
  it('achieve\'s in-place rewrite reaches the collector by being the same branch', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author, onConflict: 'replace' });

    expect(await rowsInCollection()).toEqual([]);
  });

  it('a replace by an ORG-ADMIN collects the owner\'s evidence just the same', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    const admin: Actor = { userId: 'u-admin', orgId: ORG, role: 'org-admin' };
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: admin, onConflict: 'replace' });

    expect(await rowsInCollection()).toEqual([]);
  });

  it('a REFUSED replace collects nothing - the evidence outlives a write that never landed', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    const stranger: Actor = { userId: 'u-stranger', orgId: OTHER_ORG, role: 'user' };
    await expect(integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: stranger, onConflict: 'replace' }))
      .rejects.toBeTruthy();

    expect(await rowsInCollection()).toHaveLength(1);
  });

  it('org -> private: the PEER inside the author\'s own org loses reach, and their row goes', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED]), { actor: author });
    await record({ actionName: DOOMED }, apiCall('the owner\'s own run'));
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall(CLIENT_PII));

    expect((await integrationDefinitionStore.setVisibility(definitionIdFor(ORG, KEY), author, 'private')).verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('private -> org WIDENS reach, so it strands nothing and collects nothing', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED], { visibility: 'private' }), { actor: author });
    await record({ actionName: DOOMED }, apiCall('the owner\'s own run'));

    expect((await integrationDefinitionStore.setVisibility(definitionIdFor(ORG, KEY), author, 'org')).verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
  });
});

/**
 * THE CUSTODIAN, inside ONE org. The second half of round three's blocker, and the reason the
 * collector asks the production resolution rather than `getForActor(runner)`: with an ORG-SHARED
 * credential the definition resolves as the CUSTODIAN, so a peer reaches the custodian's PRIVATE
 * row - a row the peer cannot see for themselves.
 */
describe('an org-shared credential resolves as the custodian, and the collector must ask the same way', () => {
  const admin: Actor = { userId: 'u-admin', orgId: ORG, role: 'org-admin' };
  const peer: Actor = { userId: PEER, orgId: ORG, role: 'user' };

  beforeEach(async () => {
    // The custodian's own PRIVATE definition, plus the ORG-SHARED credential their ceremony minted
    // (`createConfig` stamps `ownerUserId: undefined` + `custodianUserId` for an org-admin).
    await integrationDefinitionStore.create(
      definitionRow([DOOMED, SURVIVOR], { userId: admin.userId, visibility: 'private' }),
      { actor: admin },
    );
    await createConfig(admin, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
  });

  it('the peer really does run it through the custodian\'s private row', async () => {
    // Without this the rest of the describe would be a statement about nothing: the peer cannot SEE
    // the definition, and resolves it only because the credential decides whose package governs.
    expect(await integrationDefinitionStore.getForActor(peer, KEY)).toBeNull();
    const ran = await run(ORG, PEER, DOOMED);
    expect(ran.success).toBe(true);
    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED)]);
  });

  it('a re-save that DROPS NOTHING keeps the peer\'s row', async () => {
    await run(ORG, PEER, DOOMED);
    // The custodian re-saves the same action set. Round three asked `getForActor(peer)`, got null,
    // and wiped the peer's sample on a write that removed nothing at all.
    await integrationDefinitionStore.create(
      definitionRow([DOOMED, SURVIVOR], { userId: admin.userId, visibility: 'private' }),
      { actor: admin, onConflict: 'replace' },
    );

    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED)]);
    expect((await run(ORG, PEER, DOOMED)).success).toBe(true);
  });

  it('…and a re-save that DOES drop it collects the peer\'s row, because the custodian\'s answer changed', async () => {
    // THE CONTROL. "Keeps the row" must not be satisfied by a collector that stopped collecting.
    await run(ORG, PEER, DOOMED);
    await integrationDefinitionStore.create(
      definitionRow([SURVIVOR], { userId: admin.userId, visibility: 'private' }),
      { actor: admin, onConflict: 'replace' },
    );

    expect(await rowsInCollection()).toEqual([]);
  });
});

/**
 * THE READER'S OWN COLLECTION. Scoped to the caller and nothing else, entered at the real executor.
 */
describe('a run that cannot resolve collects the CALLER\'S rows, and only those', () => {
  beforeEach(async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    // Rows for an action the definition no longer names, held by THREE different principals.
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('the peer has not run since'));
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall('another tenant'));
  });

  it('an unresolvable ACTION drops the caller\'s row for it and touches no other principal\'s', async () => {
    const refused = await run(ORG, OWNER, DOOMED);
    expect(refused.code).toBe('unknown_action');

    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED), at(OTHER_ORG, CONSUMER, DOOMED)].sort());
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('an unresolvable INTEGRATION drops every row the caller holds for that key, and no more', async () => {
    await record({ actionName: SURVIVOR }, apiCall('the caller\'s other action'));
    await record({ integrationKey: 'outra-integracao', actionName: DOOMED }, apiCall('another integration'));
    await integrationDefinitions.deleteMany({});

    const refused = await run(ORG, OWNER, DOOMED);
    expect(refused.code).toBe('unknown_integration');

    expect(await evidenceIndex()).toEqual([
      at(ORG, OWNER, DOOMED, 'outra-integracao'),
      at(ORG, PEER, DOOMED),
      at(OTHER_ORG, CONSUMER, DOOMED),
    ].sort());
  });

  it('a run that SUCCEEDS collects nothing', async () => {
    // THE CONTROL: the collection is bound to the refusal, not to the call.
    expect((await run(ORG, OWNER, SURVIVOR)).success).toBe(true);
    expect(await rowsInCollection()).toHaveLength(4);
  });

  it('a MISTYPED action name cannot reach anything - there is no row under it', async () => {
    const refused = await run(ORG, OWNER, 'consultar_procesos');
    expect(refused.code).toBe('unknown_action');
    expect(await rowsInCollection()).toHaveLength(3);
  });
});

/**
 * THE CREDENTIAL-DISCONNECTION ERASURE. `findConfigForOwner` hands the org-shared row only to
 * members who have NO row of their own, so "every owner in the org" was one member's write erasing
 * another member's data.
 */
describe('disconnecting a credential removes what THAT credential produced', () => {
  it('an owner-stamped config takes the owner\'s rows for that integration, and nobody else\'s', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ actionName: DOOMED }, automation('run-owner'));
    await record({ actionName: SURVIVOR }, apiCall(CLIENT_PII));
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('the peer is still connected'));
    await record({ integrationKey: 'outra-integracao', actionName: DOOMED }, apiCall('another integration'));

    expect((await deleteConfig(author, KEY)).verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED, 'outra-integracao'), at(ORG, PEER, DOOMED)].sort());
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set());
  });

  it('an ORG-SHARED config takes the rows of members it actually served, and SPARES a member holding their own', async () => {
    // The round-four correction, reproduced. PEER has their own credential for this key, so
    // `findConfigForOwner` never handed them the shared row and their sample is a sample of a
    // credential they still hold.
    const admin: Actor = { userId: 'u-admin', orgId: ORG, role: 'org-admin' };
    await integrationDefinitionStore.create(definitionRow([DOOMED]), { actor: author });
    await createConfig(admin, { integrationKey: KEY, configValues: { api_key: 'shared' }, secretKeys: ['api_key'] }, cfgDeps);
    await createConfig({ userId: PEER, orgId: ORG, role: 'user' }, { integrationKey: KEY, configValues: { api_key: 'mine' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));            // served by the shared row
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('the peer\'s own credential'));

    expect((await deleteConfig(admin, KEY)).verdict).toBe('ok');

    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED)]);
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('a delete that is REFUSED erases nothing', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    expect((await deleteConfig({ userId: PEER, orgId: ORG, role: 'user' }, KEY)).verdict).toBe('forbidden');

    expect(await rowsInCollection()).toHaveLength(1);
  });
});

/**
 * THE BOUNDS on the orphan a retaining posture leaves behind. Without these, "fail towards
 * retaining" would be a way of saying "keep it for ever".
 */
describe('the orphan is bounded: a retention sweep and an owner control', () => {
  it('the retention sweep ends a row nobody re-validated, keeps a fresh one, and releases the pin', async () => {
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, automation('run-old'));
    // Age the row past the window by rewriting the ONE field the sweep reads. `validatedAt` is what
    // a successful run stamps, so this is the state a row that nobody has re-run reaches on its own.
    await integrationActionEvidence.update(
      (await rowsInCollection())[0]!._id,
      (cur) => ({ ...cur, validatedAt: '2020-01-01T00:00:00.000Z' }),
    );
    await record({ actionName: SURVIVOR }, automation('run-fresh', 'still in use'));

    const removed = await actionEvidenceStore.sweepExpiredEvidence({ now: Date.parse('2026-08-20T00:00:00.000Z') });

    expect(removed).toBe(1);
    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, SURVIVOR)]);
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set(['run-fresh']));
  });

  it('the owner\'s erasure control removes their own row and nobody else\'s', async () => {
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('the peer\'s own sample'));

    expect(await actionEvidenceStore.discardEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED })).toBe(true);
    // IDEMPOTENT: asking again is `false`, not an error and not somebody else's row.
    expect(await actionEvidenceStore.discardEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED })).toBe(false);

    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED)]);
  });
});

/**
 * THE COLLECTOR'S OWN DECISIONS, entered directly and labelled as such: a failure posture and a cap
 * are not reachable through a definition write without breaking Mongo.
 */
describe('reconcileOwnOrgEvidence fails towards KEEPING and stays bounded', () => {
  const refs = [
    { orgId: ORG, ownerUserId: OWNER, actionName: DOOMED },
    { orgId: ORG, ownerUserId: PEER, actionName: DOOMED },
  ];

  it('a resolution it could not reach (null, not the empty set) keeps that owner\'s rows', async () => {
    const discarded: string[] = [];
    const count = await reconcileOwnOrgEvidence(ORG, KEY, {
      listOwnerRefsInOrg: async () => refs,
      resolvableActionNames: async (_org, owner) => (owner === OWNER ? null : new Set<string>()),
      discardEvidence: async (key) => { discarded.push(key.ownerUserId); return true; },
    });

    expect(discarded).toEqual([PEER]);
    expect(count).toBe(1);
  });

  it('a listing that THROWS collects nothing at all', async () => {
    const discarded: string[] = [];
    const count = await reconcileOwnOrgEvidence(ORG, KEY, {
      listOwnerRefsInOrg: async () => { throw new Error('mongo is unhappy'); },
      resolvableActionNames: async () => new Set<string>(),
      discardEvidence: async (key) => { discarded.push(key.actionName); return true; },
    });

    expect(discarded).toEqual([]);
    expect(count).toBe(0);
  });

  it('a ref from ANOTHER org is never discarded, whatever the listing hands back', async () => {
    // Defence in depth over the one term that matters: the query already filters on org, so this can
    // only fire on a hand-written row or a future change to the listing - and on that day it is the
    // difference between a bug and a cross-tenant deletion.
    const discarded: string[] = [];
    const count = await reconcileOwnOrgEvidence(ORG, KEY, {
      listOwnerRefsInOrg: async () => [{ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, ...refs],
      resolvableActionNames: async () => new Set<string>(),
      discardEvidence: async (key) => { discarded.push(`${key.orgId}/${key.ownerUserId}`); return true; },
    });

    expect(discarded).toEqual([`${ORG}/${OWNER}`, `${ORG}/${PEER}`]);
    expect(count).toBe(2);
  });

  it('resolves ONCE PER OWNER, not once per row', async () => {
    const asked: string[] = [];
    await reconcileOwnOrgEvidence(ORG, KEY, {
      listOwnerRefsInOrg: async () => [
        { orgId: ORG, ownerUserId: OWNER, actionName: DOOMED },
        { orgId: ORG, ownerUserId: OWNER, actionName: SURVIVOR },
        { orgId: ORG, ownerUserId: OWNER, actionName: 'terceira' },
      ],
      resolvableActionNames: async (_org, owner) => { asked.push(owner); return new Set([SURVIVOR]); },
      discardEvidence: async () => true,
    });

    expect(asked).toEqual([OWNER]);
  });

  it('stops at MAX_RECONCILED_OWNERS rather than paying N round-trips inside an ordinary save', async () => {
    const asked: string[] = [];
    const many = Array.from({ length: MAX_RECONCILED_OWNERS + 5 }, (_v, i) => ({
      orgId: ORG, ownerUserId: `u-${i}`, actionName: DOOMED,
    }));
    const count = await reconcileOwnOrgEvidence(ORG, KEY, {
      listOwnerRefsInOrg: async () => many,
      resolvableActionNames: async (_org, owner) => { asked.push(owner); return new Set<string>(); },
      discardEvidence: async () => true,
    });

    expect(asked).toHaveLength(MAX_RECONCILED_OWNERS);
    expect(count).toBe(MAX_RECONCILED_OWNERS);
  });

  it('an UNBOUND seam collects nothing, and a definition write still succeeds', async () => {
    // The posture when the composition root has not bound the collector: retain, never guess. The
    // reader path, the retention sweep and the owner control all still reach the rows.
    __resetDefinitionEvidenceReconcilerForTests();
    try {
      await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
      await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

      const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);

      expect(saved.ok).toBe(true);
      expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
    } finally {
      bindDefinitionEvidenceReconciler();
    }
  });
});
