/**
 * The integration DETAIL store (slice S2) is the only thing between the typed client and the
 * `/integrations/[key]` surface, so what is asserted here is the contract the page depends on -
 * and every one of these was a real defect on the schedules surface in this repo:
 *
 *  - a failed READ never renders as an empty. The capability error is kept as the ApiError so the
 *    page can tell 404 (absent) from 500/403/network (failed to load), and the evidence, steps and
 *    runs reads each keep their own channel because they render in three different places;
 *  - a failed MUTATION is visible. `runNow` reports THREE failure shapes, including the one a
 *    naive `if (res.ok)` swallows whole: the execute endpoint answers 200 with `success: false`
 *    for everything that happened to the routed call, and reporting that as a success is telling
 *    the user their write landed when it did not;
 *  - "not back yet" is distinguishable from "came back empty" everywhere it matters, because a
 *    reader that cannot tell them apart renders a spinner that never resolves;
 *  - a late answer for an integration the page has LEFT is dropped. Every read here is keyed by
 *    action name while the unit of the decision is (integrationKey, actionName), so the guard is
 *    what stops one integration's plan and history painting under another's same-named action;
 *  - NO COPY IS WRITTEN HERE. The store carries the server's own prose and the executor's machine
 *    token; the words a person reads come from `locales/` through the surface.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IntegrationActionEvidence, IntegrationCapability } from '@ekoa/shared';
import { IntegrationActionFeedback } from '@ekoa/shared';

const getIntegrationSpy = vi.fn();
const listActionEvidenceSpy = vi.fn();
const listActionFeedbackSpy = vi.fn();
const setActionFeedbackSpy = vi.fn();
const discardActionFeedbackSpy = vi.fn();
const executeActionSpy = vi.fn();
const automationGetSpy = vi.fn();
const automationListRunsSpy = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    integrations: {
      getIntegration: (...args: unknown[]) => getIntegrationSpy(...args),
      listActionEvidence: (...args: unknown[]) => listActionEvidenceSpy(...args),
      listActionFeedback: (...args: unknown[]) => listActionFeedbackSpy(...args),
      setActionFeedback: (...args: unknown[]) => setActionFeedbackSpy(...args),
      discardActionFeedback: (...args: unknown[]) => discardActionFeedbackSpy(...args),
      executeAction: (...args: unknown[]) => executeActionSpy(...args),
    },
    automations: {
      get: (...args: unknown[]) => automationGetSpy(...args),
      listRuns: (...args: unknown[]) => automationListRunsSpy(...args),
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn() };
    } catch (error) {
      return { ok: false, error };
    }
  },
}));

import { useIntegrationDetailStore, feedbackSlot, ACTION_RUN_HISTORY_LIMIT } from '@/stores/integration-detail';

const KEY = 'citius';
const HTTP_ACTION = 'consultar_processo';
const RUN_ACTION = 'listar_pendentes';
const AUTOMATION_ID = 'aut-77';

/** A rejection shaped like the transport's ApiError: `status`, `code` and `message`. */
class FakeApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

const capability = (over: Partial<IntegrationCapability> = {}): IntegrationCapability =>
  ({
    integration: {
      key: KEY,
      displayName: 'Citius',
      actions: [
        { actionName: HTTP_ACTION, description: 'consulta', mutates: false,
          httpConfig: { method: 'get', baseUrl: 'https://citius.example', path: 'processos/{{input.ref}}' } },
        { actionName: RUN_ACTION, description: 'lista', mutates: true,
          automationBinding: { automationId: AUTOMATION_ID } },
      ],
    },
    connected: true,
    actions: [
      { actionName: HTTP_ACTION, description: 'consulta', backingType: 'api-call', transport: 'http',
        target: 'GET https://citius.example/processos', shape: 'sha-http', requiresApproval: false, approved: false },
      { actionName: RUN_ACTION, description: 'lista', backingType: 'browser-steps', transport: 'http',
        target: 'browser: citius', shape: 'sha-run', requiresApproval: true, approved: true },
    ],
    ...over,
  }) as IntegrationCapability;

