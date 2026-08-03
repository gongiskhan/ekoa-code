import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from '@ekoa/shared';
import { INTEGRATION_LESSONS_MAX_CHARS } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions } from '../../src/data/stores.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import {
  IntegrationDefinitionStore,
  type IntegrationDefinitionCreate,
  type DefinitionVisibility,
} from '../../src/integrations/definition-store.js';
import { resolveSkillMd } from '../../src/integrations/definition-registry.js';
import {
  readLessons,
  writeLessons,
  lessonsForPrompt,
  lessonsViewOf,
  composeIntegrationContext,
  LESSONS_PROMPT_HEADING,
} from '../../src/integrations/definition-lessons.js';

/**
 * PER-INTEGRATION LESSONS (slice C3).
 *
 * The slice's whole risk is that `lessons` is free text a human writes which then rides into a
 * model prompt — the A2-review F7 surface — while ALSO being the thing that human keeps editing,
 * which is the A3-review F3 surface (one scrubbed edit cycle permanently destroyed a tenant's
 * documentation). So the suite is organised around the two directions of that split, and every
 * assertion is paired with its opposite sign so a null or an empty string can never pass for the
 * right reason by accident.
 *
 * Driven against a REAL (in-memory) Mongo and the REAL store, because the gate under test
 * (`canEditDefinitionRaw`) is a function of the stored row's org/author/visibility — a mocked store
 * would prove the arithmetic and none of the tenancy.
 *
 * NO CREDENTIAL-SHAPED LITERAL is committed: every sentinel is composed at runtime (the CS5 rule —
 * the secrets gate stays sharp and the test keeps its meaning).
 */
const authorA: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const peerA: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
const adminA: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
const userB: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };
const rootB: Actor = { userId: 'rootB', orgId: 'orgB', role: 'super-admin' };

let mem: MongoMemoryServer;
let tmp: string;
let baselineDir: string;
const savedEnv: Record<string, string | undefined> = {};

/** Deterministic, MONOTONIC clock: `setLessons` bumps `updatedAt` strictly, and the concurrency
 *  token only means anything if two consecutive writes cannot share a stamp. */
let clock = 0;
const store = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++ * 1_000));

/** A pasted credential, composed at runtime so no credential-shaped literal is committed. */
const PASTED = ['sk', 'live', 'C3LESSONSPASTED4242'].join('_');
/** Prose the egress scrub must NOT destroy (the A3 review F3 / LOW-3 shape). */
const LEGIT = 'authorization: required';

const lessonsBody = [
  '- The portal rejects requests without a Referer header.',
  `- ${LEGIT} on every call.`,
  '- Call it with `Authorization: Bearer {{api_key}}`.',
  `- The sandbox key expires weekly; ours is api_key: ${PASTED}`,
].join('\n');

const draft = (
  orgId: string,
  userId: string,
  key: string,
  visibility: DefinitionVisibility,
  extra: Partial<IntegrationDefinitionCreate> = {},
): IntegrationDefinitionCreate => ({
  orgId,
  userId,
  key,
  visibility,
  displayName: `${key} (${orgId})`,
  configSchema: [],
  actions: [{ actionName: 'ping', description: 'p', mutates: false }],
  skillMd: `# ${key}\nKNOWLEDGE BODY (${orgId})\n`,
  ...extra,
});

const createRow = (input: IntegrationDefinitionCreate) =>
  store.create(input, {
    actor: { userId: input.userId, orgId: input.orgId, role: input.visibility === 'global' ? 'super-admin' : 'user' },
  });

/** The stored bytes, read UNDER the store (never through the module under test) — so a claim about
 *  what was persisted is never made by the same code path that reported success. */
const storedLessons = async (id: string): Promise<string | undefined> =>
  (await store.getById(id))?.lessons;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-lessons-'));
  baselineDir = join(tmp, 'baseline');
  mkdirSync(join(baselineDir, 'shipped-pkg'), { recursive: true });
  writeFileSync(join(baselineDir, 'shipped-pkg', 'config.json'), JSON.stringify({
    integrationKey: 'shipped-pkg', displayName: 'Shipped', configSchema: [], actions: [],
  }));
  writeFileSync(join(baselineDir, 'shipped-pkg', 'SKILL.md'), '# shipped-pkg\nSHIPPED BODY\n');
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_lessons');
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

