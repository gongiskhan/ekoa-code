/**
 * THE REMOVAL RULE for `integration_action_evidence` (slice S1, verification rounds two to five).
 *
 * ── FOUR ROUNDS, FIVE DEFECTS, ONE CAUSE ─────────────────────────────────────────────────────
 *
 * The collection landed with NO removal path (round two): a durable row holding one person's REAL
 * request and REAL response body - the reproductions below use the shape this product actually
 * captures, `Processo 1234/24.5T8LSB - Cliente: Maria Silva` - with no TTL, no other index, and, for
 * an automation-backed row, a PIN that exempts its run's screenshots from the 7-day sweep for as
 * long as the row lives.
 *
 * Every attempt to close that answered "is this action gone?" SYNCHRONOUSLY, at one instant, from
 * one vantage, and each attempt was wrong differently:
 *
 *   round two   collector scoped to the WRITING org  -> orphaned every consumer of a `global` row;
 *   round three collector widened ACROSS TENANTS     -> deleted across an org boundary, twice over;
 *   round four  the reader's own run path            -> deleted on TRANSIENT unreachability;
 *   round four  a tier flip inside the writing org   -> deleted on a flip that was REVERTED;
 *   round four  the boot screenshot sweep            -> swept UNPINNED when the pin read failed.
 *
 * The cause is not the scope, the actor, or the vantage. A DECISION SCOPED TO AN INSTANT WAS
 * GOVERNING DATA WHOSE LIFETIME IS DURABLE. So round five removes synchronous collection entirely
 * and does not replace it with a cleverer reachability check.
 *
 * ── WHAT THIS SUITE PINS ─────────────────────────────────────────────────────────────────────
 *
 * THREE DURABLE SIGNALS END A ROW, and nothing else does:
 *
 *   1. TIME - `sweepExpiredEvidence`, the boot retention sweep. Nobody has to be right about
 *      anything: a row not re-validated inside the window goes, orphan or not.
 *   2. THE OWNER - `discardEvidence`, behind `DELETE /api/v1/integrations/:key/actions/:actionName
 *      /evidence`. A person asking for their own data to go is a durable statement, not a guess.
 *      `deleteConfig`'s credential erasure is the same signal one step out: the credential whose
 *      account the sample holds was durably removed, by the person who connected it.
 *   3. A NEWER SAMPLE - `recordEvidence` supersedes wholesale, because the `_id` IS the tuple.
 *
 * A DEFINITION EDIT, A TIER FLIP, A RE-PUBLISH AND A FAILED RESOLVE RECORD NOTHING AND DELETE
 * NOTHING - and the cases that pin that are written as REPRODUCTIONS of the round-four defects, so
 * each one fails if the collector it replaced is restored.
 *
 * THE TRADE IS DELIBERATE AND IS NOT PRESENTED AS A CLOSED GAP: an orphaned row is a BOUNDED
 * retention and privacy gap (at most `EVIDENCE_RETENTION_DAYS`, closable by the owner at any moment)
 * and a wrongly-deleted row is unrecoverable tenant data. See docs/decisions.md (round five) and the
 * OPEN entry in docs/findings.md for the residual window.
 *
 * ── WHY THESE ENTRY POINTS, AND WHY THE FIXTURE USES THE PRODUCTION WRITERS ───────────────────
 *
 * Every case enters at a REAL production caller - `saveAuthoredDefinition`,
 * `IntegrationDefinitionStore.create(..., 'replace')`, `setVisibility`, `publishDefinition`,
 * `executeUserIntegrationAction`, `deleteConfig` - and never at a collector, because there is no
 * longer a collector to enter.
 *
 * AND THE GLOBAL TIER IS BUILT BY `publishDefinition`, NOT BY `create({visibility:'global'})`. That
 * substitution is what hid the round-three blocker: a row created straight at `global` has NO
 * snapshot, so `publishedViewOf` silently falls back to the live content and every cross-org case
 * described a world where live and published can never disagree - which is the one thing that
 * mattered.
 *
 * EVERYTHING IS COUNTED BY DOCUMENT, against the real collection. "Gone" is the number of rows in
 * `integration_action_evidence`, not the answer of a filtered read. And every "the row survived"
 * case is paired with a control that would also fail if the mechanism under test had simply stopped
 * working - a re-run that succeeds, a supersede that lands, a sweep that removes.
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
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { saveAuthoredDefinition } from '../../src/integrations/definition-save.js';
import { publishDefinition } from '../../src/integrations/publish-scrub.js';
import {
  actionEvidenceStore,
  type ActionEvidence,
  type ActionEvidenceKey,
} from '../../src/integrations/action-evidence-store.js';
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
 * The bytes this is about. Not a placeholder: the whole reason a row must not be destroyed by a
 * guess is that it holds a named client and a real processo number, captured from a live
 * third-party call, and there is exactly one copy of it.
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

/**
 * The evidence seams, bound exactly as `server.ts` binds them onto its ONE executor deps bundle.
 *
 * CAPTURE ONLY, AND THE ABSENCE OF A THIRD MEMBER IS THE POINT. Round four's bundle carried
 * `discardOwnActionEvidence` here; there is no such seam to bind any more.
 */
