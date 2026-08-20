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
import { integrationDefinitionStore, definitionIdFor } from '../../src/integrations/definition-store.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import {
  DefinitionPublishRequestResponse,
  ErrorEnvelope,
  IntegrationPublishQueueResponse,
  PublishDefinitionResponse,
  PublishPreviewResponse,
  PUBLISH_REQUEST_NOTE_MAX_CHARS,
  integrationsEndpoints,
} from '@ekoa/shared';

/**
 * Slice S6 - THE PUBLISH DOORS, exercised through the REAL app.
 *
 * The mechanism under these five routes was built and tested by slice E2 and had ZERO non-test
 * callers: `previewPublish`, `publishDefinition`, `requestPublish`, `withdrawPublishRequest` and
 * `listPublishRequests` were reachable only from a unit test. The review queue E2 designed had never
 * been reachable at all. So what this suite pins is what MOUNTING can get wrong, and only that:
 *
 *   - the ROUTES EXIST and are closed by default (a missing mount is a 404 from the terminal
 *     handler, not a 401 - and `/definitions/publish-requests` sharing a prefix with four `/:id/…`
 *     routes is exactly the ordering trap this file's header warns about);
 *   - which VERDICT becomes which status, including the no-existence-oracle 404 asserted
 *     BYTE-FOR-BYTE against a genuinely missing id;
 *   - that the acting tenant is the JWT and never the body;
 *   - that the SUPERSEDE the brief asks for is real: a second publish replaces the live snapshot
 *     wholesale and stamps what it replaced;
 *   - that the whole loop CLOSES - submit inside the tenant, queue outside it, preview, publish,
 *     and another org reading the published artifact through the ordinary registry.
 *
 * Everything runs against `buildApp` on a real socket with real logins, two orgs and four roles. No
 * handler is called directly, so a route left unmounted, mounted without `requireAuth`, or mounted
 * without its role gate fails here rather than passing on a unit stub.
 *
 * THE MODEL PASS IS NOT STUBBED, and that is deliberate. `scrubForPublish` is documented as running
 * the deterministic FLOOR unconditionally and the chokepoint model pass as a second net whose
 * failure is recorded rather than fatal. This suite boots with no model credential, so the pass
 * genuinely fails - and the assertions below (redactions present, `[REDACTED]` in the snapshot, the
 * publish landing) are the end-to-end proof of that property rather than a claim about it.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const KEY = 's6-publish-probe';
const DEF_ID = definitionIdFor('orgA', KEY);
/** An id that names no row at all - the reference bytes for the uniform 404. */
const MISSING_ID = definitionIdFor('orgA', 'no-such-definition-anywhere');

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });

const submit = (t: string | null, id: string, note?: string) =>
  api(`/api/v1/integrations/definitions/${id}/publish-request`, t, {
    method: 'POST',
    body: JSON.stringify(note === undefined ? {} : { note }),
  });
const withdraw = (t: string | null, id: string) =>
  api(`/api/v1/integrations/definitions/${id}/publish-request`, t, { method: 'DELETE' });
const queue = (t: string | null) => api('/api/v1/integrations/definitions/publish-requests', t);
const preview = (t: string | null, id: string) =>
  api(`/api/v1/integrations/definitions/${id}/publish-preview`, t, { method: 'POST', body: '{}' });
const publish = (t: string | null, id: string, body: Record<string, unknown> = {}) =>
  api(`/api/v1/integrations/definitions/${id}/publish`, t, { method: 'POST', body: JSON.stringify(body) });

async function expectEnvelope(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx body must be the envelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

/** Parse a 2xx body against its shared schema, failing loudly with the body when it does not fit. */
async function expectSchema<T>(res: Response, schema: { safeParse: (v: unknown) => { success: boolean } }): Promise<T> {
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(schema.safeParse(body).success, `2xx body must validate: ${JSON.stringify(body)}`).toBe(true);
  return body as T;
}

/** The row as PERSISTED - an echo is only trusted once the document agrees with it. */
const storedDoc = (id: string) => integrationDefinitionStore.getById(id);

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

/**
 * A CREDENTIAL VALUE planted in the row's free text. Long, three character classes: over
 * `looksLikePastedSecret`'s floor, so the deterministic publish floor must take it out - which is
 * how this suite proves the floor really ran on the wire rather than assuming it.
 *
 * COMPOSED AT RUNTIME, NEVER WRITTEN WHOLE, which is the rule the sibling
 * `tests/security/publish-doors-isolation.test.ts` states in its own header. Written whole, this is
 * a real `sk_live_` shape sitting in a tracked file and gitleaks reads it as a stripe access token;
 * a fixture that reddens `npm run gate:secrets` teaches everyone to skim that gate, which is the one
 * way the gate can miss a genuinely pasted key. Composing changes nothing the code under test sees:
 * the assembled value is byte-for-byte what reaches the floor.
 *
 * Deliberately NOT allowlisted in `scripts/gitleaks.toml`. An exception is how a gate stops being a
 * gate - and `gitleaks detect` scans git HISTORY, so the entry could never have been retired either.
 */
const PLANTED_SECRET = ['sk', '_live_', '9aZq7RtY2wV4nB6mK1pL8xC3dF5gH0jS'].join('');

/** Seed org A's definition at `visibility`, authored by `ownerA`. */
async function seedDefinition(
  visibility: 'private' | 'org' | 'global',
  extra: Partial<{ skillMd: string; lessons: string; actions: IntegrationAction[]; description: string }> = {},
): Promise<string> {
  const doc = await integrationDefinitionStore.create(
    {
      orgId: 'orgA',
      userId: 'ownerA',
      visibility,
      key: KEY,
      displayName: 'S6 Publish Probe',
      description: extra.description ?? 'A probe package.',
      configSchema: [],
      actions: extra.actions ?? [],
      skillMd: extra.skillMd ?? `# probe\n\napi_key: ${PLANTED_SECRET}\n`,
      ...(extra.lessons !== undefined ? { lessons: extra.lessons } : {}),
    },
    { actor: { userId: 'ownerA', orgId: 'orgA', role: visibility === 'global' ? 'super-admin' : 'user' }, onConflict: 'replace' },
  );
  return doc._id;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_int_publish');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, integrationDefinitions]) await s.deleteMany({});
  await mkUser('ownerA', 'orgA', 'user');
  await mkUser('peerA', 'orgA', 'user');
  await mkUser('adminA', 'orgA', 'org-admin');
  await mkUser('rootA', 'orgA', 'super-admin');
  await mkUser('userB', 'orgB', 'user');
  // The PLATFORM REVIEWER this whole slice exists for: a super-admin who is not a member of org A
  // and who, before a submission, can see nothing of org A's at all.
  await mkUser('rootB', 'orgB', 'super-admin');
});

