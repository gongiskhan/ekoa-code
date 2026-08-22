import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationActionFeedback, integrationDefinitions } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore, type DefinitionVisibility } from '../../src/integrations/definition-store.js';
import {
  actionFeedbackStore,
  ActionFeedbackStore,
  actionFeedbackIdFor,
  ActionFeedbackStoreError,
  ACTION_FEEDBACK_MAX_CHARS,
  ACTION_FEEDBACK_MAX_NOTES_PER_ACTION,
  ACTION_FEEDBACK_STEP_REF_MAX_CHARS,
} from '../../src/integrations/action-feedback-store.js';
import {
  listFeedbackFor,
  writeFeedbackFor,
  discardFeedbackFor,
  feedbackForPrompt,
  feedbackSectionsForOwner,
  FEEDBACK_PROMPT_MAX_NOTES,
} from '../../src/integrations/action-feedback.js';
import { composeIntegrationContext } from '../../src/integrations/definition-lessons.js';

/**
 * PER-USER FEEDBACK ISOLATION (slice S3) - the Rule 5 suite, of the class of
 * `memvault-isolation.test.ts`, over the collection this slice adds and over the three prompt seams
 * that read it.
 *
 * ── WHY THIS SUITE HAS TWO HALVES, AND WHY THE SECOND ONE IS THE POINT ────────────────────────
 *
 * The first half is the ordinary tenancy battery every Rule 5 store gets: no other ORG and no other
 * USER reaches a row, on every method, in both directions, with the owner as the control.
 *
 * The second half is what makes this collection different from every other tenant-scoped store in
 * the repo. A memvault note is READ BACK TO THE PERSON WHO WROTE IT; a feedback note is READ BACK
 * INTO A MODEL PROMPT. So the question "whose rows did this read return" has a second edge here:
 * free text written by one person that lands in another person's turn is a peer-to-peer injection
 * channel, with the platform as the carrier and no gate anywhere on the path, and it would be
 * INVISIBLE to a store-level suite - the store can only see the terms it was handed, never whether
 * the caller handed it the verified actor's own. Every one of the three seams is therefore driven
 * end to end with a peer's note planted beside the caller's own, and asserted to carry one and not
 * the other.
 *
 * ── THE CONTROLS, AND WHAT REMOVING EACH COSTS (measured, 2026-08-22) ────────────────────────
 *
 *   - the USER term in the store's `_id` (`actionFeedbackIdFor`)          -> 6 cases red
 *   - the ORG term in the same id                                        -> 4 cases red
 *   - the `userId` filter term in `listForIntegration` / `listForOwner`   -> 5 cases red
 *   - the `orgId` filter term in the same two reads                       -> 3 cases red
 *   - `scrubSecretText` in `feedbackPromptSection`                        -> 3 cases red (one per seam)
 *
 * The scrub is ONE call and reddens all three seam cases, which is deliberate: `action-feedback.ts`
 * turns rows into prompt text in exactly one place, so there is one thing to remove and three
 * places that notice. Three copies of the call would be three chances for a fourth seam to forget.
 *
 * ── THE POSITIVE CONTROL COMES FIRST, ALWAYS ──────────────────────────────────────────────────
 *
 * Every describe below opens with the OWNER succeeding. A tenancy suite whose fixture quietly
 * stopped writing anything would pass every refusal case forever, which is the failure mode the
 * sibling suites call out by name.
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_s3_feedback_isolation');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  __resetConfigForTests();
});

beforeEach(async () => {
  await integrationActionFeedback.deleteMany({});
  await integrationDefinitions.deleteMany({});
});

const KEY = 's3-feedback-probe';
const ACTION = 'consultar_processo';
const OTHER_ACTION = 'exportar_clientes';
const STEP = 'abrir-portal';

/** Sentinels are COMPOSED, never literals: the gitleaks gate must keep firing on real pasted keys. */
const compose = (...parts: string[]): string => parts.join('');
const OWNER_SECRET = compose('sk_', 'live_', 'OWNERaaaa1111bbbb2222cccc');
const PEER_MARKER = 'NOTA-DO-COLEGA-QUE-NAO-DEVE-VIAJAR';
const FOREIGN_MARKER = 'NOTA-DE-OUTRO-INQUILINO';