const evidenceDeps: Pick<ExecutorDeps, 'recordActionEvidence'> = {
  recordActionEvidence: (key, input) => actionEvidenceStore.recordEvidence(key, input),
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
}, 60_000);

afterAll(async () => {
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
 * ROUND FIVE'S RULE, at the definition writes that used to collect. Each case is a reproduction of
 * a shipped deletion, asserted the other way round.
 */
describe('a definition WRITE records nothing and deletes nothing', () => {
  it('the REAL builder save drops an action and leaves every owner\'s sample of it standing', async () => {
    // Round two's and round four's shared entry point: the ordinary save that narrows the action
    // set. Three principals hold a row for the dropped action - the author, a peer in the same org,
    // and another tenant entirely.
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII), 'shape-doomed');
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('Cliente: Joao Peer'), 'shape-doomed');
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall('other tenant'));
    await record({ actionName: SURVIVOR }, apiCall('kept'), 'shape-survivor');

    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // THE CONTROL: the write really landed and really dropped the action, so "nothing was deleted"
    // is a statement about the collector and not about a save that no-opped.
    expect(saved.doc.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);

    expect(await evidenceIndex()).toEqual([
      at(ORG, OWNER, DOOMED),
      at(ORG, OWNER, SURVIVOR),
      at(ORG, PEER, DOOMED),
      at(OTHER_ORG, CONSUMER, DOOMED),
    ].sort());
    expect(JSON.stringify(await rowsInCollection())).toContain(CLIENT_PII);
  });

  it('`achieve`\'s in-place rewrite is the same branch and the same answer', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author, onConflict: 'replace' });

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
  });

  it('a RE-PUBLISH that narrows the snapshot leaves every consumer\'s row standing', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await publish();
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, apiCall(CLIENT_PII));
    await record({ orgId: 'orgC', ownerUserId: 'u-third', actionName: DOOMED }, apiCall('Cliente: terceiro'));

    const id = definitionIdFor(ORG, KEY);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');
    expect((await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore)).ok).toBe(true);
    await publish('narrowed');

    expect(await evidenceIndex()).toEqual([at('orgC', 'u-third', DOOMED), at(OTHER_ORG, CONSUMER, DOOMED)].sort());
  });

  it('a consumer of the FROZEN SNAPSHOT keeps a row for an action they can still RUN', async () => {
    // THE ROUND-THREE BLOCKER, still reproduced end to end, because the fix must not merely have
    // moved: a consumer resolves the snapshot, so an action org A drops from its live row is still
    // reachable for org B, and the write that dropped it must not touch org B's sample.
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await publish();
    await createConfig(consumer, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);

    const first = await run(OTHER_ORG, CONSUMER, DOOMED);
    expect(first.success).toBe(true);
    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED)]);

    const id = definitionIdFor(ORG, KEY);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'org')).verdict).toBe('ok');
    expect((await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, integrationDefinitionStore)).ok).toBe(true);
    expect((await integrationDefinitionStore.setVisibility(id, superAdmin, 'global')).verdict).toBe('ok');

    // The LIVE row no longer names it…
    expect((await integrationDefinitionStore.getForActor(author, KEY))?.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);

    // RETENTION IS ASSERTED HERE, BEFORE ANYTHING RE-RECORDS. Asserting it after the re-run below
    // would be UNFAILABLE: a successful run writes the row back at the same deterministic id, so a
    // collector that had just destroyed it would look identical.
    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED)]);
    expect(JSON.stringify(await rowsInCollection())).toContain(CLIENT_PII);

    // …and org B CAN STILL RUN IT.
    expect((await run(OTHER_ORG, CONSUMER, DOOMED)).success).toBe(true);
  }, 30_000);
});

