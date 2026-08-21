import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
  type IntegrationDefinitionCreate,
  type IntegrationDefinitionDoc,
} from '../../src/integrations/definition-store.js';
import { publishDefinition, previewPublish } from '../../src/integrations/publish-scrub.js';
import {
  resolveDefinition,
  listDefinitionsFor,
  activeCatalogFor,
  resolveSkillMd,
  resolveSkillMdRaw,
} from '../../src/integrations/definition-registry.js';

/**
 * PUBLISHED-SNAPSHOT CREDENTIAL-CONTAINMENT suite (slice E2) — a memvault-class security net for the
 * one artifact in this system that is BOTH permanent AND cross-org.
 *
 * The threat is ordinary rather than exotic: an author pastes a real credential into their own
 * integration package while building it — into a header, a query string, a body template, an
 * automation argument, the SKILL.md they are writing, the lessons they accumulate — and the platform
 * then publishes that package to every other organisation. Once published it is read by tenants who
 * were never party to the mistake, and it is read for as long as the definition exists.
 *
 * The fixture is therefore ONE definition stuffed with a DISTINCT sentinel in every field shape the
 * document can carry, so a containment failure names the exact shape that leaked:
 *
 *   S_CONFIG_HELP   free text in a configSchema field's helpText
 *   S_HEADER        a credential-NAMED header value  (what `redactSecrets` already covers)
 *   S_QUERY         a NON-credential-named query parameter  (what it does not)
 *   S_BODY_NESTED   a nested object inside a bodyTemplate
 *   S_BODY_ARRAY    an element of an array inside a bodyTemplate
 *   S_ARGMAP        an automation binding's argMap value  (the action "template" shape)
 *   S_WEBHOOK       a nested webhookConfig block
 *   S_SESSION       a sessionConnect field
 *   S_SKILL_LINE    a credential-named assignment in the SKILL.md body
 *   S_SKILL_LOOSE   a pasted key in SKILL.md sitting near NOTHING that names a credential
 *   S_SKILL_TEMPLATE the SHORT literal beside a placeholder — the A3 re-review LOW-1 residual
 *   S_LESSONS       a pasted key in the lessons body
 *   S_GUIDE         a pasted key in the credential guide
 *   S_DESCRIPTION   a pasted key in the package description
 *
 * THE MODEL PASS IS DISABLED THROUGHOUT (`modelPass: null`). That is the point of the suite: the
 * guarantee has to come from the DETERMINISTIC FLOOR, which cannot be unavailable, wrong or
 * adversarial. If any assertion here needed the model to pass, the model would be the control.
 *
 * Non-tautology is enforced in both directions: every containment assertion is paired with a control
 * proving the sentinel really IS in the live row and really IS readable by the author. A suite that
 * passes because the fixture was empty proves nothing, and this one fails loudly if it becomes so.
 *
 * Sentinels are COMPOSED at runtime, never literals — the gitleaks gate must keep firing on real
 * pasted keys, so the fixtures must not themselves look like real pasted keys.
 */
const compose = (...parts: string[]): string => parts.join('');

const S_CONFIG_HELP = compose('sk_', 'live_', 'CONFIGHELPaaaaAAAA1111');
const S_HEADER = compose('sk_', 'live_', 'HEADERbbbbBBBB2222');
const S_QUERY = compose('ghp_', 'QUERYccccCCCC3333dddDDD44445555');
const S_BODY_NESTED = compose('github_pat_', 'BODYNESTEDeeeeEEEE5555ffffFFFF6666');
const S_BODY_ARRAY = compose('xoxb-', 'BODYARRAYgggg7777hhhh8888');
const S_ARGMAP = compose('AKIA', 'ARGMAPIIII9999JJJJ');
const S_WEBHOOK = compose('a1b2c3d4e5f6a7b8', 'c9d0e1f2a3b4c5d6'); // 32-hex digest
const S_SESSION = compose('AIza', 'SESSIONkkkk0000LLLL1111mmmm');
const S_SKILL_LINE = compose('sk_', 'test_', 'SKILLLINEnnnn2222OOOO');
const S_SKILL_LOOSE = compose('ya29.', 'SKILLLOOSEpppp3333QQQQ4444rrrr');
const S_SKILL_TEMPLATE = 'hunter2'; // short + low entropy: no SHAPE to catch, only position
const S_LESSONS = compose('ghs_', 'LESSONSssss5555TTTT6666uuuu7777');
const S_GUIDE = compose('eyJ', 'GUIDEvvvv8888.', 'eyJXXXX9999yyyy.', 'ZZZZ0000aaaa');
const S_DESCRIPTION = compose('sk_', 'live_', 'DESCRIPTIONbbbb1111CCCC');

