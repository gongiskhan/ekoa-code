import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationDefinitions } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  integrationDefinitionStore,
  definitionIdFor,
  type DefinitionVisibility,
} from '../../src/integrations/definition-store.js';
import { DefinitionVisibilityResponse, ErrorEnvelope, TenantDefinitionVisibility, integrationsEndpoints } from '@ekoa/shared';

/**
 * Slice E1 — the definition SHARING surface, exercised through the REAL app.
 *
 * The two routes under test are a thin shell over `integrationDefinitionStore.setVisibility`, so
 * what this suite pins is what a shell can get wrong: which verdict becomes which status, that the
 * acting tenant is the JWT and never the body, and — the brief's review gate — that the cross-org
 * `global` tier is reachable ONLY by a super-admin AT THE ROUTE, not merely inside the store.
 *
 * Everything runs against `buildApp` on a real socket with a real login, two orgs and four roles;
 * no handler is called directly, so a route that were accidentally left unmounted, mounted without
 * `requireAuth`, or mounted without its role gate fails here rather than passing on a unit stub.
 *
 * NO EXISTENCE ORACLE is asserted BYTE-FOR-BYTE (`await res.text()` compared to the 404 of a
 * definitely-nonexistent id), because "a hidden row and a missing row are indistinguishable" is a
 * claim about the exact bytes on the wire, not about the status code alone.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

/** The org-A definition every test operates on; a key no shipped disk package uses. */
const KEY = 'e1-sharing-probe';
const DEF_ID = definitionIdFor('orgA', KEY);
/** An id that names no row at all — the reference bytes for the uniform 404. */
const MISSING_ID = definitionIdFor('orgA', 'no-such-definition-anywhere');

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });

const setVisibility = (t: string, id: string, visibility: string) =>
  api(`/api/v1/integrations/definitions/${id}/visibility`, t, { method: 'PATCH', body: JSON.stringify({ visibility }) });
const setGlobal = (t: string, id: string, global: boolean) =>
  api(`/api/v1/integrations/definitions/${id}/global`, t, { method: 'POST', body: JSON.stringify({ global }) });

