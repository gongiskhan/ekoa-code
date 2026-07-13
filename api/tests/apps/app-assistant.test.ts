import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AppAction, AppActionManifest } from '@ekoa/shared';
import { AppAssistantWhoamiResponse } from '@ekoa/shared';
import type { SearchHit } from '../../src/knowledge/index.js';
import type { OneShotOptions, LlmAttribution, RouterDecision } from '../../src/llm/index.js';
import { assistantToolsFromManifest } from '../../src/apps/assistant-tools.js';
import {
  runAppAssistant,
  inferMode,
  extractActions,
  type AppAssistantDeps,
} from '../../src/apps/app-assistant.js';
import { appAssistantRouter, isOwnerOrgAdmin } from '../../src/apps/app-assistant-route.js';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, artifacts } from '../../src/data/stores.js';
import { setActivation, bumpTokenEpoch, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * operator-run D1 — the served-app assistant pure logic, over an INJECTED one-shot (no real model),
 * an injected grounding builder, and an injected routing decision. Asserts: mode inference; grounding
 * hits become citations; the ```ekoa-actions``` block is parsed, validated against the manifest, and
 * stripped from the reply; unknown tool names are dropped; and the grounding org comes from the
 * resolved OWNER, never a caller-supplied value.
 */

const manifest: AppActionManifest = {
  version: 1,
  actions: [
    { id: 'ir-clientes', kind: 'navigate', labelPt: 'Ver clientes', description: 'Abre a lista de clientes', route: '/clientes', params: [], destructive: false },
    {
      id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um novo cliente',
      params: [{ name: 'nome', type: 'string', required: true }], destructive: false,
    },
  ],
};

const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };
const OWNER = { userId: 'owner-1', orgId: 'org-owner' };

/** The server-resolved manifest AppAction D1 attaches to each proposed action. */
const actionById = (id: string): AppAction => manifest.actions.find((a) => a.id === id)!;
/** toolName -> manifest AppAction, as runAppAssistant / extractActions consume it. */
const toolMap = new Map(assistantToolsFromManifest(manifest).map((t) => [t.name, t.action] as const));

interface Captured {
  opts?: OneShotOptions;
  attribution?: LlmAttribution;
  groundInput?: { orgId: string; query: string; kind: string };
}

