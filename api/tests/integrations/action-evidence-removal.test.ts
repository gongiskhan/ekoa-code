/**
 * THE REMOVAL PATH for `integration_action_evidence` (slice S1, verification round two).
 *
 * ── WHAT THIS EXISTS TO STOP HAPPENING AGAIN ─────────────────────────────────────────────────
 *
 * The collection landed with NO removal path at all. `discardEvidence` had zero production callers
 * and a docblock naming two it did not have ("Reached when the action itself is gone (a definition
 * write that dropped it), and by the erasure path"). The consequence was not untidiness:
 *
 *   - an evidence row holds one person's REAL request and REAL response body - the reproduction
 *     below uses the shape this product actually captures, `Processo 1234/24.5T8LSB - Cliente:
 *     Maria Silva` - and it is durable, has no TTL and no other index;
 *   - an automation-backed row PINS its run out of the 7-day screenshot sweep
 *     (`pinnedRunIdsForRetention` -> `sweepExpiredScreenshots`), and that pin releases ONLY on a
 *     supersede or a discard. Once the action is gone neither can ever happen again, so the
 *     screenshots of an authenticated client-portal session are exempt from retention PERMANENTLY.
 *
 * S1 therefore converted a bounded retention into an unbounded one, through the most ordinary edit
 * there is: a builder save that drops or renames an action.
 *
 * ── WHY THESE ENTRY POINTS ───────────────────────────────────────────────────────────────────
 *
 * `recipe-lifecycle.ts` enumerates removal paths FROM THE CODE rather than from memory, and this
 * suite is entered the same way. Grepping the writers of the definition document finds
 * `IntegrationDefinitionStore.create` and `IntegrationRecipeStore`; the recipe store only ever
 * `map`s the existing `actions` array (rewriting one element's `recipe`), so it cannot drop an
 * action. There is exactly ONE path, reached by three production callers, and no definition-delete
 * path exists at all.
 *
 * So the cases below enter at the REAL callers - `saveAuthoredDefinition` (the builder save) and
 * `IntegrationDefinitionStore.create(..., onConflict: 'replace')` (what `achieve`'s in-place write
 * calls) - and never at the collector. A test that called `discardEvidenceForAction` itself would
 * prove the collector works and prove nothing about whether production ever reaches it, which is
 * precisely the state the first cut shipped in.
 *
 * EVERYTHING IS COUNTED BY DOCUMENT, against the real collection. "Gone" is the number of rows in
 * `integration_action_evidence`, not the answer of a filtered read - a keyed assertion would have
 * been green throughout the failure this closes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationActionEvidence, integrationDefinitions } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { saveAuthoredDefinition } from '../../src/integrations/definition-save.js';
import {
  ActionEvidenceStore,
  type ActionEvidence,
} from '../../src/integrations/action-evidence-store.js';
import type { IntegrationPackageConfig } from '../../src/integrations/definitions.js';

let mem: MongoMemoryServer;
let clock = 0;
const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const evidence = new ActionEvidenceStore(integrationActionEvidence, () => new Date(1_700_000_000_000 + clock++));

const ORG = 'orgA';
const OTHER_ORG = 'orgB';
const OWNER = 'u-owner';
const PEER = 'u-peer';
// NOT a shipped baseline key: `saveAuthoredDefinition` refuses every reserved key, and a save that
// was refused would make every case below pass for the wrong reason.
const KEY = 'portal-probe';
const DOOMED = 'consultar_processo';
const SURVIVOR = 'arquivar_processo';
const author: Actor = { userId: OWNER, orgId: ORG, role: 'user' };

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

/** An automation-backed sample: POINTERS into a run, which is what makes the row a retention PIN. */
const automation = (runId: string): ActionEvidence => ({
  kind: 'automation',
  runId,
  status: 'succeeded',
  steps: [{ stepIndex: 0, screenshotUrl: `/automation-screenshots/aut-1/${runId}/step-0.png`, excerpt: CLIENT_PII }],
});

