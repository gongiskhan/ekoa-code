import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationDefinitions, integrationActionEvidence } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore, type DefinitionVisibility } from '../../src/integrations/definition-store.js';
import { actionEvidenceStore } from '../../src/integrations/action-evidence-store.js';
import { ErrorEnvelope, IntegrationActionEvidenceListResponse } from '@ekoa/shared';

/**
 * WHAT EACH ACTION DID THE LAST TIME IT WORKED (slice S2), through the REAL app.
 *
 * ── WHAT THIS ENDPOINT IS FOR ────────────────────────────────────────────────────────────────
 *
 * The integration detail page renders an action's steps READ-ONLY, and a step list with no sample
 * beside it tells a person nothing about whether the action works: an api-call action shows a URL
 * template, a browser-steps action shows the automation's steps, and both are equally plausible
 * whether the action last succeeded or has never run at all. Slice S1 records the sample on every
 * validated run; this is the read that puts it on the page.
 *
 * ── WHAT IS PINNED HERE, AND WHERE THE REST IS ───────────────────────────────────────────────
 *
 * The CONTRACT: both evidence kinds against `IntegrationActionEvidenceListResponse`, every non-2xx
 * against the error envelope (401, 403, 404 and 400), the malformed segment as a 400 and the
 * unknown key as the house 404, and - the reason the projection is not a spread - the storage
 * envelope asserted ABSENT from the response bytes.
 *
 * THE READ IS OWNER-SCOPED, so every fixture below is planted under the very user whose token asks
 * for it: the store keys a row by `(orgId, ownerUserId, integrationKey, actionName)` and the view
 * passes the verified actor's own two terms. A fixture planted under another owner would answer an
 * empty list for a reason that has nothing to do with the case being made.
 *
 * TENANCY and the DEFINITION-READ-PREDICATE filter are in
 * `api/tests/security/action-evidence-view-isolation.test.ts` (Rule 5 class), where each is proved
 * by deleting the control and watching the case go red.
 *
 * ADMISSION is not pinned here and does not need to be: `integrations-capability.test.ts` walks
 * this router's own stack and probes every route it finds - unauthenticated must be 401, and any
 * route outside the declared capability set must refuse a real gateway key. This route is
 * `auth: 'user'`, so that walk is what holds it off the key surface.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const KEY = 's2-evidence-probe';
const HTTP_ACTION = 'consultar_processo';
const RUN_ACTION = 'listar_pendentes';

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });

const listEvidence = (t: string | null, key = KEY) => api(`/api/v1/integrations/${key}/evidence`, t);

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

/** The definition both actions live on. Visibility is a parameter because the tenancy suite next
 *  door varies it; here it is always `org` so the reader is never the question. */
