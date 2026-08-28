'use client';

/**
 * The integration DETAIL store (slice S2) - what one integration's actions are, what each one did
 * the last time it worked, and what happens when the user runs one now.
 *
 * ── WHY A SEPARATE STORE FROM `stores/integrations.ts` ────────────────────────────────────────
 *
 * That store is the LIST page's: every skill, every config, the platform statuses, the session
 * polling timers and the write-gate approvals, all keyed by integration and all fetched together.
 * The detail page reads ONE integration and, per action, three things the list has no use for (the
 * evidence sample, the bound automation's steps, the run history). Folding those in would make the
 * list page's `fetchAll` either pay for them or grow a flag; keeping them apart means the detail
 * page's failures are the detail page's.
 *
 * ── THE FAILURE CHANNELS, AND WHY THERE ARE FIVE OF THEM ──────────────────────────────────────
 *
 * Every one of these was a real defect on the schedules surface in this repo, so they are separated
 * by WHERE THEY MUST RENDER rather than by tidiness:
 *
 *   `capabilityError`  - the page's own read broke. It is the ApiError and not a string, because
 *                        404 (absent - or refused, or another tenant's: one uniform envelope) and
 *                        500/403/network (failed to load something that is very probably still
 *                        there) demand opposite renderings, and a page that collapses them tells a
 *                        user their integration does not exist because a server hiccuped.
 *   `evidenceError`    - the samples did not arrive. The steps view still renders (the steps come
 *                        from the definition and the automation), with the sample's absence stated.
 *   `feedbackError`    - the caller's own notes did not arrive (slice S3). Its own channel and NOT
 *                        merged into `evidenceError`, because the two demand opposite behaviour
 *                        from the surface: a missing sample is information the page simply lacks,
 *                        while a missing NOTE is the user's own text - the editor must refuse to
 *                        offer a save at all rather than open empty over a note that is really
 *                        there and overwrite it on the first keystroke.
 *   `stepsError[a]`    - one action's bound automation did not load.
 *   `runsError[a]`     - one action's run history did not load.
 *   `actionError`      - a RUN the user just asked for failed. Never merged into the read errors:
 *                        a failed write must leave the page standing and be reported at the point
 *                        of the click, and a failed read must replace the thing it was reading.
 *   `feedbackWriteError[n]` - saving or erasing ONE note failed. Per NOTE and not per action: an
 *                        action carries one note of its own plus one per step of its plan, and a
 *                        failure on any of them must be reported under the box it belongs to
 *                        rather than over all of them at once.
 *
 * THE ABSENT/LOADING DISTINCTION IS STRUCTURAL, not a boolean. `evidence`, `steps` and `runs` are
 * left UNSET while their fetch is outstanding and set (possibly to `[]` / `null`) when it comes
 * back, and the matching error map records a fetch that will never arrive on its own. A reader that
 * cannot tell "not back yet" from "came back broken" renders a spinner that spins forever, which is
 * the schedules defect this shape exists to not repeat.
 *
 * ── AND NO COPY IS WRITTEN HERE ───────────────────────────────────────────────────────────────
 *
 * A store is not a surface and has no language. Every failure channel below carries the FACT that
 * the read failed plus, at most, the prose the SERVER sent; the words a person reads come from
 * `locales/` through the component, in the reader's own language. The alternative - a hardcoded
 * fallback string - is a sentence in one language that an en-locale user is shown whenever the
 * envelope's message happens to be empty. `runNow` follows the same rule one step further: the
 * executor's `code` is a MACHINE token (`upstream_error`, `not_connected`) and is carried as
 * `errorCode` rather than as text, because putting it in a toast shows a user a word from an
 * internal vocabulary and calls it an explanation. That is the posture the run-error table
 * established (`shared/src/run-errors.ts`), applied to the integration executor's own vocabulary.
 *
 * ── THE STALE-KEY GUARD IS ON EVERY READ, NOT ONLY THE PAGE'S ─────────────────────────────────
 *
 * Every fetch here captures the key it was dispatched for and re-checks `requestedKey` after its
 * await. The per-action maps are keyed by ACTION NAME alone while the unit of the decision is
 * `(integrationKey, actionName)`, so without the guard a slow answer for integration A's
 * `consultar_processo` commits under integration B's identically-named action - and it sticks,
 * because the component only re-fetches a section that is still UNSET.
 */

