/**
 * integrations/recipe-store.ts - the ONE writer of a compiled recipe (slice P2.0).
 *
 * WHERE THE RECIPE LIVES, AND WHY IT IS NOT A COLLECTION. The compiled recipe is small, bounded and
 * per-action (templates, locators, short lessons), and it has exactly the action's lifecycle. So it
 * folds back onto the action inside the definition document, and this module is the store surface
 * over that field. That is the same argument `definition-store.ts` used to REJECT a separate
 * snapshots collection ("the snapshot has no lifecycle independent of its definition ... a second
 * document is a second thing that can be missing"). The RAW captures the recipe was distilled from
 * are the opposite case on every axis and DO earn a collection - see `captured-calls-store.ts`.
 *
 * TENANCY (Capability Contract rule 5). Every method takes the OWNING ORG explicitly and reaches the
 * row by `definitionIdFor(orgId, key)`, so a foreign row is never even fetched: the id derivation is
 * the primary tenancy gate, exactly as it is the uniqueness primitive. On top of that, the CAS
 * mutator re-asserts `doc.orgId === orgId` before writing (the E1-review F4b discipline - `update`
 * re-reads its document, so the row finally written may not be the one authorised), and the
 * actor-scoped reads additionally apply `isDefinitionVisibleTo` so a peer's PRIVATE row stays
 * invisible. A recipe is TENANT DATA even on a `global` definition - it was learned inside one
 * tenant's authenticated session - which is why the actor reads resolve only the actor's own-org row
 * and never fall through to the cross-org `global` tier the way `getForActor` does.
 *
 * WHAT MAY BE STORED. A recipe that carries a VALUE is refused, never repaired: `assertCarriesNoValues`
 * checks every header name against the header-name grammar, scans every string in the recipe with the
 * repo's literal-secret predicate (`looksLikeLiteralSecret`, the publish floor's blanket-scan rule -
 * one implementation, two verdicts: the floor redacts, this refuses), and, when the caller passes the
 * run's `SecretRegistry`, refuses any recipe in which a live credential value appears at all. Refusal
 * rather than redaction is the point: a redacted recipe would be a silently broken recipe, and a
 * capture path writing values is a defect that must surface at once.
 *
 * VERSION IS STORE-OWNED. `version` is monotonic per (orgId, key, actionName) and is stamped here,
 * from the row inside the mutator - never taken from the caller. It is what the supersede lineage is
 * read from, so a caller able to set it could rewrite history by writing a lower number.
 */
import type { Actor } from '@ekoa/shared';
import { Store, type Doc } from '../data/store.js';
import { integrationDefinitions } from '../data/stores.js';
import type { SecretRegistry } from '../security/redaction.js';
import type {
  IntegrationAction,
  IntegrationActionRecipe,
} from './definitions.js';
import { PLACEHOLDER_SRC } from './definitions.js';
import {
  definitionIdFor,
  isDefinitionVisibleTo,
  type IntegrationDefinitionDoc,
} from './definition-store.js';
import { looksLikeLiteralSecret } from './publish-scrub.js';

/** What a caller may author: everything except the two fields the store owns (`version`) or stamps
 *  (`compiledAt`, `supersedes`). Discovery describes what it learned; the store dates and numbers it. */
export type RecipeDraft = Omit<IntegrationActionRecipe, 'version' | 'compiledAt' | 'supersedes' | 'stats'>;

/** A supersede additionally states WHY the previous recipe stopped working - the lineage's payload. */
export type RecipeSupersedeInput = RecipeDraft & { reason: string };

/**
 * The verdicts. `notfound` covers a missing definition, a definition the org does not own, an action
 * that is not on it, and (for `supersedeRecipe`) an action with no recipe to supersede: a caller who
 * may not see something learns nothing about which of those it was.
 */
export type RecipeWriteResult =
  | { verdict: 'ok'; recipe: IntegrationActionRecipe }
  | { verdict: 'notfound' }
  | { verdict: 'exists'; recipe: IntegrationActionRecipe };

