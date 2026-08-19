/**
 * THE ACCEPTANCE for the discovery spine (P2), end to end against a REAL local site, entered
 * through the REAL production entry point.
 *
 * The claim being proved is a single sentence, and it is the reason the whole slice exists:
 *
 *     a browser-steps action is learned ONCE, on the run it was going to make anyway, compiles to
 *     replayed calls, and every later run completes deterministically with ZERO model calls.
 *
 * ── WHERE THIS SUITE ENTERS, AND WHY IT MATTERS ──────────────────────────────────────────────
 *
 * At `executeUserIntegrationAction` - the function every rail (capability route, automation
 * `integration` step, listener tick, agent tool) calls to run an integration action. Not at
 * `runAutomationForAction`, and emphatically not at the replay module. The first attempt at this
 * slice tested the spine by calling its modules directly, and every one of those tests passed
 * while NOTHING IN PRODUCTION COULD REACH THE CODE. A suite that enters where the product enters
 * is the only kind that can tell the difference.
 *
 * The one seam this suite fills in is the executor's `runAutomationBackedAction`, and it fills it
 * with `automationBackedActionHandler` - the SAME function `server.ts` binds - so the field mapping
 * across that seam (the action's identity, the owner's write assent) is the production one.
 *
 * ── HOW THE "ZERO MODEL CALLS" HALF IS PROVED ────────────────────────────────────────────────
 *
 * AT THE CHOKEPOINT ITSELF, not at one of its doors. `llm/client.ts` routes every model call in
 * this repo through a `ChokepointTransport` with THREE methods - `streamAgent` (behind `runAgent`),
 * `oneShot` (behind `runOneShot`) and `messages` (behind `completeFast` and the gateway) - and the
 * fake transport counts all three. The first attempt spied `runOneShot` alone, which leaves two
 * doors that a "deterministic" replay could have walked through unobserved.
 *
 * ── WHY A REAL HTTP SERVER AND NOT A MOCK ────────────────────────────────────────────────────
 *
 * The fixture below is a genuine `node:http` server on a loopback port, serving a genuine JSON API
 * with a genuine CSRF header it checks. The URL templating, the header forwarding, the JSON parse,
 * the shape comparison and the drift classification all run against bytes that actually crossed a
 * socket. Stubbing the transport would have made this suite a test of its own mocks.
 *
 * ══ WHAT THIS SUITE CANNOT PROVE, SAID PLAINLY ═══════════════════════════════════════════════
 *
 * IT DOES NOT EXERCISE THE DAEMON, AND IT STRUCTURALLY CANNOT. `api/**` may not import
 * `clients/**` - a lint-enforced zone (`.eslintrc.cjs`, "api/ must not import from clients/ - the
 * dependency runs one way"), and rightly so. So there is no arrangement of this file that runs
 * `clients/bridge/src/runtime/tool-executor.ts` or `browser/inject.ts`. `daemonForFixture` below is
 * a STAND-IN at the frame boundary, and a stand-in is not evidence about the thing it stands in for.
 *
 * The previous cut of this suite did not say that, and the omission mattered: its stand-in resolved
 * header values from a map it simply held, while the real daemon resolved them from a recorder that
 * a replay lease did not have. The suite's headline assertion - "the replay reached the real API
 * with the session header" - was therefore true of the fixture and FALSE of production, and no
 * mutation of the daemon could have turned it red.
 *
 * SO THE CLAIM IS SPLIT, and each half is proved where it can actually fail:
 *
 *   HERE (the hosted half, and it is the whole of what this file asserts): entered at
 *   `executeUserIntegrationAction` through the production seam mapping, run 1 learns and run 2
 *   replays with ZERO model calls at the chokepoint and no new run record. The frames Cortex emits
 *   are asserted directly - including that the recipe's header NAMES are on them - because that is
 *   the hosted side's actual contract with the machine.
 *
 *   `clients/bridge/test/browser/inject-inheritance.test.ts` (the daemon half): a REAL Chromium
 *   over a REAL server proves the replay inherits the page's SameSite=Strict cookie jar and fills
 *   the learned header NAME from the live session, each against its own control.
 *   `clients/bridge/test/browser/replay-wiring.test.ts` proves the daemon's frame handler arms the
 *   recorder and navigates for a lease that never captured - which is every replay lease.
 *
 *   `tests/contract/local-browser-capture.contract.test.ts` pins the frame shapes both sides read.
 *
 * TO KEEP THE STAND-IN FROM DRIFTING BACK INTO A LIE, it is written to model the real daemon's
 * CONTRACT rather than a convenient one: it starts holding NO header values, it learns them only
 * from traffic it actually observes, and it REFUSES an injected call for an origin it was never
 * navigated to - exactly as `runInjectedCall` refuses a page it could not put on the origin. A
 * regression that stops the hosted side sending what the daemon needs therefore fails HERE too.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Actor } from '@ekoa/shared';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { FakeTransport } from '../agents/_fake-transport.js';
import { automations, automationRuns, integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { IntegrationRecipeStore } from '../../src/integrations/recipe-store.js';
import { CapturedCallsStore } from '../../src/integrations/captured-calls-store.js';
import { executeUserIntegrationAction } from '../../src/integrations/action-executor.js';
import { automationBackedActionHandler } from '../../src/automation/service.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  __resetAutomationSeamsForTests,
  type DaemonConnection,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';

// ---------------------------------------------------------------------------------------------
// The fixture site: a real HTTP server with a real private API behind a real CSRF header.
// ---------------------------------------------------------------------------------------------
let server: Server;
let origin: string;
/** Flipped by the drift test: the endpoint "moves" the way a real portal's does. */
let apiPath = '/api/cases';
let requests: Array<{ method: string; url: string; headers: Record<string, string> }> = [];