const evidenceRow = (over: Partial<IntegrationActionEvidence> = {}): IntegrationActionEvidence =>
  ({
    actionName: HTTP_ACTION,
    backingType: 'api-call',
    shape: 'sha-http',
    validatedAt: '2026-08-19T10:00:00.000Z',
    evidence: {
      kind: 'api-call',
      request: { method: 'GET', url: 'https://citius.example/processos/2024-1', headers: {} },
      response: { status: 200, body: '{"ok":true}', bodyIsJson: true },
    },
    ...over,
  }) as IntegrationActionEvidence;

beforeEach(() => {
  for (const spy of [
    getIntegrationSpy, listActionEvidenceSpy, listActionFeedbackSpy, setActionFeedbackSpy,
    discardActionFeedbackSpy, executeActionSpy, automationGetSpy, automationListRunsSpy,
  ]) {
    spy.mockReset();
  }
  useIntegrationDetailStore.getState().reset();
  getIntegrationSpy.mockResolvedValue(capability());
  listActionEvidenceSpy.mockResolvedValue({ items: [evidenceRow()] });
  listActionFeedbackSpy.mockResolvedValue({ items: [] });
});

describe('load - the page\'s own read', () => {
  it('holds the capability and the evidence, keyed by action name', async () => {
    await useIntegrationDetailStore.getState().load(KEY);
    const s = useIntegrationDetailStore.getState();

    expect(s.capability?.integration.key).toBe(KEY);
    expect(s.capabilityError).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.evidence[HTTP_ACTION]?.validatedAt).toBe('2026-08-19T10:00:00.000Z');
    expect(s.evidenceLoaded).toBe(true);
    expect(s.evidenceError).toBeUndefined();
  });

  it('keeps the ApiError, so the page can tell ABSENT from FAILED-TO-LOAD', async () => {
    getIntegrationSpy.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'a base de dados está em baixo'));

    await useIntegrationDetailStore.getState().load(KEY);
    const s = useIntegrationDetailStore.getState();

    // Not a string: a page that only had the message could not distinguish the 500 below from a
    // 404, and would tell the user their integration does not exist because a server hiccuped.
    expect(s.capability).toBeNull();
    expect(s.capabilityError?.status).toBe(500);
    expect(s.capabilityError?.message).toBe('a base de dados está em baixo');
    // And it is NOT loading: an unresolved spinner is the other half of the same defect.
    expect(s.loading).toBe(false);
  });

  it('a failed EVIDENCE read is its own channel - the page still renders', async () => {
    listActionEvidenceSpy.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'evidências indisponíveis'));

    await useIntegrationDetailStore.getState().load(KEY);
    const s = useIntegrationDetailStore.getState();

    // The capability arrived, so the actions list is renderable...
    expect(s.capability?.actions).toHaveLength(2);
    expect(s.capabilityError).toBeNull();
    // ...and the samples' failure is recorded WITHOUT `evidenceLoaded` flipping, which is what
    // stops the steps view saying "this action has never run successfully".
    expect(s.evidenceError).toEqual({ detail: 'evidências indisponíveis' });
    expect(s.evidenceLoaded).toBe(false);
    expect(s.evidence).toEqual({});
  });

  it('records a failure with NO server prose as a failure, and invents no sentence for it', async () => {
    // An envelope with an empty message is the case a hardcoded fallback existed for - and the
    // fallback was one language, shown to every reader. The channel is SET (so the surface renders
    // its own localized heading rather than an empty section) and `detail` is absent.
    listActionEvidenceSpy.mockRejectedValue(new FakeApiError(500, 'INTERNAL', ''));

    await useIntegrationDetailStore.getState().load(KEY);
    const s = useIntegrationDetailStore.getState();

    expect(s.evidenceError).toEqual({});
    expect(s.evidenceError).toBeDefined();
    expect(s.evidenceLoaded).toBe(false);
  });

  it('ignores an answer for a key the page has already navigated away from', async () => {
    let release: (v: unknown) => void = () => {};
    getIntegrationSpy.mockImplementation(() => new Promise((r) => { release = r; }));

    const inFlight = useIntegrationDetailStore.getState().load(KEY);
    // The user moves on before the first answer lands.
    useIntegrationDetailStore.setState({ requestedKey: 'other-key' });
    release(capability());
    await inFlight;

    // A late answer for the previous key must not paint under the new key's header.
    expect(useIntegrationDetailStore.getState().capability).toBeNull();
  });
});