// ---------------------------------------------------------------------------------------------
// 1. Submit / withdraw - the tenant half
// ---------------------------------------------------------------------------------------------

describe('S6 - submit for review, and withdraw', () => {
  it('the owner submits, the stamp lands on the ROW, and the withdraw takes it off again', async () => {
    await seedDefinition('org');
    const t = await tokenFor('ownerA');

    const submitted = await expectSchema<{ publishRequest: { requestedBy: string; note?: string } | null }>(
      await submit(t, DEF_ID, 'moved to the new endpoints'),
      DefinitionPublishRequestResponse,
    );
    expect(submitted.publishRequest?.requestedBy).toBe('ownerA');
    expect(submitted.publishRequest?.note).toBe('moved to the new endpoints');
    // The echo is only worth as much as the document behind it.
    expect((await storedDoc(DEF_ID))?.publishRequest?.requestedBy).toBe('ownerA');

    const gone = await expectSchema<{ publishRequest: unknown }>(await withdraw(t, DEF_ID), DefinitionPublishRequestResponse);
    expect(gone.publishRequest).toBeNull();
    expect((await storedDoc(DEF_ID))?.publishRequest).toBeUndefined();
  });

  it('re-submitting RE-STAMPS rather than erroring, so a note can be corrected', async () => {
    await seedDefinition('org');
    const t = await tokenFor('ownerA');
    await submit(t, DEF_ID, 'first try');
    const again = await expectSchema<{ publishRequest: { note?: string } | null }>(
      await submit(t, DEF_ID, 'second try'),
      DefinitionPublishRequestResponse,
    );
    expect(again.publishRequest?.note).toBe('second try');
    expect((await storedDoc(DEF_ID))?.publishRequest?.note).toBe('second try');
  });

  it('a PRIVATE row cannot be submitted - the launch pad is the same one the publish requires', async () => {
    await seedDefinition('private');
    // 403 and not 404: the owner can SEE their own private row, they simply may not open a review
    // window over a draft their own colleagues cannot read.
    await expectEnvelope(await submit(await tokenFor('ownerA'), DEF_ID, 'please'), 403, 'FORBIDDEN');
    expect((await storedDoc(DEF_ID))?.publishRequest).toBeUndefined();
  });

  it('the org-admin may submit a member ORG row; a same-org PEER may not; another org sees a 404', async () => {
    await seedDefinition('org');
    await expectSchema(await submit(await tokenFor('adminA'), DEF_ID), DefinitionPublishRequestResponse);
    await expectEnvelope(await submit(await tokenFor('peerA'), DEF_ID), 403, 'FORBIDDEN');

    const t = await tokenFor('userB');
    const hidden = await submit(t, DEF_ID);
    const missing = await submit(t, MISSING_ID);
    expect(hidden.status).toBe(404);
    // NO EXISTENCE ORACLE, asserted on the BYTES: another org must not be able to tell a row it may
    // not see from a row that is not there.
    expect(await hidden.text()).toBe(await missing.text());
  });

  it('a PUBLISHED row refuses the withdraw - un-publishing is the way back, and it stays reversible', async () => {
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID, 'ship it');
    await publish(await tokenFor('rootA'), DEF_ID);
    expect((await storedDoc(DEF_ID))?.visibility).toBe('global');

    await expectEnvelope(await withdraw(await tokenFor('ownerA'), DEF_ID), 403, 'FORBIDDEN');
    // The record that the org asked survives, so the un-publish transition stays exactly reversible.
    expect((await storedDoc(DEF_ID))?.publishRequest?.requestedBy).toBe('ownerA');
  });

  it('the PLATFORM REVIEWER cannot withdraw the org\'s own request (the record is the tenant\'s)', async () => {
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID, 'ours to withdraw');
    // rootB can SEE the row (the submission opened the window) and is a super-admin - and is still
    // refused, because deleting the request would delete the org's record that it ever asked.
    await expectEnvelope(await withdraw(await tokenFor('rootB'), DEF_ID), 403, 'FORBIDDEN');
    expect((await storedDoc(DEF_ID))?.publishRequest?.requestedBy).toBe('ownerA');
  });

  it('the PLATFORM REVIEWER cannot AUTHOR the org\'s request either - not only not delete it', async () => {
    // S6 review MAJOR-1. The withdraw door carried the membership guard from the start; the submit
    // door did not, and `canWriteDefinition` answers TRUE for ANY super-admin over a row they can
    // merely SEE. Mounting the submit door is what lets rootB see this row at all (the review
    // window), so the same act that opens the review opened a write on the thing being reviewed.
    //
    // WHAT THE DEFECT LOOKED LIKE: `requestPublish` is idempotent by design, so the overwrite is a
    // 200 that reads exactly like the author correcting their own note - while `requestedBy` becomes
    // the reviewer and the prose arguing for publication becomes the reviewer's own words.
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID, 'o argumento do autor');

    await expectEnvelope(await submit(await tokenFor('rootB'), DEF_ID, 'eu proprio peco'), 403, 'FORBIDDEN');

    // THE ROW IS UNCHANGED, which is the property: a 403 answered after the write had landed would
    // be worse than no 403 at all.
    const row = (await storedDoc(DEF_ID))!;
    expect(row.publishRequest?.requestedBy).toBe('ownerA');
    expect(row.publishRequest?.note).toBe('o argumento do autor');

    // THE CONTROL, and it is what stops this reading as "a super-admin may not submit" or as a test
    // of a role gate (this route has none): org A's OWN super-admin, over org A's row, may.
    await expectSchema(await submit(await tokenFor('rootA'), DEF_ID, 'nosso'), DefinitionPublishRequestResponse);
    expect((await storedDoc(DEF_ID))?.publishRequest?.requestedBy).toBe('rootA');
  });

  it('a note longer than the contract cap is a 400 envelope, and nothing is stored', async () => {
    await seedDefinition('org');
    const res = await submit(await tokenFor('ownerA'), DEF_ID, 'x'.repeat(PUBLISH_REQUEST_NOTE_MAX_CHARS + 1));
    await expectEnvelope(res, 400, 'VALIDATION_FAILED');
    expect((await storedDoc(DEF_ID))?.publishRequest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The review queue - the surface that had never been reachable
// ---------------------------------------------------------------------------------------------

describe('S6 - the platform review queue', () => {
  it('a submission is what puts a tenant row in front of a NON-MEMBER reviewer, and only that', async () => {
    await seedDefinition('org');
    const reviewer = await tokenFor('rootB');

    // Before: org A has shared a package internally. The platform sees nothing.
    const before = await expectSchema<{ items: unknown[] }>(await queue(reviewer), IntegrationPublishQueueResponse);
    expect(before.items).toEqual([]);

    await submit(await tokenFor('ownerA'), DEF_ID, 'ready for review');

    const after = await expectSchema<{ items: Array<{ id: string; key: string; orgId: string; note?: string; republish: boolean }> }>(
      await queue(reviewer),
      IntegrationPublishQueueResponse,
    );
    expect(after.items).toHaveLength(1);
    expect(after.items[0]!.id).toBe(DEF_ID);
    expect(after.items[0]!.key).toBe(KEY);
    expect(after.items[0]!.orgId).toBe('orgA');
    expect(after.items[0]!.note).toBe('ready for review');
    expect(after.items[0]!.republish).toBe(false);

    // ...and withdrawing closes the window again.
    await withdraw(await tokenFor('ownerA'), DEF_ID);
    expect((await expectSchema<{ items: unknown[] }>(await queue(reviewer), IntegrationPublishQueueResponse)).items).toEqual([]);
  });

  it('the queue carries ADDRESSING, never CONTENT - nothing on it has been through the scrub', async () => {
    await seedDefinition('org', {
      lessons: `remember the token ${PLANTED_SECRET}`,
      actions: [{ actionName: 'a', description: 'd', mutates: false } as IntegrationAction],
    });
    await submit(await tokenFor('ownerA'), DEF_ID, 'note');

    const body = await expectSchema<{ items: Array<Record<string, unknown>> }>(
      await queue(await tokenFor('rootB')),
      IntegrationPublishQueueResponse,
    );
    const entry = body.items[0]!;
    // The whitelist stated as an EQUALITY over the key set: a field added to the stored document
    // and carried here by a spread would fail this, which a "does not contain skillMd" check
    // would not. The queue runs no scrub, so anything it carries crosses an org boundary raw.
    expect(Object.keys(entry).sort()).toEqual(
      ['actionCount', 'displayName', 'id', 'key', 'note', 'orgId', 'republish', 'requestedAt', 'requestedBy'].sort(),
    );
    expect(entry.actionCount).toBe(1);
    // Belt and braces on the property those keys exist to have: the planted credential is nowhere
    // in the serialized queue at all.
    expect(JSON.stringify(body)).not.toContain(PLANTED_SECRET);
  });

  it('the queue is SUPER-ADMIN ONLY at the route: an org-admin gets 403, not an empty list', async () => {
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID);
    for (const who of ['ownerA', 'adminA']) {
      await expectEnvelope(await queue(await tokenFor(who)), 403, 'FORBIDDEN');
    }
    // The control: the same request from a super-admin answers.
    expect((await queue(await tokenFor('rootA'))).status).toBe(200);
  });

  it('the LITERAL path outranks `:id` - the queue is not read as a definition called "publish-requests"', async () => {
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID);
    // If `/definitions/:id/...` had been registered first with a two-segment sibling, or if the
    // capability `/:key` route had been allowed to swallow `/definitions`, this would answer
    // something other than the queue. Assert the SHAPE, not merely the status.
    const body = await expectSchema<{ items: Array<{ key: string }> }>(
      await queue(await tokenFor('rootA')),
      IntegrationPublishQueueResponse,
    );
    expect(body.items.map((i) => i.key)).toEqual([KEY]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Preview - the dry run
// ---------------------------------------------------------------------------------------------

describe('S6 - the publish preview', () => {
  it('the author sees the SCRUBBED artifact, with the floor visibly applied and the redactions reported', async () => {
    await seedDefinition('org', { lessons: `the key is ${PLANTED_SECRET}` });

    const body = await expectSchema<PublishPreviewResponse>(
      await preview(await tokenFor('ownerA'), DEF_ID),
      PublishPreviewResponse,
    );
    // THE FLOOR RAN, on the wire: the planted credential is gone from the whole response, and the
    // snapshot shows where. The model pass is NOT what did this - the suite has no model
    // credential, so the pass fails and the floor is the entire control (the module's own claim,
    // asserted rather than repeated).
    expect(JSON.stringify(body)).not.toContain(PLANTED_SECRET);
    expect(body.snapshot.skillMd).toContain('[REDACTED]');
    expect(body.redactions.length).toBeGreaterThan(0);
    expect(body.redactions.every((r) => r.source === 'floor')).toBe(true);
    // A redaction reports WHERE and HOW MUCH, never WHAT: the preview must not become a second way
    // to read the credential it just removed.
    expect(Object.keys(body.redactions[0]!).sort()).toEqual(['path', 'removedChars', 'rule', 'source']);
    expect(body.modelPass.status).not.toBe('applied');
    expect(body.supersedes).toBeUndefined();
  });

  it('a same-org PEER is refused, another org gets the uniform 404, and neither pays for a scrub', async () => {
    await seedDefinition('org');
    await expectEnvelope(await preview(await tokenFor('peerA'), DEF_ID), 403, 'FORBIDDEN');

    const t = await tokenFor('userB');
    const hidden = await preview(t, DEF_ID);
    const missing = await preview(t, MISSING_ID);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
  });

  it('the NON-MEMBER REVIEWER can preview only while the submission stands', async () => {
    await seedDefinition('org');
    const reviewer = await tokenFor('rootB');

    // No submission: the row is invisible to a platform super-admin who is not in the org, so the
    // preview is the same 404 a missing id gets. This is the window, and it opens from inside.
    const closed = await preview(reviewer, DEF_ID);
    expect(closed.status).toBe(404);
    expect(await closed.text()).toBe(await (await preview(reviewer, MISSING_ID)).text());

    await submit(await tokenFor('ownerA'), DEF_ID, 'take a look');
    const open = await expectSchema<PublishPreviewResponse>(await preview(reviewer, DEF_ID), PublishPreviewResponse);
    expect(open.snapshot.config.integrationKey).toBe(KEY);

    // Withdrawn, the window closes again.
    await withdraw(await tokenFor('ownerA'), DEF_ID);
    expect((await preview(reviewer, DEF_ID)).status).toBe(404);
  });

  it('preview and publish agree byte-for-byte on the content (one scrub, never two)', async () => {
    await seedDefinition('org', { lessons: `token ${PLANTED_SECRET} and prose` });
    await submit(await tokenFor('ownerA'), DEF_ID);
    const shown = await expectSchema<PublishPreviewResponse>(await preview(await tokenFor('ownerA'), DEF_ID), PublishPreviewResponse);

    await publish(await tokenFor('rootA'), DEF_ID);
    const snap = (await storedDoc(DEF_ID))!.publishedSnapshot!;
    // A preview that could differ from the publish would be worse than no preview at all.
    expect(JSON.stringify(snap.config)).toBe(JSON.stringify(shown.snapshot.config));
    expect(snap.skillMd).toBe(shown.snapshot.skillMd);
    expect(snap.lessons).toBe(shown.snapshot.lessons);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Publish - the write, the supersede, and the cross-org consequence
// ---------------------------------------------------------------------------------------------

describe('S6 - the publish, and what another org then reads', () => {
  it('a super-admin publishes; the row goes global, the snapshot lands, and org B reads the SCRUBBED artifact', async () => {
    await seedDefinition('org', { lessons: `internal note, key ${PLANTED_SECRET}` });
    await submit(await tokenFor('ownerA'), DEF_ID, 'ready');
    const tB = await tokenFor('userB');

    const before = (await (await api('/api/v1/integrations', tB)).json()) as { items: Array<{ key: string }> };
    expect(before.items.map((d) => d.key)).not.toContain(KEY);

    const receipt = await expectSchema<PublishDefinitionResponse>(await publish(await tokenFor('rootA'), DEF_ID), PublishDefinitionResponse);
    expect(receipt.visibility).toBe('global');
    expect(receipt.redactionCount).toBeGreaterThan(0);
    expect(receipt.supersedes).toBeUndefined();

    const doc = (await storedDoc(DEF_ID))!;
    expect(doc.visibility).toBe('global');
    // ONE gated write: the tier and the artifact land together, so they can never disagree.
    expect(doc.publishedSnapshot?.scrubbedBy).toBe('rootA');
    expect(doc.publishedSnapshot?.skillMd).toContain('[REDACTED]');
    // The AUTHOR'S LIVE ROW is untouched - publishing freezes a copy, it does not edit the original.
    expect(doc.skillMd).toContain(PLANTED_SECRET);

    // And the publication is REAL: the same org-B reader now resolves it through the ordinary
    // merged registry, and what they get is the scrubbed artifact rather than org A's live row.
    const after = (await (await api('/api/v1/integrations', tB)).json()) as { items: Array<Record<string, unknown>> };
    const published = after.items.find((d) => d.key === KEY);
    expect(published, 'the published definition resolves cross-org').toBeTruthy();
    expect(JSON.stringify(after)).not.toContain(PLANTED_SECRET);
  });

  it('RE-PUBLISH SUPERSEDES: the live snapshot is replaced wholesale and its stamp recorded', async () => {
    await seedDefinition('org', { lessons: 'first body' });
    await submit(await tokenFor('ownerA'), DEF_ID, 'v1');
    const root = await tokenFor('rootA');
    const first = await expectSchema<PublishDefinitionResponse>(await publish(root, DEF_ID), PublishDefinitionResponse);
    expect(first.supersedes).toBeUndefined();

    // The author revises and the platform re-publishes. `setLessons` is the ordinary edit path; the
    // row is `global` now, so this goes through the store the way a real revision would.
    await integrationDefinitionStore.setLessons(DEF_ID, { userId: 'ownerA', orgId: 'orgA', role: 'user' }, 'second body', {
      admit: () => true,
    });

    const second = await expectSchema<PublishDefinitionResponse>(await publish(root, DEF_ID), PublishDefinitionResponse);
    // THE BRIEF'S RULE: promoting again REPLACES the existing public artifact. One snapshot field,
    // so there is no version chain a reader would have to choose between - and the replaced stamp
    // is recorded so the lineage survives without the superseded bytes.
    expect(second.supersedes?.scrubbedAt).toBe(first.scrubbedAt);
    expect(second.supersedes?.scrubbedBy).toBe('rootA');

    const snap = (await storedDoc(DEF_ID))!.publishedSnapshot!;
    expect(snap.lessons).toBe('second body');
    expect(snap.supersedes?.scrubbedAt).toBe(first.scrubbedAt);
    // Wholesale, not merged: org B reads the NEW body and no trace of the old one.
    const seen = (await (await api('/api/v1/integrations', await tokenFor('userB'))).json()) as { items: Array<Record<string, unknown>> };
    expect(JSON.stringify(seen)).not.toContain('first body');

    // A PUBLISHED row is not in the queue at all: the queue lists `org` rows, and re-submitting a
    // `global` one is refused at the launch-pad rule.
    await expectEnvelope(await submit(await tokenFor('ownerA'), DEF_ID, 'again'), 403, 'FORBIDDEN');
    expect((await expectSchema<{ items: unknown[] }>(await queue(root), IntegrationPublishQueueResponse)).items).toEqual([]);
  });

  it('`republish` warns the reviewer that approving REPLACES something already live in every tenant', async () => {
    // The only way a queued row can already carry a snapshot: publish, un-publish (which
    // deliberately does NOT clear the snapshot, so cross-org readers keep the reviewed artifact
    // rather than the live row), revise, re-submit. Without this case `republish` could never be
    // true and would be a field the reviewer is shown that means nothing.
    await seedDefinition('org');
    const owner = await tokenFor('ownerA');
    const root = await tokenFor('rootA');
    await submit(owner, DEF_ID, 'v1');
    await publish(root, DEF_ID);

    const first = await expectSchema<{ items: Array<{ republish: boolean }> }>(await queue(root), IntegrationPublishQueueResponse);
    expect(first.items, 'a published row leaves the queue').toEqual([]);

    // Un-publish back to `org` (the reversible tier), then ask again.
    await api(`/api/v1/integrations/definitions/${DEF_ID}/global`, root, { method: 'POST', body: JSON.stringify({ global: false }) });
    await submit(owner, DEF_ID, 'v2, please re-review');

    const again = await expectSchema<{ items: Array<{ republish: boolean; note?: string }> }>(
      await queue(root),
      IntegrationPublishQueueResponse,
    );
    expect(again.items).toHaveLength(1);
    expect(again.items[0]!.republish).toBe(true);
    expect(again.items[0]!.note).toBe('v2, please re-review');
    // Its control: the FIRST submission of a never-published row reports `false` (asserted in the
    // queue case above), so this is the flag moving rather than a constant.
  });

  it('the publish is SUPER-ADMIN ONLY at the route AND at the store, and the launch pad is `org`', async () => {
    await seedDefinition('org');
    for (const who of ['ownerA', 'adminA', 'peerA']) {
      await expectEnvelope(await publish(await tokenFor(who), DEF_ID), 403, 'FORBIDDEN');
    }
    expect((await storedDoc(DEF_ID))?.visibility).toBe('org');

    // THE ROUTE'S HALF, TOLD APART FROM THE STORE'S. The loop above cannot do it: for a row the
    // caller can see, `requireRole('super-admin')` and the store's `visibilityWriteVerdict` answer
    // the SAME 403, so dropping the role gate from the route left that loop green. What separates
    // them is WHEN they answer. `requireRole` is middleware: it refuses before the handler runs and
    // therefore before any row is looked up, so it answers the same 403 for an id that names
    // NOTHING - where the store, reached, would have to answer the 404 of a missing row. Assert
    // the id really is missing first, so this cannot pass by naming a row that exists.
    expect(await storedDoc(MISSING_ID)).toBeNull();
    for (const who of ['ownerA', 'adminA', 'peerA']) {
      await expectEnvelope(await publish(await tokenFor(who), MISSING_ID), 403, 'FORBIDDEN');
    }
    // (The queue, the other super-admin door, is already told apart the other way round: its route
    // gate answers 403 where the store's filter would answer an empty 200. The store's own filter
    // is pinned directly in tests/security/publish-doors-isolation.test.ts.)

    // A PRIVATE row is refused even for the super-admin who authored it: demotion lands on `org`,
    // so publishing from `private` would widen the row on the way back down.
    const ownId = (await integrationDefinitionStore.create(
      { orgId: 'orgA', userId: 'rootA', visibility: 'private', key: `${KEY}-root`, configSchema: [], actions: [], skillMd: '# r' },
      { actor: { userId: 'rootA', orgId: 'orgA', role: 'super-admin' }, onConflict: 'replace' },
    ))._id;
    await expectEnvelope(await publish(await tokenFor('rootA'), ownId), 403, 'FORBIDDEN');
    expect((await storedDoc(ownId))?.publishedSnapshot).toBeUndefined();
  });

  it('another org\'s super-admin gets the uniform 404 for an unsubmitted row (root is no read oracle)', async () => {
    await seedDefinition('org');
    const t = await tokenFor('rootB');
    const hidden = await publish(t, DEF_ID);
    const missing = await publish(t, MISSING_ID);
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
    expect((await storedDoc(DEF_ID))?.visibility).toBe('org');
  });

  it('`requireModelPass` REFUSES rather than publishing a floor-only artifact, and stores nothing', async () => {
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID);
    // The suite has no model credential, so the second net cannot run. The default posture publishes
    // with the degradation recorded; the strict one refuses - and the row must be untouched, since
    // the refusal happens before the store write.
    const res = await publish(await tokenFor('rootA'), DEF_ID, { requireModelPass: true });
    const bodyText = await res.clone().text();
    await expectEnvelope(res, 422, 'SECRET_GUARD_BLOCKED');
    const doc = (await storedDoc(DEF_ID))!;
    expect(doc.visibility).toBe('org');
    expect(doc.publishedSnapshot).toBeUndefined();

    // THE REFUSAL CARRIES A MACHINE CODE AND NO SERVER PROSE. `PublishResult.model_pass_required`
    // carries the chokepoint's own thrown message (a transport status, a credential-store error),
    // and echoing it would be the "derive user-facing errors from a code, never server prose"
    // defect on a brand-new surface. `details` is the code and nothing more.
    const parsed = JSON.parse(bodyText) as { error: { details?: Record<string, unknown> } };
    expect(parsed.error.details).toEqual({ code: 'model_pass_required' });
    // `Messages REST` is the literal prefix `completeFast` throws on a non-2xx, so it is the marker
    // that would actually appear; the rest cover the credential-store and filesystem shapes. The
    // PROVIDER NAME is deliberately not in this list - `scripts/chokepoint-grep.sh` fails the build
    // on that token anywhere outside `api/src/llm/`, test files included (FIXED-13), and a suite
    // that had to dodge the egress gate to assert an egress property would be the wrong trade.
    for (const leak of ['HTTP', 'Messages REST', 'ENOENT', 'credential', 'Error:']) {
      expect(bodyText, `the envelope must not carry provider/internal prose: ${leak}`).not.toContain(leak);
    }

    // The control: the same call WITHOUT the flag publishes, with the degradation on the artifact.
    const ok = await expectSchema<PublishDefinitionResponse>(await publish(await tokenFor('rootA'), DEF_ID), PublishDefinitionResponse);
    expect(ok.modelPass.status).toBe('failed');
    expect((await storedDoc(DEF_ID))!.publishedSnapshot?.modelPass.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------------------------
// 4b. The OTHER door onto the global tier - S6 review MAJOR-2
// ---------------------------------------------------------------------------------------------

describe('S6 - `POST /definitions/:id/global` is not a second, unscrubbed way across the boundary', () => {
  const setGlobal = (t: string | null, id: string, global: boolean) =>
    api(`/api/v1/integrations/definitions/${id}/global`, t, { method: 'POST', body: JSON.stringify({ global }) });

  it('THE REACHABILITY THIS SLICE CREATED: before a submission, the door cannot see the row at all', async () => {
    // The half of MAJOR-2 that makes it THIS slice's defect rather than a pre-existing one. Nothing
    // in `api/src/` wrote `publishRequest` before the submit door was mounted, so
    // `isDefinitionVisibleTo`'s review-window branch was dead and a foreign super-admin got the
    // uniform 404 here. Asserted as the BYTES against a genuinely missing id, then shown to flip.
    await seedDefinition('org');
    const t = await tokenFor('rootB');
    const closed = await setGlobal(t, DEF_ID, true);
    const missing = await setGlobal(t, MISSING_ID, true);
    expect(closed.status).toBe(404);
    expect(await closed.text()).toBe(await missing.text());
    expect((await storedDoc(DEF_ID))?.visibility).toBe('org');

    // The submission - the tenant's own act - is what opens this door onto their row.
    await submit(await tokenFor('ownerA'), DEF_ID, 'ready');
    expect((await setGlobal(await tokenFor('rootB'), DEF_ID, true)).status).toBe(200);
  });

  it('a promotion through THIS door writes the snapshot, and org B reads the SCRUBBED artifact', async () => {
    // THE DEFECT: this door called `setVisibility(..., "global")`, so the row reached the cross-org
    // tier with NO snapshot and `publishedViewOf` served every other org the author's LIVE row
    // through the read-time floor - the state `publishSnapshot`'s single CAS write exists to make
    // impossible. It now calls `publishDefinition`, the same function `POST …/publish` calls.
    await seedDefinition('org', { lessons: `nota interna, chave ${PLANTED_SECRET}` });
    await submit(await tokenFor('ownerA'), DEF_ID, 'ready');

    const res = await setGlobal(await tokenFor('rootA'), DEF_ID, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, visibility: 'global' });

    const doc = (await storedDoc(DEF_ID))!;
    expect(doc.visibility).toBe('global');
    // THE ASSERTION THE OLD DOOR COULD NOT PASS. Every field of it: a tier without an artifact is
    // exactly what this fix removes.
    expect(doc.publishedSnapshot, 'the global tier and the frozen artifact land together').toBeTruthy();
    expect(doc.publishedSnapshot!.scrubbedBy).toBe('rootA');
    expect(doc.publishedSnapshot!.scrubVersion).toBeTruthy();
    expect(doc.publishedSnapshot!.skillMd).toContain('[REDACTED]');
    // The author's live row is untouched - publishing freezes a copy.
    expect(doc.skillMd).toContain(PLANTED_SECRET);

    const seen = (await (await api('/api/v1/integrations', await tokenFor('userB'))).json()) as { items: Array<{ key: string }> };
    expect(seen.items.map((d) => d.key)).toContain(KEY);
    expect(JSON.stringify(seen)).not.toContain(PLANTED_SECRET);
  });

  it('a publication through this door is RECORDED, so the next reviewer is not told it is the first', async () => {
    // THE SECOND HALF OF THE DEFECT, and the one that outlives the promotion itself. The whole
    // provenance of a cross-org publication lives on `publishedSnapshot`: WHO approved it
    // (`scrubbedBy`), WHEN, under WHICH scrub (`scrubVersion`), and WHAT it replaced (`supersedes`).
    // A door that promotes without writing one leaves no record that the package was ever live in
    // every tenant - so `publishQueueEntry.republish`, which is exactly `publishedSnapshot !==
    // undefined`, tells the NEXT reviewer this is a first publication, and `publishSnapshot` stamps
    // no `supersedes` because it finds no prior. The reviewer is deciding without the one fact the
    // field exists to give them.
    await seedDefinition('org');
    const owner = await tokenFor('ownerA');
    const root = await tokenFor('rootA');
    await submit(owner, DEF_ID, 'v1');

    expect((await setGlobal(root, DEF_ID, true)).status).toBe(200);
    const firstStamp = (await storedDoc(DEF_ID))!.publishedSnapshot!.scrubbedAt;

    // Un-publish, revise, ask again - the one sequence that puts an already-published row back in
    // the queue (the `republish` case above establishes it).
    expect((await setGlobal(root, DEF_ID, false)).status).toBe(200);
    await submit(owner, DEF_ID, 'v2, please re-review');

    const again = await expectSchema<{ items: Array<{ republish: boolean }> }>(await queue(root), IntegrationPublishQueueResponse);
    expect(again.items).toHaveLength(1);
    expect(again.items[0]!.republish, 'the reviewer must be told this REPLACES something').toBe(true);

    // And the lineage survives the second approval, whichever door performs it.
    const receipt = await expectSchema<PublishDefinitionResponse>(await publish(root, DEF_ID), PublishDefinitionResponse);
    expect(receipt.supersedes?.scrubbedAt).toBe(firstStamp);
    expect(receipt.supersedes?.scrubbedBy).toBe('rootA');
  });

  it('the DEMOTION still lands on `org`, writes no new artifact, and keeps the reviewed one', async () => {
    // `{global:false}` is why this route still exists at all: the publish door has no un-publish.
    // It writes no snapshot because it creates no cross-org reader, and it deliberately leaves the
    // existing one in place so the transition stays exactly reversible.
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID, 'ready');
    const root = await tokenFor('rootA');
    expect((await setGlobal(root, DEF_ID, true)).status).toBe(200);
    const stamp = (await storedDoc(DEF_ID))!.publishedSnapshot!.scrubbedAt;

    const down = await setGlobal(root, DEF_ID, false);
    expect(down.status).toBe(200);
    expect(await down.json()).toEqual({ ok: true, visibility: 'org' });
    const after = (await storedDoc(DEF_ID))!;
    // `org`, never `private`: demoting to `private` would additionally revoke the author's own org.
    expect(after.visibility).toBe('org');
    expect(after.publishedSnapshot!.scrubbedAt).toBe(stamp);

    // And it is off the cross-org surface again.
    const seen = (await (await api('/api/v1/integrations', await tokenFor('userB'))).json()) as { items: Array<{ key: string }> };
    expect(seen.items.map((d) => d.key)).not.toContain(KEY);
  });

  it('a SECOND `{global:true}` is a NO-OP, not a silent unreviewed re-publish of the live row', async () => {
    // THE COST OF THE FOLD, and the thing its own contract never said (S6 review round four,
    // MINOR-1). `visibilityWriteVerdict` permits `global -> global` deliberately - E2 narrowed the
    // launch-pad rule to `=== 'private'` so a published artifact can be refreshed at all - so once
    // `{global:true}` became `publishDefinition`, a REPEAT of it stopped being the no-op it had
    // always been and became a full supersede: re-scrub the author's CURRENT live row, replace the
    // reviewed artifact in every consuming org, stamp `supersedes`, with no preview in the loop. The
    // trigger is not exotic - it is a retry after a timeout, or a reviewer re-asserting a tier they
    // believe is already set. This door answers `{ok, visibility}` and reads as a toggle, so it must
    // behave like one.
    await seedDefinition('org');
    const owner = await tokenFor('ownerA');
    const root = await tokenFor('rootA');
    await submit(owner, DEF_ID, 'ready');
    expect((await setGlobal(root, DEF_ID, true)).status).toBe(200);

    const reviewed = (await storedDoc(DEF_ID))!.publishedSnapshot!;
    expect(reviewed.supersedes, 'the control: a FIRST publication supersedes nothing').toBeUndefined();

    // THE AUTHOR MOVES ON, through the writer production uses for an edit: `saveAuthoredDefinition`
    // saves with `create(..., onConflict:'replace')`, which carries `publishedSnapshot` forward
    // untouched. Without a content change the two snapshots could differ only by a `scrubbedAt` clock
    // tick, and a re-publish inside the same millisecond would read as a no-op.
    const AFTER_REVIEW = 'ADDED AFTER THE REVIEW, never seen by a reviewer';
    await integrationDefinitionStore.create(
      {
        orgId: 'orgA', userId: 'ownerA', visibility: 'global', key: KEY,
        displayName: 'S6 Publish Probe', description: 'A probe package.',
        configSchema: [], actions: [], skillMd: `# probe\n\n${AFTER_REVIEW}\n`,
      },
      { actor: { userId: 'rootA', orgId: 'orgA', role: 'super-admin' }, onConflict: 'replace' },
    );
    expect((await storedDoc(DEF_ID))!.skillMd, 'the live row really did change').toContain(AFTER_REVIEW);

    // THE RETRY.
    const again = await setGlobal(root, DEF_ID, true);
    expect(again.status, 'a retry is not a refusal either - the tier is what it asked for').toBe(200);
    expect(await again.json()).toEqual({ ok: true, visibility: 'global' });

    const after = (await storedDoc(DEF_ID))!;
    expect(after.visibility).toBe('global');
    // BYTE-FOR-BYTE, not "it still has a snapshot": a re-scrub would leave one of those too.
    expect(after.publishedSnapshot, 'the reviewed artifact is untouched').toEqual(reviewed);
    expect(JSON.stringify(after.publishedSnapshot), 'nothing written after the review crossed').not.toContain(AFTER_REVIEW);

    // AND THE NON-VACUITY HALF: the publish door, asked for the same row in the same state, DOES
    // supersede. So the assertions above pin idempotence on THIS door rather than an inability to
    // re-publish at all - which would be a different defect, and the one E2 removed on purpose.
    const receipt = await expectSchema<PublishDefinitionResponse>(await publish(root, DEF_ID), PublishDefinitionResponse);
    expect(receipt.supersedes?.scrubbedAt, 'the publish door still replaces the artifact').toBe(reviewed.scrubbedAt);
    expect((await storedDoc(DEF_ID))!.publishedSnapshot!.skillMd).toContain(AFTER_REVIEW);
  });

  it('THE INVARIANT, over the three MOUNTED doors: no ROUTE reaches the global tier without an artifact', async () => {
    // SCOPED IN THE TITLE, because the scope is the honest part (S6 review round four). This walks
    // the three mounted HTTP routes that can write `visibility`, and nothing else. It is NOT the
    // claim "nothing reaches the global tier without an artifact": `legacy-runtime-import.ts` writes
    // rows directly, and so does any in-process `IntegrationDefinitionStore.create({visibility:
    // 'global'})` - neither is on a route this loop can call, and both are recorded in
    // docs/findings.md. What makes those safe rather than correct is the READ-PATH fail-safe: a
    // `global` row with no snapshot is served through the deterministic floor, never raw.
    //
    // Stated once over every mounted route, so a door added later is caught by this rather than by
    // someone remembering. The tenant visibility route is included precisely because its schema is
    // supposed to make `global` unsayable.
    const root = await tokenFor('rootA');
    const owner = await tokenFor('ownerA');
    const promote: Array<[string, () => Promise<Response>]> = [
      ['publish', async () => publish(root, DEF_ID)],
      ['global', async () => setGlobal(root, DEF_ID, true)],
      ['visibility', async () => api(`/api/v1/integrations/definitions/${DEF_ID}/visibility`, owner, {
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'global' }),
      })],
    ];
    for (const [name, call] of promote) {
      await integrationDefinitions.deleteMany({});
      await seedDefinition('org');
      await submit(owner, DEF_ID, 'ready');
      await call();
      const doc = (await storedDoc(DEF_ID))!;
      if (doc.visibility === 'global') {
        expect(doc.publishedSnapshot, `${name} promoted without writing an artifact`).toBeTruthy();
      }
      // Non-vacuity: at least one door in this loop must actually reach `global`, or the `if` above
      // makes the whole case true by never running.
      if (name !== 'visibility') expect(doc.visibility, `${name} must reach the global tier`).toBe('global');
      else expect(doc.visibility, 'the tenant route must not be able to say `global` at all').toBe('org');
    }
  });

  it('the door adds no authority: the same refusals as the publish, from the same gate', async () => {
    // Both doors land on `visibilityWriteVerdict(row, actor, "global")` - literally the same call -
    // so folding one into the other must not have moved any bar. Asserted pairwise rather than
    // restated, so a change to either mapping shows up as a disagreement rather than as two
    // independently-drifting lists of expected statuses.
    await seedDefinition('org');
    await submit(await tokenFor('ownerA'), DEF_ID, 'ready');
    for (const who of ['ownerA', 'adminA', 'peerA', 'userB']) {
      const t = await tokenFor(who);
      const viaGlobal = await setGlobal(t, DEF_ID, true);
      const viaPublish = await publish(t, DEF_ID);
      expect(viaGlobal.status, `${who} must meet the same bar at both doors`).toBe(viaPublish.status);
      expect((await storedDoc(DEF_ID))!.visibility, `${who} must not have published`).toBe('org');
    }
    // A PRIVATE row is refused at both, for the launch-pad rule rather than the role.
    await integrationDefinitions.deleteMany({});
    await seedDefinition('private');
    expect((await setGlobal(await tokenFor('rootA'), DEF_ID, true)).status)
      .toBe((await publish(await tokenFor('rootA'), DEF_ID)).status);
    expect((await storedDoc(DEF_ID))!.visibility).toBe('private');
  });

  it('BOTH doors keep their OWN `requireRole`, told apart from the store gate by WHEN it answers', async () => {
    // THE TWO-LAYER TRAP, stated for this pair the way round two stated it for the publish door
    // alone. `requireRole('super-admin')` on the route and `visibilityWriteVerdict`'s super-admin
    // term in the store both refuse the same principals, so for a row the caller can SEE they answer
    // the same 403 and either could be deleted with a role-loop still green.
    //
    // WHAT SEPARATES THEM IS WHEN. `requireRole` is middleware: it refuses BEFORE the handler runs,
    // and therefore before any row is read - so it answers 403 even for an id that names NOTHING,
    // where the store, once reached, must answer the no-existence-oracle 404. A non-super-admin
    // against a missing id is the one probe only the route gate can satisfy, and it is asserted for
    // each door separately because each mounts its own copy.
    expect(await storedDoc(MISSING_ID), 'the id must really name nothing').toBeNull();
    for (const who of ['ownerA', 'adminA', 'peerA', 'userB']) {
      const t = await tokenFor(who);
      await expectEnvelope(await setGlobal(t, MISSING_ID, true), 403, 'FORBIDDEN');
      await expectEnvelope(await setGlobal(t, MISSING_ID, false), 403, 'FORBIDDEN');
      await expectEnvelope(await publish(t, MISSING_ID), 403, 'FORBIDDEN');
    }
    // THE CONTROL that makes those 403s the ROLE gate and not a blanket refusal: a super-admin
    // passes the middleware and is answered by the store, which reports the missing row as a 404.
    const root = await tokenFor('rootA');
    expect((await setGlobal(root, MISSING_ID, true)).status).toBe(404);
    expect((await publish(root, MISSING_ID)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Mounting: closed by default, and declared as mounted
// ---------------------------------------------------------------------------------------------

describe('S6 - the five doors are mounted, closed by default, and declared', () => {
  it('every one answers 401 UNAUTHENTICATED without a credential (mounted, not missing)', async () => {
    await seedDefinition('org');
    for (const call of [
      () => submit(null, DEF_ID),
      () => withdraw(null, DEF_ID),
      () => queue(null),
      () => preview(null, DEF_ID),
      () => publish(null, DEF_ID),
    ]) {
      // A 404 NOT_FOUND here would mean the terminal handler answered - i.e. no router claimed the
      // path, which is exactly the state this whole slice exists to leave behind.
      await expectEnvelope(await call(), 401, 'UNAUTHENTICATED');
    }
  });

  it('the descriptors declare what the routes enforce, and NONE of the five is key-reachable', () => {
    const family = ['requestPublish', 'withdrawPublish', 'listPublishRequests', 'previewPublish', 'publishDefinition'] as const;
    for (const name of family) {
      // `user-or-key` on any of these would put a cross-org publication (or the free text arguing
      // for one) inside an agent's reach - the `setGlobal` precedent, restated as an assertion.
      expect(integrationsEndpoints[name].auth, `${name} must never be key-reachable`).not.toBe('user-or-key');
    }
    expect(integrationsEndpoints.requestPublish.auth).toBe('user');
    expect(integrationsEndpoints.withdrawPublish.auth).toBe('user');
    expect(integrationsEndpoints.previewPublish.auth).toBe('user');
    expect(integrationsEndpoints.listPublishRequests.auth).toBe('super-admin');
    expect(integrationsEndpoints.publishDefinition.auth).toBe('super-admin');
  });
});