// =================================================================================================
// The split: byte-exact to the editor, scrubbed to the prompt.
// =================================================================================================

describe('C3 — the editor reads BYTES, the prompt reads a SCRUB (A2 F7 + A3 F3, one rule each way)', () => {
  it('A SECRET PASTED INTO `lessons` NEVER REACHES THE PROMPT SEAM — and the prose survives', async () => {
    await createRow(draft('orgA', 'userA1', 'noted', 'private', { lessons: lessonsBody }));

    const prompt = await lessonsForPrompt(authorA, 'noted', store);
    // Non-vacuous: the lessons really did resolve for this actor…
    expect(prompt).toContain('rejects requests without a Referer');
    // …and the pasted credential is gone from what the model would be shown.
    expect(prompt).not.toContain(PASTED);
    expect(prompt).toContain('[REDACTED]');
    // The scrub is value-anchored, not name-phobic: documentation of field NAMES and template
    // placeholders survive, or the feature would be useless for exactly the notes people write.
    expect(prompt).toContain(LEGIT);
    expect(prompt).toContain('Bearer {{api_key}}');

    // THE SEAM ITSELF: what `load_context` would hand an agent for this integration.
    const context = composeIntegrationContext(await resolveSkillMd(authorA, 'noted', store), prompt);
    expect(context).toContain('KNOWLEDGE BODY (orgA)');
    expect(context).toContain(LESSONS_PROMPT_HEADING);
    expect(context).toContain('rejects requests without a Referer');
    expect(context).not.toContain(PASTED);
  });

  it('the AUTHOR reads their lessons byte-exactly, and the view says so (`editable`)', async () => {
    await createRow(draft('orgA', 'userA1', 'noted', 'private', { lessons: lessonsBody }));

    const res = await readLessons(authorA, 'noted', store);
    expect(res.verdict).toBe('ok');
    const view = (res as { view: { lessons: string; editable: boolean } }).view;
    expect(view.lessons).toBe(lessonsBody); // BYTE-EXACT, redaction marker and all absent
    expect(view.lessons).toContain(PASTED);
    expect(view.lessons).not.toContain('[REDACTED]');
    expect(view.editable).toBe(true);
  });

  it('AN ORDINARY EDIT CYCLE PRESERVES THE AUTHOR\'S BYTES EXACTLY (A3 review F3)', async () => {
    // The defect this pins: the builder seeded its editable body from the SCRUBBED read, so one
    // load->save round trip persisted `[REDACTED]` over legitimate documentation, forever. The
    // cycle below is exactly that round trip — load, save what was loaded, load again.
    const doc = await createRow(draft('orgA', 'userA1', 'noted', 'private', { lessons: lessonsBody }));

    for (let cycle = 0; cycle < 3; cycle++) {
      const loaded = await readLessons(authorA, 'noted', store);
      const text = (loaded as { view: { lessons: string; updatedAt: string } }).view.lessons;
      const written = await writeLessons(authorA, 'noted', text, {
        expectedUpdatedAt: (loaded as { view: { updatedAt: string } }).view.updatedAt,
      }, store);
      expect(written.verdict, `cycle ${cycle}`).toBe('ok');
      expect(await storedLessons(doc._id), `cycle ${cycle} persisted bytes`).toBe(lessonsBody);
    }
    // Three round trips later the stored text is still the author's original, character for
    // character — and the prompt view is still scrubbed (the split did not collapse either way).
    expect(await storedLessons(doc._id)).toBe(lessonsBody);
    expect(await lessonsForPrompt(authorA, 'noted', store)).not.toContain(PASTED);
  });

  it('an EMPTY / whitespace-only lessons body contributes NOTHING to the prompt (no empty heading)', async () => {
    await createRow(draft('orgA', 'userA1', 'blank', 'private', { lessons: '   \n\t\n' }));
    expect(await lessonsForPrompt(authorA, 'blank', store)).toBeNull();
    const ctx = composeIntegrationContext(await resolveSkillMd(authorA, 'blank', store), null);
    expect(ctx).toContain('KNOWLEDGE BODY (orgA)');
    expect(ctx).not.toContain(LESSONS_PROMPT_HEADING);
  });
});

// =================================================================================================
// WHO may read the bytes and write them: the save path's admission set, not a fourth copy of it.
// =================================================================================================