export type RecipeStoreErrorCode = 'UNSAFE' | 'INVALID';

/** A refusal, not an outcome: every code here means the caller handed the store something it must
 *  never persist. Deliberately thrown rather than returned, so it cannot be ignored like a verdict. */
export class RecipeStoreError extends Error {
  constructor(public readonly code: RecipeStoreErrorCode, message: string) {
    super(message);
    this.name = 'RecipeStoreError';
  }
}

/** Same grammar the engine-side `HeaderName` brand enforces (`automation/recipe.ts`). Restated here
 *  because tier 3 may not import tier 5 - and because this is the boundary that must hold even if
 *  the compile-time fence upstream was defeated by a cast. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

/** The floor's own token split: placeholders are skipped whole (redacting or refusing the NAME
 *  inside `{{…}}` would condemn every legitimate template), everything else is scanned. */
const RECIPE_TOKEN_RE = new RegExp(`${PLACEHOLDER_SRC}|[A-Za-z0-9+/=_.-]+`, 'g');

/** Bounds that keep the compiled recipe BOUNDED - the whole reason it may ride the definition
 *  document while the raw captures may not (Trap T2, the 16MB limit). They are generous by two
 *  orders of magnitude for a real recipe and still cap the document's growth at a few hundred KB. */
const LIMITS = {
  injectedCalls: 200,
  scriptedSteps: 200,
  lessons: 200,
  headerNames: 60,
  stringChars: 8_000,
} as const;

export class IntegrationRecipeStore {
  private readonly store: Store<IntegrationDefinitionDoc>;

  constructor(
    store: Store<Doc> = integrationDefinitions,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store as unknown as Store<IntegrationDefinitionDoc>;
  }

  // ------------------------------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------------------------------

  /**
   * The compiled recipe of one action, for a MACHINE caller that already holds the owning org (the
   * run loop, which carries the run owner's verified `orgId` - never one read off a request body).
   */
  async getRecipe(orgId: string, key: string, actionName: string): Promise<IntegrationActionRecipe | null> {
    const doc = await this.rowFor(orgId, key);
    return doc ? (findAction(doc, actionName)?.recipe ?? null) : null;
  }

  /**
   * The same read on behalf of a PRINCIPAL. Two gates, not one: the row is resolved inside the
   * actor's own org (so no cross-org row is reachable at all) and then passed through the A1 read
   * predicate (so a same-org peer's PRIVATE definition stays invisible, admins included).
   */
  async getRecipeForActor(actor: Actor, key: string, actionName: string): Promise<IntegrationActionRecipe | null> {
    const doc = await this.rowForActor(actor, key);
    return doc ? (findAction(doc, actionName)?.recipe ?? null) : null;
  }

  /** Every compiled action of one integration, for the owning org. */
  async listRecipes(orgId: string, key: string): Promise<Array<{ actionName: string; recipe: IntegrationActionRecipe }>> {
    const doc = await this.rowFor(orgId, key);
    return doc ? recipesOf(doc) : [];
  }

  /**
   * Every compiled action the ACTOR may see, across their org's definitions. The enumeration
   * surface: it queries `{ orgId: actor.orgId }` and then re-applies the visibility predicate, so
   * neither another org's rows nor a peer's private row can appear in it.
   */
  async listRecipesForActor(actor: Actor): Promise<Array<{ key: string; actionName: string; recipe: IntegrationActionRecipe }>> {
    if (actor.orgId === '') return [];
    const rows = await this.store.find({ orgId: actor.orgId });
    return rows
      .filter((doc) => doc.orgId === actor.orgId && isDefinitionVisibleTo(doc, actor))
      .flatMap((doc) => recipesOf(doc).map((r) => ({ key: doc.key, ...r })));
  }

  // ------------------------------------------------------------------------------------------
  // Writes
  // ------------------------------------------------------------------------------------------

