import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { CollectionsEngine, sharedScope } from '../../src/data/collections-engine.js';
import { activityLogs } from '../../src/data/stores.js';
import type { ActivityActor } from '../../src/data/activity.js';
import {
  attachPortalDocument,
  attachPortalEvent,
  listPortalDossierRecords,
  PortalOrgMismatchError,
  type PortalSpineDeps,
} from '../../src/legal/portal.js';
import type { ResolvedLegalApp } from '../../src/legal/access-gate.js';
import type { PortalDocument, PortalEvent } from '@ekoa/shared';

/**
 * Part E, mega-run E1 (BRIEF §8, 08-portal-audit.md pins 1-2). The receiving surface: an
 * attach on the shared owner-spine (real CollectionsEngine over mongodb-memory-server, the
 * data/engine.test.ts pattern - no HTTP layer, org-scoping and the documentos/eventos row
 * shapes are the unit under test here) + the single logActivity audit path.
 */
let mem: MongoMemoryServer;
let seq = 0;
const clock = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
const engine = new CollectionsEngine(clock);

const OWNER_ORG: Record<string, string> = { 'owner-a': 'org-a', 'owner-b': 'org-b' };

const deps: PortalSpineDeps & typeof clock = {
  ...clock,
  getOwnerOrgId: async (ownerUserId) => OWNER_ORG[ownerUserId] ?? null,
  createDocumento: (app, row) => engine.create(sharedScope(app.appId, app.ownerUserId), 'documentos', row),
  createEvento: (app, row) => engine.create(sharedScope(app.appId, app.ownerUserId), 'eventos', row),
  listDocumentos: async (app, processoId) =>
    (await engine.list(sharedScope(app.appId, app.ownerUserId), 'documentos')).filter((r) => r.processoId === processoId),
  listEventos: async (app, processoId) =>
    (await engine.list(sharedScope(app.appId, app.ownerUserId), 'eventos')).filter((r) => r.processoId === processoId),
};

const APP_A: ResolvedLegalApp = { appId: 'legal-dossie', ownerUserId: 'owner-a' };
const ACTOR_A: ActivityActor = { userId: 'u1', username: 'ana', orgId: 'org-a' };
const ACTOR_WRONG_ORG: ActivityActor = { userId: 'u2', username: 'bruno', orgId: 'org-b' };

const doc: PortalDocument = {
  source: 'certidao-comercial',
  type: 'certidao-permanente',
  subjectIds: ['500000000'],
  retrievedAt: '2026-07-18T10:00:00.000Z',
  fileRef: { fileId: 'f1', appId: 'legal-dossie', url: '/api/app-files/legal-dossie/f1', mime: 'application/pdf', size: 12345 },
};

const watchHit: PortalEvent = {
  source: 'citius-insolvencia',
  kind: 'watch.hit',
  subjectRef: 'Contraparte Lda',
  dossierRef: 'proc-1',
  observedAt: '2026-07-18T11:00:00.000Z',
  payload: { processo: '1234/26.0T8LSB', ato: 'Sentença' },
};

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_portal_test');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await activityLogs.deleteMany({});
});