/**
 * THE TIER FLIP, AND THE DEFECT THAT SURVIVED ROUND FOUR.
 *
 * `org -> private` really does end a peer's reach - for as long as the row stays `private`. Round
 * four read that instant as permanent and deleted every peer's sample on the way down. It is a
 * TOGGLE: the way back up restores the reach and restores no bytes.
 */
describe('a TIER FLIP deletes nothing, and a REVERTED flip is why', () => {
  beforeEach(async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED]), { actor: author });
    // The peer holds their OWN credential, so `definitionActorForCredential` resolves as the peer
    // and their reach really is governed by the row's visibility.
    await createConfig({ userId: PEER, orgId: ORG, role: 'user' }, { integrationKey: KEY, configValues: { api_key: 'mine' }, secretKeys: ['api_key'] }, cfgDeps);
  });

  it('org -> private -> org: the peer\'s sample is still there, and they can run again', async () => {
    // THE ROUND-FOUR DEFECT, reproduced. An org-admin narrows a package to review it and widens it
    // back a minute later; under round four the peer's only copy of their own client data was
    // destroyed on the way down and nothing put it back.
    const ran = await run(ORG, PEER, DOOMED);
    expect(ran.success).toBe(true);
    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED)]);
    const before = JSON.stringify(await rowsInCollection());

    const id = definitionIdFor(ORG, KEY);
    expect((await integrationDefinitionStore.setVisibility(id, author, 'private')).verdict).toBe('ok');
    // THE CONTROL: the flip really did end the peer's reach, so the surviving row is the collector
    // being absent rather than the flip being a no-op.
    expect((await run(ORG, PEER, DOOMED)).code).toBe('unknown_integration');
    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED)]);

    expect((await integrationDefinitionStore.setVisibility(id, author, 'org')).verdict).toBe('ok');

    // Byte-identical, and reachable again. Under round four this row was gone before the second
    // flip ever happened.
    expect(JSON.stringify(await rowsInCollection())).toEqual(before);
    expect((await run(ORG, PEER, DOOMED)).success).toBe(true);
  }, 30_000);

  it('global -> org strands a CONSUMER org and still takes none of their rows', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED, SURVIVOR]), { actor: author, onConflict: 'replace' });
    await publish();
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, automation('run-consumer'));

    expect((await integrationDefinitionStore.setVisibility(definitionIdFor(ORG, KEY), superAdmin, 'org')).verdict).toBe('ok');

    // The consumer really has lost reach…
    expect(await integrationDefinitionStore.getForActor(consumer, KEY)).toBeNull();
    // …and their row, and its screenshot pin, are exactly where they were. This one is bounded by
    // TTL and by the consumer's own erasure control, and by nothing else - which is the trade.
    expect(await evidenceIndex()).toEqual([at(OTHER_ORG, CONSUMER, DOOMED)]);
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set(['run-consumer']));
  }, 30_000);
});

/**
 * THE RUN PATH. Round four collected the caller's own rows on a refusal, and the scope was
 * impeccable - own org, own owner, required by the type. It still deleted data that was not stale,
 * because A REFUSAL IS NOT A FACT ABOUT REACHABILITY: it is one resolution at one instant.
 */
