import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  users,
  gatewayKeys,
  activityLogs,
  billingAccounts,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
  integrationActionEvidence,
} from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { __resetGatewayKeysServiceForTests } from '../../src/auth/gateway-keys-service.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import { actionEvidenceStore } from '../../src/integrations/action-evidence-store.js';
import {
  ErrorEnvelope,
  AchieveIntegrationGoalResponse,
  IntegrationCapability,
  IntegrationActionConsentRequest,
  TrustAuthoredActionResponse,
  DiscardActionEvidenceResponse,
  integrationsEndpoints,
} from '@ekoa/shared';

/**
 * Slice D3 — `achieve` (EXECUTE-OR-AUTHOR) through the REAL app.
 *
 * What only an end-to-end suite can pin, and what this one is for:
 *
 *  1. THE EXECUTE ARM MEETS THE SAME GATE ON THE SAME WIRE. `achieve` on a goal that names a
 *     `mutates` action answers the IDENTICAL 403 + `awaiting_consent` envelope `POST …/execute`
 *     answers, with ZERO upstream requests. A client handles the write gate in one place.
 *  2. THE AUTHOR ARM RUNS NOTHING. A goal nothing satisfies comes back `authored` + `provisional`
 *     with the upstream still untouched, the new action visible as `provisional` in the capability
 *     view, and the SAME key immediately refused when it tries to execute what was just written.
 *  3. THE KEY CANNOT BLESS ITS OWN WORK. `POST …/trust` is `auth: 'user'`: the gateway key that
 *     just authored the action gets 401 there, and only the human's JWT promotes it. After that —
 *     and only after — the same key's `achieve` call actually goes out.
 *  4. THE WIRE SHAPES. Every 2xx safeParses against its named `shared/` schema; every non-2xx
 *     against the shared error envelope.
 *
 * TWO FAKES, BOTH AT THE EDGES, and everything between them is the real thing. `guardedFetch` is
 * mocked so the remote is deterministic (which is what makes "the upstream was never called" an
 * assertion about the REAL executor). `agents/authoring-core.ts` is mocked so no test makes a model
 * call — and only the model TURN is faked: the mock drives the caller's own `parse` seam, so the
 * module's prompt, parser, deterministic guardrail suite, fork rule and persistence are all real.
 */
const upstream = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method?: string }>,
  status: 200,
  body: '{"ok":true}',
}));
vi.mock('../../src/services/url-fetcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/url-fetcher.js')>();
  return {
    ...actual,
    guardedFetch: async (url: string, opts: { method?: string } = {}) => {
      upstream.calls.push({ url, method: opts.method });
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } });
    },
  };
});

const drafts = vi.hoisted(() => ({ reply: '', turns: 0 }));
vi.mock('../../src/agents/authoring-core.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/authoring-core.js')>();
  return {
    ...actual,
    // A miniature of the real core: it honours the caller's `userText` + `parse` + repair budget,
    // so the only thing that does NOT happen is the chokepoint call.
    authorWithRepair: async (input: {
      userText: (v: readonly string[] | null) => string;
      parse: (t: string) => { draft: unknown; violations: string[] };
      repairs?: number;
    }) => {
      drafts.turns++;
      input.userText(null);
      const parsed = input.parse(drafts.reply);
      return { status: 'authored' as const, text: drafts.reply, draft: parsed.draft, violations: parsed.violations, attempts: 1 };
    },
  };
});

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const PROBE_INTEGRATION = 'd3-achieve-contract';
const HOST = 'https://writes.example';

const writeAction: IntegrationAction = {
  actionName: 'send_message',
  description: 'Enviar mensagem',
  mutates: true,
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/messages' },
};
const readAction: IntegrationAction = {
  actionName: 'list_things',
  description: 'Listar coisas',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/things' },
};

/** The draft the faked turn emits: a READ, on the host the credential is already bound to. */
const AUTHORED = {
  actionName: 'exportar_faturas',
  description: 'Exporta as faturas do periodo',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/faturas' },
};
const AUTHORED_GOAL = 'exportar faturas';

const call = (p: string, auth: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(init.headers ?? {}) },
  });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