describe('the per-action reads keep their own failure channel', () => {
  it('records a failed steps read against that action, and leaves the others alone', async () => {
    automationGetSpy.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'automação indisponível'));

    await useIntegrationDetailStore.getState().fetchSteps(RUN_ACTION, AUTOMATION_ID);
    const s = useIntegrationDetailStore.getState();

    expect(s.stepsError[RUN_ACTION]).toEqual({ detail: 'automação indisponível' });
    // UNSET, not `[]`: "came back broken" must not read as "this automation has no steps".
    expect(s.steps[RUN_ACTION]).toBeUndefined();
    expect(s.stepsError[HTTP_ACTION]).toBeUndefined();
  });

  it('records a failed history read against that action, and clears it on a later success', async () => {
    automationListRunsSpy.mockRejectedValue(new FakeApiError(0, 'NETWORK_ERROR', 'sem rede'));
    await useIntegrationDetailStore.getState().fetchRuns(RUN_ACTION, AUTOMATION_ID);
    expect(useIntegrationDetailStore.getState().runsError[RUN_ACTION]).toEqual({ detail: 'sem rede' });
    expect(useIntegrationDetailStore.getState().runs[RUN_ACTION]).toBeUndefined();

    automationListRunsSpy.mockResolvedValue({ items: [{ id: 'run-9', automationId: AUTOMATION_ID, status: 'completed' }] });
    await useIntegrationDetailStore.getState().fetchRuns(RUN_ACTION, AUTOMATION_ID);
    const s = useIntegrationDetailStore.getState();
    expect(s.runsError[RUN_ACTION]).toBeUndefined();
    expect(s.runs[RUN_ACTION]).toHaveLength(1);
    // The history is bounded - an automation with a thousand runs must not become the page.
    expect(automationListRunsSpy).toHaveBeenLastCalledWith({ automationId: AUTOMATION_ID, limit: ACTION_RUN_HISTORY_LIMIT });
  });
});

/**
 * THE STALE-KEY GUARD, on the per-action reads and not only on the page's own.
 *
 * `steps` and `runs` are keyed by ACTION NAME alone, and two integrations routinely declare the
 * same action name (`consultar_processo` on citius and on any other portal package). So a slow
 * answer dispatched for integration A commits under integration B's identically-named action, and
 * it STICKS: the component's lazy effect only fetches a section that is still UNSET, so nothing
 * ever corrects it. `reset()` cannot help - it clears state, it cannot cancel a promise.
 */