  /**
   * The FIRST compile of an action: writes `version: 1`.
   *
   * An action that already carries a recipe answers `exists` instead of overwriting it. That is not
   * politeness - it forces every later write through `supersedeRecipe`, which is the only path that
   * records what was replaced and why. A recipe that could be silently overwritten would lose the
   * lineage the drift/self-heal loop (P2.4) is diagnosed from.
   */
  async putRecipe(
    orgId: string,
    key: string,
    actionName: string,
    draft: RecipeDraft,
    opts: { secrets?: SecretRegistry; learnedRunMs?: number } = {},
  ): Promise<RecipeWriteResult> {
    assertCarriesNoValues(draft, opts.secrets);
    assertAnswerPointsAtACall(draft);
    return this.writeRecipe(orgId, key, actionName, (current) => {
      if (current) return { refuse: { verdict: 'exists', recipe: current } };
      return {
        recipe: {
          ...cloneDraft(draft),
          version: 1,
          compiledAt: this.nowIso(),
          // K4: the "before" of the speed story, from the learning run itself. Store-owned with
          // the rest of `stats` - `RecipeDraft` excludes the field, so a caller cannot fake it.
          stats: { replayCount: 0, ...(opts.learnedRunMs !== undefined ? { learnedRunMs: opts.learnedRunMs } : {}) },
        },
      };
    });
  }

