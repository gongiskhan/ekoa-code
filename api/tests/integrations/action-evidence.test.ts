/**
 * ACTION EVIDENCE (slice S1): the one live proof that an action actually ran.
 *
 * The tenancy attack surface has its own suite (tests/security/action-evidence-isolation.test.ts).
 * This one pins the behaviour the detail page and the graduation prerequisite are built on:
 *   - ONE live row per (org, integration, action), superseded WHOLESALE by each validated run -
 *     the `idFor` discipline, so nothing has to remember to delete the previous evidence;
 *   - the caps are real (excerpt bytes, step count) and truncation is RECORDED, never silent;
 *   - the last gate refuses a row that still carries a live credential value ANYWHERE in it,
 *     including in a field no redaction pass knew about;
 *   - the retention pins name automation runs ONLY, and carry no tenant data;
 *   - GRADUATION HAS TEETH: `promoteToTrusted` refuses an action that never ran, and refuses
 *     evidence whose shape names different bytes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationActionEvidence } from '../../src/data/stores.js';
import { Store, type Doc } from '../../src/data/store.js';
import {
  ActionEvidenceStore,
  ActionEvidenceStoreError,
  actionEvidenceIdFor,
  MAX_EVIDENCE_EXCERPT_CHARS,
  MAX_EVIDENCE_STEPS,
  type ActionEvidenceKey,
} from '../../src/integrations/action-evidence-store.js';
import { secretRegistryFromValues } from '../../src/security/redaction.js';
import { promoteToTrusted } from '../../src/integrations/authored-action.js';
import { actionShape } from '../../src/integrations/action-consent.js';

let mem: MongoMemoryServer;
let clock = 0;
const store = new ActionEvidenceStore(integrationActionEvidence, () => new Date(1_700_000_000_000 + clock++));

const KEY: ActionEvidenceKey = { orgId: 'orgA', ownerUserId: 'u-owner', integrationKey: 'citius', actionName: 'consultar_processo' };

const apiCallEvidence = (status = 200, body = '{"ok":true}') =>
  ({
    kind: 'api-call' as const,
    request: { method: 'GET', url: 'https://citius.pt/processos/1', headers: { authorization: '••••' } },
    response: { status, body, bodyIsJson: true },
  });

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_test_action_evidence');
});
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  await integrationActionEvidence.deleteMany({});
  clock = 0;
});

describe('one live row per action, superseded wholesale', () => {
  it('a second validated run REPLACES the first rather than accumulating beside it', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(200, '{"first":true}') });
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(200, '{"second":true}') });

    const all = await integrationActionEvidence.find({});
    expect(all).toHaveLength(1);
    const row = await store.getEvidence(KEY);
    expect(row!.evidence).toMatchObject({ kind: 'api-call', response: { body: '{"second":true}' } });
    // The id is the tuple and nothing else - that IS what makes the supersede structural.
    expect(row!._id).toBe(actionEvidenceIdFor(KEY));
  });

  it('two ACTIONS of the same integration keep separate rows', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, actionName: 'arquivar_processo' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    expect(await integrationActionEvidence.find({})).toHaveLength(2);
    expect(await store.listForIntegration('orgA', 'u-owner', 'citius')).toHaveLength(2);
  });

  it('two OWNERS of the same action keep separate rows - the sample is not the org\'s to share', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(200, '{"whose":"owner"}') });
    await store.recordEvidence({ ...KEY, ownerUserId: 'u-peer' }, { backingType: 'api-call', evidence: apiCallEvidence(200, '{"whose":"peer"}') });

    // Counted at the collection, so "separate" cannot be an artefact of a filtered read.
    expect(await integrationActionEvidence.find({})).toHaveLength(2);
    expect((await store.getEvidence(KEY))!.evidence).toMatchObject({ response: { body: '{"whose":"owner"}' } });
    expect((await store.getEvidence({ ...KEY, ownerUserId: 'u-peer' }))!.evidence)
      .toMatchObject({ response: { body: '{"whose":"peer"}' } });
  });

  it('an empty key term is refused rather than writing an un-scoped row - org OR owner', async () => {
    await expect(store.recordEvidence({ ...KEY, orgId: '' }, { backingType: 'api-call', evidence: apiCallEvidence() }))
      .rejects.toBeInstanceOf(ActionEvidenceStoreError);
    // The owner term is held to the SAME rule as the org term. A system actor carrying `userId: ''`
    // must not be able to mint the one row every member of the org then reads as their own.
    await expect(store.recordEvidence({ ...KEY, ownerUserId: '' }, { backingType: 'api-call', evidence: apiCallEvidence() }))
      .rejects.toBeInstanceOf(ActionEvidenceStoreError);
    expect(await integrationActionEvidence.find({})).toHaveLength(0);
  });
});

/**
 * THE REMOVAL PRIMITIVES, at the store. Counted by DOCUMENT, because the whole failure class this
 * collection keeps producing is a row that STAYED - or, in round three, one that went when it was
 * somebody else's.
 *
 * Their production call sites are proved where they live - the write-time collector through the real
 * definition writes, the reader's own collection through the real executor, and the
 * credential-disconnection erasure through the real `deleteConfig`, all in
 * `tests/integrations/action-evidence-removal.test.ts` - never here.
 */
