/**
 * COMPILED-RECIPE + CAPTURED-CALLS isolation suite (slice P2.0) - a memvault-class Rule-5 net.
 *
 * A compiled recipe is what discovery learned inside ONE tenant's authenticated session: which
 * internal endpoints the portal exposes, how it paginates, which header carries its session token.
 * The raw captures behind it are that session's traffic. Both are tenant data of the sharpest kind,
 * so this suite attacks the boundary directly against a REAL (in-memory) Mongo, through every
 * exported method of both stores, with two orgs and two users inside org A:
 *
 *   - org A cannot READ, ENUMERATE, WRITE or SUPERSEDE org B's recipe, whatever it names;
 *   - a recipe on a `global` (published, cross-org) definition is STILL org B's: visibility widens
 *     the package, never the learning;
 *   - a same-org peer and the org-admin cannot read a recipe on another user's PRIVATE definition,
 *     and a foreign super-admin cannot read one at all;
 *   - a supersede is tenant-scoped and touches NOTHING else: not `visibility`, not the published
 *     snapshot, not the publish request (the point of not reusing `publishSnapshot`, whose gate is
 *     super-admin and whose effect is `global`);
 *   - org A cannot read, enumerate or discard org B's captures, and appending under org A never
 *     lands in org B's key space.
 *
 * NON-TAUTOLOGY, AND SENSITIVITY. Every negative is paired with the OWNER-side positive on the same
 * row in the same test, so a null is the tenancy gate firing and not an empty database. Sensitivity
 * was then MEASURED rather than assumed - each tenancy filter was deleted in turn and the suite
 * re-run. It goes RED for: `orgId` dropped from either deterministic `_id` derivation
 * (`definitionIdFor`, `capturedCallIdFor`), the `orgId` term of the capture query filters, either
 * post-fetch `orgId` re-check, the actor read's visibility gate, and the enumeration's org filter.
 * The one PAIR it cannot separate is the write path's tenancy check, which is deliberately doubled
 * (a pre-check plus the in-mutator re-assert, the E1-review F4b pattern): deleting either alone
 * leaves the other holding, and the suite goes red when the pair goes. That is a property of
 * belt-and-braces gates, and it is recorded here so a future reader knows this suite was measured
 * against exactly that question and where the limit is.
 *
 * The two "planted row" tests exist for that measurement: a document stored under one org's derived
 * id while declaring itself another's is the only shape in which the post-fetch re-checks are the
 * ONLY thing standing between the orgs.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
  type DefinitionVisibility,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { IntegrationRecipeStore, type RecipeDraft } from '../../src/integrations/recipe-store.js';
import {
  CapturedCallsStore,
  capturedCallIdFor,
  type CaptureKey,
} from '../../src/integrations/captured-calls-store.js';

let mem: MongoMemoryServer;

const userA1: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const userA2: Actor = { userId: 'userA2', orgId: 'orgA', role: 'user' };
const adminA: Actor = { userId: 'adminA', orgId: 'orgA', role: 'org-admin' };
const userB1: Actor = { userId: 'userB1', orgId: 'orgB', role: 'user' };
/** A super-admin who belongs to org A. Platform role, and still not a member of org B. */
const superAdminA: Actor = { userId: 'root', orgId: 'orgA', role: 'super-admin' };

let clock = 0;
const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const recipes = new IntegrationRecipeStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const captures = new CapturedCallsStore(integrationCapturedCalls, () => new Date(1_700_000_000_000 + clock++));

const draft = (orgId: string, userId: string, key: string, visibility: DefinitionVisibility): IntegrationDefinitionCreate => ({
  orgId,
  userId,
  key,
  visibility,
  configSchema: [],
  actions: [
    { actionName: 'list_processos', description: 'lista', mutates: false },
    { actionName: 'abrir_processo', description: 'abre', mutates: false },
  ],
  skillMd: `# ${key}\n`,
});

const createRow = (input: IntegrationDefinitionCreate) =>
  definitions.create(input, {
    actor: { userId: input.userId, orgId: input.orgId, role: input.visibility === 'global' ? 'super-admin' : 'user' },
  });

const recipeDraft = (goal: string): RecipeDraft => ({
  goal,
  injectedCalls: [
    {
      method: 'GET',
      urlTemplate: 'https://portal.example.pt/api/processos?page={{input.page}}',
      headerNames: ['cookie', 'x-csrf-token'],
      idempotent: true,
    },
  ],
  scriptedSteps: [{ locator: { strategy: 'role', role: 'button', name: 'Entrar' }, action: 'click' }],
  lessons: ['pagination is ?page=N', 'the session rides the cookie header'],
});

const captureKey = (orgId: string, captureId = 'cap1'): CaptureKey => ({
  orgId,
  integrationKey: 'citius',
  actionName: 'list_processos',
  captureId,
});