  /**
   * SUPERSEDE (Trap T1): the tenant-scoped self-heal write. Bumps `version` and stamps the one-hop
   * `supersedes` lineage - the shape `publishSnapshot` uses (definition-store.ts), deliberately NOT
   * that function: its gate is super-admin AND it flips the row to `global` visibility, so it cannot
   * serve a tenant-private heal. This one is org-scoped and touches `visibility`, `publishedSnapshot`
   * and `publishRequest` not at all.
   *
   * The prior version is read from the row INSIDE the mutator, so the recorded lineage is the recipe
   * this write actually replaced rather than whichever one the caller happened to read first.
   */
  async supersedeRecipe(
    orgId: string,
    key: string,
    actionName: string,
    next: RecipeSupersedeInput,
    opts: { secrets?: SecretRegistry; learnedRunMs?: number } = {},
  ): Promise<RecipeWriteResult> {
    const { reason, ...draft } = next;
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new RecipeStoreError('INVALID', 'a supersede must state why the previous recipe was replaced');
    }
    // THE WHOLE PAYLOAD, `reason` INCLUDED - `next`, not `draft`. `reason` is written as
    // `supersedes.reason` and is therefore a persisted string like any other, but destructuring it
    // out before the proof exempted it from all three checks at once: the SecretRegistry leg, the
    // literal-secret scan and `LIMITS.stringChars`. It is the LEAST trusted string in the payload -
    // it is daemon-supplied or fetch-error text (`classifyReplayDrift`'s signal reason) rather than
    // anything this module compiled - it rides every read and every CAS of the definition document
    // (Trap T2, the whole bounded-recipe argument), and `recipeSummary` puts it on the wire to the
    // owner. "Every write goes through it" is the header's claim; this makes it true.
    assertCarriesNoValues(next, opts.secrets);
    assertAnswerPointsAtACall(draft);
    return this.writeRecipe(orgId, key, actionName, (current) => {
      // Nothing to supersede is `notfound`, not an implicit first compile: a heal that believes it
      // is replacing something, and silently is not, is a lost signal about the action's history.
      if (!current) return { refuse: { verdict: 'notfound' } };
      return {
        recipe: {
          ...cloneDraft(draft),
          version: current.version + 1,
          compiledAt: this.nowIso(),
          supersedes: { version: current.version, reason },
          // Fresh stats: the superseding recipe has replayed nothing yet, and its "before" is the
          // healing run that compiled it, not the original learn. `driftStreak` is the one field
          // that carries ACROSS the supersede (K6): every supersede is a heal, so the streak of
          // heals-without-a-replay-between grows here and is zeroed only by `recordReplay`.
          stats: {
            replayCount: 0,
            ...(opts.learnedRunMs !== undefined ? { learnedRunMs: opts.learnedRunMs } : {}),
            driftStreak: (current.stats?.driftStreak ?? 0) + 1,
          },
        },
      };
    });
  }

  /**
   * RECORD one successful replay (cornerstone K4): bump the counter, stamp when and how fast.
   *
   * Deliberately NOT `putRecipe`-shaped: this touches nothing a caller authors - no templates, no
   * strings - so the write asserts run against nothing new. Best-effort by contract: the replay
   * already ANSWERED, and a stats row that lost a CAS race or found the recipe superseded
   * mid-flight must never turn that answer into a failure, so a missing row is a silent no-op.
   */
  async recordReplay(
    orgId: string,
    key: string,
    actionName: string,
    input: { ms?: number } = {},
  ): Promise<void> {
    await this.writeRecipe(orgId, key, actionName, (current) => {
      if (!current) return { refuse: { verdict: 'notfound' } };
      return {
        recipe: {
          ...current,
          stats: {
            ...(current.stats ?? {}),
            replayCount: (current.stats?.replayCount ?? 0) + 1,
            lastReplayedAt: this.nowIso(),
            ...(input.ms !== undefined ? { lastReplayMs: input.ms } : {}),
            // K6: a replay that answered proves the recipe holds - the heal streak starts over.
            driftStreak: 0,
          },
        },
      };
    });
  }

  /**
   * DROP an action's recipe, putting the action back to never-having-learned.
   *
   * This is the escape hatch that stops a bad recipe becoming a permanent property of an action.
   * `putRecipe` refuses to overwrite and `supersedeRecipe` only bumps, so without a clear there is
   * no way out of a recipe the replay will not run: the action pays for a doomed replay attempt on
   * every single run, forever, and its owner has no control that changes it. That is the shape of
   * the `mutates:false` action whose learned recipe turned out to contain a POST - a legitimate and
   * expected outcome of discovery, since a site is free to serve a read over POST.
   *
   * IT IS NOT A DELETE OF ANYTHING ELSE. The action, its binding and the row are untouched; the
   * action goes on working by the path it worked by before it ever learned. `null` means there was
   * nothing to clear, which is the ordinary idempotent case and never an error.
   *
   * IT ANSWERS WITH THE RECIPE IT DROPPED, and that is not a convenience. The recipe is the only
   * thing that names its `capturedCallsRef` - the pile of full redacted request and response bodies
   * in `integration_captured_calls`, which has no TTL and no other index back to it. A caller that
   * threw this away (the mount did, by narrowing it to a boolean) orphaned that pile permanently:
   * the next learn's `priorCaptureRef` reads the CURRENT recipe, which is now absent, so neither of
   * `discardCapture`'s other two callers can ever reach it. `integrations/recipe-lifecycle.ts` is
   * the ONE place that pairs the two, and every caller goes through it.
   *
   * `visibleTo` is the ACTOR gate, for the surfaces a principal reaches (`routes/integrations.ts`).
   * Absent for a machine caller that already holds the owning org. It is applied INSIDE the CAS as
   * well as before it, exactly like the `orgId` re-assert beside it and for the same reason.
   */
  async clearRecipe(
    orgId: string,
    key: string,
    actionName: string,
    opts: { visibleTo?: Actor } = {},
  ): Promise<IntegrationActionRecipe | null> {
    const result = await this.writeRecipe(
      orgId,
      key,
      actionName,
      (current) => (current ? { clear: true } : { refuse: { verdict: 'notfound' } }),
      opts,
    );
    return result.verdict === 'ok' ? result.recipe : null;
  }

  // ------------------------------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------------------------------

  /** The one write path. `decide` runs against the recipe CURRENTLY on the row, inside the CAS. */
  private async writeRecipe(
    orgId: string,
    key: string,
    actionName: string,
    decide: (current: IntegrationActionRecipe | undefined) =>
      | { recipe: IntegrationActionRecipe; refuse?: undefined; clear?: undefined }
      | { clear: true; recipe?: undefined; refuse?: undefined }
      | { refuse: RecipeWriteResult; recipe?: undefined; clear?: undefined },
    opts: { visibleTo?: Actor } = {},
  ): Promise<RecipeWriteResult> {
    // An org-less caller can never own a row (`isDefinitionVisibleTo` refuses an org-less document
    // for the same reason): refuse before deriving an id that would collide on the empty tenant.
    if (orgId === '' || key === '' || actionName === '') return { verdict: 'notfound' };
    // AN ACTOR MAY ONLY EVER ACT INSIDE ITS OWN ORG. The row id is derived from `orgId`, so a
    // mismatch here would mean the visibility predicate was being asked about one tenant's row on
    // another tenant's behalf. Refused rather than reconciled.
    if (opts.visibleTo && opts.visibleTo.orgId !== orgId) return { verdict: 'notfound' };
    const id = definitionIdFor(orgId, key);
    const row = await this.store.get(id);
    if (!row || row.orgId !== orgId || !findAction(row, actionName)) return { verdict: 'notfound' };
    if (opts.visibleTo && !isDefinitionVisibleTo(row, opts.visibleTo)) return { verdict: 'notfound' };

    let refused: RecipeWriteResult | null = null;
    let written: IntegrationActionRecipe | null = null;
    let cleared: IntegrationActionRecipe | null = null;
    const updated = await this.store.update(id, (cur) => {
      // RESET on every attempt: `Store.update` re-runs the mutator after losing a CAS race, and a
      // verdict recorded on a losing attempt is not the one the winning attempt reached.
      refused = null;
      written = null;
      cleared = null;
      const doc = cur as IntegrationDefinitionDoc;
      // THE TENANCY RE-ASSERT. The id already binds the row to `orgId`; this catches the case the id
      // cannot - a row whose `orgId` does not match the id it is stored under (a hand-written or
      // migrated document). Cheap, and it fails closed.
      if (doc.orgId !== orgId) {
        refused = { verdict: 'notfound' };
        return cur;
      }
      // THE ACTOR RE-ASSERT, for the same reason the tenancy one above is re-asserted here:
      // `Store.update` re-reads its document, so the row finally written may not be the one whose
      // visibility was checked before the CAS (a peer could have flipped it to `private` between).
      if (opts.visibleTo && !isDefinitionVisibleTo(doc, opts.visibleTo)) {
        refused = { verdict: 'notfound' };
        return cur;
      }
      const actions = doc.actions ?? [];
      const index = actions.findIndex((a) => a.actionName === actionName);
      if (index < 0) {
        refused = { verdict: 'notfound' };
        return cur;
      }
      const decision = decide(actions[index]?.recipe);
      if (decision.refuse) {
        refused = decision.refuse;
        return cur;
      }
      if (decision.clear) {
        // `ok` carries WHAT WAS REMOVED, which keeps `writeRecipe`'s contract intact and is the
        // more useful answer anyway: a caller clearing a recipe wants to log the version it dropped.
        cleared = actions[index]?.recipe ?? null;
        const nextActions = actions.map((action, i) => {
          if (i !== index) return action;
          // The FIELD goes, not an empty recipe in its place: `getRecipe` answers on presence, and
          // a hollow `{}` would be a recipe this build cannot read rather than no recipe at all.
          const { recipe: _dropped, ...withoutRecipe } = action;
          return withoutRecipe;
        });
        return { ...cur, actions: nextActions, updatedAt: this.nextStamp(doc.updatedAt) };
      }
      written = decision.recipe;
      const nextActions = actions.map((action, i) =>
        i === index ? { ...action, recipe: decision.recipe } : action,
      );
      // ONLY `actions` and the stamp move. Visibility, the published snapshot and the publish
      // request are decisions about the ROW that a recipe write has no authority over - a heal that
      // could touch them would be a publication path wearing a self-heal's name.
      return { ...cur, actions: nextActions, updatedAt: this.nextStamp(doc.updatedAt) };
    });
    if (refused) return refused;
    if (!updated) return { verdict: 'notfound' };
    if (cleared) return { verdict: 'ok', recipe: cleared };
    if (!written) return { verdict: 'notfound' };
    return { verdict: 'ok', recipe: written };
  }

  /** The org's row for `key`, or null. The id derivation IS the tenancy gate; the `orgId` re-check
   *  covers a document stored under an id that does not describe it. */
  private async rowFor(orgId: string, key: string): Promise<IntegrationDefinitionDoc | null> {
    if (orgId === '' || key === '') return null;
    const doc = await this.store.get(definitionIdFor(orgId, key));
    return doc && doc.orgId === orgId ? doc : null;
  }

  /** The actor's own-org row for `key`, if the actor may see it. Never the cross-org `global` tier:
   *  a recipe belongs to the tenant whose session it was learned in, whatever the row's visibility. */
  private async rowForActor(actor: Actor, key: string): Promise<IntegrationDefinitionDoc | null> {
    const doc = await this.rowFor(actor.orgId, key);
    return doc && isDefinitionVisibleTo(doc, actor) ? doc : null;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  /** Strictly monotonic, never merely "now": `updatedAt` is the definition store's optimistic-
   *  concurrency token (`setLessons`), and two writes inside one millisecond would otherwise share
   *  one - precisely the case that token exists to catch. */
  private nextStamp(prev: string | undefined): string {
    const prior = prev === undefined ? Number.NaN : Date.parse(prev);
    const now = this.now().getTime();
    return new Date(Number.isNaN(prior) ? now : Math.max(now, prior + 1)).toISOString();
  }
}