describe('listOwnerRefsInOrg - who inside ONE org holds a row, and nothing else about it', () => {
  it('names every owner of THAT ORG holding a row for the key, and no sample', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(200, '{"secretish":"orgA owner"}') });
    await store.recordEvidence({ ...KEY, ownerUserId: 'u-peer' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, orgId: 'orgB' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    // A different key must not appear: the reconciler judges one integration at a time.
    await store.recordEvidence({ ...KEY, integrationKey: 'outra' }, { backingType: 'api-call', evidence: apiCallEvidence() });

    const refs = await store.listOwnerRefsInOrg('orgA', 'citius');

    // ORG-SCOPED, WHICH IS THE ROUND-FOUR CORRECTION. Its predecessor took a key alone and answered
    // across every tenant, and a cross-tenant LISTING is what made a cross-tenant DELETE
    // expressible. orgB's row is absent even though it names the same key and the same action.
    expect(refs.map((r) => `${r.orgId}/${r.ownerUserId}/${r.actionName}`).sort()).toEqual([
      'orgA/u-owner/consultar_processo',
      'orgA/u-peer/consultar_processo',
    ]);
    // …AND HELD TO IDENTIFIERS BY THE PROJECTION: no response body crosses into the collector, and
    // the row is not even materialised in memory to be filtered afterwards.
    expect(JSON.stringify(refs)).not.toContain('secretish');
    for (const ref of refs) expect(Object.keys(ref).sort()).toEqual(['actionName', 'orgId', 'ownerUserId']);
  });

  it('an empty org or an empty key lists NOTHING rather than every tenant\'s rows', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    expect(await store.listOwnerRefsInOrg('orgA', '')).toEqual([]);
    expect(await store.listOwnerRefsInOrg('', 'citius')).toEqual([]);
  });
});

/**
 * THE READER'S OWN COLLECTION, at the store. Its production caller is the executor's refusal path
 * (proved in the removal suite); what is pinned here is that the scope cannot widen.
 */
describe('discardOwnerEvidence - one owner\'s rows, optionally one action', () => {
  it('drops one action for one owner, and nobody else\'s row for it', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, ownerUserId: 'u-peer' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, orgId: 'orgB' }, { backingType: 'api-call', evidence: apiCallEvidence() });

    const dropped = await store.discardOwnerEvidence({
      orgId: 'orgA', ownerUserId: 'u-owner', integrationKey: 'citius', actionName: 'consultar_processo',
    });

    expect(dropped).toBe(1);
    expect((await integrationActionEvidence.find({})).map((r) => (r as unknown as { orgId: string; ownerUserId: string }))
      .map((r) => `${r.orgId}/${r.ownerUserId}`).sort()).toEqual(['orgA/u-peer', 'orgB/u-owner']);
  });

  it('with NO action term it drops that owner\'s whole integration - never the org\'s', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, actionName: 'arquivar_processo' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, ownerUserId: 'u-peer' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, integrationKey: 'outra' }, { backingType: 'api-call', evidence: apiCallEvidence() });

    expect(await store.discardOwnerEvidence({ orgId: 'orgA', ownerUserId: 'u-owner', integrationKey: 'citius' })).toBe(2);
    expect((await integrationActionEvidence.find({})).map((r) => (r as unknown as { ownerUserId: string; integrationKey: string }))
      .map((r) => `${r.ownerUserId}/${r.integrationKey}`).sort()).toEqual(['u-owner/outra', 'u-peer/citius']);
  });

  it('an empty term drops NOTHING rather than matching everything', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    for (const scope of [
      { orgId: '', ownerUserId: 'u-owner', integrationKey: 'citius' },
      { orgId: 'orgA', ownerUserId: '', integrationKey: 'citius' },
      { orgId: 'orgA', ownerUserId: 'u-owner', integrationKey: '' },
      // An empty ACTION term must not collapse into "the whole integration": absent and empty are
      // different requests, and only the absent one is a widening the type permits.
      { orgId: 'orgA', ownerUserId: 'u-owner', integrationKey: 'citius', actionName: '' },
    ]) {
      expect(await store.discardOwnerEvidence(scope)).toBe(0);
    }
    expect(await integrationActionEvidence.find({})).toHaveLength(1);
  });
});

