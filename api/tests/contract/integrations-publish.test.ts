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