const capturedInput = {
  method: 'GET',
  url: 'https://portal.example.pt/api/processos?page=1',
  requestHeaderNames: ['cookie', 'accept'],
  responseHeaderNames: ['content-type'],
  status: 200,
  responseBody: '{"items":[]}',
};

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_security_recipe_isolation');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 0;
  await integrationDefinitions.deleteMany({});
  await integrationCapturedCalls.deleteMany({});
});

describe('recipe store: a recipe never leaves its authoring org', () => {
  it('org A cannot read, enumerate, write or supersede org B\'s recipe', async () => {
    await createRow(draft('orgB', 'userB1', 'citius', 'org'));
    const written = await recipes.putRecipe('orgB', 'citius', 'list_processos', recipeDraft('listar processos de B'));
    expect(written.verdict).toBe('ok');

    // The owner side, first - so every null below is the gate and not an empty collection.
    expect((await recipes.getRecipe('orgB', 'citius', 'list_processos'))?.goal).toBe('listar processos de B');
    expect(await recipes.listRecipes('orgB', 'citius')).toHaveLength(1);
    expect(await recipes.listRecipesForActor(userB1)).toHaveLength(1);

    // …and org A, naming the very same integration + action, sees nothing.
    expect(await recipes.getRecipe('orgA', 'citius', 'list_processos')).toBeNull();
    expect(await recipes.getRecipeForActor(userA1, 'citius', 'list_processos')).toBeNull();
    expect(await recipes.listRecipes('orgA', 'citius')).toEqual([]);
    expect(await recipes.listRecipesForActor(userA1)).toEqual([]);
    expect(await recipes.listRecipesForActor(adminA)).toEqual([]);
    expect(await recipes.listRecipesForActor(superAdminA)).toEqual([]);

    // Writes under org A neither reach nor damage B's row.
    expect(await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('A tenta escrever'))).toEqual({ verdict: 'notfound' });
    expect(
      await recipes.supersedeRecipe('orgA', 'citius', 'list_processos', { ...recipeDraft('A tenta substituir'), reason: 'drift' }),
    ).toEqual({ verdict: 'notfound' });
    const after = await recipes.getRecipe('orgB', 'citius', 'list_processos');
    expect(after?.goal).toBe('listar processos de B');
    expect(after?.version).toBe(1);
  });

  it('a recipe on a GLOBAL definition is still the authoring org\'s - publication widens the package, not the learning', async () => {
    await createRow(draft('orgB', 'userB1', 'shared-portal', 'global'));
    expect((await recipes.putRecipe('orgB', 'shared-portal', 'list_processos', recipeDraft('global-row recipe'))).verdict).toBe('ok');

    // Non-tautology: org A genuinely RESOLVES this definition (that is what `global` means)…
    expect((await definitions.getForActor(userA1, 'shared-portal'))?._id).toBe(definitionIdFor('orgB', 'shared-portal'));
    // …and still gets nothing of its recipe, through the actor read or the org-keyed read.
    expect(await recipes.getRecipeForActor(userA1, 'shared-portal', 'list_processos')).toBeNull();
    expect(await recipes.getRecipeForActor(superAdminA, 'shared-portal', 'list_processos')).toBeNull();
    expect(await recipes.getRecipe('orgA', 'shared-portal', 'list_processos')).toBeNull();
    expect(await recipes.listRecipesForActor(userA1)).toEqual([]);
    expect((await recipes.getRecipeForActor(userB1, 'shared-portal', 'list_processos'))?.goal).toBe('global-row recipe');
  });

  it('a PRIVATE definition\'s recipe is invisible to a same-org peer and to the org-admin', async () => {
    await createRow(draft('orgA', 'userA1', 'citius', 'private'));
    expect((await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('privado do A1'))).verdict).toBe('ok');

    expect((await recipes.getRecipeForActor(userA1, 'citius', 'list_processos'))?.goal).toBe('privado do A1');
    expect(await recipes.listRecipesForActor(userA1)).toHaveLength(1);
    for (const other of [userA2, adminA, userB1]) {
      expect(await recipes.getRecipeForActor(other, 'citius', 'list_processos'), other.userId).toBeNull();
      expect(await recipes.listRecipesForActor(other), other.userId).toEqual([]);
    }
    // The org-keyed read is the MACHINE surface (the run loop holds the run owner's org), so it
    // deliberately answers inside the org - pinned here so the two surfaces' contracts stay explicit.
    expect((await recipes.getRecipe('orgA', 'citius', 'list_processos'))?.goal).toBe('privado do A1');
  });

  it('a row whose stored orgId disagrees with the id it lives under is reachable by neither org', async () => {
    // The id derivation is the primary tenancy gate, so it is also the one a hand-written or
    // migrated document can be out of step with. This plants exactly that: a document sitting at
    // org A's derived id while declaring itself org B's - the case the post-fetch `orgId` re-check
    // and the in-mutator re-assert exist for, and the case that makes them load-bearing rather
    // than decorative.
    await integrationDefinitions.put({
      _id: definitionIdFor('orgA', 'forjada'),
      orgId: 'orgB',
      userId: 'userB1',
      visibility: 'org',
      key: 'forjada',
      configSchema: [],
      actions: [
        {
          actionName: 'list_processos',
          description: 'lista',
          mutates: false,
          recipe: {
            version: 3,
            goal: 'segredo de B',
            injectedCalls: [],
            scriptedSteps: [],
            lessons: [],
            compiledAt: '2026-08-18T00:00:00.000Z',
          },
        },
      ],
      skillMd: '# forjada\n',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(await recipes.getRecipe('orgA', 'forjada', 'list_processos')).toBeNull();
    expect(await recipes.getRecipeForActor(userA1, 'forjada', 'list_processos')).toBeNull();
    expect(await recipes.listRecipes('orgA', 'forjada')).toEqual([]);
    expect(await recipes.listRecipesForActor(userA1)).toEqual([]);
    expect(await recipes.putRecipe('orgA', 'forjada', 'list_processos', recipeDraft('A escreve'))).toEqual({ verdict: 'notfound' });
    expect(
      await recipes.supersedeRecipe('orgA', 'forjada', 'list_processos', { ...recipeDraft('A substitui'), reason: 'x' }),
    ).toEqual({ verdict: 'notfound' });
    // The planted row is untouched: the refusals above changed nothing.
    const planted = await definitions.getById(definitionIdFor('orgA', 'forjada'));
    expect(planted?.actions[0]?.recipe?.goal).toBe('segredo de B');
    expect(planted?.actions[0]?.recipe?.version).toBe(3);
  });

  it('an org-less actor is nobody: it cannot reach an org-less-keyed row', async () => {
    await createRow(draft('orgA', 'userA1', 'citius', 'org'));
    expect((await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('do A'))).verdict).toBe('ok');
    const orgless: Actor = { userId: '', orgId: '', role: 'user' };
    expect(await recipes.getRecipeForActor(orgless, 'citius', 'list_processos')).toBeNull();
    expect(await recipes.listRecipesForActor(orgless)).toEqual([]);
    expect(await recipes.getRecipe('', 'citius', 'list_processos')).toBeNull();
    expect(await recipes.putRecipe('', 'citius', 'list_processos', recipeDraft('x'))).toEqual({ verdict: 'notfound' });
  });
});