/**
 * THE RETENTION SWEEP - the bound that makes "fail towards retaining" honest rather than a way of
 * saying "keep it for ever".
 */
describe('sweepExpiredEvidence - the retention bound', () => {
  const aged = async (validatedAt: string, key = KEY): Promise<void> => {
    const doc = await store.recordEvidence(key, { backingType: 'api-call', evidence: apiCallEvidence() });
    await integrationActionEvidence.update(doc._id, (cur) => ({ ...cur, validatedAt }));
  };

  it('removes what was not re-validated inside the window and keeps what was', async () => {
    await aged('2020-01-01T00:00:00.000Z');
    await aged('2026-08-19T00:00:00.000Z', { ...KEY, actionName: 'arquivar_processo' });

    const removed = await store.sweepExpiredEvidence({ now: Date.parse('2026-08-20T00:00:00.000Z') });

    expect(removed).toBe(1);
    expect((await integrationActionEvidence.find({})).map((r) => (r as unknown as { actionName: string }).actionName))
      .toEqual(['arquivar_processo']);
  });

  it('a non-positive window sweeps NOTHING rather than everything', async () => {
    // The dangerous misconfiguration: a zero or negative retention read as "expire it all". The
    // cutoff would be now-or-later, so every row would match.
    await aged('2020-01-01T00:00:00.000Z');
    expect(await store.sweepExpiredEvidence({ now: Date.now(), retentionDays: 0 })).toBe(0);
    expect(await store.sweepExpiredEvidence({ now: Date.now(), retentionDays: -1 })).toBe(0);
    expect(await integrationActionEvidence.find({})).toHaveLength(1);
  });
});

describe('discardEvidenceForDisconnectedConfig - what a credential produced', () => {
  it('takes every row the OWNER holds for that integration, and nobody else\'s', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, actionName: 'arquivar_processo' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    // The three CONTROLS: a peer in the same org, another tenant, and another integration.
    await store.recordEvidence({ ...KEY, ownerUserId: 'u-peer' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, orgId: 'orgB' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, integrationKey: 'outra' }, { backingType: 'api-call', evidence: apiCallEvidence() });

    const dropped = await store.discardEvidenceForDisconnectedConfig({
      orgId: 'orgA', integrationKey: 'citius', owner: { userId: 'u-owner' },
    });

    expect(dropped).toBe(2);
    const left = (await integrationActionEvidence.find({})) as unknown as {
      orgId: string; ownerUserId: string; integrationKey: string;
    }[];
    expect(left.map((r) => `${r.orgId}/${r.ownerUserId}/${r.integrationKey}`).sort())
      .toEqual(['orgA/u-owner/outra', 'orgA/u-peer/citius', 'orgB/u-owner/citius']);
  });

  it('the org-shared arm takes the members it SERVED and spares one holding their own credential', async () => {
    // `findConfigForOwner` answers `rows.find(c => c.ownerUserId === owner)` BEFORE it falls back to
    // the row with no `ownerUserId`, so the shared credential served only the members who had none.
    // The round-three arm, `'every-owner-in-org'`, erased the rest as well - one member's write
    // destroying another member's data, which is the cross-org disease one tenant in.
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, ownerUserId: 'u-peer' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, orgId: 'orgB' }, { backingType: 'api-call', evidence: apiCallEvidence() });

    const dropped = await store.discardEvidenceForDisconnectedConfig({
      orgId: 'orgA', integrationKey: 'citius', owner: { everyOwnerExcept: ['u-peer'] },
    });

    // The served member's row, and STILL not the other tenant - `orgId` is an exact-match term of
    // both arms - and STILL not the peer who has a credential of their own.
    expect(dropped).toBe(1);
    expect((await integrationActionEvidence.find({})).map((r) => (r as unknown as { orgId: string; ownerUserId: string }))
      .map((r) => `${r.orgId}/${r.ownerUserId}`).sort()).toEqual(['orgA/u-peer', 'orgB/u-owner']);
  });

  it('an EMPTY exclusion list is the whole org, which is what a shared config with no peers means', async () => {
    // The control for the case above: "spares the peer" must be the exclusion doing it, not the arm
    // having quietly stopped deleting.
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, ownerUserId: 'u-peer' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    await store.recordEvidence({ ...KEY, orgId: 'orgB' }, { backingType: 'api-call', evidence: apiCallEvidence() });

    expect(await store.discardEvidenceForDisconnectedConfig({
      orgId: 'orgA', integrationKey: 'citius', owner: { everyOwnerExcept: [] },
    })).toBe(2);
    expect((await integrationActionEvidence.find({})).map((r) => (r as unknown as { orgId: string }).orgId)).toEqual(['orgB']);
  });

  it('an empty term drops NOTHING rather than matching everything', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence() });
    for (const scope of [
      { orgId: '', integrationKey: 'citius', owner: { userId: 'u-owner' } },
      { orgId: 'orgA', integrationKey: '', owner: { userId: 'u-owner' } },
      { orgId: 'orgA', integrationKey: 'citius', owner: { userId: '' } },
      // The dangerous one: an empty org with the org-wide arm would be "delete the whole collection".
      { orgId: '', integrationKey: 'citius', owner: { everyOwnerExcept: [] } },
    ]) {
      expect(await store.discardEvidenceForDisconnectedConfig(scope)).toBe(0);
    }
    expect(await integrationActionEvidence.find({})).toHaveLength(1);
  });
});

