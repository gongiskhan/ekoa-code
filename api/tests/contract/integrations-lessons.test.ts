import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationDefinitions, integrationConfigs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { loadContextContent } from '../../src/agents/seams.js';
import {
  integrationDefinitionStore,
  type DefinitionVisibility,
} from '../../src/integrations/definition-store.js';
import {
  ErrorEnvelope,
  IntegrationLessonsView,
  INTEGRATION_LESSONS_MAX_CHARS,
  integrationsEndpoints,
} from '@ekoa/shared';

/**
 * Slice C3 — the per-integration LESSONS surface, exercised through the REAL app.
 *
 * Three things are being pinned, and only the first is ordinary CRUD:
 *
 *  1. THE CONTRACT. Both directions validate against `IntegrationLessonsView`; every non-2xx is the
 *     shared error envelope; the over-length refusal is a 400 AT THE SCHEMA (before any handler),
 *     because a ceiling that only exists in a handler is a ceiling a second caller can miss.
 *
 *  2. THE RAW/SCRUBBED SPLIT, end to end over HTTP. The author reads back the exact bytes they
 *     sent (A3 review F3: one scrubbed edit cycle permanently destroyed a tenant's documentation),
 *     while a principal who cannot save reads the scrubbed view and cannot write at all.
 *
 *  3. THE PROMPT SEAM ITSELF. The last describe drives `loadContextContent` — the ACTUAL
 *     `load_context` tool implementation `buildApp` wires — and asserts that a credential pasted
 *     into lessons over the wire never reaches it, while the lesson prose does. That is the whole
 *     point of the slice (knowledge reaches the agent) and its whole risk (A2 review F7) in one
 *     assertion pair.
 *
 * Every sentinel credential is composed at runtime, never a literal (the CS5 secrets-gate rule).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

/** Deliberately named without the substring "KEY": gitleaks' generic-api-key rule fires on a
 *  `const …KEY = '<high-entropy string>'` line, and the CS5 rule is that a fixture-shaped hit is
 *  fixed AT SOURCE rather than allowlisted, so the gate stays sharp. */
const PROBE = 'c3-lessons-probe';
const ABSENT_INTEGRATION = 'c3-no-such-integration';

/** A pasted credential, composed at runtime so no credential-shaped literal is committed. */
const PASTED = ['sk', 'live', 'C3WIREPASTEDSECRET77'].join('_');
const LESSONS = [
  '- The portal rejects requests without a Referer header.',
  '- authorization: required on every call.',
  '- Send `Authorization: Bearer {{api_key}}`.',
  `- Sandbox key (expires weekly): api_key: ${PASTED}`,
].join('\n');

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });

const getLessons = (t: string | null, key = PROBE) => api(`/api/v1/integrations/${key}/lessons`, t);
const patchLessons = (t: string | null, body: unknown, key = PROBE) =>
  api(`/api/v1/integrations/${key}/lessons`, t, { method: 'PATCH', body: JSON.stringify(body) });

async function expectEnvelope(res: Response, status: number, code: string): Promise<Record<string, unknown>> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx body must validate against ErrorEnvelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
  return (body as { error: { details?: Record<string, unknown> } }).error.details ?? {};
}

async function expectView(res: Response): Promise<IntegrationLessonsView> {
  expect(res.status).toBe(200);
  const body = await res.json();
  const parsed = IntegrationLessonsView.safeParse(body);
  expect(parsed.success, `2xx body must validate against IntegrationLessonsView: ${JSON.stringify(body)}`).toBe(true);
  return parsed.data as IntegrationLessonsView;
}

/** The stored bytes, read UNDER the api — a claim about what persisted is never made by the same
 *  code path that reported success. */