/** Every non-2xx body on this surface must be the shared error envelope, with the expected code. */
async function expectEnvelope(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx body must validate against ErrorEnvelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

/** Assert a 2xx echo against the shared response schema and return the reported visibility. */
async function expectOk(res: Response, visibility: DefinitionVisibility): Promise<void> {
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(DefinitionVisibilityResponse.safeParse(body).success, `2xx body must validate: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { visibility: string }).visibility).toBe(visibility);
}

/** The visibility actually PERSISTED — the echo is only trusted once the row agrees with it. */
const storedVisibility = async (id: string) => (await integrationDefinitionStore.getById(id))?.visibility;

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

/** Seed org A's definition, authored by `ownerA`, at the given tier. The seeding actor is the
 *  author (a `global` seed needs the super-admin bar the store enforces on create too — A3). */
async function seedDefinition(visibility: DefinitionVisibility): Promise<string> {
  const doc = await integrationDefinitionStore.create(
    {
      orgId: 'orgA', userId: 'ownerA', visibility, key: KEY,
      displayName: 'E1 Sharing Probe', configSchema: [], actions: [], skillMd: '# probe',
    },
    { actor: { userId: 'ownerA', orgId: 'orgA', role: visibility === 'global' ? 'super-admin' : 'user' }, onConflict: 'replace' },
  );
  return doc._id;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_int_visibility');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, integrationDefinitions]) await s.deleteMany({});
  // Org A: the author, a same-org peer, the org admin, and a platform super-admin who is a MEMBER
  // of org A (the store's read gate has no super-admin exception — see the cross-org root test).
  await mkUser('ownerA', 'orgA', 'user');
  await mkUser('peerA', 'orgA', 'user');
  await mkUser('adminA', 'orgA', 'org-admin');
  await mkUser('rootA', 'orgA', 'super-admin');
  // Org B: an ordinary member and a super-admin who has never seen org A's rows.
  await mkUser('userB', 'orgB', 'user');
  await mkUser('rootB', 'orgB', 'super-admin');
});

describe('E1 — integration definition sharing: the tenant visibility route', () => {
  it('the owner flips their own definition private -> org -> private, and the row follows the echo', async () => {
    await seedDefinition('private');
    const t = await tokenFor('ownerA');

    await expectOk(await setVisibility(t, DEF_ID, 'org'), 'org');
    expect(await storedVisibility(DEF_ID)).toBe('org');

    await expectOk(await setVisibility(t, DEF_ID, 'private'), 'private');
    expect(await storedVisibility(DEF_ID)).toBe('private');
  });

  it("the org-admin may re-share a member's ORG row, but their PRIVATE row is invisible even to the admin", async () => {
    const t = await tokenFor('adminA');

    // PRIVATE is private FROM THE ADMIN TOO (definition-store.ts: "invisible to a same-org peer
    // AND to the org-admin ... with no super-admin exception on the READ path"). The write gate is
    // owner-or-org-admin only among rows the actor can SEE, so this is the uniform 404.
    await seedDefinition('private');
    const hidden = await setVisibility(t, DEF_ID, 'org');
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await (await setVisibility(t, MISSING_ID, 'org')).text());
    expect(await storedVisibility(DEF_ID)).toBe('private');

    // An ORG row is visible to the admin, and theirs to rewrite.
    await seedDefinition('org');
    await expectOk(await setVisibility(t, DEF_ID, 'private'), 'private');
    expect(await storedVisibility(DEF_ID)).toBe('private');
  });

  it("a same-org peer gets the uniform 404 for a PRIVATE row - byte-identical to a missing id", async () => {
    await seedDefinition('private');
    const t = await tokenFor('peerA');

    const hidden = await setVisibility(t, DEF_ID, 'org');
    const missing = await setVisibility(t, MISSING_ID, 'org');
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    // The whole point of the notfound verdict: a write may not become an existence oracle for a
    // definition the caller was never allowed to READ.
    const [hiddenBody, missingBody] = [await hidden.text(), await missing.text()];
    expect(hiddenBody).toBe(missingBody);
    expect(ErrorEnvelope.safeParse(JSON.parse(hiddenBody)).success).toBe(true);
    expect(await storedVisibility(DEF_ID)).toBe('private');
  });

  it('a same-org peer gets 403 for an ORG row (visible, but not theirs to rewrite)', async () => {
    await seedDefinition('org');
    await expectEnvelope(await setVisibility(await tokenFor('peerA'), DEF_ID, 'private'), 403, 'FORBIDDEN');
    expect(await storedVisibility(DEF_ID)).toBe('org');
  });

  it('another org gets the uniform 404 for a private row AND for an org row (never a 403 oracle)', async () => {
    const t = await tokenFor('userB');
    for (const tier of ['private', 'org'] as const) {
      await seedDefinition(tier);
      const res = await setVisibility(t, DEF_ID, 'private');
      const missing = await setVisibility(t, MISSING_ID, 'private');
      expect(res.status, `${tier} row is a 404 for another org`).toBe(404);
      expect(await res.text()).toBe(await missing.text());
      expect(await storedVisibility(DEF_ID)).toBe(tier);
    }
  });

  it('the WIRE CONTRACT refuses `global` on the tenant route (400 before any gate runs)', async () => {
    await seedDefinition('org');
    // The request schema is a two-value enum on purpose: the tenant route cannot express
    // "publish to every org" at all, so this is a 400 at validation, not a 403 from the store.
    await expectEnvelope(await setVisibility(await tokenFor('ownerA'), DEF_ID, 'global'), 400, 'VALIDATION_FAILED');
    expect(await storedVisibility(DEF_ID)).toBe('org');
  });

  it('a malformed body is a 400 envelope, and the row is untouched', async () => {
    await seedDefinition('private');
    const t = await tokenFor('ownerA');
    for (const body of ['{}', JSON.stringify({ visibility: 'ORG' }), JSON.stringify({ visibility: 1 })]) {
      const res = await api(`/api/v1/integrations/definitions/${DEF_ID}/visibility`, t, { method: 'PATCH', body });
      await expectEnvelope(res, 400, 'VALIDATION_FAILED');
    }
    expect(await storedVisibility(DEF_ID)).toBe('private');
  });
});

describe('E1 — the cross-org `global` tier is a super-admin review gate, enforced AT THE ROUTE', () => {
  it('the base OWNER is refused `global` (403) — through the route, with the row untouched', async () => {
    await seedDefinition('org');
    await expectEnvelope(await setGlobal(await tokenFor('ownerA'), DEF_ID, true), 403, 'FORBIDDEN');
    expect(await storedVisibility(DEF_ID)).toBe('org');
  });

  it('the ORG-ADMIN is refused `global` (403) even though they may re-share the same row', async () => {
    await seedDefinition('org');
    const t = await tokenFor('adminA');
    await expectEnvelope(await setGlobal(t, DEF_ID, true), 403, 'FORBIDDEN');
    expect(await storedVisibility(DEF_ID)).toBe('org');
    // Discrimination: the 403 is about the TIER, not about this admin's access to this row.
    await expectOk(await setVisibility(t, DEF_ID, 'private'), 'private');
  });

  it('a super-admin publishes the row cross-org, and it then resolves for ANOTHER org', async () => {
    await seedDefinition('org');
    // Before: org B cannot see org A's org-scoped definition at all.
    const tB = await tokenFor('userB');
    const before = (await (await api('/api/v1/integrations', tB)).json()) as { items: Array<{ key: string }> };
    expect(before.items.map((d) => d.key)).not.toContain(KEY);

    await expectOk(await setGlobal(await tokenFor('rootA'), DEF_ID, true), 'global');
    expect(await storedVisibility(DEF_ID)).toBe('global');

    // After: the SAME org-B reader now resolves it through the ordinary merged registry — the
    // publication is real, not just a field flipped in the database.
    const after = (await (await api('/api/v1/integrations', tB)).json()) as { items: Array<{ key: string; userCreated?: boolean }> };
    const published = after.items.find((d) => d.key === KEY);
    expect(published, 'the published definition resolves cross-org').toBeTruthy();
    expect(published!.userCreated).toBe(true);
  });

  it('a super-admin DEMOTES a published row back to `org`, and org B stops seeing it', async () => {
    await seedDefinition('global');
    const tB = await tokenFor('userB');
    expect(((await (await api('/api/v1/integrations', tB)).json()) as { items: Array<{ key: string }> }).items.map((d) => d.key)).toContain(KEY);

    // `{global:false}` demotes to `org` — the narrowest tier that only undoes the cross-org
    // publication, leaving the authoring org's members reading it exactly as before.
    await expectOk(await setGlobal(await tokenFor('rootA'), DEF_ID, false), 'org');
    expect(await storedVisibility(DEF_ID)).toBe('org');
    expect(((await (await api('/api/v1/integrations', tB)).json()) as { items: Array<{ key: string }> }).items.map((d) => d.key)).not.toContain(KEY);
  });

  it('DEMOTION is gated too: the owner cannot pull a published row out of `global`', async () => {
    await seedDefinition('global');
    await expectEnvelope(await setVisibility(await tokenFor('ownerA'), DEF_ID, 'org'), 403, 'FORBIDDEN');
    expect(await storedVisibility(DEF_ID)).toBe('global');
  });

  it('a super-admin of ANOTHER org still gets the uniform 404 (root is no cross-org read oracle)', async () => {
    await seedDefinition('private');
    const t = await tokenFor('rootB');
    const hidden = await setGlobal(t, DEF_ID, true);
    const missing = await setGlobal(t, MISSING_ID, true);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
    expect(await storedVisibility(DEF_ID)).toBe('private');
  });

  it('a malformed `global` body is a 400 envelope for a super-admin too', async () => {
    await seedDefinition('org');
    const res = await api(`/api/v1/integrations/definitions/${DEF_ID}/global`, await tokenFor('rootA'), { method: 'POST', body: '{}' });
    await expectEnvelope(res, 400, 'VALIDATION_FAILED');
    expect(await storedVisibility(DEF_ID)).toBe('org');
  });

  it('the role gate runs BEFORE the body is even read (a super-admin-only route, not a 400 oracle)', async () => {
    await seedDefinition('org');
    // A non-super-admin sending garbage gets FORBIDDEN, not VALIDATION_FAILED: they learn nothing
    // about the route's body shape, and nothing about whether the id exists.
    await expectEnvelope(
      await api(`/api/v1/integrations/definitions/${DEF_ID}/global`, await tokenFor('ownerA'), { method: 'POST', body: '{}' }),
      403, 'FORBIDDEN',
    );
  });
});

describe('E1 — both sharing routes are mounted and closed by default', () => {
  it('an unauthenticated caller gets 401 on both (requireAuth fires before the handler)', async () => {
    await seedDefinition('org');
    await expectEnvelope(await api(`/api/v1/integrations/definitions/${DEF_ID}/visibility`, null, { method: 'PATCH', body: JSON.stringify({ visibility: 'private' }) }), 401, 'UNAUTHENTICATED');
    await expectEnvelope(await api(`/api/v1/integrations/definitions/${DEF_ID}/global`, null, { method: 'POST', body: JSON.stringify({ global: true }) }), 401, 'UNAUTHENTICATED');
    expect(await storedVisibility(DEF_ID)).toBe('org');
  });
});

/**
 * E1 REVIEW RESPONSE — the trapdoor, the launch pad, and the addressability gap.
 *
 * A fresh-context review proved escalation and the existence oracle clean, but found that a
 * super-admin of ANY org could PATCH a foreign PUBLISHED row down to `private` through the tenant
 * route: destructive (the AUTHORING org lost its own definition too) and unrecoverable by the actor,
 * who could no longer see the now-private foreign row to undo it — defeating, through the sibling
 * route, the very invariant the `/global` route documents. It also found that publishing a `private`
 * row would WIDEN it on demotion (which lands on `org`), and that a conforming client could discover
 * neither its own definition's id nor its current tier.
 */
describe('E1 review — un-publish lands on org, publish launches from org, own rows are addressable', () => {
  it('a foreign super-admin CANNOT trapdoor a published row down to private', async () => {
    await seedDefinition('org');
    const rootA = await tokenFor('rootA');
    const rootB = await tokenFor('rootB');
    await expectOk(await setGlobal(rootA, DEF_ID, true), 'global');

    // rootB is a super-admin of ANOTHER org: it can SEE the global row and may re-gate it...
    await expectEnvelope(await setVisibility(rootB, DEF_ID, 'private'), 403, 'FORBIDDEN');
    // ...and the row is untouched — org A has NOT lost its own definition.
    expect(await storedVisibility(DEF_ID)).toBe('global');

    // The supported un-publish still works and lands on the reversible tier.
    await expectOk(await setGlobal(rootB, DEF_ID, false), 'org');
    expect(await storedVisibility(DEF_ID)).toBe('org');
  });

  it('publishing launches from org only — a PRIVATE row cannot be published (no silent widening)', async () => {
    // TWO shapes, because they fail for DIFFERENT and both-correct reasons.
    // (1) A private row authored by someone else is INVISIBLE even to a super-admin (the read gate
    //     has no platform exception), so a publish attempt cannot distinguish it from a missing id.
    await seedDefinition('private');
    const rootA = await tokenFor('rootA');
    const ownerA = await tokenFor('ownerA');
    await expectEnvelope(await setGlobal(rootA, DEF_ID, true), 404, 'NOT_FOUND');
    expect(await storedVisibility(DEF_ID)).toBe('private');

    // (2) The reachable case the launch-pad rule exists for: the AUTHOR is themselves a super-admin,
    //     so they CAN see their own private row. Demotion lands on `org`, so publishing from
    //     `private` would expose the row to the whole authoring org on the way back down — refuse it
    //     at the launch pad rather than remember a prior tier.
    const ownId = (await integrationDefinitionStore.create(
      {
        orgId: 'orgA', userId: 'rootA', visibility: 'private', key: `${KEY}-root`,
        displayName: 'root-authored', configSchema: [], actions: [], skillMd: '# r',
      },
      { actor: { userId: 'rootA', orgId: 'orgA', role: 'super-admin' }, onConflict: 'replace' },
    ))._id;
    await expectEnvelope(await setGlobal(rootA, ownId, true), 403, 'FORBIDDEN');
    expect(await storedVisibility(ownId)).toBe('private');

    // Shared with the org first, the same publish succeeds — and demotion is exactly reversible.
    await expectOk(await setVisibility(rootA, ownId, 'org'), 'org');
    await expectOk(await setGlobal(rootA, ownId, true), 'global');
    await expectOk(await setGlobal(rootA, ownId, false), 'org');

    // The owner's own private row is still theirs to share the ordinary way.
    await expectOk(await setVisibility(ownerA, DEF_ID, 'org'), 'org');
  });

  it('a client can discover its OWN definition id + tier; a foreign global row reveals neither', async () => {
    await seedDefinition('org');
    const rootA = await tokenFor('rootA');
    await expectOk(await setGlobal(rootA, DEF_ID, true), 'global');

    const listFor = async (who: string): Promise<Array<Record<string, unknown>>> => {
      const res = await api('/api/v1/integrations', await tokenFor(who));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      return Array.isArray(body) ? body : (body.items ?? []);
    };

    // Own org: the listing carries the id these routes key on, and the current tier.
    const mine = (await listFor('ownerA')).find((d) => d.key === KEY);
    expect(mine, 'the author must see their own definition').toBeTruthy();
    expect(mine?.id).toBe(DEF_ID);
    expect(mine?.visibility).toBe('global');

    // Another org resolves the PUBLISHED definition but learns neither field: the id is derivable
    // from (orgId, key), so exposing it would expose the authoring org.
    const theirs = (await listFor('userB')).find((d) => d.key === KEY);
    expect(theirs, 'a global definition must resolve cross-org').toBeTruthy();
    expect(theirs?.id).toBeUndefined();
    expect(theirs?.visibility).toBeUndefined();
  });

  it('the descriptors DECLARE what the routes enforce (contract, not just behaviour)', () => {
    expect(integrationsEndpoints.setGlobal.auth).toBe('super-admin');
    expect(integrationsEndpoints.setVisibility.auth).toBe('user');
    // Exactly two members: this enum IS the wire-level refusal of a cross-org publish, which is
    // what makes the 400 a contract guarantee rather than an implementation detail.
    expect(TenantDefinitionVisibility.options).toEqual(['private', 'org']);
  });
});
