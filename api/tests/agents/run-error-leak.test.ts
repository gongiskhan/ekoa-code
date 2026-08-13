import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ChatRunEvent, RUN_ERROR_TEXT } from '@ekoa/shared';
import { sseManager } from '../../src/events/sse-manager.js';
import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
import { getRun } from '../../src/agents/registry.js';
import { messages, sessions } from '../../src/data/stores.js';
import {
  setCredential,
  __setRefreshFnForTests,
  __setNowForTests,
  __resetCredentialsForTests,
} from '../../src/llm/credentials.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';

/**
 * REGRESSION: an internal error string must never reach a user (finding `run-error-text-leak`).
 *
 * On 2026-08-10 a user asked the agent, in Portuguese, to build a website. The reply rendered in
 * the agent's own message bubble was:
 *
 *   "credential expired and refresh failed: OAuth refresh not configured
 *    (LLM_OAUTH_REFRESH_URL + stored refresh token required)"
 *
 * The chain: the platform's oauth credential hard-expired with no refresh configured ->
 * `getSecret()` threw a `CredentialError` naming the missing env var -> it propagated out of
 * `runAgent` -> chat.ts's catch-all did `finishError('ADAPTER_ERROR', err.message)` -> the web's
 * denylist sanitizer did not match the string -> rendered verbatim.
 *
 * This suite reproduces that state through the REAL credential machinery (an expired credential
 * plus a failing refresh seam — not a mocked throw) and pins that the wire now carries a code
 * and safe text only. It fails on the pre-fix code.
 */

/** The exact message the credential layer produced, reproduced through the real refresh seam. */
const INTERNAL_REFRESH_FAILURE =
  'OAuth refresh not configured (LLM_OAUTH_REFRESH_URL + stored refresh token required)';

/**
 * Substrings that must not appear ANYWHERE on the wire. Broader than the one leaked string on
 * purpose: the defect was never about that sentence, it was about internal text reaching users.
 */
const INTERNAL_NEEDLES = [
  'LLM_OAUTH_REFRESH_URL',
  'refresh token',
  'refresh failed',
  'credential',
  'OAuth',
  'oauth',
  'expired',
  'sk-ant',
  'process.env',
];

const NOW = 1_700_000_000_000;
let seq = 0;
const deps = { now: () => NOW + seq, genId: () => `id_${seq++}` };
const actor = { userId: 'u1', orgId: 'o1', role: 'user' as const };

interface Captured { stream: string; streamId: string; type: string; data: unknown }
let events: Captured[];

/** Put the platform credential into the exact broken state: hard-expired, refresh fails. */
async function armExpiredUnrefreshableCredential(): Promise<void> {
  __setNowForTests(() => NOW);
  // Expired an hour ago, so getSecret() takes the proactive-refresh branch AND the
  // hard-expired branch under it — the path that throws CredentialError.
  await setCredential({ mode: 'oauth', secret: 'oauth-tok-123', expiresAt: NOW - 3_600_000 });
  __setRefreshFnForTests(async () => {
    throw new Error(INTERNAL_REFRESH_FAILURE);
  });
}

async function runChat(message = 'faz um site a falar das apps juridicas do ekoa'): Promise<string> {
  resetAgentState({ stream: [{ kind: 'text', text: 'unreachable' }], finalText: 'unreachable' });
  events = [];
  vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => {
    events.push({ stream, streamId, type, data });
  });
  const input = { actor, username: 'u1', sessionId: 's1', message, language: 'pt', deps };
  const { runId } = createChatRun(input);
  await executeChatRun(runId, input);
  return runId;
}