import { create } from 'zustand';
import { api, tryCall, type ApiError } from '@/lib/api';
import { automationIdOf } from '@/lib/integrations/action-view';
import type {
  Automation,
  ExecuteIntegrationActionResponse,
  IntegrationActionEvidence,
  IntegrationActionFeedback,
  IntegrationActionRecipeSummary,
  IntegrationCapability,
  RunRecord,
} from '@ekoa/shared';

/** How many runs of one action's bound automation the history shows. */
export const ACTION_RUN_HISTORY_LIMIT = 20;

/**
 * The address of ONE note within this page's state (slice S3).
 *
 * A composite because the unit is `(actionName, stepRef?)` and not the action: an action holds one
 * note of its own plus one per step of its plan, and a map keyed by action alone would let a step's
 * note overwrite the action's.
 *
 * JSON-ENCODED, which is the SERVER'S OWN injective encoding (`actionFeedbackIdFor`) applied to a
 * client-side map, and for the same reason: a `${a}:${b}` join is not injective when either half may
 * contain the separator, so an action named `a:b` with no step would share a slot with an action
 * named `a` at step `b` - one note silently rendering in the other's box. `null` for an absent
 * `stepRef` keeps "the action as a whole" a distinct point rather than a prefix of every step's.
 *
 * Exported because the surface builds the same address to read a note back, and two spellings of
 * this rule would eventually disagree about which box a save landed in.
 */
export function feedbackSlot(actionName: string, stepRef?: string): string {
  return JSON.stringify([actionName, stepRef ?? null]);
}

/**
 * A failed READ, as the store records it.
 *
 * The presence of the object IS the failure; `detail` is the server's own prose when there was any
 * worth showing and is absent otherwise. Nothing here is a sentence this store wrote - see the
 * module header. The surface pairs it with its own localized heading, so a failure with no prose
 * still renders as a failure rather than as an empty section.
 */
export interface ReadFailure {
  detail?: string;
}

/** What a run-now attempt produced, for the surface to report at the point of the click. */
export interface RunNowOutcome {
  ok: boolean;
  /** The executor's own answer when the call was admitted (may itself be a failure). */
  result?: ExecuteIntegrationActionResponse;
  /** Why it did not succeed, in the SERVER's own words - already redacted, and absent when the
   *  server sent none. Never a string this store invented, and never a machine token. */
  error?: string;
  /** The executor's machine-readable outcome token (`upstream_error`, `not_connected`, …) when it
   *  named one. For the surface to TRANSLATE - never to render as it stands. */
  errorCode?: string;
  /** The write gate refused: nothing ran, and a human has to authorise the action first. */
  awaitingConsent?: boolean;
}

interface IntegrationDetailState {
  /** The key the state below describes; `null` before the first load. */
  key: string | null;
  /** The key the last load was DISPATCHED for - tells "not asked yet" from "asked, nothing". */
  requestedKey: string | null;
  loading: boolean;
  capability: IntegrationCapability | null;
  capabilityError: ApiError | null;

  /** The live evidence row per action name. Unset ⇒ this action has no sample. */
  evidence: Record<string, IntegrationActionEvidence>;
  /** Set exactly once the evidence read has come back; `false` while it is outstanding. */
  evidenceLoaded: boolean;
  evidenceError?: ReadFailure;