describe('a late answer for an integration the page has left', () => {
  it('never lands another integration\'s STEPS under a same-named action', async () => {
    let release: (v: unknown) => void = () => {};
    automationGetSpy.mockImplementation(() => new Promise((r) => { release = r; }));
    useIntegrationDetailStore.setState({ requestedKey: KEY });

    const inFlight = useIntegrationDetailStore.getState().fetchSteps(RUN_ACTION, AUTOMATION_ID);
    // The user navigates to another integration that declares the SAME action name.
    useIntegrationDetailStore.getState().reset();
    useIntegrationDetailStore.setState({ requestedKey: 'other-portal' });
    release({ id: AUTOMATION_ID, name: 'Citius pendentes', plan: { steps: [{ description: 'Abrir o portal' }] } });
    await inFlight;

    expect(useIntegrationDetailStore.getState().steps[RUN_ACTION]).toBeUndefined();
  });

  it('never lands another integration\'s HISTORY under a same-named action', async () => {
    let release: (v: unknown) => void = () => {};
    automationListRunsSpy.mockImplementation(() => new Promise((r) => { release = r; }));
    useIntegrationDetailStore.setState({ requestedKey: KEY });

    const inFlight = useIntegrationDetailStore.getState().fetchRuns(RUN_ACTION, AUTOMATION_ID);
    useIntegrationDetailStore.getState().reset();
    useIntegrationDetailStore.setState({ requestedKey: 'other-portal' });
    release({ items: [{ id: 'run-of-citius', automationId: AUTOMATION_ID, status: 'completed' }] });
    await inFlight;

    expect(useIntegrationDetailStore.getState().runs[RUN_ACTION]).toBeUndefined();
  });

  it('and a FAILED late answer does not paint an error on the new integration either', async () => {
    let reject: (e: unknown) => void = () => {};
    automationGetSpy.mockImplementation(() => new Promise((_r, rj) => { reject = rj; }));
    useIntegrationDetailStore.setState({ requestedKey: KEY });

    const inFlight = useIntegrationDetailStore.getState().fetchSteps(RUN_ACTION, AUTOMATION_ID);
    useIntegrationDetailStore.getState().reset();
    useIntegrationDetailStore.setState({ requestedKey: 'other-portal' });
    reject(new FakeApiError(500, 'INTERNAL', 'automação indisponível'));
    await inFlight;

    expect(useIntegrationDetailStore.getState().stepsError[RUN_ACTION]).toBeUndefined();
  });
});

