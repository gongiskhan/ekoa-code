/**
 * integrations/action-compose.ts - THE DETERMINISTIC POST-STAGE (slice S5, the `achieve` reuse
 * ladder's COMPOSE rung).
 *
 * ================================ WHY THIS IS NOT A PROMPT SLICE ============================
 * "Compose" means answering a goal that ONE action cannot answer alone - "todos os processos de
 * clientes com menos de 40 anos": the processes come from the integration, the ages come from the
 * tenant's own data, and nothing in this platform joins the two. That was checked before it was
 * built, and both halves of the claim hold in the code as it stands:
 *
 *   - `data/collections-engine.ts` (the ONE store behind every app's `app_data`) exposes
 *     `list`, `get`, `create`, `importCreate`, `upsert`, `delete`. There is no query, no filter and
 *     no join on it - a read is `list` (a whole collection) or `get` (one row by id).
 *   - the recipe DSL's `store.query` (`automation/platform-primitives.ts`) is `list` followed by an
 *     IN-MEMORY filter, and its predicate is a SINGLE FIELD against a single value.
 *
 * So there is no join to point a prompt at. The smallest honest addition is this stage: run the
 * action that was already matched and trusted, then filter and join its rows against ONE collection
 * OF THE CALLER'S OWN using the recipe DSL's own predicate vocabulary - the SAME `matchesSimpleQuery`
 * `store.query` uses (`data/simple-query.ts`), so artifacts gain no interpreter power they did not
 * already have and this rung invents none of its own.
 *
 * ================================ WHAT THE MODEL CONTRIBUTES ================================
 * THREE STRINGS AND A VALUE: which collection, which field of it, which comparison, against what -
 * plus which field of each side the join keys on. It does not pick the action (the lexical matcher
 * does, unchanged), it does not write the filter (this file does), it does not touch the rows, and
 * it cannot cause a write of any kind. The stage below is ordinary TypeScript, and it is the only
 * thing that runs.
 *
 * ================================ READS ONLY, AND WHERE THAT IS DECIDED =====================
 * This rung is for READS. `integration-achieve.ts` does not enter it at all unless the matched
 * action's `mutates` is a literal `false` - the fail-closed reading `action-consent.ts` fixed - and
 * that gate sits BEFORE the model is consulted, so a write costs no planning turn and, decisively,
 * cannot be turned into a refusal by anything a model says. A write goes down the execute path it
 * always went down, byte for byte.
 *
 * THE GATE IS NOT RESTATED HERE, deliberately. Whether an ACTION may be composed over is a property
 * of the call site, not of the plan; this module judges PLANS. An earlier shape asserted it in both
 * places, which meant two statements of one rule where only one could ever fire - and the one that
 * fired second turned an approved, previously-executing call into a model-dependent refusal.
 *
 * ================================ TENANCY ==================================================
 * This module never reads a collection. It is handed rows by an `AppCollections` seam that the
 * composition root binds to the ACTING USER'S OWN owner-shared scope - the only unit `app_data` has
 * for shared rows, since every read there binds on `usr.<ownerUserId>` and never on an app id.
 * `api/tests/security/achieve-compose-isolation.test.ts` proves that binding refuses a peer org's
 * collections AND a same-org colleague's, org-visible artifact or not.
 */
import type { Actor } from '@ekoa/shared';
import { matchesSimpleQuery, isSimpleQueryOp, SIMPLE_QUERY_OPS, type SimpleQuery } from '../data/simple-query.js';
import { collectionName } from '../data/collections-engine.js';

/** The most rows this rung will EMIT. A composed answer is an answer, not a bulk export, and an
 *  unbounded array here would ride into a JSON response and a model's next prompt alike. */
export const COMPOSE_MAX_ITEMS = 200;

/**
 * The most collection rows the join key set is built from. The reader lists a whole collection
 * (that is all the engine can do), so the cap is stated here rather than pretended away.
 *
 * A CAP ON THE KEY SET IS A CAP ON THE ANSWER, and that is why it is REPORTED rather than merely
 * documented. `COMPOSE_MAX_ITEMS` truncates a list the caller can see is truncated - they asked for
 * rows and got a page of them. This one truncates the QUESTION: the join silently considers a
 * PREFIX of the collection, so an action row whose client sits past row 5000 is dropped from an
 * answer presented as "the processes of clients under 40". A subset served as the whole is a wrong
 * answer, not a partial one, so `collectionTruncated` travels on every composed result and the
 * caller decides what to do about it.
 */
export const COMPOSE_MAX_COLLECTION_ROWS = 5_000;

