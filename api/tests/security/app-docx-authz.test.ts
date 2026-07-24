/**
 * App DOCX authz TRIPWIRE (2C-S4) — this suite PINS the CURRENT, UNHARDENED behavior of
 * `/api/app-docx/*`; it is NOT a proof of safety.
 *
 * KNOWN HIGH GAP (`served-app-data-unauthenticated-writes`, docs/findings.md + docs/security.md):
 * `apps/app-docx.ts` mirrors app-files' `admitApp` (mandated for consistency), which authenticates
 * NO CALLER — it checks only a well-formed `X-Ekoa-App-Id` plus the resolved OWNER's activation.
 * So any anonymous holder of an app id can read the owner's source Word document in full, download
 * its bytes, and PERSIST tracked changes that `document-source.applyReview` attributes to the
 * ARTIFACT OWNER's username (an outsider's edit is recorded in a legal .docx as authored by the
 * lawyer). Two remanence/skip facts are pinned too: a DELETED artifact's id resolves to null, so
 * `artifactBacked` is false and the owner-activation gate is SKIPPED entirely on the orphaned
 * document.
 *
 * WHY PIN IT: so the gap can never be quietly "fixed" or quietly regress. When caller/session auth
 * lands on the served-app planes, these expectations FLIP and this suite fails ON PURPOSE — at
 * which point update docs/findings.md + docs/security.md and rewrite this suite to assert the new
 * server-side authorization. The genuinely-enforced half (the owner-activation gate) is asserted
 * positively at the end, and the mount probe proves the router is actually wired into buildApp.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import JSZip from 'jszip';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { artifacts, slugs, users } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig, defaultLlmConfig, type Config } from '../../src/config.js';
import { buildApp } from '../../src/server.js';
import { appDocxRouter } from '../../src/apps/app-docx.js';
import {
  setSource,
  getStatus,
  getProjection,
  getCurrent,
  getClean,
  applyReview,
} from '../../src/apps/document-source.js';
import { makeContratoFixture } from '../services/docx/contrato-fixture.js';

const ART_ID = 'authz-art-docx';
const OWNER = 'authz-owner-docx';
const OWNER_NAME = 'Dra. Ana Marques';

let mem: MongoMemoryServer;
let server: Server;
let base: string;
let dataDir: string;

/** A deliberately ANONYMOUS request: no JWT, no cookie, no session — only the app id. */
const anon = (path: string, appId: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': appId, ...(init.headers ?? {}) },
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_app_docx_authz');
  dataDir = await mkdtemp(join(tmpdir(), 'ekoa-app-docx-authz-'));
  process.env.EKOA_DATA_DIR = dataDir;

  await users.insert({ _id: OWNER, username: OWNER_NAME, orgId: 'orgA', role: 'user', active: true } as never);
  await artifacts.insert({ _id: ART_ID, name: 'Contrato', slug: 'authz-contrato', userId: OWNER, orgId: 'orgA', visibility: 'private' } as never);
  await slugs.put({ _id: 'authz-contrato', artifactId: ART_ID });
  await setSource(ART_ID, { buffer: await makeContratoFixture(), fileName: 'contrato.docx', origin: 'path' });
  setActivation(OWNER, { active: true, billingLocked: false });

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(appDocxRouter({ getStatus, getProjection, getCurrent, getClean, applyReview }));
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no ephemeral port');
  base = `http://127.0.0.1:${addr.port}`;
}, 60_000);

