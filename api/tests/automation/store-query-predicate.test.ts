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

/**
 * THE SAME AGES, HELD AS STRINGS - and the reason this fixture exists is that every other one in
 * the estate holds them as numbers.
 *
 * `app_data` rows are whatever an app wrote into them. A number typed into a form arrives as a
 * string unless something coerced it; a CSV/ERP import writes strings; and on the compose rung the
 * comparison VALUE is a model's JSON, which may perfectly well be `"40"`. So a string age against a
 * string bound is an ordinary production shape, not a contrivance.
 *
 * The four ordering operators coerce BOTH sides with `Number(...)`. Delete those coercions and JS
 * compares two strings LEXICOGRAPHICALLY, where `'9' > '40'` and `'100' < '40'` are both true. Over
 * a numeric fixture the mutant is invisible - `31 < 40` is the same answer either way - which is
 * exactly what happened: all four `Number()` calls could be removed and the whole estate stayed
 * green. On the rung whose canonical demo is "clients under 40", that is a client aged 9 dropped
 * from the answer and a client aged 100 kept in it, delivered with a confident summary.
 *
 * Every expectation below is a set the two orderings DISAGREE about, so each of the four operators
 * is pinned by a case no lexicographic comparison can produce.
 */
const STRING_AGE_ROWS: Record<string, unknown>[] = [
  { id: 's9', idade: '9' },
  { id: 's31', idade: '31' },
  { id: 's40', idade: '40' },
  { id: 's100', idade: '100' },
];