async function mintKey(token: string, label: string): Promise<{ id: string; key: string }> {
  const res = await call('/api/v1/gateway-keys', token, { method: 'POST', body: JSON.stringify({ label }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string };
}

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user' = 'user'): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seed(actions: IntegrationAction[], key = PROBE_INTEGRATION, orgId = 'orgA', userId = 'ownerA'): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility: 'private', key,
      displayName: 'D3 Achieve', configSchema: [], actions, skillMd: '# probe', authType: 'none',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

const achieve = (auth: string, goal: string, args?: Record<string, unknown>, key = PROBE_INTEGRATION) =>
  call(`/api/v1/integrations/${key}/achieve`, auth, { method: 'POST', body: JSON.stringify({ goal, ...(args ? { args } : {}) }) });

async function expectEnvelope(res: Response, status: number, code: string): Promise<Record<string, unknown>> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx must be the shared envelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
  return body;
}

/** The capability view of one action, which is where a client learns the shape + authoring state. */
async function actionView(auth: string, actionName: string): Promise<{ shape: string; authoringState?: string; requiresApproval: boolean }> {
  const res = await call(`/api/v1/integrations/${PROBE_INTEGRATION}`, auth);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { actions: Array<{ actionName: string; shape: string; authoringState?: string; requiresApproval: boolean }> };
  expect(IntegrationCapability.safeParse(body).success, JSON.stringify(body)).toBe(true);
  return body.actions.find((a) => a.actionName === actionName)!;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_d3_achieve_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  __resetGatewayKeysServiceForTests();
  upstream.calls.length = 0;
  upstream.status = 200;
  upstream.body = '{"ok":true}';
  drafts.turns = 0;
  drafts.reply = `\`\`\`action-json\n${JSON.stringify(AUTHORED)}\n\`\`\``;
  // `integrationActionEvidence` IS IN THIS LIST FOR A REASON (slice S1). The executor now records an
  // evidence row on every successful run, and the graduation gate READS that collection - so a row
  // left behind by an earlier case in this file makes "cannot be promoted having never run" pass
  // for the wrong reason, or fail for one. Found exactly that way: the journey spec passed alone and
  // failed in the full contract run.
  for (const s of [users, gatewayKeys, activityLogs, billingAccounts, integrationConfigs, integrationDefinitions, approvedIntegrationActions, integrationActionEvidence]) {
    await s.deleteMany({});
  }
  await mkUser('ownerA', 'orgA');
  await mkUser('ownerB', 'orgB');
  await seed([readAction, writeAction]);
});

// ---------------------------------------------------------------------------------------------
// 1. The execute arm
// ---------------------------------------------------------------------------------------------

