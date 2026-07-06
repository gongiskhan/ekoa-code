import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { triggers, webhookAudit, eventQueue } from '../../src/data/stores.js';
import { handleIngress, createTrigger } from '../../src/events/service.js';
import { verifyHmac, safeEqual, hubChallenge } from '../../src/events/webhook-verifiers.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/** Webhook HMAC pipeline (ch09 invariant 9): verify, disabled-after-signature, dedup, audit. */
let mem: MongoMemoryServer; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = { userId: 'u1', orgId: 'orgA', role: 'builder' as const };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_g5');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { for (const s of [triggers, webhookAudit, eventQueue]) await s.deleteMany({}); });

function sign(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

describe('webhook verifiers (pure)', () => {
  it('verifies a correct HMAC and rejects a wrong one', () => {
    const body = Buffer.from('{"a":1}');
    const sig = createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifyHmac('hmac-sha256-hex', 'secret', body, sig)).toBe(true);
    expect(verifyHmac('hmac-sha256-hex', 'secret', body, 'sha256=' + sig)).toBe(true); // prefix stripped
    expect(verifyHmac('hmac-sha256-hex', 'wrong', body, sig)).toBe(false);
  });
  it('safeEqual is length-safe', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('hub-challenge echoes only on a matching token (timing-safe)', () => {
    expect(hubChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': 'C' }, 'tok')).toBe('C');
    expect(hubChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': 'C' }, 'tok')).toBeNull();
  });
});

describe('ingress pipeline (ch09 invariant 9)', () => {
  async function mkTrigger(disabled = false) {
    const { trigger, secret } = await createTrigger(actor, { targetKind: 'automation', integrationKey: 'gh', eventName: 'push', secret: 'shh' }, deps);
    if (disabled) await triggers.update(trigger._id, (t) => ({ ...t, disabled: true }));
    return { id: trigger._id, secret: secret! };
  }

  it('accepts a valid signature and audits accepted', async () => {
    const { id } = await mkTrigger();
    const body = '{"event":"push"}';
    const res = await handleIngress(id, Buffer.from(body), sign('shh', body), deps);
    expect(res.status).toBe(200);
    expect(res.outcome).toBe('accepted');
    expect((await webhookAudit.find({ triggerId: id }))[0]).toMatchObject({ outcome: 'accepted' });
  });

  it('rejects an invalid signature with 401 (audited)', async () => {
    const { id } = await mkTrigger();
    const res = await handleIngress(id, Buffer.from('{}'), 'sha256=deadbeef', deps);
    expect(res.status).toBe(401);
    expect(res.outcome).toBe('rejected_signature');
  });

  it('disabled endpoint: VALID signature → 410, INVALID → 401 (ordering)', async () => {
    const { id } = await mkTrigger(true);
    const body = '{"x":1}';
    const valid = await handleIngress(id, Buffer.from(body), sign('shh', body), deps);
    expect(valid.status).toBe(410);
    expect(valid.outcome).toBe('rejected_disabled');
    const invalid = await handleIngress(id, Buffer.from(body), 'sha256=bad', deps);
    expect(invalid.status).toBe(401); // invalid sig is still 401, never 410
  });

  it('dedup: a replayed delivery returns 200 {duplicate:true}', async () => {
    const { id } = await mkTrigger();
    const body = '{"delivery":"abc"}';
    const sig = sign('shh', body);
    const first = await handleIngress(id, Buffer.from(body), sig, deps);
    expect(first.outcome).toBe('accepted');
    const second = await handleIngress(id, Buffer.from(body), sig, deps);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ duplicate: true });
    expect(second.outcome).toBe('duplicate');
    // exactly one queued event
    expect(await eventQueue.find({ triggerId: id })).toHaveLength(1);
  });

  it('unknown trigger → audited rejected_unknown_trigger', async () => {
    const res = await handleIngress('nope', Buffer.from('{}'), 'sha256=x', deps);
    expect(res.status).toBe(404);
    expect(res.outcome).toBe('rejected_unknown_trigger');
  });

  it('an audit row is written for every outcome class', async () => {
    const { id } = await mkTrigger();
    const body = '{"y":2}';
    await handleIngress(id, Buffer.from(body), sign('shh', body), deps); // accepted
    await handleIngress(id, Buffer.from(body), sign('shh', body), deps); // duplicate
    await handleIngress(id, Buffer.from('{}'), 'sha256=bad', deps); // rejected_signature
    const outcomes = new Set((await webhookAudit.find({})).map((a) => a.outcome));
    expect(outcomes).toContain('accepted');
    expect(outcomes).toContain('duplicate');
    expect(outcomes).toContain('rejected_signature');
  });
});
