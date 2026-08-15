import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { CollectionsEngine, appScope } from '../../src/data/collections-engine.js';
import { AppDataAccess, type AppDataDump } from '../../src/apps/app-data-access.js';

/**
 * APP-DATA FIDELITY ON THE IMPORT PATH (S3, salomao migration).
 *
 * The real prod dump for `legal-case-manager-3` carries the engine's reserved `__files`
 * bookkeeping (91 rows), and before this slice `importDump` had no skip for it while
 * `applyImportedAppData` wrapped the whole call in one swallow-and-warn catch - so a real
 * dump seeded ZERO collections with only a console.warn. `CollectionsEngine.create` also
 * re-stamps createdAt/updatedAt (every migrated record showed import day) and `checkSize`
 * aborted the whole import on one oversized row.
 *
 * This suite proves the migration path (`AppDataAccess.importDumpReport` over
 * `CollectionsEngine.importCreate`) fixes all of that - and, just as deliberately, that the
 * PUBLIC engine `create` path is NOT weakened: it keeps re-stamping timestamps and keeps
 * refusing reserved names exactly as before. Synthetic fixtures only.
 */
let mem: MongoMemoryServer;
let seq = 0;
const NOW_MS = 1_700_000_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();
const deps = { now: () => NOW_MS, genId: () => `gen_${seq++}` };

const dumpOf = (collections: AppDataDump['collections']): AppDataDump => ({
  collections,
  counts: {},
  totalItems: 0,
  at: '2026-07-24T10:00:00.000Z',
});

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_import_fidelity');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await getDb().collection('app_data').deleteMany({});
});

describe('importDumpReport: reserved + shared-scope collections are skipped by name, never fatal', () => {
  it("a dump with '__files' seeds every OTHER collection and reports the skip explicitly", async () => {
    const access = new AppDataAccess(deps);
    const report = await access.importDumpReport('app-mig', dumpOf({
      __files: [{ id: 'f1', name: 'a.pdf' }, { id: 'f2', name: 'b.pdf' }],
      'usr.owner-1': [{ id: 's1' }],
      clientes: [{ id: 'c1', nome: 'Cliente Um' }, { id: 'c2', nome: 'Cliente Dois' }],
      propostas: [{ id: 'p1', estado: 'rascunho' }],
    }));

    expect(report.imported).toBe(3);
    expect(report.skipped).toBe(3);
    const byName = Object.fromEntries(report.collections.map((c) => [c.name, c]));
    expect(byName.__files).toMatchObject({ imported: 0, skipped: 2 });
    expect(byName.__files!.error).toMatch(/RESERVED_COLLECTION/);
    expect(byName['usr.owner-1']).toMatchObject({ imported: 0, skipped: 1 });
    expect(byName.clientes).toEqual({ name: 'clientes', imported: 2, skipped: 0 });
    expect(byName.propostas).toEqual({ name: 'propostas', imported: 1, skipped: 0 });

    // The reserved rows genuinely never landed - under any name visible to the engine scope.
    expect(await access.list('app-mig', 'clientes')).toHaveLength(2);
    expect(await getDb().collection('app_data').countDocuments({ collection: '__files' })).toBe(0);
    expect(await getDb().collection('app_data').countDocuments({ collection: 'usr.owner-1' })).toBe(0);
  });

  it('one bad collection (invalid charset) never kills the rest', async () => {
    const access = new AppDataAccess(deps);
    const report = await access.importDumpReport('app-iso', dumpOf({
      'bad name!': [{ id: 'x1' }, { id: 'x2' }],
      faturas: [{ id: 'f1' }],
    }));
    const byName = Object.fromEntries(report.collections.map((c) => [c.name, c]));
    expect(byName['bad name!']).toMatchObject({ imported: 0, skipped: 2 });
    expect(byName['bad name!']!.error).toMatch(/Invalid collection name/);
    expect(byName.faturas).toMatchObject({ imported: 1, skipped: 0 });
    expect(await access.list('app-iso', 'faturas')).toHaveLength(1);
  });

  it('an oversized row is a reported per-row skip, not a wholesale abort', async () => {
    const access = new AppDataAccess(deps);
    const report = await access.importDumpReport('app-size', dumpOf({
      documentos: [
        { id: 'd1', titulo: 'ok antes' },
        { id: 'd2', blob: 'x'.repeat(270_000) },
        { id: 'd3', titulo: 'ok depois' },
      ],
    }));
    const doc = report.collections.find((c) => c.name === 'documentos')!;
    expect(doc.imported).toBe(2);
    expect(doc.skipped).toBe(1);
    expect(doc.error).toMatch(/excede o tamanho/);
    const rows = await access.list('app-size', 'documentos');
    expect(rows.map((r) => r.id).sort()).toEqual(['d1', 'd3']);
  });

  it('a duplicate row id is a reported skip (import into a non-empty scope never dies)', async () => {
    const access = new AppDataAccess(deps);
    await access.create('app-dup', 'notas', { id: 'n1', texto: 'já existe' });
    const report = await access.importDumpReport('app-dup', dumpOf({
      notas: [{ id: 'n1', texto: 'colide' }, { id: 'n2', texto: 'nova' }],
    }));
    const notas = report.collections.find((c) => c.name === 'notas')!;
    expect(notas).toMatchObject({ imported: 1, skipped: 1 });
    expect(notas.error).toMatch(/already exists/);
    expect((await access.list('app-dup', 'notas')).map((r) => r.id).sort()).toEqual(['n1', 'n2']);
  });
});

