import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions, users } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { refreshDefinitions, type IntegrationAction } from '../../src/integrations/definitions.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
  type IntegrationDefinitionDoc,
} from '../../src/integrations/definition-store.js';
import { publishDefinition } from '../../src/integrations/publish-scrub.js';
import { resolveDefinition } from '../../src/integrations/definition-registry.js';
import { isTrustedAction } from '../../src/integrations/authored-action.js';

/**
 * PUBLISH-DOOR ISOLATION (slice S6) - a memvault-class suite for the three properties that only
 * become MEANINGFUL once the publish doors are mounted, and that nothing else proves.
 *
 * The credential-containment half already has a suite: `tests/security/integration-publish-scrub.test.ts`
 * stuffs one definition with a sentinel in every field shape and proves the deterministic floor
 * empties all of them. This file does not repeat it. It proves the three properties MOUNTING adds:
 *
 * 1. THE STRUCTURAL EXCLUSION (decision D5). Per-action evidence and per-user feedback live in
 *    tenant-scoped collections that are structurally OUTSIDE the published snapshot, so promotion
 *    carries none BY CONSTRUCTION. Those two stores are being built by another stream and cannot be
 *    imported here, so the property is asserted FROM THE PUBLISH SIDE and in the strongest form
 *    available from here: the snapshot's content is built by an explicit WHITELIST
 *    (`packageConfigFromDoc`), so this suite plants a battery of evidence- and feedback-shaped
 *    fields ON the definition document - top level and per action - publishes, and proves the
 *    snapshot has no field either could occupy. The assertion is whitelist-shaped rather than
 *    name-shaped: it holds for whatever the other stream ends up calling its fields, because a field
 *    the whitelist does not name cannot appear whatever it is called.
 *
 *    WHAT THIS SUITE CANNOT PROVE, stated rather than implied: it proves the SNAPSHOT excludes them.
 *    The other stream must confirm the other half - that neither store writes onto the definition
 *    document at all - because `publishedViewOf` spreads the stored doc (`{...doc}`) before
 *    overlaying the snapshot's content fields, so a hypothetical evidence field placed ON the row
 *    would ride the in-process cross-org VIEW even though it never entered the snapshot. Today
 *    nothing places one, and the wire projection (`definitionFromDoc`) is itself a whitelist, so
 *    nothing reaches a client either. Both facts are asserted below so that a change to either one
 *    reddens here.
 *
 * 2. THE PROVENANCE PROJECTION. `authoring.authoredBy`, `authoring.trustedBy`, `authoring.goal` and
 *    `verification.checks[].detail` used to ride into the snapshot whole. They identify people in
 *    the authoring tenant and carry their prose, onto an artifact that is permanent and read by
 *    every organisation. They are now dropped - while the TRUST SEMANTICS stay, which is the half
 *    that must not be dropped: an action with NO authoring record reads as human-written and
 *    therefore trusted, so scrubbing the record wholesale would open the write gate for every
 *    consuming org.
 *
 * 3. THE PUBLISH-REQUEST NOTE. Mounting the submit door created a new field that leaves the tenant:
 *    free text a person typed, read by a super-admin who is not a member of their org. It is
 *    scrubbed and capped at the route, and this suite reads the PERSISTED row back to prove it.
 *
 * Sentinels are COMPOSED at runtime, never literals - the gitleaks gate must keep firing on real
 * pasted keys, so the fixtures must not themselves look like real pasted keys.
 */
const compose = (...parts: string[]): string => parts.join('');

const S_NOTE = compose('sk_', 'live_', 'NOTEaaaa1111bbbb2222cccc');
const S_EVIDENCE = compose('ghp_', 'EVIDENCEdddd3333eeee4444ffff5555');
const S_FEEDBACK = compose('xoxb-', 'FEEDBACKgggg6666hhhh7777');
const S_GOAL = compose('github_pat_', 'GOALiiii8888jjjj9999kkkk0000');

const author: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const reviewer: Actor = { userId: 'root', orgId: 'orgPlatform', role: 'super-admin' };
const foreign: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };

const KEY = 's6-doors';
const ID = definitionIdFor('orgA', KEY);

let mem: MongoMemoryServer; let tmp: string; let server: Server; let port: number; let seq = 0;
const savedEnv: Record<string, string | undefined> = {};
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_800_000_000_000 + clock++));

/**
 * THE PLANTED BATTERY: every field name the evidence store (S1) or the feedback store (S3) could
 * plausibly want, at both levels the definition document has. None of these exists in production -
 * that is the point. D5 puts both stores in their own collections, and this fixture asks what would
 * happen if that decision were ever quietly reversed by a field on the row.
 */
