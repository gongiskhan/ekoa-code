/**
 * data/simple-query.ts - THE single-field row predicate this platform filters with, as ONE
 * implementation.
 *
 * It was written once, inside the recipe interpreter (`automation/platform-primitives.ts`'s
 * `evalQuery`, backing the `store.query` primitive). The compose rung of `achieve`
 * (`integrations/action-compose.ts`) needs the SAME vocabulary over the SAME `app_data` rows, and
 * `integrations/` (tier 3) may not import `automation/` (tier 5) - so rather than grow a second
 * copy of nine comparison semantics that would drift the first time someone "improved" one of
 * them, the pure half lives here in tier 2 and both callers project onto it.
 *
 * WHAT IS HERE IS ONLY THE PURE HALF. The recipe interpreter's template rendering
 * (`{{captured.x}}` -> a value) stays in the interpreter, because that vocabulary is the RECIPE's,
 * not this predicate's - and giving the compose rung template refs would be exactly the "new
 * interpreter power for artifacts" the slice promised not to add.
 *
 * THE SEMANTICS ARE CARRIED VERBATIM, deliberately including the parts that look sloppy:
 *   - `eq`/`neq` are STRICT (`===`), so `"40"` does not equal `40`;
 *   - the four orderings coerce BOTH sides with `Number(...)`, so a non-numeric field compares
 *     false in every direction (NaN);
 *   - the three string ops coerce with `String(field ?? '')`, so a missing field is `''`.
 * Changing any of them here would silently change every shipped recipe, which is the one thing an
 * extraction like this must not do.
 *
 * FIELD LOOKUP IS FLAT. `item[q.field]` - no dotted paths, no array indexing. That is what the
 * recipe DSL has always done, and widening it here would widen the recipe DSL by side effect.
 */

/** The nine comparisons. A closed set: an unknown op is a plan defect, never a "match nothing". */
export type SimpleQueryOp =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'starts_with'
  | 'ends_with';

/** Enumerated so a validator can state the vocabulary without re-typing it (and drifting from it). */
export const SIMPLE_QUERY_OPS: readonly SimpleQueryOp[] = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'starts_with',
  'ends_with',
];

export interface SimpleQuery {
  field: string;
  op: SimpleQueryOp;
  value: unknown;
}

export function isSimpleQueryOp(v: unknown): v is SimpleQueryOp {
  return typeof v === 'string' && (SIMPLE_QUERY_OPS as readonly string[]).includes(v);
}

/**
 * Does `item` satisfy `q`? Pure, total, and free of any I/O - the whole point of pulling it out.
 *
 * `q.value` is taken AS GIVEN: a caller that needs to resolve a template ref into it does so
 * before calling (that is the recipe interpreter's job, and it is the only caller that has a
 * context to resolve one against).
 */
export function matchesSimpleQuery(item: Record<string, unknown>, q: SimpleQuery): boolean {
  const field = item[q.field];
  switch (q.op) {
    case 'eq': return field === q.value;
    case 'neq': return field !== q.value;
    case 'lt': return Number(field) < Number(q.value);
    case 'lte': return Number(field) <= Number(q.value);
    case 'gt': return Number(field) > Number(q.value);
    case 'gte': return Number(field) >= Number(q.value);
    case 'contains': return String(field ?? '').includes(String(q.value ?? ''));
    case 'starts_with': return String(field ?? '').startsWith(String(q.value ?? ''));
    case 'ends_with': return String(field ?? '').endsWith(String(q.value ?? ''));
  }
}
