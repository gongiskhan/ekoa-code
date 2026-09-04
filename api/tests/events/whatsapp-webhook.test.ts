import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { triggers, webhookAudit, eventQueue, integrationConfigs } from '../../src/data/stores.js';
import { createTrigger } from '../../src/events/service.js';
import { createConfig } from '../../src/integrations/service.js';
import { refreshDefinitions, getDefinition } from '../../src/integrations/definitions.js';
import { hooksRouter } from '../../src/routes/hooks.js';
import {
  setDeliveryTargets,
  startDelivery,
  stopDelivery,
  __resetDeliveryForTests,
} from '../../src/events/delivery.js';
import type { QueuedEvent } from '../../src/events/queue.js';
import {
  extractWhatsAppMessages,
  hydrateWhatsAppMessages,
  isWhatsAppSource,
  whatsAppDedupKey,
  type MessageInput,
} from '../../src/integrations/event-sources/whatsapp-hydrate.js';
import {
  buildArtifactBackendInputs,
  type DispatchInputDeps,
  type DispatchTrigger,
} from '../../src/integrations/event-sources/dispatch-input.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * WhatsApp inbound rail (2A-S3). Ported + adapted from ekoa-dev
 * (cortex/tests/event-sourcing/whatsapp-webhook.test.ts), retargeted at ekoa-code's ingress
 * (events/service.ts handleIngress behind the real /hooks/:triggerId router) and its ASYNC stores.
 *
 * The LOAD-BEARING classes, all driven over the REAL wire (raw bytes + the real
 * `X-Hub-Signature-256` header + the real raw-body parser + the real Mongo-backed stores):
 *   (a) SIGNATURE — a correctly-signed envelope is ACCEPTED, and the secret that verifies it is the
 *       OWNER's `app_secret` credential (`webhookConfig.secretSource.credentialField`), NOT the
 *       trigger's own generated secret. A forged/wrong-secret signature, a tampered body, an absent
 *       header, and a missing credential are all REJECTED (never enqueued, never leaking a secret).
 *   (b) DEDUP — a duplicate wamid is deduped (including a RE-SERIALISED retry with different bytes),
 *       while a later batch [m1,m2] that re-includes m1 is still dispatched so m2 is never lost.
 *   (c) STATUSES-ONLY — accepted + enqueued + audited, then dispatched as a NO-OP: zero backend
 *       invocations and the queue row ends `delivered` (not an error, not a dropped event).
 *   (d) HYDRATION — extractWhatsAppMessages flattens text / media / batch envelopes and never
 *       throws; hydrateWhatsAppMessages parses the queue's JSON-TEXT payload (the 2A-S2 lesson:
 *       the wired path stores a STRING, so a pre-parsed fixture would hide a broken wiring).
 *
 * LLM-free + hermetic. Live Meta verification (a real Business app + a registered webhook) is an
 * external-credential step and is NOT exercised here.
 */

let mem: MongoMemoryServer;
let dataRoot: string;
let server: Server;
let port = 0;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = { userId: 'owner-1', orgId: 'orgA', role: 'user' as const };

const APP_SECRET = 'test-app-secret-xyz';
const TRIGGER_SECRET = 'the-triggers-own-secret';
const PHONE_NUMBER_ID = '109876543210';
const SENDER = '351912345678';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  // Hermetic definitions: the BASELINE tier is the real shipped api/assets/integrations (we want
  // the actual whatsapp package under test); the RUNTIME tier is pointed at an empty temp dir so a
  // developer's local user-created package can never shadow it.
  dataRoot = mkdtempSync(join(tmpdir(), 'ekoa-wa-'));
  process.env.EKOA_DATA_DIR = dataRoot;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_whatsapp');
  const app = express();
  app.use('/hooks', hooksRouter(deps));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.EKOA_DATA_DIR;
  refreshDefinitions();
  rmSync(dataRoot, { recursive: true, force: true });
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  for (const s of [triggers, webhookAudit, eventQueue, integrationConfigs]) await s.deleteMany({});
});

