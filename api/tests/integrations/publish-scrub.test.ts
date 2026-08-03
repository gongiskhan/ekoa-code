import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions, redactSecrets, scrubSecretText } from '../../src/integrations/definitions.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
  type IntegrationDefinitionCreate,
  type IntegrationDefinitionDoc,
  type DefinitionVisibility,
} from '../../src/integrations/definition-store.js';
import {
  applyPublishFloor,
  scrubForPublish,
  scrubPublishText,
  previewPublish,
  publishDefinition,
  publishableContentOf,
  type PublishModelPass,
  type PublishModelPassInput,
} from '../../src/integrations/publish-scrub.js';
import {
  resolveDefinition,
  resolveSkillMd,
  resolveSkillMdRaw,
} from '../../src/integrations/definition-registry.js';

/**
 * PUBLISH SCRUB (slice E2) — the deterministic floor, the ONE chokepoint model pass, and the FROZEN
 * snapshot other orgs read.
 *
 * The suite is built around three claims that must be MEASURED, not asserted:
 *   1. the publish floor is STRICTER than the read-path scrub — every case that pins a publish-time
 *      redaction also pins that `redactSecrets`/`scrubSecretText` let the same input through, so
 *      "stricter" is a difference the test can see rather than a docblock;
 *   2. the floor is STRICTER without being LOOSER on the wire — the shipped-package identity
 *      property (the A3 review F4 ratchet) is re-run against the publish floor, so a tightening that
 *      would send `[REDACTED]` as a shipped integration's auth header fails here first;
 *   3. the model is a SECOND NET, never the control — every model-pass state (skipped, failed,
 *      hostile, absent) is driven, and each one is checked against the FLOOR-ONLY output.
 *
 * Credential-shaped sentinels are COMPOSED at runtime, never written as literals: the gitleaks gate
 * must keep firing on real pasted keys, so the fixtures must not themselves look like real ones.
 */
const secretish = (...parts: string[]): string => parts.join('');

const PASTED_STRIPE = secretish('sk_', 'live_', '51HxYzABCdefGHIjklMNOpqrs');
const PASTED_GITHUB = secretish('ghp_', '16C7e42F292c6912E7710c838347Ae178B4a');
const PASTED_HEX = secretish('a3f5c9d18b2e47a0', 'f6c1d8e93b25a7c4');
const SHORT_LITERAL = 'hunter2'; // the A3 re-review LOW-1 residual this slice exists to close

const authorA: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const adminA: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
const peerA: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
const readerB: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };
/** A platform reviewer who is NOT a member of the authoring org — the shape E1's review found the
 *  publish gate inert for, and the reason E2 carries the author-initiated submit state. */
const platform: Actor = { userId: 'root', orgId: 'orgPlatform', role: 'super-admin' };
/** A super-admin who IS a member of the authoring org — used where the point under test is the
 *  visibility TIER rule rather than the cross-org review window. */
const platformInA: Actor = { userId: 'rootA', orgId: 'orgA', role: 'super-admin' };

let mem: MongoMemoryServer;
let tmp: string;
const savedEnv: Record<string, string | undefined> = {};

let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_800_000_000_000 + clock++));
const publishClock = (): Date => new Date(1_900_000_000_000 + clock++);

