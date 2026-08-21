/**
 * ACTION EVIDENCE (slice S1): the one live proof that an action actually ran.
 *
 * The tenancy attack surface has its own suite (tests/security/action-evidence-isolation.test.ts).
 * This one pins the behaviour the graduation prerequisite is built on today, and the detail page
 * will be built on when S2/S3 mounts it:
 *   - ONE live row per (org, integration, action), superseded WHOLESALE by each validated run -
 *     the `idFor` discipline, so nothing has to remember to delete the previous evidence;
 *   - THE STORE'S OWN caps are real (excerpt bytes, step count) and truncation is recorded. Read
 *     that scope literally: every case here calls `recordEvidence` directly, so what it pins is the
 *     ceiling this module applies to what it is HANDED. The step cap in particular is unreachable
 *     from production through this door - `collectRunEvidence` slices to the same 50 before the seam
 *     - and the end-to-end claim, that a cut run is STORED as a cut run, is pinned where the whole
 *     chain is real: `tests/automation/composition-root-action-seam.test.ts`;
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
  type ActionEvidenceKey,
} from '../../src/integrations/action-evidence-store.js';
import { secretRegistryFromValues } from '../../src/security/redaction.js';
import { promoteToTrusted } from '../../src/integrations/authored-action.js';
import { actionShape } from '../../src/integrations/action-consent.js';

/**
 * THE STORE'S NUMBERS, RESTATED AS LITERALS rather than imported - the discipline
 * `tests/automation/action-evidence.test.ts` already applies to the collector's mirror of the same
 * caps ("restated here so a change to either is visible as a failure rather than absorbed by a
 * shared import"). Importing the constant makes the test say "the cap is whatever the cap is",
 * which is true of every value the constant could hold.
 *
 * MEASURED, NOT ASSUMED: before these literals existed, `MAX_EVIDENCE_STEPS` 50 -> 7 and
 * `MAX_EVIDENCE_EXCERPT_CHARS` 8_000 -> 111 both left every suite that touches them green, because
 * each case built `CONST + N` inputs and asserted `toHaveLength(CONST)`.
 */
const MAX_STEPS = 50;
const MAX_EXCERPT_CHARS = 8_000;
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * collection keeps producing is a row that STAYED - or, in rounds three and four, one that went when
 * it should not have.
 *
 * THERE ARE THREE OF THEM AND THEY ARE ALL DURABLE SIGNALS (round five). `listOwnerRefsInOrg` and
 * `discardOwnerEvidence` used to be tested here, one per collector - the write-time reconciler and
 * the reader's own collection - and both methods are deleted with the collectors they served, since
 * "is this action gone?" is not answerable at one instant for a row whose lifetime is durable. What
 * remains: TIME (`sweepExpiredEvidence`, below), THE OWNER (`discardEvidence`, and
 * `discardEvidenceForDisconnectedConfig` one step out), and A NEWER SAMPLE (`recordEvidence`'s
 * structural supersede, above).
 *
 * Their production call sites are proved where they live - the owner's DELETE route through the
 * contract suite, the credential erasure through the real `deleteConfig`, and the sweep through the
 * real boot composition - never here.
 */

