import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { executeRecipe, type EkoaActionContext, type PlatformPrimitive } from '../../src/automation/platform-primitives.js';
import { setAppDataStore, type AppDataStore } from '../../src/automation/seams.js';
import { matchesSimpleQuery, SIMPLE_QUERY_OPS } from '../../src/data/simple-query.js';

/**
 * The recipe DSL's `store.query`, and the ONE predicate it now shares.
 *
 * WHY THIS FILE EXISTS. `evalQuery`'s nine comparison semantics moved out of
 * `automation/platform-primitives.ts` into `data/simple-query.ts` so `achieve`'s compose rung could
 * use them without `integrations/` (tier 3) importing `automation/` (tier 5) - one implementation
 * instead of two free to drift. That extraction touched the interpreter every shipped recipe runs
 * on, and a grep of the estate at the time found NO test anywhere exercising `store.query`: the
 * `executeRecipe` suites that exist cover file containment and the platform write gate. So the
 * refactor would have landed behind a green estate that was not looking, which is the exact class
 * this repo keeps paying for.
 *
 * The suite is therefore about EQUIVALENCE, not about the ops in isolation:
 *   1. every op, driven THROUGH the primitive, agrees with the shared predicate;
 *   2. the coercion edges the old inline switch had are carried verbatim (strict `eq`, NaN
 *      orderings, `String(field ?? '')` for the string ops) - those are what a "tidy-up" of the
 *      extracted function would quietly change under every recipe in production;
 *   3. the recipe-only half stays here: a `{{captured.x}}` value is still resolved before the
 *      comparison, which is the one thing `data/simple-query.ts` deliberately does not do.
 */
const ROWS: Record<string, unknown>[] = [
  { id: 'a', nome: 'Ana', idade: 31, activo: true, ref: 'PT-100' },
  { id: 'b', nome: 'Bruno', idade: 52, activo: false, ref: 'ES-200' },
  { id: 'c', nome: 'Carla', idade: 40, activo: true, ref: 'PT-300' },
  { id: 'd', nome: 'Dora', ref: 'PT-400' },
];

const listed: string[] = [];
const store: AppDataStore = {
  list: async (_artifactId, collection) => {
    listed.push(collection);
    return ROWS;
  },
  get: async () => null,
  create: async () => ({ id: 'x' }),
  update: async () => ({}),
  delete: async () => true,
};

function ctx(captured: Record<string, unknown> = {}): EkoaActionContext {
  return { userId: 'u1', orgId: 'o1', artifactId: 'art1', inputs: {}, captured, trace: [] };
}

async function queried(where: { field: string; op: string; value: unknown }, captured: Record<string, unknown> = {}): Promise<string[]> {
  const c = ctx(captured);
  const recipe: PlatformPrimitive[] = [{ op: 'store.query', collection: 'clients', where: where as never, returnAs: 'out' }];
  await executeRecipe(recipe, c);
  return (c.captured.out as Record<string, unknown>[]).map((r) => String(r.id));
}

beforeEach(() => {
  listed.length = 0;
  setAppDataStore(store);
});
// The seam is process-global; hand it back so a later file in the same worker is unaffected.
afterAll(() => {
  setAppDataStore({
    list: async () => { throw new Error('app-data store not wired (ekoa_action store.list)'); },
    get: async () => { throw new Error('app-data store not wired (ekoa_action store.get)'); },
    create: async () => { throw new Error('app-data store not wired (ekoa_action store.create)'); },
    update: async () => { throw new Error('app-data store not wired (ekoa_action store.update)'); },
    delete: async () => { throw new Error('app-data store not wired (ekoa_action store.delete)'); },
  });
});

describe('store.query and the compose rung evaluate the SAME predicate', () => {
  const probes: Array<{ field: string; value: unknown }> = [
    { field: 'idade', value: 40 },
    { field: 'nome', value: 'Ana' },
    { field: 'ref', value: 'PT' },
    { field: 'activo', value: true },
    { field: 'ausente', value: 'x' },
  ];

  it('every op agrees with matchesSimpleQuery, on every probe', async () => {
    for (const op of SIMPLE_QUERY_OPS) {
      for (const probe of probes) {
        const where = { field: probe.field, op, value: probe.value };
        const viaRecipe = await queried(where);
        const direct = ROWS.filter((r) => matchesSimpleQuery(r, where as never)).map((r) => String(r.id));
        expect(viaRecipe, `${op} on ${probe.field}`).toEqual(direct);
      }
    }
    expect(listed.every((c) => c === 'clients')).toBe(true);
  });

  it('carries the coercion edges verbatim, so no shipped recipe changes meaning', async () => {
    // STRICT equality: "31" is not 31.
    expect(await queried({ field: 'idade', op: 'eq', value: '31' })).toEqual([]);
    expect(await queried({ field: 'idade', op: 'eq', value: 31 })).toEqual(['a']);
    // A missing field is NaN in an ordering, so it satisfies none of the four.
    for (const op of ['lt', 'lte', 'gt', 'gte']) {
      expect(await queried({ field: 'idade', op, value: 40 })).not.toContain('d');
    }
    // …and '' in the string ops, so `contains ''` still matches it.
    expect(await queried({ field: 'idade', op: 'contains', value: '' })).toContain('d');
    // The boundary is not off by one.
    expect(await queried({ field: 'idade', op: 'lt', value: 40 })).toEqual(['a']);
    expect(await queried({ field: 'idade', op: 'lte', value: 40 })).toEqual(['a', 'c']);
  });

  it('the recipe-only half stays in the recipe: a captured template ref is resolved first', async () => {
    expect(await queried({ field: 'idade', op: 'lt', value: '{{captured.limite}}' }, { limite: 40 })).toEqual(['a']);
    expect(await queried({ field: 'nome', op: 'eq', value: '{{captured.quem}}' }, { quem: 'Carla' })).toEqual(['c']);
  });

  it('records the primitive on the trace as it always did', async () => {
    const c = ctx();
    await executeRecipe([{ op: 'store.query', collection: 'clients', where: { field: 'idade', op: 'lt', value: 40 }, returnAs: 'out' }], c);
    expect(c.trace).toHaveLength(1);
    expect(c.trace[0]?.summary).toBe('store.query clients → 1 matched');
    expect(c.trace[0]?.status).toBe('ok');
  });
});
