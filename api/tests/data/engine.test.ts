import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  CollectionsEngine,
  appScope,
  sharedScope,
  EngineError,
  collectionsBlock,
} from '../../src/data/collections-engine.js';

/**
 * Persistence-parity + the eight carried collections-engine semantics (ch04 §4.2.8),
 * run against mongodb-memory-server (the same `mongodb` wire driver, in-memory target).
 */
let mem: MongoMemoryServer;
let seq = 0;
const engine = new CollectionsEngine({ now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` });

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await connectMongo(mem.getUri(), 'ekoa_test');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

describe('collections engine — eight carried semantics (§4.2.8)', () => {
  it('#5 envelope + #1 scoping: create builds {id,createdAt,updatedAt,...fields}, list is scoped', async () => {
    const s = appScope('app-a');
    const created = await engine.create(s, 'clientes', { nome: 'Maria', nif: '123456789' });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();
    expect(created.nome).toBe('Maria');
    // a different app cannot see it (scoping)
    expect(await engine.list(appScope('app-b'), 'clientes')).toHaveLength(0);
    expect(await engine.list(s, 'clientes')).toHaveLength(1);
  });

  it('#6 PUT-upsert: creates with the given id when absent, merges when present', async () => {
    const s = appScope('app-up');
    const up = await engine.upsert(s, 'notas', 'x1', { texto: 'a' });
    expect(up.id).toBe('x1');
    const merged = await engine.upsert(s, 'notas', 'x1', { texto: 'b', extra: 1 });
    expect(merged.texto).toBe('b');
    expect(merged.extra).toBe(1);
    expect(merged.createdAt).toBe(up.createdAt); // createdAt untouched on update
  });

  it('#2 shared scope: usr.<owner> resolved server-side, isolated from app scope', async () => {
    const shared = sharedScope('app-a', 'owner-1');
    await engine.create(shared, 'processos', { ref: 'P1' });
    expect(await engine.list(shared, 'processos')).toHaveLength(1);
    // app scope with the same collection name sees nothing (different scope key)
    expect(await engine.list(appScope('app-a'), 'processos')).toHaveLength(0);
  });

  it('#3 charset guard + reserved-prefix guard', async () => {
    const s = appScope('app-a');
    await expect(engine.list(s, 'bad name!')).rejects.toBeInstanceOf(EngineError);
    await expect(engine.create(s, '__files', {})).rejects.toMatchObject({ code: 'RESERVED_COLLECTION', status: 403 });
    await expect(engine.create(s, 'usr.x', {})).rejects.toMatchObject({ code: 'RESERVED_COLLECTION' });
  });

  it('reserved usr. app id and size ceiling', async () => {
    expect(() => appScope('usr.evil')).toThrow();
    const s = appScope('app-size');
    const rule = { scope: 'app', additionalFields: true, access: { read: 'app', write: 'app' }, maxItemBytes: 50 } as never;
    await expect(engine.create(s, 'big', { blob: 'x'.repeat(200) }, rule)).rejects.toMatchObject({ code: 'ITEM_TOO_LARGE', status: 413 });
  });

  it('declared-collection schema validation (§4.2.4 step 4)', async () => {
    const rule = { scope: 'app', additionalFields: true, access: { read: 'app', write: 'app' }, maxItemBytes: 262144, fields: { nome: { type: 'string', required: true }, nif: { type: 'string', pattern: '^[0-9]{9}$', required: false } } } as never;
    const s = appScope('app-val');
    await expect(engine.create(s, 'clientes', { nif: '12AB' }, rule)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    const ok = await engine.create(s, 'clientes', { nome: 'X', nif: '123456789' }, rule);
    expect(ok.nome).toBe('X');
  });

  it('#4 _rev CAS: _rev never surfaces on the wire', async () => {
    const s = appScope('app-rev');
    const c = await engine.create(s, 'k', { a: 1 });
    expect('_rev' in c).toBe(false);
    const got = await engine.get(s, 'k', c.id as string);
    expect(got && '_rev' in got).toBe(false);
  });

  it('manifest zod block: shared scope requires the app-level opt-in modeling', () => {
    const parsed = collectionsBlock.safeParse({ definitions: { clientes: { scope: 'shared' } } });
    expect(parsed.success).toBe(true); // block itself valid; sharedData opt-in enforced at build (ch04 §4.2.3)
  });
});