const owner: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
/** Same ORG, different person. The case an org-only key would silently pass. */
const peer: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
/** Another tenant entirely, with the SAME user id shape - so nothing passes on id novelty alone. */
const foreign: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };

async function seedDefinition(orgId: string, userId: string, visibility: DefinitionVisibility, actionNames: string[]): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility, key: KEY,
      displayName: 'S3 Feedback Probe', configSchema: [],
      actions: actionNames.map((actionName) => ({
        actionName,
        description: `faz ${actionName}`,
        mutates: false,
        httpConfig: { method: 'GET' as const, baseUrl: 'https://portal.example', path: `/${actionName}` },
      })),
      skillMd: '# S3 Feedback Probe\n',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

/** A row through the REAL store, keyed with all five production terms. */
async function seedNote(actor: Actor, note: string, opts: { actionName?: string; stepRef?: string } = {}) {
  return actionFeedbackStore.putFeedback(
    {
      orgId: actor.orgId,
      userId: actor.userId,
      integrationKey: KEY,
      actionName: opts.actionName ?? ACTION,
      ...(opts.stepRef !== undefined ? { stepRef: opts.stepRef } : {}),
    },
    note,
  );
}

// ---------------------------------------------------------------------------------------------
// THE STORE
// ---------------------------------------------------------------------------------------------