describe('the caps are real and truncation is recorded', () => {
  it('caps a response body at MAX_EVIDENCE_EXCERPT_CHARS and says so', async () => {
    const huge = 'x'.repeat(MAX_EVIDENCE_EXCERPT_CHARS + 5_000);
    await store.recordEvidence(KEY, {
      backingType: 'api-call',
      evidence: { ...apiCallEvidence(), response: { status: 200, body: huge } },
    });
    const row = await store.getEvidence(KEY);
    const ev = row!.evidence as { response: { body: string; truncated?: boolean } };
    expect(ev.response.body).toHaveLength(MAX_EVIDENCE_EXCERPT_CHARS);
    expect(ev.response.truncated).toBe(true);
  });

  it('caps the step count and records that the trace was cut', async () => {
    const steps = Array.from({ length: MAX_EVIDENCE_STEPS + 12 }, (_, i) => ({ stepIndex: i }));
    await store.recordEvidence(KEY, {
      backingType: 'browser-steps',
      evidence: { kind: 'automation', runId: 'run-1', steps },
    });
    const row = await store.getEvidence(KEY);
    const ev = row!.evidence as { steps: unknown[]; truncated?: boolean };
    expect(ev.steps).toHaveLength(MAX_EVIDENCE_STEPS);
    expect(ev.truncated).toBe(true);
  });

  it('a body that FITS is not marked truncated (the flag means something)', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(200, 'small') });
    const ev = (await store.getEvidence(KEY))!.evidence as { response: { truncated?: boolean } };
    expect(ev.response.truncated).toBeUndefined();
  });

  it('caps the REQUEST body too, and says so - the half that used to be silent', async () => {
    // The first cut called `capText` on the request body and threw the `truncated` half away, so an
    // oversized request body was cut with no record of it - and cut in the one place a reader cannot
    // notice, because the executor's `truncateForDisplay` puts its own
    // "… [truncated, N more bytes]" marker at the END, which this cap then slices off. The stored
    // sample looked like a complete body that simply stopped.
    await store.recordEvidence(KEY, {
      backingType: 'api-call',
      evidence: {
        ...apiCallEvidence(),
        request: {
          method: 'POST',
          url: 'https://citius.pt/processos',
          headers: {},
          body: `${'p'.repeat(MAX_EVIDENCE_EXCERPT_CHARS)}… [truncated, 4000 more bytes]`,
        },
      },
    });
    const ev = (await store.getEvidence(KEY))!.evidence as { request: { body: string; truncated?: boolean } };
    expect(ev.request.body).toHaveLength(MAX_EVIDENCE_EXCERPT_CHARS);
    expect(ev.request.body).not.toContain('[truncated,');
    expect(ev.request.truncated).toBe(true);
  });

  it('a REQUEST body that fits carries no truncation flag', async () => {
    await store.recordEvidence(KEY, {
      backingType: 'api-call',
      evidence: { ...apiCallEvidence(), request: { method: 'POST', url: 'https://citius.pt/x', headers: {}, body: '{"n":1}' } },
    });
    const ev = (await store.getEvidence(KEY))!.evidence as { request: { body: string; truncated?: boolean } };
    expect(ev.request.body).toBe('{"n":1}');
    expect(ev.request.truncated).toBeUndefined();
  });
});

