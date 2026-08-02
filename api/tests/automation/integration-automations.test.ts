import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import {
  provisionIntegrationAutomations,
  managedAutomationId,
  ManagedAutomationProvisionError,
  type IntegrationAutomationTemplate,
  type ProvisionBinding,
} from '../../src/automation/integration-automations.js';
import { listAutomations, getAutomation } from '../../src/automation/service.js';
import { automations } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb } from '../agents/_setup.js';

/**
 * Integration-managed automation provisioning (slice C1) — the regression net for finding
 * `integration-provision-id-not-org-scoped`.
 *
 * THE DEFECT. The materialised automation's deterministic id was `<integrationKey>-<templateKey>`
 * with NO org component, and `Store.insert`'s duplicate-`_id` refusal (data/store.ts returns
 * `false`) was never checked. So the FIRST org to provision a shipped package template owned that
 * id forever: every other org provisioning the same package got a cheerful `created: 1` and no
 * automation at all — no row, no error, nothing in their list.
 *
 * What is pinned here:
 *   - two orgs provisioning the SAME package template each get their OWN automation, and neither
 *     can see the other's (the tenancy predicate in automation/service.ts, unchanged);
 *   - re-provisioning is idempotent: the row is refreshed from the template IN PLACE, never
 *     duplicated;
 *   - COMPAT: a row created under the OLD id keeps that id and is still updated in place, because
 *     the lookup joins on (orgId, source.integrationKey, source.templateKey) — an id is a live
 *     reference (triggers, run history) and is never renumbered under a tenant;
 *   - the id is org-scoped AND injective (hash of the JSON-encoded tuple, not a `-` join);
 *   - a refused insert is never a silent no-op again, and never overwrites another tenant's row.
 */
const orgA: Actor = { userId: 'a1', orgId: 'o1', role: 'user' };
const orgB: Actor = { userId: 'b1', orgId: 'o2', role: 'user' };

const KEY = 'acme-crm';
const TPL = 'sync-contacts';
const LEGACY_ID = `${KEY}-${TPL}`; // the pre-C1 deterministic id, verbatim

function binding(template: Partial<IntegrationAutomationTemplate> = {}): ProvisionBinding {
  return {
    actionName: 'sync_contacts',
    description: 'sincroniza contactos',
    mutates: false,
    templateKey: TPL,
    template: {
      templateKey: TPL,
      name: 'Sincronizar contactos',
      description: 'um passo',
      steps: [{ id: 'open', type: 'navigate', url: 'https://example.com' }],
      ...template,
    },
  };
}

