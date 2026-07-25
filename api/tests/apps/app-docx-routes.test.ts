/**
 * App DOCX routes (2C-S4) - integration tests over real HTTP. Ported from ekoa-dev
 * cortex/tests/docx/app-docx-routes.test.ts, adapted to ekoa-code's admission (app-files'
 * admitApp INCLUDING the owner-activation gate) + the injected document-source seam.
 *
 * The router is mounted over a bare express app with the REAL appDocxRouter, wired to the
 * REAL apps/document-source functions (the same binding server.ts uses). Documents are seeded
 * through the document-source service (the routes are read/derive only - linking happens via
 * the ekoa-docx MCP tools). Mongo (mongodb-memory-server) is connected because admitApp's
 * resolveApp reads the artifacts/slugs stores; an unregistered app id resolves to null → the
 * gate is skipped and the id keys on itself (carried old-plane behavior), exactly as dev.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import JSZip from 'jszip';

import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts, slugs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { appDocxRouter } from '../../src/apps/app-docx.js';
import {
  setSource,
  applyEdits,
  getStatus,
  getProjection,
  getCurrent,
  getClean,
  applyReview,
  restoreSource,
} from '../../src/apps/document-source.js';
import { makeContratoFixture } from '../services/docx/contrato-fixture.js';

const APP_ID = 'dev-doc-base-app';
const EMPTY_APP_ID = 'dev-sem-documento';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let mem: MongoMemoryServer;
let server: Server;
let base: string;
let dataDir: string;

function get(path: string, appId: string | null = APP_ID, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (appId !== null) headers['X-Ekoa-App-Id'] = appId;
  return fetch(`${base}${path}`, { ...init, headers });
}

async function documentXmlOf(res: Response): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('word/document.xml missing');
  return file.async('string');
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_app_docx');
  dataDir = await mkdtemp(join(tmpdir(), 'ekoa-app-docx-'));
  process.env.EKOA_DATA_DIR = dataDir;

  // Seed: link the fixture, then apply one tracked edit so /current carries a real w:ins and
  // /clean has something to accept.
  await setSource(APP_ID, { buffer: await makeContratoFixture(), fileName: 'contrato.docx', origin: 'path' });
  await applyEdits(
    APP_ID,
    [{ type: 'modify', target_text: 'aviso prévio de 30 dias', new_text: 'aviso prévio de 60 dias' }],
    { author: 'Dra. Ana Marques (Ekoa)' },
  );

  const app = express();
  // Mirror server.ts middleware order: global JSON parser, then the routes. ekoaFetch always
  // sends Content-Type: application/json with an empty body.
  app.use(express.json({ limit: '50mb' }));
  app.use(appDocxRouter({ getStatus, getProjection, getCurrent, getClean, applyReview, restoreSource }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no ephemeral port');
  base = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeMongo();
  await mem.stop();
  if (dataDir && existsSync(dataDir)) await rm(dataDir, { recursive: true, force: true });
});

describe('GET /api/app-docx/status', () => {
  it('requires a valid X-Ekoa-App-Id header', async () => {
    expect((await get('/api/app-docx/status', null)).status).toBe(400);
    expect((await get('/api/app-docx/status', 'usr.someone')).status).toBe(400);
    expect((await get('/api/app-docx/status', '../escape')).status).toBe(400);
  });

  it('reports hasSource:false for an app without a document', async () => {
    const res = await get('/api/app-docx/status', EMPTY_APP_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasSource: false });
  });

  it('reports the linked document', async () => {
    const res = await get('/api/app-docx/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasSource: boolean; fileName: string; updatedAt: string };
    expect(body.hasSource).toBe(true);
    expect(body.fileName).toBe('contrato.docx');
    expect(typeof body.updatedAt).toBe('string');
  });
});

describe('GET /api/app-docx/projection', () => {
  it('returns { markdown, fileName } with the tracked change visible', async () => {
    const res = await get('/api/app-docx/projection');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string; fileName: string };
    expect(body.fileName).toBe('contrato.docx');
    expect(body.markdown).toContain('CONTRATO DE PRESTA');
    expect(body.markdown).toContain('{++'); // the applied redline projects as CriticMarkup
  });

  it('404s (JSON) when the app has no document', async () => {
    const res = await get('/api/app-docx/projection', EMPTY_APP_ID);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });
});

describe('GET /api/app-docx/current', () => {
  it('serves the working docx with tracked changes, as an attachment', async () => {
    const res = await get('/api/app-docx/current');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(DOCX_MIME);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('contrato.docx');
    const xml = await documentXmlOf(res);
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('w:author="Dra. Ana Marques (Ekoa)"');
  });

  it('404s when the app has no document', async () => {
    expect((await get('/api/app-docx/current', EMPTY_APP_ID)).status).toBe(404);
  });
});

describe('POST /api/app-docx/clean', () => {
  it('serves the accepted-revisions docx as {base}-final.docx (empty JSON body tolerated)', async () => {
    const res = await get('/api/app-docx/clean', APP_ID, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(DOCX_MIME);
    expect(res.headers.get('content-disposition')).toContain('contrato-final.docx');
    const xml = await documentXmlOf(res);
    expect(xml).not.toContain('<w:ins '); // revisions accepted
    expect(xml).toContain('aviso pr'); // the accepted text remains
  });

  it('404s when the app has no document', async () => {
    expect((await get('/api/app-docx/clean', EMPTY_APP_ID, { method: 'POST' })).status).toBe(404);
  });
});

describe('POST /api/app-docx/edits (human review surface)', () => {
  it('requires a valid X-Ekoa-App-Id header', async () => {
    const body = JSON.stringify({ ops: [{ type: 'accept', target_id: '1' }] });
    expect((await get('/api/app-docx/edits', null, { method: 'POST', body })).status).toBe(400);
  });

  it('rejects a missing or empty ops list with 400', async () => {
    expect((await get('/api/app-docx/edits', APP_ID, { method: 'POST', body: JSON.stringify({}) })).status).toBe(400);
    expect((await get('/api/app-docx/edits', APP_ID, { method: 'POST', body: JSON.stringify({ ops: [] }) })).status).toBe(400);
  });

  it('rejects an op with an unsupported type with 400', async () => {
    const body = JSON.stringify({ ops: [{ type: 'drop-table', target_id: '1' }] });
    expect((await get('/api/app-docx/edits', APP_ID, { method: 'POST', body })).status).toBe(400);
  });

  it('adds a native comment and returns the fresh projection', async () => {
    const body = JSON.stringify({
      ops: [{
        type: 'modify',
        target_text: 'As partes obrigam-se a manter estrita confidencialidade sobre todas as informações a que tenham acesso no âmbito do presente contrato, incluindo após a sua cessação. A presente obrigação mantém-se por um período de cinco anos após o termo do contrato.',
        new_text: 'As partes obrigam-se a manter estrita confidencialidade sobre todas as informações a que tenham acesso no âmbito do presente contrato, incluindo após a sua cessação. A presente obrigação mantém-se por um período de cinco anos após o termo do contrato.',
        comment: 'Rever prazo: cinco anos pode ser excessivo.',
      }],
    });
    const res = await get('/api/app-docx/edits', APP_ID, { method: 'POST', body });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { markdown: string; fileName: string; report: { edits_applied: number } };
    expect(json.fileName).toBe('contrato.docx');
    expect(json.report.edits_applied).toBe(1);
    expect(json.markdown).toContain('[Com:');
    expect(json.markdown).toContain('cinco anos pode ser excessivo');
  });

  it('surfaces an ambiguous/failed target as 422 with per-op failures, nothing saved', async () => {
    const body = JSON.stringify({
      ops: [{ type: 'modify', target_text: 'texto que nao existe em lado nenhum', new_text: 'x' }],
    });
    const res = await get('/api/app-docx/edits', APP_ID, { method: 'POST', body });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; failures: Array<{ index: number; error: string }> };
    expect(Array.isArray(json.failures)).toBe(true);
    expect(json.failures.length).toBeGreaterThan(0);
  });

  it('404s when the app has no document', async () => {
    const body = JSON.stringify({ ops: [{ type: 'accept', target_id: '1' }] });
    expect((await get('/api/app-docx/edits', EMPTY_APP_ID, { method: 'POST', body })).status).toBe(404);
  });

  // Resolve/unresolve are NOT adeu ops - cortex writes w15:done itself - so the route allow-list
  // and the projection round-trip are pinned here too.
  it('resolves and reopens a comment thread, reflected in the projection', async () => {
    const idOf = (markdown: string): string => {
      const match = /\[Com:(\d+)\]/.exec(markdown);
      if (!match) throw new Error(`no comment in projection: ${markdown.slice(0, 200)}`);
      return match[1] as string;
    };
    const projection = (await (await get('/api/app-docx/projection')).json()) as { markdown: string };
    const commentId = idOf(projection.markdown);

    const resolve = await get('/api/app-docx/edits', APP_ID, {
      method: 'POST',
      body: JSON.stringify({ ops: [{ type: 'resolve', target_id: commentId }] }),
    });
    expect(resolve.status).toBe(200);
    const resolved = (await resolve.json()) as { markdown: string; report: { resolutions_applied: number } };
    expect(resolved.report.resolutions_applied).toBe(1);
    expect(resolved.markdown).toMatch(new RegExp(`\\[Com:${commentId}\\][^\\n]*\\(RESOLVED\\)`));

    const reopen = await get('/api/app-docx/edits', APP_ID, {
      method: 'POST',
      body: JSON.stringify({ ops: [{ type: 'unresolve', target_id: commentId }] }),
    });
    expect(reopen.status).toBe(200);
    const reopened = (await reopen.json()) as { markdown: string };
    expect(reopened.markdown).not.toMatch(new RegExp(`\\[Com:${commentId}\\][^\\n]*\\(RESOLVED\\)`));
  });

  it('422s on a resolve targeting a comment that does not exist', async () => {
    const body = JSON.stringify({ ops: [{ type: 'resolve', target_id: '4242' }] });
    const res = await get('/api/app-docx/edits', APP_ID, { method: 'POST', body });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { failures: Array<{ index: number; error: string }> };
    expect(json.failures[0]!.error).toContain('4242');
  });
});

// The ekoa-code improvement over dev (Amendment 2, KEEP): admission gates the RESOLVED artifact
// owner's activation, fail-closed CONV-2. An artifact-backed app whose owner is deactivated /
// billing-locked cannot touch the document on ANY route - the gate fires before the handler.
describe('owner-activation admission gate (fail-closed, artifact-backed apps)', () => {
  const ART_ID = 'art-docx';
  const OWNER = 'owner-docx';

  beforeEach(async () => {
    __resetActivationForTests();
    await artifacts.deleteMany({});
    await slugs.deleteMany({});
    await artifacts.insert({ _id: ART_ID, name: 'Contrato', slug: 'contrato-app', userId: OWNER, orgId: 'orgA', visibility: 'private' } as never);
    await slugs.put({ _id: 'contrato-app', artifactId: ART_ID });
    // Link a document under the CANONICAL id so, once admitted, the routes have real state.
    await setSource(ART_ID, { buffer: await makeContratoFixture(), fileName: 'contrato.docx', origin: 'path' });
    setActivation(OWNER, { active: true, billingLocked: false });
  });

  it('active owner is admitted (200 on status)', async () => {
    const res = await get('/api/app-docx/status', ART_ID);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { hasSource: boolean }).hasSource).toBe(true);
  });

  it('deactivated owner → 403 ACCOUNT_DISABLED (envelope) on every route', async () => {
    setActivation(OWNER, { active: false, billingLocked: false });
    for (const [path, init] of [
      ['/api/app-docx/status', {}],
      ['/api/app-docx/projection', {}],
      ['/api/app-docx/current', {}],
      ['/api/app-docx/clean', { method: 'POST' }],
      ['/api/app-docx/edits', { method: 'POST', body: JSON.stringify({ ops: [{ type: 'accept', target_id: '1' }] }) }],
      ['/api/app-docx/restore', { method: 'POST' }],
    ] as Array<[string, RequestInit]>) {
      const res = await get(path, ART_ID, init);
      expect(res.status, path).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code, path).toBe('ACCOUNT_DISABLED');
    }
  });

  it('billing-locked owner → 402 BILLING_LOCKED (envelope)', async () => {
    setActivation(OWNER, { active: true, billingLocked: true });
    const res = await get('/api/app-docx/status', ART_ID);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');
  });

  it('a slug header resolves to the canonical id (owner gate still applies)', async () => {
    setActivation(OWNER, { active: false, billingLocked: false });
    const res = await get('/api/app-docx/status', 'contrato-app');
    expect(res.status).toBe(403);
  });
});

/**
 * POST /api/app-docx/restore (2C-S6, ux-qa uxqa-1) - the recourse route behind the review
 * surface: accept/reject rewrite the working .docx in place with no Word-level undo, so the
 * app needs a way back to the pristine source. Same admission and the same error taxonomy as
 * the rest of the plane.
 */
