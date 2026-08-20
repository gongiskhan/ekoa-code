import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore, type DefinitionVisibility } from '../../src/integrations/definition-store.js';
import { integrationRecipeStore } from '../../src/integrations/recipe-store.js';
import { capturedCallsStore } from '../../src/integrations/captured-calls-store.js';
import {
  ErrorEnvelope,
  IntegrationRecipeListResponse,
  ForgetIntegrationRecipeResponse,
  integrationsEndpoints,
} from '@ekoa/shared';

/**
 * THE OWNER'S CONTROL OVER WHAT THE MACHINE LEARNED (slice P2), through the REAL app.
 *
 * ── WHY THIS SURFACE HAD TO EXIST ────────────────────────────────────────────────────────────
 *
 * A recipe is compiled by the machine, from one pass, with nobody in the loop, and it then answers
 * the action on every later run. Three of its failure modes clear THEMSELVES because the replay
 * visibly refuses (the write gate, the two coverage refusals). A recipe that keeps answering `ok`
 * and answers WRONGLY - learned from a one-off page state, or from a page whose "summary" endpoint
 * happened to serve the same document as the search - has no such exit: `putRecipe` refuses to
 * overwrite by design, a supersede needs a drift that cannot fire while the calls keep returning 200
 * with an unchanged shape, and nothing expires it. Before these two routes its owner could neither
 * see it nor remove it, for the life of the row.
 *
 * ── WHAT IS PINNED HERE, AND WHERE THE REST IS ───────────────────────────────────────────────
 *
 * The CONTRACT (both bodies against the shared schemas, every non-2xx against the error envelope),
 * the TENANCY of both routes (a peer's private definition and another org's row are invisible AND
 * unclearable), the IDEMPOTENCE of the delete, and - the reason the delete is not a one-liner - that
 * the raw EVIDENCE goes with the recipe, asserted against the collection itself.
 *
 * ADMISSION IS NOT PINNED HERE and does not need to be: `integrations-capability.test.ts` walks this
 * router's own stack and probes every route it finds (unauthenticated must be 401; anything outside
 * the declared capability set must refuse a real gateway key), so a new route is covered by that
 * gate without anyone remembering to extend it. Both of these are `auth: 'user'`.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const KEY = 'p2-recipe-probe';
const ACTION = 'list_cases';
const CAPTURE = 'cap-p2-owner-control';

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });

const listRecipes = (t: string | null) => api('/api/v1/integrations/recipes', t);
const forgetRecipe = (t: string | null, key = KEY, action = ACTION) =>
  api(`/api/v1/integrations/${key}/actions/${action}/recipe`, t, { method: 'DELETE' });

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seedDefinition(orgId: string, ownerUserId: string, visibility: DefinitionVisibility): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId: ownerUserId, visibility, key: KEY,
      displayName: 'P2 Recipe Probe', configSchema: [],
      actions: [{ actionName: ACTION, description: 'lista os processos', mutates: false }],
      skillMd: '# P2 Recipe Probe\n',
    },
    { actor: { userId: ownerUserId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

/** A learned recipe AND the pass it was distilled from, planted through the real stores. */
async function seedLearnedRecipe(orgId: string): Promise<void> {
  await capturedCallsStore.appendCapturedCall(
    { orgId, integrationKey: KEY, actionName: ACTION, captureId: CAPTURE },
    0,
    {
      method: 'GET',
      url: 'https://portal.example/api/cases?ref=2024-1',
      requestHeaderNames: ['accept', 'x-csrf-token'],
      responseBody: '{"items":[{"id":41}]}',
    },
  );
  await integrationRecipeStore.putRecipe(orgId, KEY, ACTION, {
    goal: `replay of ${KEY}/${ACTION}`,
    injectedCalls: [{
      method: 'GET',
      urlTemplate: 'https://portal.example/api/cases?ref={{input.ref}}',
      headerNames: ['accept', 'x-csrf-token'],
      idempotent: true,
    }],
    answersWith: { callIndex: 0, matchedBy: 'run-output-identity' },
    scriptedSteps: [],
    lessons: ['the session travels on x-csrf-token (header names; values are read live at replay)'],
    capturedCallsRef: CAPTURE,
  }, {});
}

/** The evidence rows, read straight off the collection - never through the code under test. */
const evidenceRows = async (orgId: string) =>
  integrationCapturedCalls.find({ orgId, integrationKey: KEY, actionName: ACTION, captureId: CAPTURE });

async function expectEnvelope(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx body must validate against ErrorEnvelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_int_recipes');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, integrationDefinitions, integrationCapturedCalls]) await s.deleteMany({});
  await mkUser('ownerA', 'orgA', 'user');
  await mkUser('peerA', 'orgA', 'user');
  await mkUser('adminA', 'orgA', 'org-admin');
  await mkUser('userB', 'orgB', 'user');
});

