import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * B7 live streaming at the chokepoint transport (`includePartialMessages`). Without partials the
 * Agent SDK yields only WHOLE assistant messages, so a long single-turn answer reached the wire
 * as one chunk right before `complete` and the client's streaming affordances (the B5
 * summary-card-streaming placeholder) never rendered — found live by web/e2e/part-b-proof.spec.ts
 * step 2. The transport now streams `text_delta`/`thinking_delta` events live and keeps the F20
 * answer contract via retraction (`text_reset`) + whole-message remainder dedupe:
 *   - deltas of a message that turns out to carry tool_use were narration → `text_reset`
 *     retracts them; classification still delivers them on the thinking channel;
 *   - the whole-message pass emits only what the deltas did not already cover — the yielded
 *     `text` stream since the last reset always concatenates to EXACTLY the classified answer.
 * The SDK is mocked; the REAL default transport runs. runAgent's consumer half (raw-text reset +
 * fresh detokenizer + event forwarding) is covered against the fake-transport seam.
 */

const sdkScript = vi.hoisted(() => ({
  messages: [] as unknown[],
  lastOptions: null as Record<string, unknown> | null,
}));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { options?: Record<string, unknown> }) => {
    sdkScript.lastOptions = args.options ?? null;
    return (async function* () {
      for (const m of sdkScript.messages) yield m;
    })();
  },
  createSdkMcpServer: () => ({}),
  tool: () => ({}),
}));

import { runAgent, decideForTier } from '../../src/llm/index.js';
import {
  __defaultTransportForTests,
  __setTransportForTests,
  type AgentStreamMsg,
  type ChokepointTransport,
  type SdkCallParams,
} from '../../src/llm/client.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from '../agents/_setup.js';

const P: SdkCallParams = { prompt: 'pergunta', model: 'm', effort: 'medium', env: {} };

const streamEv = (event: unknown, parent: string | null = null): unknown => ({
  type: 'stream_event', event, parent_tool_use_id: parent, uuid: 'u1', session_id: 'sdk-s1',
});
const msgStart = (): unknown => streamEv({ type: 'message_start', message: {} });
const blockStart = (type: string, parent: string | null = null): unknown =>
  streamEv({ type: 'content_block_start', index: 0, content_block: { type } }, parent);
const textDelta = (text: string, parent: string | null = null): unknown =>
  streamEv({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent);
const thinkDelta = (thinking: string): unknown =>
  streamEv({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } });
const assistant = (content: unknown[]): unknown => ({
  type: 'assistant', message: { content, usage: { input_tokens: 2, output_tokens: 2 } }, session_id: 'sdk-s1',
});
const resultMsg = (result: string): unknown => ({
  type: 'result', subtype: 'success', result, usage: { input_tokens: 2, output_tokens: 2 },
});

async function drive(messages: unknown[]): Promise<AgentStreamMsg[]> {
  sdkScript.messages = messages;
  const out: AgentStreamMsg[] = [];
  for await (const ev of __defaultTransportForTests().streamAgent(P)) out.push(ev);
  return out;
}
const answerOf = (evs: AgentStreamMsg[]): string => {
  let acc = '';
  for (const e of evs) {
    if (e.kind === 'text') acc += e.text;
    else if (e.kind === 'text_reset') acc = '';
  }
  return acc;
};
const finalOf = (evs: AgentStreamMsg[]): { text: string } =>
  evs.find((e) => e.kind === 'final') as { text: string };

