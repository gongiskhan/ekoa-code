/**
 * Part E gate — mega-run E5 (BRIEF §8: "one dossiê receives a comercial certidão by code
 * AND one watcher event end-to-end, both rendering in the dossiê; PT-PT strings throughout").
 *
 * Unlike the per-connector unit suites (portal.test.ts, portal-connectors.test.ts,
 * insolvencia-watch.test.ts — each exercises its functions directly, on separate synthetic
 * processoIds) and the contract suite (legal-plane.test.ts — drives the real HTTP router but
 * over PLAIN STUB deps, and the certidão/poll happy-paths land on two DIFFERENT processoIds),
 * this file is the single committed driver the BRIEF §8 gate describes literally: real HTTP
 * requests through the mounted `legalRouter`, real deps wired onto a real CollectionsEngine
 * over mongodb-memory-server (the E1-E4 harness), ONE `processos` row standing in for the
 * dossiê, and BOTH a certidão retrieval and a watcher poll landing on it before the combined
 * read-back is asserted. Re-runnable: `npx vitest run api/tests/legal/e5-portal-gate.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Server } from 'node:http';
import { PortalCertidaoResponse, InsolvenciaPollResponse, PortalDossierRecordsResponse } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { CollectionsEngine, sharedScope } from '../../src/data/collections-engine.js';
import { legalRouter, type ResolvedLegalApp } from '../../src/legal/index.js';
import { CITIUS_WATCH_COLLECTION, type FetchImpl as InsolvenciaFetchImpl, type FetchLikeResponse } from '../../src/legal/insolvencia-watch.js';
import type { FetchImpl as CertidaoFetchImpl } from '../../src/legal/portal-connectors.js';
import type { SaveBlobFn } from '../../src/legal/portal-connectors.js';
import type { ActivationState } from '../../src/data/activation.js';

const fx = (name: string): string => fileURLToPath(new URL(`../e2e/fixtures/${name}`, import.meta.url));
const comercialFixture = readFileSync(fx('portal-certidao-comercial.html'), 'utf-8');
const insolvenciaFixture = readFileSync(fx('citius-insolvencia-v1.html'), 'utf-8');

// Records every URL the connector actually requested, so the gate can prove the access code +
// watched subject are carried into the real connector URL (not just accepted at the route).
const fetchedUrls: string[] = [];
function fakeFetch(html: string): CertidaoFetchImpl | InsolvenciaFetchImpl {
  const buf = Buffer.from(html, 'utf-8');
  return async (url: string): Promise<FetchLikeResponse> => {
    fetchedUrls.push(String(url));
    return {
      status: 200,
      ok: true,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    };
  };
}

// The insolvência fixture's own text ("Declarada a insolvência de Contraparte Exemplo, Lda")
// is what the counterparty-watch is registered against — the SAME name the BRIEF §8 gate's
// example message names ("Nova publicação para a contraparte X").
const WATCHED_SUBJECT = 'Contraparte Exemplo, Lda';

describe('Part E gate (mega-run E5) — one dossiê, certidão + watcher event, both rendering', () => {
  let mem: MongoMemoryServer;
  let seq = 0;
  const engineClock = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
  const engine = new CollectionsEngine(engineClock);

  // Two owners in two orgs — org-scoping is proven by cross-owner isolation on the shared
  // spine (the same discipline portal.test.ts's ownedByB/eventosB checks use), since the
  // HTTP layer's actor.orgId is always server-derived from the resolved app's OWN owner
  // (router.ts:400/453 — there is no client-suppliable org claim to spoof at this layer).
  const OWNER_ORG: Record<string, string> = { 'owner-gate-a': 'org-gate-a', 'owner-gate-b': 'org-gate-b' };
  const ACTIVATION: Record<string, ActivationState> = {
    'owner-gate-a': { active: true, billingLocked: false, tokenEpoch: 0 },
    'owner-gate-b': { active: true, billingLocked: false, tokenEpoch: 0 },
  };
  // Two header ids resolving to the SAME canonical appId ('legal-dossie', the allowlisted,
  // processo-touching app per router.ts's PORTAL_ALLOWED_APPS) but DIFFERENT owners — the
  // real resolver shape (a slug/id resolved server-side to canonical appId + owner); data
  // isolation is by ownerUserId (sharedScope's scopeKey = `usr.<ownerUserId>`), not appId.
  const APPS: Record<string, ResolvedLegalApp> = {
    'dossie-a': { appId: 'legal-dossie', ownerUserId: 'owner-gate-a' },
    'dossie-b': { appId: 'legal-dossie', ownerUserId: 'owner-gate-b' },
  };

  const savedBlobs: Array<{ appId: string; name: string }> = [];
  const saveBlob: SaveBlobFn = async (appId, name, contentType, bytes) => {
    const id = `blob_gate_${seq++}`;
    savedBlobs.push({ appId, name });
    return { fileId: id, url: `/api/app-files/${appId}/${id}`, mime: contentType, size: bytes.length };
  };

  let server: Server;
  let port: number;
  let routerClock = 1_700_100_000_000;

  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_e5_gate_test');

    const portalSpine = {
      getOwnerOrgId: async (ownerUserId: string) => OWNER_ORG[ownerUserId] ?? null,
      createDocumento: (app: ResolvedLegalApp, row: Record<string, unknown>) => engine.create(sharedScope(app.appId, app.ownerUserId), 'documentos', row),
      createEvento: (app: ResolvedLegalApp, row: Record<string, unknown>) => engine.create(sharedScope(app.appId, app.ownerUserId), 'eventos', row),
      listDocumentos: async (app: ResolvedLegalApp, processoId: string) =>
        (await engine.list(sharedScope(app.appId, app.ownerUserId), 'documentos')).filter((r) => r.processoId === processoId),
      listEventos: async (app: ResolvedLegalApp, processoId: string) =>
        (await engine.list(sharedScope(app.appId, app.ownerUserId), 'eventos')).filter((r) => r.processoId === processoId),
    };

    const app = express();
    app.use(express.json());
    app.use(
      legalRouter({
        resolveApp: async (h) => APPS[h] ?? null,
        getActivation: (u) => ACTIVATION[u],
        now: () => routerClock,
        portal: portalSpine,
        portalCertidao: { saveBlob, fetchImpl: fakeFetch(comercialFixture) as CertidaoFetchImpl },
        insolvenciaWatch: {
          listWatches: async (a, processoId) =>
            (await engine.list(sharedScope(a.appId, a.ownerUserId), CITIUS_WATCH_COLLECTION)).filter((r) => r.processoId === processoId),
          updateWatch: async (a, watchId, patch) => {
            await engine.upsert(sharedScope(a.appId, a.ownerUserId), CITIUS_WATCH_COLLECTION, watchId, patch);
          },
          fetchImpl: fakeFetch(insolvenciaFixture) as InsolvenciaFetchImpl,
        },
      }),
    );
    await new Promise<void>((r) => {
      server = app.listen(0, () => r());
    });
    port = (server.address() as { port: number }).port;
  }, 60_000);

  afterAll(async () => {
    server.close();
    await closeMongo();
    await mem.stop();
  });

  const api = (p: string, appId: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${p}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-ekoa-app-id': appId, ...(init.headers ?? {}) },
    });

  let dossieId: string;

  it('creates the dossiê (a processos row) that everything below attaches onto', async () => {
    const processo = await engine.create(sharedScope('legal-dossie', 'owner-gate-a'), 'processos', {
      numeroProcesso: 'E5-GATE-1',
      clienteId: 'cliente-gate',
    });
    dossieId = processo.id as string;
    expect(dossieId).toBeTruthy();
  });

  it('retrieves a comercial certidão by access code: attaches a PortalDocument onto the dossiê', async () => {
    const res = await api('/api/legal/portal/certidao', 'dossie-a', {
      method: 'POST',
      body: JSON.stringify({ source: 'certidao-comercial', accessCode: 'CODE-GATE-1', processoId: dossieId, subjectIds: ['500000000'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(PortalCertidaoResponse.safeParse(body).success).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.record.nif).toBe('500000000');
    // The exact PT-PT string the BRIEF §8 gate names.
    expect(body.document.type).toBe('Certidão permanente comercial');
    expect(body.document.source).toBe('certidao-comercial');
    expect(savedBlobs.some((b) => b.appId === 'legal-dossie')).toBe(true);
    // The access code was genuinely carried into the real connector URL (codex E5 finding):
    // not merely accepted at the route and dropped.
    expect(fetchedUrls.some((u) => u.includes('CODE-GATE-1'))).toBe(true);
    routerClock += 5_000;
  });

  it('registers an insolvência watch on the SAME dossiê and polls it: attaches a watch.hit PortalEvent', async () => {
    // No dedicated registration endpoint exists (insolvencia-watch.ts's documented decision —
    // "lowest viable tier"): a watch is ordinary owner-spine data, written directly, exactly
    // as insolvencia-watch.test.ts does.
    await engine.create(sharedScope('legal-dossie', 'owner-gate-a'), CITIUS_WATCH_COLLECTION, {
      processoId: dossieId,
      subjects: [WATCHED_SUBJECT],
    });

    const res = await api('/api/legal/portal/insolvency/poll', 'dossie-a', {
      method: 'POST',
      body: JSON.stringify({ processoId: dossieId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(InsolvenciaPollResponse.safeParse(body).success).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.newEvents).toHaveLength(1);
    expect(body.newEvents[0].kind).toBe('watch.hit');
    // The exact PT-PT message the BRIEF §8 gate names.
    expect(body.newEvents[0].payload.mensagem).toBe(`Nova publicação para a contraparte ${WATCHED_SUBJECT}`);
    // The poll genuinely queried the WATCHED subject via the connector (codex E5 finding).
    expect(fetchedUrls.some((u) => u.includes(encodeURIComponent(WATCHED_SUBJECT)) || u.includes('Contraparte'))).toBe(true);
    routerClock += 5_000;
  });

  it('reads back via GET /api/legal/portal: BOTH the certidão document AND the watcher event render on the SAME dossiê', async () => {
    const res = await api(`/api/legal/portal?processoId=${dossieId}`, 'dossie-a');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(PortalDossierRecordsResponse.safeParse(body).success).toBe(true);

    expect(body.documentos).toHaveLength(1);
    const doc = body.documentos[0];
    expect(doc.source).toBe('certidao-comercial');
    expect(doc.type).toBe('Certidão permanente comercial'); // PT-PT, verbatim
    expect(doc.subjectIds).toEqual(['500000000']);

    expect(body.eventos).toHaveLength(2);
    const retrieved = body.eventos.find((e: { kind: string }) => e.kind === 'document.retrieved');
    const watchHit = body.eventos.find((e: { kind: string }) => e.kind === 'watch.hit');
    expect(retrieved).toBeTruthy();
    expect(watchHit).toBeTruthy();
    expect(watchHit.source).toBe('citius-insolvencia');
    expect(watchHit.subjectRef).toBe(WATCHED_SUBJECT);
    expect(watchHit.payload.mensagem).toBe(`Nova publicação para a contraparte ${WATCHED_SUBJECT}`); // PT-PT, verbatim

    // The stored rows are the ONES DocumentosTab.jsx/CronologiaTab.jsx render directly (no
    // /api/legal/portal call from the served app — 08-portal-audit.md Part E pin #2): confirm
    // the underlying documentos/eventos rows carry the exact fields those tabs read, so "both
    // rendering in the dossiê" holds for the real UI path too, not just this read route.
    const rawDocs = await engine.list(sharedScope('legal-dossie', 'owner-gate-a'), 'documentos');
    const rawDoc = rawDocs.find((r) => r.processoId === dossieId);
    expect(rawDoc).toMatchObject({ origem: 'portal', tipo: 'Certidão permanente comercial' });
    const rawEventos = await engine.list(sharedScope('legal-dossie', 'owner-gate-a'), 'eventos');
    const rawWatchHit = rawEventos.find((r) => r.processoId === dossieId && r.kind === 'watch.hit');
    // The verbatim BRIEF §8 PT-PT message must render in a UI field CronologiaTab reads
    // (titulo/descricao), not only in the raw payload (E5 codex finding): descricao carries it.
    expect(rawWatchHit).toMatchObject({
      origem: 'portal',
      titulo: 'Nova publicação encontrada',
      descricao: `Nova publicação para a contraparte ${WATCHED_SUBJECT}`,
    });
  });

  it('org-scoped: a different owner reading the SAME processoId sees nothing (no cross-owner leak)', async () => {
    const res = await api(`/api/legal/portal?processoId=${dossieId}`, 'dossie-b');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentos: [], eventos: [] });

    // Confirms this is real isolation on the underlying owner spine, not an artifact of the
    // read route's own filtering.
    const rawDocsB = await engine.list(sharedScope('legal-dossie', 'owner-gate-b'), 'documentos');
    expect(rawDocsB.some((r) => r.processoId === dossieId)).toBe(false);
    const rawEventosB = await engine.list(sharedScope('legal-dossie', 'owner-gate-b'), 'eventos');
    expect(rawEventosB.some((r) => r.processoId === dossieId)).toBe(false);
  });
});