describe('the feedback store is keyed by org AND user, on every method', () => {
  it('THE CONTROL: the owner writes a note and reads it back through every read', async () => {
    await seedNote(owner, 'o portal exige o numero com zeros a esquerda');
    const key = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };

    expect((await actionFeedbackStore.getFeedback(key))?.note).toContain('zeros a esquerda');
    expect(await actionFeedbackStore.listForIntegration('orgA', 'userA1', KEY)).toHaveLength(1);
    expect(await actionFeedbackStore.listForOwner('orgA', 'userA1')).toHaveLength(1);
  });

  it('ANOTHER ORG reaches nothing, on the point read and on both listings', async () => {
    await seedNote(owner, `segredo do dono ${OWNER_SECRET}`);

    // Same integration, same action, same everything but the tenant.
    expect(await actionFeedbackStore.getFeedback({ orgId: 'orgB', userId: 'userA1', integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await actionFeedbackStore.listForIntegration('orgB', 'userA1', KEY)).toEqual([]);
    expect(await actionFeedbackStore.listForOwner('orgB', 'userA1')).toEqual([]);
  });

  it('A SAME-ORG PEER reaches nothing either - the case an org-only key would pass', async () => {
    await seedNote(owner, `segredo do dono ${OWNER_SECRET}`);

    expect(await actionFeedbackStore.getFeedback({ orgId: 'orgA', userId: 'userA2', integrationKey: KEY, actionName: ACTION })).toBeNull();
    expect(await actionFeedbackStore.listForIntegration('orgA', 'userA2', KEY)).toEqual([]);
    expect(await actionFeedbackStore.listForOwner('orgA', 'userA2')).toEqual([]);
  });

  it('a peer WRITING the same tuple writes THEIR OWN row: neither note is destroyed', async () => {
    // The failure this case is written against is the one the evidence store had in round eight
    // under an org-only key: the second person's write landed on the same `_id` and the first
    // person's data was gone. Both notes must survive, addressable only by their own author.
    await seedNote(owner, 'a nota do dono');
    await seedNote(peer, `a nota do colega ${PEER_MARKER}`);

    const ownerRows = await actionFeedbackStore.listForIntegration('orgA', 'userA1', KEY);
    const peerRows = await actionFeedbackStore.listForIntegration('orgA', 'userA2', KEY);
    expect(ownerRows).toHaveLength(1);
    expect(peerRows).toHaveLength(1);
    expect(ownerRows[0]!.note).toBe('a nota do dono');
    expect(peerRows[0]!.note).toContain(PEER_MARKER);
    expect(ownerRows[0]!._id).not.toBe(peerRows[0]!._id);
  });

  it('a peer CANNOT erase the owner\'s note, and the owner can', async () => {
    await seedNote(owner, 'a nota do dono');
    const asPeer = { orgId: 'orgA', userId: 'userA2', integrationKey: KEY, actionName: ACTION };
    const asForeign = { orgId: 'orgB', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    const asOwner = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };

    expect(await actionFeedbackStore.discardFeedback(asPeer)).toBe(false);
    expect(await actionFeedbackStore.discardFeedback(asForeign)).toBe(false);
    // …and the row is STILL THERE, which is the assertion a `false` return alone does not make.
    expect(await actionFeedbackStore.getFeedback(asOwner)).toBeTruthy();

    expect(await actionFeedbackStore.discardFeedback(asOwner)).toBe(true);
    expect(await actionFeedbackStore.getFeedback(asOwner)).toBeNull();
  });

  it('a row whose stored org/user disagrees with its id is NOT handed out (fail closed)', async () => {
    // `putFeedback` cannot write this shape; it arrives by hand, by a partial restore, or from a
    // future writer. That is exactly when the re-check on the fetched document is worth having, and
    // exactly when nobody is watching - so it is pinned rather than trusted.
    const key = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    await integrationActionFeedback.insert({
      _id: actionFeedbackIdFor(key),
      orgId: 'orgB', userId: 'userA2', integrationKey: KEY, actionName: ACTION,
      note: 'planted', createdAt: '2026-08-22T09:00:00.000Z', updatedAt: '2026-08-22T09:00:00.000Z',
    } as never);

    expect(await actionFeedbackStore.getFeedback(key)).toBeNull();
  });
});

describe('the deterministic id addresses exactly one note', () => {
  it('every term moves the id, INCLUDING the step ref and its absence', async () => {
    const base = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    const id = actionFeedbackIdFor(base);
    for (const variant of [
      { ...base, orgId: 'orgB' },
      { ...base, userId: 'userA2' },
      { ...base, integrationKey: 'other-key' },
      { ...base, actionName: OTHER_ACTION },
      { ...base, stepRef: STEP },
    ]) {
      expect(actionFeedbackIdFor(variant), JSON.stringify(variant)).not.toBe(id);
    }
    // Stable for the same tuple - the property that makes the write idempotent.
    expect(actionFeedbackIdFor({ ...base })).toBe(id);
  });

  it('two tuples that a naive join would COLLIDE keep separate rows', async () => {
    // The injectivity argument, made concretely. Under a `::` join these two tuples produce the
    // same string, so one person's note about `a` step `b::c` would be the same document as their
    // note about `a::b` step `c` - and whichever was written second would silently replace the
    // other. JSON encoding is what makes them different points.
    const left = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: 'a', stepRef: 'b::c' };
    const right = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: 'a::b', stepRef: 'c' };
    expect(actionFeedbackIdFor(left)).not.toBe(actionFeedbackIdFor(right));

    await actionFeedbackStore.putFeedback(left, 'a nota da esquerda');
    await actionFeedbackStore.putFeedback(right, 'a nota da direita');
    expect((await actionFeedbackStore.getFeedback(left))?.note).toBe('a nota da esquerda');
    expect((await actionFeedbackStore.getFeedback(right))?.note).toBe('a nota da direita');
  });

  it('the action note and a step note are DIFFERENT rows at the same action', async () => {
    await seedNote(owner, 'sobre a acao toda');
    await seedNote(owner, 'sobre este passo', { stepRef: STEP });

    const rows = await actionFeedbackStore.listForIntegration('orgA', 'userA1', KEY);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.note).sort()).toEqual(['sobre a acao toda', 'sobre este passo']);
  });

  it('a rewrite SUPERSEDES in place, KEEPS createdAt and MOVES updatedAt - on an injected clock', async () => {
    // THE CLOCK IS STEPPED, AND THAT IS THE WHOLE POINT OF THIS CASE. Two things went wrong here
    // before the review, and both were invisible against `new Date()`:
    //
    //   - the createdAt half RODE THE WALL CLOCK. Two consecutive writes land in the same
    //     millisecond often enough (measured at roughly a third of pairs) that a `put`-style
    //     restamp - the exact regression the store's shape exists to prevent - passed on any run
    //     where the stamps happened to collide. A coin flip is not a pin.
    //   - the updatedAt half COULD NOT FAIL AT ALL. The contract suite asserted `second >= first`,
    //     which is satisfied by a stamp that never moves, so freezing `updatedAt` on the CAS swap
    //     reddened nothing anywhere in the estate. That matters in production: `newestFirst` orders
    //     the prompt view by `updatedAt` and `listForOwner` keeps the newest twenty by it, so a
    //     frozen stamp means the guidance a person most recently corrected is the first thing the
    //     cap drops and the last thing the prompt orders.
    //
    // A stepping clock makes both halves deterministic and strict: `createdAt` must be EQUAL and
    // `updatedAt` must be STRICTLY GREATER, and there is no run in which those hold by accident.
    let tick = 0;
    const stepping = new ActionFeedbackStore(
      integrationActionFeedback,
      () => new Date(Date.UTC(2026, 7, 22, 9, 0, tick++)),
    );
    const key = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };

    const first = await stepping.putFeedback(key, 'primeira versao');
    const second = await stepping.putFeedback(key, 'segunda versao');

    expect(second._id).toBe(first._id);
    expect(second.note).toBe('segunda versao');
    expect(second.createdAt, 'createdAt SURVIVES an edit - the reason this is not a `put`').toBe(first.createdAt);
    expect(
      second.updatedAt > first.updatedAt,
      'updatedAt MOVES on an edit - the half a `>=` comparison could never enforce',
    ).toBe(true);
    // And the stamps really did differ, so the equality above is not two identical clock reads.
    expect(second.updatedAt).not.toBe(first.updatedAt);
    expect(await actionFeedbackStore.listForIntegration('orgA', 'userA1', KEY)).toHaveLength(1);
  });

  it('the newest-first prompt order follows the EDIT, not the creation', async () => {
    // The production consequence of a frozen `updatedAt`, asserted as behaviour rather than as a
    // stamp: re-editing the older note must move it to the front of the prompt read.
    let tick = 0;
    const stepping = new ActionFeedbackStore(
      integrationActionFeedback,
      () => new Date(Date.UTC(2026, 7, 22, 9, 0, tick++)),
    );
    const older = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    const newer = { ...older, stepRef: STEP };

    await stepping.putFeedback(older, 'a primeira que escrevi');
    await stepping.putFeedback(newer, 'a segunda que escrevi');
    // …then correct the FIRST one, which must now be the most recent thing this person believes.
    await stepping.putFeedback(older, 'a primeira, corrigida');

    const rows = await actionFeedbackStore.listForOwner('orgA', 'userA1');
    expect(rows.map((r) => r.note)).toEqual(['a primeira, corrigida', 'a segunda que escrevi']);
  });

  it('a note DELETED between the failed claim and the swap is re-created, not lost', async () => {
    // The one race the claim-then-swap shape has to survive, and it is an ordinary one: the author
    // discards the note in another tab while this write is in flight. Driven by a store whose
    // `insert` reports the id as taken while the row is really gone - which is exactly the state
    // the driver reports for that interleaving.
    const key = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    const real = integrationActionFeedback;
    const spy = new (class extends (real.constructor as new (n: string) => typeof real) {
      calls = 0;
      override async insert(d: never): Promise<boolean> {
        // Lose the FIRST claim as though the row existed; the row does not, so the swap finds
        // nothing and the second round has to be the one that lands it.
        if (this.calls++ === 0) return false;
        return real.insert(d);
      }
    })(real.name);
    const store = new ActionFeedbackStore(spy as never, () => new Date('2026-08-22T09:00:00.000Z'));

    const written = await store.putFeedback(key, 'a nota que sobreviveu a corrida');
    expect(written.note).toBe('a nota que sobreviveu a corrida');
    expect((await actionFeedbackStore.getFeedback(key))?.note, 'the row must really be on disk')
      .toBe('a nota que sobreviveu a corrida');
  });

  it('the ceiling and the empty note are REFUSALS, never a truncation or a silent delete', async () => {
    const key = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    await expect(actionFeedbackStore.putFeedback(key, 'x'.repeat(ACTION_FEEDBACK_MAX_CHARS + 1)))
      .rejects.toBeInstanceOf(ActionFeedbackStoreError);
    await expect(actionFeedbackStore.putFeedback(key, '   ')).rejects.toBeInstanceOf(ActionFeedbackStoreError);
    // Nothing was written, and nothing was trimmed into existence.
    expect(await actionFeedbackStore.getFeedback(key)).toBeNull();

    // …and the boundary itself is accepted, so the refusal is a ceiling and not an off-by-one wall.
    const at = await actionFeedbackStore.putFeedback(key, 'y'.repeat(ACTION_FEEDBACK_MAX_CHARS));
    expect(at.note).toHaveLength(ACTION_FEEDBACK_MAX_CHARS);
  });
});