/**
 * THE RETENTION SWEEP - the ONLY automatic collector there is, and what keeps "nothing synchronous
 * deletes a row" from meaning "keep it for ever".
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

  /**
   * THE WINDOW IS 90 DAYS, AND THE NUMBER IS PINNED IN THE DIRECTION THAT DESTROYS DATA.
   *
   * The case above pins the sweep's SHAPE - old goes, recent stays - and pins the window only to
   * ">= 1 day", because its kept row is stamped ONE day before the sweep. So the widening direction
   * was caught (`EVIDENCE_RETENTION_DAYS` 90 -> 36_500 reddens four cases across three suites,
   * measured) and the NARROWING direction was not: 90 -> 1 left all thirteen S1 suites green, and
   * since only three files in the estate touch `sweepExpiredEvidence` /
   * `sweepScreenshotsSparingPinnedEvidence`, the full suite stayed green with it.
   *
   * That is the one direction whose consequence is unrecoverable. Round five made TTL the SOLE
   * automatic collector, which is what made this constant load-bearing: an edit or an env-driven
   * override that narrows it deletes every tenant's evidence - the owner's only copy of their own
   * third-party request and response - shortly after their last run, AND releases every
   * automation-backed row's screenshot pin in the same boot, so the next sweep takes the PNGs too.
   * "At most `EVIDENCE_RETENTION_DAYS`" is the accepted-cost argument in docs/decisions.md,
   * docs/findings.md (`evidence-orphan-window-until-ttl`), docs/architecture.md and this store's own
   * header; four documents rested on it and nothing enforced it.
   *
   * HALF A DAY EITHER SIDE, NOT A WHOLE ONE, so the pin is exact rather than approximate. With
   * whole-day offsets a 90 -> 89 mutant survives (the row stamped 89 days back would sit exactly ON
   * the new cutoff, and the sweep's comparison is strict `$lt`); straddling the boundary by half a
   * day means ANY integer change to the constant moves one of these two rows across it.
   */
  it(`the window is ${RETENTION_DAYS} days: half a day inside survives, half a day outside goes`, async () => {
    const now = Date.parse('2026-08-20T00:00:00.000Z');
    const boundary = now - RETENTION_DAYS * DAY_MS;
    await aged(new Date(boundary + DAY_MS / 2).toISOString(), { ...KEY, actionName: 'inside-the-window' });
    await aged(new Date(boundary - DAY_MS / 2).toISOString(), { ...KEY, actionName: 'outside-the-window' });

    expect(await store.sweepExpiredEvidence({ now })).toBe(1);
    expect((await integrationActionEvidence.find({})).map((r) => (r as unknown as { actionName: string }).actionName))
      .toEqual(['inside-the-window']);
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

describe('the STORE\'S OWN caps are real and truncation is recorded', () => {
  it(`caps a response body at ${MAX_EXCERPT_CHARS} chars and says so`, async () => {
    const huge = 'x'.repeat(MAX_EXCERPT_CHARS + 5_000);
    await store.recordEvidence(KEY, {
      backingType: 'api-call',
      evidence: { ...apiCallEvidence(), response: { status: 200, body: huge } },
    });
    const row = await store.getEvidence(KEY);
    const ev = row!.evidence as { response: { body: string; truncated?: boolean } };
    expect(ev.response.body).toHaveLength(MAX_EXCERPT_CHARS);
    expect(ev.response.truncated).toBe(true);
  });

  /**
   * THE MODULE'S OWN CEILING, AND NOT THE PRODUCTION PATH - said out loud because this case used to
   * be cited as covering the production path, and it is exactly what hid the defect.
   *
   * A 62-step `AutomationEvidence` is a shape the production writer STRUCTURALLY CANNOT PRODUCE:
   * `collectRunEvidence` slices to 50 before the executor forwards anything, so `capEvidence`
   * receives exactly 50 items and its `evidence.steps.length > MAX_EVIDENCE_STEPS` disjunct compares
   * equal numbers. What this pins is the belt-and-braces guarantee that a FUTURE caller which
   * forgets to cap cannot grow the document past what the collection promises. The claim about real
   * runs - a 200-step run stored as a 50-step prefix that SAYS it is one - is pinned end to end in
   * `tests/automation/composition-root-action-seam.test.ts`, through the real collector, the real
   * executor forward and this real store.
   */
  it(`caps the step count at ${MAX_STEPS} and records that the trace was cut (the module's own ceiling)`, async () => {
    const steps = Array.from({ length: MAX_STEPS + 12 }, (_, i) => ({ stepIndex: i }));
    await store.recordEvidence(KEY, {
      backingType: 'browser-steps',
      evidence: { kind: 'automation', runId: 'run-1', steps },
    });
    const row = await store.getEvidence(KEY);
    const ev = row!.evidence as { steps: { stepIndex: number }[]; truncated?: boolean };
    expect(ev.steps).toHaveLength(MAX_STEPS);
    // FIRST steps, not last - asserted by index so a `slice(-MAX_EVIDENCE_STEPS)` mutant dies here
    // as it does in the collector's own suite. A trace is read top-down.
    expect(ev.steps[0]!.stepIndex).toBe(0);
    expect(ev.steps[MAX_STEPS - 1]!.stepIndex).toBe(MAX_STEPS - 1);
    expect(ev.truncated).toBe(true);
  });

  it('KEEPS a cut flag that arrived with an already-capped trace - the production shape', async () => {
    // THE SHAPE THE PRODUCTION WRITER REALLY HANDS THIS: exactly `MAX_STEPS` steps (the collector
    // sliced) plus the collector's own record that the run was longer. `capEvidence`'s length test
    // is false here - 50 is not > 50 - so the ONLY thing that can carry the cut through is the
    // `|| evidence.truncated` disjunct. Delete it and the flag is dropped on every real run.
    await store.recordEvidence(KEY, {
      backingType: 'browser-steps',
      evidence: {
        kind: 'automation',
        runId: 'run-1',
        steps: Array.from({ length: MAX_STEPS }, (_, i) => ({ stepIndex: i })),
        truncated: true,
      },
    });
    const ev = (await store.getEvidence(KEY))!.evidence as { steps: unknown[]; truncated?: boolean };
    expect(ev.steps).toHaveLength(MAX_STEPS);
    expect(ev.truncated).toBe(true);
  });

  it('an automation trace that FITS and says nothing carries no cut flag', async () => {
    await store.recordEvidence(KEY, {
      backingType: 'browser-steps',
      evidence: { kind: 'automation', runId: 'run-1', steps: [{ stepIndex: 0 }] },
    });
    const ev = (await store.getEvidence(KEY))!.evidence as { truncated?: boolean };
    expect(ev).not.toHaveProperty('truncated');
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
          body: `${'p'.repeat(MAX_EXCERPT_CHARS)}… [truncated, 4000 more bytes]`,
        },
      },
    });
    const ev = (await store.getEvidence(KEY))!.evidence as { request: { body: string; truncated?: boolean } };
    expect(ev.request.body).toHaveLength(MAX_EXCERPT_CHARS);
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
    expect(promoteToTrusted(KEYNAME, action, actor, { shape: 'some-other-shape', validatedAt: 'x', outcome: 'succeeded' }))
      .toEqual({ ok: false, reason: 'unvalidated' });
  });

  it('REFUSES evidence carrying no shape at all (a pre-field row is not a proof)', () => {
    const action = provisional();
    expect(promoteToTrusted(KEYNAME, action, actor, { validatedAt: 'x', outcome: 'succeeded' }))
      .toEqual({ ok: false, reason: 'unvalidated' });
  });

  it('PROMOTES when the evidence names the very bytes being promoted', () => {
    const action = provisional();
    const out = promoteToTrusted(KEYNAME, action, actor, {
      shape: actionShape(KEYNAME, action),
      validatedAt: '2026-08-20T00:00:00.000Z',
      outcome: 'succeeded',
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
    expect(promoteToTrusted(KEYNAME, unverified, actor, { shape: actionShape(KEYNAME, action), validatedAt: 'x', outcome: 'succeeded' }))
      .toEqual({ ok: false, reason: 'unverified' });
  });

  /**
   * THE OUTCOME TERM (round eight) - the gate stops resting on a WRITE-SITE INVARIANT.
   *
   * Until this term existed, `promoteToTrusted` read PRESENCE plus `shape` and nothing else, so
   * "an action may only graduate on a run that WORKED" was true only because of one line in
   * `action-executor.ts` refusing to record a failed automation run. Delete that line - which the
   * whole S1 estate survived - and a failed run's trace supersedes the last successful sample at the
   * same `_id`, and this function would have promoted on it while reading nothing that disagreed.
   *
   * The three cases below are the term at its own level: refuse `failed`, refuse ABSENT, and accept
   * `succeeded` so the gate stays a gate.
   */
  describe('the run also has to have WORKED', () => {
    const matching = (action: IntegrationAction) => ({ shape: actionShape(KEYNAME, action), validatedAt: 'x' });

    it('REFUSES a row whose run FAILED, even when it names exactly these bytes', () => {
      const action = provisional();
      expect(promoteToTrusted(KEYNAME, action, actor, { ...matching(action), outcome: 'failed' }))
        .toEqual({ ok: false, reason: 'unvalidated' });
    });

    it('REFUSES a row that says NOTHING about how the run ended', () => {
      // Fail-closed, the same reading this function already takes of a shapeless row: "we cannot
      // tell how it ended" must not share a code path with "it worked". Also the reading that makes
      // a hand-written or restored row unable to buy a promotion.
      const action = provisional();
      expect(promoteToTrusted(KEYNAME, action, actor, matching(action)))
        .toEqual({ ok: false, reason: 'unvalidated' });
    });

    it('and PROMOTES on `succeeded`, so the term is a gate and not a ban', () => {
      const action = provisional();
      const out = promoteToTrusted(KEYNAME, action, actor, { ...matching(action), outcome: 'succeeded' });
      expect(out.ok).toBe(true);
    });
  });
});