/**
 * What the model proposes. `compose: false` is a FIRST-CLASS answer, not a failure: most goals that
 * carry extra words carry them as politeness, and a rung that could only ever say "join" would join
 * things that should not be joined.
 */
export type ComposePlan =
  | { compose: false }
  | {
      compose: true;
      /** The tenant collection to join against, by name. */
      collection: string;
      /** The predicate applied to the COLLECTION's rows - the recipe DSL's own vocabulary. */
      where: SimpleQuery;
      /** Which field of each side the join keys on. Compared as strings, one hop, no nesting. */
      join: { resultField: string; collectionField: string };
    };

export type ComposeCheckName = 'shape' | 'collection_name' | 'predicate';

export interface ComposeCheck {
  name: ComposeCheckName;
  ok: boolean;
  detail?: string;
}

export interface ComposeVerdict {
  passed: boolean;
  checks: ComposeCheck[];
  /** The plan to run, or null when the verdict did not pass (or the model declined to compose). */
  plan: Extract<ComposePlan, { compose: true }> | null;
}

function check(name: ComposeCheckName, ok: boolean, detail?: string): ComposeCheck {
  return detail === undefined || ok ? { name, ok } : { name, ok, detail };
}

/**
 * THE GUARDRAIL SUITE for a composition plan. Deterministic and model-free, re-run over the parsed
 * plan whatever the drafting turn claimed - `authored-action.ts`'s rule, for its reason.
 *
 * It judges the PLAN and nothing else. Whether this ACTION may be composed over at all was settled
 * by the caller before a model was ever asked (see the module header), so no `mutates` check lives
 * here to fire second and contradict it.
 */
export function verifyComposePlan(input: {
  planned: unknown;
}): ComposeVerdict {
  const checks: ComposeCheck[] = [];
  const done = (plan: Extract<ComposePlan, { compose: true }> | null): ComposeVerdict => ({
    passed: checks.every((c) => c.ok),
    checks,
    plan: checks.every((c) => c.ok) ? plan : null,
  });

  const raw = input.planned;
  const obj = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!obj) {
    checks.push(check('shape', false, 'the plan is not an object'));
    return done(null);
  }
  // A declined composition is WELL-FORMED. It passes the suite and yields no plan.
  if (obj.compose === false) {
    checks.push(check('shape', true));
    return done(null);
  }

  const shapeProblems: string[] = [];
  if (obj.compose !== true) shapeProblems.push('"compose" must be a literal true or false');
  if (typeof obj.collection !== 'string' || obj.collection === '') shapeProblems.push('"collection" is missing');
  const where = obj.where;
  const whereObj = where !== null && typeof where === 'object' && !Array.isArray(where) ? (where as Record<string, unknown>) : null;
  if (!whereObj) shapeProblems.push('"where" is missing');
  else {
    if (typeof whereObj.field !== 'string' || whereObj.field === '') shapeProblems.push('"where.field" is missing');
    if (!('value' in whereObj)) shapeProblems.push('"where.value" is missing');
  }
  const join = obj.join;
  const joinObj = join !== null && typeof join === 'object' && !Array.isArray(join) ? (join as Record<string, unknown>) : null;
  if (!joinObj) shapeProblems.push('"join" is missing');
  else {
    if (typeof joinObj.resultField !== 'string' || joinObj.resultField === '') shapeProblems.push('"join.resultField" is missing');
    if (typeof joinObj.collectionField !== 'string' || joinObj.collectionField === '') shapeProblems.push('"join.collectionField" is missing');
  }
  checks.push(check('shape', shapeProblems.length === 0, shapeProblems.join('; ')));
  if (shapeProblems.length > 0) return done(null);

  // The collection NAME is judged by the store's own rule, not by a second one written here: the
  // charset guard and the two reserved prefixes (`__`, `usr.`) that `guardCollectionName` enforces.
  const nameCheck = collectionName.safeParse(obj.collection);
  checks.push(check(
    'collection_name',
    nameCheck.success,
    `"${String(obj.collection)}" is not a collection this platform can address`,
  ));

  // The PREDICATE is the recipe DSL's, exactly: one of nine comparisons, one field, one value.
  const op = (whereObj as Record<string, unknown>).op;
  checks.push(check(
    'predicate',
    isSimpleQueryOp(op),
    `"${String(op)}" is not a comparison this platform performs (${SIMPLE_QUERY_OPS.join(', ')})`,
  ));

  return done({
    compose: true,
    collection: obj.collection as string,
    where: {
      field: (whereObj as Record<string, unknown>).field as string,
      op: op as SimpleQuery['op'],
      value: (whereObj as Record<string, unknown>).value,
    },
    join: {
      resultField: (joinObj as Record<string, unknown>).resultField as string,
      collectionField: (joinObj as Record<string, unknown>).collectionField as string,
    },
  });
}