// ---------------------------------------------------------------------------------------------
// THE ACTOR-FACING VIEWS
// ---------------------------------------------------------------------------------------------

describe('the author views pass the CALLER\'S OWN identity, never one read off a request', () => {
  beforeEach(async () => {
    await seedDefinition('orgA', 'userA1', 'org', [ACTION]);
  });

  it('THE CONTROL: the owner writes through the view and reads their own note back byte-exact', async () => {
    const written = await writeFeedbackFor(owner, KEY, ACTION, { note: `com um segredo ${OWNER_SECRET}` });
    expect(written.ok).toBe(true);

    const read = await listFeedbackFor(owner, KEY);
    expect(read.ok).toBe(true);
    // BYTE-EXACT and NOT scrubbed: this is the editor's view, and a scrubbed one would write the
    // redaction back into the person's own sentence on their next ordinary save (A3 review F3).
    expect(read.ok && read.value[0]!.note).toContain(OWNER_SECRET);
  });

  it('a same-org PEER sees their own notes and not the owner\'s, at the same visible action', async () => {
    await writeFeedbackFor(owner, KEY, ACTION, { note: `do dono ${OWNER_SECRET}` });
    await writeFeedbackFor(peer, KEY, ACTION, { note: `do colega ${PEER_MARKER}` });

    const asPeer = await listFeedbackFor(peer, KEY);
    expect(asPeer.ok).toBe(true);
    expect(asPeer.ok && asPeer.value).toHaveLength(1);
    expect(asPeer.ok && asPeer.value[0]!.note).toContain(PEER_MARKER);
    expect(JSON.stringify(asPeer)).not.toContain(OWNER_SECRET);
  });

  it('ANOTHER ORG gets the house 404 rather than an empty list - no existence oracle', async () => {
    await writeFeedbackFor(owner, KEY, ACTION, { note: 'do dono' });

    const read = await listFeedbackFor(foreign, KEY);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.refusal).toBe('not_found');
    // The write refuses through the same resolution, so a foreign caller cannot seed a row either.
    const write = await writeFeedbackFor(foreign, KEY, ACTION, { note: FOREIGN_MARKER });
    expect(write.ok).toBe(false);
    expect(await actionFeedbackStore.listForOwner('orgB', 'userB1')).toEqual([]);
  });

  it('an action that is NOT on the caller\'s definition is refused, byte-identically to a missing key', async () => {
    // The write's only bound. Without it this route is a general-purpose per-user blob store
    // addressable at any `(key, actionName)` a client invents - every one of which then rides back
    // into that person's own prompts.
    const unknownAction = await writeFeedbackFor(owner, KEY, OTHER_ACTION, { note: 'nao devia existir' });
    const unknownKey = await writeFeedbackFor(owner, 'no-such-key', ACTION, { note: 'nao devia existir' });
    expect(unknownAction.ok).toBe(false);
    expect(unknownKey.ok).toBe(false);
    expect(!unknownAction.ok && unknownAction.refusal).toBe(!unknownKey.ok && unknownKey.refusal);
    expect(await actionFeedbackStore.listForOwner('orgA', 'userA1')).toEqual([]);
  });

  it('the DELETE still works for a note whose action has left the package', async () => {
    // Deliberately NOT symmetric with the write: a note whose action was re-authored away is
    // exactly the one its author most needs to remove, and refusing would strand it.
    await seedNote(owner, 'sobre uma acao que ja nao existe', { actionName: OTHER_ACTION });
    const out = await discardFeedbackFor(owner, KEY, OTHER_ACTION, undefined);
    expect(out.ok && out.value).toBe(true);
    expect(await actionFeedbackStore.listForOwner('orgA', 'userA1')).toEqual([]);
  });

  it('the DELETE is idempotent and a peer\'s attempt is a no-op on the owner\'s row', async () => {
    await writeFeedbackFor(owner, KEY, ACTION, { note: 'do dono' });

    const byPeer = await discardFeedbackFor(peer, KEY, ACTION, undefined);
    expect(byPeer.ok && byPeer.value, 'a peer erases nothing').toBe(false);
    expect(await actionFeedbackStore.listForIntegration('orgA', 'userA1', KEY)).toHaveLength(1);

    expect((await discardFeedbackFor(owner, KEY, ACTION, undefined) as { value: boolean }).value).toBe(true);
    // Erasing again is `ok` with `false`, never a 404: the state the caller asked for holds.
    const again = await discardFeedbackFor(owner, KEY, ACTION, undefined);
    expect(again.ok && again.value).toBe(false);
  });

  it('the DELETE without a step ref leaves the STEP notes alone', async () => {
    await seedNote(owner, 'sobre a acao');
    await seedNote(owner, 'sobre o passo', { stepRef: STEP });

    await discardFeedbackFor(owner, KEY, ACTION, undefined);
    const left = await actionFeedbackStore.listForIntegration('orgA', 'userA1', KEY);
    expect(left).toHaveLength(1);
    expect(left[0]!.stepRef).toBe(STEP);
  });
});

