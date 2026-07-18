import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { VOICE_STT_WS_PATH, VOICE_TTS_WS_PATH, RegistoEntry, RegistoListResponse } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { usageEvents, tokenEvents, activityLogs, type ActivityLogDoc } from '../../src/data/stores.js';
import { sttMsOfBytes } from '../../src/voice/session.js';
import { STT_STUB_MARKER_PREFIX } from '../../src/voice/stub-providers.js';
import { registoEntry } from '../../src/services/platform-crud.js';
import {
  initVoiceTestEnv,
  resetVoiceTestState,
  startVoiceServer,
  stopVoiceServer,
  seedUserToken,
  sleep,
  VoiceClient,
  type VoiceTestServer,
} from './helpers.js';

/**
 * Mega-run C2 - the voice relay meters and audits through the SINGLE seams, driven over a
 * REAL WS session (no shortcuts): at session close the received-audio total (ungated: capture
 * open = billed, bytes at the known rate) and the submitted TTS characters land in the
 * `usage_events` ledger THROUGH billing/tracker.ts, attributed to the verified token's
 * org + user; every voice turn lands an activity row through the single `logActivity` path
 * with the A5 vocabulary (`voice.turn` / `voice.tts`, `source:'voice'`, refs only), and the
 * rows render on the Registo read surface with `usageCounts` intact.
 */

let mem: MongoMemoryServer;
let t: VoiceTestServer;

beforeAll(async () => {
  initVoiceTestEnv();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_voice_meter');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  resetVoiceTestState();
  await usageEvents.deleteMany({});
  await tokenEvents.deleteMany({});
  await activityLogs.deleteMany({});
  t = await startVoiceServer();
});
afterEach(async () => {
  await stopVoiceServer(t);
});

const sttUrl = (token: string, extra = '') =>
  `ws://127.0.0.1:${t.port}${VOICE_STT_WS_PATH}?token=${encodeURIComponent(token)}${extra}`;
const ttsUrl = (token: string) =>
  `ws://127.0.0.1:${t.port}${VOICE_TTS_WS_PATH}?token=${encodeURIComponent(token)}`;