/**
 * …AND THE TERM IS DERIVED BY THE STORE, WHICH IS WHY IT CANNOT BE THE WRITE SITE'S OPINION.
 *
 * A term the executor PASSED IN would restate the write site's own belief, so a write site that
 * recorded a failure would label it `succeeded` and the gate would be exactly as dependent on that
 * site as it was before. These cases go through `recordEvidence` - a production API of this store -
 * and read the label off the stored document.
 */
describe('the outcome term is read off the sample, not asserted by the caller', () => {
  it('a 2xx api-call sample is `succeeded`; a 5xx one is `failed`', async () => {
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(200) });
    expect((await store.getEvidence(KEY))!.outcome).toBe('succeeded');

    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(503, 'upstream is down') });
    expect((await store.getEvidence(KEY))!.outcome).toBe('failed');
  });

  it('the 2xx window is the window, at both edges', async () => {
    // Straddled rather than sampled: `>= 200 && < 300` has two bounds and a single 200/500 pair
    // leaves either free to move. 204 and 302 are both ordinary answers from a real API.
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(204, '') });
    expect((await store.getEvidence(KEY))!.outcome).toBe('succeeded');
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(299, '') });
    expect((await store.getEvidence(KEY))!.outcome).toBe('succeeded');
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(199, '') });
    expect((await store.getEvidence(KEY))!.outcome).toBe('failed');
    await store.recordEvidence(KEY, { backingType: 'api-call', evidence: apiCallEvidence(300, '') });
    expect((await store.getEvidence(KEY))!.outcome).toBe('failed');
  });

  it('an automation sample is `succeeded` only on `completed` - the ONE success member of RunStatus', async () => {
    const automation = (status?: string) => ({
      kind: 'automation' as const,
      runId: 'run-1',
      ...(status !== undefined ? { status } : {}),
      steps: [{ stepIndex: 0, status: status === 'completed' ? 'completed' : 'failed' }],
    });

    await store.recordEvidence(KEY, { backingType: 'browser-steps', evidence: automation('completed') });
    expect((await store.getEvidence(KEY))!.outcome).toBe('succeeded');
    // `failed`, `cancelled` and every halt (`needs_credentials`, `awaiting_daemon`, …) are members of
    // `RunStatus` that are not a run that worked. A run whose status is ABSENT is `failed` too, which
    // is the fail-closed direction: "we cannot tell" is not "it worked".
    for (const status of ['failed', 'cancelled', 'needs_credentials', 'awaiting_daemon', undefined]) {
      await store.recordEvidence(KEY, { backingType: 'browser-steps', evidence: automation(status) });
      expect((await store.getEvidence(KEY))!.outcome).toBe('failed');
    }
  });
});