describe('C3 — the raw view and the write are gated by `canEditDefinitionRaw` (the SAVE path\'s set)', () => {
  it('a same-org PLAIN peer of an `org` row: scrubbed, not editable, and the write is FORBIDDEN', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'team', 'org', { lessons: lessonsBody }));

    const res = await readLessons(peerA, 'team', store);
    expect(res.verdict).toBe('ok'); // non-vacuous: the peer genuinely resolves the org-shared row
    const view = (res as { view: { lessons: string; editable: boolean } }).view;
    expect(view.lessons).toContain('rejects requests without a Referer');
    expect(view.lessons).not.toContain(PASTED);
    expect(view.editable).toBe(false);

    const write = await writeLessons(peerA, 'team', 'peer overwrite', {}, store);
    expect(write.verdict).toBe('forbidden');
    expect(await storedLessons(doc._id)).toBe(lessonsBody); // untouched
  });

  it('the ORG-ADMIN over the same peer row DOES get bytes and MAY write — the set is the save set', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'team', 'org', { lessons: lessonsBody }));

    const res = await readLessons(adminA, 'team', store);
    expect((res as { view: { lessons: string; editable: boolean } }).view.lessons).toBe(lessonsBody);
    expect((res as { view: { editable: boolean } }).view.editable).toBe(true);

    expect((await writeLessons(adminA, 'team', 'admin note', {}, store)).verdict).toBe('ok');
    expect(await storedLessons(doc._id)).toBe('admin note');
  });

  it('a `global` row is scrubbed for EVERYONE (its own author included) and writable by NOBODY', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'published', 'global', { lessons: lessonsBody }));

    for (const who of [authorA, peerA, adminA, userB, rootB]) {
      const res = await readLessons(who, 'published', store);
      expect(res.verdict, who.userId).toBe('ok'); // global really is cross-org readable
      const view = (res as { view: { lessons: string; editable: boolean } }).view;
      expect(view.lessons, who.userId).toContain('rejects requests without a Referer');
      expect(view.lessons, who.userId).not.toContain(PASTED);
      expect(view.editable, who.userId).toBe(false);
      expect((await writeLessons(who, 'published', 'hijack', {}, store)).verdict, who.userId).toBe('forbidden');
    }
    expect(await storedLessons(doc._id)).toBe(lessonsBody);
  });

  it("another org's PRIVATE and ORG rows are `notfound` for both read and write (no existence oracle)", async () => {
    const priv = await createRow(draft('orgB', 'userB1', 'b-priv', 'private', { lessons: lessonsBody }));
    const shared = await createRow(draft('orgB', 'userB1', 'b-org', 'org', { lessons: lessonsBody }));

    // Non-vacuous: org B's own author sees both.
    expect((await readLessons(userB, 'b-priv', store)).verdict).toBe('ok');
    expect((await readLessons(userB, 'b-org', store)).verdict).toBe('ok');

    for (const key of ['b-priv', 'b-org']) {
      expect((await readLessons(authorA, key, store)).verdict, key).toBe('notfound');
      expect((await writeLessons(authorA, key, 'x', {}, store)).verdict, key).toBe('notfound');
    }
    expect(await storedLessons(priv._id)).toBe(lessonsBody);
    expect(await storedLessons(shared._id)).toBe(lessonsBody);
  });

  it('a SHIPPED baseline package has no lessons surface at all (no invented editable empty)', async () => {
    // The shipped tier is deploy-versioned with code (RUN_SPEC assumption 2): offering an editable
    // empty box for it would promise a save the write path then refuses.
    expect((await readLessons(authorA, 'shipped-pkg', store)).verdict).toBe('notfound');
    expect((await writeLessons(authorA, 'shipped-pkg', 'note', {}, store)).verdict).toBe('notfound');
    expect(await lessonsForPrompt(authorA, 'shipped-pkg', store)).toBeNull();
    // …and the shipped knowledge body still reaches the prompt exactly as before this slice.
    expect(composeIntegrationContext(await resolveSkillMd(authorA, 'shipped-pkg', store), null))
      .toContain('SHIPPED BODY');
  });

  it('a CROSS-ORG published row is read through its FROZEN SNAPSHOT, never the live lessons (E2)', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'frozen', 'org', { lessons: 'LIVE lessons, unreviewed.' }));
    await store.publishSnapshot(doc._id, { userId: 'rootA', orgId: 'orgA', role: 'super-admin' }, {
      scrubbedAt: '2026-08-03T00:00:00.000Z',
      scrubbedBy: 'rootA',
      scrubVersion: 1,
      config: { integrationKey: 'frozen', configSchema: [], actions: [] },
      skillMd: '# frozen\nREVIEWED BODY\n',
      lessons: 'REVIEWED lessons.',
      modelPass: { status: 'applied' },
      redactionCount: 0,
    });

    // The AUTHOR's org keeps reading its own live row…
    expect((await readLessons(authorA, 'frozen', store) as { view: { lessons: string } }).view.lessons)
      .toContain('LIVE lessons');
    // …and another org reads the artifact a super-admin reviewed, in both directions.
    const foreign = await readLessons(userB, 'frozen', store);
    expect((foreign as { view: { lessons: string } }).view.lessons).toBe('REVIEWED lessons.');
    expect(await lessonsForPrompt(userB, 'frozen', store)).toBe('REVIEWED lessons.');
  });

  it('a snapshot that PREDATES the lessons shows another org NOTHING until a re-publish (frozen)', async () => {
    // The sharper half of E2's rule, and the one a reader will otherwise trip over: the snapshot is
    // authoritative for `lessons` even when it CARRIES NONE. A row published before it had lessons,
    // whose author then records some, must not leak them cross-org — the artifact a reviewer
    // approved had no lessons section, and "frozen" has to mean that in both directions or
    // publishing becomes a way to push unreviewed prose at every tenant.
    const root: Actor = { userId: 'rootA', orgId: 'orgA', role: 'super-admin' };
    const LIVE = 'LIVE lessons the reviewer never saw.';
    const doc = await createRow(draft('orgA', 'userA1', 'predates', 'org', { lessons: LIVE }));
    await store.publishSnapshot(doc._id, root, {
      scrubbedAt: '2026-08-03T00:00:00.000Z',
      scrubbedBy: 'rootA',
      scrubVersion: 1,
      config: { integrationKey: 'predates', configSchema: [], actions: [] },
      skillMd: '# predates\nREVIEWED BODY\n',
      // NO `lessons` key: the artifact a reviewer approved carried no lessons section.
      modelPass: { status: 'applied' },
      redactionCount: 0,
    });

    // The authoring org still reads its own live row (non-vacuous: the lessons ARE there)…
    expect((await readLessons(authorA, 'predates', store) as { view: { lessons: string } }).view.lessons)
      .toBe(LIVE);

    // …and another org sees NOTHING, in both directions, until a re-publish re-freezes the row.
    const foreign = await readLessons(userB, 'predates', store);
    expect(foreign.verdict).toBe('ok'); // the global row itself resolves — this is not a 404
    expect((foreign as { view: { lessons: string; editable: boolean } }).view.lessons).toBe('');
    expect((foreign as { view: { editable: boolean } }).view.editable).toBe(false);
    expect(await lessonsForPrompt(userB, 'predates', store)).toBeNull();

    // The pure projection agrees with the store-backed reads (`lessonsViewOf` is what both call),
    // which is the assertion that C3's view and E2's `crossOrgView` are ONE rule and not two.
    const row = (await store.getById(doc._id))!;
    expect(lessonsViewOf(row, userB).lessons).toBe('');
    expect(lessonsViewOf(row, authorA).lessons).toBe(LIVE);

    // RE-PUBLISHING is the way forward: a fresh snapshot carrying the lessons unfreezes them.
    await store.publishSnapshot(doc._id, root, {
      scrubbedAt: '2026-08-04T00:00:00.000Z',
      scrubbedBy: 'rootA',
      scrubVersion: 1,
      config: { integrationKey: 'predates', configSchema: [], actions: [] },
      skillMd: '# predates\nREVIEWED BODY\n',
      lessons: LIVE,
      modelPass: { status: 'applied' },
      redactionCount: 0,
    });
    expect(await lessonsForPrompt(userB, 'predates', store)).toBe(LIVE);
  });
});