function findAction(doc: IntegrationDefinitionDoc, actionName: string): IntegrationAction | undefined {
  return (doc.actions ?? []).find((a) => a.actionName === actionName);
}

function recipesOf(doc: IntegrationDefinitionDoc): Array<{ actionName: string; recipe: IntegrationActionRecipe }> {
  return (doc.actions ?? [])
    .filter((a): a is IntegrationAction & { recipe: IntegrationActionRecipe } => a.recipe !== undefined)
    .map((a) => ({ actionName: a.actionName, recipe: a.recipe }));
}

/** A deep-enough copy that a caller holding the draft cannot mutate what was persisted (and that a
 *  stray extra property on the draft cannot ride into the document). */
function cloneDraft(draft: RecipeDraft): RecipeDraft {
  return {
    goal: draft.goal,
    injectedCalls: draft.injectedCalls.map((c) => ({
      method: c.method,
      urlTemplate: c.urlTemplate,
      headerNames: [...c.headerNames],
      ...(c.bodyTemplate !== undefined ? { bodyTemplate: c.bodyTemplate } : {}),
      ...(c.expectShape !== undefined ? { expectShape: c.expectShape } : {}),
      idempotent: c.idempotent,
    })),
    scriptedSteps: draft.scriptedSteps.map((s) => ({
      locator: s.locator,
      action: s.action,
      ...(s.value !== undefined ? { value: s.value } : {}),
    })),
    // The answer pointer, copied field by field like everything else here. It was PROVEN to index a
    // call of this same draft by `assertAnswerPointsAtACall` at the write, before anything was read
    // or written - see the two callers.
    ...(draft.answersWith !== undefined
      ? { answersWith: { callIndex: draft.answersWith.callIndex, matchedBy: draft.answersWith.matchedBy } }
      : {}),
    lessons: [...draft.lessons],
    ...(draft.capturedCallsRef !== undefined ? { capturedCallsRef: draft.capturedCallsRef } : {}),
  };
}