describe('a run that CANNOT RESOLVE records nothing and deletes nothing', () => {
  beforeEach(async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));
  });

  it('an unresolvable ACTION refuses and leaves the caller\'s own row alone', async () => {
    const refused = await run(ORG, OWNER, DOOMED);
    expect(refused.code).toBe('unknown_action');

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED)]);
    expect(JSON.stringify(await rowsInCollection())).toContain(CLIENT_PII);
  }, 30_000);

  it('TRANSIENT unreachability: the integration blips away, refuses, comes back, and the sample survives', async () => {
    // THE ROUND-FOUR DEFECT, reproduced. `resolveOwnerActionSurface` answering "no definition" is
    // indistinguishable from a Mongo blip, a half-applied definition write, or a package being
    // restored a second later - and round four deleted on it.
    await record({ actionName: SURVIVOR }, apiCall('the caller\'s other action'));
    const before = JSON.stringify(await rowsInCollection());

    await integrationDefinitions.deleteMany({});
    const refused = await run(ORG, OWNER, SURVIVOR);
    expect(refused.code).toBe('unknown_integration');
    // Both of the caller's rows are untouched - round four dropped every row they held for the key.
    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, DOOMED), at(ORG, OWNER, SURVIVOR)].sort());

    // The definition comes back (the blip ends, the write finishes, the admin re-publishes)…
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    // …and the sample is byte-identical, for an action that runs again.
    expect(JSON.stringify(await rowsInCollection())).toEqual(before);
    expect((await run(ORG, OWNER, SURVIVOR)).success).toBe(true);
  }, 30_000);

  it('a MISTYPED action name refuses and changes nothing', async () => {
    const refused = await run(ORG, OWNER, 'consultar_procesos');
    expect(refused.code).toBe('unknown_action');
    expect(await rowsInCollection()).toHaveLength(1);
  }, 30_000);
});

/**
 * SIGNAL 3 - A NEWER SAMPLE. The one thing a run DOES decide about a row, and it is durable: a
 * validated run of the same (org, owner, integration, action) replaces the previous sample outright,
 * because the `_id` is the tuple and nothing else.
 */
describe('a VALIDATED run supersedes the old sample, and releases its pin', () => {
  it('the new sample replaces the old one in place, and the old run stops being pinned', async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ actionName: SURVIVOR }, automation('run-old', 'Cliente: sample antigo'));
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set(['run-old']));

    expect((await run(ORG, OWNER, SURVIVOR)).success).toBe(true);

    // ONE row still, holding the NEW bytes: superseding is the operation, not an accumulation.
    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, SURVIVOR)]);
    expect(JSON.stringify(await rowsInCollection())).not.toContain('Cliente: sample antigo');
    // …and the pin the old row held is released in the same write, which is what stops the
    // screenshot exemption from accumulating with run volume.
    expect(await actionEvidenceStore.pinnedRunIdsForRetention()).toEqual(new Set());
  }, 30_000);

  it('and it supersedes only the SAME tuple - a peer\'s row for the same action is untouched', async () => {
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ ownerUserId: PEER, actionName: SURVIVOR }, apiCall(CLIENT_PII));

    expect((await run(ORG, OWNER, SURVIVOR)).success).toBe(true);

    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, SURVIVOR), at(ORG, PEER, SURVIVOR)].sort());
    expect(JSON.stringify(await rowsInCollection())).toContain(CLIENT_PII);
  }, 30_000);
});

/**
 * SIGNAL 2 - THE OWNER. `deleteConfig`'s erasure is here rather than in its own file because it is
 * the same signal one step out: the credential whose third-party account the sample holds was
 * durably removed, by the person who connected it. It is NOT a reachability guess - the definition
 * still resolves perfectly well afterwards.
 */