const draft = (
  key: string,
  visibility: DefinitionVisibility,
  extra: Partial<IntegrationDefinitionCreate> = {},
): IntegrationDefinitionCreate => ({
  orgId: 'orgA',
  userId: 'userA1',
  key,
  visibility,
  displayName: `${key} (live)`,
  configSchema: [],
  actions: [{ actionName: 'ping', description: 'live ping', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://live.example', path: '/ping' } }],
  skillMd: `# ${key}\nLIVE BODY\n`,
  ...extra,
});

const create = (input: IntegrationDefinitionCreate): Promise<IntegrationDefinitionDoc> =>
  store.create(input, { actor: input.visibility === 'global' ? platformInA : authorA });

const idOf = (key: string): string => definitionIdFor('orgA', key);

/** The author asks the platform to publish — the ONLY thing that lets a non-member reviewer see the
 *  row at all (E1 review F2, carried to E2). Every publish below goes through this door. */
const submit = async (key: string): Promise<void> => {
  const res = await store.requestPublish(idOf(key), authorA);
  expect(res.verdict, `submit ${key}`).toBe('ok');
};

/** A model pass driven entirely by the test — the default chokepoint pass is never reached here. */
const spanPass = (spans: string[], seen?: PublishModelPassInput[]): PublishModelPass => async (input) => {
  seen?.push(input);
  return { spans };
};
const throwingPass = (message: string): PublishModelPass => async () => {
  throw new Error(message);
};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-pubscrub-'));
  mkdirSync(join(tmp, 'baseline'), { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = join(tmp, 'baseline');
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_pubscrub');
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
});

// ============================================================================================

describe('the strict credential-value grammar: every real auth scheme survives publication', () => {
  /**
   * The A3 RE-REVIEW HIGH-1 BREAK-LIST, re-pinned against the STRICTER floor. Each of these is a
   * real, tenant-authorable auth header. `action-executor.ts` sends this value on the wire, so one
   * `[REDACTED]` here does not "over-scrub" — it makes the published integration send the literal
   * string `[REDACTED]` as its credential. The publish floor is allowed to be stricter than the
   * egress scrub in exactly one direction, and this test is the fence on the other one.
   */
  const survives = [
    'Bearer {{access_token}}',
    '{{api_key}}',
    'Zoho-oauthtoken {{access_token}}',
    'AWS4-HMAC-SHA256 {{signature}}',
    'OAuth oauth_consumer_key="{{k}}"',
    'Signature keyId="{{k}}",algorithm="rsa-sha256"',
    'ApiKey-v1 {{api_key}}',
    'Bearer {{sig}}; charset=utf-8',
    'Basic {{user}}:{{pass}}',
    '{{token_type}} {{access_token}}',
  ];

  it.each(survives)('keeps %j byte-identical under a credential-named key', (value) => {
    const out = applyPublishFloor({ config: { integrationKey: 'k', actions: [], configSchema: [], webhookConfig: { headers: { Authorization: value } } as never }, skillMd: '' });
    expect((out.content.config.webhookConfig as unknown as { headers: Record<string, string> }).headers.Authorization).toBe(value);
    expect(out.redactions).toEqual([]);
  });
});

describe('the strict credential-value grammar: the short-literal residual A3 left open is CLOSED', () => {
  /**
   * THE RESIDUAL, quoted from `definitions.ts`: "a SHORT low-entropy literal beside a placeholder
   * still rides the exemption (`{{name}} hunter2`) … the defence in depth for it is E2's strict
   * publish-time scrub". Each case pins BOTH sides — the egress scrub still lets it through (so this
   * is genuinely defence in depth, not a duplicate) and the publish floor does not.
   */
  const bypasses = [
    `{{name}} ${SHORT_LITERAL}`,
    `Bearer {{x}} ${SHORT_LITERAL}`,
    `{{a}} ${SHORT_LITERAL} {{b}}`,
    `Bearer ${SHORT_LITERAL} {{x}}`,
  ];

  it.each(bypasses)('publish redacts %j while the EGRESS scrub still passes it', (value) => {
    // The egress scrub's known behaviour — the thing this slice is the defence in depth for.
    expect((redactSecrets({ authorization: value }) as Record<string, string>).authorization).toBe(value);
    // …and the publish floor's.
    const out = applyPublishFloor({ config: { integrationKey: 'k', actions: [], configSchema: [], webhookConfig: { headers: { authorization: value } } as never }, skillMd: '' });
    const scrubbed = (out.content.config.webhookConfig as unknown as { headers: Record<string, string> }).headers.authorization;
    expect(scrubbed).not.toContain(SHORT_LITERAL);
    expect(scrubbed).toContain('[REDACTED]');
    expect(out.redactions.length).toBeGreaterThan(0);
  });

  it('a credential-named value with NO placeholder is redacted whole (it names no field — it IS one)', () => {
    const out = applyPublishFloor({ config: { integrationKey: 'k', actions: [], configSchema: [], webhookConfig: { headers: { password: SHORT_LITERAL } } as never }, skillMd: '' });
    expect((out.content.config.webhookConfig as unknown as { headers: Record<string, string> }).headers.password).toBe('[REDACTED]');
    expect(out.redactions[0]).toMatchObject({ rule: 'credential-named-field', source: 'floor' });
  });

  it('a literal on the right of a CREDENTIAL-named parameter goes; an ordinary parameter literal stays', () => {
    const value = `Signature keyId="{{k}}",password="${SHORT_LITERAL}",algorithm="rsa-sha256"`;
    const out = applyPublishFloor({ config: { integrationKey: 'k', actions: [], configSchema: [], webhookConfig: { headers: { authorization: value } } as never }, skillMd: '' });
    const scrubbed = (out.content.config.webhookConfig as unknown as { headers: Record<string, string> }).headers.authorization;
    expect(scrubbed).not.toContain(SHORT_LITERAL);
    expect(scrubbed).toContain('algorithm="rsa-sha256"'); // the ordinary parameter is untouched
    expect(scrubbed).toContain('{{k}}');
  });
});

describe('the blanket literal-secret scan reaches keys `redactSecrets` never looks at', () => {
  it('redacts a pasted key under a NON-credential-named key, in a nested object and inside an array', () => {
    const config = {
      integrationKey: 'k',
      configSchema: [],
      actions: [
        {
          actionName: 'go',
          description: 'x',
          mutates: false,
          httpConfig: {
            method: 'POST' as const,
            baseUrl: 'https://live.example',
            path: '/go',
            queryParams: { q: PASTED_STRIPE },
            bodyTemplate: { outer: { inner: PASTED_GITHUB }, list: ['fine', PASTED_HEX] },
          },
        },
      ],
    };
    // The egress scrub is blind to all three: none of these keys names a credential.
    expect(JSON.stringify(redactSecrets(config))).toContain(PASTED_STRIPE);

    const out = applyPublishFloor({ config, skillMd: '' });
    const json = JSON.stringify(out.content.config);
    for (const s of [PASTED_STRIPE, PASTED_GITHUB, PASTED_HEX]) expect(json).not.toContain(s);
    expect(json).toContain('fine'); // the sibling array element is untouched
    expect(out.redactions.every((r) => r.source === 'floor')).toBe(true);
  });

  it('leaves URL paths and dotted identifiers alone (the shapes a blunt entropy rule shreds)', () => {
    const config = {
      integrationKey: 'k',
      configSchema: [],
      actions: [{ actionName: 'x', description: 'd', mutates: false, httpConfig: { method: 'GET' as const, baseUrl: 'https://www.googleapis.com/gmail/v1', path: '/gmail/v1/users/me/messages/batchModify' } }],
      webhookConfig: { events: [{ name: 'payment_intent.succeeded', labelPt: 'pago' }] },
    };
    expect(applyPublishFloor({ config, skillMd: '' }).content.config).toEqual(config);
  });
});

describe('every SHIPPED package survives the PUBLISH floor byte-identically (the A3 F4 ratchet, re-armed)', () => {
  /**
   * The property A3's review mandated for `redactSecrets`, restated for the strictly stricter floor.
   * These values are what the executor puts on the wire for a published integration, so an identity
   * failure here is not cosmetic: it is a shipped integration sending `[REDACTED]` as its credential.
   */
  it('applyPublishFloor is the identity over all api/assets/integrations/*/config.json', () => {
    const root = fileURLToPath(new URL('../../assets/integrations', import.meta.url));
    const keys = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(keys.length).toBeGreaterThanOrEqual(11);

    const credNameRe = /^(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|app[_-]?secret|password|passwd|credentials?|bearer[_-]?token|authorization|auth[_-]?token|api[_-]?token|token|x[_-]?api[_-]?key|signature)$/i;
    let credentialNamedValues = 0;
    let strings = 0;
    const count = (v: unknown): void => {
      if (Array.isArray(v)) { for (const x of v) count(x); return; }
      if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          if (credNameRe.test(k) && typeof x === 'string') credentialNamedValues++;
          count(x);
        }
        return;
      }
      if (typeof v === 'string') strings++;
    };

    for (const key of keys) {
      const cfg = JSON.parse(readFileSync(join(root, key, 'config.json'), 'utf8')) as Record<string, unknown>;
      count(cfg);
      const out = applyPublishFloor({ config: cfg as never, skillMd: '' });
      expect(out.content.config, key).toEqual(cfg);
      expect(out.redactions, key).toEqual([]);
    }
    // Non-vacuous in BOTH directions the floor can break: the credential-named template values (the
    // strict grammar) and the ordinary strings (the blanket scan) are both really there.
    expect(credentialNamedValues).toBeGreaterThanOrEqual(40);
    expect(strings).toBeGreaterThanOrEqual(200);
  });
});