afterEach(async () => {
  await stopDelivery(0);
  __resetDeliveryForTests();
});

// ---------------------------------------------------------------------------
// Canonical Meta WhatsApp webhook envelopes (carried from the dev suite)
// ---------------------------------------------------------------------------

function textMessageEnvelope(overrides?: {
  wamid?: string;
  body?: string;
  name?: string;
  timestamp?: string;
}): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '351911111111', phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: overrides?.name ?? 'Ana Silva' }, wa_id: SENDER }],
              messages: [
                {
                  from: SENDER,
                  id: overrides?.wamid ?? 'wamid.TEST1',
                  timestamp: overrides?.timestamp ?? '1719939600',
                  type: 'text',
                  text: { body: overrides?.body ?? 'Olá, preciso de ajuda com um processo.' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function imageMessageEnvelope(caption?: string): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: 'Bruno Costa' }, wa_id: SENDER }],
              messages: [
                {
                  from: SENDER,
                  id: 'wamid.IMG1',
                  timestamp: '1719939700',
                  type: 'image',
                  image: {
                    id: 'MEDIA-999',
                    mime_type: 'image/jpeg',
                    sha256: 'abc',
                    ...(caption !== undefined ? { caption } : {}),
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function statusesOnlyEnvelope(): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              statuses: [
                { id: 'wamid.OUT1', status: 'delivered', timestamp: '1719939800', recipient_id: SENDER },
              ],
            },
          },
        ],
      },
    ],
  };
}

