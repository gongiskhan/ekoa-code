import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { memories } from '../../src/data/stores.js';
import { assembleRunContext } from '../../src/agents/context.js';
import { __resetAgentSeamsForTests } from '../../src/agents/seams.js';

/**
 * Chat brand-identity (batch-final follow-up). Without a persona the model defaults to its
 * built-in "I'm Claude, made by Anthropic" identity, which the web treated as a provider leak and
 * replaced the whole reply with a generic "temporarily unavailable" error. The chat system prompt
 * now leads with the EKOA persona so the model presents as the EKOA Agent and does not reveal the
 * engine. Builds carry their own workspace instruction, so this is chat-only.
 */
let mem: MongoMemoryServer;
const actor = { userId: 'u1', orgId: 'orgA', role: 'builder' as const };
const base = { groundKnowledge: false, now: () => 1_700_000_000_000 };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_chat_identity');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { __resetAgentSeamsForTests(); await memories.deleteMany({}); });

describe('chat agent brand identity (EKOA white-label)', () => {
  it('a CHAT run leads its system prompt with the EKOA persona + do-not-reveal-engine instruction', async () => {
    const ctx = await assembleRunContext({ ...base, actor, agentKind: 'chat', isChat: true, query: 'quem és tu?' });
    expect(ctx.systemPrompt).toContain('Agente EKOA');
    expect(ctx.systemPrompt.toLowerCase()).toContain('não reveles');
    // the persona leads the prompt (before any content/memory/knowledge layer)
    expect(ctx.systemPrompt.startsWith('És o Agente EKOA')).toBe(true);
  });

  it('a non-chat (build/coding) run does NOT carry the chat persona (builds have their own instruction)', async () => {
    const ctx = await assembleRunContext({ ...base, actor, agentKind: 'coding', isChat: false, query: 'build a crm' });
    expect(ctx.systemPrompt).not.toContain('Agente EKOA');
  });
});