  /** The caller's own notes, by `feedbackSlot`. Unset ⇒ they hold no note at that address. */
  feedback: Record<string, IntegrationActionFeedback>;
  /** Set exactly once the notes read has come back; `false` while it is outstanding. */
  feedbackLoaded: boolean;
  feedbackError?: ReadFailure;
  /** Notes with a save or an erase in flight, by slot - so one box's spinner is one box's. */
  feedbackSaving: Record<string, boolean>;
  /** A failed WRITE, by slot, in the SERVER's own prose. Cleared by the next attempt at that slot. */
  feedbackWriteError: Record<string, ReadFailure>;

  /** The learned recipe per action name (cornerstone K4). Unset ⇒ this action holds none. */
  recipes: Record<string, IntegrationActionRecipeSummary>;
  /** Set exactly once the recipes read has come back; `false` while it is outstanding. */
  recipesLoaded: boolean;
  recipesError?: ReadFailure;
  /** Action names with a forget in flight, so one badge's spinner is one badge's. */
  recipeForgetting: Record<string, boolean>;

  /** The bound automation per action name. `null` ⇒ the fetch came back with nothing. */
  steps: Record<string, Automation | null>;
  stepsError: Record<string, ReadFailure>;

  /** Run history per action name. */
  runs: Record<string, RunRecord[]>;
  runsError: Record<string, ReadFailure>;

  /** A run the user just asked for and that failed - the server's own prose, when it sent any.
   *  Read once and cleared by the surface. */
  actionError?: string;
  /** …and the machine token that came with it, for a surface that has copy for the token but was
   *  sent no prose. Cleared together with `actionError`. */
  actionErrorCode?: string;
  /** Action names with a run in flight, so the control can disable exactly one row. */
  running: Record<string, boolean>;
}

interface IntegrationDetailActions {
  /** The page's own read: the capability view, the evidence samples and the caller's notes. */
  load: (key: string) => Promise<void>;
  fetchEvidence: (key: string) => Promise<void>;
  fetchFeedback: (key: string) => Promise<void>;
  /** Write one note. `stepRef` absent addresses the ACTION's own note, never a step's. */
  saveFeedback: (key: string, actionName: string, stepRef: string | undefined, note: string) => Promise<boolean>;
  /** Erase one note. Idempotent on the server: nothing there is `ok`, not a 404. */
  removeFeedback: (key: string, actionName: string, stepRef: string | undefined) => Promise<boolean>;
  fetchRecipes: (key: string) => Promise<void>;
  /** Forget one action's learned recipe (idempotent server-side; evidence goes with it). */
  forgetRecipe: (key: string, actionName: string) => Promise<boolean>;
  fetchSteps: (actionName: string, automationId: string) => Promise<void>;
  fetchRuns: (actionName: string, automationId: string) => Promise<void>;
  runNow: (key: string, actionName: string) => Promise<RunNowOutcome>;
  clearActionError: () => void;
  /** Drop everything - used when the page unmounts or the key changes. */
  reset: () => void;
}

const EMPTY: Omit<IntegrationDetailState, 'key' | 'requestedKey'> = {
  loading: false,
  capability: null,
  capabilityError: null,
  evidence: {},
  evidenceLoaded: false,
  feedback: {},
  feedbackLoaded: false,
  feedbackSaving: {},
  feedbackWriteError: {},
  recipes: {},
  recipesLoaded: false,
  recipeForgetting: {},
  steps: {},
  stepsError: {},
  runs: {},
  runsError: {},
  running: {},
};

/** Drop one key from a record without mutating it. */
function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

/** A transport failure, as a channel records it: the fact, plus the server's prose if it sent any.
 *  An empty message becomes an ABSENT `detail` rather than an empty string, so the surface falls
 *  through to its own localized heading instead of rendering a blank error row. */
function failureOf(error: ApiError): ReadFailure {
  return error.message ? { detail: error.message } : {};
}