describe('terminal run errors never carry internal text (finding run-error-text-leak)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_run_error_leak'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    await seedUser('u1', 'o1');
    await sessions.insert({ _id: 's1', userId: 'u1', title: 't', status: 'active', messageCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    // The catch-all logs the honest cause for operators; keep it out of the suite output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    restoreTransport();
    __resetCredentialsForTests();
    await messages.deleteMany({});
    await sessions.deleteMany({});
  });

  it('an expired, unrefreshable credential ends the run as AUTH_ERROR with no internal text on the wire', async () => {
    await armExpiredUnrefreshableCredential();
    const runId = await runChat();
    const evs = events.filter((e) => e.stream === 'chat' && e.streamId === runId);

    // (a) the run terminated as an error, and every event is contract-valid
    for (const e of evs) expect(ChatRunEvent.safeParse(e.data).success, `event ${e.type} validates`).toBe(true);
    const error = evs.find((e) => e.type === 'error');
    expect(error, 'a terminal error event was emitted').toBeDefined();

    // (b) CLASSIFIED, not swallowed into a generic adapter failure. A dead platform credential is
    //     operator-actionable; calling it ADAPTER_ERROR would tell the user to keep retrying.
    const payload = error!.data as { code: string; message: string };
    expect(payload.code).toBe('AUTH_ERROR');

    // (c) THE REGRESSION: the wire message is the vocabulary's text, not the exception's.
    expect(payload.message).toBe(RUN_ERROR_TEXT.pt.AUTH_ERROR);
    expect(payload.message).not.toContain(INTERNAL_REFRESH_FAILURE);

    // (d) and nothing internal rode ANY event of ANY type on this stream.
    const wire = JSON.stringify(evs);
    for (const needle of INTERNAL_NEEDLES) {
      expect(wire.includes(needle), `no event may carry "${needle}"`).toBe(false);
    }
  });

  it('the settled run record — what a reconnecting client polls — is also safe', async () => {
    await armExpiredUnrefreshableCredential();
    const runId = await runChat();
    // A client that missed the live event reads the terminal snapshot instead; it must not be
    // the honest-but-internal message either.
    const settled = getRun(runId);
    expect(settled?.status).toBe('error');
    expect(settled?.error?.code).toBe('AUTH_ERROR');
    expect(settled?.error?.message).toBe(RUN_ERROR_TEXT.pt.AUTH_ERROR);
    for (const needle of INTERNAL_NEEDLES) {
      expect(JSON.stringify(settled?.error).includes(needle), `settled run must not carry "${needle}"`).toBe(false);
    }
  });

  it('the failed turn is not persisted as an assistant message', async () => {
    // The leak was rendered as the agent's REPLY. A failure is not an answer: nothing the model
    // never said may end up in the transcript as though it did.
    await armExpiredUnrefreshableCredential();
    await runChat();
    const persisted = await messages.find({ sessionId: 's1' });
    const assistant = persisted.filter((m) => (m as { role?: string }).role === 'assistant');
    expect(assistant).toHaveLength(0);
    // The user's own message survives, so a retry can re-send it rather than making them retype.
    const user = persisted.filter((m) => (m as { role?: string }).role === 'user');
    expect(user).toHaveLength(1);
  });

  it('a generic transport failure stays a retryable ADAPTER_ERROR and still leaks nothing', async () => {
    // The classifier must not over-claim: an unrecognised throw is NOT an auth problem.
    // Re-arm a HEALTHY credential first — the previous cases persisted an expired one, and
    // getSecret() would otherwise throw CredentialError before the transport is ever reached.
    __setNowForTests(() => NOW);
    await setCredential({ mode: 'oauth', secret: 'oauth-tok-123', refreshToken: 'oauth-refresh-123', expiresAt: NOW + 3_600_000 });
    resetAgentState({});
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => {
      events.push({ stream, streamId, type, data });
    });
    const { __setTransportForTests } = await import('../../src/llm/client.js');
    __setTransportForTests({
      // eslint-disable-next-line require-yield
      async *streamAgent() { throw new Error('ENOTFOUND internal-host.example /var/secrets/app.key'); },
      async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
      async messages() { throw new Error('unused'); },
    } as unknown as Parameters<typeof __setTransportForTests>[0]);

    const input = { actor, username: 'u1', sessionId: 's1', message: 'olá', language: 'pt', deps };
    const { runId } = createChatRun(input);
    await executeChatRun(runId, input);

    const error = events.find((e) => e.stream === 'chat' && e.streamId === runId && e.type === 'error');
    const payload = error!.data as { code: string; message: string };
    expect(payload.code).toBe('ADAPTER_ERROR');
    expect(payload.message).toBe(RUN_ERROR_TEXT.pt.ADAPTER_ERROR);
    expect(JSON.stringify(events)).not.toContain('ENOTFOUND');
    expect(JSON.stringify(events)).not.toContain('/var/secrets/app.key');
  });
});
