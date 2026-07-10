import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { memories } from '../../src/data/stores.js';
import { assembleRunContext } from '../../src/agents/context.js';
import { __resetAgentSeamsForTests } from '../../src/agents/seams.js';

/**
 * F21 backfill (batch-final s0-reconcile) — the recall WIRING, not the resolver mechanism.
 * `resolveMemoryInjection`'s taxonomy is covered by injection-taxonomy.test.ts; what no test
 * asserted is that a stored memory actually reaches the assembled run context a chat turn is
 * built from (ch05 §5.5.2 layer 1: agents/context.ts -> memory/resolver.ts). This drives
 * `assembleRunContext` exactly as agents/chat.ts does (isChat:true, optOutMemory unset) and
 * asserts the memory demonstrably shapes the system prompt.
 */
let mem: MongoMemoryServer;
const actor = { userId: 'u1', orgId: 'orgA', role: 'builder' as const };
const base = { agentKind: 'chat' as const, isChat: true, groundKnowledge: false, now: () => 1_700_000_000_000 };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_recall_wiring');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { __resetAgentSeamsForTests(); await memories.deleteMany({}); });

const seed = (doc: Record<string, unknown>) =>
  memories.insert({ orgId: 'orgA', userId: 'u1', visibility: 'private', createdAt: 'x', updatedAt: 'x', ...doc } as never);

describe('memory recall wiring (F21): stored memory -> assembled chat context', () => {
  it('a stored memory with term overlap lands in the assembled system prompt under # Memória', async () => {
    await seed({ _id: 'm1', type: 'preference', tier: 'active', title: 'Tratamento', content: 'O utilizador prefere ser tratado por Dr. Silva.', tags: ['tratamento'] });
    const ctx = await assembleRunContext({ ...base, actor, query: 'como devo continuar o tratamento do processo silva' });
    expect(ctx.systemPrompt).toContain('# Memória');
    expect(ctx.systemPrompt).toContain('Dr. Silva');
  });

  it('a guardrail memory reaches the context as a non-negotiable RULE line', async () => {
    await seed({ _id: 'g1', type: 'preference', tier: 'core', tags: ['guardrail'], title: 'Sem jQuery', content: 'Nunca usar jQuery.' });
    const ctx = await assembleRunContext({ ...base, actor, query: 'faz um botão' });
    expect(ctx.systemPrompt).toContain('RULE: Nunca usar jQuery.');
  });

  it('optOutMemory keeps the memory OUT of the assembled context', async () => {
    await seed({ _id: 'm2', type: 'fact', tier: 'core', title: 'Segredo', content: 'Conteúdo que não deve entrar.' });
    const ctx = await assembleRunContext({ ...base, actor, query: 'qualquer coisa', optOutMemory: true });
    expect(ctx.systemPrompt).not.toContain('Conteúdo que não deve entrar.');
    expect(ctx.systemPrompt).not.toContain('# Memória');
  });

  it('another user\'s PRIVATE memory never reaches this actor\'s context (tenant scoping holds through the wiring)', async () => {
    await memories.insert({ _id: 'p1', orgId: 'orgA', userId: 'u2', visibility: 'private', tier: 'core', title: 'Privado', content: 'Facto privado de u2.', createdAt: 'x', updatedAt: 'x' } as never);
    const ctx = await assembleRunContext({ ...base, actor, query: 'facto privado' });
    expect(ctx.systemPrompt).not.toContain('Facto privado de u2.');
  });
});
