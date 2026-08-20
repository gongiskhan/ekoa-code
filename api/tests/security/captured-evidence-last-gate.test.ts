/**
 * THE CAPTURE STORE'S LAST GATE - `assertNoLiveSecret`, on the fields nothing upstream of it covers
 * (slice P2.0, trap T8).
 *
 * `recipe-no-values.test.ts` proves "names, never values" on the two fields a capture REDACTS (the
 * URL and the bodies) and on every field of a compiled recipe. This suite proves the thing that one
 * structurally cannot: that the store's WHOLE-DOCUMENT refusal is the ONLY thing standing between a
 * live credential and a durable row for the fields no redaction leg touches - and that an ordinary
 * learn pass actually reaches it.
 *
 * ── WHY THIS NEEDED A SUITE OF ITS OWN ───────────────────────────────────────────────────────
 *
 * `assertNoLiveSecret` survived a full no-op: replacing its body with `return` left every suite
 * that can reach `appendCapturedCall` green. That is not an equivalent mutant, it is an UNPROVEN
 * GATE, and the reason is a division of labour that reads like belt-and-braces and is not:
 *
 *   - `redactCapturedCall` redacts the URL and the two bodies. It copies `method`, `contentType`
 *     and BOTH header-name arrays through verbatim - a name is a name, and names are the learning;
 *   - `assertCarriesNoValues` (the recipe store) re-proves the property over the recipe, so a value
 *     smuggled into a REQUEST header name was caught THERE, `learnFromRun`'s `finally` discarded the
 *     evidence, and the capture store's own refusal was never the thing that decided it.
 *
 * But a recipe carries the REQUEST header names OF THE CALLS THE COMPILE KEPT, and nothing else. A
 * `responseHeaderNames` entry never reaches a recipe at all. Neither does `contentType`. Neither
 * does anything on an exchange the compile DROPPED while `persistEvidence` kept it - and it keeps
 * `MAX_PERSISTED_EVIDENCE` (48) of them while the compile keeps `MAX_COMPILED_CALLS` (24). A gate
 * that only the compiled subset is ever checked against is not the store's gate.
 *
 * ── WHAT THE MISS COSTS, WHICH IS WHY IT IS ASSERTED BY COUNTING DOCUMENTS ───────────────────
 *
 * Nothing else catches it and nothing later collects it. The refused exchange is DROPPED by
 * `persistEvidence`'s per-append tolerance while the recipe stores `ok` - so `stored` is true, the
 * `finally` discards nothing, the surviving recipe's `capturedCallsRef` names the pile as the LIVE
 * one, no removal path applies to a recipe that is working, there is no TTL, and `listCaptureIds`
 * has no production caller. A document that lands here carrying a live credential is durable
 * forever. So every case below asserts the COLLECTION - how many documents are in it and what is in
 * them - rather than a verdict a caller could have ignored.
 *
 * ── THE CREDENTIAL IS DELIBERATELY LOW-ENTROPY ───────────────────────────────────────────────
 *
 * `sessao-do-portal-2024` is 21 characters over two character classes: it is under
 * `looksLikeLiteralSecret`'s 24-character floor and short of its three-class signature, and it
 * satisfies the header-name grammar both stores enforce. No SHAPE rule can see it. Only the run's
 * own `SecretRegistry` knows it is a credential, which is exactly the case the last gate exists for
 * - and exactly the shape a real portal session identifier takes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { LocalBrowserCapture } from '@ekoa/shared';
import { runAutomationForAction } from '../../src/automation/service.js';
import type { runAutomation } from '../../src/automation/engine.js';
import { MAX_COMPILED_CALLS } from '../../src/automation/network-capture.js';
import { automations, integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import { IntegrationRecipeStore } from '../../src/integrations/recipe-store.js';
import {
  CapturedCallsStore,
  CapturedCallsStoreError,
  type CaptureKey,
} from '../../src/integrations/captured-calls-store.js';
import { IntegrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { secretRegistryFromValues } from '../../src/security/redaction.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import { __resetAutomationSeamsForTests } from '../../src/automation/seams.js';

type Run = typeof runAutomation;

const ORG = 'orgA';
const OWNER = 'userA1';
const AUTOMATION_ID = 'auto-1';
const KEY = 'portal';
const ACTION = 'list_cases';
const CAPTURE_ID = 'cap-1';

/** The run's ONE live credential, composed at run time and low-entropy on purpose (see the header). */
const LIVE = ['sessao', 'do', 'portal', String(2024)].join('-');

