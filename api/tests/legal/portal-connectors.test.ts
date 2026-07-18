/**
 * Portal retrieval-by-access-code connectors (mega-run E2/E3, BRIEF §8 items 1-3).
 * Two halves, same split as citius.test.ts vs portal.test.ts:
 *  - `fetchCertidao` parse/fetch-seam unit tests against the committed fixtures
 *    (api/tests/e2e/fixtures/portal-certidao-*.html) - no mongo.
 *  - `retrieveCertidao` end-to-end attach tests over a real CollectionsEngine
 *    (mongodb-memory-server, the portal.test.ts harness) - documentos + eventos +
 *    audit rows land on the right dossiê, org-scoped; a failed retrieval attaches nothing.
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
  fetchCertidao,
  retrieveCertidao,
  buildCertidaoUrl,
  type FetchImpl,
  type FetchLikeResponse,
  type SaveBlobFn,
  type RetrieveCertidaoDeps,
} from '../../src/legal/portal-connectors.js';
import { PortalOrgMismatchError } from '../../src/legal/portal.js';
import type { ResolvedLegalApp } from '../../src/legal/access-gate.js';
import type { PortalCertidaoSource } from '@ekoa/shared';

const fx = (name: string): string => fileURLToPath(new URL(`../e2e/fixtures/${name}`, import.meta.url));
const comercialFixture = readFileSync(fx('portal-certidao-comercial.html'), 'utf-8');
const predialFixture = readFileSync(fx('portal-certidao-predial.html'), 'utf-8');
const civilFixture = readFileSync(fx('portal-certidao-civil.html'), 'utf-8');
const invalidoFixture = readFileSync(fx('portal-certidao-invalido.html'), 'utf-8');

/** Build a fetchImpl seam that always answers with the given HTML body. */
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

describe('portal-connectors · buildCertidaoUrl', () => {
  it('carries the access code as a query param', () => {
    const url = buildCertidaoUrl('certidao-comercial', 'https://example.pt', 'CODE-123');
    expect(url).toContain('/consulta');
    expect(decodeURIComponent(url)).toContain('codigoAcesso=CODE-123');
  });
});