/**
 * READ ONE COLLECTION OF THE CALLER'S OWN. The seam the composition root binds to the acting
 * user's owner-shared scope; absent, the rung is skipped rather than degrading into some other
 * read path.
 *
 * TWO ANSWERS, because the store has one scope to give. Shared `app_data` rows are keyed
 * `usr.<ownerUserId>` with no app dimension, so a name either resolves in the caller's own
 * namespace or it is not a name they hold. An earlier shape carried an `ambiguous_collection`
 * answer on the belief that `app_data` was keyed per artifact; it is not, so the "ambiguity" was
 * one namespace counted twice, and every owner of a second app hit it.
 */
export type AppCollectionRead =
  | { kind: 'rows'; rows: Record<string, unknown>[] }
  | { kind: 'unknown_collection' };

/**
 * Both methods take the WHOLE `Actor`, not a bare user id, and that is the tenancy decision rather
 * than a convenience: the binding derives the scope from the VERIFIED actor the route built, so
 * this module can neither name nor influence whose rows are read. Nothing the caller sends and
 * nothing the model says reaches the scope key.
 */
export interface AppCollections {
  /** The collection names this caller holds. Named for the prompt, so the model chooses from a
   *  list instead of inventing one - and a name it invents anyway is refused by `verifyComposePlan`
   *  and then again by the reader. */
  list(actor: Actor): Promise<string[]>;
  read(actor: Actor, collection: string): Promise<AppCollectionRead>;
}

/** The array of rows an action's result carries, or why it does not carry one. */
export type ComposeRows =
  | { kind: 'rows'; rows: Record<string, unknown>[] }
  | { kind: 'unshaped'; detail: string };

/**
 * FIND THE ROWS in an executor result. Deterministic, and it REFUSES rather than guesses:
 *
 *   - the data IS an array of objects -> those rows;
 *   - the data is an object with EXACTLY ONE array-valued property -> that array (the
 *     `{ items: [...] }` / `{ processos: [...] }` envelope every list endpoint in the world uses);
 *   - anything else, including an object with two array properties -> `unshaped`.
 *
 * The two-array case is the one that matters. Picking the longer, or the first, or the one whose
 * name looks right, would be this module inventing an interpretation of a third party's response -
 * and the caller would never know which array their answer came from.
 *
 * IT IS ONLY EVER ASKED ABOUT A SUCCESSFUL RESULT, and that is the caller's rule rather than this
 * function's: a failed execute carries no `data`, so this would answer "the action returned no list
 * to compose over" - true of the value, and a LIE about what happened, since what happened was a
 * remote 500. `integration-achieve.ts` returns a failed execute verbatim before reaching here.
 */
export function rowsOf(data: unknown): ComposeRows {
  if (Array.isArray(data)) {
    const rows = data.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object' && !Array.isArray(r));
    if (rows.length !== data.length) return { kind: 'unshaped', detail: 'the action returned a list whose entries are not records' };
    return { kind: 'rows', rows };
  }
  if (data === null || typeof data !== 'object') {
    return { kind: 'unshaped', detail: 'the action returned no list to compose over' };
  }
  const arrays = Object.entries(data as Record<string, unknown>).filter(([, v]) => Array.isArray(v));
  if (arrays.length === 0) return { kind: 'unshaped', detail: 'the action returned no list to compose over' };
  if (arrays.length > 1) {
    return {
      kind: 'unshaped',
      detail: `the action returned several lists (${arrays.map(([k]) => k).sort().join(', ')}) and this rung will not guess which one the goal meant`,
    };
  }
  return rowsOf((arrays[0] as [string, unknown])[1]);
}

export interface ComposeSummary {
  collection: string;
  where: SimpleQuery;
  join: { resultField: string; collectionField: string };
  /** How many rows the ACTION returned. */
  scanned: number;
  /** How many COLLECTION rows the key set was built from - the number really considered, capped by
   *  `COMPOSE_MAX_COLLECTION_ROWS`, never the number the collection holds. */
  collectionScanned: number;
  /** True when the collection held MORE rows than were considered: the key set is a PREFIX, and
   *  `items` may be missing rows a full scan would have kept. See `COMPOSE_MAX_COLLECTION_ROWS`. */
  collectionTruncated: boolean;
  /** How many of the CONSIDERED collection rows satisfied the predicate. */
  matchedCollectionRows: number;
  /** How many action rows survived the join. */
  matched: number;
  /** True when `matched` exceeded `COMPOSE_MAX_ITEMS` and `items` is the head of the answer. */
  truncated: boolean;
}

