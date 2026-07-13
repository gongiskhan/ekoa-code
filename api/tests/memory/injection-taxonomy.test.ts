import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { memories } from '../../src/data/stores.js';
import { resolveMemoryInjection } from '../../src/memory/resolver.js';

/**
 * S5 re-review findings 3 + 5 — one bug, one taxonomy (`resolveMemoryInjection`'s buckets did not
 * match what the product writes and reads):
 *
 *  - A GUARDRAIL created through the dashboard is `{ type:'preference', tier:'core',
 *    tags:['guardrail'] }`, and the guardrails panel lists it by that tag. The resolver matched
 *    only `type === 'guardrail' || tier === 'guardrail'`, so it injected the rule as an ordinary
 *    `- title: content` bullet. The user saw it listed under "Guardrails" and believed it was
 *    enforced as a non-negotiable RULE line. It was not.
 *  - An ARCHIVED memory is hidden in the dashboard but was still scored and injected, so archiving
 *    never stopped it steering the model.
 */
let mem: MongoMemoryServer;
const deps = { now: () => 1_700_000_000_000, genId: () => 'id' };
const actor = { userId: 'u1', orgId: 'orgA', role: 'user' as const };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_injection_taxonomy');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { await memories.deleteMany({}); });

const seed = (doc: Record<string, unknown>) =>
  memories.insert({ orgId: 'orgA', userId: 'u1', visibility: 'private', createdAt: 'x', updatedAt: 'x', ...doc } as never);

describe('resolveMemoryInjection taxonomy', () => {
  it('a dashboard-created guardrail (tags:[guardrail]) is injected as a RULE line, not a bullet', async () => {
    await seed({ _id: 'g1', type: 'preference', tier: 'core', tags: ['guardrail'], title: 'Sem jQuery', content: 'Nunca usar jQuery.' });
    const block = await resolveMemoryInjection(actor, 'como faço um botão', deps);
    expect(block).toContain('RULE: Nunca usar jQuery.');
    expect(block).not.toContain('- Sem jQuery: Nunca usar jQuery.');
  });

  it('the legacy guardrail shapes (type or tier) still render as RULE lines', async () => {
    await seed({ _id: 'g2', type: 'guardrail', tier: 'core', content: 'Regra A.' });
    await seed({ _id: 'g3', type: 'fact', tier: 'guardrail', content: 'Regra B.' });
    const block = await resolveMemoryInjection(actor, 'qualquer coisa', deps);
    expect(block).toContain('RULE: Regra A.');
    expect(block).toContain('RULE: Regra B.');
  });

  it('an ARCHIVED memory is never injected — archiving stops it steering the model', async () => {
    await seed({ _id: 'a1', type: 'fact', tier: 'archive', title: 'Antigo', content: 'jQuery é bom.', tags: ['jquery'] });
    await seed({ _id: 'a2', type: 'fact', tier: 'active', title: 'Atual', content: 'React é a escolha.', tags: ['react'] });
    // query overlaps BOTH memories' terms, so only the tier decides
    const block = await resolveMemoryInjection(actor, 'jquery react', deps);
    expect(block).not.toContain('jQuery é bom.');
    expect(block).toContain('React é a escolha.');
  });

  it('an archived memory that is ALSO tagged guardrail stays excluded (archive wins)', async () => {
    await seed({ _id: 'a3', type: 'preference', tier: 'archive', tags: ['guardrail'], content: 'Regra revogada.' });
    const block = await resolveMemoryInjection(actor, 'qualquer', deps);
    expect(block).not.toContain('Regra revogada.');
  });
});