describe('recipe store: supersede is tenant-scoped and touches nothing else', () => {
  it('bumps the version, stamps the one-hop lineage, and leaves visibility + publication alone', async () => {
    await createRow(draft('orgA', 'userA1', 'citius', 'org'));
    await definitions.requestPublish(definitionIdFor('orgA', 'citius'), userA1, 'por favor');
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    const before = await definitions.getById(definitionIdFor('orgA', 'citius'));

    const result = await recipes.supersedeRecipe('orgA', 'citius', 'list_processos', {
      ...recipeDraft('v2'),
      reason: 'selector drift',
    });
    expect(result).toMatchObject({ verdict: 'ok' });
    const stored = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(stored?.version).toBe(2);
    expect(stored?.goal).toBe('v2');
    expect(stored?.supersedes).toEqual({ version: 1, reason: 'selector drift' });

    const after = await definitions.getById(definitionIdFor('orgA', 'citius'));
    expect(after?.visibility).toBe(before?.visibility);
    expect(after?.visibility).toBe('org'); // pinned literally: a supersede is not a publication
    expect(after?.publishedSnapshot).toBeUndefined();
    expect(after?.publishRequest).toEqual(before?.publishRequest);
    // The OTHER action of the same definition is untouched.
    expect(after?.actions.find((a) => a.actionName === 'abrir_processo')?.recipe).toBeUndefined();
  });

  it('org B cannot supersede org A\'s recipe by naming its key and action', async () => {
    await createRow(draft('orgA', 'userA1', 'citius', 'org'));
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1 de A'));
    // org B holds its own definition for the SAME key - the collision the deterministic id prevents.
    await createRow(draft('orgB', 'userB1', 'citius', 'org'));

    expect(
      await recipes.supersedeRecipe('orgB', 'citius', 'list_processos', { ...recipeDraft('roubado'), reason: 'x' }),
    ).toEqual({ verdict: 'notfound' });
    const a = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(a?.goal).toBe('v1 de A');
    expect(a?.version).toBe(1);
    expect(await recipes.getRecipe('orgB', 'citius', 'list_processos')).toBeNull();
  });
});

