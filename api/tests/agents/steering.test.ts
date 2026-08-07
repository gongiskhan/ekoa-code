import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sseManager } from '../../src/events/sse-manager.js';
import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
import { steerLiveRun } from '../../src/agents/steering.js';
import { getRun } from '../../src/agents/registry.js';
import { messages, sessions } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';
import type { FakeTransportScript } from './_fake-transport.js';

/**
 * Conduzir at the agents layer (steerLiveRun): the queued-banner "send it NOW" path. A live
 * chat run wires `entry.steer` to the agent handle; steering persists the message as a REAL
 * user turn on the session transcript (reload replays it in order); ownership is OWNER-ONLY
 * (stricter than cancel — a steered turn persists as the owner's words, so an admin steering
 * would be impersonation); every refusal shape is `steered: false`, never a throw.
 */
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
const actor = { userId: 'u1', orgId: 'o1', role: 'user' as const };
const stranger = { userId: 'u2', orgId: 'o1', role: 'user' as const };

describe('steerLiveRun (Conduzir)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_agents_steering'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    await seedUser('u1', 'o1');
    await seedUser('u2', 'o1');
    await sessions.insert({ _id: 's1', userId: 'u1', title: 't', status: 'active', messageCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    restoreTransport();
    await messages.deleteMany({});
    await sessions.deleteMany({});
  });

  /** Start a chat run whose stream stays open for `streamDelayMs`, returning mid-run control. */
  async function startRun(script: FakeTransportScript): Promise<{ runId: string; done: Promise<void> }> {
    const transport = resetAgentState(script);
    vi.spyOn(sseManager, 'emit').mockImplementation(() => {});
    const input = { actor, username: 'u1', sessionId: 's1', message: 'primeira pergunta', language: 'pt', deps };
    const { runId } = createChatRun(input);
    const done = executeChatRun(runId, input);
    // Let the pipeline reach the transport (billing gate + context assembly are awaits): poll
    // until the transport call exists — the point from which the run accepts steers — instead
    // of guessing a fixed sleep.
    for (let i = 0; i < 200 && transport.streamCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    return { runId, done };
  }

  it('mid-run steer is accepted, wires entry.steer, and persists the message as a user turn', async () => {
    const { runId, done } = await startRun({ finalText: 'resposta', streamDelayMs: 500 });
    expect(getRun(runId)?.steer).toBeTypeOf('function');
    const outcome = await steerLiveRun(runId, actor, 'afinal em vermelho', deps);
    expect(outcome.steered).toBe(true);
    const persisted = await messages.find({ sessionId: 's1', role: 'user' });
    const texts = persisted.map((m) => m.content);
    expect(texts).toContain('primeira pergunta'); // pipeline step 1
    expect(texts).toContain('afinal em vermelho'); // the steered turn
    await done;
  });

  it('owner-only: another user in the same org is refused and nothing persists', async () => {
    const { runId, done } = await startRun({ finalText: 'resposta', streamDelayMs: 500 });
    const outcome = await steerLiveRun(runId, stranger, 'intruso', deps);
    expect(outcome.steered).toBe(false);
    const persisted = await messages.find({ sessionId: 's1', role: 'user' });
    expect(persisted.map((m) => m.content)).not.toContain('intruso');
    await done;
  });

  it('a finished run refuses the steer (queue-and-flush fallback), and so does an unknown id', async () => {
    const { runId, done } = await startRun({ finalText: 'resposta' });
    await done; // run is terminal
    expect((await steerLiveRun(runId, actor, 'tarde', deps)).steered).toBe(false);
    expect((await steerLiveRun('nunca-existiu', actor, 'x', deps)).steered).toBe(false);
    const persisted = await messages.find({ sessionId: 's1', role: 'user' });
    expect(persisted.map((m) => m.content)).not.toContain('tarde');
  });
});
