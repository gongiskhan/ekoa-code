import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { Automation, AutomationListResponse, ErrorEnvelope } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, automations } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { automationsRouter } from '../../src/routes/automations.js';
import { gatewayKeysRouter } from '../../src/routes/gateway-keys.js';
import { startRunForTrigger } from '../../src/automation/index.js';

/**
 * automation VISIBILITY suite — the `visibility: 'private'` gate.
 *
 * The field was stored, echoed back and PUBLISHED in the OpenAPI document while being enforced
 * nowhere: any member of the org read a "private" automation by id and got it in their list, under
 * a JWT and under a gateway key alike. This suite is the enforcement's regression net.
 *
 * The rule pinned here (service.ts `isVisibleTo`):
 *   - `visibility: 'private'` is OWNER-ONLY. Not the org-admin, not the super-admin — the same rule
 *     `OwnerVisibilityScoped` (data/scoped.ts, behind memory/) already states for the one other
 *     resource carrying this exact field: "private row of another user — invisible even to the org
 *     admin", with no super-admin exception.
 *   - ABSENT visibility is NOT private: it keeps today's org-visible behaviour, byte for byte.
 *     Legacy rows carry no `visibility` at all and must not vanish from anybody's list.
 *   - A hidden automation is INDISTINGUISHABLE from a missing one — identical status AND body, on
 *     the read paths and on the write/run paths that would otherwise answer 403 and confirm it
 *     exists.
 *
 * Every case runs under BOTH admissions the router accepts (`user-or-key`): a platform JWT and a
 * REAL `ekoa_gk_` key minted through POST /gateway-keys, mounted here for exactly that.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

/** One creds-carrying caller: a JWT bearer or a minted gateway key — the same `Bearer` header. */
interface Caller {
  label: string;
  token: string;
}

