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

const KEY: ActionEvidenceKey = { orgId: 'orgA', integrationKey: 'citius', actionName: 'consultar_processo' };

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
    expect(await store.listForIntegration('orgA', 'citius')).toHaveLength(2);
  });

  it('an empty key term is refused rather than writing an un-scoped row', async () => {
    await expect(store.recordEvidence({ ...KEY, orgId: '' }, { backingType: 'api-call', evidence: apiCallEvidence() }))
      .rejects.toBeInstanceOf(ActionEvidenceStoreError);
    expect(await integrationActionEvidence.find({})).toHaveLength(0);
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
