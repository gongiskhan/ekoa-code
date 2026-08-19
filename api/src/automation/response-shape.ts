/**
 * automation/response-shape.ts - what a replayed call's answer is supposed to LOOK like.
 *
 * `CompiledRecipe.injectedCalls[].expectShape` is the one field of a recipe that is about the
 * FUTURE rather than the past: everything else records what discovery did, this records what a
 * later run should get back. It exists because the failure mode of a replayed private API is not
 * an exception - it is a 200 whose body has quietly become something else. A portal that renames
 * `items` to `results`, or starts wrapping the payload in `{data: …}`, breaks every consumer while
 * answering perfectly. Without a shape to compare against, the run reports success and hands the
 * caller nothing.
 *
 * ── WHY A SHAPE AND NOT A SCHEMA ─────────────────────────────────────────────────────────────
 *
 * A zod schema, or a sample body, would both be wrong here for the same reason: they carry VALUES.
 * A captured response is one tenant's data in one tenant's authenticated session, and a recipe is
 * a durable document. So the descriptor is deliberately lossy - kinds, key names, nesting, and
 * nothing else. `{"id": 41, "name": "Maria"}` describes as `object{id:number, name:string}`; the
 * 41 and the Maria do not survive. That also makes it stable: a shape that changed whenever the
 * data changed would classify every ordinary run as drift.
 *
 * ── THE MATCH IS DELIBERATELY ASYMMETRIC ─────────────────────────────────────────────────────
 *
 * `shapeMismatch` answers "has what the recipe COUNTED ON gone away", not "are these identical".
 * An ADDED key is not drift - APIs add fields constantly, and a run that failed on every new field
 * would need a heal a week. A key that has DISAPPEARED, or changed kind under the same name, is
 * drift: something the compiled call was reading is no longer there.
 */

/** A recursive, value-free description of a JSON body. */
export type ResponseShape =
  | { kind: 'null' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'array'; of?: ResponseShape }
  | { kind: 'object'; keys: Record<string, ResponseShape> }
  /** Deeper than `MAX_SHAPE_DEPTH`, or a value this describer does not model. Matches anything -
   *  a descriptor that stopped describing must not become a drift signal. */
  | { kind: 'unknown' };

/** How deep the descriptor goes. Beyond this every branch is `unknown`: a recipe is bounded, and
 *  the discriminating power of a JSON body is nearly all in its first few levels. */
export const MAX_SHAPE_DEPTH = 4;

/** How many keys of one object are described. A body with a thousand keys is a data dump, not a
 *  shape, and describing all of them would put unbounded tenant-derived key names in a recipe. */
export const MAX_SHAPE_KEYS = 40;

export function describeResponseShape(value: unknown, depth = 0): ResponseShape {
  if (depth >= MAX_SHAPE_DEPTH) return { kind: 'unknown' };
  if (value === null) return { kind: 'null' };
  switch (typeof value) {
    case 'string': return { kind: 'string' };
    case 'number': return { kind: 'number' };
    case 'boolean': return { kind: 'boolean' };
    case 'object': break;
    default: return { kind: 'unknown' };
  }
  if (Array.isArray(value)) {
    // The FIRST element only. A heterogeneous array would otherwise produce a union that matches
    // everything, and a homogeneous one (which is what an API list endpoint returns) is fully
    // described by any member of it.
    return value.length === 0 ? { kind: 'array' } : { kind: 'array', of: describeResponseShape(value[0], depth + 1) };
  }
  const keys: Record<string, ResponseShape> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_SHAPE_KEYS)) {
    keys[k] = describeResponseShape(v, depth + 1);
  }
  return { kind: 'object', keys };
}

/** Parse a stored `expectShape` back, or answer null. A recipe may predate this describer, or carry
 *  a shape a later version wrote; an unreadable descriptor is NOT drift - it is simply no evidence,
 *  and treating "I cannot read the expectation" as "the site changed" would heal for no reason. */
export function parseResponseShape(stored: unknown): ResponseShape | null {
  if (stored === null || typeof stored !== 'object') return null;
  const kind = (stored as { kind?: unknown }).kind;
  switch (kind) {
    case 'null': case 'string': case 'number': case 'boolean': case 'unknown':
      return { kind };
    case 'array': {
      const of = (stored as { of?: unknown }).of;
      if (of === undefined) return { kind: 'array' };
      const parsed = parseResponseShape(of);
      return parsed ? { kind: 'array', of: parsed } : { kind: 'array' };
    }
    case 'object': {
      const raw = (stored as { keys?: unknown }).keys;
      if (raw === null || typeof raw !== 'object') return null;
      const keys: Record<string, ResponseShape> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const parsed = parseResponseShape(v);
        if (parsed) keys[k] = parsed;
      }
      return { kind: 'object', keys };
    }
    default:
      return null;
  }
}

/**
 * What the body no longer satisfies, as dotted paths - empty when the expectation still holds.
 *
 * Paths rather than a boolean because the answer becomes the drift REASON stamped on the superseded
 * recipe's lineage, and "the response no longer carries `items[].caseNumber`" is a diagnosis while
 * "shape mismatch" is a shrug. Key NAMES only; no value ever enters the message.
 */
export function shapeMismatch(expected: ResponseShape, actual: unknown, path = ''): string[] {
  const here = path === '' ? 'response' : path;
  switch (expected.kind) {
    case 'unknown':
      return [];
    case 'null':
      return actual === null ? [] : [here];
    case 'string': case 'number': case 'boolean':
      return typeof actual === expected.kind ? [] : [here];
    case 'array': {
      if (!Array.isArray(actual)) return [here];
      // An empty answer is not drift: a list endpoint legitimately returns nothing today. The
      // element shape is checked only when there IS an element to check it against.
      if (expected.of === undefined || actual.length === 0) return [];
      return shapeMismatch(expected.of, actual[0], `${here}[0]`);
    }
    case 'object': {
      if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return [here];
      const obj = actual as Record<string, unknown>;
      const out: string[] = [];
      for (const [key, shape] of Object.entries(expected.keys)) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) {
          out.push(`${here}.${key}`);
          continue;
        }
        out.push(...shapeMismatch(shape, obj[key], `${here}.${key}`));
      }
      return out;
    }
  }
}