describe('the OWNER\'s durable signals: an explicit erasure, and a disconnected credential', () => {
  it('the owner\'s erasure control removes their own row and nobody else\'s, idempotently', async () => {
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));
    await record({ ownerUserId: PEER, actionName: DOOMED }, apiCall('the peer\'s own sample'));

    expect(await actionEvidenceStore.discardEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED })).toBe(true);
    // IDEMPOTENT: asking again is `false`, not an error and not somebody else's row.
    expect(await actionEvidenceStore.discardEvidence({ orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED })).toBe(false);

    expect(await evidenceIndex()).toEqual([at(ORG, PEER, DOOMED)]);
  });

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
    // `findConfigForOwner` answers `rows.find(c => c.ownerUserId === owner)` BEFORE falling back to
    // the custodian-less shared row, so a member holding their own credential was never served by
    // the deleted row: their sample is a sample of a credential they still have.
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

  it('a config delete that is REFUSED erases nothing', async () => {
    await integrationDefinitionStore.create(definitionRow([DOOMED]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ actionName: DOOMED }, apiCall(CLIENT_PII));

    expect((await deleteConfig({ userId: PEER, orgId: ORG, role: 'user' }, KEY)).verdict).toBe('forbidden');

    expect(await rowsInCollection()).toHaveLength(1);
  });
});

/**
 * SIGNAL 1 - TIME, and the ONLY automatic collector there is.
 *
 * This is what makes the orphan bounded rather than permanent, and it is the whole other half of the
 * trade: without it, "nothing synchronous deletes a row" would be a way of saying "keep it for
 * ever". It is not a complete answer - a row can sit orphaned for up to `EVIDENCE_RETENTION_DAYS`,
 * which docs/findings.md carries as an OPEN entry rather than a closed one.
 */
describe('TIME is the collector: the retention sweep ends what nobody re-validated', () => {
  it('ends an orphaned row, keeps a fresh one, and releases the orphan\'s pin', async () => {
    await record({ orgId: OTHER_ORG, ownerUserId: CONSUMER, actionName: DOOMED }, automation('run-old'));
    // Age the row past the window by rewriting the ONE field the sweep reads. `validatedAt` is what
    // a successful run stamps, so this is the state a row nobody has re-run reaches on its own.
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

  it('ends it WITHOUT asking whether anything still resolves - there is no definition in the story', async () => {
    // The sweep's whole virtue: it is right without a vantage. No definition, no config, no run -
    // just a stamp older than the window, in a tenant nothing else in this test touches.
    await record({ orgId: 'orgD', ownerUserId: 'u-nobody', actionName: DOOMED }, apiCall(CLIENT_PII));
    await integrationActionEvidence.update(
      (await rowsInCollection())[0]!._id,
      (cur) => ({ ...cur, validatedAt: '2020-01-01T00:00:00.000Z' }),
    );

    expect(await actionEvidenceStore.sweepExpiredEvidence({ now: Date.parse('2026-08-20T00:00:00.000Z') })).toBe(1);

    expect(await rowsInCollection()).toEqual([]);
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('a run inside the window keeps the row alive - the window measures USE, not age', async () => {
    // THE CONTROL for both cases above: an integration in real use never ages out, because every
    // successful run rewrites `validatedAt`. Without this, "the sweep removes things" would also be
    // satisfied by a sweep that removed everything.
    await integrationDefinitionStore.create(definitionRow([SURVIVOR]), { actor: author });
    await createConfig(author, { integrationKey: KEY, configValues: { api_key: 'k' }, secretKeys: ['api_key'] }, cfgDeps);
    await record({ actionName: SURVIVOR }, apiCall('an old sample'));
    await integrationActionEvidence.update(
      (await rowsInCollection())[0]!._id,
      (cur) => ({ ...cur, validatedAt: '2020-01-01T00:00:00.000Z' }),
    );

    expect((await run(ORG, OWNER, SURVIVOR)).success).toBe(true);

    expect(await actionEvidenceStore.sweepExpiredEvidence({ now: Date.parse('2026-08-20T00:00:00.000Z') })).toBe(0);
    expect(await evidenceIndex()).toEqual([at(ORG, OWNER, SURVIVOR)]);
  }, 30_000);
});