describe('runNow - every failure reaches the user', () => {
  beforeEach(async () => {
    await useIntegrationDetailStore.getState().load(KEY);
    listActionEvidenceSpy.mockClear();
    automationListRunsSpy.mockResolvedValue({ items: [] });
  });

  it('reports an admitted-but-FAILED call, which arrives on the transport SUCCESS path', async () => {
    // 200 with success:false is what a remote 500, a locked credential, a disabled integration and
    // a timeout all look like. `res.ok` is TRUE here - this is the case a naive store loses.
    executeActionSpy.mockResolvedValue({ success: false, status: 502, code: 'upstream_error', error: 'o portal respondeu 502' });

    const outcome = await useIntegrationDetailStore.getState().runNow(KEY, HTTP_ACTION);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('o portal respondeu 502');
    // The token rides BESIDE the prose, never inside it. `upstream_error` is a word from the
    // executor's own vocabulary; a surface may translate it, and must never print it.
    expect(outcome.errorCode).toBe('upstream_error');
    expect(useIntegrationDetailStore.getState().actionError).toBe('o portal respondeu 502');
    // Nothing succeeded, so nothing is re-read: the sample on the page is still the last good one.
    expect(listActionEvidenceSpy).not.toHaveBeenCalled();
  });

  it('carries a code-only failure as a CODE, and puts no machine token in the message', async () => {
    // The executor names an outcome and sends no prose - the case whose fallback used to be the
    // token itself, so a user was shown `not_connected` and told that was the reason.
    executeActionSpy.mockResolvedValue({ success: false, code: 'not_connected' });

    const outcome = await useIntegrationDetailStore.getState().runNow(KEY, HTTP_ACTION);

    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe('not_connected');
    expect(outcome.error).toBeUndefined();
    expect(useIntegrationDetailStore.getState().actionError).toBeUndefined();
    expect(useIntegrationDetailStore.getState().actionErrorCode).toBe('not_connected');
  });

  it('flags the write gate\'s refusal apart from an ordinary failure', async () => {
    executeActionSpy.mockRejectedValue(
      new FakeApiError(403, 'FORBIDDEN', 'Esta ação precisa de autorização.', { code: 'awaiting_consent' }),
    );

    const outcome = await useIntegrationDetailStore.getState().runNow(KEY, RUN_ACTION);

    expect(outcome.ok).toBe(false);
    // "nothing ran and a human must authorise it" is a different sentence from "it failed".
    expect(outcome.awaitingConsent).toBe(true);
    expect(outcome.error).toBe('Esta ação precisa de autorização.');
  });

  it('reports a transport failure', async () => {
    executeActionSpy.mockRejectedValue(new FakeApiError(0, 'NETWORK_ERROR', 'sem rede'));

    const outcome = await useIntegrationDetailStore.getState().runNow(KEY, HTTP_ACTION);

    expect(outcome.ok).toBe(false);
    expect(outcome.awaitingConsent).toBeUndefined();
    expect(useIntegrationDetailStore.getState().actionError).toBe('sem rede');
  });

  it('re-reads the sample AND the history on a success, because both are now stale', async () => {
    executeActionSpy.mockResolvedValue({ success: true, status: 200, data: { ok: true } });

    const outcome = await useIntegrationDetailStore.getState().runNow(KEY, RUN_ACTION);

    expect(outcome.ok).toBe(true);
    expect(useIntegrationDetailStore.getState().actionError).toBeUndefined();
    // The run that just succeeded IS the new evidence row and the newest run.
    expect(listActionEvidenceSpy).toHaveBeenCalledTimes(1);
    expect(automationListRunsSpy).toHaveBeenCalledWith({ automationId: AUTOMATION_ID, limit: ACTION_RUN_HISTORY_LIMIT });
  });

  it('clears the in-flight flag on every exit, so the control never sticks', async () => {
    executeActionSpy.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'rebentou'));
    await useIntegrationDetailStore.getState().runNow(KEY, HTTP_ACTION);
    expect(useIntegrationDetailStore.getState().running[HTTP_ACTION]).toBeUndefined();

    executeActionSpy.mockResolvedValue({ success: true });
    await useIntegrationDetailStore.getState().runNow(KEY, HTTP_ACTION);
    expect(useIntegrationDetailStore.getState().running[HTTP_ACTION]).toBeUndefined();
  });
});


// ---------------------------------------------------------------------------------------------
// PER-USER NOTES (slice S3)
// ---------------------------------------------------------------------------------------------

/**
 * One note as the wire carries it. `stepRef` absent addresses the ACTION's own note.
 *
 * PARSED THROUGH THE SHARED SCHEMA, not hand-rolled: the house rule is that a stub for an API
 * response is schema-validated, so a wire-shape drift makes the fixture fail rather than letting
 * the store be tested against a shape the server can no longer emit. `.parse` throws on drift, and
 * the schema is `.strict()`, so an extra key here is a failure too.
 */
const noteRow = (over: Record<string, unknown> = {}): IntegrationActionFeedback =>
  IntegrationActionFeedback.parse({
    actionName: HTTP_ACTION,
    note: 'o portal quer o numero com zeros a esquerda',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-22T10:00:00.000Z',
    ...over,
  });

