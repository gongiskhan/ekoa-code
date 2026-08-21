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
 * AND IT CHOOSES ALL THREE STRINGS FROM SETS IT HAS BEEN SHOWN. That is the fix for the sharpest
 * defect this rung ever had, and it is worth stating as a rule rather than as a note, because the
 * failure it removes was invisible by construction:
 *
 *   The planning turn used to be given the action's NAME, its one-line description, and the NAMES of
 *   the caller's collections - and nothing else. Not one field name, from either side. The output
 *   contract then demanded three of them (`where.field`, `join.resultField`, `join.collectionField`),
 *   so the model had no way to answer except to INVENT identifiers. An invented field name does not
 *   error: `matchesSimpleQuery` reads `undefined` off every row and selects nothing, or the join key
 *   set comes back empty, and what the caller receives is A SHORTER LIST OF THEIR OWN CASES,
 *   confidently, with nothing on the wire to distinguish it from a correct narrowing. For "todos os
 *   processos de clientes com menos de 40 anos" that is the worst possible shape of wrong: a lawyer
 *   cannot tell a correctly-filtered docket from a wrongly-narrowed one by looking at it.
 *
 * So the rung now runs AFTER the execute, with the answer's own rows in hand, and the planning turn
 * is shown BOTH field sets: the union of keys over the rows the action really returned, and each
 * collection's real field names (`CollectionsEngine.listCollectionFields`). `verifyComposePlan`
 * refuses any name outside those sets, and a refused plan is DISCARDED - the caller gets the
 * executed arm's full answer with the rung's verdict beside it, never a narrowed one. Both halves
 * matter: showing the fields is what lets a model be right, and refusing outside them is what makes
 * being wrong loud (D-S5-5).
 *
 * ================================ READS ONLY, AND WHERE THAT IS DECIDED =====================
 * This rung is for READS. `integration-achieve.ts` does not enter it at all unless the matched
 * action's `mutates` is a literal `false` - the fail-closed reading `action-consent.ts` fixed - and
 * that gate sits BEFORE the model is consulted, so a write costs no planning turn and, decisively,
 * cannot be turned into a refusal by anything a model says. A write goes down the execute path it
 * always went down, byte for byte.
 *
 * THE GATE IS STILL FIRST EVEN THOUGH THE RUNG IS NOW LAST. Moving the planning turn to after the
 * execute changed WHEN the rung runs, not what it is allowed to touch: the `mutates` test is the
 * first statement in the planning stage, so a write still reaches no model, no collection lister and
 * no store. What the move bought is that every one of the rung's cheap disqualifications - a failed
 * execute, an answer with no single list in it, an answer with no rows - is now discovered BEFORE a
 * planning turn is bought rather than after.
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

/**
 * ONE collection the caller holds, exactly as the planning turn is shown it: its NAME and the field
 * names its rows carry. Structurally the store's own `CollectionFields` - the composition root binds
 * one to the other - but declared here because this is the SEAM's vocabulary, and `integrations/`
 * does not take its prompt shape from `data/`.
 */
export interface ComposeCollection {
  name: string;
  /** Every field name on any row of this collection, sorted. THE SET THE MODEL SELECTS FROM, and
   *  therefore the set `verifyComposePlan` refuses outside of. */
  fields: readonly string[];
}

/**
 * THE LONGEST FIELD NAME THIS RUNG WILL PUT IN A PROMPT, in characters.
 *
 * 64 is chosen against what field names ARE, not against what a prompt can hold: Mongo's own
 * identifier guidance, every ORM's column limit and every REST payload in this repo sit far inside
 * it, so a name past 64 is not a field name that lost a narrowing - it is a string that arrived in
 * the key position. Both directions cost something and both are pinned:
 *
 *   LOWER  - a legitimate long key (`numero_do_processo_no_tribunal_de_comarca`) stops being
 *            offered, and because the offered set is also the ENFORCED set, the narrowing it would
 *            have keyed is refused. A cap that is too tight silently narrows what the product can
 *            answer.
 *   HIGHER - more third-party text per name in a system prompt, and a longer runway for a payload
 *            that is trying to read as an instruction rather than as an identifier.
 */
export const COMPOSE_MAX_FIELD_NAME_CHARS = 64;