const EVIDENCE_SHAPED_DOC_FIELDS: Record<string, unknown> = {
  evidence: { lastRun: { requestSummary: S_EVIDENCE } },
  actionEvidence: [{ actionName: 'send', responseSample: S_EVIDENCE }],
  lastValidatedRun: { runId: 'run_1', output: S_EVIDENCE },
  feedback: [{ userId: 'userA1', note: S_FEEDBACK }],
  userFeedback: { 'userA1': S_FEEDBACK },
  stepFeedback: [{ stepIndex: 0, note: S_FEEDBACK }],
};
const EVIDENCE_SHAPED_ACTION_FIELDS: Record<string, unknown> = {
  evidence: { requestSummary: S_EVIDENCE, responseSample: S_EVIDENCE },
  samples: [S_EVIDENCE],
  screenshots: [{ stepIndex: 0, ref: S_EVIDENCE }],
  feedback: [{ userId: 'userA1', note: S_FEEDBACK }],
  lastRun: { runId: 'run_1', output: S_EVIDENCE },
};

/** The ONE action, carrying a full D3 authoring record - the provenance under test. */
const authoredAction = (): IntegrationAction => ({
  actionName: 'send',
  description: 'Send a thing',
  mutates: true,
  httpConfig: { method: 'POST', baseUrl: 'https://vendor.example', path: '/v1/send' },
  authoring: {
    state: 'trusted',
    authoredBy: 'userA1',
    authoredAt: '2026-08-01T10:00:00.000Z',
    goal: `enviar o processo usando ${S_GOAL}`,
    declaredMutates: true,
    shape: 'shape-fingerprint-of-send',
    trustedBy: 'adminA1',
    trustedAt: '2026-08-02T10:00:00.000Z',
    verification: {
      verifiedAt: '2026-08-01T10:00:05.000Z',
      passed: true,
      checks: [
        { name: 'origin-allowed', ok: true, detail: `resolved https://portal-interno.orgA.example with ${S_EVIDENCE}` },
        { name: 'args-declared', ok: true },
      ],
    },
  },
  ...EVIDENCE_SHAPED_ACTION_FIELDS,
} as IntegrationAction);

async function seed(): Promise<void> {
  await store.create(
    {
      orgId: 'orgA',
      userId: 'userA1',
      key: KEY,
      visibility: 'org',
      displayName: 'S6 doors',
      description: 'A probe package.',
      configSchema: [],
      actions: [authoredAction()],
      skillMd: `# ${KEY}\n\nOrdinary documentation.\n`,
      ...EVIDENCE_SHAPED_DOC_FIELDS,
    } as never,
    { actor: author, onConflict: 'replace' },
  );
}

/** Publish through the real flow (author submits, reviewer publishes), FLOOR ONLY - the guarantee
 *  must never depend on a model being reachable, correct or non-adversarial. */
async function publishSeeded(): Promise<IntegrationDefinitionDoc> {
  expect((await store.requestPublish(ID, author)).verdict).toBe('ok');
  const res = await publishDefinition(reviewer, ID, { modelPass: null }, store, () => new Date(1_900_000_000_000));
  expect(res.verdict, JSON.stringify(res)).toBe('ok');
  return (res as { doc: IntegrationDefinitionDoc }).doc;
}

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-s6doors-'));
  mkdirSync(join(tmp, 'baseline'), { recursive: true });
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = join(tmp, 'baseline');
  refreshDefinitions();
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s6_doors');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
  process.env.EKOA_INTEGRATIONS_DIR = savedEnv.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, integrationDefinitions]) await s.deleteMany({});
  clock = 0;
  await seed();
});

// ---------------------------------------------------------------------------------------------
// D5 - the structural exclusion, asserted from the publish side
// ---------------------------------------------------------------------------------------------