const storedLessons = async (): Promise<string | undefined> =>
  (await integrationDefinitionStore.getById((await integrationDefinitions.find({ key: PROBE }))[0]!._id as string))?.lessons;

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seedDefinition(visibility: DefinitionVisibility, lessons?: string): Promise<string> {
  const doc = await integrationDefinitionStore.create(
    {
      orgId: 'orgA', userId: 'ownerA', visibility, key: PROBE,
      displayName: 'C3 Lessons Probe', configSchema: [], actions: [],
      skillMd: '# C3 Lessons Probe\nKNOWLEDGE BODY.\n',
      ...(lessons !== undefined ? { lessons } : {}),
    },
    { actor: { userId: 'ownerA', orgId: 'orgA', role: visibility === 'global' ? 'super-admin' : 'user' }, onConflict: 'replace' },
  );
  return doc._id;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_int_lessons');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, integrationDefinitions, integrationConfigs]) await s.deleteMany({});
  await mkUser('ownerA', 'orgA', 'user');
  await mkUser('peerA', 'orgA', 'user');
  await mkUser('adminA', 'orgA', 'org-admin');
  await mkUser('userB', 'orgB', 'user');
});

describe('C3 — the lessons round trip is byte-exact for the people who may save the integration', () => {
  it('PATCH then GET returns EXACTLY the bytes that were sent, redaction marker nowhere in sight', async () => {
    await seedDefinition('private');
    const t = await tokenFor('ownerA');

    const written = await expectView(await patchLessons(t, { lessons: LESSONS }));
    expect(written.lessons).toBe(LESSONS);
    expect(written.editable).toBe(true);
    expect(written.key).toBe(PROBE);

    const read = await expectView(await getLessons(t));
    expect(read.lessons).toBe(LESSONS);
    expect(read.lessons).toContain(PASTED);
    expect(read.lessons).not.toContain('[REDACTED]');
    expect(await storedLessons()).toBe(LESSONS);
  });

  it('an EDIT CYCLE over HTTP (GET -> PATCH what was read) never round-trips a redaction', async () => {
    // The A3 review F3 defect, reproduced as the user performs it: load the editor, press save
    // without changing anything, three times. Any scrub on the read path would burn in here.
    await seedDefinition('private', LESSONS);
    const t = await tokenFor('ownerA');
    for (let cycle = 0; cycle < 3; cycle++) {
      const loaded = await expectView(await getLessons(t));
      const saved = await expectView(await patchLessons(t, { lessons: loaded.lessons, expectedUpdatedAt: loaded.updatedAt }));
      expect(saved.lessons, `cycle ${cycle}`).toBe(LESSONS);
    }
    expect(await storedLessons()).toBe(LESSONS);
  });

  it('an ORG-ADMIN over a member row may read raw and write; a PLAIN PEER may do neither', async () => {
    await seedDefinition('org', LESSONS);

    const admin = await expectView(await getLessons(await tokenFor('adminA')));
    expect(admin.lessons).toBe(LESSONS);
    expect(admin.editable).toBe(true);

    const tPeer = await tokenFor('peerA');
    const peer = await expectView(await getLessons(tPeer));
    // Non-vacuous: the peer really resolves the org-shared row — they just get the scrubbed view.
    expect(peer.lessons).toContain('rejects requests without a Referer');
    expect(peer.lessons).not.toContain(PASTED);
    expect(peer.lessons).toContain('[REDACTED]');
    expect(peer.editable).toBe(false);

    await expectEnvelope(await patchLessons(tPeer, { lessons: 'peer overwrite' }), 403, 'FORBIDDEN');
    expect(await storedLessons()).toBe(LESSONS);
  });

  it('a PUBLISHED (global) row is scrubbed for everyone and writable by nobody, author included', async () => {
    await seedDefinition('global', LESSONS);
    for (const who of ['ownerA', 'adminA', 'userB']) {
      const t = await tokenFor(who);
      const v = await expectView(await getLessons(t));
      expect(v.lessons, who).toContain('rejects requests without a Referer');
      expect(v.lessons, who).not.toContain(PASTED);
      expect(v.editable, who).toBe(false);
      await expectEnvelope(await patchLessons(t, { lessons: 'hijack' }), 403, 'FORBIDDEN');
    }
    expect(await storedLessons()).toBe(LESSONS);
  });

  it('ANOTHER ORG gets the uniform 404 — byte-identical to a key that does not exist', async () => {
    await seedDefinition('private', LESSONS);
    const t = await tokenFor('userB');

    const hiddenGet = await getLessons(t);
    const missingGet = await getLessons(t, ABSENT_INTEGRATION);
    expect(hiddenGet.status).toBe(404);
    expect(await hiddenGet.text()).toBe(await missingGet.text());

    const hiddenPatch = await patchLessons(t, { lessons: 'x' });
    const missingPatch = await patchLessons(t, { lessons: 'x' }, ABSENT_INTEGRATION);
    expect(hiddenPatch.status).toBe(404);
    expect(await hiddenPatch.text()).toBe(await missingPatch.text());
    expect(await storedLessons()).toBe(LESSONS);
  });

  it('a SHIPPED baseline package has no lessons row: 404, not an editable empty box', async () => {
    // `refresh` exposes the shipped keys; the first one is a definition that exists but has no
    // stored row, which is exactly the case an invented empty view would get wrong.
    const t = await tokenFor('adminA');
    const shipped = (await (await api('/api/v1/integrations/refresh', t, { method: 'POST' })).json()) as { keys: string[] };
    expect(shipped.keys.length).toBeGreaterThan(0);
    const res = await getLessons(await tokenFor('ownerA'), shipped.keys[0]!);
    expect(res.status).toBe(404);
  });
});