function actions(names: string[]) {
  return names.map((actionName) => ({
    actionName,
    description: `acao ${actionName}`,
    mutates: false,
    httpConfig: { method: 'GET', baseUrl: 'https://portal.example', path: `/${actionName}` },
  }));
}

function definitionRow(names: string[], orgId = ORG, userId = OWNER): IntegrationDefinitionCreate {
  return {
    orgId,
    userId,
    key: KEY,
    visibility: 'org',
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

const rowsInCollection = () => integrationActionEvidence.find({});
const actionNamesWithEvidence = async (): Promise<string[]> =>
  (await rowsInCollection())
    .map((r) => (r as unknown as { orgId: string; ownerUserId: string; actionName: string }))
    .map((r) => `${r.orgId}/${r.ownerUserId}/${r.actionName}`)
    .sort();

beforeAll(async () => {
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
});

describe('an ordinary builder save that DROPS an action takes its evidence with it', () => {
  beforeEach(async () => {
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    // Two OWNERS have run the doomed action, because the definition is `org`-visible and each of
    // them ran it under their own credential. Both rows are that person's private data.
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED },
      { backingType: 'api-call', shape: 'shape-doomed', evidence: apiCall(CLIENT_PII) },
    );
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: PEER, integrationKey: KEY, actionName: DOOMED },
      { backingType: 'api-call', shape: 'shape-doomed', evidence: apiCall('Cliente: Joao Peer') },
    );
    // The CONTROLS: an action the save keeps, and another tenant holding the same action name.
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: SURVIVOR },
      { backingType: 'api-call', shape: 'shape-survivor', evidence: apiCall('kept') },
    );
    await evidence.recordEvidence(
      { orgId: OTHER_ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED },
      { backingType: 'api-call', shape: 'shape-other-org', evidence: apiCall('other tenant') },
    );
    expect(await rowsInCollection()).toHaveLength(4);
  });

  it('through the REAL builder save: the dropped action leaves no row, for ANY owner', async () => {
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // The action really is gone from the definition - otherwise this proves nothing about removal.
    expect(saved.doc.actions.map((a) => a.actionName)).toEqual([SURVIVOR]);

    // Counted at the collection. BOTH owners' rows for the dropped action are gone; the surviving
    // action's row and the other tenant's row are untouched.
    expect(await actionNamesWithEvidence()).toEqual([
      `${ORG}/${OWNER}/${SURVIVOR}`,
      `${OTHER_ORG}/${OWNER}/${DOOMED}`,
    ]);
  });

  it('and the client PII is not merely unreachable - it is not in the database', async () => {
    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);
    // The failure this closes was a row that stayed readable through `getEvidence` with the exact
    // string below still in it, for an action that no longer existed anywhere.
    expect(JSON.stringify(await rowsInCollection())).not.toContain(CLIENT_PII);
  });

  it('a RENAME is the same removal - the incoming set simply no longer names it', async () => {
    // What an agent re-authoring an integration does routinely. `carryRecipesForward` and the
    // evidence collector both key on the action NAME, so a rename is indistinguishable from a
    // removal followed by an unrelated creation, and must collect the same way.
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR, 'consultar_processo_v2']), `# ${KEY}\n`, definitions);
    expect(saved.ok).toBe(true);

    expect(await actionNamesWithEvidence()).toEqual([
      `${ORG}/${OWNER}/${SURVIVOR}`,
      `${OTHER_ORG}/${OWNER}/${DOOMED}`,
    ]);
  });

  it('a save that KEEPS every action keeps every row - the collector is not a sweep', async () => {
    // THE CONTROL for all of the above. Without it "the rows are gone" would also be satisfied by a
    // save that simply deleted the org's evidence on every write.
    const saved = await saveAuthoredDefinition(author, packageConfig([DOOMED, SURVIVOR]), `# ${KEY} v2\n`, definitions);
    expect(saved.ok).toBe(true);
    expect(await rowsInCollection()).toHaveLength(4);
  });

  it('the FIRST save of a key (an insert, not a replace) collects nothing', async () => {
    // The insert branch never had an `existing`, so there is nothing it can have dropped. Asserted
    // so a future collector placed one line higher - outside the replace branch - is caught.
    await integrationDefinitions.deleteMany({});
    const saved = await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.created).toBe(true);
    expect(await rowsInCollection()).toHaveLength(4);
  });
});

