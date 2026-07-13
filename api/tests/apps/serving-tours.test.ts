import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts } from '../../src/data/stores.js';
import { indexSlug } from '../../src/apps/slug-index.js';
import { servingRouter } from '../../src/apps/serving.js';
import { stripReservedDataKeys, RESERVED_ARTIFACT_DATA_KEYS } from '../../src/apps/artifacts-service.js';

/**
 * operator-run E1 (codex-fix): the GET /api/demos/:appId generated-tour fallback + the
 * server-owned reserved-key protection that makes it safe to serve.
 *
 * The fallback serves a per-app OVERVIEW tour stored on artifact.data.tours. Because that surface
 * is public, `tours` must be server-owned (set only at activation, stripped from client patches)
 * AND the served tour must belong to the RESOLVED artifact. These tests pin exactly that: catalog
 * miss -> the artifact's own overview; slug resolves to the same artifact; invalid stored entries
 * dropped; a tour whose appId != the resolved artifact is NOT served; 404 when only bad data exists.
 */

const PORT_HOST = '127.0.0.1';

function tourSpec(appId: string, tourId: string, kind: 'overview' | 'journey') {
  // Shape matches the shipped legal-*.json specs (card.titlePt/descriptionPt/durationSec;
  // steps with id + copy.titlePt/bodyPt) so it validates through the SAME demoSpecSchema.
  return {
    version: 1,
    appId,
    tourId,
    kind,
    card: { titlePt: `Tour ${tourId}`, descriptionPt: 'Uma visita guiada à aplicação.', durationSec: 30 },
    steps: [{ id: 'inicio', type: 'navigate', to: '/', copy: { titlePt: 'Início', bodyPt: 'Bem-vindo.' } }],
  };
}

async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://${PORT_HOST}:${port}${path}`);
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

describe('E1 — reserved-key protection (unit)', () => {
  it('tours/toursError/actionManifest/artifactType are server-owned reserved keys', () => {
    for (const k of ['tours', 'toursError', 'actionManifest', 'artifactType']) {
      expect(RESERVED_ARTIFACT_DATA_KEYS).toContain(k);
    }
  });

  it('stripReservedDataKeys removes a client-supplied tours bag but keeps app data', () => {
    const cleaned = stripReservedDataKeys({
      tours: [tourSpec('victim-app', 'poison', 'overview')],
      toursError: 'x',
      actionManifest: { version: 1, actions: [] },
      title: 'My App',
      count: 3,
    });
    expect(cleaned).not.toHaveProperty('tours');
    expect(cleaned).not.toHaveProperty('toursError');
    expect(cleaned).not.toHaveProperty('actionManifest');
    expect(cleaned).toEqual({ title: 'My App', count: 3 });
  });
});

describe('E1 — GET /api/demos/:appId generated-tour fallback (integration)', () => {
  let mem: MongoMemoryServer;
  let server: Server;
  let port: number;

  beforeAll(async () => {
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa');
    const app = express();
    app.use(servingRouter({}));
    await new Promise<void>((resolve) => {
      server = app.listen(0, PORT_HOST, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await closeMongo();
    await mem?.stop();
  });

  it('serves the artifact OWN overview tour on a catalog miss (resolved by raw id)', async () => {
    const id = 'art-tour-1';
    await artifacts.insert({
      _id: id,
      data: { tours: [tourSpec(id, 'geral', 'overview'), tourSpec(id, 'criar-cliente', 'journey')] },
    } as never);
    const { status, body } = await getJson(port, `/api/demos/${id}`);
    expect(status).toBe(200);
    expect((body as { tourId: string }).tourId).toBe('geral'); // the OVERVIEW, not the journey
    expect((body as { appId: string }).appId).toBe(id);
  });

  it('resolves a slug to its artifact and serves that artifact\'s overview', async () => {
    const id = 'art-tour-2';
    await artifacts.insert({ _id: id, data: { tours: [tourSpec(id, 'geral', 'overview')] } } as never);
    indexSlug('meu-app', id); // getAppIdBySlug reads the in-memory index, not the store directly
    const { status, body } = await getJson(port, '/api/demos/meu-app');
    expect(status).toBe(200);
    expect((body as { appId: string }).appId).toBe(id);
  });

  it('drops invalid stored entries and still serves a valid overview', async () => {
    const id = 'art-tour-3';
    await artifacts.insert({
      _id: id,
      data: { tours: [{ version: 1, appId: id, junk: true }, tourSpec(id, 'geral', 'overview')] },
    } as never);
    const { status, body } = await getJson(port, `/api/demos/${id}`);
    expect(status).toBe(200);
    expect((body as { tourId: string }).tourId).toBe('geral');
  });

  it('does NOT serve a tour whose appId != the resolved artifact (provenance)', async () => {
    const id = 'art-tour-4';
    // A tour smuggled into this artifact but stamped for another app must never be served here.
    await artifacts.insert({ _id: id, data: { tours: [tourSpec('victim-app', 'geral', 'overview')] } } as never);
    const { status } = await getJson(port, `/api/demos/${id}`);
    expect(status).toBe(404);
  });

  it('404s when the artifact has no tours / does not exist', async () => {
    const { status: noTours } = await getJson(port, '/api/demos/art-none');
    expect(noTours).toBe(404);
    const id = 'art-tour-5';
    await artifacts.insert({ _id: id, data: {} } as never);
    const { status: emptyData } = await getJson(port, `/api/demos/${id}`);
    expect(emptyData).toBe(404);
  });
});
