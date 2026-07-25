/**
 * App DOCX served-app plane (2C-S4) - contract test. Mounts the REAL appDocxRouter over the
 * REAL apps/document-source functions (the composition-root binding) and validates that every
 * 2xx body matches its named `shared/` schema and every non-2xx body matches either the shared
 * ErrorEnvelope (the owner-activation gate) or the accepted served-app flat `{ error }` precedent
 * (the header / 404 / 422 paths). Also pins that each descriptor's `response` schema actually
 * represents the body the route emits (so schema-coverage's COVERED claim is real).
 *
 * Hermetic: mongodb-memory-server (admitApp's resolveApp reads the artifacts/slugs stores) +
 * a temp EKOA_DATA_DIR for the document blobs. No LLM, no network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import {
  AppDocxStatusResponse,
  AppDocxProjectionResponse,
  AppDocxEditsResponse,
  AppDocxRestoreResponse,
  ErrorEnvelope,
  servedAppEndpoints,
} from '@ekoa/shared';
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

const APP_ID = 'ct-doc-base';
const EMPTY_APP_ID = 'ct-doc-empty';
const ART_ID = 'ct-art-docx';
const OWNER = 'ct-owner-docx';
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

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_app_docx_contract');
  dataDir = await mkdtemp(join(tmpdir(), 'ekoa-app-docx-ct-'));
  process.env.EKOA_DATA_DIR = dataDir;

  // Unregistered app id → resolveApp null → admission keys on itself (no activation subject).
  await setSource(APP_ID, { buffer: await makeContratoFixture(), fileName: 'contrato.docx', origin: 'path' });
  await applyEdits(
    APP_ID,
    [{ type: 'modify', target_text: 'aviso prévio de 30 dias', new_text: 'aviso prévio de 60 dias' }],
    { author: 'Dra. Ana Marques (Ekoa)' },
  );

  // Artifact-backed app (owner-activation gate exercised below).
  await artifacts.insert({ _id: ART_ID, name: 'Contrato', slug: 'ct-contrato', userId: OWNER, orgId: 'orgA', visibility: 'private' } as never);
  await slugs.put({ _id: 'ct-contrato', artifactId: ART_ID });
  await setSource(ART_ID, { buffer: await makeContratoFixture(), fileName: 'contrato.docx', origin: 'path' });

  const app = express();
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
  __resetActivationForTests();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeMongo();
  await mem.stop();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('app-docx contract — 2xx bodies validate against their shared schemas', () => {
  it('GET /status (linked) → AppDocxStatusResponse + the descriptor schema', async () => {
    const res = await get('/api/app-docx/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AppDocxStatusResponse.safeParse(body).success).toBe(true);
    expect(servedAppEndpoints.appDocxStatus.response!.safeParse(body).success).toBe(true);
    expect((body as { hasSource: boolean }).hasSource).toBe(true);
  });

  it('GET /status (no document) → AppDocxStatusResponse ({ hasSource:false })', async () => {
    const res = await get('/api/app-docx/status', EMPTY_APP_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AppDocxStatusResponse.safeParse(body).success).toBe(true);
    expect(body).toEqual({ hasSource: false });
  });

  it('GET /projection → AppDocxProjectionResponse', async () => {
    const res = await get('/api/app-docx/projection');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AppDocxProjectionResponse.safeParse(body).success).toBe(true);
    expect(servedAppEndpoints.appDocxProjection.response!.safeParse(body).success).toBe(true);
  });

  it('POST /edits → AppDocxEditsResponse (report + fresh projection)', async () => {
    const res = await get('/api/app-docx/edits', APP_ID, {
      method: 'POST',
      body: JSON.stringify({ ops: [{ type: 'accept', target_id: '1' }] }),
    });
    // Accept may or may not match a live change id, but a 200 carries the schema-valid body;
    // a 422 (ambiguous target) is the flat-error precedent, asserted below. Either way the 2xx
    // shape must validate when it is a 2xx.
    if (res.status === 200) {
      const body = await res.json();
      expect(AppDocxEditsResponse.safeParse(body).success).toBe(true);
      expect(servedAppEndpoints.appDocxEdits.response!.safeParse(body).success).toBe(true);
    } else {
      expect(res.status).toBe(422);
    }
  });

  // 2C-S6 (ux-qa uxqa-1): the recourse route. Accept/reject rewrite the working .docx in
  // place, so the pristine source blob is the only way back — this asserts the contract of
  // that way back, on its own app id so it cannot disturb the fixtures above.
  it('POST /restore → AppDocxRestoreResponse, and the working document really is the source again', async () => {
    const RESTORE_APP = 'ct-doc-restore';
    await setSource(RESTORE_APP, { buffer: await makeContratoFixture(), fileName: 'contrato.docx', origin: 'path' });
    const pristine = (await get('/api/app-docx/projection', RESTORE_APP).then((r) => r.json())) as { markdown: string };

    await get('/api/app-docx/edits', RESTORE_APP, {
      method: 'POST',
      body: JSON.stringify({
        ops: [{ type: 'modify', target_text: 'aviso prévio de 30 dias', new_text: 'aviso prévio de 90 dias' }],
      }),
    });
    const edited = (await get('/api/app-docx/projection', RESTORE_APP).then((r) => r.json())) as { markdown: string };
    expect(edited.markdown, 'the edit must actually have landed').not.toBe(pristine.markdown);

    const res = await get('/api/app-docx/restore', RESTORE_APP, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AppDocxRestoreResponse.safeParse(body).success).toBe(true);
    expect(servedAppEndpoints.appDocxRestore.response!.safeParse(body).success).toBe(true);
    expect((body as { markdown: string }).markdown).toBe(pristine.markdown);
    // ...and it is PERSISTED, not just echoed back.
    const after = (await get('/api/app-docx/projection', RESTORE_APP).then((r) => r.json())) as { markdown: string };
    expect(after.markdown).toBe(pristine.markdown);
  });

  it('POST /restore with no linked document → 404 flat { error }', async () => {
    const res = await get('/api/app-docx/restore', EMPTY_APP_ID, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(typeof ((await res.json()) as { error: unknown }).error).toBe('string');
  });

  it('GET /current + POST /clean stream .docx bytes (binary descriptors)', async () => {
    for (const [path, init] of [
      ['/api/app-docx/current', {}],
      ['/api/app-docx/clean', { method: 'POST' }],
    ] as Array<[string, RequestInit]>) {
      const res = await get(path, APP_ID, init);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toContain(DOCX_MIME);
      expect(res.headers.get('content-disposition'), path).toContain('attachment');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.subarray(0, 2).toString('latin1'), path).toBe('PK'); // zip container magic
      // Binary descriptors declare z.unknown() (no JSON body) - mirror app-files.
      expect(servedAppEndpoints[path.endsWith('current') ? 'appDocxCurrent' : 'appDocxClean'].kind).toBe('binary');
    }
  });
});

describe('app-docx contract — non-2xx bodies (envelope or accepted flat {error})', () => {
  it('missing/invalid header → 400 flat { error } (served-app precedent)', async () => {
    for (const appId of [null, 'usr.someone', '../escape']) {
      const res = await get('/api/app-docx/status', appId);
      expect(res.status, String(appId)).toBe(400);
      const body = (await res.json()) as { error: unknown };
      expect(typeof body.error, String(appId)).toBe('string');
    }
  });

  it('no linked document → 404 flat { error }', async () => {
    const res = await get('/api/app-docx/projection', EMPTY_APP_ID);
    expect(res.status).toBe(404);
    expect(typeof ((await res.json()) as { error: unknown }).error).toBe('string');
  });

  it('ambiguous/failed review target → 422 flat { error, failures }', async () => {
    const res = await get('/api/app-docx/edits', APP_ID, {
      method: 'POST',
      body: JSON.stringify({ ops: [{ type: 'modify', target_text: 'texto inexistente xyz', new_text: 'x' }] }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: unknown; failures: unknown };
    expect(typeof body.error).toBe('string');
    expect(Array.isArray(body.failures)).toBe(true);
  });

  it('deactivated owner → 403 ACCOUNT_DISABLED validates against the shared ErrorEnvelope', async () => {
    setActivation(OWNER, { active: false, billingLocked: false });
    const res = await get('/api/app-docx/status', ART_ID);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('billing-locked owner → 402 BILLING_LOCKED validates against the shared ErrorEnvelope', async () => {
    setActivation(OWNER, { active: true, billingLocked: true });
    const res = await get('/api/app-docx/status', ART_ID);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');
  });
});