// =================================================================================================
// Length: refuse, never truncate.
// =================================================================================================

describe('C3 — the length ceiling REFUSES; it never trims what someone typed', () => {
  it('accepts exactly the limit and refuses one character more, writing nothing', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'long', 'private', { lessons: 'seed' }));

    const atLimit = 'x'.repeat(INTEGRATION_LESSONS_MAX_CHARS);
    expect((await writeLessons(authorA, 'long', atLimit, {}, store)).verdict).toBe('ok');
    expect((await storedLessons(doc._id))!.length).toBe(INTEGRATION_LESSONS_MAX_CHARS);

    const over = 'y'.repeat(INTEGRATION_LESSONS_MAX_CHARS + 1);
    const refused = await writeLessons(authorA, 'long', over, {}, store);
    expect(refused.verdict).toBe('too_long');
    expect((refused as { limit: number; length: number }).limit).toBe(INTEGRATION_LESSONS_MAX_CHARS);
    expect((refused as { length: number }).length).toBe(INTEGRATION_LESSONS_MAX_CHARS + 1);
    // THE POINT: the previous text is intact and NO truncated prefix of the new one was stored.
    expect(await storedLessons(doc._id)).toBe(atLimit);
    expect(await storedLessons(doc._id)).not.toContain('y');
  });

  it('the ceiling is judged BEFORE the row is resolved, so it is no existence oracle', async () => {
    const over = 'z'.repeat(INTEGRATION_LESSONS_MAX_CHARS + 1);
    // A key that does not exist and a key in another org answer the SAME `too_long`, not `notfound`.
    await createRow(draft('orgB', 'userB1', 'b-secret', 'private'));
    expect((await writeLessons(authorA, 'no-such-key', over, {}, store)).verdict).toBe('too_long');
    expect((await writeLessons(authorA, 'b-secret', over, {}, store)).verdict).toBe('too_long');
  });

  it('an empty body CLEARS the lessons (and the prompt stops carrying the section)', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'clearme', 'private', { lessons: lessonsBody }));
    expect(await lessonsForPrompt(authorA, 'clearme', store)).toBeTruthy();

    expect((await writeLessons(authorA, 'clearme', '', {}, store)).verdict).toBe('ok');
    expect(await storedLessons(doc._id)).toBe('');
    expect(await lessonsForPrompt(authorA, 'clearme', store)).toBeNull();
  });
});