describe('the last gate - a live credential value anywhere refuses the write', () => {
  const secrets = () => secretRegistryFromValues(['sk-live-abcdef123456']);

  it('refuses a row whose response body still contains a registered value', async () => {
    await expect(store.recordEvidence(KEY, {
      backingType: 'api-call',
      evidence: { ...apiCallEvidence(), response: { status: 200, body: '{"echo":"sk-live-abcdef123456"}' } },
      secrets: secrets(),
    })).rejects.toMatchObject({ code: 'UNSAFE' });
    // NOT WRITTEN. Evidence is worth less than a credential.
    expect(await integrationActionEvidence.find({})).toHaveLength(0);
  });

  it('refuses a value hiding in a STEP EXCERPT - a field the api-call redaction never sees', async () => {
    await expect(store.recordEvidence(KEY, {
      backingType: 'bash-cli',
      evidence: { kind: 'automation', runId: 'run-1', steps: [{ stepIndex: 0, excerpt: 'token=sk-live-abcdef123456' }] },
      secrets: secrets(),
    })).rejects.toMatchObject({ code: 'UNSAFE' });
    expect(await integrationActionEvidence.find({})).toHaveLength(0);
  });

  it('writes normally when nothing registered survives', async () => {
    await expect(store.recordEvidence(KEY, {
      backingType: 'api-call',
      evidence: { ...apiCallEvidence(), response: { status: 200, body: '{"echo":"••••"}' } },
      secrets: secrets(),
    })).resolves.toBeTruthy();
  });
});