let recipes: IntegrationRecipeStore;
let captures: CapturedCallsStore;
let definitions: IntegrationDefinitionStore;
let clock = 0;

/** The exchange the compile KEEPS: the site's own JSON API, one argument in the query. */
const CLEAN_GET: LocalBrowserCapture = {
  method: 'GET',
  url: 'https://portal.example/api/cases?ref=2024-1',
  requestHeaderNames: ['accept', 'x-csrf-token'],
  responseHeaderNames: ['content-type'],
  status: 200,
  contentType: 'application/json',
  resourceType: 'xhr',
  responseBody: '{"items":[{"id":41}]}',
};

const captureKey: CaptureKey = { orgId: ORG, integrationKey: KEY, actionName: ACTION, captureId: CAPTURE_ID };

const baseInput = {
  binding: { automationId: AUTOMATION_ID },
  args: { ref: '2024-1' },
  credentialFields: { token: LIVE },
  orgId: ORG,
  ownerUserId: OWNER,
  integrationKey: KEY,
  actionName: ACTION,
  mutates: false,
};

/** The engine, replaced by the one thing this suite needs from it: a completed run that drained a
 *  known set of exchanges onto the learn pass's sink. */
function runObserving(exchanges: readonly LocalBrowserCapture[]): ReturnType<typeof vi.fn<Run>> {
  return vi.fn<Run>(async (_id, _ctx, options) => {
    options?.observeNetwork?.([...exchanges]);
    return { runId: 'run-1', status: 'completed', durationMs: 1, summary: 'ok', lastStepIndex: 0 };
  });
}

/** ONE learn pass over `exchanges`, through the REAL stores. The replay is stubbed to `no-recipe`
 *  (there is nothing learned yet), and nothing else is. */
function learnFrom(exchanges: readonly LocalBrowserCapture[]) {
  return runAutomationForAction(baseInput, {
    replay: async () => ({ outcome: 'no-recipe', reason: 'never discovered' }),
    run: runObserving(exchanges),
    putRecipe: (o, k, a, draft, opts) => recipes.putRecipe(o, k, a, draft, opts),
    captures,
    captureId: () => CAPTURE_ID,
  });
}

/** EVERY document in the collection, not the ones under a key this test happens to know: a keyed
 *  read would be green while a pile landed under a captureId the assertion never named. */
async function everyStoredCall(): Promise<Array<{ call: { url: string } }>> {
  return integrationCapturedCalls.find({}) as unknown as Promise<Array<{ call: { url: string } }>>;
}

beforeAll(() => bootAgentTestDb('ekoa_security_captured_evidence_last_gate'), 60_000);

afterAll(async () => {
  restoreTransport();
  await shutdownAgentTestDb();
});

