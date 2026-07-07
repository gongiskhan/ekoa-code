import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildAutomationCatalog, formatCatalogForPrompt } from '../../src/automation/catalog.js';
import { setCatalogSources, __resetAutomationSeamsForTests, type CatalogSources } from '../../src/automation/seams.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb } from '../agents/_setup.js';

/**
 * Cross-agent catalog (carryover-audit B24). Adapted from the old Cortex cross-agent suite's
 * catalog-listing cases: the builder reads the owner's automations (from the `automations` store),
 * and its integration actions / connected accounts / ekoa actions through the injected
 * `CatalogSources` seam. Owner-scoping and the PT-PT triggered-automation rendering carry.
 */
const sources: CatalogSources = {
  getVisibleSkills: () => [
    { integrationKey: 'slack', actions: [{ actionName: 'post_message', description: 'Post a message to Slack', argsSchema: { properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] }, mutates: true }] },
  ],
  getSkill: () => undefined,
  getConnectedPlatformAccounts: async () => [{ integrationKey: 'google-workspace', email: 'me@example.com' }],
  listEkoaActions: async () => [
    { artifactSlug: 'crm', artifactName: 'CRM', capabilityName: 'add_client', description: 'Add a client', argsSummary: 'name, email', mutates: true },
  ],
};

describe('automation catalog (§5.5.2 layer 4)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_catalog'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    __resetAutomationSeamsForTests();
    setCatalogSources(sources);
    await automations.insert({
      _id: 'auto-u1', id: 'auto-u1', name: 'Enviar relatório', description: 'Envia o relatório diário',
      steps: [], ownerUserId: 'u1', inputSchema: { fields: [{ name: 'data', description: 'a data', required: true }] },
      trigger: { kind: 'webhook', triggerId: 'trg', integrationKey: 'stripe', eventName: 'invoice.paid' },
      createdAt: '', updatedAt: '',
    } as never);
    await automations.insert({
      _id: 'auto-u2', id: 'auto-u2', name: 'Other user automation', description: 'not visible',
      steps: [], ownerUserId: 'u2', createdAt: '', updatedAt: '',
    } as never);
  });
  afterEach(async () => { __resetAutomationSeamsForTests(); await automations.deleteMany({}); await automationRuns.deleteMany({}); });

  it('lists only the owner\'s automations, plus integration actions / accounts / ekoa actions from the seam', async () => {
    const catalog = await buildAutomationCatalog('u1', false);

    expect(catalog.automations.map((a) => a.id)).toEqual(['auto-u1']); // owner-scoped: u2's is hidden
    expect(catalog.automations[0]!.name).toBe('Enviar relatório');
    expect(catalog.integrationActions).toEqual([
      expect.objectContaining({ integrationKey: 'slack', actionName: 'post_message', mutates: true }),
    ]);
    expect(catalog.connectedAccounts).toEqual([{ integrationKey: 'google-workspace', email: 'me@example.com' }]);
    expect(catalog.ekoaActions).toEqual([
      expect.objectContaining({ artifactSlug: 'crm', capabilityName: 'add_client' }),
    ]);
  });

  it('formats the catalog for the planner prompt, including the PT-PT triggered-automation lines', async () => {
    const catalog = await buildAutomationCatalog('u1', false);
    const text = formatCatalogForPrompt(catalog);

    expect(text).toContain('Enviar relatório');
    expect(text).toContain('executa-se automaticamente quando invoice.paid chega de stripe');
    expect(text).toContain('slack.post_message');
    expect(text).toContain('me@example.com');
    expect(text).toContain('crm.add_client');
    // The standing PT-PT note that triggered automations must not be invoked directly.
    expect(text).toContain('Automações com gatilho executam-se sozinhas');
  });

  it('an empty catalog formats to an empty string', () => {
    const text = formatCatalogForPrompt({ automations: [], integrationActions: [], connectedAccounts: [], ekoaActions: [] });
    expect(text).toBe('');
  });
});