/** Every sentinel that must be absent from a published artifact. */
const ALL_SENTINELS = [
  S_CONFIG_HELP, S_HEADER, S_QUERY, S_BODY_NESTED, S_BODY_ARRAY, S_ARGMAP, S_WEBHOOK, S_SESSION,
  S_SKILL_LINE, S_SKILL_LOOSE, S_SKILL_TEMPLATE, S_LESSONS, S_GUIDE, S_DESCRIPTION,
];

const author: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const peer: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
const foreign: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };
const foreignAdmin: Actor = { userId: 'adminB', orgId: 'orgB', role: 'org-admin' };
const reviewer: Actor = { userId: 'root', orgId: 'orgPlatform', role: 'super-admin' };

const KEY = 'stuffed';
const ID = definitionIdFor('orgA', KEY);

let mem: MongoMemoryServer;
let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_800_000_000_000 + clock++));

/** ONE definition carrying a distinct sentinel in every field shape the document supports. */
const stuffed = (): IntegrationDefinitionCreate => ({
  orgId: 'orgA',
  userId: 'userA1',
  key: KEY,
  visibility: 'org',
  displayName: 'Stuffed integration',
  description: `Talks to the vendor. Test with ${S_DESCRIPTION}.`,
  credentialGuide: `Paste your key. The one we used while building was ${S_GUIDE} (rotate it).`,
  configSchema: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, helpText: `e.g. ${S_CONFIG_HELP}` },
  ],
  actions: [
    {
      actionName: 'send',
      description: 'Send a thing',
      mutates: true,
      httpConfig: {
        method: 'POST',
        baseUrl: 'https://vendor.example',
        path: '/v1/send',
        // A pasted literal (no placeholder -> the whole value goes) beside a genuine TEMPLATE
        // header (which must survive, or the published integration authenticates with the literal
        // string `[REDACTED]`).
        headers: { Authorization: `Bearer ${S_HEADER}`, 'x-api-key': '{{api_key}}', 'X-Trace': 'on' },
        queryParams: { locale: 'pt', trace_id: S_QUERY },
        bodyTemplate: {
          payload: { auth: { inner: S_BODY_NESTED }, keep: 'ordinary value' },
          recipients: ['someone@example.com', S_BODY_ARRAY],
        },
      },
    },
    {
      actionName: 'browse',
      description: 'Drive the portal',
      mutates: false,
      automationBinding: { automationId: 'vendor-login', argMap: { user: '{{username}}', pass: S_ARGMAP } },
    },
  ],
  webhookConfig: { verifySignature: { headerName: 'X-Sig', sharedSecret: { value: S_WEBHOOK } } },
  sessionConnect: { loginUrl: 'https://vendor.example/login', successUrlContains: '/home', guidePt: `Use ${S_SESSION} se pedir` },
  skillMd: [
    `# ${KEY}`,
    '',
    '## Setup',
    `api_key: ${S_SKILL_LINE}`,
    `Authorization: Bearer {{access_token}} ${S_SKILL_TEMPLATE}`,
    '',
    'Then run the sync. A raw sample response:',
    '```',
    `{"cursor": "${S_SKILL_LOOSE}"}`,
    '```',
    '',
    'The token field name is documented by the vendor and explains everything.',
  ].join('\n'),
  lessons: `2026-07: the sandbox rejected us until we swapped the key for ${S_LESSONS}. Do not repeat.`,
});

const jsonOf = (v: unknown): string => JSON.stringify(v ?? null);