beforeEach(async () => {
  resetAgentState({});
  __resetAutomationSeamsForTests();
  clock = 0;
  const now = () => new Date(1_700_000_000_000 + clock++);
  recipes = new IntegrationRecipeStore(integrationDefinitions, now);
  captures = new CapturedCallsStore(integrationCapturedCalls, now);
  definitions = new IntegrationDefinitionStore(integrationDefinitions, now);
  await integrationDefinitions.deleteMany({});
  await integrationCapturedCalls.deleteMany({});
  await automations.deleteMany({});
  await automations.insert({
    _id: AUTOMATION_ID,
    id: AUTOMATION_ID,
    name: 'listar',
    description: 'lista os processos',
    steps: [],
    ownerUserId: OWNER,
    orgId: ORG,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as never);
  await definitions.create(
    {
      orgId: ORG,
      userId: OWNER,
      key: KEY,
      visibility: 'org',
      authType: 'none',
      configSchema: [],
      actions: [{
        actionName: ACTION,
        description: 'lista',
        mutates: false,
        automationBinding: { automationId: AUTOMATION_ID },
      }],
      skillMd: `# ${KEY}\n`,
    },
    { actor: { userId: OWNER, orgId: ORG, role: 'user' } },
  );
});

// ---------------------------------------------------------------------------------------------
// A. The live route: a field of a KEPT exchange that no recipe ever carries.
// ---------------------------------------------------------------------------------------------

describe('a value on a field the compile never puts in a recipe reaches the store alone', () => {
  /**
   * BOTH fields ride the exchange the compile KEEPS, so the recipe stores and every other proof in
   * this spine is satisfied. Neither field is anywhere in the recipe: `injectedCallFromExchange`
   * takes the REQUEST header names and nothing else, so the response's names and the response's
   * content type are seen by `redactCapturedCall` (which copies them verbatim) and then by the
   * store's whole-document gate, and by nothing else at all.
   */
  it.each([
    ['a response header NAME', (x: LocalBrowserCapture): LocalBrowserCapture => ({
      ...x,
      responseHeaderNames: ['content-type', LIVE],
    })],
    ['a parameter on the response content type', (x: LocalBrowserCapture): LocalBrowserCapture => ({
      ...x,
      // `internalApiCalls` asks only that the type CONTAINS "json"; every parameter beside it is
      // site-controlled text that arrives at the document untouched.
      contentType: `application/json; realm=${LIVE}`,
    })],
  ])('refuses the evidence carrying %s, while the recipe lands anyway', async (_name, poison) => {
    const result = await learnFrom([poison(CLEAN_GET)]);
    expect(result.success).toBe(true);

    // THE RECIPE STORES FINE. It carries REQUEST header names only, so its own persistence-boundary
    // proof sees nothing - which is the whole point: `stored` is true, `learnFromRun`'s `finally`
    // discards NOTHING, and no removal path will ever name this pile.
    const recipe = await recipes.getRecipe(ORG, KEY, ACTION);
    expect(recipe).not.toBeNull();
    expect(JSON.stringify(recipe)).not.toContain(LIVE);

    // …so the capture store's own last gate is the only thing that kept it out, and it did.
    expect(await everyStoredCall()).toEqual([]);
  });

  it('…and the SAME exchange without the value is stored, so the refusal is the gate', async () => {
    const result = await learnFrom([CLEAN_GET]);
    expect(result.success).toBe(true);
    expect(await recipes.getRecipe(ORG, KEY, ACTION)).not.toBeNull();

    // The control: identical pass, identical stores, one clean field - and the evidence lands.
    const stored = await everyStoredCall();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.call.url).toContain('/api/cases');
  });
});

// ---------------------------------------------------------------------------------------------
// B. The live route: an exchange the COMPILE DROPPED but `persistEvidence` kept.
// ---------------------------------------------------------------------------------------------

/** The url of the exchange each route poisons - asserted absent from the collection, so a green
 *  count cannot mean the wrong document was the one that went. */
const DROPPED_LOGIN = 'https://portal.example/auth/session';
const DROPPED_USERINFO = 'https://relatorios:vista@portal.example/api/legacy';
const DROPPED_PAST_CEILING = `https://portal.example/api/f${MAX_COMPILED_CALLS}?ref=2024-1`;

/** One kept internal API call, indexed so each has a template of its own. */
const filler = (i: number): LocalBrowserCapture => ({
  ...CLEAN_GET,
  url: `https://portal.example/api/f${i}?ref=2024-1`,
});