describe('P2 - the owner can SEE what their actions learned', () => {
  it('lists the compiled recipe as a summary, and the body validates against the contract', async () => {
    await seedDefinition('orgA', 'ownerA', 'org');
    await seedLearnedRecipe('orgA');

    const res = await listRecipes(await tokenFor('ownerA'));
    expect(res.status).toBe(200);
    const parsed = IntegrationRecipeListResponse.safeParse(await res.json());
    expect(parsed.success, 'the list body must validate against IntegrationRecipeListResponse').toBe(true);

    const items = parsed.data!.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: KEY,
      actionName: ACTION,
      version: 1,
      // The whole point of the read: a human can recognise a recipe that learned the wrong endpoint.
      calls: ['GET https://portal.example/api/cases?ref={{input.ref}}'],
      answersWithCallIndex: 0,
    });
    expect(items[0]!.lessons[0]).toContain('x-csrf-token');
  });

  it('projects a SUMMARY and not the document - the request internals stay off the wire', async () => {
    await seedDefinition('orgA', 'ownerA', 'org');
    await seedLearnedRecipe('orgA');

    const body = await (await listRecipes(await tokenFor('ownerA'))).text();
    // The header NAMES the recipe replays with, the pointer into the raw evidence, and the internal
    // response-shape expectation are all internals of a request the owner did not author. A spread
    // of the stored document would carry every one of them onto this response.
    expect(body).not.toContain('headerNames');
    expect(body).not.toContain('capturedCallsRef');
    expect(body).not.toContain(CAPTURE);
    expect(body).not.toContain('expectShape');
  });

  it('shows an org NOTHING of another org\'s learning, and a peer nothing of a PRIVATE definition', async () => {
    await seedDefinition('orgA', 'ownerA', 'private');
    await seedLearnedRecipe('orgA');

    // The CONTROL first: the owner does see it, so an empty list below is about the reader.
    expect((await (await listRecipes(await tokenFor('ownerA'))).json() as { items: unknown[] }).items).toHaveLength(1);

    for (const who of ['peerA', 'adminA', 'userB']) {
      const res = await listRecipes(await tokenFor(who));
      expect(res.status, who).toBe(200);
      expect((await res.json() as { items: unknown[] }).items, who).toEqual([]);
    }
  });

  it('answers 401 unauthenticated', async () => {
    await expectEnvelope(await listRecipes(null), 401, 'UNAUTHENTICATED');
  });
});

describe('P2 - …and FORGET one, which is the only exit a recipe that answers wrongly has', () => {
  it('clears the recipe AND the raw evidence it was distilled from', async () => {
    await seedDefinition('orgA', 'ownerA', 'org');
    await seedLearnedRecipe('orgA');
    // Non-vacuous: both exist before the call.
    expect(await integrationRecipeStore.getRecipe('orgA', KEY, ACTION)).not.toBeNull();
    expect(await evidenceRows('orgA')).toHaveLength(1);

    const res = await forgetRecipe(await tokenFor('ownerA'));
    expect(res.status).toBe(200);
    const parsed = ForgetIntegrationRecipeResponse.safeParse(await res.json());
    expect(parsed.success, 'the delete body must validate against ForgetIntegrationRecipeResponse').toBe(true);
    expect(parsed.data).toEqual({ ok: true, version: 1, evidenceDiscarded: 1 });

    // THE ACTION IS BACK TO NEVER-HAVING-LEARNED. It goes on working by its authored steps.
    expect(await integrationRecipeStore.getRecipe('orgA', KEY, ACTION)).toBeNull();
    // …AND THE EVIDENCE WENT WITH IT. The recipe was the only index back into that collection, and
    // it has no TTL: a clear that kept the pile would orphan it permanently.
    expect(await evidenceRows('orgA')).toEqual([]);
  });

  it('is IDEMPOTENT: clearing an action that has learned nothing is `ok`, not a 404', async () => {
    await seedDefinition('orgA', 'ownerA', 'org');
    const t = await tokenFor('ownerA');

    const first = await forgetRecipe(t);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, evidenceDiscarded: 0 });

    await seedLearnedRecipe('orgA');
    expect(await (await forgetRecipe(t)).json()).toMatchObject({ ok: true, version: 1 });
    // …and again, now that it really is gone.
    expect(await (await forgetRecipe(t)).json()).toEqual({ ok: true, evidenceDiscarded: 0 });
  });

  it('a PEER may not clear a private definition\'s recipe, and an org-admin may not reach another org\'s', async () => {
    await seedDefinition('orgA', 'ownerA', 'private');
    await seedLearnedRecipe('orgA');

    for (const who of ['peerA', 'adminA', 'userB']) {
      const res = await forgetRecipe(await tokenFor(who));
      // The IDEMPOTENT answer, deliberately - identical to "this action has learned nothing". A 404
      // here would be an existence oracle over whether somebody else's action has been discovered.
      expect(res.status, who).toBe(200);
      expect(await res.json(), who).toEqual({ ok: true, evidenceDiscarded: 0 });
      // AND NOTHING WAS REMOVED, which is what the answer above must not be allowed to hide.
      expect(await integrationRecipeStore.getRecipe('orgA', KEY, ACTION), who).not.toBeNull();
      expect(await evidenceRows('orgA'), who).toHaveLength(1);
    }

    // THE CONTROL: the owner, same route, same row.
    expect(await (await forgetRecipe(await tokenFor('ownerA'))).json()).toMatchObject({ ok: true, version: 1 });
    expect(await integrationRecipeStore.getRecipe('orgA', KEY, ACTION)).toBeNull();
  });

  it('refuses a malformed path segment at the schema, and answers 401 unauthenticated', async () => {
    await seedDefinition('orgA', 'ownerA', 'org');
    await expectEnvelope(await forgetRecipe(await tokenFor('ownerA'), KEY, 'x'.repeat(200)), 400, 'VALIDATION_FAILED');
    await expectEnvelope(await forgetRecipe(null), 401, 'UNAUTHENTICATED');
  });

  it('both routes are declared in the contract exactly as they are mounted', async () => {
    // The descriptor is what the client generator and the mount-coverage gate read. A route whose
    // path or method drifted from its descriptor is mounted somewhere no consumer will look.
    expect(integrationsEndpoints.listRecipes).toMatchObject({
      method: 'GET', path: '/api/v1/integrations/recipes', auth: 'user',
    });
    expect(integrationsEndpoints.forgetRecipe).toMatchObject({
      method: 'DELETE', path: '/api/v1/integrations/:key/actions/:actionName/recipe', auth: 'user',
    });
  });
});