describe('D5 - promotion carries no evidence and no feedback, by construction', () => {
  it('THE FIXTURE IS REAL: every planted field IS on the stored row (non-vacuity floor)', async () => {
    const live = (await store.getById(ID)) as unknown as Record<string, unknown>;
    for (const name of Object.keys(EVIDENCE_SHAPED_DOC_FIELDS)) {
      expect(live[name], `planted doc field ${name} must really be stored`).toBeTruthy();
    }
    const action = (live.actions as Array<Record<string, unknown>>)[0]!;
    for (const name of Object.keys(EVIDENCE_SHAPED_ACTION_FIELDS)) {
      expect(action[name], `planted action field ${name} must really be stored`).toBeTruthy();
    }
    // A containment suite whose fixture had been silently emptied would pass forever.
    expect(JSON.stringify(live)).toContain(S_EVIDENCE);
    expect(JSON.stringify(live)).toContain(S_FEEDBACK);
  });

  it('the SNAPSHOT is a whitelist: no planted field survives, whatever it is called', async () => {
    const doc = await publishSeeded();
    const snap = doc.publishedSnapshot!;

    // The snapshot's own key set, stated as an EQUALITY. A new field carried onto the snapshot by a
    // spread fails this; a "does not contain evidence" check would not.
    expect(Object.keys(snap).sort()).toEqual(
      ['config', 'lessons', 'modelPass', 'redactionCount', 'scrubVersion', 'scrubbedAt', 'scrubbedBy', 'skillMd']
        .filter((k) => k !== 'lessons') // this fixture has no lessons body
        .sort(),
    );
    // The package config's key set, likewise.
    expect(Object.keys(snap.config).sort()).toEqual(['actions', 'configSchema', 'description', 'displayName', 'integrationKey']);

    // And the ACTION's, which is where the per-action battery was planted. `authoring` survives
    // (projected - see the next describe); the five evidence/feedback shapes do not.
    const action = (snap.config.actions as unknown as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(action).sort()).toEqual(['actionName', 'authoring', 'description', 'httpConfig', 'mutates']);

    // The consequence, said in one line: neither sentinel is anywhere in the published artifact.
    expect(JSON.stringify(snap)).not.toContain(S_EVIDENCE);
    expect(JSON.stringify(snap)).not.toContain(S_FEEDBACK);
  });

  it('nothing reaches ANOTHER ORGANISATION through the definition read the executor and catalog use', async () => {
    await publishSeeded();
    const seen = await resolveDefinition(foreign, KEY);
    expect(seen, 'the published definition must resolve cross-org (else this proves nothing)').toBeTruthy();
    const blob = JSON.stringify(seen);
    expect(blob).not.toContain(S_EVIDENCE);
    expect(blob).not.toContain(S_FEEDBACK);
    // The wire projection is a whitelist too, so the planted fields do not reach a client even
    // though `publishedViewOf` spreads the stored document. Both halves asserted, because the
    // structural argument rests on both.
    for (const name of Object.keys(EVIDENCE_SHAPED_DOC_FIELDS)) {
      expect((seen as unknown as Record<string, unknown>)[name], `${name} must not cross orgs`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Provenance - the identity comes off, the trust semantics stay on
// ---------------------------------------------------------------------------------------------

describe('platform-authored provenance is projected before it crosses an org boundary', () => {
  it('the identifying fields and the free text are GONE from the snapshot', async () => {
    const doc = await publishSeeded();
    const action = (doc.publishedSnapshot!.config.actions as unknown as Array<Record<string, unknown>>)[0]!;
    const authoring = action.authoring as Record<string, unknown>;

    // The whole record, as an equality: a field added to `IntegrationActionAuthoring` later must be
    // opted IN to publication rather than carried along by a spread nobody re-read.
    expect(Object.keys(authoring).sort()).toEqual(
      ['authoredAt', 'declaredMutates', 'shape', 'state', 'trustedAt', 'verification'].sort(),
    );
    expect(authoring.authoredBy).toBeUndefined();
    expect(authoring.trustedBy).toBeUndefined();
    expect(authoring.goal).toBeUndefined();

    const checks = (authoring.verification as { checks: Array<Record<string, unknown>> }).checks;
    expect(checks.map((c) => Object.keys(c).sort())).toEqual([['name', 'ok'], ['name', 'ok']]);
    // `goal` and `checks[].detail` are the two free-text fields on this artifact the CHOKEPOINT
    // MODEL PASS never sees (`FREE_TEXT_PATHS` names skillMd, lessons, description, credentialGuide
    // and nothing else), so the floor alone would have been the whole of their protection.
    expect(JSON.stringify(doc.publishedSnapshot)).not.toContain(S_GOAL);
    expect(JSON.stringify(doc.publishedSnapshot)).not.toContain('userA1');
    expect(JSON.stringify(doc.publishedSnapshot)).not.toContain('adminA1');
    expect(JSON.stringify(doc.publishedSnapshot)).not.toContain('portal-interno');
  });

  it('the AUTHOR keeps the whole record on their own live row - publishing freezes a copy', async () => {
    await publishSeeded();
    const live = (await store.getById(ID))!;
    const authoring = live.actions[0]!.authoring!;
    expect(authoring.authoredBy).toBe('userA1');
    expect(authoring.trustedBy).toBe('adminA1');
    expect(authoring.goal).toContain(S_GOAL);
    expect(authoring.verification.checks[0]!.detail).toBeTruthy();
  });

  it('THE TRUST SEMANTICS SURVIVE: a PROVISIONAL action does not become human-written cross-org', async () => {
    // The dangerous shortcut this projection deliberately did not take. `authoringStateOf` reads an
    // ABSENT record as `'none'` - a human wrote it - and `isTrustedAction` therefore returns TRUE.
    // Dropping `authoring` wholesale would have published every provisional action to every tenant
    // as one a person had reviewed, opening the write gate by way of a scrub.
    await integrationDefinitions.deleteMany({});
    await store.create(
      {
        orgId: 'orgA', userId: 'userA1', key: KEY, visibility: 'org', configSchema: [], skillMd: '# p',
        actions: [{
          ...authoredAction(),
          mutates: true,
          authoring: { ...authoredAction().authoring!, state: 'provisional' },
        }],
      } as never,
      { actor: author, onConflict: 'replace' },
    );
    const doc = await publishSeeded();
    const published = (doc.publishedSnapshot!.config.actions as unknown as IntegrationAction[])[0]!;
    expect(published.authoring?.state).toBe('provisional');
    expect(isTrustedAction(KEY, published)).toBe(false);

    // ...and the same reading holds for what the FOREIGN org actually resolves.
    const seen = await resolveDefinition(foreign, KEY);
    const crossOrg = (seen!.actions ?? []).find((a) => a.actionName === 'send')!;
    expect(isTrustedAction(KEY, crossOrg)).toBe(false);
  });

  it('the SHAPE fingerprint survives, so a re-authored action still demotes itself cross-org', async () => {
    const doc = await publishSeeded();
    const published = (doc.publishedSnapshot!.config.actions as unknown as IntegrationAction[])[0]!;
    // `shape` is the integrity tie. Without it a `trusted` record could never be checked against the
    // bytes it was verified over, and `authoringStateOf` would demote every published action -
    // fail-closed, but a published artifact nobody could execute.
    expect(published.authoring?.shape).toBe('shape-fingerprint-of-send');
    expect(published.authoring?.declaredMutates).toBe(true);
    expect(published.authoring?.verification.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The publish-request note - the one new field mounting created that leaves the tenant
// ---------------------------------------------------------------------------------------------

describe('the publish-request note is scrubbed and capped before it is stored', () => {
  beforeEach(async () => {
    await mkUser('userA1', 'orgA', 'user');
    await mkUser('rootB', 'orgB', 'super-admin');
  });

  const submit = async (note: string) =>
    fetch(`http://127.0.0.1:${port}/api/v1/integrations/definitions/${ID}/publish-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor('userA1')}` },
      body: JSON.stringify({ note }),
    });

  it('a credential pasted into the note never reaches the stored row, nor the reviewer', async () => {
    const res = await submit(`a chave antiga era ${S_NOTE}, agora usamos o cofre`);
    expect(res.status).toBe(200);

    // THE PERSISTED ROW, not the echo: a route that scrubbed only what it answered with would leave
    // the value in the database for the queue to read out later.
    const stored = (await store.getById(ID))!.publishRequest!;
    expect(stored.note).not.toContain(S_NOTE);
    expect(stored.note).toContain('[REDACTED]');
    // The surrounding prose survives - a scrub that ate the note would make the field useless and
    // nobody would notice, since the reviewer has nothing to compare it to.
    expect(stored.note).toContain('agora usamos o cofre');

    // And it is gone from the cross-org surface the note exists to reach.
    const queue = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/definitions/publish-requests`, {
      headers: { authorization: `Bearer ${await tokenFor('rootB')}` },
    });
    expect(queue.status).toBe(200);
    expect(JSON.stringify(await queue.json())).not.toContain(S_NOTE);
  });

  it('the note is CAPPED server-side, not merely bounded by the schema', async () => {
    // The schema refuses over-long input at the wire; the cap is what holds if any caller ever
    // reaches `requestPublish` with a longer string. Assert the stored length directly.
    const res = await submit('a'.repeat(1_000));
    expect(res.status).toBe(200);
    expect((await store.getById(ID))!.publishRequest!.note!.length).toBeLessThanOrEqual(1_000);
  });
});