afterAll(async () => {
  __resetActivationForTests();
  await new Promise<void>((r) => server.close(() => r()));
  await closeMongo();
  await mem.stop();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('KNOWN HIGH GAP (tripwire): /api/app-docx/* authenticates NO caller — app id alone is full access', () => {
  it('an ANONYMOUS caller holding only the app id reads the owner\'s full document text — CLOSING THIS FLIPS THE TRIPWIRE', async () => {
    const res = await anon('/api/app-docx/projection', ART_ID);
    expect(res.status, 'anonymous read is currently allowed (the gap)').toBe(200);
    const body = (await res.json()) as { markdown: string; fileName: string };
    // The private document's actual contents come back to a caller who proved nothing.
    expect(body.markdown).toContain('CONTRATO DE PRESTAÇÃO DE SERVIÇOS JURÍDICOS');
    expect(body.fileName).toBe('contrato.docx');
  });

  it('an ANONYMOUS caller downloads the raw .docx bytes (/current and /clean)', async () => {
    for (const [path, init] of [
      ['/api/app-docx/current', {}],
      ['/api/app-docx/clean', { method: 'POST' }],
    ] as Array<[string, RequestInit]>) {
      const res = await anon(path, ART_ID, init);
      expect(res.status, path).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString('latin1'), path).toBe('PK');
    }
  });

  it('an ANONYMOUS caller PERSISTS a comment, and it is attributed to the ARTIFACT OWNER (the aggravating factor)', async () => {
    const res = await anon('/api/app-docx/edits', ART_ID, {
      method: 'POST',
      body: JSON.stringify({
        ops: [{
          type: 'modify',
          target_text: 'O presente contrato rege-se pela lei portuguesa.',
          new_text: 'O presente contrato rege-se pela lei portuguesa.',
          comment: 'Comentario inserido por um terceiro anonimo.',
        }],
      }),
    });
    expect(res.status, 'anonymous MUTATION is currently allowed (the gap)').toBe(200);
    const body = (await res.json()) as { markdown: string; report: { edits_applied: number } };
    expect(body.report.edits_applied).toBe(1);

    // The mutation PERSISTED (a fresh read shows it) and carries the OWNER's name as author —
    // an outsider's comment is recorded in the legal .docx as authored by the lawyer.
    const after = await anon('/api/app-docx/current', ART_ID);
    const zip = await JSZip.loadAsync(Buffer.from(await after.arrayBuffer()));
    const commentsXml = await zip.file('word/comments.xml')?.async('string');
    expect(commentsXml, 'the anonymous comment persisted into the document').toContain('terceiro anonimo');
    expect(commentsXml, 'attributed to the OWNER, not the anonymous caller').toContain(OWNER_NAME);
  });

  it('a DELETED artifact skips the owner-activation gate entirely: the orphaned document stays readable (remanence)', async () => {
    // deleteArtifact removes only the artifact row; the app-data/{appId}/docx blobs are left behind.
    await artifacts.delete(ART_ID);
    // Even with the owner HARD-DISABLED, the gate no longer applies: resolveApp is null, so
    // artifactBacked is false and admitApp keys on the raw id.
    setActivation(OWNER, { active: false, billingLocked: false });
    const res = await anon('/api/app-docx/projection', ART_ID);
    expect(res.status, 'orphaned document still served (the gate has no subject)').toBe(200);
    expect(((await res.json()) as { markdown: string }).markdown).toContain('CONTRATO DE PRESTA');

    // restore for any later test / clarity
    await artifacts.insert({ _id: ART_ID, name: 'Contrato', slug: 'authz-contrato', userId: OWNER, orgId: 'orgA', visibility: 'private' } as never);
    setActivation(OWNER, { active: true, billingLocked: false });
  });
});

describe('what IS enforced: the owner-activation gate (fail-closed CONV-2) — this half is a real boundary', () => {
  it('a deactivated owner\'s document is refused to EVERY caller (403), and billing-lock is 402', async () => {
    setActivation(OWNER, { active: false, billingLocked: false });
    const disabled = await anon('/api/app-docx/projection', ART_ID);
    expect(disabled.status).toBe(403);
    expect(((await disabled.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');

    setActivation(OWNER, { active: true, billingLocked: true });
    const locked = await anon('/api/app-docx/projection', ART_ID);
    expect(locked.status).toBe(402);
    expect(((await locked.json()) as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');

    // No activation record at all fails CLOSED (not open).
    __resetActivationForTests();
    expect((await anon('/api/app-docx/projection', ART_ID)).status).toBe(403);
    setActivation(OWNER, { active: true, billingLocked: false });
  });
});

/**
 * Mount probe (fresh-review finding): every other app-docx test mounts the router itself, so
 * deleting the `app.use('/', appDocxRouter(...))` line in server.ts would leave them all green.
 * This drives the REAL buildApp and proves the router claims the path.
 */
describe('the app-docx router is actually MOUNTED in the real server (buildApp)', () => {
  let realServer: Server;
  let realPort: number;

  beforeAll(async () => {
    const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
    const app = buildApp(cfg, { now: () => 1_700_000_000_000, genId: () => 'id_probe' });
    await new Promise<void>((r) => { realServer = app.listen(0, () => r()); });
    realPort = (realServer.address() as { port: number }).port;
  }, 60_000);

  afterAll(async () => { await new Promise<void>((r) => realServer.close(() => r())); });

  it('every /api/app-docx route answers with its OWN admission gate, never an unmounted fallthrough', async () => {
    // No X-Ekoa-App-Id -> the router's own 400. If the mount were removed, these would fall
    // through to the SPA/static handler (or a non-JSON 404), and this test fails ON PURPOSE.
    for (const [path, method] of [
      ['/api/app-docx/status', 'GET'],
      ['/api/app-docx/projection', 'GET'],
      ['/api/app-docx/current', 'GET'],
      ['/api/app-docx/clean', 'POST'],
      ['/api/app-docx/edits', 'POST'],
    ] as Array<[string, string]>) {
      const res = await fetch(`http://127.0.0.1:${realPort}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${path} should hit the router's admission gate`).toBe(400);
      expect(((await res.json()) as { error: string }).error, path).toBe('Missing or invalid X-Ekoa-App-Id header');
    }
  });
});