describe('the notes read', () => {
  it('keys the action note and a step note into DIFFERENT slots', async () => {
    listActionFeedbackSpy.mockResolvedValue({
      items: [noteRow(), noteRow({ stepRef: 'abrir-portal', note: 'este passo demora' })],
    });
    await useIntegrationDetailStore.getState().load(KEY);
    const s = useIntegrationDetailStore.getState();

    expect(s.feedbackLoaded).toBe(true);
    expect(s.feedback[feedbackSlot(HTTP_ACTION)]?.note).toContain('zeros a esquerda');
    expect(s.feedback[feedbackSlot(HTTP_ACTION, 'abrir-portal')]?.note).toBe('este passo demora');
  });

  it('a failed read leaves `feedbackLoaded` FALSE - the surface must not offer an empty editor', async () => {
    listActionFeedbackSpy.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'notas indisponiveis'));
    await useIntegrationDetailStore.getState().load(KEY);
    const s = useIntegrationDetailStore.getState();

    expect(s.feedbackLoaded, 'a box that opens empty over a real note destroys it on save').toBe(false);
    expect(s.feedbackError?.detail).toBe('notas indisponiveis');
    // The PAGE still stands: a failed notes read is a section's failure, not the page's.
    expect(s.capability?.integration.key).toBe(KEY);
    expect(s.capabilityError).toBeNull();
  });

  it('a late answer for a PREVIOUS key is dropped (the stale-key guard)', async () => {
    let release: (v: unknown) => void = () => {};
    listActionFeedbackSpy.mockImplementation(() => new Promise((r) => { release = r; }));
    const pending = useIntegrationDetailStore.getState().fetchFeedback(KEY);

    // The page moved on to another integration before the answer came back.
    useIntegrationDetailStore.setState({ key: 'other', requestedKey: 'other' });
    release({ items: [noteRow()] });
    await pending;

    expect(
      useIntegrationDetailStore.getState().feedback,
      'a note for integration A must not commit under integration B\'s same-named action',
    ).toEqual({});
  });
});