describe('the retention PIN is released with the action, not held forever', () => {
  it('a dropped automation-backed action stops pinning its run out of the sweep', async () => {
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED },
      { backingType: 'browser-steps', shape: 'shape-doomed', evidence: automation('run-doomed') },
    );
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: SURVIVOR },
      { backingType: 'browser-steps', shape: 'shape-survivor', evidence: automation('run-survivor') },
    );
    expect(await evidence.pinnedRunIdsForRetention()).toEqual(new Set(['run-doomed', 'run-survivor']));

    await saveAuthoredDefinition(author, packageConfig([SURVIVOR]), `# ${KEY}\n`, definitions);

    // THE POINT OF THE WHOLE FIX. `sweepExpiredScreenshots` spares every run this set names, and the
    // set only shrinks on a supersede or a discard - neither of which can ever happen again for an
    // action nobody can run. Without the collector, `run-doomed`'s screenshots of an authenticated
    // client-portal session were exempt from the 7-day sweep permanently.
    expect(await evidence.pinnedRunIdsForRetention()).toEqual(new Set(['run-survivor']));
  });
});

describe('the OTHER production caller of the same branch: achieve\'s in-place write', () => {
  it('an in-place definition rewrite that drops an action collects its evidence too', async () => {
    // `integration-achieve.ts` writes through `create(..., onConflict: 'replace')` rather than
    // through `saveAuthoredDefinition`, so it reaches the collector by being the same branch and not
    // by remembering to call it. Entered at the store to prove exactly that.
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED },
      { backingType: 'api-call', shape: 'shape-doomed', evidence: apiCall(CLIENT_PII) },
    );

    await definitions.create(definitionRow([SURVIVOR]), { actor: author, onConflict: 'replace' });

    expect(await rowsInCollection()).toEqual([]);
  });

  it('a replace by an ORG-ADMIN collects the owner\'s evidence just the same', async () => {
    // The write gate admits a same-org admin, so the collector must not be scoped to the authoring
    // user - the action is gone for everyone regardless of who removed it.
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED },
      { backingType: 'api-call', shape: 'shape-doomed', evidence: apiCall(CLIENT_PII) },
    );

    const admin: Actor = { userId: 'u-admin', orgId: ORG, role: 'org-admin' };
    await definitions.create(
      { ...definitionRow([SURVIVOR]), userId: OWNER },
      { actor: admin, onConflict: 'replace' },
    );

    expect(await rowsInCollection()).toEqual([]);
  });

  it('a REFUSED replace collects nothing - the evidence outlives a write that never landed', async () => {
    // The order the branch states: the discard runs AFTER the put. A caller that is not allowed to
    // overwrite the row never reaches it, so a forbidden save cannot be used to destroy another
    // tenant's sample.
    await definitions.create(definitionRow([DOOMED, SURVIVOR]), { actor: author });
    await evidence.recordEvidence(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: KEY, actionName: DOOMED },
      { backingType: 'api-call', shape: 'shape-doomed', evidence: apiCall(CLIENT_PII) },
    );

    const stranger: Actor = { userId: 'u-stranger', orgId: OTHER_ORG, role: 'user' };
    await expect(definitions.create(definitionRow([SURVIVOR], ORG, OWNER), { actor: stranger, onConflict: 'replace' }))
      .rejects.toBeTruthy();

    expect(await rowsInCollection()).toHaveLength(1);
  });
});