function startFixture(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '', headers: req.headers as Record<string, string> });
    if (url.pathname === apiPath) {
      // The API the site's own UI calls. It CHECKS the session header, so a replay that failed to
      // forward it would 401 rather than quietly pass.
      if (req.headers['x-csrf-token'] !== 'csrf-live-value') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{"error":"missing csrf"}');
        return;
      }
      const ref = url.searchParams.get('ref') ?? '';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ items: [{ id: 41, ref, title: `case ${ref}` }], total: 1 }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<html><body>not found</body></html>');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  }));
}

// ---------------------------------------------------------------------------------------------
// The machine, at the wire. Answers the same `browser` frames the real daemon answers.
// ---------------------------------------------------------------------------------------------

/**
 * A paired daemon, standing in at the frame boundary. NOT the daemon - see the header for what this
 * can and cannot be evidence of.
 *
 * It is written to model the REAL contract (`clients/bridge/src/runtime/tool-executor.ts`), and the
 * two properties below are the ones that stop it flattering the hosted side:
 *
 *  1. IT HOLDS NO HEADER VALUES TO BEGIN WITH. `live` starts EMPTY, exactly as a machine's recorder
 *     does on a lease that has not watched any traffic. Values appear only in `observeTraffic`,
 *     which is called when the page actually loads the site. A fixture that simply held the CSRF
 *     value - which the previous cut did - answers every replay correctly no matter what the hosted
 *     side sends, and the "the replay carried the session header" assertion proves nothing.
 *  2. AN INJECTED CALL FOR AN ORIGIN THE PAGE HAS NEVER BEEN ON IS REFUSED, mirroring
 *     `runInjectedCall`'s own refusal. The real daemon navigates first (that is what makes the
 *     fetch same-origin and the jar inheritable); this models the navigation and its failure mode.
 *
 * CORTEX NEVER SENDS A HEADER VALUE TO IT AND IT NEVER SENDS ONE BACK. `live` is this machine's;
 * frames carry names.
 */