describe('C3 — the ceiling is a WIRE-LEVEL refusal, and it never trims', () => {
  it('accepts exactly the limit and refuses one more character at the schema, storing nothing', async () => {
    await seedDefinition('private', 'seed');
    const t = await tokenFor('ownerA');

    const atLimit = 'x'.repeat(INTEGRATION_LESSONS_MAX_CHARS);
    expect((await expectView(await patchLessons(t, { lessons: atLimit }))).lessons).toHaveLength(INTEGRATION_LESSONS_MAX_CHARS);

    await expectEnvelope(await patchLessons(t, { lessons: 'y'.repeat(INTEGRATION_LESSONS_MAX_CHARS + 1) }), 400, 'VALIDATION_FAILED');
    // Nothing was truncated into the row: the previous body is intact, and no prefix of the new
    // one was stored. Truncation is the failure this endpoint exists to refuse.
    expect(await storedLessons()).toBe(atLimit);
    expect(await storedLessons()).not.toContain('y');
  });

  it('rejects a malformed body (missing / wrong-typed `lessons`) with the envelope, row untouched', async () => {
    await seedDefinition('private', 'seed');
    const t = await tokenFor('ownerA');
    for (const body of [{}, { lessons: 42 }, { lessons: null }, { lessons: ['a'] }]) {
      await expectEnvelope(await patchLessons(t, body), 400, 'VALIDATION_FAILED');
    }
    expect(await storedLessons()).toBe('seed');
  });

  it('the declared MAX matches the schema that enforces it (one constant, not two)', () => {
    const shape = (integrationsEndpoints.setLessons.request as unknown as { shape: Record<string, unknown> }).shape;
    expect(shape.lessons).toBeDefined();
    expect(INTEGRATION_LESSONS_MAX_CHARS).toBe(20_000);
  });
});

describe('C3 — a concurrent edit is refused with the stored text, never silently overwritten', () => {
  it('a stale `expectedUpdatedAt` is refused and answers with what is actually stored', async () => {
    // `org`, NOT `private`: the race needs two DISTINCT editors, and a private row has exactly one
    // — an org-admin cannot even see a peer's private row (`isDefinitionVisibleTo`), so staging it
    // there would assert a 404 instead of a lost update. `org` is where `canEditDefinitionRaw`
    // admits both the owner and their org-admin (the same pairing the unit suite races).
    await seedDefinition('org', 'original');
    const tOwner = await tokenFor('ownerA');
    const tAdmin = await tokenFor('adminA');

    const loaded = await expectView(await getLessons(tOwner));
    await expectView(await patchLessons(tAdmin, { lessons: 'ADMIN VERSION', expectedUpdatedAt: loaded.updatedAt }));

    const details = await expectEnvelope(
      await patchLessons(tOwner, { lessons: 'OWNER VERSION', expectedUpdatedAt: loaded.updatedAt }),
      400, 'VALIDATION_FAILED',
    );
    expect(details.code).toBe('stale_revision');
    // The refusal carries the CURRENT view so the editor can show both versions rather than guess.
    const current = IntegrationLessonsView.safeParse(details.current);
    expect(current.success, `details.current must be a valid view: ${JSON.stringify(details.current)}`).toBe(true);
    expect((current.data as IntegrationLessonsView).lessons).toBe('ADMIN VERSION');
    expect(await storedLessons()).toBe('ADMIN VERSION');

    // Omitting the token is the explicit overwrite, and it lands.
    await expectView(await patchLessons(tOwner, { lessons: 'OWNER VERSION' }));
    expect(await storedLessons()).toBe('OWNER VERSION');
  });
});

