import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import {
  provisionIntegrationAutomations,
  managedAutomationId,
  resolveBoundAutomation,
  type IntegrationAutomationTemplate,
  type ProvisionBinding,
} from '../../src/automation/integration-automations.js';
import { automations } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb } from '../agents/_setup.js';

/**
 * Resolving a package binding to the automation an org actually runs — the regression net for
 * blocker 1 of `citius-listener-blocked` (docs/findings.md).
 *
 * THE DEFECT. A shipped package declares `automationBinding.automationId` as a PLACEHOLDER its
 * author wrote — the citius package says `citius-notificacoes-template` — and the row a tenant runs
 * is minted by the provisioner under a per-org hash and joined back by PROVENANCE
 * (`source.{integrationKey, templateKey}`). `automation/service.ts` fetched the declared id
 * verbatim, so every automation-backed action on every shipped package answered
 * `unknown_automation: citius-notificacoes-template`, forever, however well provisioned the org
 * was. The read surface already knew this (`managedAutomationIdsFor` exists because the detail page
 * 404'd on the same string); the execution surface did not.
 *
 * What is pinned here:
 *   - a template-bearing binding resolves to the org's OWN provisioned row, and two orgs holding
 *     the same package resolve to different rows (the defect made both resolve to nothing);
 *   - COMPAT with pre-C1 rows: a row minted under a legacy id but carrying the provenance stamp is
 *     found by the stamp, because an id is a live reference and is never renumbered;
 *   - a binding with NO template is untouched — the literal id is used as-is, which is the
 *     builder-authored case and byte-for-byte the pre-fix behaviour;
 *   - a template-bearing binding whose literal id IS a real automation still resolves to it, so
 *     nothing that resolved before this function existed stopped resolving;
 *   - NOT PROVISIONED answers with the deterministic id and a null row — never the placeholder,
 *     because that string goes into an error message a human has to act on.
 */
const orgA: Actor = { userId: 'a1', orgId: 'o1', role: 'user' };
const orgB: Actor = { userId: 'b1', orgId: 'o2', role: 'user' };

const KEY = 'citius';
const TPL = 'notificacoes';
/** The literal the shipped citius package actually declares, verbatim. */
const PLACEHOLDER = 'citius-notificacoes-template';

function binding(template: Partial<IntegrationAutomationTemplate> = {}): ProvisionBinding {
  return {
    actionName: 'consultar_notificacoes',
    description: 'lista notificações',
    mutates: false,
    templateKey: TPL,
    template: {
      templateKey: TPL,
      name: 'CITIUS — consultar notificações',
      steps: [{ id: 'open', type: 'navigate', url: 'https://portal.tribunais.org.pt' }],
      ...template,
    },
  };
}

describe('resolveBoundAutomation: a package binding names a TEMPLATE, not an id', () => {
  beforeAll(() => bootAgentTestDb('ekoa_bound_automation_resolution'));
  afterAll(shutdownAgentTestDb);
  afterEach(async () => {
    await automations.deleteMany({});
  });

  it('resolves the placeholder to the ORG\'S OWN provisioned row, per org', async () => {
    await provisionIntegrationAutomations(orgA, KEY, [binding()]);
    await provisionIntegrationAutomations(orgB, KEY, [binding()]);

    const a = await resolveBoundAutomation('o1', KEY, { automationId: PLACEHOLDER, automationTemplate: TPL });
    const b = await resolveBoundAutomation('o2', KEY, { automationId: PLACEHOLDER, automationTemplate: TPL });

    expect(a.id).toBe(managedAutomationId('o1', KEY, TPL));
    expect(b.id).toBe(managedAutomationId('o2', KEY, TPL));
    expect(a.id).not.toBe(b.id);
    // The row itself, not just an id: the caller reads `ownerUserId` off it to gate the run.
    expect(a.row?.ownerUserId).toBe('a1');
    expect(b.row?.ownerUserId).toBe('b1');
    // And under no circumstances the string the package declares.
    expect(a.id).not.toBe(PLACEHOLDER);
  });

  it('finds a PRE-C1 row by its provenance stamp, not by recomputing the hash', async () => {
    const legacyId = `${KEY}-${TPL}`;
    await automations.insert({
      _id: legacyId,
      id: legacyId,
      name: 'anterior',
      description: '',
      steps: [],
      ownerUserId: 'a1',
      orgId: 'o1',
      visibility: 'org',
      source: { integrationKey: KEY, templateKey: TPL },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    const r = await resolveBoundAutomation('o1', KEY, { automationId: PLACEHOLDER, automationTemplate: TPL });
    // Recomputing `managedAutomationId` and fetching it would have missed this row entirely.
    expect(r.id).toBe(legacyId);
    expect(r.row?.id).toBe(legacyId);
  });

  it('leaves a binding with NO template alone — the literal id is a real automation', async () => {
    await automations.insert({
      _id: 'auth-real',
      id: 'auth-real',
      name: 'autorada',
      description: '',
      steps: [],
      ownerUserId: 'a1',
      orgId: 'o1',
      visibility: 'org',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    const r = await resolveBoundAutomation('o1', KEY, { automationId: 'auth-real' });
    expect(r.id).toBe('auth-real');
    expect(r.row?.id).toBe('auth-real');
  });

  it('still resolves a template-bearing binding whose literal IS a real automation', async () => {
    // Nothing provisioned under the provenance stamp, but the declared id exists. Before this
    // function that case worked; it must keep working, or the change is not additive.
    await automations.insert({
      _id: PLACEHOLDER,
      id: PLACEHOLDER,
      name: 'declarada',
      description: '',
      steps: [],
      ownerUserId: 'a1',
      orgId: 'o1',
      visibility: 'org',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never);

    const r = await resolveBoundAutomation('o1', KEY, { automationId: PLACEHOLDER, automationTemplate: TPL });
    expect(r.id).toBe(PLACEHOLDER);
    expect(r.row?.id).toBe(PLACEHOLDER);
  });

  it('answers NOT PROVISIONED with the deterministic id and a null row', async () => {
    const r = await resolveBoundAutomation('o1', KEY, { automationId: PLACEHOLDER, automationTemplate: TPL });
    expect(r.row).toBeNull();
    // The id a human is sent to look for must be the one the provisioner would mint...
    expect(r.id).toBe(managedAutomationId('o1', KEY, TPL));
    // ...never the placeholder, which is not the id of anything.
    expect(r.id).not.toBe(PLACEHOLDER);
  });
});