/** A stored automation as a row of the collection (the shape both tiers of this suite seed). */
function row(id: string, orgId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: id,
    id,
    name: 'anterior',
    description: '',
    steps: [],
    ownerUserId: orgId === 'o1' ? 'a1' : 'b1',
    orgId,
    visibility: 'org',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const idsOf = async (actor: Actor): Promise<string[]> => (await listAutomations(actor)).map((a) => a.id);

describe('provisionIntegrationAutomations: the managed-automation id is ORG-SCOPED', () => {
  beforeAll(() => bootAgentTestDb('ekoa_integration_provision'));
  afterAll(shutdownAgentTestDb);
  afterEach(async () => {
    await automations.deleteMany({});
  });

  it('TWO ORGS provisioning the SAME package template each get their own automation', async () => {
    const a = await provisionIntegrationAutomations(orgA, KEY, [binding()]);
    const b = await provisionIntegrationAutomations(orgB, KEY, [binding()]);

    // Before the fix org B's insert was refused and swallowed: it reported this same `created: 1`
    // while owning nothing. The row assertions below are what that lie could not satisfy.
    expect(a.created).toBe(1);
    expect(b.created).toBe(1);
    expect(a.updated).toBe(0);
    expect(b.updated).toBe(0);

    const idA = a.rows[0]?.automationId;
    const idB = b.rows[0]?.automationId;
    expect(idA).toBe(managedAutomationId('o1', KEY, TPL));
    expect(idB).toBe(managedAutomationId('o2', KEY, TPL));
    expect(idA).not.toBe(idB);
    expect(a.rows[0]?.provisioned).toBe(true);
    expect(b.rows[0]?.provisioned).toBe(true);

    // Both rows physically exist, each stamped to its own tenant.
    for (const [id, orgId] of [[idA, 'o1'], [idB, 'o2']] as const) {
      const stored = (await automations.get(id as string)) as { orgId: string; source?: unknown } | null;
      expect(stored, `row for ${orgId}`).not.toBeNull();
      expect(stored?.orgId).toBe(orgId);
      expect(stored?.source).toEqual({ integrationKey: KEY, templateKey: TPL });
    }
  });

  it('and neither org can see the other one (each copy is tenant-invisible)', async () => {
    const idA = (await provisionIntegrationAutomations(orgA, KEY, [binding()])).rows[0]?.automationId as string;
    const idB = (await provisionIntegrationAutomations(orgB, KEY, [binding()])).rows[0]?.automationId as string;

    expect(await idsOf(orgA)).toEqual([idA]);
    expect(await idsOf(orgB)).toEqual([idB]);
    await expect(getAutomation(orgB, idA)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getAutomation(orgA, idB)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Each org DOES hold its own copy — the isolation is not "nobody has one".
    expect((await getAutomation(orgA, idA)).name).toBe('Sincronizar contactos');
    expect((await getAutomation(orgB, idB)).name).toBe('Sincronizar contactos');
  });

  it('re-provisioning the same package for the same org is IDEMPOTENT (updates in place)', async () => {
    const first = await provisionIntegrationAutomations(orgA, KEY, [binding()]);
    const second = await provisionIntegrationAutomations(orgA, KEY, [binding({ name: 'Sincronizar contactos v2' })]);

    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    const rows = await automations.find({ orgId: 'o1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe(first.rows[0]?.automationId);
    expect(rows[0]?.name).toBe('Sincronizar contactos v2'); // the template is the source of truth
    expect(second.rows[0]?.automationId).toBe(first.rows[0]?.automationId);
  });

  it('COMPAT: a row under the OLD non-org-scoped id is updated IN PLACE, keeping its id', async () => {
    // Exactly what a pre-C1 provision left behind: the `<integrationKey>-<templateKey>` id, stamped
    // with its provenance. That stamp — not the id — is what the lookup joins on.
    await automations.insert(row(LEGACY_ID, 'o1', { source: { integrationKey: KEY, templateKey: TPL } }) as never);

    const res = await provisionIntegrationAutomations(orgA, KEY, [binding({ name: 'Nome novo' })]);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);

    const rows = await automations.find({ orgId: 'o1' });
    expect(rows).toHaveLength(1); // NOT a second copy under the new id
    expect(rows[0]?._id).toBe(LEGACY_ID); // the live reference is preserved, never renumbered
    expect(rows[0]?.name).toBe('Nome novo');
    expect(res.rows[0]?.automationId).toBe(LEGACY_ID);
    expect(await automations.get(managedAutomationId('o1', KEY, TPL))).toBeNull();

    // …and the org that was locked out by that legacy row now provisions its own copy.
    const b = await provisionIntegrationAutomations(orgB, KEY, [binding()]);
    expect(b.created).toBe(1);
    expect(await automations.get(managedAutomationId('o2', KEY, TPL))).not.toBeNull();
    expect(await idsOf(orgB)).toEqual([managedAutomationId('o2', KEY, TPL)]);
  });

  it('a refused insert FALLS THROUGH to update-in-place instead of being swallowed', async () => {
    // The id is taken by a same-org row the provenance lookup cannot see (its `source` stamp was
    // lost). Pre-C1 the refusal was discarded and the caller was told `created: 1`.
    const id = managedAutomationId('o1', KEY, TPL);
    await automations.insert(row(id, 'o1', { name: 'orfa' }) as never);

    const res = await provisionIntegrationAutomations(orgA, KEY, [binding()]);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(1);
    expect(res.rows[0]?.provisioned).toBe(true);

    const rows = await automations.find({ orgId: 'o1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Sincronizar contactos');
    expect(rows[0]?.source).toEqual({ integrationKey: KEY, templateKey: TPL }); // provenance restored
  });

  it('a clashing id held by ANOTHER org is refused loudly, never overwritten', async () => {
    // Unreachable while the id hashes the orgId in — which is exactly why it must be loud if the
    // derivation ever regresses: silently writing here would corrupt another tenant's automation.
    const id = managedAutomationId('o1', KEY, TPL);
    await automations.insert(row(id, 'o2', { name: 'alheia' }) as never);

    await expect(provisionIntegrationAutomations(orgA, KEY, [binding()]))
      .rejects.toBeInstanceOf(ManagedAutomationProvisionError);
    expect(((await automations.get(id)) as { name: string } | null)?.name).toBe('alheia');
  });

  it('a binding with no template payload is skipped and stays unprovisioned', async () => {
    const res = await provisionIntegrationAutomations(orgA, KEY, [{ ...binding(), template: null }]);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(0);
    expect(res.rows[0]?.provisioned).toBe(false);
    expect(res.rows[0]?.automationId).toBeNull();
    expect(await automations.find({})).toHaveLength(0);
  });
});

describe('managedAutomationId: org-scoped and injective', () => {
  it('differs per org, is stable, and cannot be confused by a separator in a component', () => {
    expect(managedAutomationId('o1', KEY, TPL)).not.toBe(managedAutomationId('o2', KEY, TPL));
    expect(managedAutomationId('o1', KEY, TPL)).toBe(managedAutomationId('o1', KEY, TPL));
    expect(managedAutomationId('o1', KEY, TPL)).toMatch(/^[0-9a-f]{64}$/);

    // The reason for JSON-encoding the tuple rather than joining it: every component can contain
    // the separator a join would rely on. Each pair below collapses to the same `-`-joined string.
    expect(managedAutomationId('o1', 'a-b', 'c')).not.toBe(managedAutomationId('o1', 'a', 'b-c'));
    expect(managedAutomationId('o-1', 'a', 'b')).not.toBe(managedAutomationId('o', '1-a', 'b'));
  });
});