describe('attachPortalDocument', () => {
  it('writes the documentos row on the right dossiê (org-scoped) and logs portal.document.retrieved', async () => {
    const created = await attachPortalDocument(APP_A, 'proc-1', doc, ACTOR_A, deps);
    expect(created.processoId).toBe('proc-1');
    expect(created.origem).toBe('portal');
    expect(created.ficheiro).toEqual(doc.fileRef);
    expect(created.tipo).toBe('certidao-permanente');

    // The DocumentosTab.jsx-shaped row lands on the RIGHT owner's spine only.
    const ownedByA = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(ownedByA.some((r) => r.processoId === 'proc-1' && r.origem === 'portal')).toBe(true);
    const ownedByB = await engine.list(sharedScope('legal-dossie', 'owner-b'), 'documentos');
    expect(ownedByB).toHaveLength(0);

    const logs = await activityLogs.find({ category: 'portal', type: 'document.retrieved' });
    expect(logs.length).toBeGreaterThan(0);
    const last = logs[logs.length - 1]!;
    expect(last.orgId).toBe('org-a');
    expect(last.userId).toBe('u1');
    expect(last.metadata).toMatchObject({ dossierId: 'proc-1', source: 'certidao-comercial', type: 'certidao-permanente', subjectCount: 1 });
    // Refs only (codex E1 finding 3): the raw subjectIds (NIFs) never reach the audit row.
    expect((last.metadata as Record<string, unknown>).subjectIds).toBeUndefined();
    expect(JSON.stringify(last.metadata)).not.toContain('500000000');
  });

  it('refuses with PortalOrgMismatchError when the caller org does not own the dossiê (no row, no audit)', async () => {
    await expect(attachPortalDocument(APP_A, 'proc-2', doc, ACTOR_WRONG_ORG, deps)).rejects.toBeInstanceOf(PortalOrgMismatchError);
    const rows = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(rows.some((r) => r.processoId === 'proc-2')).toBe(false);
    expect(await activityLogs.find({ category: 'portal', 'metadata.dossierId': 'proc-2' })).toHaveLength(0);
  });
});

describe('attachPortalEvent', () => {
  it('appends the eventos row + logs portal.watch.hit', async () => {
    const created = await attachPortalEvent(APP_A, watchHit, ACTOR_A, deps);
    expect(created.processoId).toBe('proc-1');
    expect(created.tipo).toBe('portal.watch.hit');
    expect(created.origem).toBe('portal');

    const rows = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    expect(rows.some((r) => r.processoId === 'proc-1' && r.tipo === 'portal.watch.hit')).toBe(true);

    const logs = await activityLogs.find({ category: 'portal', type: 'watch.hit' });
    expect(logs.length).toBeGreaterThan(0);
    const meta = logs[logs.length - 1]!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ dossierId: 'proc-1', source: 'citius-insolvencia', kind: 'watch.hit' });
    // Refs only (codex E1 finding 3): the raw subject identifier (a name/NIF) is NEVER persisted
    // into the audit row - it lives only on the eventos row (the dossier's own data).
    expect(meta.subjectRef).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain('Contraparte Lda');
  });

  it('refuses with PortalOrgMismatchError for a mismatched org', async () => {
    await expect(attachPortalEvent(APP_A, { ...watchHit, dossierRef: 'proc-3' }, ACTOR_WRONG_ORG, deps)).rejects.toBeInstanceOf(
      PortalOrgMismatchError,
    );
    const rows = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    expect(rows.some((r) => r.processoId === 'proc-3')).toBe(false);
  });
});

describe('listPortalDossierRecords', () => {
  it('returns only origem:portal rows, round-tripped into PortalDocument/PortalEvent', async () => {
    // A regular upload (DocumentosTab.jsx origem:'upload') must never leak onto the portal read surface.
    await engine.create(sharedScope('legal-dossie', 'owner-a'), 'documentos', {
      nome: 'contrato.pdf',
      tipo: 'contrato',
      processoId: 'proc-1',
      data: '2026-07-01',
      origem: 'upload',
      ficheiro: { fileId: 'f9', appId: 'legal-dossie', url: '/x', mime: 'application/pdf', size: 1 },
      versao: 1,
    });

    const records = await listPortalDossierRecords(APP_A, 'proc-1', deps);
    expect(records.documentos).toHaveLength(1);
    expect(records.documentos[0]).toMatchObject({
      source: 'certidao-comercial',
      type: 'certidao-permanente',
      subjectIds: ['500000000'],
      fileRef: doc.fileRef,
    });
    expect(records.eventos).toHaveLength(1);
    expect(records.eventos[0]).toMatchObject({ source: 'citius-insolvencia', kind: 'watch.hit', dossierRef: 'proc-1' });
  });

  it('a dossiê with no portal activity returns empty arrays, never throws', async () => {
    const records = await listPortalDossierRecords(APP_A, 'proc-empty', deps);
    expect(records).toEqual({ documentos: [], eventos: [] });
  });
});
