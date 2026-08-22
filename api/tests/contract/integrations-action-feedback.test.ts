import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, gatewayKeys, integrationDefinitions, integrationActionFeedback } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import {
  ErrorEnvelope,
  IntegrationActionFeedback,
  IntegrationActionFeedbackListResponse,
  DiscardActionFeedbackResponse,
  ACTION_FEEDBACK_MAX_CHARS,
  ACTION_FEEDBACK_MAX_NOTES_PER_ACTION,
  ACTION_FEEDBACK_STEP_REF_MAX_CHARS,
} from '@ekoa/shared';

/**
 * PER-USER ACTION FEEDBACK (slice S3), through the REAL app.
 *
 * ── WHAT THESE THREE ENDPOINTS ARE FOR ───────────────────────────────────────────────────────
 *
 * The detail page renders an action's steps read-only, and a person who has learned something about
 * that action ("this portal wants the reference zero-padded") has nowhere to put it. These routes
 * are that place, and the text does not merely sit there: it is read back into the three prompts
 * that plan against the action, which is what makes the write's auth class a security decision
 * rather than a convenience one.
 *
 * ── WHAT IS PINNED HERE, AND WHERE THE REST IS ───────────────────────────────────────────────
 *
 * The CONTRACT: every 2xx against its shared schema, every non-2xx against the error envelope, the
 * malformed segment as a 400 and the unknown key/action as the house 404. Plus four behaviours the
 * schema cannot state:
 *
 *   - the author's read is BYTE-EXACT, proven with a three-cycle edit loop that would burn a
 *     redaction into the person's own sentence if the read were the scrubbed one (the A3 review F3
 *     shape, which `definition-lessons.ts` learned first);
 *   - `createdAt` SURVIVES an edit while `updatedAt` moves - the fact that makes the write an
 *     insert-as-claim plus CAS rather than a `put`, and the one a `put` would silently destroy;
 *   - the action note and a step's note are DIFFERENT rows at the same action, and the delete of one
 *     leaves the other;
 *   - a REAL minted gateway key is refused on the WRITE while a platform JWT succeeds. That is
 *     decision D2 and the reason these are `user`: a key-bearing agent that could POST here would be
 *     authoring its own next prompt.
 *
 * TENANCY (cross-org and cross-user, on every method and at all three prompt seams) is in
 * `api/tests/security/action-feedback-isolation.test.ts` (Rule 5 class), where each control is
 * proved by deleting it and watching the cases go red.
 *
 * ADMISSION beyond the one key probe below is not repeated here: `integrations-capability.test.ts`
 * walks this router's own stack and requires every route outside the declared capability set to
 * refuse a real gateway key, so these three are held off the key surface by that walk.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const KEY = 's3-feedback-probe';
const ACTION = 'consultar_processo';
const OTHER_ACTION = 'listar_pendentes';
const STEP = 'abrir-portal';

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const call = (p: string, t: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });

const listNotes = (t: string | null, key = KEY) => call(`/api/v1/integrations/${key}/feedback`, t);
const putNote = (t: string | null, body: unknown, action = ACTION, key = KEY) =>
  call(`/api/v1/integrations/${key}/actions/${action}/feedback`, t, { method: 'PUT', body: JSON.stringify(body) });
const deleteNote = (t: string | null, opts: { stepRef?: string; action?: string; key?: string } = {}) =>
  call(
    `/api/v1/integrations/${opts.key ?? KEY}/actions/${opts.action ?? ACTION}/feedback`
      + (opts.stepRef !== undefined ? `?stepRef=${encodeURIComponent(opts.stepRef)}` : ''),
    t,
    { method: 'DELETE' },
  );

async function mintKey(token: string, label: string): Promise<{ id: string; key: string }> {
  const res = await call('/api/v1/gateway-keys', token, { method: 'POST', body: JSON.stringify({ label }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string };
}

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user' = 'user'): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seedDefinition(orgId = 'orgA', ownerUserId = 'userA1'): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId: ownerUserId, visibility: 'org', key: KEY,
      displayName: 'S3 Feedback Probe', configSchema: [],
      actions: [
        { actionName: ACTION, description: 'consulta um processo', mutates: false,
          httpConfig: { method: 'GET', baseUrl: 'https://portal.example', path: '/processos/{{input.ref}}' } },
        { actionName: OTHER_ACTION, description: 'lista os pendentes', mutates: false,
          automationBinding: { automationId: 'aut-s3-feedback' } },
      ],
      skillMd: '# S3 Feedback Probe\n',
    },
    { actor: { userId: ownerUserId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s3_feedback_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
  __resetConfigForTests();
});

beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, gatewayKeys, integrationDefinitions, integrationActionFeedback]) await s.deleteMany({});
  await mkUser('userA1', 'orgA');
  await seedDefinition();
});

describe('the note round trip', () => {
  it('PUT then GET answers the shared schemas, and the read is BYTE-EXACT', async () => {
    const token = await tokenFor('userA1');
    // A credential in a credential-VALUE position - the shape `scrubSecretText` is anchored on. The
    // author's read must hand it back untouched, or the next ordinary save writes the redaction
    // into their own sentence permanently.
    const note = 'o portal recusa sem o referer. api_key: sk_' + 'live_' + 'ROUNDTRIPaaaa1111bbbb';

    const put = await putNote(token, { note });
    expect(put.status).toBe(200);
    const written = IntegrationActionFeedback.safeParse(await put.json());
    expect(written.success, JSON.stringify(written)).toBe(true);
    expect(written.success && written.data.note).toBe(note);

    const got = await listNotes(token);
    expect(got.status).toBe(200);
    const body = IntegrationActionFeedbackListResponse.safeParse(await got.json());
    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(body.success && body.data.items).toHaveLength(1);
    expect(body.success && body.data.items[0]!.note).toBe(note);
  });

  it('a three-cycle GET -> PUT edit loop is lossless (a scrubbed read would burn the redaction in)', async () => {
    const token = await tokenFor('userA1');
    const original = 'usa o token assim. Authorization: Bearer ' + 'AbCdEf0123456789AbCdEf0123456789';
    await putNote(token, { note: original });

    for (let cycle = 0; cycle < 3; cycle++) {
      const read = (await (await listNotes(token)).json()) as { items: { note: string }[] };
      const round = await putNote(token, { note: read.items[0]!.note });
      expect(round.status).toBe(200);
    }
    const final = (await (await listNotes(token)).json()) as { items: { note: string }[] };
    expect(final.items[0]!.note).toBe(original);
  });

  it('an edit keeps `createdAt` ON THE WIRE, and leaves exactly one note', async () => {
    // THIS TEST NO LONGER CLAIMS THE `updatedAt` HALF, and the correction is the point. It used to
    // be titled "keeps createdAt and moves updatedAt" while asserting `second.updatedAt >=
    // first.updatedAt` - which a stamp that never moves satisfies, so the half the title advertised
    // was enforced by nothing. The moves-half is now pinned where it can be made deterministic:
    // `tests/security/action-feedback-isolation.test.ts` drives an ActionFeedbackStore on an
    // INJECTED stepping clock and asserts strict inequality. Through the wire the store is the
    // process singleton on `new Date()`, so a strict comparison here would be a wall-clock race.
    //
    // What this case still pins, and what only it can: that the surviving `createdAt` reaches the
    // CLIENT rather than merely the store, across two real HTTP round trips.
    const token = await tokenFor('userA1');
    const first = (await (await putNote(token, { note: 'primeira versao' })).json()) as { createdAt: string; updatedAt: string };
    const second = (await (await putNote(token, { note: 'segunda versao' })).json()) as { createdAt: string; updatedAt: string; note: string };

    expect(second.note).toBe('segunda versao');
    expect(second.createdAt).toBe(first.createdAt);
    // Still exactly one note: the write is idempotent at its own address.
    const listed = (await (await listNotes(token)).json()) as { items: unknown[] };
    expect(listed.items).toHaveLength(1);
  });

  it('the action note and a step note are separate rows, and each delete takes only its own', async () => {
    const token = await tokenFor('userA1');
    await putNote(token, { note: 'sobre a acao toda' });
    await putNote(token, { note: 'sobre este passo', stepRef: STEP });

    const both = (await (await listNotes(token)).json()) as { items: { note: string; stepRef?: string }[] };
    expect(both.items).toHaveLength(2);

    // No `stepRef` on the DELETE addresses the ACTION's note and never a step's.
    const del = await deleteNote(token);
    expect(del.status).toBe(200);
    expect(DiscardActionFeedbackResponse.safeParse(await del.json()).success).toBe(true);

    const left = (await (await listNotes(token)).json()) as { items: { stepRef?: string }[] };
    expect(left.items).toHaveLength(1);
    expect(left.items[0]!.stepRef).toBe(STEP);
  });

  it('the DELETE is idempotent: nothing to erase is `ok` with `discarded: false`, not a 404', async () => {
    const token = await tokenFor('userA1');
    await putNote(token, { note: 'para apagar' });

    const first = await deleteNote(token);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { discarded: boolean }).discarded).toBe(true);

    const second = await deleteNote(token);
    expect(second.status, 'a 404 here would be an existence oracle over a colleague\'s notes').toBe(200);
    const body = DiscardActionFeedbackResponse.safeParse(await second.json());
    expect(body.success).toBe(true);
    expect(body.success && body.data.discarded).toBe(false);
  });
});

describe('the refusals, every one an envelope', () => {
  it('an over-length note is a 400 AT THE SCHEMA and the stored row is untouched', async () => {
    const token = await tokenFor('userA1');
    await putNote(token, { note: 'a nota boa' });

    const res = await putNote(token, { note: 'x'.repeat(ACTION_FEEDBACK_MAX_CHARS + 1) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);

    const listed = (await (await listNotes(token)).json()) as { items: { note: string }[] };
    expect(listed.items[0]!.note, 'the refused write must not have partially landed').toBe('a nota boa');
  });

  it('an EMPTY note is a 400 and never a silent delete', async () => {
    const token = await tokenFor('userA1');
    await putNote(token, { note: 'a nota boa' });

    for (const body of [{ note: '' }, { note: undefined }, {}]) {
      const res = await putNote(token, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    const listed = (await (await listNotes(token)).json()) as { items: unknown[] };
    expect(listed.items, 'a refused write must not have removed the row').toHaveLength(1);
  });

  it('an unknown ACTION and an unknown KEY are the SAME 404 - no action-name oracle', async () => {
    const token = await tokenFor('userA1');
    const unknownAction = await putNote(token, { note: 'x' }, 'nao_existe');
    const unknownKey = await putNote(token, { note: 'x' }, ACTION, 'nao-existe');

    expect(unknownAction.status).toBe(404);
    expect(unknownKey.status).toBe(404);
    const a = await unknownAction.json();
    const b = await unknownKey.json();
    expect(ErrorEnvelope.safeParse(a).success).toBe(true);
    expect(JSON.stringify(a), 'the two refusals must be byte-identical').toBe(JSON.stringify(b));

    // The GET refuses the unknown key the same way.
    expect((await listNotes(token, 'nao-existe')).status).toBe(404);
  });

  it('an ORG-LESS authenticated caller is a 403 envelope on all three routes', async () => {
    // The fail-closed arm the review found unpinned. `resolveCapabilityDefinition` answers
    // `no_tenant` for a tenant-less actor and `refuseCapability` maps it to FORBIDDEN - a shared
    // mechanism the evidence route pins for ITSELF, which says nothing about whether these three
    // handlers actually reach it. A route-local refactor (calling the store before resolving, or a
    // bespoke refusal) would leave every other S3 suite green.
    await users.insert({
      _id: 'userNoOrg', username: 'userNoOrg', passwordHash: await hashPassword('pw123456'),
      role: 'user', orgId: '', active: true,
    } as never);
    setActivation('userNoOrg', { active: true, billingLocked: false });
    const token = await tokenFor('userNoOrg');

    for (const res of [
      await listNotes(token),
      await putNote(token, { note: 'de um utilizador sem organizacao' }),
      await deleteNote(token),
    ]) {
      expect(res.status).toBe(403);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    // Nothing was written under an empty tenant.
    expect(await integrationActionFeedback.find({})).toEqual([]);
  });

  it('the STORAGE ENVELOPE never reaches the wire - asserted, not assumed', async () => {
    // `feedbackView` is the single point of protection, and the schema is `.strict()` so a body
    // carrying the substrate now FAILS safeParse rather than being silently stripped by zod. Both
    // halves are asserted: the parse, and the absence by name.
    const token = await tokenFor('userA1');
    const written = (await (await putNote(token, { note: 'uma nota' })).json()) as Record<string, unknown>;
    const listed = (await (await listNotes(token)).json()) as { items: Record<string, unknown>[] };

    for (const body of [written, listed.items[0]!]) {
      for (const leaked of ['_id', 'orgId', 'userId', '_rev']) {
        expect(body[leaked], `${leaked} must not reach the wire`).toBeUndefined();
      }
      expect(Object.keys(body).sort()).toEqual(['createdAt', 'note', 'updatedAt', 'actionName'].sort());
    }
  });

  it('a per-action note CEILING answers a 400 naming the limit, never the house 404', async () => {
    const token = await tokenFor('userA1');
    for (let i = 0; i < ACTION_FEEDBACK_MAX_NOTES_PER_ACTION; i++) {
      expect((await putNote(token, { note: `nota ${i}`, stepRef: `passo-${i}` })).status).toBe(200);
    }
    const over = await putNote(token, { note: 'a nota a mais', stepRef: 'um-a-mais' });
    expect(over.status, 'the caller CAN see this action - a 404 would be a lie').toBe(400);
    const body = await over.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { details?: { code?: string; limit?: number } } }).error.details?.code).toBe('too_many_notes');
    expect((body as { error: { details?: { limit?: number } } }).error.details?.limit).toBe(ACTION_FEEDBACK_MAX_NOTES_PER_ACTION);

    // An EDIT at the ceiling still lands.
    expect((await putNote(token, { note: 'a nota 0, corrigida', stepRef: 'passo-0' })).status).toBe(200);
  });

  it('a stepRef over the ceiling is a 400 AT THE SCHEMA', async () => {
    const token = await tokenFor('userA1');
    const res = await putNote(token, { note: 'nota', stepRef: 'x'.repeat(ACTION_FEEDBACK_STEP_REF_MAX_CHARS + 1) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('unauthenticated is a 401 envelope on all three', async () => {
    for (const res of [
      await listNotes(null),
      await putNote(null, { note: 'x' }),
      await deleteNote(null),
    ]) {
      expect(res.status).toBe(401);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
  });
});

describe('D2 - a key-bearing agent reads its own prompts, it does not write them', () => {
  it('a REAL minted gateway key is refused on the WRITE while a JWT succeeds', async () => {
    const token = await tokenFor('userA1');
    const minted = await mintKey(token, 's3-feedback-gate');

    const byKey = await call(`/api/v1/integrations/${KEY}/actions/${ACTION}/feedback`, null, {
      method: 'PUT',
      headers: { 'x-api-key': minted.key },
      body: JSON.stringify({ note: 'escrito por um agente' }),
    });
    expect(byKey.status, 'a key that could write here would be authoring its own next prompt').toBe(401);
    expect(ErrorEnvelope.safeParse(await byKey.json()).success).toBe(true);

    // NON-VACUITY: the same request with the person's own token lands, so the refusal is about the
    // ADMISSION and not about the body, the path or the fixture.
    expect((await putNote(token, { note: 'escrito por uma pessoa' })).status).toBe(200);

    // …and nothing the agent sent is in the store.
    const listed = (await (await listNotes(token)).json()) as { items: { note: string }[] };
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.note).toBe('escrito por uma pessoa');
  });

  it('the same key is refused on the READ and on the DELETE', async () => {
    const token = await tokenFor('userA1');
    await putNote(token, { note: 'a nota da pessoa' });
    const minted = await mintKey(token, 's3-feedback-read');

    const read = await call(`/api/v1/integrations/${KEY}/feedback`, null, { headers: { 'x-api-key': minted.key } });
    const erase = await call(`/api/v1/integrations/${KEY}/actions/${ACTION}/feedback`, null, {
      method: 'DELETE', headers: { 'x-api-key': minted.key },
    });
    expect(read.status).toBe(401);
    expect(erase.status).toBe(401);

    // The note is still there: the refused DELETE really did nothing.
    const listed = (await (await listNotes(token)).json()) as { items: unknown[] };
    expect(listed.items).toHaveLength(1);
  });
});