// ---------------------------------------------------------------------------------------------
// THE THREE PROMPT SEAMS - the half a store-level suite cannot see
// ---------------------------------------------------------------------------------------------

describe('every prompt seam carries the CALLER\'S OWN notes, scrubbed, and nobody else\'s', () => {
  beforeEach(async () => {
    await seedDefinition('orgA', 'userA1', 'org', [ACTION]);
    // The owner's own note carries a pasted credential IN A CREDENTIAL-VALUE POSITION - the
    // A2-review F7 shape, and the shape `scrubSecretText` is anchored on (`definitions.ts`: the
    // value of a credential-named key, or the text after an auth scheme word). Every seam below
    // must show the owner the PROSE of their own note with the credential gone, and must not show
    // them a byte of the peer's.
    //
    // THE ANCHORING IS A REAL LIMIT AND IT IS PINNED SEPARATELY BELOW, not papered over by picking
    // a convenient fixture: a bare pasted token sitting in ordinary prose is NOT redacted by this
    // floor, here or in the lessons body that shares it.
    await seedNote(owner, `o portal recusa sem o referer; api_key: ${OWNER_SECRET}`);
    await seedNote(peer, `nota do colega ${PEER_MARKER}`);
    await seedNote(foreign, `nota de outro inquilino ${FOREIGN_MARKER}`);
  });

  it('SEAM 1 (load_context): the per-integration prompt view is scrubbed and owner-scoped', async () => {
    const section = await feedbackForPrompt(owner, KEY);
    expect(section, 'THE CONTROL: the owner\'s own prose reaches the prompt').toContain('recusa sem o referer');
    expect(section).not.toContain(OWNER_SECRET);
    expect(section).not.toContain(PEER_MARKER);
    expect(section).not.toContain(FOREIGN_MARKER);

    // …and through the real composition the composition root performs, beside the other two halves.
    const composed = composeIntegrationContext('# Portal\n\nDocs.', 'A licao da organizacao.', section);
    expect(composed).toContain('Docs.');
    expect(composed).toContain('A licao da organizacao.');
    expect(composed).toContain('recusa sem o referer');
    expect(composed).not.toContain(OWNER_SECRET);
    expect(composed).not.toContain(PEER_MARKER);
  });

  it('SEAM 1b: the peer reading the SAME integration gets their own note and not the owner\'s', async () => {
    const section = await feedbackForPrompt(peer, KEY);
    expect(section).toContain(PEER_MARKER);
    expect(section).not.toContain('recusa sem o referer');
    expect(section).not.toContain(OWNER_SECRET);
  });

  it('SEAM 2 (planner + rehearsal): the owner-scoped sections are scrubbed and never org-wide', async () => {
    const sections = await feedbackSectionsForOwner(owner);
    const blob = sections.join('\n');
    expect(blob, 'THE CONTROL').toContain('recusa sem o referer');
    expect(blob).not.toContain(OWNER_SECRET);
    expect(blob).not.toContain(PEER_MARKER);
    expect(blob).not.toContain(FOREIGN_MARKER);

    // The peer's own read is theirs, which is what proves the widening is of the KEY and not of the
    // identity: this seam reads across every integration, and still only one person's rows.
    const peerBlob = (await feedbackSectionsForOwner(peer)).join('\n');
    expect(peerBlob).toContain(PEER_MARKER);
    expect(peerBlob).not.toContain('recusa sem o referer');
  });

  it('SEAM 2: an actor with no org resolves to NO sections rather than to everything', async () => {
    // The composition root refuses an org-less owner before this is reached; the module refuses too,
    // because an empty org term in a Mongo filter is a value and not a wildcard only as long as
    // somebody keeps passing it.
    expect(await feedbackSectionsForOwner({ userId: 'userA1', orgId: '', role: 'user' })).toEqual([]);
    expect(await feedbackForPrompt({ userId: '', orgId: 'orgA', role: 'user' }, KEY)).toBeNull();
  });

  it('SEAM 3 (achieve): the drafting hint is the AUTHOR\'S own, through the same scrubbed view', async () => {
    // `achieve` builds its content section from `feedbackForPrompt(ctx.actor, key)` - the identical
    // call seam 1 makes - so what is asserted here is that the ACTOR it passes is the caller. The
    // end-to-end proof that the section reaches the drafting turn is in
    // tests/integrations/action-feedback-seams.test.ts, which drives the real drafter.
    const asOwner = await feedbackForPrompt(owner, KEY);
    const asPeer = await feedbackForPrompt(peer, KEY);
    expect(asOwner).not.toBe(asPeer);
    expect(asOwner).toContain('recusa sem o referer');
    expect(asPeer).toContain(PEER_MARKER);
  });

  it('a note that is nothing BUT a credential comes back redacted, and still says so', async () => {
    await integrationActionFeedback.deleteMany({});
    await seedNote(owner, `api_key: ${OWNER_SECRET}`);
    const section = await feedbackForPrompt(owner, KEY);
    expect(section).not.toContain(OWNER_SECRET);
    // `[REDACTED]` and NOT an empty line: the floor SUBSTITUTES rather than deletes, so a note can
    // never scrub down to nothing. That is why `feedbackPromptSection`'s empty-note guard is
    // documented there as unreachable through this floor rather than pinned as behaviour here - a
    // test asserting it would be asserting something no production input produces.
    expect(section).toContain('[REDACTED]');
    // The field NAME survives, by design: the floor is value-anchored precisely so that
    // documentation about `api_key` can be written at all.
    expect(section).toContain('api_key');
  });

  it('NO SECTION AT ALL when the caller holds no note - not a heading over an empty list', async () => {
    await integrationActionFeedback.deleteMany({});
    // An empty section is not nothing: it spends tokens and tells a model that a channel exists.
    expect(await feedbackForPrompt(owner, KEY)).toBeNull();
    expect(await feedbackSectionsForOwner(owner)).toEqual([]);
    // And the composition falls back to exactly what it produced before this slice.
    expect(composeIntegrationContext('# Portal\n\nDocs.', null, null)).toBe('# Portal\n\nDocs.');
  });

  it('a credential written as a STEP REF is scrubbed too - the floor covers the LINE, not one field', async () => {
    // THE REVIEW'S FINDING, pinned in both directions. `stepRef` is caller-supplied free text that
    // is deliberately never validated against a plan, and it is interpolated into the same prompt
    // line as the note - so an ANCHORED credential written as a step ref used to ride into all
    // three seams unredacted while the identical bytes in the note body were redacted. Every
    // earlier scrub assertion planted its secret in the note, which is exactly why the M5 mutation
    // proof was blind to this.
    await integrationActionFeedback.deleteMany({});
    await seedNote(owner, 'nota inocente', { stepRef: `api_key: ${OWNER_SECRET}` });

    for (const section of [await feedbackForPrompt(owner, KEY), (await feedbackSectionsForOwner(owner)).join('\n')]) {
      expect(section, 'THE CONTROL: the prose still arrives').toContain('nota inocente');
      expect(section).not.toContain(OWNER_SECRET);
      expect(section).toContain('[REDACTED]');
    }
  });

  it('an ordinary step ref survives the line scrub untouched - no over-redaction', async () => {
    await integrationActionFeedback.deleteMany({});
    await seedNote(owner, 'este passo demora', { stepRef: 'abrir-portal' });
    const section = await feedbackForPrompt(owner, KEY);
    // The scrub is value-anchored and token-scanned, so a slug is prose and stays prose.
    expect(section).toContain('abrir-portal');
    expect(section).toContain('este passo demora');
    expect(section).not.toContain('[REDACTED]');
  });

  it('the store enforces the stepRef CEILING, not only the wire schema', async () => {
    const key = {
      orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION,
      stepRef: 'x'.repeat(ACTION_FEEDBACK_STEP_REF_MAX_CHARS + 1),
    };
    await expect(actionFeedbackStore.putFeedback(key, 'nota')).rejects.toBeInstanceOf(ActionFeedbackStoreError);
    // …and the boundary itself is accepted, so this is a ceiling and not an off-by-one wall.
    const at = await actionFeedbackStore.putFeedback(
      { ...key, stepRef: 'y'.repeat(ACTION_FEEDBACK_STEP_REF_MAX_CHARS) },
      'nota',
    );
    expect(at.stepRef).toHaveLength(ACTION_FEEDBACK_STEP_REF_MAX_CHARS);
  });

  it('one action holds at most ACTION_FEEDBACK_MAX_NOTES_PER_ACTION notes, and an EDIT is never refused', async () => {
    // The growth vector the review named: `stepRef` is unvalidated and every distinct one is a
    // distinct row that nothing ever collects.
    await integrationActionFeedback.deleteMany({});
    const base = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    for (let i = 0; i < ACTION_FEEDBACK_MAX_NOTES_PER_ACTION; i++) {
      await actionFeedbackStore.putFeedback({ ...base, stepRef: `passo-${i}` }, `nota ${i}`);
    }
    await expect(
      actionFeedbackStore.putFeedback({ ...base, stepRef: 'um-a-mais' }, 'a nota a mais'),
    ).rejects.toMatchObject({ code: 'TOO_MANY' });

    // AN EDIT OF AN EXISTING ROW STILL LANDS at the ceiling - the row exists, so the count does not
    // move, and refusing it would strand a person at the cap unable to correct what they wrote.
    const edited = await actionFeedbackStore.putFeedback({ ...base, stepRef: 'passo-0' }, 'a nota 0, corrigida');
    expect(edited.note).toBe('a nota 0, corrigida');
    // …and a DIFFERENT action of the same integration is unaffected: the cap is per action.
    const other = await actionFeedbackStore.putFeedback({ ...base, actionName: OTHER_ACTION }, 'noutra acao');
    expect(other.note).toBe('noutra acao');
  });

  it('the per-integration PROMPT read is bounded in the query, newest first', async () => {
    await integrationActionFeedback.deleteMany({});
    let tick = 0;
    const stepping = new ActionFeedbackStore(
      integrationActionFeedback,
      () => new Date(Date.UTC(2026, 7, 22, 9, 0, tick++)),
    );
    const base = { orgId: 'orgA', userId: 'userA1', integrationKey: KEY, actionName: ACTION };
    for (let i = 0; i < 25; i++) await stepping.putFeedback({ ...base, stepRef: `passo-${i}` }, `nota ${i}`);

    const bounded = await actionFeedbackStore.listNewestForIntegration('orgA', 'userA1', KEY);
    expect(bounded).toHaveLength(FEEDBACK_PROMPT_MAX_NOTES);
    // Newest first: the last written is the first returned, and the oldest fell off the QUERY.
    expect(bounded[0]!.note).toBe('nota 24');
    expect(bounded.map((r) => r.note)).not.toContain('nota 0');
    // The AUTHOR'S page read is deliberately NOT bounded - completeness is its contract.
    expect(await actionFeedbackStore.listForIntegration('orgA', 'userA1', KEY)).toHaveLength(25);
  });

  it('THE FLOOR IS VALUE-ANCHORED: a bare token in prose SURVIVES, and that is recorded as a limit', async () => {
    // NOT a defect this slice introduces and NOT a claim it can make go away: `scrubSecretText` is
    // the repo's read-path floor and it redacts at two POSITIONS - the value of a credential-named
    // key, and the text after an auth scheme word - precisely so that documentation of field names
    // and ordinary prose survive (`definitions.ts`, the A3 re-review LOW-2/LOW-3 note). A credential
    // pasted into a sentence with no such anchor is outside it, here and in the lessons body that
    // shares the same floor.
    //
    // Pinned rather than left implicit, because a reader of this suite would otherwise reasonably
    // conclude that a note cannot carry a credential out. It can, in this one shape. The mitigations
    // are the surface's own: the note editor says in both locales that the assistant reads what is
    // typed, and the text never leaves the author's own prompts. OPEN in docs/findings.md as
    // `a-bare-pasted-credential-in-note-prose-is-outside-the-value-anchored-floor`.
    await integrationActionFeedback.deleteMany({});
    await seedNote(owner, `a chave e ${OWNER_SECRET} e vale para tudo`);
    expect(await feedbackForPrompt(owner, KEY)).toContain(OWNER_SECRET);
  });
});