const listed: string[] = [];
let rowsFor: Record<string, unknown>[] = ROWS;
const store: AppDataStore = {
  list: async (_artifactId, collection) => {
    listed.push(collection);
    return rowsFor;
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
  rowsFor = ROWS;
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

  /**
   * AN EQUIVALENCE TEST CANNOT PIN A SEMANTIC, and saying so is better than letting the file's
   * first test look like it does. `evalQuery` now CALLS `matchesSimpleQuery`, so both sides of the
   * comparison below move together: change `lt` to `<=` in the predicate and this still passes.
   * What it does catch - and the only thing it claims to - is DRIFT: an `evalQuery` that stopped
   * delegating and grew a second switch of its own. The semantics themselves are pinned by the
   * literal-valued test underneath it, and that test is where a mutation of the predicate reds.
   */
  it('every op agrees with matchesSimpleQuery, on every probe (a drift check, not a semantic pin)', async () => {
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
    // …AND ITS MIRROR, which was a surviving mutant: `neq` could become `!=` and nothing noticed,
    // because the only `neq` probes compared same-typed values where loose and strict agree. Under
    // `!=`, `idade neq "31"` would DROP Ana - a recipe asking for "everyone except the 31-year-old,
    // by the string the form gave me" would silently start excluding her. `eq` was pinned here in
    // an earlier round and its twin twenty characters away was not.
    expect(await queried({ field: 'idade', op: 'neq', value: '31' })).toEqual(['a', 'b', 'c', 'd']);
    expect(await queried({ field: 'idade', op: 'neq', value: 31 })).toEqual(['b', 'c', 'd']);
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

  /**
   * TWO MORE EDGES THAT NO ASSERTION IN THIS FILE COULD REACH, found by mutating the extracted
   * predicate rather than by reading it. Both were SURVIVING MUTANTS: the whole estate stayed green.
   *
   *   1. `contains` -> `startsWith`. Every probe above compares a PREFIX (`'PT'` against
   *      `'PT-100'`), so the two operators select the same rows and the distinction is invisible.
   *      `contains` is one of the nine comparisons every shipped recipe may already use.
   *   2. `String(field ?? '')` -> `String(field)`. Row `d` has no `idade`, and the only assertion
   *      that touches it uses `value: ''`, which every string operator satisfies either way -
   *      `''.startsWith('')` and `'undefined'.startsWith('')` are both true. Dropping the `?? ''`
   *      turns an ABSENT field into the literal text `undefined`, so a recipe filtering
   *      `starts_with 'und'` would start matching rows that hold no such field at all.
   */
  it('the string ops are not prefix ops, and an ABSENT field is "" rather than the word "undefined"', async () => {
    // 1. A match in the MIDDLE of the value: `contains` keeps it, a prefix operator would not.
    expect(await queried({ field: 'ref', op: 'contains', value: 'T-1' })).toEqual(['a']);
    expect(await queried({ field: 'ref', op: 'starts_with', value: 'T-1' })).toEqual([]);
    // …and the mirror for the SUFFIX operator, which needs both directions for the same reason
    // `starts_with` does: `'-100'` alone cannot tell `endsWith` from `includes`.
    expect(await queried({ field: 'ref', op: 'ends_with', value: '-100' })).toEqual(['a']);
    expect(await queried({ field: 'ref', op: 'ends_with', value: '-1' })).toEqual([]);
    expect(await queried({ field: 'ref', op: 'starts_with', value: 'PT' })).toEqual(['a', 'c', 'd']);
    expect(await queried({ field: 'ref', op: 'ends_with', value: 'PT' })).toEqual([]);

    // 2. Row `d` holds no `idade`. Coerced to '', it matches none of these; coerced to the string
    // `'undefined'`, it would match all three - which is the row a recipe never meant to select.
    expect(await queried({ field: 'idade', op: 'starts_with', value: 'und' })).toEqual([]);
    expect(await queried({ field: 'idade', op: 'contains', value: 'undefin' })).toEqual([]);
    expect(await queried({ field: 'idade', op: 'ends_with', value: 'fined' })).toEqual([]);
  });

  /**
   * ALL FOUR ORDERING OPERATORS, PINNED WHERE LEXICOGRAPHIC AND NUMERIC ORDER DISAGREE.
   *
   * A SURVIVING MUTANT until this existed, and the largest one in the slice: `Number(field)` and
   * `Number(q.value)` could be dropped from `lt`, `lte`, `gt` AND `gte` at once and every suite in
   * the estate stayed green - the four suites this slice added included. Every fixture anywhere
   * compares numbers to numbers, and JS gives the same answer for those whether it coerces or not.
   *
   * The expected sets below are the NUMERIC ones. Beside each is the lexicographic set the mutant
   * produces, so the disagreement is on the page rather than left to be recomputed:
   *
   *   lt  '40'  numeric {9, 31}    lexicographic {'100', '31'}
   *   lte '40'  numeric {9,31,40}  lexicographic {'100', '31', '40'}
   *   gt  '40'  numeric {100}      lexicographic {'9'}
   *   gte '40'  numeric {40, 100}  lexicographic {'40', '9'}
   *
   * Note what each half gets WRONG, because it is not symmetric noise: under `lt 40` the mutant
   * DROPS the nine-year-old and ADMITS the hundred-year-old. "Clients under 40" is this rung's
   * canonical demo, and that is the wrong answer delivered with a summary saying how it was built.
   */
  it('the four ORDERINGS are numeric, not lexicographic - the whole estate was green without this', async () => {
    rowsFor = STRING_AGE_ROWS;
    // Both sides strings: the shape a form-entered age and a model-supplied bound really produce.
    expect(await queried({ field: 'idade', op: 'lt', value: '40' })).toEqual(['s9', 's31']);
    expect(await queried({ field: 'idade', op: 'lte', value: '40' })).toEqual(['s9', 's31', 's40']);
    expect(await queried({ field: 'idade', op: 'gt', value: '40' })).toEqual(['s100']);
    expect(await queried({ field: 'idade', op: 'gte', value: '40' })).toEqual(['s40', 's100']);

    // …and the MIXED shape, which is the one a `{{captured.limite}}` bound most often produces: a
    // string field against a numeric value. `'9' < 40` coerces on its own in JS, so this pair does
    // NOT kill the mutant by itself - it is here because it is the common case and it must keep
    // agreeing with the pinned answers above, not because it carries the proof.
    expect(await queried({ field: 'idade', op: 'lt', value: 40 })).toEqual(['s9', 's31']);
    expect(await queried({ field: 'idade', op: 'gte', value: 40 })).toEqual(['s40', 's100']);

    // The predicate is the SAME function the compose rung joins with; assert it directly too, so
    // this survives anyone deciding `store.query` should coerce before calling it.
    const kept = (op: string, value: unknown): string[] =>
      STRING_AGE_ROWS.filter((r) => matchesSimpleQuery(r, { field: 'idade', op, value } as never)).map((r) => String(r.id));
    expect(kept('lt', '40')).toEqual(['s9', 's31']);
    expect(kept('lte', '40')).toEqual(['s9', 's31', 's40']);
    expect(kept('gt', '40')).toEqual(['s100']);
    expect(kept('gte', '40')).toEqual(['s40', 's100']);
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