/**
 * THE ANSWER POINTER MUST POINT AT A CALL OF THE RECIPE IT TRAVELS WITH.
 *
 * `answersWith` selects WHICH replayed body becomes the action's answer, so a pointer that indexes
 * nothing is not cosmetic: `parseCompiledRecipe` throws the whole recipe away on every later read,
 * i.e. the action silently stops replaying for a reason nothing recorded. This is the last point at
 * which the pointer and the calls are still checkable against each other - after it, the recipe is a
 * document. Refused rather than repaired, like every other refusal in this module.
 */
export function assertAnswerPointsAtACall(draft: RecipeDraft): void {
  if (draft.answersWith === undefined) return; // ordinary: the run it was learned from answered nothing
  const { callIndex } = draft.answersWith;
  if (!Number.isInteger(callIndex) || callIndex < 0 || callIndex >= draft.injectedCalls.length) {
    throw new RecipeStoreError(
      'INVALID',
      `answersWith.callIndex (${callIndex}) does not name one of this recipe's ${draft.injectedCalls.length} injected call(s)`,
    );
  }
}

/**
 * THE PERSISTENCE-BOUNDARY PROOF (Trap T8). Every write goes through it, and it REFUSES rather than
 * redacts - see the module header.
 *
 * Three checks, each catching what the others cannot:
 *   - the header-name grammar catches a value parked in `headerNames`, which is the one field whose
 *     whole purpose is to be a name;
 *   - `looksLikeLiteralSecret` (the publish floor's blanket-scan predicate, reused rather than
 *     re-derived) catches a pasted credential ANYWHERE in the recipe - a query value baked into a
 *     `urlTemplate`, a token in a `bodyTemplate`, a key quoted in a lesson;
 *   - the run's `SecretRegistry`, when the caller has one, catches what neither shape rule can: a
 *     SHORT or low-entropy live credential, in any encoding it might be wearing by then.
 * Messages name the POSITION only. A rejected string is very likely a credential, and an error
 * message is a log line.
 */
