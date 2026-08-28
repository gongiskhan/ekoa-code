import { describe, it, expect, afterEach } from 'vitest';
import { catalogToolSpecs } from '../../src/agents/sdk-tools.js';
import { CATALOG_TOOLS } from '../../src/agents/tools.js';
import {
  setCatalogToolList,
  setCallIntegrationActionTool,
  setCallEkoaActionTool,
  setStartAutomationTool,
  __resetAgentSeamsForTests,
  type CatalogToolActor,
  type CatalogToolListing,
} from '../../src/agents/seams.js';

/**
 * The six cross-agent catalog tools (K5, D-CORNERSTONE-DOORS). The layer-4 catalog prompt
 * (automation/catalog.ts) has named all six to the model since it shipped; these are the tools.
 *
 * Two properties carry the suite. First, IDENTITY: every handler runs under the actor bound at
 * spec-build time, so an argument naming another user or org changes nothing - the same
 * construction the knowledge tools use for `orgId` (ch04 §4.4.1; ch09). Second, the coded
 * outcomes that mean "a human must act" (`awaiting_consent`, `needs_credentials`) must reach the
 * model as exactly that, never as a failure it should retry.
 */

const actor = { userId: 'u1', orgId: 'org-A' };

const emptyListing = (): CatalogToolListing => ({ automations: [], integrationActions: [], ekoaActions: [] });

/** Spec lookup by §5.4.4-canonical name (the chokepoint translates to MCP wire names). */
function spec(name: string) {
  const found = catalogToolSpecs(actor).find((s) => s.name === name);
  if (!found) throw new Error(`no spec named ${name}`);
  return found;
}

afterEach(() => __resetAgentSeamsForTests());

describe('catalogToolSpecs - mounting', () => {
  it('declares exactly the six catalog tools, in policy order', () => {
    expect(catalogToolSpecs(actor).map((s) => s.name)).toEqual([...CATALOG_TOOLS]);
  });

  it('every spec carries a description and an input schema (the SDK needs both to register it)', () => {
    for (const s of catalogToolSpecs(actor)) {
      expect(s.description.length).toBeGreaterThan(20);
      expect(Object.keys(s.inputSchema).length).toBeGreaterThan(0);
    }
  });
});

describe('the three list_* tools', () => {
  const listing = (): CatalogToolListing => ({
    automations: [
      { id: 'a1', name: 'Relatório semanal', description: 'Envia o relatório', inputs: [{ name: 'mes', required: true, description: '' }] },
      {
        id: 'a2',
        name: 'Recibo Citius',
        description: 'Descarrega recibos',
        inputs: [],
        trigger: { kind: 'webhook', integrationKey: 'citius', eventName: 'nova-notificacao' },
      },
    ],
    integrationActions: [
      { integrationKey: 'slack', actionName: 'post_message', description: 'Publica uma mensagem', argsSummary: 'channel, text', mutates: true },
      { integrationKey: 'citius', actionName: 'list_cases', description: 'Lista processos', argsSummary: '', mutates: false },
    ],
    ekoaActions: [
      { artifactSlug: 'gestor', artifactName: 'Gestor de Casos', capabilityName: 'criar_caso', description: 'Cria um caso', argsSummary: 'titulo', mutates: true },
    ],
  });

  it('list_automations renders id, description and inputs, and MARKS a triggered automation', async () => {
    setCatalogToolList(async () => listing());
    const text = await spec('list_automations').handler({});
    expect(text).toContain('- Relatório semanal (id: a1): Envia o relatório [entradas: mes*]');
    // A triggered automation runs itself; the agent must be able to see that before invoking it.
    expect(text).toContain('[gatilho webhook: citius/nova-notificacao - corre sozinha]');
  });

  it('list_integration_actions marks writes and renders the args summary', async () => {
    setCatalogToolList(async () => listing());
    const text = await spec('list_integration_actions').handler({});
    expect(text).toContain('- slack.post_message(channel, text): Publica uma mensagem [escrita]');
    expect(text).toContain('- citius.list_cases(): Lista processos');
    expect(text).not.toContain('list_cases(): Lista processos [escrita]');
  });

  it('list_ekoa_actions renders slug.capability plus the owning app', async () => {
    setCatalogToolList(async () => listing());
    const text = await spec('list_ekoa_actions').handler({});
    expect(text).toContain('- gestor.criar_caso(titulo): Cria um caso [app: Gestor de Casos]');
  });

  it('query filters, accent- and case-insensitively', async () => {
    setCatalogToolList(async () => listing());
    const text = await spec('list_automations').handler({ query: 'relatorio' }); // no accent, lowercase
    expect(text).toContain('Relatório semanal');
    expect(text).not.toContain('Recibo Citius');
  });

  it('distinguishes "nothing matched" from "you have none" - neither invents rows', async () => {
    setCatalogToolList(async () => listing());
    expect(await spec('list_automations').handler({ query: 'zzz' })).toBe('Nada em sequências corresponde a "zzz".');
    setCatalogToolList(async () => emptyListing());
    expect(await spec('list_automations').handler({})).toBe('Não há sequências disponíveis para este utilizador.');
  });

  it('caps a long listing and says how many it withheld', async () => {
    setCatalogToolList(async () => ({
      ...emptyListing(),
      integrationActions: Array.from({ length: 55 }, (_, i) => ({
        integrationKey: 'k',
        actionName: `a${i}`,
        description: 'd',
        argsSummary: '',
        mutates: false,
      })),
    }));
    const text = await spec('list_integration_actions').handler({});
    expect(text).toContain('Ações de integração (55, a mostrar 40):');
    expect(text).toContain('… e mais 15.');
    expect(text).not.toContain('a40(');
  });

  it('the listing seam is asked under the BOUND actor - an identity argument never wins', async () => {
    const seen: CatalogToolActor[] = [];
    setCatalogToolList(async (a) => {
      seen.push(a);
      return emptyListing();
    });
    for (const name of ['list_automations', 'list_integration_actions', 'list_ekoa_actions']) {
      await spec(name).handler({ query: 'x', userId: 'u2', orgId: 'org-B', ownerUserId: 'u2' });
    }
    expect(seen).toEqual([actor, actor, actor]);
  });
});

