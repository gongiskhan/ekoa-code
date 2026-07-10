import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runAgent, decideForTier } from '../../src/llm/index.js';
import { classifyAssistantContent, __setTransportForTests, type ChokepointTransport, type AgentStreamMsg } from '../../src/llm/client.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from '../agents/_setup.js';

/**
 * Thinking classification at the chokepoint (§5.7.1 extension). The SDK only continues past a
 * turn through tool use, so: text sharing an assistant message with tool_use is working
 * commentary ("thinking"), the toolless final turn's text is the answer, and real extended-
 * thinking blocks are commentary too (previously dropped). runAgent carries the two channels
 * separately: `text` events + result.text for the answer, `thinking` events + result.thinkingText
 * for commentary — commentary never contaminates the answer accumulation (F20 semantics kept).
 */
type SdkMsg = Parameters<typeof classifyAssistantContent>[0];
const assistantMsg = (content: unknown): SdkMsg =>
  ({ type: 'assistant', message: { content } }) as unknown as SdkMsg;

describe('classifyAssistantContent (pure)', () => {
  it('a toolless turn: text is the answer, thinking blocks are commentary', () => {
    const { answer, thinking } = classifyAssistantContent(assistantMsg([
      { type: 'thinking', thinking: 'devo responder como EKOA. ' },
      { type: 'text', text: 'Sou o Agente EKOA.' },
    ]));
    expect(answer).toBe('Sou o Agente EKOA.');
    expect(thinking).toBe('devo responder como EKOA. ');
  });

  it('a turn carrying tool_use: its text is commentary, never answer', () => {
    const { answer, thinking } = classifyAssistantContent(assistantMsg([
      { type: 'text', text: 'Vou consultar a base de conhecimento. ' },
      { type: 'tool_use', name: 'knowledge_search', id: 't1', input: { q: 'modelo' } },
    ]));
    expect(answer).toBe('');
    expect(thinking).toBe('Vou consultar a base de conhecimento. ');
  });

  it('thinking + text + tool_use in one turn: everything textual is commentary', () => {
    const { answer, thinking } = classifyAssistantContent(assistantMsg([
      { type: 'thinking', thinking: 'hmm. ' },
      { type: 'text', text: 'a verificar… ' },
      { type: 'tool_use', name: 'knowledge_read', id: 't2', input: {} },
    ]));
    expect(answer).toBe('');
    expect(thinking).toBe('hmm. a verificar… ');
  });

  it('redacted_thinking blocks are dropped; string content is the answer; non-assistant is empty', () => {
    expect(classifyAssistantContent(assistantMsg([{ type: 'redacted_thinking', data: 'x' }]))).toEqual({ answer: '', thinking: '' });
    expect(classifyAssistantContent(assistantMsg('texto simples'))).toEqual({ answer: 'texto simples', thinking: '' });
    expect(classifyAssistantContent({ type: 'result' } as unknown as SdkMsg)).toEqual({ answer: '', thinking: '' });
  });
});

describe('runAgent carries the two channels separately', () => {
  beforeAll(() => bootAgentTestDb('ekoa_thinking_channel'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(() => restoreTransport());

  it('thinking events never enter result.text; both channels stream in order', async () => {
    resetAgentState(); // resets seams/vault/config, installs a fake we immediately replace
    const script: AgentStreamMsg[] = [
      { kind: 'thinking', text: 'sou o Claude Sonnet a pensar… ' },
      { kind: 'text', text: 'A resposta.' },
      { kind: 'thinking', text: 'mais um passo.' },
      { kind: 'final', text: 'A resposta.', usage: { input: 5, output: 3, cacheCreate: 0, cacheRead: 0 } },
    ];
    const transport: ChokepointTransport = {
      async *streamAgent() { for (const m of script) yield m; },
      async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
      async messages() { return { status: 200, headers: {}, body: '{}' }; },
    };
    __setTransportForTests(transport);

    const handle = runAgent(
      { prompt: 'que modelo és?', decision: decideForTier('WORKHORSE') },
      { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' },
    );
    const seen: Array<{ type: string; text: string }> = [];
    for await (const ev of handle.events) seen.push(ev);
    const result = await handle.result;

    expect(seen.map((e) => e.type)).toEqual(['thinking', 'text', 'thinking']);
    expect(result.text).toBe('A resposta.');
    expect(result.thinkingText).toBe('sou o Claude Sonnet a pensar… mais um passo.');
  });
});