function batchEnvelope(): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: 'Carla' }, wa_id: SENDER }],
              messages: [
                { from: SENDER, id: 'wamid.A', timestamp: '1719939600', type: 'text', text: { body: 'primeira' } },
                { from: SENDER, id: 'wamid.B', timestamp: '1719939601', type: 'text', text: { body: 'segunda' } },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Two-message envelope whose FIRST message id equals `firstId` (the batch-loss trap). */
function twoMessageEnvelopeSharingFirst(firstId: string, secondId: string): Record<string, unknown> {
  const env = batchEnvelope() as { entry: { changes: { value: { messages: { id: string }[] } }[] }[] };
  const msgs = env.entry[0]!.changes[0]!.value.messages;
  msgs[0]!.id = firstId;
  msgs[1]!.id = secondId;
  return env;
}

// ---------------------------------------------------------------------------
// Wire helpers — the exact bytes + the exact header Meta sends
// ---------------------------------------------------------------------------

const metaSign = (secret: string, raw: Buffer) =>
  'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

/** POST raw bytes at the REAL /hooks/:triggerId route (raw-body parser + header extraction). */
async function post(triggerId: string, raw: Buffer, signature?: string) {
  const res = await fetch(`http://127.0.0.1:${port}/hooks/${triggerId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'X-Hub-Signature-256': signature } : {}),
    },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Deliver a SIGNED envelope the way Meta would (bytes → signature over those bytes). */
async function deliver(triggerId: string, envelope: unknown, secret = APP_SECRET) {
  const raw = Buffer.from(JSON.stringify(envelope), 'utf8');
  return post(triggerId, raw, metaSign(secret, raw));
}

async function seedWhatsApp(opts: { credential?: boolean; disabled?: boolean } = {}) {
  if (opts.credential !== false) {
    await createConfig(
      actor,
      {
        integrationKey: 'whatsapp',
        configValues: {
          access_token: 'tok',
          phone_number_id: PHONE_NUMBER_ID,
          app_secret: APP_SECRET,
          graph_base_url: 'https://graph.facebook.com/v20.0',
        },
      },
      deps,
    );
  }
  const { trigger } = await createTrigger(
    actor,
    {
      targetKind: 'artifact-backend',
      integrationKey: 'whatsapp',
      eventName: 'message.received',
      artifactId: 'art-1',
      entrypoint: 'onMessage',
      secret: TRIGGER_SECRET,
    },
    deps,
  );
  if (opts.disabled) await triggers.update(trigger._id, (t) => ({ ...t, disabled: true }));
  return trigger._id;
}

const queued = () => eventQueue.find({}) as Promise<QueuedEvent[]>;
const outcomes = async () => (await webhookAudit.find({})).map((a) => a.outcome);

// ---------------------------------------------------------------------------
// (0) The SHIPPED whatsapp package — drift guard on the declarations the rail reads
// ---------------------------------------------------------------------------

describe('shipped whatsapp integration package', () => {
  it('declares the app_secret credential-field secret source and Meta signature header', () => {
    const def = getDefinition('whatsapp');
    expect(def).toBeTruthy();
    expect(def!.webhookConfig?.secretSource).toEqual({ credentialField: 'app_secret' });
    expect(def!.webhookConfig?.verifySignature).toMatchObject({ headerName: 'X-Hub-Signature-256' });
    // No dedupKey declaration: the ingress derives the key from the wamids (a single dot-path
    // field cannot identify an envelope that BATCHES messages). See the dedup block below.
    expect(def!.webhookConfig?.dedupKey).toBeUndefined();
    // app_secret is a required, secret credential field on the shipped config schema.
    const raw = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'integrations', 'whatsapp', 'config.json'),
        'utf8',
      ),
    ) as { configSchema: Array<{ key: string; required?: boolean; secret?: boolean }> };
    expect(raw.configSchema.find((f) => f.key === 'app_secret')).toMatchObject({ required: true, secret: true });
  });
});

// ---------------------------------------------------------------------------
// (a) SIGNATURE — the credential-field secret is the one that verifies
// ---------------------------------------------------------------------------

describe('WhatsApp ingress signature (X-Hub-Signature-256 over the raw bytes)', () => {
  it('ACCEPTS an envelope signed with the OWNER app_secret and enqueues it exactly once', async () => {
    const id = await seedWhatsApp();
    const res = await deliver(id, textMessageEnvelope());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.triggerId).toBe(id);
    expect(await outcomes()).toEqual(['accepted']);
  });

  it('REJECTS a forged signature (signed with a wrong secret) — 401, nothing enqueued', async () => {
    const id = await seedWhatsApp();
    const res = await deliver(id, textMessageEnvelope(), 'the-wrong-secret');
    expect(res.status).toBe(401);
    expect(await queued()).toHaveLength(0);
    expect(await outcomes()).toEqual(['rejected_signature']);
  });

  it('REJECTS a signature made with the TRIGGER secret (proves the credential field is the source)', async () => {
    // Without secretSource honoured on the POST path this is the ONLY signature that would verify —
    // and every real Meta delivery (signed with app_secret) would 401 forever. This assertion is
    // the load-bearing one: the trigger secret must NOT be accepted for a whatsapp trigger.
    const id = await seedWhatsApp();
    const res = await deliver(id, textMessageEnvelope(), TRIGGER_SECRET);
    expect(res.status).toBe(401);
    expect(await queued()).toHaveLength(0);
  });

  it('REJECTS a TAMPERED body carrying an otherwise-valid signature', async () => {
    const id = await seedWhatsApp();
    const original = Buffer.from(JSON.stringify(textMessageEnvelope({ body: 'original' })), 'utf8');
    const tampered = Buffer.from(JSON.stringify(textMessageEnvelope({ body: 'tampered' })), 'utf8');
    const res = await post(id, tampered, metaSign(APP_SECRET, original));
    expect(res.status).toBe(401);
    expect(await queued()).toHaveLength(0);
  });

  it('REJECTS a delivery with NO signature header', async () => {
    const id = await seedWhatsApp();
    const res = await post(id, Buffer.from(JSON.stringify(textMessageEnvelope()), 'utf8'));
    expect(res.status).toBe(401);
    expect(await queued()).toHaveLength(0);
  });

  it('FAILS CLOSED (500, nothing enqueued, no secret echoed) when the app_secret credential is absent', async () => {
    const id = await seedWhatsApp({ credential: false });
    const res = await deliver(id, textMessageEnvelope());
    expect(res.status).toBe(500);
    expect(await queued()).toHaveLength(0);
    expect(await outcomes()).toEqual(['rejected_other']);
    // The response names no credential and carries no secret material.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(APP_SECRET);
    expect(serialized).not.toContain(TRIGGER_SECRET);
    expect(serialized).not.toContain('app_secret');
  });

  it('keeps the invariant-9 ordering: a disabled trigger is 410 on a VALID signature, 401 on an invalid one', async () => {
    const id = await seedWhatsApp({ disabled: true });
    expect((await deliver(id, textMessageEnvelope())).status).toBe(410);
    expect((await deliver(id, textMessageEnvelope(), 'nope')).status).toBe(401);
    expect(await queued()).toHaveLength(0);
  });

  it('a non-whatsapp trigger still verifies against its OWN secret (no regression)', async () => {
    const { trigger } = await createTrigger(
      actor,
      { targetKind: 'automation', integrationKey: 'gh', eventName: 'push', automationId: 'a1', secret: 'shh' },
      deps,
    );
    const raw = Buffer.from('{"event":"push"}', 'utf8');
    expect((await post(trigger._id, raw, metaSign('shh', raw))).status).toBe(200);
    expect((await post(trigger._id, raw, metaSign(APP_SECRET, raw))).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// (b) DEDUP — the wamid-derived key
// ---------------------------------------------------------------------------

describe('WhatsApp envelope dedup (wamid-derived key)', () => {
  it('a byte-identical replay of the same wamid is DEDUPED (200 duplicate, still one row)', async () => {
    const id = await seedWhatsApp();
    const env = textMessageEnvelope({ wamid: 'wamid.m1' });
    expect((await deliver(id, env)).status).toBe(200);
    const second = await deliver(id, env);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ duplicate: true });
    expect(await queued()).toHaveLength(1);
    expect(await outcomes()).toEqual(['accepted', 'duplicate']);
  });

  it('a RE-SERIALISED retry of the same wamid (different bytes) is still DEDUPED', async () => {
    // The body hash alone would NOT collapse this: the key ordering differs, so the bytes differ.
    // The wamid set is identical, so the derived key is identical.
    const id = await seedWhatsApp();
    const env = textMessageEnvelope({ wamid: 'wamid.m1' });
    const reordered = { entry: (env as { entry: unknown }).entry, object: (env as { object: unknown }).object };
    const rawA = Buffer.from(JSON.stringify(env), 'utf8');
    const rawB = Buffer.from(JSON.stringify(reordered), 'utf8');
    expect(rawA.equals(rawB)).toBe(false); // genuinely different bytes

    expect((await post(id, rawA, metaSign(APP_SECRET, rawA))).status).toBe(200);
    const retry = await post(id, rawB, metaSign(APP_SECRET, rawB));
    expect(retry.body).toEqual({ duplicate: true });
    expect(await queued()).toHaveLength(1);
  });

  it('a batch [m1,m2] arriving after [m1] is DISPATCHED — m2 is never lost', async () => {
    const id = await seedWhatsApp();
    expect((await deliver(id, textMessageEnvelope({ wamid: 'wamid.m1' }))).status).toBe(200);
    const batch = await deliver(id, twoMessageEnvelopeSharingFirst('wamid.m1', 'wamid.m2'));
    expect(batch.body).toEqual({ accepted: true });
    const rows = await queued();
    expect(rows).toHaveLength(2);
    // …and the second row hydrates to BOTH messages, so m2 reaches the backend.
    const ids = hydrateWhatsAppMessages(rows.find((r) => r.dedupKey !== rows[0]!.dedupKey)?.payload ?? rows[1]!.payload)
      .map((m) => m.id);
    expect(ids).toEqual(['wamid.m1', 'wamid.m2']);
  });

  it('derives the key from the wamid SET: order-independent, distinct per message set, bounded', () => {
    const one = whatsAppDedupKey(JSON.stringify(textMessageEnvelope({ wamid: 'wamid.m1' })));
    const oneAgain = whatsAppDedupKey(textMessageEnvelope({ wamid: 'wamid.m1' }));
    const two = whatsAppDedupKey(JSON.stringify(twoMessageEnvelopeSharingFirst('wamid.m1', 'wamid.m2')));
    const twoSwapped = whatsAppDedupKey(JSON.stringify(twoMessageEnvelopeSharingFirst('wamid.m2', 'wamid.m1')));
    expect(one).toBe(oneAgain); // Buffer/string/object forms agree
    expect(one).not.toBe(two); // a first-message-id key would have collided here and lost m2
    expect(two).toBe(twoSwapped); // order-independent
    expect(one).toMatch(/^wamid:[0-9a-f]{64}$/); // bounded — the queue _id is triggerId::dedupKey
    // …and the canonical form is INJECTIVE: a single id that CONTAINS the old '\n' join separator
    // must not collapse onto the two-id set (a delimiter join made these two identical).
    const separatorInjection = whatsAppDedupKey(textMessageEnvelope({ wamid: 'wamid.m1\nwamid.m2' }));
    expect(separatorInjection).not.toBe(two);
  });

  it('falls back to the body hash when there is no wamid (statuses-only, malformed)', async () => {
    expect(whatsAppDedupKey(JSON.stringify(statusesOnlyEnvelope()))).toBeNull();
    expect(whatsAppDedupKey('{ not json')).toBeNull();
    expect(whatsAppDedupKey(undefined)).toBeNull();
    // …and the ingress still enqueues such a delivery once, keyed on the body hash.
    const id = await seedWhatsApp();
    const raw = Buffer.from(JSON.stringify(statusesOnlyEnvelope()), 'utf8');
    await post(id, raw, metaSign(APP_SECRET, raw));
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupKey).toBe(createHash('sha256').update(raw).digest('hex'));
    expect((await post(id, raw, metaSign(APP_SECRET, raw))).body).toEqual({ duplicate: true });
    expect(await queued()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (c) DISPATCH — the REAL queue-stored payload, fan-out, and the statuses-only no-op
// ---------------------------------------------------------------------------

/** Mirrors server.ts's invokeArtifactBackend delivery target: build the inputs from the queue-
 *  stored payload, invoke the backend once per input, succeed on zero. Only the artifact-runtime
 *  call is a spy — the queue, the delivery pipeline and the input builder are the real ones. */
function wireDelivery(invoke: (input: unknown) => Promise<{ ok: boolean; error?: string }>) {
  const dispatchDeps: DispatchInputDeps = {
    hydrateEmail: async () => {
      throw new Error('email hydration must not be reached for a whatsapp source');
    },
  };
  setDeliveryTargets({
    startAutomationRun: async () => ({ ok: false, reason: 'not used' }),
    invokeArtifactBackend: async (_artifactId, _entrypoint, event) => {
      try {
        const inputs = await buildArtifactBackendInputs(
          { id: event.trigger._id, integrationKey: event.trigger.integrationKey, eventName: event.trigger.eventName },
          event.payload,
          dispatchDeps,
        );
        for (const input of inputs) {
          const r = await invoke(input);
          if (!r.ok) return { ok: false, reason: r.error ?? 'backend handler reported failure' };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'backend invoke failed' };
      }
    },
  });
}

/** Poll until the single queue row leaves `pending`/`dispatching` (bounded). */
async function settledRow(): Promise<QueuedEvent> {
  for (let i = 0; i < 120; i++) {
    const row = (await eventQueue.find({}))[0] as QueuedEvent | undefined;
    if (row && row.attempts > 0 && row.status !== 'dispatching') return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return (await eventQueue.find({}))[0] as QueuedEvent;
}

describe('WhatsApp dispatch (the REAL wired path: JSON-TEXT payload → fan-out)', () => {
  it('the ingress stores the payload as JSON TEXT — the exact bytes, not a parsed object', async () => {
    const id = await seedWhatsApp();
    const env = textMessageEnvelope({ wamid: 'wamid.STORED' });
    const raw = Buffer.from(JSON.stringify(env), 'utf8');
    await post(id, raw, metaSign(APP_SECRET, raw));
    const row = (await queued())[0]!;
    expect(typeof row.payload).toBe('string');
    expect(row.payload).toBe(raw.toString('utf8'));
    // Handing THAT value to the builder must produce the message (a total extractor would have
    // silently returned [] here — the 2A-S2 wiring-bug class).
    const inputs = await buildArtifactBackendInputs(
      { id, integrationKey: 'whatsapp', eventName: 'message.received' },
      row.payload,
      { hydrateEmail: async () => { throw new Error('unused'); } },
    );
    expect(inputs).toHaveLength(1);
    expect((inputs[0] as MessageInput).id).toBe('wamid.STORED');
    expect((inputs[0] as MessageInput).channel).toBe('whatsapp');
  });

  it('FANS OUT a two-message envelope into one backend invocation per message', async () => {
    const id = await seedWhatsApp();
    const seen: MessageInput[] = [];
    wireDelivery(async (input) => { seen.push(input as MessageInput); return { ok: true }; });
    await startDelivery(deps.now);
    await deliver(id, batchEnvelope());
    const row = await settledRow();
    expect(row.status).toBe('delivered');
    expect(seen.map((m) => m.id)).toEqual(['wamid.A', 'wamid.B']);
    expect(seen.map((m) => m.text)).toEqual(['primeira', 'segunda']);
  });

  it('a statuses-only notification is a DISPATCHED NO-OP: zero invocations, row delivered', async () => {
    const id = await seedWhatsApp();
    const invoke = vi.fn(async () => ({ ok: true }));
    wireDelivery(invoke);
    await startDelivery(deps.now);
    const res = await deliver(id, statusesOnlyEnvelope());
    expect(res.status).toBe(200); // not an error at ingress…
    const row = await settledRow();
    expect(row.status).toBe('delivered'); // …and not a dropped or failing event at dispatch
    expect(invoke).not.toHaveBeenCalled();
    expect(await outcomes()).toEqual(['accepted']);
  });

  it('a backend failure mid-batch FAILS the whole delivery (the retry re-invokes; backend dedupes on wamid)', async () => {
    const id = await seedWhatsApp();
    const seen: string[] = [];
    wireDelivery(async (input) => {
      const m = input as MessageInput;
      seen.push(m.id);
      return m.id === 'wamid.B' ? { ok: false, error: 'backend blew up' } : { ok: true };
    });
    await startDelivery(deps.now);
    await deliver(id, batchEnvelope());
    const row = await settledRow();
    expect(row.status).toBe('pending'); // re-armed on the retry schedule, not delivered, not dead
    expect(row.lastError).toBe('backend blew up');
    expect(seen).toEqual(['wamid.A', 'wamid.B']);
  });

  it('a corrupt (non-JSON) whatsapp payload THROWS rather than masquerading as a statuses-only no-op', async () => {
    await expect(
      buildArtifactBackendInputs(
        { id: 't', integrationKey: 'whatsapp', eventName: 'message.received' } satisfies DispatchTrigger,
        '{ not json',
        { hydrateEmail: async () => { throw new Error('unused'); } },
      ),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('a non-whatsapp source gets the generic { event, trigger } envelope with the JSON-text payload PARSED', async () => {
    // The generic branch parses the queue's JSON-text payload back to its object (like the email /
    // whatsapp branches) so `event` is structured, not a raw string - the fix for the empty-inbox
    // bug where onNotificacaoCitius read event.processo off a string. See dispatch-target.test.ts.
    const inputs = await buildArtifactBackendInputs(
      { id: 'trg-7', integrationKey: 'stripe', eventName: 'payment.succeeded' },
      '{"amount":100}',
      { hydrateEmail: async () => { throw new Error('unused'); } },
    );
    expect(inputs).toEqual([{ event: { amount: 100 }, trigger: { id: 'trg-7', eventName: 'payment.succeeded' } }]);
  });
});

// ---------------------------------------------------------------------------
// (d) HYDRATION — extractWhatsAppMessages (ported verbatim from the dev suite)
// ---------------------------------------------------------------------------

describe('extractWhatsAppMessages', () => {
  it('flattens a text message with sender name, phone number id and ISO timestamp', () => {
    const msgs = extractWhatsAppMessages(textMessageEnvelope({ wamid: 'wamid.T', body: 'preciso de ajuda', name: 'Ana Silva' }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      channel: 'whatsapp',
      id: 'wamid.T',
      from: SENDER,
      name: 'Ana Silva',
      text: 'preciso de ajuda',
      phoneNumberId: PHONE_NUMBER_ID,
    });
    expect(msgs[0]!.media).toBeUndefined();
    expect(msgs[0]!.timestamp).toBe(new Date(1719939600 * 1000).toISOString());
    expect(msgs[0]!.raw).toBeTruthy();
  });

  it('uses the caption as text and attaches a media ref for an image with a caption', () => {
    const msgs = extractWhatsAppMessages(imageMessageEnvelope('vejam a fotografia'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe('vejam a fotografia');
    expect(msgs[0]!.media).toEqual({ id: 'MEDIA-999', mimeType: 'image/jpeg', kind: 'image' });
  });

  it('degrades to a PT [imagem] marker for an image with no caption (still attaches media)', () => {
    const msgs = extractWhatsAppMessages(imageMessageEnvelope(undefined));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe('[imagem]');
    expect(msgs[0]!.media).toEqual({ id: 'MEDIA-999', mimeType: 'image/jpeg', kind: 'image' });
  });

  it('returns [] for a statuses-only notification', () => {
    expect(extractWhatsAppMessages(statusesOnlyEnvelope())).toEqual([]);
  });

  it('returns one MessageInput per message in a batch of two', () => {
    const msgs = extractWhatsAppMessages(batchEnvelope());
    expect(msgs.map((m) => m.id)).toEqual(['wamid.A', 'wamid.B']);
    expect(msgs.map((m) => m.text)).toEqual(['primeira', 'segunda']);
  });

  it('never throws on malformed / partial payloads', () => {
    expect(extractWhatsAppMessages(undefined)).toEqual([]);
    expect(extractWhatsAppMessages(null)).toEqual([]);
    expect(extractWhatsAppMessages('not-json')).toEqual([]);
    expect(extractWhatsAppMessages({})).toEqual([]);
    expect(extractWhatsAppMessages({ entry: 'nope' })).toEqual([]);
    expect(extractWhatsAppMessages({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
    expect(extractWhatsAppMessages({ entry: [{ changes: [{ value: { messages: [{}] } }] }] })).toEqual([]);
  });

  it('never throws on a nonsense timestamp (out-of-range Date would RangeError)', () => {
    const msgs = extractWhatsAppMessages(textMessageEnvelope({ timestamp: '1e300' }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.timestamp).toBe('');
  });

  it('isWhatsAppSource recognises the whatsapp integration key only', () => {
    expect(isWhatsAppSource({ integrationKey: 'whatsapp' })).toBe(true);
    expect(isWhatsAppSource({ integrationKey: 'stripe' })).toBe(false);
  });

  it('hydrateWhatsAppMessages accepts the stored JSON STRING and the parsed object alike', () => {
    const env = batchEnvelope();
    expect(hydrateWhatsAppMessages(JSON.stringify(env)).map((m) => m.id)).toEqual(['wamid.A', 'wamid.B']);
    expect(hydrateWhatsAppMessages(env).map((m) => m.id)).toEqual(['wamid.A', 'wamid.B']);
    expect(hydrateWhatsAppMessages(JSON.stringify(statusesOnlyEnvelope()))).toEqual([]);
    expect(() => hydrateWhatsAppMessages('{ not json')).toThrow(/not valid JSON/);
  });
});
