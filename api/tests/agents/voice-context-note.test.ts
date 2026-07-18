import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { memories } from '../../src/data/stores.js';
import { assembleRunContext, voiceContextNote } from '../../src/agents/context.js';
import { __resetAgentSeamsForTests } from '../../src/agents/seams.js';

/**
 * C5 (mega-run 20260717-190134, BRIEF §5): the voice-modality context note. When a turn is
 * voice-sourced (voiceActive), the system prompt carries a note - replies read aloud, natural
 * spoken prose, visual artifacts NAMED not read - and per the BRIEF it must NOT instruct
 * shorter replies or reduced thinking. Absent by default. The client->api signal lands at C7
 * (the documented seam on StartChatRunInput.source); the note + assembly wiring are proven
 * here through the real assembleRunContext.
 */
let mem: MongoMemoryServer;
const actor = { userId: 'u-voice', orgId: 'orgV', role: 'user' as const };
const base = { groundKnowledge: false, now: () => 1_700_000_000_000 };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_voice_context_note');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { __resetAgentSeamsForTests(); await memories.deleteMany({}); });

describe('voiceContextNote (the note itself)', () => {
  it('is PT-PT prose covering read-aloud, spoken style and naming visual artifacts', () => {
    const note = voiceContextNote();
    expect(note).toContain('lidas em voz alta');
    expect(note).toContain('prosa natural');
    expect(note).toContain('sem tabelas');
    expect(note).toContain('blocos de código');
    // Visual artifacts are NAMED, never read.
    expect(note).toContain('não o leias');
    expect(note).toContain('o que foi produzido');
  });

  it('explicitly preserves full reasoning and detail (never shortens replies - BRIEF §5)', () => {
    const note = voiceContextNote();
    expect(note).toContain('raciocínio completo');
    expect(note).toContain('detalhe habitual');
    // Guard against a future edit sneaking in a brevity instruction.
    expect(note.toLowerCase()).not.toMatch(/\b(curta|curtas|breve|breves|resum[ei])\b/);
  });
});

describe('assembleRunContext voiceActive wiring', () => {
  it('a voice-sourced CHAT turn carries the note right after the EKOA identity', async () => {
    const ctx = await assembleRunContext({
      ...base, actor, agentKind: 'chat', isChat: true, voiceActive: true, query: 'qual é o prazo?',
    });
    expect(ctx.systemPrompt).toContain('Sessão de voz ativa');
    // Identity still leads; the note follows it (output shaping ahead of the content layers).
    expect(ctx.systemPrompt.startsWith('És o Agente EKOA')).toBe(true);
    expect(ctx.systemPrompt.indexOf('Sessão de voz ativa')).toBeGreaterThan(ctx.systemPrompt.indexOf('Agente EKOA'));
  });

  it('a non-voice turn carries NO note (default off)', async () => {
    const ctx = await assembleRunContext({
      ...base, actor, agentKind: 'chat', isChat: true, query: 'qual é o prazo?',
    });
    expect(ctx.systemPrompt).not.toContain('Sessão de voz ativa');
  });

  it('voiceActive works for non-chat assembly too (leads the sections)', async () => {
    const ctx = await assembleRunContext({
      ...base, actor, agentKind: 'coding', isChat: false, voiceActive: true, query: 'gera o documento',
    });
    expect(ctx.systemPrompt).toContain('Sessão de voz ativa');
  });
});