function daemonForFixture(): DaemonConnection & {
  armed: boolean;
  leaseReleased: boolean;
  injectFrames: Array<{ method: string; url: string; headerNames: string[] }>;
} {
  /** The machine's live map. EMPTY until this machine watches the site talk to itself. */
  const live: Record<string, string> = {};
  /** Origins this page has actually loaded. An injected call may only run on one of them. */
  const visited = new Set<string>();
  let buffered: Array<Record<string, unknown>> = [];

  /** The site's own boot/search traffic, as the machine's recorder sees it: the values land in
   *  `live`, and only the NAMES are ever buffered for Cortex. */
  async function observeTraffic(url: string): Promise<string> {
    const sessionHeaders = { 'x-csrf-token': 'csrf-live-value' };
    const res = await fetch(url, { headers: sessionHeaders });
    const body = await res.text();
    for (const [name, value] of Object.entries(sessionHeaders)) live[name] = value;
    visited.add(new URL(url).origin);
    if (state.armed) {
      buffered.push({
        method: 'GET',
        url,
        // NAMES. The recorder on the machine reads the map's keys and drops the values.
        requestHeaderNames: ['accept', ...Object.keys(sessionHeaders)].sort(),
        responseHeaderNames: ['content-type'],
        status: res.status,
        contentType: 'application/json',
        resourceType: 'xhr',
        responseBody: body,
      });
    }
    return body;
  }

  const state = {
    armed: false,
    leaseReleased: false,
    injectFrames: [] as Array<{ method: string; url: string; headerNames: string[] }>,
    runStep: async (frame: { capability: string; input?: unknown }) => {
      const input = (frame.input ?? {}) as Record<string, unknown>;

      if (input.leaseOp === 'release') {
        state.leaseReleased = true;
        state.armed = false;
        buffered = [];
        // The lease's live values die with it, on this machine as on the real one.
        for (const k of Object.keys(live)) delete live[k];
        visited.clear();
        return { ok: true as const };
      }
      if (input.captureOp === 'start') { state.armed = true; return { ok: true as const, observation: { data: {} } }; }
      if (input.captureOp === 'stop') { state.armed = false; buffered = []; return { ok: true as const, observation: { data: {} } }; }

      if (input.injectedCall) {
        const call = input.injectedCall as { method: string; url: string; headerNames: string[] };
        state.injectFrames.push({ method: call.method, url: call.url, headerNames: [...call.headerNames] });
        const callOrigin = new URL(call.url).origin;
        // THE NAVIGATION. The real daemon puts the page on the call's origin before it injects -
        // which is both what makes the fetch same-origin and what provokes the traffic the live
        // header values are read from. Modelled here for the same reason: without it this machine
        // has no values to forward, exactly as the real one would not.
        if (!visited.has(callOrigin)) {
          try {
            await observeTraffic(`${callOrigin}${apiPath}?ref=probe`);
          } catch {
            return { ok: false as const, error: { message: `the page could not open ${callOrigin}` } };
          }
        }
        // THE MACHINE RESOLVES THE VALUES. Cortex sent names; the values come from the live session.
        const headers: Record<string, string> = {};
        for (const name of call.headerNames) if (live[name] !== undefined) headers[name] = live[name]!;
        const res = await fetch(call.url, { method: call.method, headers });
        const bodyText = await res.text();
        return {
          ok: true as const,
          observation: {
            data: {
              url: `${origin}/cases`,
              injectedCall: { status: res.status, ok: res.ok, bodyText, contentType: 'application/json', responseHeaderNames: ['content-type'] },
            },
          },
        };
      }

      // An ordinary page act. The only one the fixture models is the page fetching its own data.
      const action = input.action as { kind?: string } | undefined;
      if (action && action.kind !== 'screenshot' && action.kind !== 'noop') {
        await observeTraffic(`${origin}${apiPath}?ref=2024-1`);
      }
      const captures = buffered;
      buffered = [];
      return {
        ok: true as const,
        observation: {
          screenshotB64: Buffer.from('png-bytes').toString('base64'),
          data: {
            url: `${origin}/cases`,
            title: 'Processos',
            domShapeSketch: 'tags:button|roles:button|landmarks:1',
            viewport: { w: 1280, h: 800 },
            a11ySummary: 'button "Pesquisar"',
            ...(captures.length > 0 ? { captures } : {}),
          },
        },
      };
    },
  };
  return state as unknown as DaemonConnection & {
    armed: boolean;
    leaseReleased: boolean;
    injectFrames: Array<{ method: string; url: string; headerNames: string[] }>;
  };
}