describe('call_integration_action', () => {
  it('returns the result data as compact JSON on success', async () => {
    setCallIntegrationActionTool(async () => ({ success: true, data: { ok: true, sent: 2 } }));
    const text = await spec('call_integration_action').handler({ integrationKey: 'slack', actionName: 'post_message' });
    expect(text).toContain('Ação slack.post_message executada.');
    expect(text).toContain('{"ok":true,"sent":2}');
  });

  it('truncates a huge result rather than flooding the turn - and SAYS it truncated', async () => {
    setCallIntegrationActionTool(async () => ({ success: true, data: { blob: 'x'.repeat(20_000) } }));
    const text = await spec('call_integration_action').handler({ integrationKey: 'k', actionName: 'a' });
    expect(text).toContain('(resultado truncado)');
    expect(text.length).toBeLessThan(4500);
  });

  it('awaiting_consent tells the model the OWNER must approve it, and not to retry yet', async () => {
    setCallIntegrationActionTool(async () => ({
      success: false,
      code: 'awaiting_consent',
      error: 'action "post_message" on slack writes (chat.postMessage) and needs the owner\'s approval',
    }));
    const text = await spec('call_integration_action').handler({ integrationKey: 'slack', actionName: 'post_message' });
    expect(text).toContain('precisa da aprovação do dono');
    expect(text).toContain('NÃO foi executada');
    expect(text).toContain('Integrações → slack');
  });

  it('needs_credentials reads as a HALT awaiting a ceremony, not as a failure', async () => {
    setCallIntegrationActionTool(async () => ({ success: false, code: 'needs_credentials', error: 'run parked' }));
    const text = await spec('call_integration_action').handler({ integrationKey: 'citius', actionName: 'list_cases' });
    expect(text).toContain('EM ESPERA');
    expect(text).toContain('cerimónia de credenciais');
    expect(text).toContain('Nada falhou');
  });

  it('any other coded refusal surfaces the code and message verbatim', async () => {
    setCallIntegrationActionTool(async () => ({ success: false, code: 'not_connected', error: 'integration slack is not connected for this user' }));
    const text = await spec('call_integration_action').handler({ integrationKey: 'slack', actionName: 'post_message' });
    expect(text).toContain('(not_connected)');
    expect(text).toContain('is not connected for this user');
  });

  it('runs under the BOUND actor - an orgId/ownerUserId argument is not read', async () => {
    const seen: Array<{ actor: CatalogToolActor; input: unknown }> = [];
    setCallIntegrationActionTool(async (a, input) => {
      seen.push({ actor: a, input });
      return { success: true, data: null };
    });
    await spec('call_integration_action').handler({
      integrationKey: 'slack',
      actionName: 'post_message',
      args: { channel: '#geral' },
      orgId: 'org-B',
      ownerUserId: 'u2',
      userId: 'u2',
    });
    expect(seen[0]!.actor).toEqual(actor);
    expect(seen[0]!.input).toEqual({ integrationKey: 'slack', actionName: 'post_message', args: { channel: '#geral' } });
  });

  it('a non-object args argument degrades to an empty bag rather than crashing the turn', async () => {
    const seen: Array<Record<string, unknown>> = [];
    setCallIntegrationActionTool(async (_a, input) => {
      seen.push(input.args);
      return { success: true, data: null };
    });
    await spec('call_integration_action').handler({ integrationKey: 'k', actionName: 'a', args: 'not-an-object' });
    expect(seen).toEqual([{}]);
  });

  it('an unwired root refuses honestly - it never reports an action as run', async () => {
    const text = await spec('call_integration_action').handler({ integrationKey: 'slack', actionName: 'post_message' });
    expect(text).toContain('falhou (unavailable)');
    expect(text).not.toContain('executada');
  });
});