describe('retention pins', () => {
  it('names automation runs only, and carries no tenant data', async () => {
    await store.recordEvidence(KEY, {
      backingType: 'browser-steps',
      evidence: { kind: 'automation', runId: 'run-pinned', steps: [{ stepIndex: 0 }] },
    });
    // An api-call row pins nothing: there are no screenshots behind it.
    await store.recordEvidence({ ...KEY, actionName: 'other' }, { backingType: 'api-call', evidence: apiCallEvidence() });
    // Another tenant's run is pinned too - the sweep is a filesystem job that belongs to no org.
    await store.recordEvidence({ ...KEY, orgId: 'orgB' }, {
      backingType: 'browser-steps',
      evidence: { kind: 'automation', runId: 'run-other-tenant', steps: [] },
    });

    const pins = await store.pinnedRunIdsForRetention();
    expect(pins).toEqual(new Set(['run-pinned', 'run-other-tenant']));
    // Identifiers ONLY - a caller learns that a run is pinned, never whose it is.
    for (const pin of pins) expect(typeof pin).toBe('string');
  });

  it('a superseding run RELEASES the previous pin in the same write', async () => {
    await store.recordEvidence(KEY, { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-old', steps: [] } });
    await store.recordEvidence(KEY, { backingType: 'browser-steps', evidence: { kind: 'automation', runId: 'run-new', steps: [] } });
    expect(await store.pinnedRunIdsForRetention()).toEqual(new Set(['run-new']));
  });

  /**
   * THE READ IS BOUNDED - a different claim from "the pin count is bounded", and the one the first
   * cut did not make. `find({})` walked whole documents: rows hold a capped request plus a capped
   * response sample and accumulate as orgs x owners x integrations x actions with no TTL, so at
   * 10k rows this was a multi-gigabyte materialisation AT BOOT to build a set of short strings. The
   * one caller's `.catch` degrades nothing there, because an OOM abort is not a rejection - the real
   * failure mode was a boot crash loop, not "degrades to pin nothing".
   *
   * Asserted BY CONSEQUENCE, over what the driver actually handed back, rather than by inspecting an
   * options object: a sample that is in the returned documents is a sample that was materialised.
   */
  it('never materialises a sample: the returned documents carry the run id and nothing else', async () => {
    const HUGE_SAMPLE = 'Processo 1234/24.5T8LSB - Cliente: Maria Silva';
    await store.recordEvidence(KEY, {
      backingType: 'browser-steps',
      evidence: { kind: 'automation', runId: 'run-pinned', status: 'completed', steps: [{ stepIndex: 0, excerpt: HUGE_SAMPLE }] },
    });
    await store.recordEvidence({ ...KEY, actionName: 'other' }, {
      backingType: 'api-call',
      evidence: { ...apiCallEvidence(200, `{"resumo":"${HUGE_SAMPLE}"}`) },
    });

    // A REAL store over the REAL collection, with only the answer observed on the way past.
    const observed = new Store<Doc>(integrationActionEvidence.name);
    const realFind = observed.find.bind(observed);
    let handedBack: unknown[] = [];
    let askedFor: Record<string, unknown> | undefined;
    observed.find = async (filter, sort, opts) => {
      askedFor = filter;
      const rows = await realFind(filter, sort, opts);
      handedBack = rows;
      return rows;
    };

    expect(await new ActionEvidenceStore(observed).pinnedRunIdsForRetention()).toEqual(new Set(['run-pinned']));
    // The projection is what bounds the SIZE: not one byte of either sample came back.
    expect(JSON.stringify(handedBack)).not.toContain(HUGE_SAMPLE);
    // …and the query term is what bounds the COUNT: the api-call row is never a candidate.
    expect(handedBack).toHaveLength(1);
    expect(askedFor).toEqual({ 'evidence.kind': 'automation' });
  });
});

/**
 * GRADUATION HAS TEETH (the half the brief asked for).
 *
 * `promoteToTrusted` is the ONE producer of `state: 'trusted'`. Before this slice it proved SHAPE
 * and never BEHAVIOUR, so an action could graduate - and so become auto-runnable by `achieve` -
 * having never run once.
 */
describe('promotion requires a last validated run', () => {
  const KEYNAME = 'citius';
  const provisional = (): IntegrationAction => {
    const base = {
      actionName: 'consultar_processo',
      description: 'consulta',
      mutates: true,
      httpConfig: { method: 'GET', baseUrl: 'https://citius.pt', path: '/processos/{{numero}}' },
    } as unknown as IntegrationAction;
    return {
      ...base,
      authoring: {
        state: 'provisional',
        declaredMutates: false,
        shape: actionShape(KEYNAME, base),
        verification: { passed: true },
      },
    } as unknown as IntegrationAction;
  };
  const actor: Actor = { userId: 'ownerA', orgId: 'orgA', role: 'user' };

  it('REFUSES an action that has never run', () => {
    expect(promoteToTrusted(KEYNAME, provisional(), actor, null))
      .toEqual({ ok: false, reason: 'unvalidated' });
  });

  it('REFUSES evidence whose shape names different bytes', () => {
    const action = provisional();
    expect(promoteToTrusted(KEYNAME, action, actor, { shape: 'some-other-shape', validatedAt: 'x' }))
      .toEqual({ ok: false, reason: 'unvalidated' });
  });

  it('REFUSES evidence carrying no shape at all (a pre-field row is not a proof)', () => {
    const action = provisional();
    expect(promoteToTrusted(KEYNAME, action, actor, { validatedAt: 'x' }))
      .toEqual({ ok: false, reason: 'unvalidated' });
  });

  it('PROMOTES when the evidence names the very bytes being promoted', () => {
    const action = provisional();
    const out = promoteToTrusted(KEYNAME, action, actor, {
      shape: actionShape(KEYNAME, action),
      validatedAt: '2026-08-20T00:00:00.000Z',
    }, () => 1_700_000_000_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.action.authoring?.state).toBe('trusted');
    // The promotion is what lets the draft's own `declaredMutates` take effect.
    expect(out.action.mutates).toBe(false);
  });

  it('the SHAPE gate still outranks the evidence gate (an unverified draft never reaches it)', () => {
    const action = provisional();
    const unverified = {
      ...action,
      authoring: { ...action.authoring, verification: { passed: false } },
    } as unknown as IntegrationAction;
    expect(promoteToTrusted(KEYNAME, unverified, actor, { shape: actionShape(KEYNAME, action), validatedAt: 'x' }))
      .toEqual({ ok: false, reason: 'unverified' });
  });
});