// ---------------------------------------------------------------------------------------------
// Stores + fixtures
// ---------------------------------------------------------------------------------------------
let clock = 0;
let transport: FakeTransport;
const actor: Actor = { userId: 'u1', orgId: 'org-a', role: 'user' };
const KEY = 'portal';
const ACTION = 'list_cases';
const AUTOMATION_ID = 'auto-portal';

const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const recipes = new IntegrationRecipeStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const captures = new CapturedCallsStore(integrationCapturedCalls, () => new Date(1_700_000_000_000 + clock++));

/** The vision resolver's answer, as a model completion. One click, high confidence. */
const RESOLVER_JSON = JSON.stringify({
  action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Pesquisar' } },
  confidence: 'high',
  reasoning: 'pesquisar os processos',
});

function definitionRow(): IntegrationDefinitionCreate {
  return {
    orgId: actor.orgId,
    userId: actor.userId,
    key: KEY,
    visibility: 'org',
    // `none`: the fixture site needs no stored credential, so the executor's connection gate is
    // not what this suite is about.
    authType: 'none',
    configSchema: [],
    actions: [{
      actionName: ACTION,
      description: 'lista os processos',
      // A READ. Which means the executor's consent gate answers `not_mutating`, which means NO
      // write assent crosses the seam - so the replay's write gate stays closed for this action,
      // which is exactly right and is asserted in its own case below.
      mutates: false,
      automationBinding: { automationId: AUTOMATION_ID },
    }],
    skillMd: `# ${KEY}\n`,
  };
}

/** THE PRODUCTION ENTRY POINT, with the production seam mapping. */
async function runTheAction(args: Record<string, unknown> = { ref: '2024-1' }) {
  return executeUserIntegrationAction(
    { orgId: actor.orgId, ownerUserId: actor.userId, integrationKey: KEY, actionName: ACTION, args },
    {
      runAutomationBackedAction: automationBackedActionHandler({
        putRecipe: (orgId, key, actionName, draft, opts) => recipes.putRecipe(orgId, key, actionName, draft, opts),
        supersedeRecipe: (orgId, key, actionName, next, opts) => recipes.supersedeRecipe(orgId, key, actionName, next, opts ?? {}),
        captures,
        captureId: () => `cap-${clock}`,
      }) as never,
    },
  );
}

/** Every model call this repo can make passes one of these three. */
function modelCalls(): number {
  return transport.streamCalls.length + transport.oneShotCalls.length + transport.messagesCalls.length;
}

beforeAll(async () => {
  await startFixture();
  await bootAgentTestDb('ekoa_discovery_acceptance');
}, 60_000);