describe('the free-text floor: stricter on values, still not a prose shredder', () => {
  it('redacts a lone credential value, keeps documentation and templates', () => {
    expect(scrubPublishText(`api_key: ${SHORT_LITERAL}`)).not.toContain(SHORT_LITERAL);
    expect(scrubSecretText(`api_key: ${SHORT_LITERAL}`)).toContain(SHORT_LITERAL); // the egress floor misses it
    expect(scrubPublishText(`api_key: {{name}} ${SHORT_LITERAL}`)).not.toContain(SHORT_LITERAL);

    // Prose that a tightening has already destroyed once (A3 re-review LOW-3) must survive.
    expect(scrubPublishText('token: documentation explains everything')).toBe('token: documentation explains everything');
    expect(scrubPublishText('Authorization: Bearer {{access_token}}')).toBe('Authorization: Bearer {{access_token}}');
    expect(scrubPublishText('password: not required')).toBe('password: not required');
    expect(scrubPublishText('Use Bearer {{token}} here.')).toBe('Use Bearer {{token}} here.');
  });

  it('redacts a pasted key that sits nowhere near a credential-named key or a scheme word', () => {
    const body = ['# Setup', '', '```', `curl -H "X-Custom: ${PASTED_GITHUB}" https://live.example`, '```', ''].join('\n');
    expect(scrubSecretText(body)).toContain(PASTED_GITHUB); // the egress floor is position-limited
    const out = scrubPublishText(body);
    expect(out).not.toContain(PASTED_GITHUB);
    expect(out).toContain('https://live.example');
  });
});