describe('the notes writes', () => {
  it('commits the SERVER\'s row rather than the text that was typed', async () => {
    await useIntegrationDetailStore.getState().load(KEY);
    setActionFeedbackSpy.mockResolvedValue(noteRow({ note: 'guardado pelo servidor' }));

    const ok = await useIntegrationDetailStore.getState().saveFeedback(KEY, HTTP_ACTION, undefined, 'o que escrevi');
    const s = useIntegrationDetailStore.getState();

    expect(ok).toBe(true);
    expect(setActionFeedbackSpy).toHaveBeenCalledWith({ key: KEY, actionName: HTTP_ACTION, note: 'o que escrevi' });
    // The stamps come from the answer; echoing the local string would show a guess.
    expect(s.feedback[feedbackSlot(HTTP_ACTION)]?.note).toBe('guardado pelo servidor');
    expect(s.feedback[feedbackSlot(HTTP_ACTION)]?.createdAt).toBe('2026-08-20T10:00:00.000Z');
    expect(s.feedbackSaving[feedbackSlot(HTTP_ACTION)]).toBeUndefined();
  });

  it('passes `stepRef` through, and files the answer under the step\'s own slot', async () => {
    await useIntegrationDetailStore.getState().load(KEY);
    setActionFeedbackSpy.mockResolvedValue(noteRow({ stepRef: 'abrir-portal', note: 'sobre o passo' }));

    await useIntegrationDetailStore.getState().saveFeedback(KEY, HTTP_ACTION, 'abrir-portal', 'sobre o passo');

    expect(setActionFeedbackSpy).toHaveBeenCalledWith({
      key: KEY, actionName: HTTP_ACTION, note: 'sobre o passo', stepRef: 'abrir-portal',
    });
    const s = useIntegrationDetailStore.getState();
    expect(s.feedback[feedbackSlot(HTTP_ACTION, 'abrir-portal')]?.note).toBe('sobre o passo');
    expect(s.feedback[feedbackSlot(HTTP_ACTION)], 'the action note is a different row').toBeUndefined();
  });

  it('a failed save reports under THAT slot and keeps whatever was already stored', async () => {
    listActionFeedbackSpy.mockResolvedValue({ items: [noteRow()] });
    await useIntegrationDetailStore.getState().load(KEY);
    setActionFeedbackSpy.mockRejectedValue(new FakeApiError(400, 'VALIDATION_FAILED', 'nota demasiado longa'));

    const ok = await useIntegrationDetailStore.getState().saveFeedback(KEY, HTTP_ACTION, undefined, 'x');
    const s = useIntegrationDetailStore.getState();

    expect(ok).toBe(false);
    expect(s.feedbackWriteError[feedbackSlot(HTTP_ACTION)]?.detail).toBe('nota demasiado longa');
    expect(s.feedback[feedbackSlot(HTTP_ACTION)]?.note, 'the stored note survives a refused write')
      .toContain('zeros a esquerda');
    // …and a DIFFERENT slot carries no error: the channel is per note, not per action.
    expect(s.feedbackWriteError[feedbackSlot(HTTP_ACTION, 'abrir-portal')]).toBeUndefined();
  });

  it('a late SAVE answer for a previous key is dropped (the write-path stale guard)', async () => {
    // The read guard was pinned; these two were not, and the review proved both deletable with the
    // whole web suite green. The consequence is the same one the read guard names: `feedback` is
    // keyed by action + step with no integration component and `load` resets it, so a save
    // resolving after the user has navigated commits integration A's row into integration B's map
    // under an identically-named action.
    await useIntegrationDetailStore.getState().load(KEY);
    let release: (v: unknown) => void = () => {};
    setActionFeedbackSpy.mockImplementation(() => new Promise((r) => { release = r; }));

    const pending = useIntegrationDetailStore.getState().saveFeedback(KEY, HTTP_ACTION, undefined, 'o que escrevi');
    // The page moved to another integration while the save was in flight.
    useIntegrationDetailStore.setState({ key: 'other', requestedKey: 'other', feedback: {} });
    release(noteRow({ note: 'a resposta tardia' }));
    await pending;

    expect(
      useIntegrationDetailStore.getState().feedback,
      "a note for integration A must not commit under integration B's same-named action",
    ).toEqual({});
  });

  it('a late ERASE answer for a previous key is dropped', async () => {
    listActionFeedbackSpy.mockResolvedValue({ items: [noteRow()] });
    await useIntegrationDetailStore.getState().load(KEY);
    let release: (v: unknown) => void = () => {};
    discardActionFeedbackSpy.mockImplementation(() => new Promise((r) => { release = r; }));

    const pending = useIntegrationDetailStore.getState().removeFeedback(KEY, HTTP_ACTION, undefined);
    const otherIntegrationsNote = { [feedbackSlot(HTTP_ACTION)]: noteRow({ note: 'a nota da outra integracao' }) };
    useIntegrationDetailStore.setState({ key: 'other', requestedKey: 'other', feedback: otherIntegrationsNote });
    release({ ok: true, discarded: true });
    await pending;

    expect(
      useIntegrationDetailStore.getState().feedback[feedbackSlot(HTTP_ACTION)]?.note,
      'a late erase must not delete the NEW integration\'s same-named note',
    ).toBe('a nota da outra integracao');
  });

  it('a confirmed erase drops the row; a failed one leaves it exactly where it was', async () => {
    listActionFeedbackSpy.mockResolvedValue({ items: [noteRow()] });
    await useIntegrationDetailStore.getState().load(KEY);

    discardActionFeedbackSpy.mockRejectedValue(new FakeApiError(500, 'INTERNAL', 'sem ligacao'));
    expect(await useIntegrationDetailStore.getState().removeFeedback(KEY, HTTP_ACTION, undefined)).toBe(false);
    expect(useIntegrationDetailStore.getState().feedback[feedbackSlot(HTTP_ACTION)], 'never optimistic').toBeTruthy();

    discardActionFeedbackSpy.mockResolvedValue({ ok: true, discarded: true });
    expect(await useIntegrationDetailStore.getState().removeFeedback(KEY, HTTP_ACTION, undefined)).toBe(true);
    const s = useIntegrationDetailStore.getState();
    expect(s.feedback[feedbackSlot(HTTP_ACTION)]).toBeUndefined();
    expect(s.feedbackWriteError[feedbackSlot(HTTP_ACTION)], 'the earlier failure is cleared by the retry').toBeUndefined();
  });
});