describe('C3 — the routes are mounted, closed by default, and declare what they enforce', () => {
  it('an unauthenticated caller gets 401 on both', async () => {
    await seedDefinition('private', LESSONS);
    await expectEnvelope(await getLessons(null), 401, 'UNAUTHENTICATED');
    await expectEnvelope(await patchLessons(null, { lessons: 'x' }), 401, 'UNAUTHENTICATED');
    expect(await storedLessons()).toBe(LESSONS);
  });

  it('a GATEWAY KEY cannot reach either route — free text that lands in a prompt needs a human', async () => {
    await seedDefinition('private', LESSONS);
    // Both descriptors are `user`, not `user-or-key`: an agent must not write its own future
    // context, nor read another principal's raw bytes. Both routes sit BELOW the router-wide
    // `requireAuth` blanket, so a bearer that is not a platform JWT is simply unauthenticated.
    expect(integrationsEndpoints.getLessons.auth).toBe('user');
    expect(integrationsEndpoints.setLessons.auth).toBe('user');
    await expectEnvelope(await getLessons('ek_not_a_platform_jwt'), 401, 'UNAUTHENTICATED');
    await expectEnvelope(await patchLessons('ek_not_a_platform_jwt', { lessons: 'x' }), 401, 'UNAUTHENTICATED');
    expect(await storedLessons()).toBe(LESSONS);
  });
});

/**
 * THE POINT OF THE SLICE, AND ITS RISK, IN ONE PLACE.
 *
 * `loadContextContent` is the seam `buildApp` wires for the agent `load_context` tool. Driving it
 * here (rather than a unit fake) proves the whole chain the operator's note actually travels:
 * PATCH -> Mongo -> the tenant-scoped registry -> the egress scrub -> the concatenation -> the
 * string an agent is handed.
 */
describe('C3 — lessons reach the agent through `load_context`, scrubbed, joined to the SKILL.md', () => {
  /** The load_context fallback resolves `integration-<key>` only for an ENABLED org config. */
  async function enableConfigFor(token: string): Promise<void> {
    const res = await api('/api/v1/integrations/configs', token, {
      method: 'POST',
      body: JSON.stringify({ integrationKey: PROBE, configValues: { api_key: 'placeholder' } }),
    });
    expect(res.status).toBe(201);
  }

  it('A SECRET PASTED INTO LESSONS OVER THE WIRE NEVER REACHES THE PROMPT SEAM', async () => {
    await seedDefinition('private');
    const t = await tokenFor('ownerA');
    await enableConfigFor(t);
    await expectView(await patchLessons(t, { lessons: LESSONS }));

    const context = await loadContextContent({ userId: 'ownerA', agentKind: 'chat', name: `integration-${PROBE}` });
    expect(context, 'the integration context must resolve for an enabled config').toBeTruthy();
    // The knowledge body is still there — the slice ADDS to load_context, it does not replace it.
    expect(context).toContain('KNOWLEDGE BODY.');
    // The lesson prose reached the agent: that is the whole product point.
    expect(context).toContain('rejects requests without a Referer');
    expect(context).toContain('Operational lessons');
    // And the pasted credential did not.
    expect(context).not.toContain(PASTED);
    expect(context).toContain('[REDACTED]');
    // Value-anchored, not name-phobic: documentation and templates survive the scrub.
    expect(context).toContain('authorization: required');
    expect(context).toContain('Bearer {{api_key}}');

    // …while the EDITOR still holds the exact bytes. Both directions, same row, same moment.
    expect((await expectView(await getLessons(t))).lessons).toBe(LESSONS);
  });

  it('an integration with no lessons yields exactly the SKILL.md it did before this slice', async () => {
    await seedDefinition('private');
    const t = await tokenFor('ownerA');
    await enableConfigFor(t);
    const context = await loadContextContent({ userId: 'ownerA', agentKind: 'chat', name: `integration-${PROBE}` });
    expect(context).toContain('KNOWLEDGE BODY.');
    expect(context).not.toContain('Operational lessons');
  });
});