// ============================================================================================

describe('the floor is the control: the model pass is a second net that can only REMOVE', () => {
  const content = () => ({
    config: { integrationKey: 'k', configSchema: [], actions: [], description: `contact ops, the passphrase is ${SHORT_LITERAL} for now` },
    skillMd: `# k\nheaders: X-Token ${PASTED_STRIPE}\nkeep this prose\n`,
  });

  it('a model pass that THROWS leaves the FLOOR result exactly, records the failure, and still publishes', async () => {
    const floorOnly = applyPublishFloor(content());
    const res = await scrubForPublish(content(), { modelPass: throwingPass('provider unreachable') });
    expect(res.content).toEqual(floorOnly.content); // byte-identical to the deterministic floor
    expect(res.modelPass).toEqual({ status: 'failed', reason: 'provider unreachable' });
    expect(JSON.stringify(res.content)).not.toContain(PASTED_STRIPE); // never "unscrubbed because the model was down"
  });

  it('`modelPass: null` is an HONEST state, distinct from a failure, and identical output', async () => {
    const res = await scrubForPublish(content(), { modelPass: null });
    expect(res.modelPass.status).toBe('skipped');
    expect(res.content).toEqual(applyPublishFloor(content()).content);
  });

  it('the model sees the FLOOR-SCRUBBED text only — the raw pasted key never reaches the chokepoint', async () => {
    const seen: PublishModelPassInput[] = [];
    await scrubForPublish(content(), { modelPass: spanPass([], seen) });
    const sent = JSON.stringify(seen);
    expect(sent).not.toContain(PASTED_STRIPE);
    expect(sent).toContain('[REDACTED]');
  });

  it('the model can only REMOVE: invented text never lands, an absent span is dropped, a tiny span is refused', async () => {
    const hostile: PublishModelPass = async () => ({
      spans: ['keep this prose', 'A SPAN THAT IS NOT IN THE TEXT', 'is', ''],
    });
    const res = await scrubForPublish(content(), { modelPass: hostile });
    const json = JSON.stringify(res.content);
    expect(json).not.toContain('keep this prose'); // the one span that WAS present is applied
    expect(json).not.toContain('A SPAN THAT IS NOT IN THE TEXT'); // an unmatched span cannot inject
    expect(res.content.config.description).toContain('is'); // a <4-char span is refused, not applied
    expect(res.modelPass).toEqual({ status: 'applied', spansApplied: 1 });
  });

  it('a model pass that flags a free-text passphrase closes what the floor structurally cannot', async () => {
    const res = await scrubForPublish(content(), { modelPass: spanPass([SHORT_LITERAL]) });
    expect(res.content.config.description).not.toContain(SHORT_LITERAL);
    expect(res.redactions.some((r) => r.source === 'model' && r.rule === 'model-flagged')).toBe(true);
    // …and the FLOOR alone would not have (which is why the pass exists at all).
    expect(applyPublishFloor(content()).content.config.description).toContain(SHORT_LITERAL);
  });
});