/**
 * THE MOST FIELD NAMES THIS RUNG WILL PUT IN A PROMPT, per side.
 *
 * 100 is chosen against what a ROW is: no honest record in this product carries a hundred distinct
 * keys, and a response that does is a document rather than a row. (It coincides with the
 * `collectionName` length limit next door, but that is a limit on a NAME's characters and this is a
 * count of names - the same number for unrelated reasons, which is worth saying so nobody derives
 * one from the other.) Same two directions, same pinning:
 *
 *   LOWER  - a wide-but-legitimate row (a spreadsheet import, a CRM export) loses its tail, and the
 *            fields in that tail become unnarrowable.
 *   HIGHER - an unbounded set is a third party choosing how many tokens of the caller's allowance
 *            this prompt spends, and how much text it contains.
 */
export const COMPOSE_MAX_FIELDS = 100;

/**
 * THE FIELD NAMES THIS RUNG IS WILLING TO SHOW A MODEL - bounded, sanitised, and ORDER-PRESERVING.
 *
 * ================================ WHY A FILTER EXISTS AT ALL ================================
 * Both field sets this rung renders are written by somebody who is not the caller and not us:
 *
 *   - the ACTION side is `fieldsOf(rows)` over the JSON a THIRD-PARTY HTTP API just returned. Every
 *     key in that response is chosen by the remote system, and nothing between their server and
 *     this line inspects it.
 *   - the COLLECTION side is `CollectionsEngine.listCollectionFields`. Collection NAMES are guarded
 *     on every write (`guardCollectionName`: charset, length, reserved prefixes); FIELD names are
 *     guarded NOWHERE - `create`/`importCreate`/`upsert` spread the caller's body straight into
 *     `item` - and a served app that ingests an external feed writes that feed's keys verbatim.
 *
 * So an unbounded, unsanitised, third-party-writable string was being interpolated into a system
 * prompt. That is the classic injection surface, and it had no length bound, no count bound and no
 * charset: a key that begins with a newline and a `# Hard rules` heading renders as its own prompt
 * section, and a response with ten thousand keys spends the caller's allowance on a prompt written
 * by the remote.
 *
 * ================================ WHAT IS BOUNDED, AND WHY THAT =============================
 * A name is offered only if it is short enough (`COMPOSE_MAX_FIELD_NAME_CHARS`) and carries no
 * character that can restructure the text it is embedded in - C0/C1 control characters, which is
 * where newline and carriage return live, DEL, and the backtick that opens and closes every fenced
 * block in both output contracts. Then the set is capped at `COMPOSE_MAX_FIELDS`.
 *
 * NOT A CHARACTER ALLOWLIST, deliberately. `número`, `Fälligkeitsdatum` and `datosCliente` are
 * ordinary keys in this product's actual market, and an ASCII allowlist would refuse the narrowings
 * they key while stopping nothing that a length cap plus a control-character ban does not already
 * stop. A one-line, 64-character identifier has nowhere to put an instruction.
 *
 * ================================ THE SET SHOWN IS THE SET ENFORCED =========================
 * THIS IS THE LOAD-BEARING PROPERTY, and it is why the filter is applied to the value that feeds
 * BOTH the prompt and `verifyComposePlan` rather than to the prompt alone. Filter only the prompt
 * and a dropped name is still ACCEPTED by the suite - the guard would be cosmetic. Filter only the
 * suite and a name the model was shown is refused when it uses it - an arbitrary refusal. Filtered
 * once, upstream of both, a dropped name is simply not offered and not accepted, and the caller is
 * told which names were available in the same `violations` every other field refusal uses.
 */
export function promptSafeFields(names: readonly string[]): string[] {
  return names
    .filter((n) => n.length > 0 && n.length <= COMPOSE_MAX_FIELD_NAME_CHARS && !UNSAFE_IN_PROMPT.test(n))
    .slice(0, COMPOSE_MAX_FIELDS);
}