/** Deps whose one-shot returns `oneShotText` verbatim and whose grounding returns `hits`. */
function makeDeps(oneShotText: string, hits: SearchHit[] = [], captured: Captured = {}): AppAssistantDeps {
  return {
    oneShot: async (opts, attribution) => {
      captured.opts = opts;
      captured.attribution = attribution;
      return { text: oneShotText, usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    },
    ground: (input) => {
      captured.groundInput = input;
      return { block: hits.length ? 'CONHECIMENTO (excertos):\n[1] col / titulo (doc d1)' : '', hits };
    },
    decide: () => DECISION,
  };
}

function hit(over: Partial<SearchHit> = {}): SearchHit {
  return { docId: 'd1', collection: 'faq', title: 'Como criar cliente', snippet: 'passo 1...', score: 1, scope: 'org', ...over };
}

describe('inferMode (D1 deterministic PT-PT classifier)', () => {
  it('teach cues -> teach', () => {
    expect(inferMode('Faz um tutorial da aplicação')).toBe('teach');
    expect(inferMode('Explica como funciona o registo')).toBe('teach');
    expect(inferMode('Ensina-me a usar isto passo a passo')).toBe('teach');
  });
  it('show cues -> show (accent-insensitive)', () => {
    expect(inferMode('Mostra-me o painel')).toBe('show');
    expect(inferMode('Dá-me uma visão geral')).toBe('show');
    expect(inferMode('Faz um resumo geral')).toBe('show');
  });
  it('teach wins over show ("mostra-me como criar")', () => {
    expect(inferMode('Mostra-me como criar um cliente')).toBe('teach');
  });
  it('imperative task verbs and anything else default to do', () => {
    expect(inferMode('Cria um cliente chamado Ana')).toBe('do');
    expect(inferMode('Adiciona uma nota ao processo')).toBe('do');
    expect(inferMode('Olá')).toBe('do');
  });
});

describe('extractActions (D1 fenced-block parser)', () => {
  it('parses an actions block, attaches the resolved AppAction, and strips it from the prose', () => {
    const reply = [
      'Vou criar o cliente para si.',
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}}]',
      '```',
      'Feito.',
    ].join('\n');
    const { text, actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([
      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
    ]);
    expect(text).toContain('Vou criar o cliente');
    expect(text).toContain('Feito.');
    expect(text).not.toContain('ekoa-actions');
    expect(text).not.toContain('app_action__');
  });

  it('drops unknown tool names but keeps + resolves known ones', () => {
    const reply = [
      '```ekoa-actions',
      '[{"toolName":"app_action__inexistente","input":{}},{"toolName":"app_action__ir_clientes","input":{}}]',
      '```',
    ].join('\n');
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
  });

  it('drops UNDECLARED param keys from the model input (fenced path honours the tool schema)', () => {
    // codex-d2 #1: `custom` action params reach app code verbatim, so the fenced path
    // must enforce the same additionalProperties:false contract the SDK tool schema does.
    const reply = [
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana","__proto__x":"pwn","cmd":"rm -rf"}}]',
      '```',
    ].join('\n');
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.input).toEqual({ nome: 'Ana' }); // declared param kept, undeclared dropped
  });

  it('a malformed block yields no actions and is still stripped', () => {
    const reply = 'Olá\n```ekoa-actions\nnão é json\n```\ntchau';
    const { text, actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([]);
    expect(text).not.toContain('ekoa-actions');
    expect(text).toContain('Olá');
    expect(text).toContain('tchau');
  });

  it('non-object input defaults to {}', () => {
    const reply = '```ekoa-actions\n[{"toolName":"app_action__ir_clientes","input":"oops"}]\n```';
    const { actions } = extractActions(reply, toolMap);
    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
  });
});