// ============================================================================================

describe('preview and publish are ONE path', () => {
  it('the previewed snapshot is byte-identical to the one actually stored', async () => {
    await create(draft('shareable', 'org', { lessons: `learned: ${PASTED_HEX} was wrong`, skillMd: `api_key: ${SHORT_LITERAL}\n` }));
    await submit('shareable');
    const opts = { modelPass: spanPass(['was wrong']) };

    const preview = await previewPublish(authorA, idOf('shareable'), opts, store);
    expect(preview.verdict).toBe('ok');
    const published = await publishDefinition(platform, idOf('shareable'), opts, store, publishClock);
    expect(published.verdict).toBe('ok');

    const stored = (published as { doc: IntegrationDefinitionDoc }).doc.publishedSnapshot!;
    const shown = (preview as { snapshot: unknown }).snapshot;
    expect({ config: stored.config, skillMd: stored.skillMd, lessons: stored.lessons }).toEqual(shown);
    // The stamp is the ONLY thing the write adds — that is why the two are comparable at all.
    expect(stored.scrubbedBy).toBe(platform.userId);
    expect(stored.scrubVersion).toBe(1);
  });

  it('a preview WRITES NOTHING — no snapshot, no tier change', async () => {
    await create(draft('dry', 'org'));
    await previewPublish(authorA, idOf('dry'), { modelPass: null }, store);
    const row = await store.getById(idOf('dry'));
    expect(row?.visibility).toBe('org');
    expect(row?.publishedSnapshot).toBeUndefined();
  });

  it('the preview report names the PATHS it removed and carries none of the removed material', async () => {
    await create(draft('reported', 'org', {
      skillMd: `api_key: ${SHORT_LITERAL}\n`,
      actions: [{ actionName: 'go', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://live.example', path: '/x', headers: { Authorization: `Bearer ${PASTED_STRIPE}` } } }],
    }));
    const preview = await previewPublish(authorA, idOf('reported'), { modelPass: null }, store) as { verdict: 'ok'; redactions: Array<{ path: string; removedChars: number }> };
    expect(preview.verdict).toBe('ok');
    expect(preview.redactions.map((r) => r.path)).toContain('skillMd');
    expect(preview.redactions.some((r) => r.path.startsWith('config.actions[0]'))).toBe(true);
    expect(preview.redactions.every((r) => r.removedChars > 0)).toBe(true);
    // The report must never become a second surface that echoes credential material.
    const asJson = JSON.stringify(preview.redactions);
    expect(asJson).not.toContain(PASTED_STRIPE);
    expect(asJson).not.toContain(SHORT_LITERAL);
  });

  it('preview admission is the WRITE set: author + org-admin ok, plain peer and another org get no oracle', async () => {
    // A PRIVATE row is the author's alone — invisible even to their org-admin (the A1 tenancy model).
    await create(draft('gated', 'private'));
    expect((await previewPublish(authorA, idOf('gated'), { modelPass: null }, store)).verdict).toBe('ok');
    for (const actor of [adminA, peerA, readerB, platform]) {
      expect((await previewPublish(actor, idOf('gated'), { modelPass: null }, store)).verdict, actor.userId).toBe('notfound');
    }
    // An ORG-SHARED row widens the set to the org-admin, and no further: a plain peer can SEE it, so
    // the honest answer to them is `forbidden`, while another org still gets no signal at all.
    await create(draft('shared', 'org'));
    expect((await previewPublish(authorA, idOf('shared'), { modelPass: null }, store)).verdict).toBe('ok');
    expect((await previewPublish(adminA, idOf('shared'), { modelPass: null }, store)).verdict).toBe('ok');
    expect((await previewPublish(peerA, idOf('shared'), { modelPass: null }, store)).verdict).toBe('forbidden');
    expect((await previewPublish(readerB, idOf('shared'), { modelPass: null }, store)).verdict).toBe('notfound');
    // Byte-identical to a genuinely missing row: the preview is not an existence oracle.
    expect(await previewPublish(readerB, definitionIdFor('orgA', 'no-such-key'), { modelPass: null }, store))
      .toEqual({ verdict: 'notfound' });
  });
});

// ============================================================================================

describe('the FROZEN snapshot is what other orgs read', () => {
  it('a later edit of the live row does NOT reach the org that reads it; the author sees their own live row', async () => {
    await create(draft('frozen', 'org', { displayName: 'PUBLISHED NAME', skillMd: '# frozen\nPUBLISHED BODY\n' }));
    await submit('frozen');
    expect((await publishDefinition(platform, idOf('frozen'), { modelPass: null }, store, publishClock)).verdict).toBe('ok');

    // The author's row moves on (a super-admin content replace — the one door that can still edit a
    // published row today; the snapshot exists so that this divergence is safe rather than lucky).
    await store.create(
      { ...draft('frozen', 'global', { displayName: 'EDITED AFTER REVIEW', skillMd: '# frozen\nEDITED BODY\n' }) },
      { actor: platform, onConflict: 'replace' },
    );

    const foreign = await resolveDefinition(readerB, 'frozen', store);
    expect(foreign?.displayName).toBe('PUBLISHED NAME');
    expect(await resolveSkillMd(readerB, 'frozen', store)).toContain('PUBLISHED BODY');
    expect(await resolveSkillMd(readerB, 'frozen', store)).not.toContain('EDITED BODY');

    const own = await resolveDefinition(authorA, 'frozen', store);
    expect(own?.displayName).toBe('EDITED AFTER REVIEW'); // the authoring org keeps its live row
  });

  it('the published ACTIONS are frozen too — the egress allow-list a consumer inherits is the reviewed one', async () => {
    await create(draft('egress', 'org'));
    await submit('egress');
    await publishDefinition(platform, idOf('egress'), { modelPass: null }, store, publishClock);
    await store.create(
      { ...draft('egress', 'global', { actions: [{ actionName: 'ping', description: 'x', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://attacker.example', path: '/x' } }] }) },
      { actor: platform, onConflict: 'replace' },
    );
    const foreign = await resolveDefinition(readerB, 'egress', store);
    expect(foreign!.actions[0]!.httpConfig!.baseUrl).toBe('https://live.example');
    expect(JSON.stringify(foreign)).not.toContain('attacker.example');
  });

  it('a re-publish SUPERSEDES: one live snapshot, with the replaced stamp recorded', async () => {
    await create(draft('again', 'org', { displayName: 'FIRST' }));
    await submit('again');
    const first = await publishDefinition(platform, idOf('again'), { modelPass: null }, store, publishClock) as { doc: IntegrationDefinitionDoc };
    const firstStamp = first.doc.publishedSnapshot!.scrubbedAt;

    await store.create({ ...draft('again', 'global', { displayName: 'SECOND' }) }, { actor: platform, onConflict: 'replace' });
    const second = await publishDefinition(platform, idOf('again'), { modelPass: null }, store, publishClock) as { doc: IntegrationDefinitionDoc };
    const snap = second.doc.publishedSnapshot!;

    expect(snap.config.displayName).toBe('SECOND');
    expect(snap.supersedes).toEqual({ scrubbedAt: firstStamp, scrubbedBy: platform.userId });
    expect((await resolveDefinition(readerB, 'again', store))!.displayName).toBe('SECOND');
  });

  it('a GLOBAL row with NO snapshot is served cross-org through the FLOOR, never raw', async () => {
    // The legacy-runtime import and a straight E1 visibility flip both produce this shape.
    await create(draft('unsnapshotted', 'global', {
      skillMd: `# x\napi_key: ${SHORT_LITERAL}\ntoken ${PASTED_STRIPE}\n`,
      actions: [{ actionName: 'go', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://live.example', path: '/x', queryParams: { q: PASTED_GITHUB } } }],
    }));
    const foreign = await resolveDefinition(readerB, 'unsnapshotted', store);
    expect(JSON.stringify(foreign)).not.toContain(PASTED_GITHUB);
    const body = await resolveSkillMd(readerB, 'unsnapshotted', store);
    expect(body).not.toContain(PASTED_STRIPE);
    expect(body).not.toContain(SHORT_LITERAL);
    // Non-vacuous: the row really does carry them, and the AUTHOR still reads their own live bytes.
    expect(JSON.stringify(await store.getById(definitionIdFor('orgA', 'unsnapshotted')))).toContain(PASTED_GITHUB);
    expect(await resolveSkillMdRaw(authorA, 'unsnapshotted', store)).toContain(PASTED_STRIPE);
  });

  it('publishing is not a new way to read another org`s raw content', async () => {
    await create(draft('rawcheck', 'org', { skillMd: `# x\nRAW ONLY ${PASTED_HEX}\n` }));
    await submit('rawcheck');
    await publishDefinition(platform, idOf('rawcheck'), { modelPass: null }, store, publishClock);
    const foreignRaw = await resolveSkillMdRaw(readerB, 'rawcheck', store);
    expect(foreignRaw ?? '').not.toContain(PASTED_HEX);
    expect(foreignRaw).toBe(await resolveSkillMd(readerB, 'rawcheck', store)); // raw collapses to the snapshot view
    // Inside the AUTHORING org the published row is still the org's own content: a peer keeps the
    // A2 read-path scrub they had before publication, and the author keeps byte-exact bytes. The
    // claim being pinned is about ANOTHER org, which is the boundary publication crosses.
    expect(await resolveSkillMdRaw(authorA, 'rawcheck', store)).toContain(PASTED_HEX);
  });
});

describe('the publish write is the store visibility gate, unchanged', () => {
  it('a non-super-admin cannot publish, and NOTHING is written when the gate refuses', async () => {
    await create(draft('locked', 'org'));
    await submit('locked');
    for (const actor of [authorA, adminA]) {
      expect((await publishDefinition(actor, idOf('locked'), { modelPass: null }, store, publishClock)).verdict).toBe('forbidden');
    }
    const row = await store.getById(idOf('locked'));
    expect(row?.visibility).toBe('org');
    expect(row?.publishedSnapshot).toBeUndefined();
  });

  it('a PRIVATE row cannot be published (E1 F4: publish only what the org already shares)', async () => {
    // Authored BY the super-admin so the row is genuinely VISIBLE to them: what is being measured is
    // the TIER rule (publish only what the org already shares), not the read gate.
    await store.create({ ...draft('draft-row', 'private'), userId: platformInA.userId }, { actor: platformInA });
    expect((await publishDefinition(platformInA, idOf('draft-row'), { modelPass: null }, store, publishClock)).verdict).toBe('forbidden');
    expect((await store.getById(idOf('draft-row')))?.visibility).toBe('private');
  });

  it('`requireModelPass` REFUSES the publish when the second net does not run, writing nothing', async () => {
    await create(draft('strict', 'org'));
    await submit('strict');
    const res = await publishDefinition(platform, idOf('strict'), { modelPass: throwingPass('provider down'), requireModelPass: true }, store, publishClock);
    expect(res).toEqual({ verdict: 'model_pass_required', reason: 'provider down' });
    const row = await store.getById(idOf('strict'));
    expect(row?.visibility).toBe('org');
    expect(row?.publishedSnapshot).toBeUndefined();
  });

  it('without `requireModelPass` a failed pass still publishes the FLOOR result, and says so durably', async () => {
    await create(draft('degraded', 'org', { skillMd: `# x\nX-Token ${PASTED_STRIPE}\n` }));
    await submit('degraded');
    const res = await publishDefinition(platform, idOf('degraded'), { modelPass: throwingPass('provider down') }, store, publishClock) as { doc: IntegrationDefinitionDoc };
    const snap = res.doc.publishedSnapshot!;
    expect(snap.modelPass).toEqual({ status: 'failed', reason: 'provider down' });
    expect(snap.skillMd).not.toContain(PASTED_STRIPE);
    expect((await resolveDefinition(readerB, 'degraded', store))?.key).toBe('degraded');
  });

  it('a missing row and an invisible one answer the same `notfound`', async () => {
    await create(draft('hidden', 'private'));
    expect(await publishDefinition(platform, definitionIdFor('orgA', 'nope'), { modelPass: null }, store, publishClock))
      .toEqual({ verdict: 'notfound' });
    // A row that DOES exist but is not submitted answers byte-identically — the reviewer cannot
    // probe for a tenant's unpublished packages.
    expect(await publishDefinition(platform, idOf('hidden'), { modelPass: null }, store, publishClock))
      .toEqual({ verdict: 'notfound' });
    // Non-vacuity control: the same actor DOES get a distinct verdict once the row is reachable.
    await create(draft('offered', 'org'));
    await submit('offered');
    expect((await publishDefinition(platform, idOf('offered'), { modelPass: null }, store, publishClock)).verdict).toBe('ok');
  });
});

describe('publishableContentOf is the exact inverse of the save path', () => {
  it('round-trips every package field a definition can carry', async () => {
    const doc = await create(draft('roundtrip', 'private', {
      description: 'd', version: '2', authType: 'api_key', provider: 'P', category: 'c',
      credentialGuide: 'g',
      configSchema: [{ key: 'api_key', label: 'K', type: 'password', required: true, secret: true }],
      sessionConnect: { loginUrl: 'https://live.example/login', successUrlContains: '/home' },
      webhookConfig: { events: [{ name: 'e', labelPt: 'e' }] },
      listenerConfig: { pollAction: 'ping', intervalMs: 1, cursorField: 'c', eventArrayField: 'a', dedupKeyField: 'd' },
    }));
    const content = publishableContentOf(doc);
    expect(content.config).toEqual({
      integrationKey: 'roundtrip',
      displayName: 'roundtrip (live)', description: 'd', version: '2', authType: 'api_key', provider: 'P', category: 'c',
      configSchema: doc.configSchema, actions: doc.actions, credentialGuide: 'g',
      sessionConnect: doc.sessionConnect, webhookConfig: doc.webhookConfig, listenerConfig: doc.listenerConfig,
    });
    expect(content.skillMd).toBe(doc.skillMd);
  });
});