describe('a request header NAME on an exchange the compile dropped reaches the store alone', () => {
  /**
   * THE RECIPE'S PROOF ONLY EVER SEES THE COMPILED SUBSET. Each route below is a documented reason
   * `compileInjectedCalls` skips an exchange - and `persistEvidence` filters on `internalApiCalls`
   * alone, so it keeps every one of them. The dropped exchange's REQUEST header names therefore
   * reach `integration_captured_calls` without ever having been offered to `assertCarriesNoValues`.
   */
  it.each([
    [
      'a login POST, whose body names a secret-shaped field',
      DROPPED_LOGIN,
      1,
      (): LocalBrowserCapture[] => [
        {
          method: 'POST',
          url: DROPPED_LOGIN,
          // The live value wearing a REQUEST header name - grammatically a name, so nothing drops it.
          requestHeaderNames: ['content-type', LIVE],
          responseHeaderNames: ['content-type'],
          status: 200,
          contentType: 'application/json',
          resourceType: 'xhr',
          // `bodyIsSecretShaped` - the call a discovery pass captures first and the one that must
          // never become a replayable `bodyTemplate`.
          requestBody: JSON.stringify({ username: 'advogado', password: 'nao-e-isto' }),
          responseBody: '{"ok":true}',
        },
        CLEAN_GET,
      ],
    ],
    [
      'a URL the compile cannot take apart',
      DROPPED_USERINFO,
      1,
      (): LocalBrowserCapture[] => [
        {
          ...CLEAN_GET,
          // USERINFO IS A CREDENTIAL IN A URL: `templateUrl` answers null and the call is dropped.
          url: DROPPED_USERINFO,
          requestHeaderNames: ['accept', LIVE],
        },
        CLEAN_GET,
      ],
    ],
    [
      `the ${MAX_COMPILED_CALLS + 1}th distinct call, past the compile ceiling`,
      DROPPED_PAST_CEILING,
      MAX_COMPILED_CALLS,
      (): LocalBrowserCapture[] => [
        ...Array.from({ length: MAX_COMPILED_CALLS }, (_v, i) => filler(i)),
        // One past `MAX_COMPILED_CALLS`, and well inside `MAX_PERSISTED_EVIDENCE` (48): the compile
        // stops growing the recipe here, and the evidence writer does not.
        { ...filler(MAX_COMPILED_CALLS), requestHeaderNames: ['accept', LIVE] },
      ],
    ],
  ])('refuses %s, and stores the rest of the pass', async (_name, droppedUrl, kept, exchanges) => {
    const result = await learnFrom(exchanges());
    expect(result.success).toBe(true);

    // The recipe landed - so, again, `stored` is true and nothing collects what follows.
    const recipe = await recipes.getRecipe(ORG, KEY, ACTION);
    expect(recipe).not.toBeNull();
    expect(JSON.stringify(recipe)).not.toContain(LIVE);

    const stored = await everyStoredCall();
    // THE REST OF THE PASS IS THERE. A suite asserting only "no live value" would be satisfied by a
    // store that refused everything, which is a different defect wearing the same green.
    expect(stored).toHaveLength(kept);
    expect(stored.map((d) => d.call.url)).not.toContain(droppedUrl);
    expect(JSON.stringify(stored)).not.toContain(LIVE);
  });
});

// ---------------------------------------------------------------------------------------------
// C. The store's own gate, for a caller the compile is not standing in front of.
// ---------------------------------------------------------------------------------------------

describe('the store refuses a live value on any field it copies verbatim', () => {
  /**
   * `method` is the one field of this class that today's learn pass CANNOT deliver a value on:
   * `redactCaptures` upper-cases it and `internalApiCalls` keeps only the seven HTTP verbs, so
   * nothing poisoned survives the filter `persistEvidence` shares with the compile. It is asserted
   * HERE, at the store, because the gate is the STORE's rather than the learn pass's -
   * `appendCapturedCall` is an exported method with no compile in front of it, and
   * `redactCapturedCall` copies `method` and `contentType` through without redacting either.
   */
  it.each([
    ['method', { method: LIVE, url: 'https://portal.example/api/cases', requestHeaderNames: ['accept'] }],
    ['contentType', { method: 'GET', url: 'https://portal.example/api/cases', requestHeaderNames: ['accept'], contentType: `application/json; realm=${LIVE}` }],
    ['responseHeaderNames', { method: 'GET', url: 'https://portal.example/api/cases', requestHeaderNames: ['accept'], responseHeaderNames: ['content-type', LIVE] }],
  ])('refuses a live value in %s, and persists nothing', async (_field, input) => {
    const secrets = secretRegistryFromValues([LIVE]);
    await expect(captures.appendCapturedCall(captureKey, 0, input, { secrets })).rejects.toThrow(CapturedCallsStoreError);
    expect(await captures.listCapture(captureKey)).toEqual([]);
  });

  it('…and the same append with no live value lands, so the refusal is not the shape of the input', async () => {
    const secrets = secretRegistryFromValues([LIVE]);
    const appended = await captures.appendCapturedCall(
      captureKey,
      0,
      {
        method: 'GET',
        url: 'https://portal.example/api/cases',
        requestHeaderNames: ['accept'],
        responseHeaderNames: ['content-type'],
        contentType: 'application/json; realm=publico',
      },
      { secrets },
    );
    expect(appended.verdict).toBe('ok');
    expect(await captures.listCapture(captureKey)).toHaveLength(1);
  });
});
