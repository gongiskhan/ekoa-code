import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { artifacts, users } from '../../src/data/stores.js';
import { AppVisionExtractResponse, ErrorEnvelope } from '@ekoa/shared';
import { appVisionRouter } from '../../src/apps/app-vision-route.js';
import type { AppVisionDeps } from '../../src/apps/app-vision.js';

/**
 * CONTRACT: the served-app document-extraction plane `POST /api/app-vision/extract`.
 *
 * The plane spends the OWNER's model budget on behalf of a visitor with no account, so admission is
 * the security boundary and it is pinned here: an unknown app, a dev-serve app with no artifact
 * owner, and a deactivated or billing-locked owner all get nothing — and the model is never called.
 *
 * Also pinned: a refusal is a TYPED body on a 422 (the app branches on `code`), while an admission
 * refusal is the shared ERROR envelope. Two different things, two different shapes, deliberately.
 *
 * The model seam is canned — no live egress.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let modelCalls = 0;

const deps: AppVisionDeps = {
  oneShot: async () => {
    modelCalls++;
    return { text: '{"numeroFatura":"FT 2026/18"}', usage: { input_tokens: 1, output_tokens: 1 } as never };
  },
  decide: () => ({ tier: 'WORKHORSE', model: 'test-model', effort: 'medium' }) as never,
  extractPdfText: async () => 'FATURA FT 2026/18 — total 1230,00 EUR, vencimento 2026-04-03, IBAN PT50…',
  parseJson: (t) => JSON.parse(t) as unknown,
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_app_vision_contract');

  await users.put({ _id: 'owner1', orgId: 'org1' } as never);
  await users.put({ _id: 'ownerDead', orgId: 'org1' } as never);
  await users.put({ _id: 'ownerLocked', orgId: 'org1' } as never);
  await artifacts.put({ _id: 'app1', userId: 'owner1', name: 'App', type: 'web_app' } as never);
  await artifacts.put({ _id: 'dead', userId: 'ownerDead', name: 'Dead', type: 'web_app' } as never);
  await artifacts.put({ _id: 'locked', userId: 'ownerLocked', name: 'Locked', type: 'web_app' } as never);

  const app = express();
  app.use('/api', appVisionRouter(deps));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeMongo();
  await mem.stop();
});

beforeEach(() => {
  modelCalls = 0;
  __resetActivationForTests();
  setActivation('owner1', { active: true, billingLocked: false });
  setActivation('ownerDead', { active: false, billingLocked: false });
  setActivation('ownerLocked', { active: true, billingLocked: true });
});

function extract(body: unknown, appId?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/app-vision/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(appId ? { 'x-ekoa-app-id': appId } : {}) },
    body: JSON.stringify(body),
  });
}

const PDF_BODY = { kind: 'invoice', pdfBase64: 'JVBERi0xLjQK' };

describe('app-vision contract — the wire shape', () => {
  it('a successful extraction is a 200 validating against the shared schema', async () => {
    const res = await extract(PDF_BODY, 'app1');
    expect(res.status).toBe(200);
    const parsed = AppVisionExtractResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({ success: true, data: { numeroFatura: 'FT 2026/18' } });
  });

  it('a REFUSED extraction is a 422 carrying the same typed body', async () => {
    // Both inputs at once — the plane cannot say which was read, so it reads neither.
    const res = await extract({ kind: 'invoice', pdfBase64: 'AA', imageBase64: 'BB' }, 'app1');
    expect(res.status).toBe(400); // caught by the shared request schema's refine, before the service
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('an unreadable document is a 422 with a typed code, not an envelope', async () => {
    const failing = { ...deps, extractPdfText: async () => { throw new Error('boom'); } };
    const app = express();
    app.use('/api', appVisionRouter(failing));
    const s = app.listen(0);
    const p = (s.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${p}/api/app-vision/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ekoa-app-id': 'app1' },
        body: JSON.stringify(PDF_BODY),
      });
      expect(res.status).toBe(422);
      const parsed = AppVisionExtractResponse.safeParse(await res.json());
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.code).toBe('invalid_input');
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it('an unknown kind is a 400 envelope', async () => {
    const res = await extract({ kind: 'passport', pdfBase64: 'AA' }, 'app1');
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});

describe('app-vision contract — admission fails closed, and never spends a token', () => {
  it('without the app-id header: 400, no model call', async () => {
    const res = await extract(PDF_BODY);
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    expect(modelCalls).toBe(0);
  });

  it('an unknown app: 404, no model call', async () => {
    const res = await extract(PDF_BODY, 'nope');
    expect(res.status).toBe(404);
    expect(modelCalls).toBe(0);
  });

  it('a DEACTIVATED owner: 403 ACCOUNT_DISABLED, no model call', async () => {
    const res = await extract(PDF_BODY, 'dead');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
    expect(modelCalls).toBe(0);
  });

  it('a BILLING-LOCKED owner: 402 BILLING_LOCKED, no model call', async () => {
    const res = await extract(PDF_BODY, 'locked');
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');
    expect(modelCalls).toBe(0);
  });

  it('the body limit is the PLANE’s, not the global 1 MB parser’s', async () => {
    // ~2 MB of base64: comfortably over the global parser's limit and under this plane's, so it
    // must reach the service and be answered on its merits rather than 413'd by the wrong parser.
    const res = await extract({ kind: 'invoice', imageBase64: 'A'.repeat(2_000_000), mediaType: 'image/png' }, 'app1');
    expect(res.status).toBe(200);
    expect(AppVisionExtractResponse.safeParse(await res.json()).success).toBe(true);
  });
});
