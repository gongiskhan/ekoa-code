/**
 * Citius insolvência-publications watcher (mega-run E4, BRIEF §8 item 4). Same two-half
 * split as portal-connectors.test.ts:
 *  - `fetchInsolvenciaPublicacoes` parse/fetch-seam unit tests against the committed
 *    fixtures (api/tests/e2e/fixtures/citius-insolvencia-v{1,2}.html) - no mongo.
 *  - `pollInsolvencyWatches` end-to-end over a real CollectionsEngine
 *    (mongodb-memory-server, the portal.test.ts harness): registers a watch, polls, asserts
 *    the watch.hit eventos row + refs-only activity row land on the right dossiê, idempotent
 *    on a re-poll of the same fixture, emits only the delta on a poll with a new publication,
 *    and rejects cross-org callers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { CollectionsEngine, sharedScope } from '../../src/data/collections-engine.js';
import { activityLogs } from '../../src/data/stores.js';
import type { ActivityActor } from '../../src/data/activity.js';
import {
  pollInsolvencyWatches,
  fetchInsolvenciaPublicacoes,
  CITIUS_WATCH_COLLECTION,
  type FetchImpl,
  type FetchLikeResponse,
  type PollInsolvencyDeps,
} from '../../src/legal/insolvencia-watch.js';
import { PortalOrgMismatchError } from '../../src/legal/portal.js';
import type { ResolvedLegalApp } from '../../src/legal/access-gate.js';

const fx = (name: string): string => fileURLToPath(new URL(`../e2e/fixtures/${name}`, import.meta.url));
const v1 = readFileSync(fx('citius-insolvencia-v1.html'), 'utf-8');
const v2 = readFileSync(fx('citius-insolvencia-v2.html'), 'utf-8');

/** Build a fetchImpl seam that always answers with the given HTML body, ignoring the URL
 *  (a per-subject query result page in real life - the fixture already IS the filtered page). */
function fakeFetch(html: string, opts: { ok?: boolean; status?: number } = {}): FetchImpl {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const buf = Buffer.from(html, 'utf-8');
  return async (): Promise<FetchLikeResponse> => ({
    status,
    ok,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  });
}