describe('runAppAssistant (D1)', () => {
  it('infers the mode when not pinned and echoes it back', async () => {
    const deps = makeDeps('Aqui está uma visão geral.');
    const res = await runAppAssistant(
      { message: 'Mostra-me a aplicação', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.mode).toBe('show');
  });

  it('honours a client-pinned mode over inference', async () => {
    const deps = makeDeps('ok');
    const res = await runAppAssistant(
      { message: 'Mostra-me a aplicação', mode: 'do', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.mode).toBe('do');
  });

  it('turns grounding hits into citations (collection/docId/title)', async () => {
    const hits = [hit(), hit({ docId: 'd2', collection: 'guias', title: 'Guia', scope: 'shared' })];
    const deps = makeDeps('Resposta com fonte.', hits);
    const res = await runAppAssistant(
      { message: 'Como crio um cliente?', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.citations).toEqual([
      { collection: 'faq', docId: 'd1', title: 'Como criar cliente' },
      { collection: 'guias', docId: 'd2', title: 'Guia' },
    ]);
  });

  it('parses + validates the actions block and strips it from the reply', async () => {
    const oneShotText = [
      'Vou tratar disso.',
      '```ekoa-actions',
      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}},{"toolName":"app_action__desconhecida","input":{}}]',
      '```',
    ].join('\n');
    const deps = makeDeps(oneShotText);
    const res = await runAppAssistant(
      { message: 'Cria a cliente Ana', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
      deps,
    );
    expect(res.actions).toEqual([
      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
    ]); // unknown dropped, resolved AppAction attached
    expect(res.reply).toBe('Vou tratar disso.');
    expect(res.reply).not.toContain('ekoa-actions');
  });

  it('an app with no manifest has no operate surface (all requested actions dropped)', async () => {
    const oneShotText = '```ekoa-actions\n[{"toolName":"app_action__criar_cliente","input":{}}]\n```texto';
    const deps = makeDeps(oneShotText);
    const res = await runAppAssistant(
      { message: 'Cria algo', owner: OWNER, artifactId: 'art-1', actionManifest: null },
      deps,
    );
    expect(res.actions).toEqual([]);
    expect(res.reply).toBe('texto');
  });

  it('grounds under the OWNER org and bills the OWNER — never a caller-supplied value', async () => {
    const captured: Captured = {};
    const deps = makeDeps('ok', [], captured);
    await runAppAssistant(
      {
        message: 'Olá',
        // A caller trying to steer the org via context must be ignored — the org comes from owner.
        context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
        owner: OWNER,
        artifactId: 'art-99',
        actionManifest: manifest,
      },
      deps,
    );
    expect(captured.groundInput).toEqual({ orgId: 'org-owner', query: 'Olá', kind: 'chat' });
    expect(captured.attribution).toEqual({
      kind: 'user_work',
      agentType: 'assistant-chat',
      billeeUserId: 'owner-1',
      artifactId: 'art-99',
    });
  });
});

/**
 * operator-run H2 — the admin-detection DECISION (`isOwnerOrgAdmin`), the PURE role/org/capability
 * core of `GET /api/app-assistant/whoami`. It reuses H1's `can('canEditApps')` as the capability
 * gate, then scopes org-admins to the owner org and lets super-admins span every org. No token /
 * verification here — that layer is exercised by the route matrix below.
 */
describe('isOwnerOrgAdmin (H2 detection decision)', () => {
  it('an org-admin of the OWNER org is an admin (capability + org match)', () => {
    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
  });
  it('an org-admin of ANOTHER org is NOT (org mismatch, fail-closed)', () => {
    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-other' }, 'org-owner')).toBe(false);
  });
  it('a super-admin is an admin of ANY org (spans orgs)', () => {
    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-other' }, 'org-owner')).toBe(true);
    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
  });
  it('a plain user is never an admin (H1 capability gate denies canEditApps)', () => {
    expect(isOwnerOrgAdmin({ role: 'user', orgId: 'org-owner' }, 'org-owner')).toBe(false);
  });
});

/**
 * operator-run H2 — the `GET /api/app-assistant/whoami` FAIL-CLOSED matrix over the REAL router,
 * the REAL verification chain (verifyToken + jti + isRevoked + activation-active + tokenEpoch, via
 * verifySseToken) and REAL owner resolution. The router is wired with THROWING llm deps: whoami
 * must never ground/route/bill, so any accidental model touch would blow the request up (it does
 * not — every case returns 200). Binding invariants asserted here:
 *   - admin:true ONLY for an org-admin/super-admin of the OWNER org WITH canEditApps.
 *   - EVERYTHING else -> 200 { admin:false }: no token, invalid, expired, epoch-stale, user role,
 *     wrong-org admin. NEVER a 4xx on a bad/missing token (a 401/403 would be an oracle).
 *   - the ONLY non-200 is a malformed X-Ekoa-App-Id (the SAME 400 POST gives) / unknown app (404).
 */
describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
  let mem: MongoMemoryServer;
  let server: Server;
  let port: number;
  let seq = 0;
  const loginDeps = { now: () => 1_700_000_000_000 + seq++, genId: () => `jti_${seq++}` };

  // whoami must NEVER reach these — it neither grounds, routes, nor bills.
  const throwingDeps: AppAssistantDeps = {
    oneShot: async () => { throw new Error('whoami must not call the model (visitor-blindness exception is detection-only)'); },
    ground: () => { throw new Error('whoami must not ground'); },
    decide: () => { throw new Error('whoami must not route'); },
  };

  const APP_ID = 'app-h2'; // owned by owner-1 (org-owner)
  const tokens: Record<string, string> = {};

  async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
    setActivation(id, { active: true, billingLocked: false });
  }
  const whoami = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/api/app-assistant/whoami`, { headers });
  const postAssistant = (headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/api/app-assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ message: 'olá' }),
    });

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = 'k';
    process.env.JWT_SECRET = 's';
    __resetConfigForTests();
    loadConfig();
    __resetActivationForTests();
    __resetRevocationsForTests();
    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_h2_whoami');

    // The app + its owner (org-owner). Owner org is resolved server-side from this user record.
    await mkUser('owner-1', 'org-owner', 'org-admin');
    await artifacts.insert({ _id: APP_ID, name: 'H2', userId: 'owner-1', orgId: 'org-owner', visibility: 'private' } as never);

    // Callers.
    await mkUser('admin-owner', 'org-owner', 'org-admin'); // a DIFFERENT admin in the owner org
    await mkUser('super-1', 'org-other', 'super-admin'); // super-admin in a DIFFERENT org
    await mkUser('admin-other', 'org-other', 'org-admin'); // org-admin of the WRONG org
    await mkUser('user-owner', 'org-owner', 'user'); // owner-org member without canEditApps
    await mkUser('stale-admin', 'org-owner', 'org-admin'); // owner-org admin, token then epoch-staled

    for (const u of ['owner-1', 'admin-owner', 'super-1', 'admin-other', 'user-owner', 'stale-admin']) {
      tokens[u] = (await login(u, 'pw123456', false, loginDeps)).token;
    }
    // Epoch-stale: bump stale-admin's epoch far past its freshly-minted token's iat, so the SAME
    // (otherwise-admin) token is now stale — proving the tokenEpoch leg of the chain rejects it.
    bumpTokenEpoch('stale-admin', Math.floor(Date.now() / 1000) + 100_000);

    const app = express();
    app.use(express.json());
    app.use('/api', appAssistantRouter(throwingDeps));
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    port = (server.address() as { port: number }).port;
  }, 60_000);

  afterAll(async () => {
    server?.close();
    await closeMongo();
    await mem?.stop();
    __resetActivationForTests();
    __resetRevocationsForTests();
  });

  const bearer = (u: string) => ({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${tokens[u]}` });

  it('an org-admin of the OWNER org -> 200 { admin:true }', async () => {
    const res = await whoami(bearer('admin-owner'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(AppAssistantWhoamiResponse.safeParse(body).success).toBe(true);
    expect(body).toEqual({ admin: true });
  });

  it('the artifact owner (org-admin of the owner org) -> 200 { admin:true }', async () => {
    const res = await whoami(bearer('owner-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  it('a super-admin (any org) -> 200 { admin:true }', async () => {
    const res = await whoami(bearer('super-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: true });
  });

  it('an org-admin of ANOTHER org -> 200 { admin:false } (never 403 — no cross-org oracle)', async () => {
    const res = await whoami(bearer('admin-other'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: false });
  });

  it('a plain user of the owner org -> 200 { admin:false } (H1 capability gate)', async () => {
    const res = await whoami(bearer('user-owner'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: false });
  });

  it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: false });
  });

  it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: false });
  });

  it('an EXPIRED token (would-be admin) -> 200 { admin:false }', async () => {
    // A structurally-admin token (org-admin of the owner org) but already expired: the verify
    // chain rejects it at verifyToken, so detection is false — expiry alone denies.
    const expired = jwt.sign(
      { sub: 'owner-1', role: 'org-admin', scope: 'user', orgId: 'org-owner', username: 'owner-1', jti: 'expired.1' },
      's',
      { expiresIn: -10 },
    );
    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: false });
  });

  it('an EPOCH-STALE token (would-be admin) -> 200 { admin:false }', async () => {
    // stale-admin is an org-admin of the owner org; its token predates the epoch bump, so the
    // tokenEpoch leg of the chain rejects it — a demoted/rotated session cannot detect as admin.
    const res = await whoami(bearer('stale-admin'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admin: false });
  });

  it('a malformed X-Ekoa-App-Id -> 400 — the SAME status POST gives (charset check reused)', async () => {
    const bad = { 'x-ekoa-app-id': 'bad app!', authorization: `Bearer ${tokens['admin-owner']}` };
    const wRes = await whoami(bad);
    const pRes = await postAssistant(bad);
    expect(wRes.status).toBe(400);
    expect(pRes.status).toBe(400); // POST rejects the same header identically
    const wBody = (await wRes.json()) as { error: { code: string } };
    expect(wBody.error.code).toBe('VALIDATION_FAILED');
  });

  it('the reserved usr. prefix on X-Ekoa-App-Id -> 400 (same as POST)', async () => {
    const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
    expect(res.status).toBe(400);
  });

  it('an unknown app id -> 404 { NOT_FOUND } (the SAME existence surface POST already exposes)', async () => {
    const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });
});