/**
 * THE STAGE. Pure: rows in, rows out, no I/O, no model, no clock.
 *
 * Filter the collection by the predicate, key the survivors, keep the action rows whose join field
 * is in that key set. Keys are compared AS STRINGS after a null check - an id that arrives as `7`
 * from one side and `"7"` from the other is the same client, and refusing to see that would make
 * the rung useless against real APIs. A null/undefined key on either side matches nothing rather
 * than matching every other absent key.
 */
export function composeRows(input: {
  plan: Extract<ComposePlan, { compose: true }>;
  actionRows: readonly Record<string, unknown>[];
  collectionRows: readonly Record<string, unknown>[];
}): { items: Record<string, unknown>[]; summary: ComposeSummary } {
  const scanned = input.actionRows.length;
  const considered = input.collectionRows.slice(0, COMPOSE_MAX_COLLECTION_ROWS);
  const keys = new Set<string>();
  let matchedCollectionRows = 0;
  for (const row of considered) {
    if (!matchesSimpleQuery(row, input.plan.where)) continue;
    matchedCollectionRows++;
    const k = row[input.plan.join.collectionField];
    if (k === null || k === undefined) continue;
    keys.add(String(k));
  }
  const all = input.actionRows.filter((row) => {
    const k = row[input.plan.join.resultField];
    return k !== null && k !== undefined && keys.has(String(k));
  });
  return {
    items: all.slice(0, COMPOSE_MAX_ITEMS),
    summary: {
      collection: input.plan.collection,
      where: input.plan.where,
      join: input.plan.join,
      scanned,
      collectionScanned: considered.length,
      // Stated as "fewer rows reached the key set than the collection held", NOT as a comparison
      // against the constant: delete the `slice` above and this reads `false`, which is exactly the
      // reading a caller would then be entitled to. A flag derived from the cap instead of from the
      // work done would keep claiming a truncation that no longer happens.
      collectionTruncated: input.collectionRows.length > considered.length,
      matchedCollectionRows,
      matched: all.length,
      truncated: all.length > COMPOSE_MAX_ITEMS,
    },
  };
}

/** Extract the single ```compose-json block and parse it. No JSON repair pass - `achieve`'s rule. */
export function parseComposePlan(text: string): { draft: ComposePlan | null; violations: string[] } {
  const block = text.match(/```compose-json\s*\n([\s\S]*?)```/);
  if (!block) return { draft: null, violations: ['no ```compose-json block in the reply'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse((block[1] as string).trim());
  } catch (err) {
    return { draft: null, violations: [`the compose-json block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { draft: null, violations: ['the compose-json block must contain a single JSON object'] };
  }
  return { draft: parsed as ComposePlan, violations: [] };
}

/**
 * The output contract, ALWAYS the last system section. Every constraint here is ALSO enforced by
 * `verifyComposePlan`; where the two disagree, the suite wins.
 */
export function composeOutputContract(): string {
  return [
    '# Output contract',
    'Reply with EXACTLY ONE fenced ```compose-json block and no other fenced block.',
    '',
    'If the goal asks ONLY for what the action already returns, answer exactly:',
    '```compose-json',
    '{ "compose": false }',
    '```',
    '',
    'If the goal narrows the action\'s results by a fact held in one of the collections listed above,',
    'answer with the join that narrows it:',
    '```compose-json',
    '{',
    '  "compose": true,',
    '  "collection": "<one of the collection names listed above>",',
    '  "where": { "field": "<a field of that collection>", "op": "lt", "value": 40 },',
    '  "join": { "resultField": "<a field of the action\'s rows>", "collectionField": "<a field of the collection>" }',
    '}',
    '```',
    '',
    '# Hard rules (a plan that breaks any of these is refused and NOTHING runs)',
    `1. "op" is one of: ${SIMPLE_QUERY_OPS.join(', ')}. There are no others, and no boolean logic:`,
    '   exactly ONE field compared against ONE value.',
    '2. "collection" must be one of the collection names listed above. You may not invent one.',
    '3. "join" states which field of the ACTION\'s rows equals which field of the COLLECTION\'s rows.',
    '4. You are not choosing the action, and you cannot run anything. If the goal needs work the',
    '   action plus one such join cannot do, answer { "compose": false } and say nothing else.',
    '5. Never put a credential, a token or a person\'s password in any field.',
  ].join('\n');
}