describe('insolvencia-watch · fetchInsolvenciaPublicacoes (fetchImpl seam)', () => {
  it('parses the fixture into the subject\'s publicações', async () => {
    const res = await fetchInsolvenciaPublicacoes('Contraparte Exemplo, Lda', { fetchImpl: fakeFetch(v1) });
    expect(res.ok).toBe(true);
    expect(res.publicacoes).toHaveLength(1);
    expect(res.publicacoes[0]).toMatchObject({ processo: '777/26.5T8LSB', ato: 'Sentença de insolvência' });
  });

  it('the v2 fixture carries the v1 publication plus one new one', async () => {
    const res = await fetchInsolvenciaPublicacoes('Contraparte Exemplo, Lda', { fetchImpl: fakeFetch(v2) });
    expect(res.ok).toBe(true);
    expect(res.publicacoes).toHaveLength(2);
    expect(res.publicacoes[1]!.ato).toBe('Convocatória de credores');
  });

  it('an empty subject -> clean PT error, no fetch attempted', async () => {
    const res = await fetchInsolvenciaPublicacoes('   ', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Sujeito de vigilância em falta');
  });

  it('a non-2xx upstream -> clean PT "indisponível"', async () => {
    const res = await fetchInsolvenciaPublicacoes('X', { fetchImpl: fakeFetch('', { ok: false, status: 500 }) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Publicações de insolvência indisponíveis');
  });

  it('a thrown fetch -> clean PT "indisponível", never a raw throw', async () => {
    const res = await fetchInsolvenciaPublicacoes('X', {
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Publicações de insolvência indisponíveis');
  });
});

describe('pollInsolvencyWatches (attach onto a real dossiê)', () => {
  let mem: MongoMemoryServer;
  let seq = 0;
  const clock = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
  const engine = new CollectionsEngine(clock);
  const OWNER_ORG: Record<string, string> = { 'owner-a': 'org-a', 'owner-b': 'org-b' };

  const APP_A: ResolvedLegalApp = { appId: 'legal-dossie', ownerUserId: 'owner-a' };
  const ACTOR_A: ActivityActor = { userId: 'owner-a', username: 'legal-dossie', orgId: 'org-a' };
  const ACTOR_WRONG_ORG: ActivityActor = { userId: 'u2', username: 'bruno', orgId: 'org-b' };

  const baseDeps = (fetchImpl: FetchImpl): PollInsolvencyDeps => ({
    ...clock,
    fetchImpl,
    getOwnerOrgId: async (ownerUserId: string) => OWNER_ORG[ownerUserId] ?? null,
    createDocumento: (app, row) => engine.create(sharedScope(app.appId, app.ownerUserId), 'documentos', row),
    createEvento: (app, row) => engine.create(sharedScope(app.appId, app.ownerUserId), 'eventos', row),
    listDocumentos: async (app, processoId) =>
      (await engine.list(sharedScope(app.appId, app.ownerUserId), 'documentos')).filter((r) => r.processoId === processoId),
    listEventos: async (app, processoId) =>
      (await engine.list(sharedScope(app.appId, app.ownerUserId), 'eventos')).filter((r) => r.processoId === processoId),
    listWatches: async (app, processoId) =>
      (await engine.list(sharedScope(app.appId, app.ownerUserId), CITIUS_WATCH_COLLECTION)).filter((r) => r.processoId === processoId),
    updateWatch: async (app, watchId, patch) => {
      await engine.upsert(sharedScope(app.appId, app.ownerUserId), CITIUS_WATCH_COLLECTION, watchId, patch);
    },
  });

  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_insolvencia_watch_test');
  }, 60_000);

  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  beforeEach(async () => {
    await activityLogs.deleteMany({});
  });

  it('registers a watch, polls -> emits ONE watch.hit event + a refs-only activity row, org-scoped', async () => {
    const watch = await engine.create(sharedScope('legal-dossie', 'owner-a'), CITIUS_WATCH_COLLECTION, {
      processoId: 'proc-1',
      subjects: ['Contraparte Exemplo, Lda'],
    });

    const result = await pollInsolvencyWatches(APP_A, 'proc-1', ACTOR_A, baseDeps(fakeFetch(v1)));
    expect(result.newEvents).toHaveLength(1);
    expect(result.newEvents[0]).toMatchObject({ source: 'citius-insolvencia', kind: 'watch.hit', dossierRef: 'proc-1' });
    expect((result.newEvents[0]!.payload as Record<string, unknown>).mensagem).toBe(
      'Nova publicação para a contraparte Contraparte Exemplo, Lda',
    );

    const eventos = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    expect(eventos.some((r) => r.processoId === 'proc-1' && r.kind === 'watch.hit' && r.source === 'citius-insolvencia')).toBe(true);

    const logs = await activityLogs.find({ category: 'portal', type: 'watch.hit' });
    expect(logs.length).toBeGreaterThan(0);
    const last = logs[logs.length - 1]!;
    expect(last.metadata).toMatchObject({ dossierId: 'proc-1', source: 'citius-insolvencia', kind: 'watch.hit' });
    // Refs only (E1 audit-vocabulary finding, carried into E4): the watched name never
    // reaches the persisted audit row.
    expect((last.metadata as Record<string, unknown>).subjectRef).toBeUndefined();
    expect(JSON.stringify(last.metadata)).not.toContain('Contraparte Exemplo');

    const updatedWatch = await engine.get(sharedScope('legal-dossie', 'owner-a'), CITIUS_WATCH_COLLECTION, watch.id as string);
    expect(updatedWatch!.seenRefs).toHaveLength(1);
    expect(updatedWatch!.lastSeen).toBeTruthy();

    // Nothing leaked onto the OTHER owner's spine.
    const eventosB = await engine.list(sharedScope('legal-dossie', 'owner-b'), 'eventos');
    expect(eventosB).toHaveLength(0);
  });

  it('polling again with the SAME fixture -> NO duplicate event (idempotent)', async () => {
    await engine.create(sharedScope('legal-dossie', 'owner-a'), CITIUS_WATCH_COLLECTION, {
      processoId: 'proc-2',
      subjects: ['Contraparte Dois'],
    });
    const deps = baseDeps(fakeFetch(v1));
    const first = await pollInsolvencyWatches(APP_A, 'proc-2', ACTOR_A, deps);
    expect(first.newEvents).toHaveLength(1);

    const second = await pollInsolvencyWatches(APP_A, 'proc-2', ACTOR_A, deps);
    expect(second.newEvents).toHaveLength(0);

    const eventos = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    expect(eventos.filter((r) => r.processoId === 'proc-2' && r.kind === 'watch.hit')).toHaveLength(1);
  });

  it('a poll with a NEW publication in the fixture -> only the delta becomes a new event', async () => {
    await engine.create(sharedScope('legal-dossie', 'owner-a'), CITIUS_WATCH_COLLECTION, {
      processoId: 'proc-3',
      subjects: ['Contraparte Tres'],
    });
    const first = await pollInsolvencyWatches(APP_A, 'proc-3', ACTOR_A, baseDeps(fakeFetch(v1)));
    expect(first.newEvents).toHaveLength(1);

    const second = await pollInsolvencyWatches(APP_A, 'proc-3', ACTOR_A, baseDeps(fakeFetch(v2)));
    expect(second.newEvents).toHaveLength(1); // v2's SECOND publication only - the first was already seen
    expect(second.newEvents[0]!.payload).toMatchObject({ ato: 'Convocatória de credores' });

    const eventos = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    expect(eventos.filter((r) => r.processoId === 'proc-3' && r.kind === 'watch.hit')).toHaveLength(2);
  });

  it('a dossiê with no registered watches -> emits nothing, never throws', async () => {
    const result = await pollInsolvencyWatches(APP_A, 'proc-none', ACTOR_A, baseDeps(fakeFetch(v1)));
    expect(result).toEqual({ ok: true, processoId: 'proc-none', newEvents: [] });
  });

  it('a caller from the wrong org: rejects with PortalOrgMismatchError, no row written', async () => {
    await engine.create(sharedScope('legal-dossie', 'owner-a'), CITIUS_WATCH_COLLECTION, {
      processoId: 'proc-wrong-org',
      subjects: ['Contraparte Exemplo, Lda'],
    });
    await expect(
      pollInsolvencyWatches(APP_A, 'proc-wrong-org', ACTOR_WRONG_ORG, baseDeps(fakeFetch(v1))),
    ).rejects.toBeInstanceOf(PortalOrgMismatchError);
    const eventos = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    expect(eventos.some((r) => r.processoId === 'proc-wrong-org')).toBe(false);
  });

  it('a watch with two subjects, one fetch failing: the healthy subject still emits, the failing one is skipped honestly', async () => {
    await engine.create(sharedScope('legal-dossie', 'owner-a'), CITIUS_WATCH_COLLECTION, {
      processoId: 'proc-partial',
      subjects: ['Sujeito Bom', 'Sujeito Falhado'],
    });
    let calls = 0;
    const flakyOk = fakeFetch(v1);
    const flaky: FetchImpl = async (url, init) => {
      calls++;
      if (calls === 2) throw new Error('ECONNRESET');
      return flakyOk(url, init);
    };
    const result = await pollInsolvencyWatches(APP_A, 'proc-partial', ACTOR_A, baseDeps(flaky));
    expect(result.newEvents).toHaveLength(1);
  });

  it('an attach FAILURE mid-cycle does not re-emit the already-emitted publication next poll (review finding: no double-emit)', async () => {
    await engine.create(sharedScope('legal-dossie', 'owner-a'), CITIUS_WATCH_COLLECTION, {
      processoId: 'proc-attach-fail',
      subjects: ['Sujeito A', 'Sujeito B'],
    });
    // Two subjects -> two emits in one cycle. Fail the SECOND attach after the first durably
    // lands; seenRefs must persist the first ref so the next poll does not re-emit it.
    let attaches = 0;
    const depsFail = { ...baseDeps(fakeFetch(v1)), createEvento: async (app: typeof APP_A, row: Record<string, unknown>) => {
      attaches++;
      if (attaches === 2) throw new Error('eventos write blip');
      return engine.create(sharedScope(app.appId, app.ownerUserId), 'eventos', row);
    } };
    await expect(pollInsolvencyWatches(APP_A, 'proc-attach-fail', ACTOR_A, depsFail as never)).rejects.toThrow();
    const afterFirst = (await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos')).filter((r) => r.processoId === 'proc-attach-fail').length;
    // A clean retry (attach works now): the first publication must NOT emit again.
    await pollInsolvencyWatches(APP_A, 'proc-attach-fail', ACTOR_A, baseDeps(fakeFetch(v1)));
    const all = (await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos')).filter((r) => r.processoId === 'proc-attach-fail');
    // No duplicate of the first publication: every persisted event is unique (no re-emit).
    const refs = new Set(all.map((r) => r.subjectRef + '|' + JSON.stringify(r.payload)));
    expect(refs.size).toBe(all.length);
    expect(afterFirst).toBeGreaterThanOrEqual(1);
  });
});