/** The metering/audit writes are fire-and-forget off the close path - poll until they land. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out; last: ${JSON.stringify(v)}`);
    await sleep(20);
  }
}

describe('STT session metering (voice_stt_ms) + voice.turn audit', () => {
  it('bills the whole capture-open session at the known rate through the tracker, org+user attributed', async () => {
    const token = seedUserToken('u-met-1', 'org-met-1', 'ana');
    const c = new VoiceClient(sttUrl(token, '&sample_rate=16000'));
    expect(await c.waitOpen()).toBe(true);
    const ready = await c.waitForJson((m) => m.type === 'ready');

    const pcm = Buffer.alloc(32_000); // exactly 1000 ms at 16 kHz linear16 mono
    c.client.send(pcm);
    const marker = Buffer.from(`${STT_STUB_MARKER_PREFIX}ola`);
    c.client.send(marker);
    await c.waitForJson((m) => m.type === 'utterance_end');
    c.client.send(JSON.stringify({ type: 'turn_committed', transcriptMessageId: 'msg-42', mode: 'talking' }));
    c.client.send(JSON.stringify({ type: 'close_stream' }));
    await c.waitClosed();

    const expectedMs = sttMsOfBytes(32_000 + marker.byteLength);
    const rows = await eventually(() => usageEvents.find({ sessionId: ready.sessionId }), (r) => r.length === 1);
    expect(rows[0]).toMatchObject({
      _id: `voice:org-met-1:${ready.sessionId}`,
      orgId: 'org-met-1',
      billeeUserId: 'u-met-1',
      source: 'voice',
      counters: { voice_stt_ms: expectedMs },
    });
    // Separate counters, no token conversion: the token ledger stays empty.
    expect(await tokenEvents.find({})).toHaveLength(0);

    // The committed turn audited through the single logActivity path, refs only.
    const acts = await eventually(
      () => activityLogs.find({ category: 'voice', type: 'turn' }),
      (r) => r.length === 1,
    );
    expect(acts[0]).toMatchObject({
      userId: 'u-met-1',
      username: 'ana',
      orgId: 'org-met-1',
      metadata: { source: 'voice', sessionId: ready.sessionId, transcriptMessageId: 'msg-42', mode: 'talking', turn: 1 },
      usageCounts: { voice_stt_ms: expectedMs },
    });
    // Never the transcript body ('Olá, bom dia.' is the stub script's final text).
    expect(JSON.stringify(acts[0])).not.toContain('bom dia');

    // And the row renders on the Registo read surface: schema-valid, usageCounts intact,
    // sessionId derived into targetIds.
    const entry = registoEntry(acts[0] as ActivityLogDoc);
    expect(RegistoEntry.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
    expect(entry.actionType).toBe('voice.turn');
    expect(entry.usageCounts).toEqual({ voice_stt_ms: expectedMs });
    expect(entry.targetIds).toContain(ready.sessionId);
    expect(RegistoListResponse.safeParse({ items: [entry], total: 1 }).success).toBe(true);
  });

  it('an uncommitted turn still audits at close - without a transcript ref', async () => {
    const token = seedUserToken('u-met-2', 'org-met-2', 'rui');
    const c = new VoiceClient(sttUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');
    c.client.send(Buffer.from(`${STT_STUB_MARKER_PREFIX}ola`));
    await c.waitForJson((m) => m.type === 'utterance_end');
    c.terminate(); // capture dropped without ever committing the transcript
    await c.waitClosed();

    const acts = await eventually(
      () => activityLogs.find({ category: 'voice', type: 'turn' }),
      (r) => r.length === 1,
    );
    const meta = acts[0]!.metadata as Record<string, unknown>;
    expect(meta.source).toBe('voice');
    expect(meta.transcriptMessageId).toBeUndefined();
    expect(acts[0]!.orgId).toBe('org-met-2');
  });
});

describe('TTS session metering (voice_tts_chars) + voice.tts audit', () => {
  it('meters submitted characters at close through the tracker and audits each spoken reply', async () => {
    const token = seedUserToken('u-met-3', 'org-met-3', 'sofia');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    const ready = await c.waitForJson((m) => m.type === 'ready');

    const text = 'Olá, está tudo bem?';
    c.client.send(JSON.stringify({ type: 'say', text, lang: 'pt-PT', turnId: 't1', sheetId: 'sheet-7' }));
    await c.waitForJson((m) => m.type === 'audio_end' && m.turnId === 't1');
    c.terminate();
    await c.waitClosed();

    const rows = await eventually(() => usageEvents.find({ sessionId: ready.sessionId }), (r) => r.length === 1);
    expect(rows[0]).toMatchObject({
      _id: `voice:org-met-3:${ready.sessionId}`,
      orgId: 'org-met-3',
      billeeUserId: 'u-met-3',
      source: 'voice',
      counters: { voice_tts_chars: text.length },
    });
    expect(await tokenEvents.find({})).toHaveLength(0);

    const acts = await eventually(
      () => activityLogs.find({ category: 'voice', type: 'tts' }),
      (r) => r.length === 1,
    );
    expect(acts[0]).toMatchObject({
      userId: 'u-met-3',
      orgId: 'org-met-3',
      metadata: { source: 'voice', sessionId: ready.sessionId, provider: 'stub', lang: 'pt-PT', sheetId: 'sheet-7' },
      usageCounts: { voice_tts_chars: text.length },
    });
    // Refs only - the spoken text never reaches the audit surface.
    expect(JSON.stringify(acts[0])).not.toContain('tudo bem');
    const entry = registoEntry(acts[0] as ActivityLogDoc);
    expect(RegistoEntry.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
    expect(entry.actionType).toBe('voice.tts');
    expect(entry.usageCounts).toEqual({ voice_tts_chars: text.length });
  });

  it('a zero-usage session (opened, nothing said) writes NO ledger row', async () => {
    const token = seedUserToken('u-met-4', 'org-met-4', 'joana');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    const ready = await c.waitForJson((m) => m.type === 'ready');
    c.terminate();
    await c.waitClosed();
    await sleep(150); // give a wrong write time to land before asserting absence
    expect(await usageEvents.find({ sessionId: ready.sessionId })).toHaveLength(0);
  });
});

describe('single-writer discipline', () => {
  it('the voice module never touches a ledger collection directly - only the tracker + logActivity seams', () => {
    const voiceSrc = join(dirname(fileURLToPath(import.meta.url)), '../../src/voice');
    // Recursive walk (C5 added voice/text/): EVERY source file in the module stays covered.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    for (const file of walk(voiceSrc)) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} must not reference ledger stores`).not.toMatch(/usageEvents|tokenEvents|activityLogs|billingAccounts/);
      expect(source, `${file} must not import data/stores`).not.toContain('data/stores');
    }
  });
});