// =================================================================================================
// Lost updates: refuse, never clobber.
// =================================================================================================

describe('C3 — a concurrent edit is REFUSED with the current text, never silently overwritten', () => {
  it('a stale `expectedUpdatedAt` is refused and answers with what is actually stored', async () => {
    // `org`, NOT `private`: two DISTINCT editors is the point of the test, and a private row has
    // exactly one — an org-admin cannot even see a peer's private row (`isDefinitionVisibleTo`),
    // so staging the race there would prove a 404 rather than a lost update. `org` is precisely
    // where `canEditDefinitionRaw` admits both the owner and their org-admin.
    const doc = await createRow(draft('orgA', 'userA1', 'race', 'org', { lessons: 'original' }));

    // Two editors load the same row.
    const first = (await readLessons(authorA, 'race', store) as { view: { updatedAt: string } }).view;
    const second = (await readLessons(adminA, 'race', store) as { view: { updatedAt: string } }).view;
    expect(first.updatedAt).toBe(second.updatedAt);

    // The admin saves first.
    expect((await writeLessons(adminA, 'race', 'ADMIN VERSION', { expectedUpdatedAt: second.updatedAt }, store)).verdict).toBe('ok');

    // The author's save, still holding the token they read, is REFUSED — and is handed the text
    // that is actually stored so nothing has to be guessed or lost.
    const stale = await writeLessons(authorA, 'race', 'AUTHOR VERSION', { expectedUpdatedAt: first.updatedAt }, store);
    expect(stale.verdict).toBe('stale');
    expect((stale as { view: { lessons: string } }).view.lessons).toBe('ADMIN VERSION');
    expect(await storedLessons(doc._id)).toBe('ADMIN VERSION');

    // Re-reading gives a fresh token, and the same save then lands (the refusal is recoverable).
    const fresh = (await readLessons(authorA, 'race', store) as { view: { updatedAt: string } }).view;
    expect(fresh.updatedAt).not.toBe(first.updatedAt);
    expect((await writeLessons(authorA, 'race', 'AUTHOR VERSION', { expectedUpdatedAt: fresh.updatedAt }, store)).verdict).toBe('ok');
    expect(await storedLessons(doc._id)).toBe('AUTHOR VERSION');
  });

  it('OMITTING the token is an explicit overwrite — the only way to win a conflict', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'race', 'org', { lessons: 'original' }));
    const loaded = (await readLessons(authorA, 'race', store) as { view: { updatedAt: string } }).view;
    // Non-vacuous: the admin's write must actually LAND, or the "stale" below would be vacuous.
    expect((await writeLessons(adminA, 'race', 'ADMIN VERSION', {}, store)).verdict).toBe('ok');

    expect((await writeLessons(authorA, 'race', 'AUTHOR VERSION', { expectedUpdatedAt: loaded.updatedAt }, store)).verdict).toBe('stale');
    expect((await writeLessons(authorA, 'race', 'AUTHOR VERSION', {}, store)).verdict).toBe('ok');
    expect(await storedLessons(doc._id)).toBe('AUTHOR VERSION');
  });

  it('EVERY write advances the token, so two writes can never share one (the CAS has something to bite on)', async () => {
    await createRow(draft('orgA', 'userA1', 'stamp', 'private', { lessons: 'a' }));
    const stamps: string[] = [];
    for (const text of ['b', 'c', 'd']) {
      const res = await writeLessons(authorA, 'stamp', text, {}, store);
      stamps.push((res as { view: { updatedAt: string } }).view.updatedAt);
    }
    expect(new Set(stamps).size).toBe(stamps.length);
    expect([...stamps].sort()).toEqual(stamps); // strictly increasing
  });

  it('an unrelated write to the row (a visibility flip) also invalidates the token — by design', async () => {
    const doc = await createRow(draft('orgA', 'userA1', 'flip', 'private', { lessons: 'original' }));
    const loaded = (await readLessons(authorA, 'flip', store) as { view: { updatedAt: string } }).view;

    await store.setVisibility(doc._id, authorA, 'org');
    const res = await writeLessons(authorA, 'flip', 'note', { expectedUpdatedAt: loaded.updatedAt }, store);
    // The row the editor loaded is not the row that is there now; they re-read rather than write
    // over a definition whose sharing tier changed under them.
    expect(res.verdict).toBe('stale');
    expect(await storedLessons(doc._id)).toBe('original');
  });
});