afterAll(async () => {
  await shutdownAgentTestDb();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  clock = 0;
  apiPath = '/api/cases';
  requests = [];
  transport = resetAgentState({ oneShotText: RESOLVER_JSON });
  __resetAutomationSeamsForTests();
  // The in-process browser fallback OFF, so the ONLY way a browser step runs is the daemon below -
  // which is what makes "the daemon was asked to arm a recorder" an observable fact.
  process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
  __resetAutomationConfigForTests();
  setScopedMemoryResolver(async () => []);
  await integrationDefinitions.deleteMany({});
  await integrationCapturedCalls.deleteMany({});
  await automations.deleteMany({});
  await automationRuns.deleteMany({});
  await definitions.create(definitionRow(), { actor });
  await automations.insert({
    _id: AUTOMATION_ID,
    id: AUTOMATION_ID,
    name: 'listar processos',
    description: 'abre o portal e pesquisa',
    ownerUserId: actor.userId,
    orgId: actor.orgId,
    steps: [{ id: 's1', description: 'clicar em Pesquisar', type: 'browser' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as never);
});

afterEach(() => {
  restoreTransport();
  __resetAutomationSeamsForTests();
  delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
  __resetAutomationConfigForTests();
});

describe('ACCEPTANCE: learned on the run that was going to happen, replayed deterministically', () => {
  it('run 1 runs the automation and LEARNS; run 2 replays the same real API with ZERO model calls', async () => {
    // ── RUN 1. The ordinary vision-driven run, with the recorder armed underneath it. ─────────
    const daemon = daemonForFixture();
    setDaemonConnectionResolver(() => daemon);

    const first = await runTheAction();
    expect(first.success).toBe(true);
    // It cost model calls, which is the baseline the second run is measured against. Without this
    // the "zero" below would also hold for a suite in which nothing ever consults a model.
    const spentOnLearning = modelCalls();
    expect(spentOnLearning).toBeGreaterThan(0);
    // The daemon really was asked to record - the property that makes the spine reachable at all.
    expect(daemon.armed || daemon.leaseReleased).toBe(true);

    // What it learned: the site's own call, templated on the run's argument, with the session
    // header remembered BY NAME.
    const recipe = await recipes.getRecipe(actor.orgId, KEY, ACTION);
    expect(recipe).not.toBeNull();
    expect(recipe!.version).toBe(1);
    expect(recipe!.injectedCalls).toHaveLength(1);
    expect(recipe!.injectedCalls[0]!.urlTemplate).toBe(`${origin}/api/cases?ref={{input.ref}}`);
    expect(recipe!.injectedCalls[0]!.headerNames).toContain('x-csrf-token');
    expect(recipe!.injectedCalls[0]!.idempotent).toBe(true);
    expect(recipe!.lessons.some((l) => l.includes('x-csrf-token'))).toBe(true);
    // NO VALUE ANYWHERE IN IT - the property the whole spine rests on, asserted over the entire
    // stored document rather than the fields we happened to think of.
    expect(JSON.stringify(recipe)).not.toContain('csrf-live-value');

    // ── RUN 2. Same action, same arguments, entered the same way, and no model. ───────────────
    // A FRESH machine, held as ONE instance so what it was asked is observable. Fresh matters: it
    // starts with an empty live map, which is the state a replay lease is really in.
    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    const replayDaemon = daemonForFixture();
    setDaemonConnectionResolver(() => replayDaemon);
    const runsBefore = (await automationRuns.find({})).length;

    const second = await runTheAction();
    expect(second.success).toBe(true);
    expect(second.data).toMatchObject({ replayed: true, recipeVersion: 1 });

    // THE ACCEPTANCE CRITERION, at the chokepoint every model call in this repo must pass - all
    // three of its methods, not one of its callers.
    expect(modelCalls()).toBe(0);
    // …and the automation did not run at all: no new run record exists.
    expect((await automationRuns.find({})).length).toBe(runsBefore);

    // THE HOSTED CONTRACT, which is the half this suite can actually falsify: what Cortex PUT ON
    // THE WIRE. The learned header names must be on the frame - a machine cannot forward a name it
    // was never told, so a hosted side that drops them makes the daemon's whole capture worthless.
    expect(replayDaemon.injectFrames).toHaveLength(1);
    expect(replayDaemon.injectFrames[0]).toMatchObject({
      method: 'GET',
      url: `${origin}/api/cases?ref=2024-1`,
    });
    expect(replayDaemon.injectFrames[0]!.headerNames).toContain('x-csrf-token');
    // …and no VALUE rode out with them: the frame carries names, the machine holds values.
    expect(JSON.stringify(replayDaemon.injectFrames)).not.toContain('csrf-live-value');

    // The replay got the REAL answer from the REAL server - the fixture checks the CSRF header, so
    // this is also proof the name-only recipe reconstituted a working authenticated call.
    expect((second.data as { output: unknown }).output).toEqual({ items: [{ id: 41, ref: '2024-1', title: 'case 2024-1' }], total: 1 });
    expect(requests[requests.length - 1]!.headers['x-csrf-token']).toBe('csrf-live-value');
  }, 60_000);

  it('a third and fourth run are the same again - determinism is not a one-off', async () => {
    setDaemonConnectionResolver(() => daemonForFixture());
    await runTheAction();
    expect(await recipes.getRecipe(actor.orgId, KEY, ACTION)).not.toBeNull();

    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    for (let run = 0; run < 3; run += 1) {
      setDaemonConnectionResolver(() => daemonForFixture());
      const result = await runTheAction();
      expect(result.success).toBe(true);
      expect((result.data as { replayed?: boolean }).replayed).toBe(true);
    }
    expect(modelCalls()).toBe(0);
  }, 60_000);

  it('stores the raw evidence in its own collection and keeps no value in it either', async () => {
    setDaemonConnectionResolver(() => daemonForFixture());
    await runTheAction();

    const recipe = await recipes.getRecipe(actor.orgId, KEY, ACTION);
    const evidence = await captures.listCapture({
      orgId: actor.orgId, integrationKey: KEY, actionName: ACTION, captureId: recipe!.capturedCallsRef!,
    });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]!.call.requestHeaderNames).toContain('x-csrf-token');
    expect(JSON.stringify(evidence)).not.toContain('csrf-live-value');
  }, 60_000);

  it('a MISSING argument refuses the replay and falls through, rather than widening the query', async () => {
    setDaemonConnectionResolver(() => daemonForFixture());
    await runTheAction();
    expect((await recipes.getRecipe(actor.orgId, KEY, ACTION))!.injectedCalls[0]!.urlTemplate).toContain('{{input.ref}}');

    setDaemonConnectionResolver(() => daemonForFixture());
    requests = [];
    // `ref` is what the template asks for and this call does not supply it. The old behaviour was
    // to render the hole as '' - and `?ref=` on this API (as on most) means "every case in the
    // tenant". So the replay refuses and the ordinary automation runs instead.
    const result = await runTheAction({ unrelated: 'x' });
    expect(result.success).toBe(true);
    expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
    // THE POINT: the widened request was never made. Asserted on what the SERVER saw, which is the
    // only place the difference between "refused" and "fetched everything" is visible.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => /[?&]ref=(&|$)/.test(r.url))).toEqual([]);
    // …and the run that did happen is a real one, so the fall-through is a fall-through.
    expect((result.data as { runId?: string }).runId).toBeTruthy();
  }, 60_000);
});

describe('ACCEPTANCE: a site that changes drifts, re-learns on the next run, and supersedes', () => {
  it('the moved endpoint is detected as drift at zero model cost, then superseded in-tenant', async () => {
    setDaemonConnectionResolver(() => daemonForFixture());
    await runTheAction();
    expect((await recipes.getRecipe(actor.orgId, KEY, ACTION))!.version).toBe(1);

    // ── THE SITE MOVES ITS ENDPOINT. Nothing about the recipe changes; the world does. ────────
    apiPath = '/api/v2/cases';
    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    setDaemonConnectionResolver(() => daemonForFixture());

    const healed = await runTheAction();
    expect(healed.success).toBe(true);
    // The drift DETECTION itself is a status code and a shape comparison; the model was spent on
    // the run that re-learned, never on noticing that one was needed.
    expect((healed.data as { replayed?: boolean }).replayed).toBeUndefined();

    const superseded = await recipes.getRecipe(actor.orgId, KEY, ACTION);
    expect(superseded!.version).toBe(2);
    expect(superseded!.injectedCalls[0]!.urlTemplate).toBe(`${origin}/api/v2/cases?ref={{input.ref}}`);
    expect(superseded!.supersedes?.version).toBe(1);
    expect(superseded!.supersedes?.reason).toContain('404');

    // NOT A PUBLICATION: a tenant-private heal must leave visibility and the snapshot untouched.
    const row = await definitions.getForActor(actor, KEY);
    expect(row!.visibility).toBe('org');
    expect(row!.publishedSnapshot).toBeUndefined();
    expect(row!.publishRequest).toBeUndefined();

    // ── AND THE NEXT RUN IS DETERMINISTIC AGAIN. ─────────────────────────────────────────────
    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    setDaemonConnectionResolver(() => daemonForFixture());
    const afterHeal = await runTheAction();
    expect((afterHeal.data as { replayed?: boolean; recipeVersion?: number })).toMatchObject({ replayed: true, recipeVersion: 2 });
    expect(modelCalls()).toBe(0);
  }, 60_000);
});
