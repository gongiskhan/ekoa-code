import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * Conduzir at the chokepoint (steer a live run). Three layers under test:
 *   1. SteerQueue — the pushable input seam (order, close idempotency, push-after-close).
 *   2. The default transport in streaming-input mode (SDK mocked, REAL transport): a steerable
 *      run hands the prompt as an AsyncIterable, each steered message becomes its own user
 *      turn in the SAME query, the input closes on the first result with nothing unconsumed
 *      (an un-steered run exits after one turn, exactly like the string-prompt path), and
 *      usage BILLS ACROSS ALL RESULTS (one result per run — overwrite would drop turn 1).
 *   3. runAgent's handle.steer — wired only when `steerable`, false before/after the accepting
 *      window (the caller's queue-and-flush fallback signal).
 */

const sdkScript = vi.hoisted(() => ({
  /** String-prompt path script (kept for completeness). */
  messages: [] as unknown[],
  /** Streaming-input path: runs[i] plays for the i-th consumed user message. */
  runs: [] as unknown[][],
  consumed: [] as unknown[],
  lastPrompt: null as unknown,
}));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: string | AsyncIterable<unknown>; options?: Record<string, unknown> }) => {
    sdkScript.lastPrompt = args.prompt;
    return (async function* () {
      if (typeof args.prompt === 'string') {
        for (const m of sdkScript.messages) yield m;
        return;
      }
      // Streaming-input mode: pull a user message, play its run, pull again; end on input end —
      // the documented SDK contract this feature rides on.
      let runIdx = 0;
      for await (const userMsg of args.prompt) {
        sdkScript.consumed.push(userMsg);
        for (const m of sdkScript.runs[runIdx++] ?? []) yield m;
      }
    })();
  },
  createSdkMcpServer: () => ({}),
  tool: () => ({}),
}));

import { runAgent, decideForTier } from '../../src/llm/index.js';
import {
  SteerQueue,
  __defaultTransportForTests,
  type AgentStreamMsg,
  type SdkCallParams,
} from '../../src/llm/client.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from '../agents/_setup.js';

const P: SdkCallParams = { prompt: 'pergunta inicial', model: 'm', effort: 'medium', env: {} };

const assistant = (text: string): unknown => ({
  type: 'assistant', message: { content: [{ type: 'text', text }] }, session_id: 'sdk-s1',
});
const resultMsg = (result: string, usage: Record<string, number>): unknown => ({
  type: 'result', subtype: 'success', result, usage,
});

describe('SteerQueue', () => {
  it('delivers pushed messages in order, then null after close', async () => {
    const q = new SteerQueue();
    expect(q.push('a')).toBe(true);
    expect(q.push('b')).toBe(true);
    expect(q.hasUnconsumed()).toBe(true);
    expect(await q.take()).toBe('a');
    expect(await q.take()).toBe('b');
    expect(q.hasUnconsumed()).toBe(false);
    q.close();
    expect(await q.take()).toBeNull();
  });

  it('resolves a pending take() on push and on close; push after close is refused', async () => {
    const q = new SteerQueue();
    const pending = q.take();
    expect(q.push('depois')).toBe(true);
    expect(await pending).toBe('depois');
    const pending2 = q.take();
    q.close();
    q.close(); // idempotent
    expect(await pending2).toBeNull();
    expect(q.push('tarde')).toBe(false);
  });
});

describe('default transport streaming-input mode (SDK mocked)', () => {
  beforeEach(() => {
    sdkScript.messages = [];
    sdkScript.runs = [];
    sdkScript.consumed = [];
    sdkScript.lastPrompt = null;
  });

  const drain = async (params: SdkCallParams): Promise<AgentStreamMsg[]> => {
    const events: AgentStreamMsg[] = [];
    for await (const m of __defaultTransportForTests().streamAgent(params)) events.push(m);
    return events;
  };

  it('un-steered steerable run: one user turn, closes on its result, final matches string path', async () => {
    sdkScript.runs = [[assistant('resposta'), resultMsg('resposta', { input_tokens: 2, output_tokens: 3 })]];
    const events = await drain({ ...P, steer: new SteerQueue() });
    expect(typeof sdkScript.lastPrompt).not.toBe('string'); // streaming input engaged
    expect(sdkScript.consumed).toHaveLength(1); // the initial prompt only
    const final = events[events.length - 1]!;
    expect(final).toMatchObject({ kind: 'final', text: 'resposta', aborted: false });
    expect(final.kind === 'final' && final.usage).toMatchObject({ input: 2, output: 3 });
  });

  it('a steered message becomes a SECOND user turn in the same query; usage sums across results', async () => {
    sdkScript.runs = [
      [assistant('primeira'), resultMsg('primeira', { input_tokens: 2, output_tokens: 3 })],
      [assistant(' e segunda'), resultMsg(' e segunda', { input_tokens: 5, output_tokens: 7 })],
    ];
    const steer = new SteerQueue();
    steer.push('afinal quero outra coisa');
    const events = await drain({ ...P, steer });
    expect(sdkScript.consumed).toHaveLength(2);
    const second = sdkScript.consumed[1] as { message?: { content?: unknown } };
    expect(second.message?.content).toBe('afinal quero outra coisa');
    const final = events[events.length - 1]!;
    expect(final).toMatchObject({ kind: 'final', text: 'primeira e segunda' });
    // Billing covers BOTH turns — the accumulate-across-results contract.
    expect(final.kind === 'final' && final.usage).toMatchObject({ input: 7, output: 10 });
  });

  it('non-steerable params keep the plain string prompt', async () => {
    sdkScript.messages = [assistant('ok'), resultMsg('ok', { input_tokens: 1, output_tokens: 1 })];
    await drain({ ...P });
    expect(sdkScript.lastPrompt).toBe(P.prompt);
  });
});

describe('runAgent handle.steer (fake transport)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_llm_steering'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    await seedUser('u1', 'o1');
  });
  afterEach(restoreTransport);

  it('steerable run: transport receives the queue; mid-run steer is accepted; post-run steer refused', async () => {
    const t = resetAgentState({ finalText: 'feito', stream: [{ kind: 'text', text: 'a ' }] });
    const handle = runAgent(
      { prompt: 'olá', decision: decideForTier('WORKHORSE'), steerable: true },
      { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' },
    );
    expect(handle.steer('cedo demais')).toBe(false); // before the transport starts
    let steeredMidRun: boolean | undefined;
    for await (const ev of handle.events) {
      if (ev.type === 'text' && steeredMidRun === undefined) steeredMidRun = handle.steer('mais depressa');
    }
    await handle.result;
    expect(steeredMidRun).toBe(true);
    const queue = t.streamCalls[0]!.steer!;
    expect(queue).toBeInstanceOf(SteerQueue);
    expect(await queue.take()).toBe('mais depressa'); // reached the transport seam, anonymise pass-through
    expect(handle.steer('tarde demais')).toBe(false); // the run stopped accepting input
  });

  it('non-steerable run: no queue on the transport params, steer always false', async () => {
    const t = resetAgentState({ finalText: 'ok' });
    const handle = runAgent(
      { prompt: 'olá', decision: decideForTier('WORKHORSE') },
      { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' },
    );
    for await (const ev of handle.events) void ev;
    await handle.result;
    expect(t.streamCalls[0]!.steer).toBeUndefined();
    expect(handle.steer('x')).toBe(false);
  });
});