describe('portal-connectors · fetchCertidao (fetchImpl seam)', () => {
  it('parses the comercial fixture into a company record (name/NIF/legal form/capital/registrations)', async () => {
    const res = await fetchCertidao('certidao-comercial', 'CODE-1', { fetchImpl: fakeFetch(comercialFixture) });
    expect(res.ok).toBe(true);
    expect(res.record).toMatchObject({
      nome: 'Exemplo Comercial, Lda',
      nif: '500000000',
      formaJuridica: 'Sociedade por Quotas',
      capitalSocial: '5.000,00 EUR',
    });
    expect(res.record!.registos).toEqual([
      'Conservatória do Registo Comercial de Lisboa - matrícula 12345',
      'Inscrição 1 - constituição de sociedade',
    ]);
    expect(res.bytes).toBeInstanceOf(Buffer);
  });

  it('parses the predial fixture into a property record (description/registration/owners/charges)', async () => {
    const res = await fetchCertidao('certidao-predial', 'CODE-2', { fetchImpl: fakeFetch(predialFixture) });
    expect(res.ok).toBe(true);
    expect(res.record!.descricao).toContain('Prédio urbano');
    expect(res.record!.matricula).toBe('Conservatória do Registo Predial de Lisboa - matrícula 6789');
    expect(res.record!.proprietarios).toEqual(['João Manuel Exemplo', 'Maria Alice Exemplo']);
    expect((res.record!.onus as string[])[0]).toContain('Hipoteca voluntária');
  });

  it('parses the civil fixture into a civil record (name/act type/date/conservatória)', async () => {
    const res = await fetchCertidao('certidao-civil', 'CODE-3', { fetchImpl: fakeFetch(civilFixture) });
    expect(res.ok).toBe(true);
    expect(res.record).toEqual({
      nome: 'Maria Alice Exemplo',
      tipoAto: 'Nascimento',
      data: '1990-04-12',
      conservatoria: 'Conservatória do Registo Civil de Lisboa',
    });
  });

  it('an empty access code -> clean PT error, no fetch attempted', async () => {
    const res = await fetchCertidao('certidao-comercial', '   ', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Código de acesso em falta');
  });

  for (const source of ['certidao-comercial', 'certidao-predial', 'certidao-civil'] as PortalCertidaoSource[]) {
    it(`${source}: an invalid/expired access code page -> clean PT "indisponível", never a false-empty record`, async () => {
      const res = await fetchCertidao(source, 'BAD-CODE', { fetchImpl: fakeFetch(invalidoFixture) });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/indisponível$/);
      expect(res.record).toBeUndefined();
    });
  }

  it('a non-2xx upstream -> clean PT "indisponível"', async () => {
    const res = await fetchCertidao('certidao-comercial', 'CODE-1', { fetchImpl: fakeFetch('', { ok: false, status: 500 }) });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Certidão permanente comercial indisponível');
  });

  it('a thrown fetch -> clean PT "indisponível", never a raw throw', async () => {
    const res = await fetchCertidao('certidao-predial', 'CODE-2', {
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Certidão predial permanente indisponível');
  });
});

describe('portal-connectors · retrieveCertidao (attach onto a real dossiê)', () => {
  let mem: MongoMemoryServer;
  let seq = 0;
  const clock = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
  const engine = new CollectionsEngine(clock);
  const OWNER_ORG: Record<string, string> = { 'owner-a': 'org-a', 'owner-b': 'org-b' };
  const savedBlobs: Array<{ appId: string; name: string; contentType: string; size: number }> = [];

  const saveBlob: SaveBlobFn = async (appId, name, contentType, bytes) => {
    const id = `blob_${seq++}`;
    savedBlobs.push({ appId, name, contentType, size: bytes.length });
    return { fileId: id, url: `/api/app-files/${appId}/${id}`, mime: contentType, size: bytes.length };
  };

  const baseDeps = (): RetrieveCertidaoDeps => ({
    ...clock,
    saveBlob,
    getOwnerOrgId: async (ownerUserId: string) => OWNER_ORG[ownerUserId] ?? null,
    createDocumento: (app, row) => engine.create(sharedScope(app.appId, app.ownerUserId), 'documentos', row),
    createEvento: (app, row) => engine.create(sharedScope(app.appId, app.ownerUserId), 'eventos', row),
    listDocumentos: async (app, processoId) =>
      (await engine.list(sharedScope(app.appId, app.ownerUserId), 'documentos')).filter((r) => r.processoId === processoId),
    listEventos: async (app, processoId) =>
      (await engine.list(sharedScope(app.appId, app.ownerUserId), 'eventos')).filter((r) => r.processoId === processoId),
  });

  const APP_A: ResolvedLegalApp = { appId: 'legal-dossie', ownerUserId: 'owner-a' };
  const ACTOR_A: ActivityActor = { userId: 'owner-a', username: 'legal-dossie', orgId: 'org-a' };
  const ACTOR_WRONG_ORG: ActivityActor = { userId: 'u2', username: 'bruno', orgId: 'org-b' };

  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_portal_connectors_test');
  }, 60_000);

  afterAll(async () => {
    await closeMongo();
    await mem.stop();
  });

  beforeEach(async () => {
    await activityLogs.deleteMany({});
    savedBlobs.length = 0;
  });

  it('certidao-comercial: fetches + parses + attaches a PortalDocument + a document.retrieved eventos row + audit, org-scoped', async () => {
    const result = await retrieveCertidao(APP_A, 'proc-1', 'certidao-comercial', 'CODE-1', ['500000000'], ACTOR_A, {
      ...baseDeps(),
      fetchImpl: fakeFetch(comercialFixture),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.nif).toBe('500000000');
    expect(result.document.source).toBe('certidao-comercial');
    expect(result.document.subjectIds).toEqual(['500000000']);
    expect(savedBlobs).toHaveLength(1);
    expect(savedBlobs[0]!.appId).toBe('legal-dossie');

    const docs = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(docs.some((r) => r.processoId === 'proc-1' && r.origem === 'portal' && r.source === 'certidao-comercial')).toBe(true);

    const eventos = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    const ev = eventos.find((r) => r.processoId === 'proc-1' && r.kind === 'document.retrieved');
    expect(ev).toBeTruthy();
    expect(ev!.origem).toBe('portal');

    // Nothing leaked onto the OTHER owner's spine.
    const docsB = await engine.list(sharedScope('legal-dossie', 'owner-b'), 'documentos');
    expect(docsB).toHaveLength(0);

    // Access code is never persisted or audited anywhere.
    const logs = await activityLogs.find({ category: 'portal' });
    for (const log of logs) expect(JSON.stringify(log)).not.toContain('CODE-1');
    for (const d of docs) expect(JSON.stringify(d)).not.toContain('CODE-1');
  });

  it('certidao-predial: fetches + parses + attaches, org-scoped', async () => {
    const result = await retrieveCertidao(APP_A, 'proc-2', 'certidao-predial', 'CODE-2', ['6789'], ACTOR_A, {
      ...baseDeps(),
      fetchImpl: fakeFetch(predialFixture),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.matricula).toBe('Conservatória do Registo Predial de Lisboa - matrícula 6789');
    const docs = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(docs.some((r) => r.processoId === 'proc-2' && r.source === 'certidao-predial')).toBe(true);
  });

  it('certidao-civil: fetches + parses + attaches, org-scoped (civil lands at the SAME shape, not degraded)', async () => {
    const result = await retrieveCertidao(APP_A, 'proc-3', 'certidao-civil', 'CODE-3', [], ACTOR_A, {
      ...baseDeps(),
      fetchImpl: fakeFetch(civilFixture),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.nome).toBe('Maria Alice Exemplo');
    const docs = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(docs.some((r) => r.processoId === 'proc-3' && r.source === 'certidao-civil')).toBe(true);
  });

  it('a bad/expired access code: clean PT error, NO blob saved, NO documentos/eventos row written (no partial attach)', async () => {
    const result = await retrieveCertidao(APP_A, 'proc-bad', 'certidao-comercial', 'BAD-CODE', ['500000000'], ACTOR_A, {
      ...baseDeps(),
      fetchImpl: fakeFetch(invalidoFixture),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Certidão permanente comercial indisponível');
    expect(savedBlobs).toHaveLength(0);
    const docs = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(docs.some((r) => r.processoId === 'proc-bad')).toBe(false);
    const eventos = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'eventos');
    expect(eventos.some((r) => r.processoId === 'proc-bad')).toBe(false);
  });

  it('an unreachable portal (fetch throws): clean PT error, no partial attach', async () => {
    const result = await retrieveCertidao(APP_A, 'proc-down', 'certidao-predial', 'CODE-2', [], ACTOR_A, {
      ...baseDeps(),
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Certidão predial permanente indisponível');
    expect(savedBlobs).toHaveLength(0);
  });

  it('a retry (same dossiê + source + subjects) is idempotent: no duplicate documentos row (E2/E3 codex review)', async () => {
    const deps = { ...baseDeps(), fetchImpl: fakeFetch(comercialFixture) };
    const first = await retrieveCertidao(APP_A, 'proc-retry', 'certidao-comercial', 'CODE-1', ['500000000'], ACTOR_A, deps);
    expect(first.ok).toBe(true);
    // Client lost the response and retries with the same access code.
    const second = await retrieveCertidao(APP_A, 'proc-retry', 'certidao-comercial', 'CODE-1', ['500000000'], ACTOR_A, deps);
    expect(second.ok).toBe(true);
    const docs = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(docs.filter((r) => r.processoId === 'proc-retry' && r.origem === 'portal')).toHaveLength(1);
  });

  it('the eventos timeline write failing does NOT fail the retrieval nor half-attach (E2/E3 review): the document is the deliverable, the event is best-effort', async () => {
    const deps = {
      ...baseDeps(),
      fetchImpl: fakeFetch(comercialFixture),
      createEvento: async () => {
        throw new Error('eventos write blip');
      },
    };
    const result = await retrieveCertidao(APP_A, 'proc-evt-fail', 'certidao-comercial', 'CODE-9', ['500000000'], ACTOR_A, deps);
    // The retrieval SUCCEEDS: the documentos deliverable is attached; the timeline entry is a
    // best-effort annotation, so its failure never rejects the call or leaves a doc-less error.
    expect(result.ok).toBe(true);
    const docs = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(docs.some((r) => r.processoId === 'proc-evt-fail' && r.origem === 'portal')).toBe(true);
  });

  it('a caller from the wrong org: rejects with PortalOrgMismatchError, no row written', async () => {
    await expect(
      retrieveCertidao(APP_A, 'proc-wrong-org', 'certidao-comercial', 'CODE-1', ['500000000'], ACTOR_WRONG_ORG, {
        ...baseDeps(),
        fetchImpl: fakeFetch(comercialFixture),
      }),
    ).rejects.toBeInstanceOf(PortalOrgMismatchError);
    const docs = await engine.list(sharedScope('legal-dossie', 'owner-a'), 'documentos');
    expect(docs.some((r) => r.processoId === 'proc-wrong-org')).toBe(false);
    // Org checked BEFORE the blob save (codex E2/E3 finding): no orphan blob, no fetch even.
    expect(savedBlobs).toHaveLength(0);
  });
});
