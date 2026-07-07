import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runAgent, decideForTier } from '../../src/llm/index.js';
import { setCredential } from '../../src/llm/credentials.js';
import { loadConfig } from '../../src/config.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from '../agents/_setup.js';
import type { FakeTransport } from '../agents/_fake-transport.js';

/**
 * SDK subprocess environment (ch05 §5.4.1, acceptance criterion 3) + the transport-seam
 * extension (§5.4.6, §5.7.1): tool-use / session-id / usage callbacks. Exercised through the
 * fake transport, which captures the exact `env` and `SdkCallParams` the chokepoint builds.
 */
describe('SDK env + transport extension (§5.4.1, §5.4.6)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_agent_transport'));
  afterAll(shutdownAgentTestDb);
  beforeEach(() => seedUser('u1', 'o1'));
  afterEach(restoreTransport);

  async function runToEnd(t: FakeTransport, opts: Parameters<typeof runAgent>[0]): Promise<void> {
    const handle = runAgent(opts, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1' });
    for await (const _ of handle.events) void _;
    await handle.result;
    void t;
  }

  it('oauth mode injects CLAUDE_CODE_OAUTH_TOKEN, never ANTHROPIC_API_KEY, and scrubs inherited provider env', async () => {
    process.env.ANTHROPIC_API_KEY = 'inherited-leak';
    process.env.CLAUDECODE = '1';
    await setCredential({ mode: 'oauth', secret: 'oauth-secret-xyz' });
    const t = resetAgentState({ finalText: 'ok' });
    await runToEnd(t, { prompt: 'hi', decision: decideForTier('WORKHORSE') });
    const env = t.streamCalls[0]!.env;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-secret-xyz');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); // never in oauth mode; inherited value scrubbed
    expect(env.CLAUDECODE).toBeUndefined(); // deleted (prevents nested-session detection)
    expect(env.ANTHROPIC_BASE_URL).toBe(loadConfig().llmChokepointBaseUrl); // repointed at the chokepoint
    expect(env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS).toBe('1');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDECODE;
  });

  it('api-key mode injects ANTHROPIC_API_KEY from custody, never CLAUDE_CODE_OAUTH_TOKEN', async () => {
    await setCredential({ mode: 'api-key', secret: 'sk-ant-custody' });
    const t = resetAgentState({ finalText: 'ok' });
    await runToEnd(t, { prompt: 'hi', decision: decideForTier('WORKHORSE') });
    const env = t.streamCalls[0]!.env;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-custody');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it('build runs set HOME = projectDir; agent-face raises the stream-close timeout', async () => {
    await setCredential({ mode: 'oauth', secret: 'tok' });
    const t = resetAgentState({ finalText: 'ok' });
    await runToEnd(t, { prompt: 'build', decision: decideForTier('EXPERT'), homeDir: '/sandbox/app', streamCloseTimeoutMs: 180_000 });
    const env = t.streamCalls[0]!.env;
    expect(env.HOME).toBe('/sandbox/app');
    expect(env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT).toBe('180000');
  });

  it('surfaces tool-use, session-id, usage, and plan callbacks from the stream', async () => {
    await setCredential({ mode: 'oauth', secret: 'tok' });
    const t = resetAgentState({
      finalText: 'done',
      stream: [
        { kind: 'session', sessionId: 'sdk-sess-1' },
        { kind: 'text', text: 'thinking ' },
        { kind: 'tool_use', tool: 'Read', toolId: 'tool-1', args: { path: '/a.txt' } },
        { kind: 'tool_result', tool: 'Read', toolId: 'tool-1', result: 'file body', isError: false },
        { kind: 'usage', usage: { input: 3, output: 1, cacheCreate: 0, cacheRead: 0 } },
        { kind: 'plan' },
      ],
    });
    const tools: Array<{ phase: string; tool: string }> = [];
    let sessionId = '';
    let usageDeltas = 0;
    let plans = 0;
    const handle = runAgent(
      {
        prompt: 'go',
        decision: decideForTier('EXPERT'),
        callbacks: {
          onToolEvent: (e) => tools.push({ phase: e.phase, tool: e.tool }),
          onSessionId: (s) => { sessionId = s; },
          onUsageDelta: () => { usageDeltas++; },
          onPlanNotification: () => { plans++; },
        },
      },
      { kind: 'user_work', agentType: 'build', billeeUserId: 'u1' },
    );
    let text = '';
    for await (const ev of handle.events) text += ev.text;
    await handle.result;
    expect(text).toContain('thinking');
    expect(sessionId).toBe('sdk-sess-1');
    expect(tools).toEqual([{ phase: 'started', tool: 'Read' }, { phase: 'finished', tool: 'Read' }]);
    expect(usageDeltas).toBeGreaterThanOrEqual(1);
    expect(plans).toBe(1);
  });
});