describe('timestamp fidelity: the import path preserves, the public path keeps re-stamping', () => {
  it('importCreate preserves supplied valid createdAt/updatedAt VERBATIM and stamps only absent ones', async () => {
    const access = new AppDataAccess(deps);
    const report = await access.importDumpReport('app-ts', dumpOf({
      processos: [
        { id: 'p1', ref: 'P1', createdAt: '2024-03-15T09:30:00.000Z', updatedAt: '2025-11-02T18:45:12.345Z' },
        { id: 'p2', ref: 'P2' }, // no timestamps in the dump row → server stamp
        { id: 'p3', ref: 'P3', createdAt: 'not-a-date', updatedAt: '' }, // invalid → server stamp
      ],
    }));
    expect(report.imported).toBe(3);
    const rows = await new AppDataAccess(deps).list('app-ts', 'processos');
    const byId = Object.fromEntries(rows.map((r) => [r.id as string, r]));
    expect(byId.p1!.createdAt).toBe('2024-03-15T09:30:00.000Z');
    expect(byId.p1!.updatedAt).toBe('2025-11-02T18:45:12.345Z');
    expect(byId.p2!.createdAt).toBe(NOW_ISO);
    expect(byId.p2!.updatedAt).toBe(NOW_ISO);
    expect(byId.p3!.createdAt).toBe(NOW_ISO);
    expect(byId.p3!.updatedAt).toBe(NOW_ISO);
  });

  it('the PUBLIC engine create still re-stamps a supplied createdAt/updatedAt (unweakened)', async () => {
    const engine = new CollectionsEngine(deps);
    const created = await engine.create(appScope('app-pub'), 'eventos', {
      id: 'e1',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      titulo: 'audiência',
    });
    expect(created.createdAt).toBe(NOW_ISO);
    expect(created.updatedAt).toBe(NOW_ISO);
  });

  it('the PUBLIC AppDataAccess.create (backend-runtime appData.* path) also still re-stamps', async () => {
    const access = new AppDataAccess(deps);
    const created = await access.create('app-pub2', 'eventos', {
      id: 'e2',
      createdAt: '2020-01-01T00:00:00.000Z',
      titulo: 'prazo',
    });
    expect(created.createdAt).toBe(NOW_ISO);
  });

  it('importCreate still refuses reserved names and oversized items exactly like create', async () => {
    const engine = new CollectionsEngine(deps);
    await expect(engine.importCreate(appScope('app-g'), '__files', { id: 'f' }))
      .rejects.toMatchObject({ code: 'RESERVED_COLLECTION', status: 403 });
    await expect(engine.importCreate(appScope('app-g'), 'usr.x', { id: 's' }))
      .rejects.toMatchObject({ code: 'RESERVED_COLLECTION' });
    await expect(engine.importCreate(appScope('app-g'), 'docs', { id: 'big', blob: 'x'.repeat(270_000) }))
      .rejects.toMatchObject({ code: 'ITEM_TOO_LARGE', status: 413 });
  });
});