describe('achieve EXECUTES an existing action, and inherits the write gate on the same wire', () => {
  it('a goal naming a mutating action answers the SAME 403 awaiting_consent, and nothing is sent', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd3-gate');

    const res = await achieve(minted.key, 'send message');
    const body = await expectEnvelope(res, 403, 'FORBIDDEN');
    const details = (body as { error: { details?: { code?: string; consentRequest?: unknown } } }).error.details!;
    expect(details.code).toBe('awaiting_consent');
    expect(IntegrationActionConsentRequest.safeParse(details.consentRequest).success, JSON.stringify(details)).toBe(true);
    // THE LOAD-BEARING ASSERTION: no request left the process.
    expect(upstream.calls).toEqual([]);
    // …and the drafting model was never reached either: a matched action is not a reason to author.
    expect(drafts.turns).toBe(0);
  });

  it('a goal naming a READ runs it, and the body is the schema-valid executed envelope', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd3-read');

    const res = await achieve(minted.key, 'list things');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; actionName: string; result: { success: boolean } };
    expect(AchieveIntegrationGoalResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.outcome).toBe('executed');
    expect(body.actionName).toBe('list_things');
    expect(body.result.success).toBe(true);
    expect(upstream.calls).toEqual([{ url: `${HOST}/things`, method: 'GET' }]);
  });

  it('an integration the caller cannot see is the uniform 404, with a key and with a JWT', async () => {
    const tokenB = await tokenFor('ownerB');
    const mintedB = await mintKey(tokenB, 'd3-foreign');
    await expectEnvelope(await achieve(mintedB.key, 'list things'), 404, 'NOT_FOUND');
    await expectEnvelope(await achieve(tokenB, 'list things'), 404, 'NOT_FOUND');
    await expectEnvelope(await achieve(tokenB, 'list things', undefined, 'no-such-integration'), 404, 'NOT_FOUND');
  });

  it('an empty goal is a 400 AT THE SCHEMA, before any handler decides anything', async () => {
    const token = await tokenFor('ownerA');
    await expectEnvelope(
      await call(`/api/v1/integrations/${PROBE_INTEGRATION}/achieve`, token, { method: 'POST', body: JSON.stringify({ goal: '' }) }),
      400,
      'VALIDATION_FAILED',
    );
    expect(drafts.turns).toBe(0);
  });

  it('unauthenticated is 401 on both new routes', async () => {
    expect((await achieve('', 'list things')).status).toBe(401);
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/${PROBE_INTEGRATION}/actions/x/trust`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shape: 's' }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------
// 2 + 3. The author arm, and the human promotion the key cannot perform
// ---------------------------------------------------------------------------------------------

describe('achieve AUTHORS, and the key that authored cannot bless its own work', () => {
  it('the whole journey: author -> refused -> promoted by a human -> only then it runs', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd3-author');

    // (a) AUTHOR. Nothing satisfies the goal, so one action is written, verified and persisted.
    const authored = await achieve(minted.key, AUTHORED_GOAL);
    expect(authored.status).toBe(200);
    const body = (await authored.json()) as {
      outcome: string; actionName: string; state: string; forked: boolean;
      requiresApproval: boolean; verification: { passed: boolean; checks: Array<{ name: string; ok: boolean }> };
      ladder?: Array<{ rung: string; verdict: string }>;
    };
    expect(AchieveIntegrationGoalResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.outcome).toBe('authored');
    // THE MINT RUNG, ON THE WIRE. `AchieveRung` published `mint` for two rounds while nothing
    // pushed it, so this outcome carried a declared-and-always-absent `ladder` and the fourth rung
    // of a four-rung ladder was a word no consumer could observe. Asserted HERE as well as at the
    // module, because the route projects `authored` through a bare `res.json(result)` and this
    // branch has already shipped one rung that was right at the module and wrong one layer out.
    expect(body.ladder?.map((s) => `${s.rung}:${s.verdict}`)).toEqual(['reuse:skipped', 'mint:taken']);
    expect(body.actionName).toBe('exportar_faturas');
    expect(body.state).toBe('provisional');
    expect(body.forked).toBe(false);
    expect(body.requiresApproval).toBe(true);
    expect(body.verification.passed).toBe(true);
    expect(body.verification.checks.every((c) => c.ok)).toBe(true);
    // NOTHING RAN. The platform wrote an action; it did not use it.
    expect(upstream.calls).toEqual([]);
    expect(drafts.turns).toBe(1);

    // (b) The capability view shows it as PROVISIONAL and — although the draft claimed to be a
    //     read — as needing approval, because it was stored as a write.
    const view = await actionView(minted.key, 'exportar_faturas');
    expect(view.authoringState).toBe('provisional');
    expect(view.requiresApproval).toBe(true);

    // (c) The SAME KEY cannot run what it just wrote, on either rail.
    const again = await achieve(minted.key, AUTHORED_GOAL);
    expect(again.status).toBe(200);
    const refusal = (await again.json()) as { outcome: string; code: string; candidates?: string[] };
    expect(AchieveIntegrationGoalResponse.safeParse(refusal).success, JSON.stringify(refusal)).toBe(true);
    expect(refusal.outcome).toBe('refused');
    expect(refusal.code).toBe('provisional_match');
    const direct = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/exportar_faturas/execute`, minted.key, { method: 'POST', body: '{}' });
    const directBody = await expectEnvelope(direct, 403, 'FORBIDDEN');
    expect((directBody as { error: { details?: { code?: string } } }).error.details?.code).toBe('awaiting_consent');
    expect(upstream.calls).toEqual([]);

    // (d) AND THE KEY CANNOT PROMOTE IT. `POST …/trust` is `auth: 'user'`, so it never gets past
    //     admission — the gate does not grant its own exemption.
    const byKey = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/exportar_faturas/trust`, minted.key, {
      method: 'POST', body: JSON.stringify({ shape: view.shape }),
    });
    expect(byKey.status).toBe(401);
    expect((await actionView(token, 'exportar_faturas')).authoringState).toBe('provisional');

    // (e0) SLICE S1 - AND IT CANNOT BE PROMOTED HAVING NEVER RUN.
    //
    // Promotion used to prove SHAPE and never BEHAVIOUR: every guardrail `verifyAuthoredAction`
    // runs is a property of the DRAFT, so this action - well-formed, verified, on a bound host -
    // could graduate to `trusted`, and so become auto-runnable by `achieve`, without one byte ever
    // having left the process. `authored-action-guardrails-cannot-prove-an-endpoint-exists` in
    // docs/findings.md records a real `GET /stats` that passed all eight checks and 404'd the
    // moment a human promoted it. The LAST VALIDATED RUN is now the prerequisite.
    const tooEarly = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/exportar_faturas/trust`, token, {
      method: 'POST', body: JSON.stringify({ shape: view.shape }),
    });
    await expectEnvelope(tooEarly, 400, 'VALIDATION_FAILED');
    expect((await actionView(token, 'exportar_faturas')).authoringState).toBe('provisional');
    expect(upstream.calls).toEqual([]);

    // (e1) THE GATE IS SATISFIABLE, which is what keeps it a gate rather than a ban. A provisional
    // action is stored as a WRITE whatever it declared, so it meets the C2 write gate: the human
    // approves it, runs it once, and sees what it really returned - exactly the path the finding
    // above asks for.
    const approved = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/exportar_faturas/approval`, token, {
      method: 'POST', body: JSON.stringify({ decision: 'once', shape: view.shape }),
    });
    expect(approved.status).toBe(200);
    const ranOnce = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/exportar_faturas/execute`, token, {
      method: 'POST', body: '{}',
    });
    expect(ranOnce.status).toBe(200);
    expect(((await ranOnce.json()) as { success: boolean }).success).toBe(true);
    // The run really went out - this is the behaviour the promotion is now allowed to rest on.
    expect(upstream.calls).toEqual([{ url: `${HOST}/faturas`, method: 'GET' }]);

    // (e2) NOW the HUMAN promotes it, echoing the shape they were shown.
    const promoted = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/exportar_faturas/trust`, token, {
      method: 'POST', body: JSON.stringify({ shape: view.shape }),
    });
    expect(promoted.status).toBe(200);
    const promotedBody = (await promoted.json()) as { ok: boolean; state: string; mutates: boolean };
    expect(TrustAuthoredActionResponse.safeParse(promotedBody).success, JSON.stringify(promotedBody)).toBe(true);
    expect(promotedBody.state).toBe('trusted');
    // The draft DECLARED a read, and the promotion is what let that claim take effect.
    expect(promotedBody.mutates).toBe(false);
    expect((await actionView(minted.key, 'exportar_faturas')).authoringState).toBe('trusted');

    // (f) ONLY NOW does the key's own goal actually go out.
    const finally_ = await achieve(minted.key, AUTHORED_GOAL);
    expect(finally_.status).toBe(200);
    const ran = (await finally_.json()) as { outcome: string; result: { success: boolean } };
    expect(ran.outcome).toBe('executed');
    expect(ran.result.success).toBe(true);
    // TWO calls now: the human's validating run in (e1), then the key's own.
    expect(upstream.calls).toEqual([
      { url: `${HOST}/faturas`, method: 'GET' },
      { url: `${HOST}/faturas`, method: 'GET' },
    ]);
  }, 30_000);

  it('a promotion echoing a stale shape is refused, and the action stays provisional', async () => {
    const token = await tokenFor('ownerA');
    await achieve(token, AUTHORED_GOAL);
    const res = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/exportar_faturas/trust`, token, {
      method: 'POST', body: JSON.stringify({ shape: 'stale-shape' }),
    });
    await expectEnvelope(res, 400, 'VALIDATION_FAILED');
    expect((await actionView(token, 'exportar_faturas')).authoringState).toBe('provisional');
  });

  it('a HUMAN-written action has nothing to promote', async () => {
    const token = await tokenFor('ownerA');
    const view = await actionView(token, 'send_message');
    const res = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/send_message/trust`, token, {
      method: 'POST', body: JSON.stringify({ shape: view.shape }),
    });
    await expectEnvelope(res, 400, 'VALIDATION_FAILED');
  });

  it('a draft pointing OFF the credential\'s bound hosts is refused over the wire, and stores nothing', async () => {
    const token = await tokenFor('ownerA');
    drafts.reply = `\`\`\`action-json\n${JSON.stringify({ ...AUTHORED, httpConfig: { ...AUTHORED.httpConfig, baseUrl: 'https://exfil.example' } })}\n\`\`\``;

    const res = await achieve(token, AUTHORED_GOAL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; code: string; violations: string[] };
    expect(AchieveIntegrationGoalResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.outcome).toBe('refused');
    expect(body.code).toBe('verification_failed');
    expect(body.violations.join(' ')).toContain('exfil.example');

    const view = await call(`/api/v1/integrations/${PROBE_INTEGRATION}`, token);
    const names = ((await view.json()) as { actions: Array<{ actionName: string }> }).actions.map((a) => a.actionName);
    expect(names).toEqual(['list_things', 'send_message']);
    expect(upstream.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3b. The OWNER'S ERASURE CONTROL over their own evidence (slice S1, round four)
// ---------------------------------------------------------------------------------------------

/**
 * `DELETE /api/v1/integrations/:key/actions/:actionName/evidence`.
 *
 * WHY IT HAS TO EXIST, on the wire rather than in a store: every other way an evidence row goes is a
 * consequence of something else - a later run supersedes it, the credential is disconnected, the
 * retention window closes. None of those is "I do not want this sample of my third-party account
 * kept", and until this endpoint a person who simply wanted it gone had to disconnect the whole
 * integration. It is also the reason `discardEvidence` has a production caller at all.
 *
 * "THE ACTION STOPS RESOLVING" IS NOT ON THAT LIST any more: round five deleted the collectors that
 * asked it, so an unreachable action's row now ages out with everything else rather than being
 * collected on a guess (`action-evidence-store.ts`'s removal rule).
 */
describe('a person can erase the sample their own run left behind', () => {
  /** Run the read action once, over the wire, so the row under test is the one PRODUCTION writes. */
  async function runOnce(auth: string): Promise<void> {
    const res = await call(`/api/v1/integrations/${PROBE_INTEGRATION}/actions/list_things/execute`, auth, {
      method: 'POST', body: '{}',
    });
    expect(res.status).toBe(200);
  }
  const evidenceOf = (orgId: string, ownerUserId: string) =>
    actionEvidenceStore.getEvidence({ orgId, ownerUserId, integrationKey: PROBE_INTEGRATION, actionName: 'list_things' });
  const erase = (auth: string | null, opts: { key?: string } = {}) =>
    call(`/api/v1/integrations/${opts.key ?? PROBE_INTEGRATION}/actions/list_things/evidence`, auth, { method: 'DELETE' });

  it('erases the caller\'s own row, answers the declared shape, and is idempotent', async () => {
    const token = await tokenFor('ownerA');
    await runOnce(token);
    expect(await evidenceOf('orgA', 'ownerA')).not.toBeNull();

    const res = await erase(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; discarded: boolean };
    expect(DiscardActionEvidenceResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.discarded).toBe(true);
    expect(await evidenceOf('orgA', 'ownerA')).toBeNull();

    // IDEMPOTENT BY CONTRACT: the caller asked for a STATE, and it holds. A 404 here would also be
    // an existence oracle over whether a colleague has ever run the action.
    const again = await erase(token);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { discarded: boolean }).discarded).toBe(false);
  }, 30_000);

  it('erases NOBODY ELSE\'S - not another tenant\'s row for the same action', async () => {
    await seed([readAction, writeAction], PROBE_INTEGRATION, 'orgB', 'ownerB');
    const a = await tokenFor('ownerA');
    const b = await tokenFor('ownerB');
    await runOnce(a);
    await runOnce(b);

    expect(((await (await erase(a)).json()) as { discarded: boolean }).discarded).toBe(true);

    // The row is addressed by the deterministic id over the VERIFIED actor, so org B's row is a
    // different document this request cannot name.
    expect(await evidenceOf('orgA', 'ownerA')).toBeNull();
    expect(await evidenceOf('orgB', 'ownerB')).not.toBeNull();
  }, 30_000);

  it('is NOT on the gateway-key surface: an agent cannot destroy the evidence a promotion rests on', async () => {
    const token = await tokenFor('ownerA');
    await runOnce(token);
    const minted = await mintKey(token, 'erasure-probe');

    const byKey = await erase(null, {}).then(() => call(
      `/api/v1/integrations/${PROBE_INTEGRATION}/actions/list_things/evidence`,
      null,
      { method: 'DELETE', headers: { 'x-api-key': minted.key } },
    ));

    expect(byKey.status).toBe(401);
    // …and the sample is still there, which is what makes the 401 a refusal rather than a detail.
    expect(await evidenceOf('orgA', 'ownerA')).not.toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------------------------
// 4. The declared classes
// ---------------------------------------------------------------------------------------------

describe('descriptors: achieve is key-reachable, its promotion is not', () => {
  it('achieve is user-or-key and trustAction is user', () => {
    expect(integrationsEndpoints.achieve.auth).toBe('user-or-key');
    expect(integrationsEndpoints.achieve.path).toBe('/api/v1/integrations/:key/achieve');
    // The whole self-approval argument, in one assertion: the endpoint an agent would need to
    // un-gate its own authored action is not on the key surface, and neither are the three consent
    // routes it would otherwise reach for.
    expect(integrationsEndpoints.trustAction.auth).toBe('user');
    expect(integrationsEndpoints.approveAction.auth).toBe('user');
    // And the same rule over the DESTRUCTIVE side of the same collection: a key that cannot promote
    // an action must not be able to destroy the run the promotion would rest on either.
    expect(integrationsEndpoints.discardActionEvidence.auth).toBe('user');
    expect(integrationsEndpoints.discardActionEvidence.method).toBe('DELETE');
    expect(integrationsEndpoints.discardActionEvidence.path)
      .toBe('/api/v1/integrations/:key/actions/:actionName/evidence');
  });
});