const api = (p: string, c: Caller, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}`, ...(init.headers ?? {}) },
  });

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user'): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

const jwtFor = async (username: string, label: string): Promise<Caller> => ({
  label: `${label} (JWT)`,
  token: (await login(username, 'pw123456', false, deps)).token,
});

/** A REAL gateway key minted by `username` — it resolves to that user's live role and org. */
async function keyFor(username: string, label: string): Promise<Caller> {
  const jwt = await jwtFor(username, label);
  const res = await api('/api/v1/gateway-keys', jwt, { method: 'POST', body: JSON.stringify({ label: `vis-${username}` }) });
  expect(res.status).toBe(201);
  const minted = (await res.json()) as { key: string };
  expect(minted.key.startsWith('ekoa_gk_')).toBe(true);
  return { label: `${label} (gateway key)`, token: minted.key };
}

/** Callers, resolved once in beforeAll. */
let ownerJwt: Caller;
let ownerKey: Caller;
let peerJwt: Caller;
let peerKey: Caller;
let orgAdminJwt: Caller;
let orgAdminKey: Caller;
let superJwt: Caller;
let superKey: Caller;

/** Create an automation owned by `c` and return its id. */
async function create(c: Caller, body: Record<string, unknown>): Promise<string> {
  const res = await api('/api/v1/automations', c, { method: 'POST', body: JSON.stringify(body) });
  expect(res.status, `create as ${c.label}`).toBe(201);
  const created = (await res.json()) as Record<string, unknown>;
  expect(Automation.safeParse(created).success).toBe(true);
  return created.id as string;
}

/** The raw (status, body-text) of a GET — body text, so "indistinguishable" means byte-identical. */
async function rawGet(path: string, c: Caller): Promise<{ status: number; body: string }> {
  const res = await api(path, c);
  return { status: res.status, body: await res.text() };
}

async function listIds(c: Caller): Promise<string[]> {
  const res = await api('/api/v1/automations', c);
  expect(res.status, `list as ${c.label}`).toBe(200);
  const body = (await res.json()) as { items: Array<{ id: string }> };
  expect(AutomationListResponse.safeParse(body).success, `list schema as ${c.label}`).toBe(true);
  return body.items.map((a) => a.id);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_security_automation_visibility');
  // Member authoring ON: the defect was reported against a plain `user` creating a private
  // automation, so the suite reproduces exactly that actor.
  await orgs.insert({ _id: 'o1', name: 'orgA', settings: { allowBuilderAutomations: true } } as never);
  await orgs.insert({ _id: 'o2', name: 'orgB' } as never);
  await mkUser('owner1', 'o1', 'user');
  await mkUser('peer1', 'o1', 'user');
  await mkUser('orgadmin1', 'o1', 'org-admin');
  await mkUser('super1', 'o2', 'super-admin');
  __resetCapabilityRateForTests();

  const app = express();
  app.use(express.json());
  app.use('/api/v1/automations', automationsRouter());
  app.use('/api/v1/gateway-keys', gatewayKeysRouter(deps));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;

  ownerJwt = await jwtFor('owner1', 'owner');
  ownerKey = await keyFor('owner1', 'owner');
  peerJwt = await jwtFor('peer1', 'same-org peer');
  peerKey = await keyFor('peer1', 'same-org peer');
  orgAdminJwt = await jwtFor('orgadmin1', 'org-admin');
  orgAdminKey = await keyFor('orgadmin1', 'org-admin');
  superJwt = await jwtFor('super1', 'super-admin');
  superKey = await keyFor('super1', 'super-admin');
}, 120_000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  server.close();
  await closeMongo();
  await mem.stop();
});

describe('automation visibility: private is owner-only on every read path', () => {
  it('the OWNER reads their own private automation by id and in the list, under a JWT and a key', async () => {
    const id = await create(ownerJwt, { name: 'REPRO-private', visibility: 'private', plan: { steps: [] } });

    for (const c of [ownerJwt, ownerKey]) {
      const res = await api(`/api/v1/automations/${id}`, c);
      expect(res.status, c.label).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Automation.safeParse(body).success).toBe(true);
      expect(body.visibility).toBe('private'); // the field the client reads as access control
      expect(body.ownerId).toBe('owner1');
      expect(await listIds(c), c.label).toContain(id);
    }
  });

  it('a SAME-ORG peer gets 404 by id and never sees it in the list — JWT and gateway key alike', async () => {
    const id = await create(ownerJwt, { name: 'peer-blind', visibility: 'private', plan: { steps: [] } });

    for (const c of [peerJwt, peerKey]) {
      const res = await api(`/api/v1/automations/${id}`, c);
      expect(res.status, c.label).toBe(404);
      expect(ErrorEnvelope.safeParse(await res.json()).success, c.label).toBe(true);
      expect(await listIds(c), c.label).not.toContain(id);
    }
  });

  it('THE PINNED ADMIN DECISION: neither the org-admin nor the super-admin can see it', async () => {
    // Deliberate, and consistent with `OwnerVisibilityScoped` — the one existing house rule for
    // this exact `visibility: private | org` field, which is explicit that another user's private
    // row is invisible EVEN TO THE ORG ADMIN and grants no super-admin exception. `canSeeRun`
    // (owner + org-admin) governs runs, which carry no visibility field at all, so it is not the
    // analogue. If a future slice wants admin reach, it changes THIS test first.
    const id = await create(ownerJwt, { name: 'admin-blind', visibility: 'private', plan: { steps: [] } });

    for (const c of [orgAdminJwt, orgAdminKey, superJwt, superKey]) {
      const res = await api(`/api/v1/automations/${id}`, c);
      expect(res.status, c.label).toBe(404);
      expect(ErrorEnvelope.safeParse(await res.json()).success, c.label).toBe(true);
      expect(await listIds(c), c.label).not.toContain(id);
    }
    // ... while the owner still holds it.
    expect(await listIds(ownerJwt)).toContain(id);
  });

  it('PATCH-to-private hides an automation the peer could see a moment earlier', async () => {
    const id = await create(ownerJwt, { name: 'flip-me', plan: { steps: [] } });
    // Before: no visibility field at all → org-visible, exactly as it has always been.
    expect(await listIds(peerJwt)).toContain(id);
    expect((await api(`/api/v1/automations/${id}`, peerJwt)).status).toBe(200);

    const patched = await api(`/api/v1/automations/${id}`, ownerJwt, { method: 'PATCH', body: JSON.stringify({ visibility: 'private' }) });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { visibility?: string }).visibility).toBe('private');

    for (const c of [peerJwt, peerKey, orgAdminJwt, superJwt]) {
      expect((await api(`/api/v1/automations/${id}`, c)).status, c.label).toBe(404);
      expect(await listIds(c), c.label).not.toContain(id);
    }

    // And PATCHing back to 'org' restores it — the gate is the field, not a one-way door.
    const back = await api(`/api/v1/automations/${id}`, ownerJwt, { method: 'PATCH', body: JSON.stringify({ visibility: 'org' }) });
    expect(back.status).toBe(200);
    expect((await api(`/api/v1/automations/${id}`, peerJwt)).status).toBe(200);
    expect(await listIds(peerJwt)).toContain(id);
  });

  it('ABSENT and explicit-org visibility behave EXACTLY as today (no legacy row is silently hidden)', async () => {
    const absent = await create(ownerJwt, { name: 'sem-visibilidade', plan: { steps: [] } });
    const org = await create(ownerJwt, { name: 'org-visivel', visibility: 'org', plan: { steps: [] } });
    // A row written before the field existed: no `visibility` key on the document at all.
    await automations.insert({
      _id: 'legacy-1', id: 'legacy-1', name: 'legado', description: '', steps: [],
      ownerUserId: 'owner1', orgId: 'o1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as never);

    for (const c of [peerJwt, peerKey, orgAdminJwt, orgAdminKey]) {
      const ids = await listIds(c);
      for (const id of [absent, org, 'legacy-1']) {
        expect(ids, `${c.label} list ${id}`).toContain(id);
        expect((await api(`/api/v1/automations/${id}`, c)).status, `${c.label} get ${id}`).toBe(200);
      }
    }
    // The wire never invents a visibility for a row that has none.
    const got = (await (await api(`/api/v1/automations/${absent}`, peerJwt)).json()) as Record<string, unknown>;
    expect('visibility' in got).toBe(false);
  });
});

describe('automation visibility: no existence oracle', () => {
  it('the refusal is BYTE-IDENTICAL to a genuinely missing id, on every verb that could confirm it', async () => {
    const id = await create(ownerJwt, { name: 'sem-oraculo', visibility: 'private', plan: { steps: [] } });
    const ghost = 'nao-existe-de-todo';

    for (const c of [peerJwt, peerKey, orgAdminJwt, superJwt]) {
      const hidden = await rawGet(`/api/v1/automations/${id}`, c);
      const missing = await rawGet(`/api/v1/automations/${ghost}`, c);
      expect(hidden.status, c.label).toBe(404);
      expect(hidden.status, c.label).toBe(missing.status);
      expect(hidden.body, c.label).toBe(missing.body); // same bytes, not merely the same code
      expect(ErrorEnvelope.safeParse(JSON.parse(hidden.body)).success).toBe(true);
    }

    // The mutation/run verbs must not answer 403 where the read answers 404: a 403 would confirm
    // the id exists. Each is compared against the same verb on an id that truly does not exist.
    const verbs: Array<{ name: string; path: (i: string) => string; init: RequestInit }> = [
      { name: 'PATCH', path: (i) => `/api/v1/automations/${i}`, init: { method: 'PATCH', body: JSON.stringify({ name: 'hijack' }) } },
      { name: 'DELETE', path: (i) => `/api/v1/automations/${i}`, init: { method: 'DELETE' } },
      { name: 'POST runs', path: (i) => `/api/v1/automations/${i}/runs`, init: { method: 'POST', body: JSON.stringify({}) } },
    ];
    for (const c of [peerJwt, peerKey, orgAdminJwt, superJwt]) {
      for (const v of verbs) {
        const hidden = await api(v.path(id), c, v.init);
        const missing = await api(v.path(ghost), c, v.init);
        const [hb, mb] = [await hidden.text(), await missing.text()];
        expect(hidden.status, `${v.name} as ${c.label}`).toBe(404);
        expect(hidden.status, `${v.name} as ${c.label}`).toBe(missing.status);
        expect(hb, `${v.name} as ${c.label}`).toBe(mb);
      }
    }

    // Nothing above touched it: the owner's automation is intact and still theirs.
    const still = await api(`/api/v1/automations/${id}`, ownerJwt);
    expect(still.status).toBe(200);
    expect((await still.json() as { name: string }).name).toBe('sem-oraculo');
  });

  it('the owner can still RUN their own private automation (the gate hides it, it does not brick it)', async () => {
    const id = await create(ownerJwt, { name: 'privada-corre', visibility: 'private', plan: { steps: [] } });
    const started = await api(`/api/v1/automations/${id}/runs`, ownerKey, { method: 'POST', body: JSON.stringify({}) });
    expect(started.status).toBe(202);
    expect(typeof ((await started.json()) as { runId: string }).runId).toBe('string');
  });
});

describe('automation visibility: the trigger DELIVERY path', () => {
  it('a trigger owned by anyone but the automation owner cannot execute a private automation', async () => {
    // Trigger CREATION validates its target through getAutomation (routes/triggers.ts), so it is
    // already gated — but a trigger record outlives that check: the automation can be flipped to
    // private afterwards, and the engine deliberately skips its owner check for non-user runs.
    const id = await create(ownerJwt, { name: 'gatilho-privado', visibility: 'private', plan: { steps: [] } });

    const foreign = await startRunForTrigger({
      automationId: id, ownerUserId: 'peer1', orgId: 'o1', triggeredBy: 'webhook',
    });
    expect(foreign.outcome).toBe('failed');
    expect(foreign.permanent).toBe(true); // an authorization refusal is never retried
    expect(foreign.runId).toBeUndefined(); // nothing was executed

    // The owner's own trigger still delivers.
    const own = await startRunForTrigger({
      automationId: id, ownerUserId: 'owner1', orgId: 'o1', triggeredBy: 'webhook',
    });
    expect(own.runId).toBeTruthy();
  });
});