describe('POST /api/app-docx/restore', () => {
  it('requires a valid X-Ekoa-App-Id header', async () => {
    const res = await get('/api/app-docx/restore', null, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('404s when the app has no document', async () => {
    const res = await get('/api/app-docx/restore', EMPTY_APP_ID, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(typeof ((await res.json()) as { error: unknown }).error).toBe('string');
  });

  it('undoes an applied review batch and returns the pristine projection', async () => {
    const appId = 'dev-doc-restore-route';
    await setSource(appId, { buffer: await makeContratoFixture(), fileName: 'contrato.docx', origin: 'path' });
    const before = (await get('/api/app-docx/projection', appId).then((r) => r.json())) as { markdown: string };

    const edit = await get('/api/app-docx/edits', appId, {
      method: 'POST',
      body: JSON.stringify({
        ops: [{ type: 'modify', target_text: 'aviso prévio de 30 dias', new_text: 'aviso prévio de 90 dias' }],
      }),
    });
    expect(edit.status).toBe(200);
    expect(((await edit.json()) as { markdown: string }).markdown).not.toBe(before.markdown);

    const res = await get('/api/app-docx/restore', appId, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markdown: string; fileName: string };
    expect(body.fileName).toBe('contrato.docx');
    expect(body.markdown).toBe(before.markdown);
    // The bytes really went back: the working document carries no tracked insertion again.
    const docx = await get('/api/app-docx/current', appId).then(async (r) => Buffer.from(await r.arrayBuffer()));
    const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
    expect(xml).not.toContain('<w:ins ');
  });
});
