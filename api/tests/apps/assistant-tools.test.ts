import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { activityLogs, type ActivityLogDoc } from '../../src/data/stores.js';
import { assistantToolsFromManifest, toolNameForAction, auditAssistantAction } from '../../src/apps/assistant-tools.js';
import type { AppActionManifest } from '@ekoa/shared';

/** operator-run C4 — manifest -> assistant tool defs + the single-audit-path helper. */

/** auditAssistantAction is best-effort (void, fire-and-forget); poll the store
 *  until the expected number of rows lands rather than racing a fixed sleep. */
async function waitForRows(min: number): Promise<ActivityLogDoc[]> {
  for (let i = 0; i < 50; i++) {
    const rows = (await activityLogs.find({ category: 'app-assistant' })) as ActivityLogDoc[];
    if (rows.length >= min) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return (await activityLogs.find({ category: 'app-assistant' })) as ActivityLogDoc[];
}

const manifest: AppActionManifest = {
  version: 1,
  actions: [
    { id: 'ir-clientes', kind: 'navigate', labelPt: 'Ver clientes', description: 'Abre a lista de clientes', route: '/clientes', params: [], destructive: false },
    {
      id: 'definir-escalao', kind: 'select', labelPt: 'Definir escalão', description: 'Escolhe o escalão de honorários',
      target: 'escalao',
      params: [
        { name: 'valor', type: 'option', required: true, options: ['A', 'B', 'C'], labelPt: 'Escalão' },
        { name: 'nota', type: 'string', required: false },
      ],
      destructive: false,
    },
    { id: 'apagar-cliente', kind: 'custom', labelPt: 'Apagar cliente', description: 'Remove o cliente', params: [], destructive: true },
  ],
};

describe('assistantToolsFromManifest (C4)', () => {
  it('absent/empty manifest -> no tools', () => {
    expect(assistantToolsFromManifest(null)).toEqual([]);
    expect(assistantToolsFromManifest({ version: 1, actions: [] })).toEqual([]);
  });

  it('one namespaced tool per action, JSON-schema input derived from params', () => {
    const tools = assistantToolsFromManifest(manifest);
    expect(tools.map((t) => t.name)).toEqual(['app_action__ir_clientes', 'app_action__definir_escalao', 'app_action__apagar_cliente']);

    const sel = tools[1]!;
    expect(sel.description).toBe('Escolhe o escalão de honorários');
    expect(sel.inputSchema.additionalProperties).toBe(false);
    expect(sel.inputSchema.required).toEqual(['valor']); // only required params
    expect((sel.inputSchema.properties.valor as { type: string; enum: string[]; description: string })).toEqual({ type: 'string', enum: ['A', 'B', 'C'], description: 'Escalão' });
    expect((sel.inputSchema.properties.nota as { type: string })).toEqual({ type: 'string' });

    expect(tools[2]!.destructive).toBe(true); // destructive flag travels to D1/client
    expect(tools[0]!.action.route).toBe('/clientes'); // full action forwarded verbatim
  });

  it('toolNameForAction is a stable kebab->snake namespaced name', () => {
    expect(toolNameForAction(manifest.actions[0]!)).toBe('app_action__ir_clientes');
  });
});

describe('auditAssistantAction (C4)', () => {
  let mem: MongoMemoryServer;
  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_assistant_tools');
  }, 60_000);
  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  it('writes exactly one row through the single audit path with ids-only metadata (no prompt text)', async () => {
    let seq = 0;
    const deps = { now: () => 1_000, genId: () => `act_${seq++}` };
    auditAssistantAction(
      { userId: 'u1', username: 'ana', orgId: 'org-1' },
      { artifactId: 'art-1', actionId: 'apagar-cliente', kind: 'custom', destructive: true, confirmed: true, outcome: 'dispatched', runId: 'run-1' },
      deps,
    );
    const rows = await waitForRows(1);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.type).toBe('action.dispatched');
    expect(row.userId).toBe('u1');
    expect(row.orgId).toBe('org-1');
    expect(row.metadata).toEqual({ artifactId: 'art-1', actionId: 'apagar-cliente', kind: 'custom', destructive: true, confirmed: true, runId: 'run-1' });
    // ids + typed shape only — no free text / prompt fields leaked into the audit row.
    expect(Object.keys(row.metadata as object).sort()).toEqual(['actionId', 'artifactId', 'confirmed', 'destructive', 'kind', 'runId']);
  });

  it('outcome variants map to distinct types and never throw', async () => {
    let seq = 100;
    const deps = { now: () => 2_000, genId: () => `act_${seq++}` };
    for (const outcome of ['confirm-pending', 'cancelled', 'failed'] as const) {
      auditAssistantAction(
        { userId: 'u1', username: 'ana', orgId: 'org-1' },
        { artifactId: 'art-2', actionId: 'x', kind: 'navigate', destructive: false, confirmed: false, outcome },
        deps,
      );
    }
    const rows = await waitForRows(4); // 1 from the prior test + 3 here
    const types = rows.map((r) => r.type).sort();
    expect(types).toContain('action.confirm-pending');
    expect(types).toContain('action.cancelled');
    expect(types).toContain('action.failed');
  });
});