describe('captured calls: one tenant\'s session traffic', () => {
  it('org A cannot read, enumerate or discard org B\'s captures', async () => {
    const b = captureKey('orgB');
    expect((await captures.appendCapturedCall(b, 0, capturedInput)).verdict).toBe('ok');
    expect((await captures.appendCapturedCall(b, 1, capturedInput)).verdict).toBe('ok');

    // Owner side.
    expect(await captures.listCapture(b)).toHaveLength(2);
    expect(await captures.listCaptureIds('orgB', 'citius', 'list_processos')).toEqual(['cap1']);
    expect((await captures.getCapturedCall(b, 0))?.call.url).toContain('/api/processos');

    // Org A, naming the identical integration/action/capture id.
    const a = captureKey('orgA');
    expect(await captures.listCapture(a)).toEqual([]);
    expect(await captures.listCaptureIds('orgA', 'citius', 'list_processos')).toEqual([]);
    expect(await captures.getCapturedCall(a, 0)).toBeNull();
    expect(await captures.discardCapture(a)).toBe(0);
    // …and B's evidence is intact after A's discard attempt.
    expect(await captures.listCapture(b)).toHaveLength(2);
  });

  it('the same (integration, action, capture, seq) in two orgs are two different documents', async () => {
    expect(capturedCallIdFor(captureKey('orgA'), 0)).not.toBe(capturedCallIdFor(captureKey('orgB'), 0));
    expect((await captures.appendCapturedCall(captureKey('orgA'), 0, capturedInput)).verdict).toBe('ok');
    expect((await captures.appendCapturedCall(captureKey('orgB'), 0, capturedInput)).verdict).toBe('ok');
    expect(await captures.listCapture(captureKey('orgA'))).toHaveLength(1);
    expect(await captures.listCapture(captureKey('orgB'))).toHaveLength(1);
    expect((await captures.listCapture(captureKey('orgA')))[0]?.orgId).toBe('orgA');
  });

  it('a re-appended (capture, seq) is refused, not duplicated - insert-as-claim', async () => {
    const a = captureKey('orgA');
    expect((await captures.appendCapturedCall(a, 0, capturedInput)).verdict).toBe('ok');
    expect((await captures.appendCapturedCall(a, 0, { ...capturedInput, url: 'https://portal.example.pt/api/outro' })).verdict)
      .toBe('duplicate');
    const rows = await captures.listCapture(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.call.url).toContain('/api/processos');
  });

  it('discard ends the capture lifecycle for that capture only', async () => {
    const one = captureKey('orgA', 'cap1');
    const two = captureKey('orgA', 'cap2');
    await captures.appendCapturedCall(one, 0, capturedInput);
    await captures.appendCapturedCall(two, 0, capturedInput);
    expect(await captures.discardCapture(one)).toBe(1);
    expect(await captures.listCapture(one)).toEqual([]);
    expect(await captures.listCapture(two)).toHaveLength(1);
  });

  it('a capture document whose stored orgId disagrees with its id is reachable by neither org', async () => {
    // The captures' mirror of the planted-row case above: the deterministic id is the primary gate,
    // and the post-fetch re-check is what holds when a document does not agree with the id it is
    // stored under. Planted through the raw collection, which is the only way such a row can exist.
    await integrationCapturedCalls.put({
      _id: capturedCallIdFor(captureKey('orgA'), 9),
      orgId: 'orgB',
      integrationKey: 'citius',
      actionName: 'list_processos',
      captureId: 'cap1',
      seq: 9,
      capturedAt: '2026-08-18T00:00:00.000Z',
      call: { method: 'GET', url: 'https://portal.example.pt/segredo-de-B', requestHeaderNames: [], responseHeaderNames: [] },
    });
    expect(await captures.getCapturedCall(captureKey('orgA'), 9)).toBeNull();
    expect(await captures.listCapture(captureKey('orgA'))).toEqual([]);
    expect(await captures.listCaptureIds('orgA', 'citius', 'list_processos')).toEqual([]);
    // Non-tautology: the document is there, and org B (whose row it says it is) reaches it.
    expect(await integrationCapturedCalls.get(capturedCallIdFor(captureKey('orgA'), 9))).not.toBeNull();
    expect(await captures.listCapture(captureKey('orgB'))).toHaveLength(1);
  });

  it('an org-less capture key is refused outright', async () => {
    await expect(captures.appendCapturedCall(captureKey(''), 0, capturedInput)).rejects.toThrow(/must name an org/);
    expect(await captures.listCapture(captureKey(''))).toEqual([]);
    expect(await captures.getCapturedCall(captureKey(''), 0)).toBeNull();
    expect(await captures.discardCapture(captureKey(''))).toBe(0);
  });
});