// =================================================================================================
// The pure pieces.
// =================================================================================================

describe('C3 — composeIntegrationContext: the `load_context` shape', () => {
  it('joins body and lessons under one heading, and degrades honestly when either is missing', () => {
    expect(composeIntegrationContext('# Body\nText.', 'Lesson one.'))
      .toBe(`# Body\nText.\n\n${LESSONS_PROMPT_HEADING}\n\nLesson one.\n`);
    expect(composeIntegrationContext('# Body\nText.', null)).toBe('# Body\nText.');
    expect(composeIntegrationContext(null, 'Lesson one.')).toBe(`${LESSONS_PROMPT_HEADING}\n\nLesson one.\n`);
    // Nothing to say -> `load_context` answers null exactly as it did before this slice.
    expect(composeIntegrationContext(null, null)).toBeNull();
    expect(composeIntegrationContext('', '')).toBeNull();
    expect(composeIntegrationContext('   \n ', '  ')).toBeNull();
  });

  it('does not duplicate blank lines when the body already ends with them', () => {
    expect(composeIntegrationContext('# Body\n\n\n', 'L.'))
      .toBe(`# Body\n\n${LESSONS_PROMPT_HEADING}\n\nL.\n`);
  });
});

describe('C3 — lessonsViewOf is the ONE projection (pure, both branches)', () => {
  const row = (over: Record<string, unknown>) => ({
    _id: 'x', orgId: 'orgA', userId: 'userA1', visibility: 'private',
    key: 'k', configSchema: [], actions: [], skillMd: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  }) as never;

  it('an absent `lessons` field projects as the empty string, not undefined', () => {
    expect(lessonsViewOf(row({}), authorA)).toEqual({
      key: 'k', lessons: '', editable: true, updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(lessonsViewOf(row({ visibility: 'global' }), userB).lessons).toBe('');
  });

  it('reports the row `updatedAt` in BOTH branches — the token does not depend on who is asking', () => {
    const doc = row({ lessons: lessonsBody, visibility: 'org' });
    expect(lessonsViewOf(doc, authorA).updatedAt).toBe(lessonsViewOf(doc, peerA).updatedAt);
    expect(lessonsViewOf(doc, authorA).editable).toBe(true);
    expect(lessonsViewOf(doc, peerA).editable).toBe(false);
  });
});
