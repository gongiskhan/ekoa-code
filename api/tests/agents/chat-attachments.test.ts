import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
import { sessions } from '../../src/data/stores.js';
import { stageUpload } from '../../src/uploads/service.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';
import type { SdkCallParams } from '../../src/llm/client.js';

/**
 * WS4a: the text-attachments run class's attachment-path plumbing. Before this slice,
 * agents/tools.ts documented the gap plainly ("mounts no in-process tools and has no
 * attachment-path plumbing today") - a chat run WITH `attachments` got the Read/Glob/Grep tool
 * policy but nothing to point those tools at (an empty F25 sandbox, same as any other run).
 *
 * This suite proves the fix at the one seam that matters: what `runAgent` (here, the fake
 * transport standing in for it) actually receives. `cwd` becomes a fresh directory that
 * CONTAINS the staged blob, readable at the moment the model would call Read on it (verified
 * BEFORE the run's own cleanup can race the assertion - the mock reads the directory
 * synchronously, inside the fake transport call, before yielding anything).
 */
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
const actor = { userId: 'u1', orgId: 'o1', role: 'user' as const };
let dataDir: string;

async function runChatWithAttachments(attachments: Array<{ uploadId: string; displayName?: string }> | undefined, message = 'o que diz o anexo?') {
  const base = resetAgentState({ finalText: 'Vi o ficheiro.' });
  let cwdAtCallTime = '';
  let dirListingAtCallTime: string[] = [];
  let systemPromptAtCallTime = '';
  const realStreamAgent = base.streamAgent.bind(base);
  vi.spyOn(base, 'streamAgent').mockImplementation(async function* (params: SdkCallParams) {
    // Snapshot BEFORE yielding anything: the run's own cleanup only fires once the generator
    // this wraps has fully drained, so the attachments dir is guaranteed to still be intact here.
    cwdAtCallTime = params.cwd ?? '';
    systemPromptAtCallTime = params.systemPrompt ?? '';
    if (cwdAtCallTime) {
      try { dirListingAtCallTime = readdirSync(cwdAtCallTime); } catch { dirListingAtCallTime = []; }
    }
    yield* realStreamAgent(params);
  });

  const input = { actor, username: 'u1', sessionId: 's1', message, language: 'pt', ...(attachments ? { attachments } : {}), deps };
  const { runId } = createChatRun(input);
  await executeChatRun(runId, input);
  return { cwdAtCallTime, dirListingAtCallTime, systemPromptAtCallTime, streamCalls: base.streamCalls };
}

describe('text-attachments run class: staged-upload plumbing (WS4a)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_chat_attachments'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'ekoa-chat-attach-'));
    process.env.EKOA_DATA_DIR = dataDir;
    await seedUser('u1', 'o1');
    await sessions.insert({ _id: 's1', userId: 'u1', title: 't', status: 'active', messageCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  });
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await sessions.deleteMany({}); });

  it('a chat run with NO attachments gets the ordinary empty per-run sandbox, unchanged', async () => {
    const { cwdAtCallTime, dirListingAtCallTime } = await runChatWithAttachments(undefined, 'olá');
    expect(cwdAtCallTime).toBeTruthy(); // F25 always sets SOME cwd (the ephemeral sandbox)
    expect(cwdAtCallTime).not.toMatch(/ekoa-attach-/); // but never OUR staging prefix
    expect(dirListingAtCallTime).toEqual([]); // and it is empty
  });

  it('a staged upload is copied into a FRESH cwd, readable at the moment the model would Read it', async () => {
    const staged = await stageUpload('u1', { filename: 'nota.txt', bytes: Buffer.from('conteudo do anexo') }, deps);
    const { cwdAtCallTime, dirListingAtCallTime, systemPromptAtCallTime } = await runChatWithAttachments([{ uploadId: staged.uploadId }]);

    expect(cwdAtCallTime).toMatch(/ekoa-attach-/);
    expect(dirListingAtCallTime).toContain('nota.txt');
    expect(readFileSync(join(cwdAtCallTime, 'nota.txt'), 'utf8')).toBe('conteudo do anexo');

    // The model is told the file exists and where - permission alone (Read/Glob/Grep) does not
    // tell it there is anything to read.
    expect(systemPromptAtCallTime).toContain('nota.txt');
  });

  it('an unknown/foreign uploadId is dropped, not a hard failure - the turn still runs', async () => {
    const { cwdAtCallTime, dirListingAtCallTime } = await runChatWithAttachments([{ uploadId: 'does-not-exist' }]);
    // Nothing resolved -> stageRunAttachments returns null -> cwd falls back to the ordinary sandbox.
    expect(cwdAtCallTime).not.toMatch(/ekoa-attach-/);
    expect(dirListingAtCallTime).toEqual([]);
  });

  it('the run-attachments directory is discarded once the run settles (cleanup, not a leak)', async () => {
    const staged = await stageUpload('u1', { filename: 'nota.txt', bytes: Buffer.from('x') }, deps);
    const { cwdAtCallTime } = await runChatWithAttachments([{ uploadId: staged.uploadId }]);
    expect(cwdAtCallTime).toMatch(/ekoa-attach-/);
    // Cleanup is fire-and-forget (matches llm/client.ts's F25 discardSandbox) - give its rm() a
    // tick to land rather than asserting synchronously on a promise this test never awaited.
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(cwdAtCallTime)).toBe(false);
  });
});