export function assertCarriesNoValues(draft: RecipeDraft, secrets?: SecretRegistry): void {
  if (draft.injectedCalls.length > LIMITS.injectedCalls) {
    throw new RecipeStoreError('INVALID', `a compiled recipe may declare at most ${LIMITS.injectedCalls} injected calls`);
  }
  if (draft.scriptedSteps.length > LIMITS.scriptedSteps) {
    throw new RecipeStoreError('INVALID', `a compiled recipe may declare at most ${LIMITS.scriptedSteps} scripted steps`);
  }
  if (draft.lessons.length > LIMITS.lessons) {
    throw new RecipeStoreError('INVALID', `a compiled recipe may carry at most ${LIMITS.lessons} lessons`);
  }
  draft.injectedCalls.forEach((call, i) => {
    if (call.headerNames.length > LIMITS.headerNames) {
      throw new RecipeStoreError('INVALID', `injectedCalls[${i}].headerNames exceeds ${LIMITS.headerNames} entries`);
    }
    call.headerNames.forEach((name, j) => {
      if (typeof name !== 'string' || !HEADER_NAME_RE.test(name)) {
        throw new RecipeStoreError(
          'UNSAFE',
          `injectedCalls[${i}].headerNames[${j}] is not an HTTP header name (length ${String(name).length}) - a recipe stores header NAMES, never values`,
        );
      }
    });
  });
  walkStrings(draft, '', (value, path) => {
    if (value.length > LIMITS.stringChars) {
      throw new RecipeStoreError('INVALID', `${path} exceeds ${LIMITS.stringChars} characters - a compiled recipe is a distillation, not a dump`);
    }
    if (secrets && secrets.redact(value) !== value) {
      throw new RecipeStoreError('UNSAFE', `${path} contains a live credential value from this run`);
    }
    for (const match of value.matchAll(RECIPE_TOKEN_RE)) {
      const token = match[0];
      if (!token.startsWith('{{') && looksLikeLiteralSecret(token)) {
        throw new RecipeStoreError('UNSAFE', `${path} contains a literal secret-shaped token (length ${token.length})`);
      }
    }
  });
}

/** Every string leaf of a value tree, with its dotted path. Object KEYS are visited too: a key can
 *  carry a value just as a value can (the same reason `SecretRegistry.redactDeep` redacts keys). */
function walkStrings(value: unknown, path: string, visit: (value: string, path: string) => void): void {
  if (typeof value === 'string') {
    visit(value, path === '' ? 'recipe' : path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = path === '' ? k : `${path}.${k}`;
      visit(k, `${child} (key)`);
      walkStrings(v, child, visit);
    }
  }
}

/** The process-wide store over the real `integration_definitions` collection. */
export const integrationRecipeStore = new IntegrationRecipeStore();