describe('call_automation', () => {
  it('returns the runId and tells the model NOT to wait for the result', async () => {
    setStartAutomationTool(async () => ({ success: true, runId: 'run-9' }));
    const text = await spec('call_automation').handler({ automationId: 'a1' });
    expect(text).toContain('execução run-9');
    expect(text).toContain('não esperes por ela nesta resposta');
  });

  it('passes declared inputs through and binds the actor', async () => {
    const seen: Array<{ actor: CatalogToolActor; input: unknown }> = [];
    setStartAutomationTool(async (a, input) => {
      seen.push({ actor: a, input });
      return { success: true, runId: 'run-1' };
    });
    await spec('call_automation').handler({ automationId: 'a1', inputs: { mes: '08' }, ownerUserId: 'u2', orgId: 'org-B' });
    expect(seen[0]!.actor).toEqual(actor);
    expect(seen[0]!.input).toEqual({ automationId: 'a1', inputs: { mes: '08' } });
  });

  it('a refused start surfaces the service code - and claims no run', async () => {
    setStartAutomationTool(async () => ({ success: false, code: 'FORBIDDEN', error: 'not authorized to run this automation' }));
    const text = await spec('call_automation').handler({ automationId: 'a-other' });
    expect(text).toContain('Não foi possível iniciar a sequência a-other (FORBIDDEN)');
    expect(text).not.toContain('iniciada');
  });
});

describe('call_ekoa_action', () => {
  it('returns the captured recipe output as compact JSON', async () => {
    setCallEkoaActionTool(async () => ({ success: true, data: { caso: { id: 'c1' } } }));
    const text = await spec('call_ekoa_action').handler({ artifactSlug: 'gestor', capabilityName: 'criar_caso' });
    expect(text).toContain('Ação Ekoa gestor.criar_caso executada.');
    expect(text).toContain('{"caso":{"id":"c1"}}');
  });

  it('an unresolvable artifact is an honest coded refusal', async () => {
    setCallEkoaActionTool(async () => ({ success: false, code: 'unknown_artifact', error: 'artifact "outro" not found' }));
    const text = await spec('call_ekoa_action').handler({ artifactSlug: 'outro', capabilityName: 'x' });
    expect(text).toContain('falhou (unknown_artifact)');
  });

  it('runs under the BOUND actor - a slug cannot be paired with another org', async () => {
    const seen: Array<{ actor: CatalogToolActor; input: unknown }> = [];
    setCallEkoaActionTool(async (a, input) => {
      seen.push({ actor: a, input });
      return { success: true, data: {} };
    });
    await spec('call_ekoa_action').handler({
      artifactSlug: 'gestor',
      capabilityName: 'criar_caso',
      args: { titulo: 't' },
      orgId: 'org-B',
    });
    expect(seen[0]!.actor).toEqual(actor);
    expect(seen[0]!.input).toEqual({ artifactSlug: 'gestor', capabilityName: 'criar_caso', args: { titulo: 't' } });
  });
});