export const useIntegrationDetailStore = create<IntegrationDetailState & IntegrationDetailActions>((set, get) => ({
  key: null,
  requestedKey: null,
  ...EMPTY,

  /**
   * Load the page. The capability read is the PAGE's read - its failure replaces the page - while
   * the evidence read is a section's, so the two are kept apart even though they are fired
   * together. Resetting to `EMPTY` first is what stops a previous integration's actions being
   * rendered under a new key's header for the duration of the fetch.
   */
  async load(key) {
    set({ key, requestedKey: key, ...EMPTY, loading: true });
    // The samples and the notes are fired here but NOT awaited before the capability is committed:
    // they are sections' reads, and holding the whole page on a spinner until they land would make
    // one slow section's latency the page's. The promises are kept so `load()` still resolves when
    // all three are done, which is what lets a caller (and a test) await the page's full settle.
    const evidence = get().fetchEvidence(key);
    const feedback = get().fetchFeedback(key);
    const recipes = get().fetchRecipes(key);
    const capability = await tryCall(() => api.integrations.getIntegration<IntegrationCapability>({ key }));
    // A key change mid-flight: the answer is about an integration the page is no longer showing.
    if (get().requestedKey !== key) return;
    if (capability.ok) {
      set({ loading: false, capability: capability.data, capabilityError: null });
    } else {
      set({ loading: false, capability: null, capabilityError: capability.error });
    }
    await Promise.all([evidence, feedback, recipes]);
  },

  /**
   * The samples. A failure here is NOT the page's: the steps view still has the definition's own
   * request template and the bound automation's steps to render, and saying "the sample could not
   * be loaded" beside them is honest where rendering nothing would read as "this never ran".
   */
  async fetchEvidence(key) {
    set({ evidenceError: undefined });
    const res = await tryCall(() => api.integrations.listActionEvidence({ key }));
    if (get().requestedKey !== key) return;
    if (res.ok) {
      const evidence: Record<string, IntegrationActionEvidence> = {};
      for (const row of res.data.items) evidence[row.actionName] = row;
      set({ evidence, evidenceLoaded: true, evidenceError: undefined });
    } else {
      // `evidenceLoaded` stays FALSE on a failure: the surface reads it as "no sample arrived",
      // and `evidenceError` is what tells it the difference between that and "there is none".
      set({ evidenceError: failureOf(res.error) });
    }
  },

  /**
   * The caller's own notes for this integration (slice S3).
   *
   * A failure here is NOT the page's and is NOT the samples': the surface renders the note boxes
   * READ-ONLY when this read failed, because an editor that opens empty over a note that is really
   * there destroys it on the first save. `feedbackLoaded` staying false is what says so.
   */
  async fetchFeedback(key) {
    set({ feedbackError: undefined });
    const res = await tryCall(() => api.integrations.listActionFeedback({ key }));
    // The same stale-key guard every other read here carries: `feedback` is keyed by action + step
    // alone, so a late answer for integration A commits under integration B's identically-named
    // action - and it sticks, because the surface only re-reads a section that is still unset.
    if (get().requestedKey !== key) return;
    if (res.ok) {
      const feedback: Record<string, IntegrationActionFeedback> = {};
      for (const row of res.data.items) feedback[feedbackSlot(row.actionName, row.stepRef)] = row;
      set({ feedback, feedbackLoaded: true, feedbackError: undefined });
    } else {
      set({ feedbackError: failureOf(res.error) });
    }
  },

  /**
   * WRITE one note, and commit the SERVER's row rather than the text that was typed.
   *
   * The answer carries `createdAt`/`updatedAt`, and echoing the local string instead would leave
   * the box showing a note whose stamps are a guess - and, on the first edit of an existing note,
   * showing it as newly created when the server preserved the original `createdAt`.
   */
  async saveFeedback(key, actionName, stepRef, note) {
    const slot = feedbackSlot(actionName, stepRef);
    set((s) => ({
      feedbackSaving: { ...s.feedbackSaving, [slot]: true },
      feedbackWriteError: without(s.feedbackWriteError, slot),
    }));
    const res = await tryCall(() =>
      api.integrations.setActionFeedback<IntegrationActionFeedback>({
        key,
        actionName,
        note,
        ...(stepRef !== undefined ? { stepRef } : {}),
      }),
    );
    if (get().requestedKey !== key) return res.ok;
    if (res.ok) {
      set((s) => ({
        feedback: { ...s.feedback, [slot]: res.data },
        feedbackSaving: without(s.feedbackSaving, slot),
        feedbackWriteError: without(s.feedbackWriteError, slot),
      }));
      return true;
    }
    set((s) => ({
      feedbackSaving: without(s.feedbackSaving, slot),
      feedbackWriteError: { ...s.feedbackWriteError, [slot]: failureOf(res.error) },
    }));
    return false;
  },

  /** ERASE one note. The row leaves the map only on a confirmed answer - never optimistically. */
  async removeFeedback(key, actionName, stepRef) {
    const slot = feedbackSlot(actionName, stepRef);
    set((s) => ({
      feedbackSaving: { ...s.feedbackSaving, [slot]: true },
      feedbackWriteError: without(s.feedbackWriteError, slot),
    }));
    const res = await tryCall(() =>
      api.integrations.discardActionFeedback({
        key,
        actionName,
        ...(stepRef !== undefined ? { stepRef } : {}),
      }),
    );
    if (get().requestedKey !== key) return res.ok;
    if (res.ok) {
      set((s) => ({
        feedback: without(s.feedback, slot),
        feedbackSaving: without(s.feedbackSaving, slot),
        feedbackWriteError: without(s.feedbackWriteError, slot),
      }));
      return true;
    }
    set((s) => ({
      feedbackSaving: without(s.feedbackSaving, slot),
      feedbackWriteError: { ...s.feedbackWriteError, [slot]: failureOf(res.error) },
    }));
    return false;
  },

  /**
   * The learned recipes (cornerstone K4). The endpoint lists every recipe the caller's org holds;
   * this page keeps only the rows naming ITS integration. A failure here is a section's, never the
   * page's - an action without a visible recipe badge still runs.
   */
  async fetchRecipes(key) {
    set({ recipesError: undefined });
    const res = await tryCall(() => api.integrations.listRecipes());
    if (get().requestedKey !== key) return;
    if (res.ok) {
      const recipes: Record<string, IntegrationActionRecipeSummary> = {};
      for (const row of res.data.items) if (row.key === key) recipes[row.actionName] = row;
      set({ recipes, recipesLoaded: true, recipesError: undefined });
    } else {
      set({ recipesError: failureOf(res.error) });
    }
  },

  /** FORGET one recipe. The row leaves the map only on a confirmed answer - never optimistically. */
  async forgetRecipe(key, actionName) {
    set((s) => ({ recipeForgetting: { ...s.recipeForgetting, [actionName]: true } }));
    const res = await tryCall(() => api.integrations.forgetRecipe({ key, actionName }));
    if (get().requestedKey !== key) return res.ok;
    if (res.ok) {
      set((s) => ({
        recipes: without(s.recipes, actionName),
        recipeForgetting: without(s.recipeForgetting, actionName),
      }));
      return true;
    }
    set((s) => ({ recipeForgetting: without(s.recipeForgetting, actionName) }));
    return false;
  },

  /** One action's bound automation, for the read-only steps view. */
  async fetchSteps(actionName, automationId) {
    // The key this answer will be ABOUT, captured before the await - the same two lines `load` and
    // `fetchEvidence` carry, and for the same reason: `steps` is keyed by action name alone, so a
    // late answer for integration A's action commits under integration B's same-named one.
    const key = get().requestedKey;
    set((s) => ({ stepsError: without(s.stepsError, actionName) }));
    const res = await tryCall(() => api.automations.get<Automation>({ id: automationId }));
    if (get().requestedKey !== key) return;
    if (res.ok) {
      set((s) => ({ steps: { ...s.steps, [actionName]: res.data }, stepsError: without(s.stepsError, actionName) }));
    } else {
      set((s) => ({
        stepsError: { ...s.stepsError, [actionName]: failureOf(res.error) },
      }));
    }
  },

  /** One action's run history - the runs of the automation its binding names. */
  async fetchRuns(actionName, automationId) {
    const key = get().requestedKey;
    set((s) => ({ runsError: without(s.runsError, actionName) }));
    const res = await tryCall(() => api.automations.listRuns({ automationId, limit: ACTION_RUN_HISTORY_LIMIT }));
    if (get().requestedKey !== key) return;
    if (res.ok) {
      set((s) => ({ runs: { ...s.runs, [actionName]: res.data.items }, runsError: without(s.runsError, actionName) }));
    } else {
      set((s) => ({
        runsError: { ...s.runsError, [actionName]: failureOf(res.error) },
      }));
    }
  },

  /**
   * RUN NOW.
   *
   * THREE OUTCOMES, and the middle one is the one a naive `if (res.ok)` swallows. The execute
   * endpoint answers 200 with `{ success: false, code, error }` for everything that happened to
   * the ROUTED call - a remote 500, a locked credential, a disabled integration, a timeout. Those
   * are answers about the remote system, they arrive on the success path of the transport, and a
   * caller that only checks `res.ok` reports them to the user as a success.
   *
   *   transport/HTTP failure  -> `ok: false` with the envelope's message. A 403 carrying
   *                              `awaiting_consent` is flagged, because "nothing ran and a human
   *                              must authorise it" is a different sentence from "it failed".
   *   200 + success:false     -> `ok: false` with the executor's own `error` prose and its `code`
   *                              carried SEPARATELY, so the surface can translate the token when
   *                              there is no prose instead of printing the token itself.
   *   200 + success:true      -> `ok: true`, and the evidence + history are re-read, because the
   *                              run that just succeeded is the new sample and the newest run.
   */
  async runNow(key, actionName) {
    set((s) => ({ actionError: undefined, actionErrorCode: undefined, running: { ...s.running, [actionName]: true } }));
    const res = await tryCall(() =>
      api.integrations.executeAction<ExecuteIntegrationActionResponse>({ key, actionName, args: {} }),
    );
    const finish = (outcome: RunNowOutcome): RunNowOutcome => {
      set((s) => ({
        running: without(s.running, actionName),
        ...(outcome.error !== undefined ? { actionError: outcome.error } : {}),
        ...(outcome.errorCode !== undefined ? { actionErrorCode: outcome.errorCode } : {}),
      }));
      return outcome;
    };

    if (!res.ok) {
      const awaitingConsent =
        res.error.status === 403
        && (res.error.details as { code?: string } | undefined)?.code === 'awaiting_consent';
      return finish({
        ok: false,
        ...(awaitingConsent ? { awaitingConsent: true } : {}),
        ...(res.error.message ? { error: res.error.message } : {}),
        ...(res.error.code ? { errorCode: res.error.code } : {}),
      });
    }
    const result = res.data;
    if (!result.success) {
      return finish({
        ok: false,
        result,
        ...(result.error ? { error: result.error } : {}),
        ...(result.code ? { errorCode: result.code } : {}),
      });
    }
    // The run succeeded, so the sample and the history the page is showing are both stale.
    const automationId = automationIdOf(get().capability, actionName);
    await Promise.all([
      get().fetchEvidence(key),
      automationId ? get().fetchRuns(actionName, automationId) : Promise.resolve(),
    ]);
    return finish({ ok: true, result });
  },

  clearActionError() {
    set({ actionError: undefined, actionErrorCode: undefined });
  },

  reset() {
    set({ key: null, requestedKey: null, ...EMPTY });
  },
}));