/** Every sentinel absent from `blob`, each named individually so a failure says WHICH shape leaked. */
function expectNoSentinels(blob: string, where: string): void {
  for (const [i, s] of ALL_SENTINELS.entries()) {
    expect(blob.includes(s), `${where}: sentinel #${i} leaked`).toBe(false);
  }
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-pubsec-'));
  mkdirSync(join(tmp, 'baseline'), { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = join(tmp, 'baseline');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_pubsec');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.EKOA_INTEGRATIONS_DIR = savedEnv.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await integrationDefinitions.deleteMany({});
  clock = 0;
  await store.create(stuffed(), { actor: author });
});

/** Publish through the real flow (author submits, platform reviewer publishes), FLOOR ONLY. */
async function publishStuffed(): Promise<IntegrationDefinitionDoc> {
  expect((await store.requestPublish(ID, author)).verdict).toBe('ok');
  const res = await publishDefinition(reviewer, ID, { modelPass: null }, store, () => new Date(1_900_000_000_000));
  expect(res.verdict, jsonOf(res)).toBe('ok');
  return (res as { doc: IntegrationDefinitionDoc }).doc;
}

describe('the fixture is real: every sentinel IS in the stored row (non-vacuity floor)', () => {
  it('the live document carries all 14 shapes, and the author can read them back', async () => {
    const live = await store.getById(ID);
    const blob = jsonOf(live);
    for (const [i, s] of ALL_SENTINELS.entries()) {
      expect(blob.includes(s), `sentinel #${i} missing from the fixture — this suite would prove nothing`).toBe(true);
    }
    // The AUTHOR's own byte-exact editable view still returns their text (A3 review F3): the scrub
    // this suite is about is a PUBLICATION boundary, not a new floor on the author's own row.
    expect(await resolveSkillMdRaw(author, KEY, store)).toContain(S_SKILL_LINE);
  });
});

describe('a published snapshot carries no credential material, in any field shape', () => {
  it('the stored snapshot is clean — with the model pass DISABLED, so the FLOOR alone carries it', async () => {
    const doc = await publishStuffed();
    const snap = doc.publishedSnapshot!;
    expect(snap.modelPass).toEqual({ status: 'skipped', reason: 'caller requested floor only' });
    expectNoSentinels(jsonOf(snap), 'publishedSnapshot');
    // …and it is still a USABLE artifact: the template header, the ordinary values and the action
    // set all survive. A scrub that empties the package is not a passing result.
    const sent = snap.config.actions?.find((a) => a.actionName === 'send');
    // A credential-named value with NO placeholder names no field — it IS the credential, so the
    // whole value goes, scheme word included.
    expect(sent?.httpConfig?.headers?.Authorization).toBe('[REDACTED]');
    // …while a genuine template header survives untouched, which is what keeps the published
    // integration able to authenticate at all.
    expect(sent?.httpConfig?.headers?.['x-api-key']).toBe('{{api_key}}');
    expect(sent?.httpConfig?.headers?.['X-Trace']).toBe('on');
    expect(sent?.httpConfig?.queryParams?.locale).toBe('pt');
    expect(jsonOf(sent?.httpConfig?.bodyTemplate)).toContain('ordinary value');
    expect(snap.config.actions).toHaveLength(2);
    expect(snap.skillMd).toContain('Then run the sync.');
    expect(snap.skillMd).toContain('{{access_token}}'); // the placeholder beside the literal survives
  });

  it('NOTHING reaches another organisation, through ANY definition read surface', async () => {
    await publishStuffed();
    for (const actor of [foreign, foreignAdmin]) {
      expectNoSentinels(jsonOf(await resolveDefinition(actor, KEY, store)), `resolveDefinition/${actor.userId}`);
      expectNoSentinels(jsonOf(await listDefinitionsFor(actor, store)), `listDefinitionsFor/${actor.userId}`);
      expectNoSentinels(jsonOf(await activeCatalogFor(actor, store)), `activeCatalogFor/${actor.userId}`);
      expectNoSentinels(await resolveSkillMd(actor, KEY, store) ?? '', `resolveSkillMd/${actor.userId}`);
      expectNoSentinels(await resolveSkillMdRaw(actor, KEY, store) ?? '', `resolveSkillMdRaw/${actor.userId}`);
    }
    // Non-vacuous: the foreign org really IS resolving the definition (a null would pass every
    // assertion above for entirely the wrong reason).
    expect((await resolveDefinition(foreign, KEY, store))?.key).toBe(KEY);
    expect(await resolveSkillMd(foreign, KEY, store)).toContain('Then run the sync.');
  });

  it('the EGRESS-bearing fields a consumer inherits are clean: no baseUrl, header or argMap secret', async () => {
    await publishStuffed();
    const def = (await resolveDefinition(foreign, KEY, store))!;
    const send = def.actions.find((a) => a.actionName === 'send')!;
    const browse = def.actions.find((a) => a.actionName === 'browse')!;
    expect(send.httpConfig!.baseUrl).toBe('https://vendor.example');
    expect(jsonOf(send.httpConfig!.headers)).not.toContain(S_HEADER);
    expect(jsonOf(send.httpConfig!.queryParams)).not.toContain(S_QUERY);
    expect(jsonOf(browse.automationBinding)).not.toContain(S_ARGMAP);
    expect(browse.automationBinding!.argMap!.user).toBe('{{username}}'); // the template still works
  });

  it('the DRY RUN shows the author the same clean artifact, before anything is published', async () => {
    const preview = await previewPublish(author, ID, { modelPass: null }, store) as { verdict: 'ok'; snapshot: unknown };
    expect(preview.verdict).toBe('ok');
    expectNoSentinels(jsonOf(preview.snapshot), 'preview.snapshot');
    // Nothing was published by looking: the foreign org still cannot see the row at all.
    expect(await resolveDefinition(foreign, KEY, store)).toBeNull();
    expect((await store.getById(ID))?.publishedSnapshot).toBeUndefined();
  });

  it('the preview REPORT is not a second surface that echoes credential material', async () => {
    const preview = await previewPublish(author, ID, { modelPass: null }, store) as { verdict: 'ok'; redactions: unknown };
    expectNoSentinels(jsonOf(preview.redactions), 'preview.redactions');
    expect((preview.redactions as unknown[]).length).toBeGreaterThanOrEqual(8);
  });
});

describe('the containment holds when the model is not there at all', () => {
  it('a THROWING model pass publishes the floor result — clean, and honest about the degradation', async () => {
    expect((await store.requestPublish(ID, author)).verdict).toBe('ok');
    const res = await publishDefinition(
      reviewer,
      ID,
      { modelPass: async () => { throw new Error('provider unreachable'); } },
      store,
      () => new Date(1_900_000_000_000),
    );
    expect(res.verdict).toBe('ok');
    const snap = (res as { doc: IntegrationDefinitionDoc }).doc.publishedSnapshot!;
    expect(snap.modelPass.status).toBe('failed');
    expectNoSentinels(jsonOf(snap), 'snapshot after a failed model pass');
    expectNoSentinels(jsonOf(await resolveDefinition(foreign, KEY, store)), 'cross-org read after a failed model pass');
  });
});

describe('the cross-org floor also covers a GLOBAL row that was never published through the scrub', () => {
  it('a row promoted straight through the visibility route is still floor-scrubbed for other orgs', async () => {
    // The legacy-runtime import and a bare E1 `POST /global` both produce this shape: `global`, with
    // no `publishedSnapshot`. It must not be a hole that serves live content cross-org.
    const inOrgAdmin: Actor = { userId: 'root2', orgId: 'orgA', role: 'super-admin' };
    expect((await store.setVisibility(ID, inOrgAdmin, 'global')).verdict).toBe('ok');
    const row = await store.getById(ID);
    expect(row?.visibility).toBe('global');
    expect(row?.publishedSnapshot).toBeUndefined(); // the shape under test really is snapshot-less

    expectNoSentinels(jsonOf(await resolveDefinition(foreign, KEY, store)), 'unpublished global / resolveDefinition');
    expectNoSentinels(await resolveSkillMd(foreign, KEY, store) ?? '', 'unpublished global / resolveSkillMd');
    expectNoSentinels(await resolveSkillMdRaw(foreign, KEY, store) ?? '', 'unpublished global / resolveSkillMdRaw');
    expect((await resolveDefinition(foreign, KEY, store))?.key).toBe(KEY); // non-vacuous
  });
});

describe('the review window is opened by the AUTHOR and by nothing else', () => {
  it('a non-member platform reviewer sees nothing until the org submits, and nothing after it withdraws', async () => {
    // Before: the reviewer cannot read, preview or publish the row — the same `notfound` a missing
    // row answers, so they cannot even probe for a tenant`s package.
    expect(await store.getForActor(reviewer, KEY)).toBeNull();
    expect((await previewPublish(reviewer, ID, { modelPass: null }, store)).verdict).toBe('notfound');
    expect(await publishDefinition(reviewer, ID, { modelPass: null }, store)).toEqual({ verdict: 'notfound' });
    expect(await store.listPublishRequests(reviewer)).toEqual([]);

    // The AUTHOR opens the window.
    expect((await store.requestPublish(ID, author)).verdict).toBe('ok');
    expect((await store.listPublishRequests(reviewer)).map((d) => d._id)).toEqual([ID]);
    expect((await previewPublish(reviewer, ID, { modelPass: null }, store)).verdict).toBe('ok');

    // …and closes it again.
    expect((await store.withdrawPublishRequest(ID, author)).verdict).toBe('ok');
    expect(await store.getForActor(reviewer, KEY)).toBeNull();
    expect(await store.listPublishRequests(reviewer)).toEqual([]);
    expect(await publishDefinition(reviewer, ID, { modelPass: null }, store)).toEqual({ verdict: 'notfound' });
  });

  it('the window is NOT a general read exception: a private row is never submittable and never visible', async () => {
    expect((await store.setVisibility(ID, author, 'private')).verdict).toBe('ok');
    expect((await store.requestPublish(ID, author)).verdict).toBe('forbidden');
    expect(await store.getForActor(reviewer, KEY)).toBeNull();
    expect(await store.listPublishRequests(reviewer)).toEqual([]);
  });

  it('a submitted row cannot be taken PRIVATE by the platform, and the publication SPENDS the window', async () => {
    // THE SECOND HALF IS NEW AND IT REPLACES THE OPPOSITE CLAIM (S6 review round five). This case
    // used to assert that the request SURVIVES a publication - "the org's own record that it asked" -
    // and that the reviewer could therefore publish again straight after un-publishing. That was the
    // defect stated as a property: `publishRequest` is not a record, it is the thing that OPENS the
    // review window to a non-member super-admin (`isDefinitionVisibleTo`), and leaving it standing
    // meant an un-publish silently handed the row back to every platform reviewer on a consent the
    // tenant gave for a publication that had already happened.
    expect((await store.requestPublish(ID, author)).verdict).toBe('ok');
    expect((await publishDefinition(reviewer, ID, { modelPass: null }, store)).verdict).toBe('ok');

    // THE TRAPDOOR REFUSAL, ASSERTED WHILE THE ROW IS STILL `global` - which is where it means
    // something. A super-admin can see every global row, so this `forbidden` is unambiguously the
    // WRITE being refused rather than the row being invisible. (Below, once the window shuts, the
    // same call answers the uniform `notfound`, and that would prove a different thing.)
    expect((await store.setVisibility(ID, reviewer, 'private')).verdict).toBe('forbidden');
    expect((await store.getById(ID))?.visibility).toBe('global');

    // The reviewer may un-publish, and it lands on `org`.
    expect((await store.setVisibility(ID, reviewer, 'org')).verdict).toBe('ok');
    expect((await store.getById(ID))?.visibility).toBe('org');

    // AND THE WINDOW IS SHUT. The reviewer is not merely refused the withdraw now - they cannot SEE
    // the row at all, which is strictly stronger and is the same uniform `notfound` a row that does
    // not exist answers. Read off the document first, so the verdicts below are the window being
    // closed rather than three separate refusals that happen to agree.
    expect((await store.getById(ID))?.publishRequest, 'the publication spent it').toBeUndefined();
    expect(await store.getForActor(reviewer, KEY)).toBeNull();
    expect(await store.listPublishRequests(reviewer)).toEqual([]);
    expect((await store.withdrawPublishRequest(ID, reviewer)).verdict).toBe('notfound');
    expect(await publishDefinition(reviewer, ID, { modelPass: null }, store)).toEqual({ verdict: 'notfound' });

    // AND THE TRANSITION IS STILL REVERSIBLE - it just costs the tenant's consent again, which is the
    // whole point. Without this the assertions above would also pass if publishing had simply broken.
    expect((await store.requestPublish(ID, author)).verdict).toBe('ok');
    expect((await publishDefinition(reviewer, ID, { modelPass: null }, store)).verdict).toBe('ok');
  });

  it('a plain peer can neither submit nor withdraw their colleague`s definition', async () => {
    expect((await store.requestPublish(ID, peer)).verdict).toBe('forbidden');
    expect((await store.requestPublish(ID, foreign)).verdict).toBe('notfound');
    expect((await store.requestPublish(ID, author)).verdict).toBe('ok');
    expect((await store.withdrawPublishRequest(ID, peer)).verdict).toBe('forbidden');
    expect((await store.getById(ID))?.publishRequest).toBeDefined();
  });
});

describe('a content write cannot silently un-scrub a published row', () => {
  it('replacing the package keeps the frozen snapshot, so other orgs keep reading the reviewed one', async () => {
    await publishStuffed();
    // A direct content replace (the one door that can still rewrite a published row) re-introduces
    // every sentinel into the LIVE document…
    await store.create(
      { ...stuffed(), visibility: 'global', displayName: 'REPLACED' },
      { actor: reviewer, onConflict: 'replace' },
    );
    expect(jsonOf(await store.getById(ID))).toContain(S_HEADER);
    // …and the other org still reads the frozen, scrubbed artifact.
    const row = await store.getById(ID);
    expect(row?.publishedSnapshot).toBeDefined();
    expectNoSentinels(jsonOf(await resolveDefinition(foreign, KEY, store)), 'after a live replace');
    expect((await resolveDefinition(foreign, KEY, store))?.displayName).toBe('Stuffed integration');
  });
});