describe('default transport: live partial deltas (B7)', () => {
  it('passes includePartialMessages to the SDK query', async () => {
    await drive([resultMsg('x')]);
    expect(sdkScript.lastOptions?.includePartialMessages).toBe(true);
  });

  it('streams text deltas LIVE and does not re-emit them at whole-message time', async () => {
    const evs = await drive([
      msgStart(),
      blockStart('text'),
      textDelta('Olá '),
      textDelta('mundo.'),
      assistant([{ type: 'text', text: 'Olá mundo.' }]),
      resultMsg('Olá mundo.'),
    ]);
    const textEvents = evs.filter((e) => e.kind === 'text');
    // Two live deltas, no whole-message duplicate — the joined stream IS the answer, once.
    expect(textEvents.map((e) => e.text)).toEqual(['Olá ', 'mundo.']);
    expect(answerOf(evs)).toBe('Olá mundo.');
    expect(finalOf(evs).text).toBe('Olá mundo.');
  });

  it('emits only the unstreamed remainder when deltas covered a prefix', async () => {
    const evs = await drive([
      msgStart(),
      blockStart('text'),
      textDelta('Olá '),
      assistant([{ type: 'text', text: 'Olá mundo.' }]),
      resultMsg('Olá mundo.'),
    ]);
    expect(evs.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual(['Olá ', 'mundo.']);
    expect(answerOf(evs)).toBe('Olá mundo.');
  });

  it('a tool turn retracts its streamed narration (text_reset) and re-routes it to thinking; the final toolless turn is the answer', async () => {
    const evs = await drive([
      // Turn 1: narration text, then a tool_use block reveals it was commentary.
      msgStart(),
      blockStart('text'),
      textDelta('Vou verificar. '),
      blockStart('tool_use'),
      assistant([
        { type: 'text', text: 'Vou verificar. ' },
        { type: 'tool_use', name: 'knowledge_search', id: 't1', input: {} },
      ]),
      // Turn 2 (toolless): the real answer, streamed live.
      msgStart(),
      blockStart('text'),
      textDelta('A resposta.'),
      assistant([{ type: 'text', text: 'A resposta.' }]),
      resultMsg('A resposta.'),
    ]);
    expect(evs.some((e) => e.kind === 'text_reset')).toBe(true);
    // Post-last-reset text concatenation == the classified answer (the F20 contract).
    expect(answerOf(evs)).toBe('A resposta.');
    expect(finalOf(evs).text).toBe('A resposta.');
    // The narration still reaches the thinking channel exactly once.
    const thinking = evs.filter((e) => e.kind === 'thinking').map((e) => e.text).join('');
    expect(thinking).toBe('Vou verificar. ');
  });

  it('a tool turn with NO pre-tool text emits NO text_reset (nothing streamed → nothing to retract)', async () => {
    const evs = await drive([
      // Turn 1: straight to tool_use — no answer deltas precede it.
      msgStart(),
      blockStart('tool_use'),
      assistant([{ type: 'tool_use', name: 'knowledge_search', id: 't1', input: {} }]),
      // Turn 2 (toolless): the answer.
      msgStart(),
      blockStart('text'),
      textDelta('A resposta.'),
      assistant([{ type: 'text', text: 'A resposta.' }]),
      resultMsg('A resposta.'),
    ]);
    expect(evs.some((e) => e.kind === 'text_reset')).toBe(false);
    expect(answerOf(evs)).toBe('A resposta.');
  });

  it('thinking deltas stream live and dedupe against the whole-message thinking', async () => {
    const evs = await drive([
      msgStart(),
      blockStart('thinking'),
      thinkDelta('devo responder '),
      thinkDelta('como EKOA. '),
      blockStart('text'),
      textDelta('Sou o Agente EKOA.'),
      assistant([
        { type: 'thinking', thinking: 'devo responder como EKOA. ' },
        { type: 'text', text: 'Sou o Agente EKOA.' },
      ]),
      resultMsg('Sou o Agente EKOA.'),
    ]);
    const thinking = evs.filter((e) => e.kind === 'thinking').map((e) => e.text).join('');
    expect(thinking).toBe('devo responder como EKOA. ');
    expect(answerOf(evs)).toBe('Sou o Agente EKOA.');
  });

  it('subagent partials (parent_tool_use_id) never reach any channel', async () => {
    const evs = await drive([
      msgStart(),
      blockStart('text', 'tu-parent'),
      textDelta('interno do subagente', 'tu-parent'),
      resultMsg('ok'),
    ]);
    expect(evs.filter((e) => e.kind === 'text')).toEqual([]);
  });
});

describe('runAgent consumer: text_reset drops the raw answer accumulation', () => {
  beforeAll(() => bootAgentTestDb('ekoa_stream_partials'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(() => restoreTransport());

  it('result.text is the post-reset stream only; the reset event is forwarded to consumers', async () => {
    resetAgentState();
    const script: AgentStreamMsg[] = [
      { kind: 'text', text: 'Vou verificar. ' },
      { kind: 'text_reset' },
      { kind: 'thinking', text: 'Vou verificar. ' },
      { kind: 'text', text: 'A resposta.' },
      { kind: 'final', text: 'A resposta.', usage: { input: 5, output: 3, cacheCreate: 0, cacheRead: 0 } },
    ];
    const transport: ChokepointTransport = {
      async *streamAgent() { for (const m of script) yield m; },
      async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
      async messages() { return { status: 200, headers: {}, body: '{}' }; },
    };
    __setTransportForTests(transport);

    const handle = runAgent(
      { prompt: 'pergunta', decision: decideForTier('WORKHORSE') },
      { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' },
    );
    const seen: Array<{ type: string; text?: string }> = [];
    for await (const ev of handle.events) seen.push(ev);
    const result = await handle.result;

    expect(seen.map((e) => e.type)).toEqual(['text', 'text_reset', 'thinking', 'text']);
    expect(result.text).toBe('A resposta.');
    expect(result.thinkingText).toBe('Vou verificar. ');
  });
});