async function seedDefinition(orgId: string, ownerUserId: string, visibility: DefinitionVisibility = 'org'): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId: ownerUserId, visibility, key: KEY,
      displayName: 'S2 Evidence Probe', configSchema: [],
      actions: [
        { actionName: HTTP_ACTION, description: 'consulta um processo', mutates: false,
          httpConfig: { method: 'GET', baseUrl: 'https://portal.example', path: '/processos/{{input.ref}}' } },
        { actionName: RUN_ACTION, description: 'lista os pendentes', mutates: false,
          automationBinding: { automationId: 'aut-s2-evidence' } },
      ],
      skillMd: '# S2 Evidence Probe\n',
    },
    { actor: { userId: ownerUserId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

/**
 * The api-call sample, planted through the REAL store so the row is the shape production writes.
 *
 * THE KEY IS THE PRODUCTION KEY, all four terms including `ownerUserId` - the read is owner-scoped,
 * so the sample is planted under the very user whose token asks for it, exactly as
 * `server.ts`'s `recordActionEvidence` stamps it from the run's own custodian. `request.truncated`
 * is the executor's own flag for a request body cut at the cap, and it is on the fixture because it
 * is on the stored shape: a contract that could not carry it would drop it silently on the wire.
 */
async function seedApiCallEvidence(orgId: string, ownerUserId: string): Promise<void> {
  await actionEvidenceStore.recordEvidence(
    { orgId, ownerUserId, integrationKey: KEY, actionName: HTTP_ACTION },
    {
      backingType: 'api-call',
      shape: 'sha-http-1',
      evidence: {
        kind: 'api-call',
        request: {
          method: 'GET',
          url: 'https://portal.example/processos/2024-1',
          headers: { accept: 'application/json', authorization: '***' },
          body: '{"ref":"2024-1"}',
          truncated: true,
        },
        response: { status: 200, body: '{"numero":"2024-1","estado":"pendente"}', bodyIsJson: true },
      },
    },
  );
}

/**
 * The automation sample: POINTERS into a run, which is what a browser-steps action stores.
 *
 * THE STEP FIELD IS `status`, which is what the real collector writes
 * (`api/src/automation/action-evidence.ts` fills it from `StepRecord.status`) and what
 * `RunStepEvidence` declares. S1 renamed it off `title` precisely because a step has no title and
 * every step of every sample rendered as "succeeded"; a fixture still saying `title` would be
 * planting a row production cannot emit, and zod's unknown-key stripping would keep the contract
 * assertion quiet about it.
 */
async function seedRunEvidence(orgId: string, ownerUserId: string): Promise<void> {
  await actionEvidenceStore.recordEvidence(
    { orgId, ownerUserId, integrationKey: KEY, actionName: RUN_ACTION },
    {
      backingType: 'browser-steps',
      shape: 'sha-run-1',
      evidence: {
        kind: 'automation',
        runId: 'run-s2-1',
        status: 'succeeded',
        steps: [
          { stepIndex: 0, stepType: 'navigate', status: 'succeeded', screenshotUrl: '/automation-screenshots/aut-s2-evidence/run-s2-1/0.png' },
          { stepIndex: 1, stepType: 'local_command', status: 'succeeded', excerpt: 'total 3 pendentes' },
        ],
      },
    },
  );
}

async function expectEnvelope(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx body must validate against ErrorEnvelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_s2_action_evidence');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  // `integrationActionEvidence` is in the cleanup list for the reason S1's achieve suite records:
  // one case's leftover row makes another case's "this action has no evidence" quietly untrue.
  for (const s of [users, integrationDefinitions, integrationActionEvidence]) await s.deleteMany({});
  await mkUser('ownerA', 'orgA', 'user');
  await mkUser('userB', 'orgB', 'user');
});

describe('S2 - the detail page can read what an action last did', () => {
  it('answers both evidence kinds, and the body validates against the contract', async () => {
    await seedDefinition('orgA', 'ownerA');
    await seedApiCallEvidence('orgA', 'ownerA');
    await seedRunEvidence('orgA', 'ownerA');

    const res = await listEvidence(await tokenFor('ownerA'));
    expect(res.status).toBe(200);
    const parsed = IntegrationActionEvidenceListResponse.safeParse(await res.json());
    expect(parsed.success, 'the list body must validate against IntegrationActionEvidenceListResponse').toBe(true);

    const items = parsed.data!.items;
    expect(items.map((i) => i.actionName).sort()).toEqual([HTTP_ACTION, RUN_ACTION].sort());

    const http = items.find((i) => i.actionName === HTTP_ACTION)!;
    expect(http.backingType).toBe('api-call');
    expect(http.shape).toBe('sha-http-1');
    // The discriminated union has to survive the round trip: a client renders a request/response
    // pair for one kind and a step list for the other, and picks on `kind`.
    expect(http.evidence.kind).toBe('api-call');
    if (http.evidence.kind !== 'api-call') throw new Error('unreachable');
    expect(http.evidence.request.url).toBe('https://portal.example/processos/2024-1');
    // The REQUEST body's own truncation flag survives the round trip. It is a separate field from
    // the response's, and a contract that dropped it would tell a reader an already-cut request
    // body is the whole request - the exact silence S1's cap was written against.
    expect(http.evidence.request.truncated).toBe(true);
    expect(http.evidence.response.status).toBe(200);

    const run = items.find((i) => i.actionName === RUN_ACTION)!;
    expect(run.backingType).toBe('browser-steps');
    expect(run.evidence.kind).toBe('automation');
    if (run.evidence.kind !== 'automation') throw new Error('unreachable');
    expect(run.evidence.runId).toBe('run-s2-1');
    // The POINTERS are the whole automation-backed sample: a screenshot path into the
    // authenticated plane and the step's own excerpt, never image bytes.
    expect(run.evidence.steps.map((s) => s.stepIndex)).toEqual([0, 1]);
    expect(run.evidence.steps[0]!.screenshotUrl).toBe('/automation-screenshots/aut-s2-evidence/run-s2-1/0.png');
    expect(run.evidence.steps[1]!.excerpt).toBe('total 3 pendentes');
    // The step's own outcome word, under the name the collector actually writes it under. Asserted
    // because `IntegrationActionEvidenceStep` declaring the WRONG name is invisible otherwise: zod
    // strips unknown keys, so a mismatched contract answers `undefined` rather than failing.
    expect(run.evidence.steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('projects the row and NOT the document - the storage envelope stays off the wire', async () => {
    await seedDefinition('orgA', 'ownerA');
    await seedApiCallEvidence('orgA', 'ownerA');

    const body = await (await listEvidence(await tokenFor('ownerA'))).text();
    // Non-vacuous: the response really does carry this action's sample.
    expect(body).toContain(HTTP_ACTION);
    // `_id` is the deterministic hash over (org, owner, integration, action); `orgId` and
    // `ownerUserId` are the tenancy substrate. A spread of the stored document would put all of
    // them on every item, and the owner term is the one a reader must never see: it names which
    // colleague's third-party account produced the sample.
    expect(body).not.toContain('"_id"');
    expect(body).not.toContain('orgId');
    expect(body).not.toContain('orgA');
    expect(body).not.toContain('ownerUserId');
    expect(body).not.toContain('ownerA');
  });

  it('answers an EMPTY list for an integration whose actions have never run', async () => {
    await seedDefinition('orgA', 'ownerA');

    const res = await listEvidence(await tokenFor('ownerA'));
    expect(res.status).toBe(200);
    expect((await res.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('answers the house 404 for a key that does not resolve, and 400 for a malformed segment', async () => {
    const token = await tokenFor('ownerA');
    // No definition seeded at all: not addressable, so not found - the same verdict a key the
    // caller may not see gets, on purpose (no existence oracle).
    await expectEnvelope(await listEvidence(token, 'no-such-integration'), 404, 'NOT_FOUND');
    // The segment has a declared shape (`IntegrationKeyParams`), so an over-long one is a 400.
    await expectEnvelope(await listEvidence(token, 'x'.repeat(200)), 400, 'VALIDATION_FAILED');
  });

  it('answers 401 unauthenticated', async () => {
    await seedDefinition('orgA', 'ownerA');
    await seedApiCallEvidence('orgA', 'ownerA');
    await expectEnvelope(await listEvidence(null), 401, 'UNAUTHENTICATED');
  });

  it('answers the FORBIDDEN envelope to an authenticated caller whose principal names no org', async () => {
    await seedDefinition('orgA', 'ownerA');
    await seedApiCallEvidence('orgA', 'ownerA');
    // Authenticated, and refused for a reason that is not authentication: since A2 the org SELECTS
    // which definition resolves, so resolving anything for an org-less principal would mean
    // resolving an arbitrary tenant's package. `refuseCapability` maps that `no_tenant` refusal to
    // 403 rather than to the house 404, so a real missing integration stays distinguishable - and
    // this is the arm's only assertion ON THE WIRE: the module-level pin next door cannot see the
    // status code, the envelope, or that the route reaches `refuseCapability` at all.
    await mkUser('nomad', '', 'user');
    await expectEnvelope(await listEvidence(await tokenFor('nomad')), 403, 'FORBIDDEN');
  });
});

describe('S2 - and never another tenant\'s (the contract-level control; the suite next door proves the filters)', () => {
  it('shows org B nothing of org A\'s evidence for the same integration key', async () => {
    await seedDefinition('orgA', 'ownerA');
    await seedApiCallEvidence('orgA', 'ownerA');
    // Org B holds its OWN definition for the same key so the read is addressable for them too -
    // otherwise a 404 would pass this case for the wrong reason.
    await mkUser('ownerB', 'orgB', 'user');
    await seedDefinition('orgB', 'ownerB');

    // The CONTROL: org A does see its own row, so an empty list below is about the reader.
    expect((await (await listEvidence(await tokenFor('ownerA'))).json() as { items: unknown[] }).items).toHaveLength(1);

    const res = await listEvidence(await tokenFor('ownerB'));
    expect(res.status).toBe(200);
    expect((await res.json() as { items: unknown[] }).items).toEqual([]);
  });
});