/** Control characters (C0 and C1, so newline, carriage return and tab included), DEL, and the
 *  backtick that delimits every fenced block the two output contracts ask for.
 *
 *  The `no-control-regex` disable is the ONE case that rule exists to be disabled for: this pattern
 *  is not accidentally matching a control character, it is deliberately REFUSING every one of them
 *  before a third party's string reaches a system prompt. */
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_PROMPT = /[\u0000-\u001F\u007F-\u009F`]/;

/**
 * The field names carried by a set of rows - the union over all of them, sorted.
 *
 * THE UNION, not the first row's keys: a list endpoint that omits an absent optional field on some
 * rows would otherwise have those fields refused, which is a narrowing the caller was entitled to,
 * lost to a fixture-shaped assumption about tidy responses.
 *
 * SORTED, for the reason the collection names are sorted: this goes into a MODEL PROMPT, so its
 * order is part of the input to a nondeterministic step, and the same rows must ask the same
 * question twice.
 */
export function fieldsOf(rows: readonly Record<string, unknown>[]): string[] {
  const names = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) names.add(key);
  return [...names].sort();
}

/**
 * WHAT `where.value` MAY BE. The sibling rung's rule (`action-parametrize.ts`, check 5), for a
 * sibling reason - and this is the ONE thing in a compose plan that cannot be chosen from a set the
 * model was shown, because it is a value rather than a name.
 *
 * A NON-SCALAR HERE FAILS EXACTLY LIKE AN INVENTED FIELD NAME, silently and downwards. Feed
 * `matchesSimpleQuery` an object and the four orderings read `Number({...})` as `NaN`, so nothing
 * matches in any direction; `eq`/`neq` compare by reference against a value that arrived over JSON,
 * so `eq` never matches and `neq` always does; and the three string ops stringify it to
 * `"[object Object]"`. Every one of those produces a well-formed `composed` answer whose `items` are
 * wrong, and none produces an error - the whole finding this rung was fixed for, arriving through
 * the one door the field-name check does not cover.
 *
 * `null` IS ALLOWED, deliberately: it is a value the recipe DSL compares against today (`eq` against
 * a genuinely null column), and refusing it would narrow the vocabulary rather than guard it.
 */
export function isComposeValue(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

export type ComposeCheckName = 'shape' | 'collection_name' | 'collection_known' | 'predicate' | 'value' | 'fields';

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
  /** The collections WITH their fields, exactly as the planning turn was shown them. The suite
   *  refuses any collection or collection-field name that is not in here, which is what turns "the
   *  model guessed" from a silently narrowed answer into a refusal the caller can read. */
  collections: readonly ComposeCollection[];
  /** The field names on the rows the action REALLY returned - `fieldsOf` over the rows in hand.
   *  Available because this rung runs after the execute; before that move there was no honest set to
   *  check `join.resultField` against and it was accepted as any non-empty string. */
  resultFields: readonly string[];
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
  //
  // A LITERAL `false`, and the mutant that proved this line load-bearing was `!== true`: under it
  // `{}`, `{ compose: 0 }` and `{ compose: "no" }` all read as a deliberate decline, so the suite
  // returned `passed: true` about a plan it never validated and the ladder recorded a SKIP with no
  // violations. "The model chose not to join" and "the model emitted garbage" are different facts
  // about a call, and the second is the one that has to reach the repair turn and the ladder.
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
  //
  // HONEST NOTE ON WHAT THIS CAN CATCH THAT `collection_known` BELOW CANNOT: today, nothing. Every
  // name the lister can answer came out of the store, and the store only accepts names that pass
  // this rule, so a plan failing here fails there too. It is kept as the check that stays correct if
  // the LISTER ever changes - a lister answering a `usr.`-prefixed name would satisfy membership and
  // this is what would still refuse it - and what distinguishes two statements only one of which can
  // fire is the CHECK LIST, which the suite pins.
  const nameCheck = collectionName.safeParse(obj.collection);
  checks.push(check(
    'collection_name',
    nameCheck.success,
    `"${String(obj.collection)}" is not a collection this platform can address`,
  ));

  // …AND IT MUST BE ONE THE CALLER WAS SHOWN. Before this check the only test of a collection name
  // was whether it was ADDRESSABLE, so a model naming a plausible collection the tenant does not
  // hold got as far as a store read. Membership is decided against the very list that went into the
  // prompt, so "you may only choose from these" is enforced rather than requested.
  const held = input.collections.find((c) => c.name === obj.collection) ?? null;
  checks.push(check(
    'collection_known',
    held !== null,
    `"${String(obj.collection)}" is not one of the collections you hold`,
  ));

  // The PREDICATE is the recipe DSL's, exactly: one of nine comparisons, one field, one value.
  const op = (whereObj as Record<string, unknown>).op;
  checks.push(check(
    'predicate',
    isSimpleQueryOp(op),
    `"${String(op)}" is not a comparison this platform performs (${SIMPLE_QUERY_OPS.join(', ')})`,
  ));

  // …AND THE VALUE IS A SCALAR - see `isComposeValue`. A separate check rather than a clause of
  // `predicate`, because they are different facts about the plan and the ladder reports which one
  // was wrong: "you named a comparison that does not exist" and "you compared against an object"
  // are different things to send back.
  const value = (whereObj as Record<string, unknown>).value;
  // The `typeof` fallback covers what JSON cannot produce and a direct caller can. This function is
  // exported and judged on its own, so calling an `undefined` "an object" would be the suite lying
  // about the artifact it refused; through the product only the first two branches are reachable,
  // because `parseComposePlan` runs `JSON.parse`.
  checks.push(check(
    'value',
    isComposeValue(value),
    `"where.value" must be a string, number, boolean or null - ${
      Array.isArray(value) ? 'an array' : typeof value === 'object' ? 'an object' : `a ${typeof value}`
    } compares against nothing this platform can evaluate`,
  ));

  // THE THREE FIELD NAMES, EACH AGAINST THE SET IT WAS OFFERED. This is the check the rung did not
  // have, and its absence was not a missing validation so much as a missing QUESTION: the model was
  // never told what the fields were, so there was no set to check against and any non-empty string
  // was accepted. A wrong one then produced an empty or narrowed answer that looked exactly like a
  // correct one.
  //
  // `join.resultField` is judged against the rows the action REALLY returned, not against a declared
  // `returnSchema`: schemas here are unvalidated documentation (`definitions.ts` takes them off
  // `config.json` verbatim), and a list endpoint's schema describes the ENVELOPE, whose top-level
  // keys are not the row's. The rows in hand are the only exact answer, and this rung now has them.
  const whereField = (whereObj as Record<string, unknown>).field as string;
  const resultField = (joinObj as Record<string, unknown>).resultField as string;
  const collectionField = (joinObj as Record<string, unknown>).collectionField as string;
  const unknownFields: string[] = [];
  // THE WORDING IS ABOUT OFFEREDNESS, NOT ABOUT EXISTENCE, and that is load-bearing rather than
  // pedantic. These messages used to say "is not a field of X", which was true only while the
  // offered set was the WHOLE set. `promptSafeFields` now bounds and sanitises both sets before
  // either the prompt or this suite sees them, so a real field CAN be absent from the set - a key
  // past the count cap, or one carrying a control character - and telling a caller that `idade` is
  // "not a field of your own clients collection" would be the platform stating a falsehood about
  // their own data. `docs/findings.md` dismissed a cap for exactly that reason before this wording
  // existed; the dismissal is answered here rather than ignored.
  if (!input.resultFields.includes(resultField)) {
    unknownFields.push(
      `"join.resultField": "${resultField}" is not among the fields offered for the rows the action returned (${input.resultFields.join(', ')})`,
    );
  }
  // The collection's fields can only be judged when the collection resolved. Naming a set for a
  // collection the caller does not hold would be this suite inventing the artifact it judges - the
  // rule the `shape` short-circuit above states, applied one level down.
  if (held) {
    // `'none'` IS UNREACHABLE THROUGH THE PRODUCT and is labelled rather than pretended otherwise:
    // it needs a collection whose rows carry no keys at all, which no `CollectionsEngine` write path
    // can produce (see `listCollectionFields`). It is the correct rendering for a caller that hands
    // this exported function such a set directly, not a branch anything exercises.
    const offered = held.fields.length > 0 ? held.fields.join(', ') : 'none';
    if (!held.fields.includes(whereField)) {
      unknownFields.push(`"where.field": "${whereField}" is not among the fields offered for "${held.name}" (${offered})`);
    }
    if (!held.fields.includes(collectionField)) {
      unknownFields.push(`"join.collectionField": "${collectionField}" is not among the fields offered for "${held.name}" (${offered})`);
    }
  }
  checks.push(check('fields', unknownFields.length === 0, unknownFields.join('; ')));

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
  /** The collections this caller holds, each with the field names its rows carry. BOTH halves are
   *  for the prompt, so the model chooses a collection AND a field from lists rather than inventing
   *  either - and a name it invents anyway is refused by `verifyComposePlan`. */
  list(actor: Actor): Promise<ComposeCollection[]>;
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
 * WHAT THE STAGE PRODUCED. Two members, and the second one is the FLOOR under the whole rung:
 * whatever the plan says, if a field it names is not on the rows actually being joined, this stage
 * refuses to narrow rather than narrowing by a field nobody has. The caller then receives the
 * executed arm's answer whole - `integration-achieve.ts` turns this into a ladder step and a null.
 */
export type ComposeStageResult =
  | { kind: 'composed'; items: Record<string, unknown>[]; summary: ComposeSummary }
  | { kind: 'not_applicable'; missing: string[] };

/**
 * THE STAGE. Pure: rows in, rows out, no I/O, no model, no clock.
 *
 * Filter the collection by the predicate, key the survivors, keep the action rows whose join field
 * is in that key set. Keys are compared AS STRINGS after a null check - an id that arrives as `7`
 * from one side and `"7"` from the other is the same client, and refusing to see that would make
 * the rung useless against real APIs. A null/undefined key on either side matches nothing rather
 * than matching every other absent key.
 *
 * FIRST, THOUGH: THE COLLECTION-SIDE FIELDS MUST BE ON THE ROWS THIS STAGE WAS HANDED. A missing
 * field is not a filter that matches nothing - it is a filter that was never applied, and the
 * difference is the whole finding: `matchesSimpleQuery` reads `undefined` off every row, so a wrong
 * `where.field` selects nothing (or, under `neq`, EVERYTHING) and a wrong `join.collectionField`
 * empties the key set. Either way `items` comes back short, and short is indistinguishable from
 * correct when what was asked for was a filtered list.
 *
 * THIS IS NOT A SECOND STATEMENT OF `verifyComposePlan`'s `fields` CHECK, and the distinction is the
 * reason it is here at all. That check judges the plan against what the STORE says the collection
 * holds, at planning time; this one judges the ROWS THAT WERE ACTUALLY READ, one query later. They
 * disagree exactly when the collection changed in between - a row deleted, a field dropped - which
 * is a live race, not a hypothetical, because the lister and the reader are two separate queries.
 *
 * The ACTION side is deliberately NOT re-checked here: `verifyComposePlan` judged `join.resultField`
 * against `fieldsOf` of THE SAME ARRAY this function receives, in the same moment, so a second test
 * of it could never fire and would be the "two statements, one reading" this module refuses
 * elsewhere.
 */
export function composeRows(input: {
  plan: Extract<ComposePlan, { compose: true }>;
  actionRows: readonly Record<string, unknown>[];
  collectionRows: readonly Record<string, unknown>[];
}): ComposeStageResult {
  const scanned = input.actionRows.length;
  const considered = input.collectionRows.slice(0, COMPOSE_MAX_COLLECTION_ROWS);
  const present = new Set(fieldsOf(considered));
  const missing = [input.plan.where.field, input.plan.join.collectionField]
    .filter((f, i, all) => all.indexOf(f) === i)
    .filter((f) => !present.has(f));
  if (missing.length > 0) return { kind: 'not_applicable', missing };
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
    kind: 'composed',
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

/**
 * Extract the single ```compose-json block and parse it. No JSON repair pass - `achieve`'s rule.
 *
 * THE FENCE TAG IS PART OF THE CONTRACT, not decoration, and a mutant relaxing it to `` ```[a-z-]* ``
 * survived the whole estate. The two rungs share one authoring core and one repair loop, and a
 * planning reply routinely carries prose with an illustrative ```json block in it; a tag-blind
 * parser would take the FIRST fenced thing it found - an example, or the other rung's `args-json` -
 * and hand it to `verifyComposePlan` as this rung's plan. The suite would then refuse a plan the
 * model never proposed, and the violations sent back for repair would be about the wrong artifact.
 */
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
    'If the goal asks ONLY for what the action already returned, answer exactly:',
    '```compose-json',
    '{ "compose": false }',
    '```',
    '',
    'If the goal narrows those rows by a fact held in one of the collections listed above,',
    'answer with the join that narrows it:',
    '```compose-json',
    '{',
    '  "compose": true,',
    '  "collection": "<one of the collection names listed above>",',
    '  "where": { "field": "<a field listed for that collection>", "op": "lt", "value": 40 },',
    '  "join": { "resultField": "<a field listed for the action\'s rows>", "collectionField": "<a field listed for that collection>" }',
    '}',
    '```',
    '',
    '# Hard rules (a plan that breaks any of these is refused, and the action answers unnarrowed)',
    `1. "op" is one of: ${SIMPLE_QUERY_OPS.join(', ')}. There are no others, and no boolean logic:`,
    '   exactly ONE field compared against ONE value.',
    '2. "collection" must be one of the collection names listed above. You may not invent one.',
    '3. EVERY FIELD NAME MUST COME FROM THE LISTS ABOVE. "join.resultField" must be one of the fields',
    '   listed for the action\'s rows; "where.field" and "join.collectionField" must both be fields',
    '   listed for the collection you chose. Each is checked against those lists.',
    '4. If no listed field says what the goal is asking about, answer { "compose": false }. A guessed',
    '   field name does not produce a narrower answer - it produces a WRONG one, and the person',
    '   reading it cannot tell.',
    '5. "where.value" is a single string, number, boolean or null. Not an object, not an array, and',
    '   no operators inside it.',
    '6. "join" states which field of the ACTION\'s rows equals which field of the COLLECTION\'s rows.',
    '7. You are not choosing the action, and you cannot run anything. If the goal needs work the',
    '   action plus one such join cannot do, answer { "compose": false } and say nothing else.',
    '8. Never put a credential, a token or a person\'s password in any field.',
  ].join('\n');
}
