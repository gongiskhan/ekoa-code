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
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Actor } from '@ekoa/shared';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { FakeTransport } from '../agents/_fake-transport.js';
import { automations, automationRuns, integrationDefinitions, integrationCapturedCalls, approvedIntegrationActions } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { IntegrationRecipeStore } from '../../src/integrations/recipe-store.js';
import { CapturedCallsStore } from '../../src/integrations/captured-calls-store.js';
import { saveAuthoredDefinition } from '../../src/integrations/definition-save.js';
import { executeUserIntegrationAction } from '../../src/integrations/action-executor.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
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
/**
 * The opaque page-state value `/api/view` carries - an ASP.NET `__VIEWSTATE` in miniature. 33
 * characters of mixed case and digits, which is what `looksLikeLiteralSecret` refuses (a >=24-char
 * opaque run using all three character classes). NOT a credential and nothing in this suite holds
 * it as one: the point is precisely that the store cannot tell, refuses, and THROWS. Carries the
 * `EKOA-SYNTHETIC-` marker per the secret-shaped-fixture convention in `scripts/gitleaks.toml`
 * (an earlier value did not, and its history entry sits in that file's value allowlist).
 */
const PAGE_STATE_TOKEN = 'EKOA-SYNTHETIC-ViewState12345dDwt';
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
    if (url.pathname === '/api/badge') {
      // AN ORDINARY SECOND INTERNAL CALL - a notification badge the page polls. Every portal has
      // one. It is the same kind of call as the search (script-issued, 2xx, JSON), so a recipe
      // captures it too, and it FINISHES LAST. See the case that uses it.
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"unread":7}');
      return;
    }
    if (url.pathname === '/api/view') {
      // AN ORDINARY PAGE-STATE CALL, and the one whose captured URL the RECIPE STORE REFUSES BY
      // THROWING. Every server-rendered portal has one (`__VIEWSTATE`, a continuation token, a
      // nonce): a script-issued JSON GET carrying an opaque generated value that the run's registry
      // never held (so no redaction leg substitutes it) under a parameter name that is not
      // conventionally credential-ish (so no name-pattern leg masks it), and which is not one of
      // this run's arguments (so the compile leaves it LITERAL in the template). Every gate before
      // the store passes; `looksLikeLiteralSecret` then refuses the whole recipe AT the store.
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"pane":"cases"}');
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
function daemonForFixture(opts: { alsoPollsTheBadge?: boolean; alsoFetchesPageState?: boolean } = {}): DaemonConnection & {
  armed: boolean;
  leaseReleased: boolean;
  /** Every `captureOp` this machine was sent, in order. A LOG rather than the `armed` flag: the
   *  flag is cleared by the lease release at the end of every run, so it cannot answer "was this
   *  machine ever asked to record?" - which is the whole question for an action whose recipe can
   *  never be stored. */
  captureOps: string[];
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
    captureOps: [] as string[],
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
      if (input.captureOp === 'start') { state.captureOps.push('start'); state.armed = true; return { ok: true as const, observation: { data: {} } }; }
      if (input.captureOp === 'stop') { state.captureOps.push('stop'); state.armed = false; buffered = []; return { ok: true as const, observation: { data: {} } }; }

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
        // …and, when asked, the ONE extra internal call an ordinary portal page also makes. It is
        // observed AFTER the search, so it is last in `page.on('response')` completion order -
        // which is the order the capture, and therefore the compiled recipe, is built in.
        if (opts.alsoPollsTheBadge) await observeTraffic(`${origin}/api/badge`);
        // …and, when asked, the page-state call whose opaque value the recipe store refuses.
        if (opts.alsoFetchesPageState) await observeTraffic(`${origin}/api/view?state=${PAGE_STATE_TOKEN}`);
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
    captureOps: string[];
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
/** The same integration's WRITE action, bound to the same automation. See the mutating-action
 *  acceptance below: the pass it makes captures the very same read the action above learns from. */
const WRITE_ACTION = 'submit_case';
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
    }, {
      actionName: WRITE_ACTION,
      description: 'submete o processo',
      // A WRITE, on the SAME automation and therefore the same captured traffic. That identity is
      // the whole point of the acceptance below: the two actions differ in exactly one declared
      // fact, and the spine must treat them completely differently because of it.
      mutates: true,
      automationBinding: { automationId: AUTOMATION_ID },
    }],
    skillMd: `# ${KEY}\n`,
  };
}

/** THE PRODUCTION ENTRY POINT, with the production seam mapping. */
async function runTheAction(args: Record<string, unknown> = { ref: '2024-1' }, actionName: string = ACTION) {
  return executeUserIntegrationAction(
    { orgId: actor.orgId, ownerUserId: actor.userId, integrationKey: KEY, actionName, args },
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
  await approvedIntegrationActions.deleteMany({});
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
    // THE DAEMON REALLY WAS ASKED TO RECORD - the property that makes the spine reachable at all.
    // Asserted on the OPS LOG rather than on `daemon.armed`: `armed` is cleared by the lease
    // release at the end of every run, and the previous form of this line (`armed || leaseReleased`)
    // was therefore satisfied by the release alone - it stayed green with the arming removed
    // entirely, which is no evidence about arming at all.
    expect(daemon.captureOps).toContain('start');

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
    // NO VALUE IN IT. Read this for what it is: the machine here never PUT a value on the wire (the
    // fixture buffers `requestHeaderNames`, by contract), and this integration is `authType: 'none'`
    // so the run holds no credential and its registry is empty. So this assertion pins the WIRE
    // CONTRACT - a value cannot arrive from the machine in the first place - and NOT the redaction
    // legs, which have nothing to redact here and cannot fail in this suite.
    // The three redaction legs are proved where a live value actually exists, against the real
    // stores: `automation/replay-mount.test.ts`, "the run's live credential values reach every check
    // that takes them". Saying which is which matters: a green assertion that could not have gone
    // red is exactly the shape that made three separate wirings look covered when they were not.
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
    // …and no VALUE rode out with them: the frame carries names, the machine holds values. This one
    // is about the HOSTED side and can fail - Cortex builds these frames, and a build that resolved
    // a header value would put one here. (What it does NOT prove is redaction; see above.)
    expect(JSON.stringify(replayDaemon.injectFrames)).not.toContain('csrf-live-value');

    // The replay reached the REAL server and the server accepted it - the fixture checks the CSRF
    // header, so this is proof the name-only recipe reconstituted a working authenticated call.
    expect(requests[requests.length - 1]!.headers['x-csrf-token']).toBe('csrf-live-value');

    // ══ AND IT IS INDISTINGUISHABLE FROM THE RUN IT REPLACED ════════════════════════════════
    //
    // SAME ENVELOPE. The replay used to answer `{replayed, recipeVersion, output}` while the
    // automation answers `{runId, status, summary, output}` - and every consumer is written against
    // the second. The listener rail unwraps `output` only when it sees BOTH a string `runId` and a
    // string `status` (`user-defined-poll.ts`), so a replayed poll resolved its package's field
    // paths against the envelope, read `undefined` from all of them, and reported a quiet provider
    // on every tick forever. Compared as KEY SETS, because the defect was a missing key rather than
    // a wrong value, and `toMatchObject` cannot see one.
    const envelope1 = first.data as Record<string, unknown>;
    const envelope2 = second.data as Record<string, unknown>;
    expect(Object.keys(envelope1).sort()).toEqual(['output', 'runId', 'status', 'summary']);
    // `replayMs` joined the replay leg with K4 (the replay's own wall-clock, feeding the recipe's
    // usage stats and the typed wire replay block).
    expect(Object.keys(envelope2).sort()).toEqual(['output', 'recipeVersion', 'replayMs', 'replayed', 'runId', 'status', 'summary']);
    expect(typeof envelope2.runId).toBe('string');
    expect(typeof envelope2.status).toBe('string');

    // SAME ANSWER - the thing the action exists to produce, and the assertion this suite never made.
    // This automation is the SHIPPED shape: browser steps only, no `api_call` and no `ekoa_action`,
    // so the run itself answers NOTHING (`extractActionRunOutput` reads those two step outputs and
    // there are none). A replay that helpfully hands back a captured body would therefore be a
    // DIFFERENT action from the one it replaces - better-looking and wrong - so it answers nothing
    // too, and the recipe records that (`answersWith` absent) rather than guessing.
    //
    // Against the old code this line fails immediately: it answered `calls[calls.length - 1].body`,
    // which here is the search result. The badge case below is the same defect where the answer is
    // not even the search.
    expect(envelope2.output).toEqual(envelope1.output);
    expect(envelope1.output).toBeUndefined();
    expect((await recipes.getRecipe(actor.orgId, KEY, ACTION))!.answersWith).toBeUndefined();
  }, 60_000);

  /**
   * ONE ORDINARY EXTRA CALL MUST NOT CHANGE THE ACTION'S ANSWER.
   *
   * THE DEFECT, reproduced end to end: the replay answered `calls[calls.length - 1].body`, and that
   * list is in the order the page's own `response` events COMPLETED. Nothing correlated it with the
   * action's answer. So adding a notification-badge poll after the search - a call every portal
   * page makes, captured by the same three structural tests as the search (script-issued, 2xx,
   * JSON) - made run 2 answer `{"unread":7}`, with `success: true` and `replayed: true` and no
   * other symptom anywhere.
   *
   * The old acceptance could not see it: its fixture emitted exactly ONE call per frame, so "the
   * last call" and "the answer" were the same body by construction, and it never compared run 2's
   * answer to run 1's at all.
   */
  it('an ordinary SECOND internal call does not become the answer - the recipe names which call is', async () => {
    const learn = daemonForFixture({ alsoPollsTheBadge: true });
    setDaemonConnectionResolver(() => learn);
    const first = await runTheAction();
    expect(first.success).toBe(true);

    // BOTH calls are in the recipe - this is not a filtering test. The badge is a real call the
    // page makes and replaying it is harmless; what must not happen is it becoming the ANSWER.
    const recipe = await recipes.getRecipe(actor.orgId, KEY, ACTION);
    expect(recipe!.injectedCalls.map((c) => c.urlTemplate)).toEqual([
      `${origin}/api/cases?ref={{input.ref}}`,
      `${origin}/api/badge`,
    ]);

    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    const replayDaemon = daemonForFixture({ alsoPollsTheBadge: true });
    setDaemonConnectionResolver(() => replayDaemon);
    const second = await runTheAction();

    expect(second.success).toBe(true);
    expect((second.data as { replayed?: boolean }).replayed).toBe(true);
    expect(modelCalls()).toBe(0);
    // The badge WAS replayed - so this is genuinely the "last call finished last" situation, not a
    // fixture in which the badge never ran.
    expect(replayDaemon.injectFrames.map((f) => f.url)).toEqual([
      `${origin}/api/cases?ref=2024-1`,
      `${origin}/api/badge`,
    ]);
    // …AND THE ANSWER IS STILL THE ONE THE ACTION GAVE. Against the old code this is `{unread: 7}`.
    expect((second.data as { output: unknown }).output).toEqual((first.data as { output: unknown }).output);
    expect(JSON.stringify(second.data)).not.toContain('unread');
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

  it('stores the raw evidence in its own collection, under the ref the recipe points at', async () => {
    setDaemonConnectionResolver(() => daemonForFixture());
    await runTheAction();

    const recipe = await recipes.getRecipe(actor.orgId, KEY, ACTION);
    const evidence = await captures.listCapture({
      orgId: actor.orgId, integrationKey: KEY, actionName: ACTION, captureId: recipe!.capturedCallsRef!,
    });
    // THE POINTER RESOLVES. That is what this case can prove and it is worth proving: the recipe
    // carries `capturedCallsRef` into a separate collection, written before it, under the same id.
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]!.call.requestHeaderNames).toContain('x-csrf-token');
    // NOT a redaction proof - see the note in the case above. This run holds no credential, so the
    // evidence store's registry leg has nothing to catch and cannot fail here. It is proved against
    // a live value in `automation/replay-mount.test.ts`.
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
    //
    // NO ARGUMENTS AT ALL, so this is the missing-hole refusal and ONLY that one. Passing an
    // UNRELATED argument instead - which is what this case used to do - trips the argument-COVERAGE
    // refusal first, which is a different rule with a different disposition (it drops the recipe),
    // so the case would have gone on passing while testing the other one.
    const result = await runTheAction({});
    expect(result.success).toBe(true);
    expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
    // THE POINT: the widened request was never made. Asserted on what the SERVER saw, which is the
    // only place the difference between "refused" and "fetched everything" is visible.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((r) => /[?&]ref=(&|$)/.test(r.url))).toEqual([]);
    // …and the run that did happen is a real one, so the fall-through is a fall-through.
    expect((result.data as { runId?: string }).runId).toBeTruthy();
    // THE RECIPE SURVIVES, and that is the difference from the case below. A hole nobody filled is
    // a fact about THIS CALL - the very next caller that supplies `ref` replays perfectly - so
    // dropping the recipe over it would cost the action its optimisation for someone else's
    // omission. An argument the recipe has NO HOLE FOR is a fact about the RECIPE, and that one
    // does drop it.
    expect(await recipes.getRecipe(actor.orgId, KEY, ACTION)).not.toBeNull();
  }, 60_000);

  it('an argument the recipe has NO HOLE for refuses too, rather than answering the question it was compiled around', async () => {
    // THE MIRROR of the case above, and the one that has no error to hide behind: every hole IS
    // supplied, the call resolves, the route is available - and replaying it would fetch
    // `?ref=2024-1` and hand that back as the answer to a DIFFERENT question. The caller sees
    // `success: true` either way, so the only place the difference is visible is the wire.
    setDaemonConnectionResolver(() => daemonForFixture());
    await runTheAction();
    const learned = (await recipes.getRecipe(actor.orgId, KEY, ACTION))!;
    expect(learned.injectedCalls[0]!.urlTemplate).toBe(`${origin}/api/cases?ref={{input.ref}}`);
    // The pile of full redacted request AND response bodies this recipe was distilled from. It is
    // here BEFORE the clear, which is what makes the assertion after it mean something.
    const evidenceKey = {
      orgId: actor.orgId, integrationKey: KEY, actionName: ACTION, captureId: learned.capturedCallsRef!,
    };
    expect((await captures.listCapture(evidenceKey)).length).toBeGreaterThan(0);

    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    const machine = daemonForFixture();
    setDaemonConnectionResolver(() => machine);
    requests = [];

    // `status` cannot reach anything in that template. The recipe is a CONSTANT with respect to it.
    const result = await runTheAction({ ref: '2024-1', status: 'closed' });

    // NOT REPLAYED, and the machine was never asked to make the call.
    expect(result.success).toBe(true);
    expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
    expect(machine.injectFrames).toEqual([]);
    // THE FALL-THROUGH IS A REAL RUN: the authored steps DO see every argument, so the caller still
    // gets a correct answer. Refusing the replay costs the optimisation, not the result.
    expect((result.data as { runId?: string }).runId).toBeTruthy();

    // ── …AND THE NARROW RECIPE IS DROPPED, SO THE ACTION CAN LEARN AGAIN ────────────────────
    //
    // THE DEFECT THIS CLOSES, which is the ordinary listener shape and not an exotic one: a
    // listener's ESTABLISHING tick calls with `{}` and learns a hole-free recipe; every tick after
    // it calls with `{since: cursor}`. That second shape is refused here - correctly - and the
    // refusal used to be `no-recipe`, which is NOT one of the verdicts that clears a recipe. So the
    // narrow recipe sat in the action's ONE slot forever: `putRecipe` refuses to overwrite, a
    // supersede needs a drift that can never fire because the replay never runs, and nothing else
    // removes it. The action could never learn a usable recipe again, silently, for the life of the
    // row - while every run went on paying for the doomed replay attempt first.
    expect(await recipes.getRecipe(actor.orgId, KEY, ACTION)).toBeNull();

    // ── …AND ITS EVIDENCE WENT WITH IT ─────────────────────────────────────────────────────
    //
    // Asserted against the REAL captures collection, on the REAL default clear (this suite injects
    // `putRecipe`, `supersedeRecipe`, `captures` and `captureId` - never `clearRecipe`, so the path
    // under test is `integrationRecipeStore.clearRecipe` through `forgetRecipe`).
    //
    // The recipe is the ONLY index back into that collection: `priorCaptureRef` reads the CURRENT
    // recipe, which is now absent, so neither of `discardCapture`'s other two callers could ever
    // reach these documents again and the collection has no TTL. Clearing narrowed the dropped
    // recipe to a boolean, so this pile - a whole pass's request and response bodies - was orphaned
    // permanently, on the most routine refusal the spine has.
    expect(await captures.listCapture(evidenceKey)).toEqual([]);

    // AND IT SETTLES. This run's own pass could not compile a replacement (`status` appears nowhere
    // in what the page fetched, so the compile refuses a recipe that would ignore it) - so the
    // action is simply back to un-learned, and the next ordinary run learns one again and the one
    // after that replays it. No thrash, no permanent loss.
    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    setDaemonConnectionResolver(() => daemonForFixture());
    const relearn = await runTheAction({ ref: '2024-1' });
    expect((relearn.data as { replayed?: boolean }).replayed).toBeUndefined();
    expect((await recipes.getRecipe(actor.orgId, KEY, ACTION))!.version).toBe(1);

    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    const control = daemonForFixture();
    setDaemonConnectionResolver(() => control);
    const replayed = await runTheAction({ ref: '2024-1' });
    expect((replayed.data as { replayed?: boolean }).replayed).toBe(true);
    expect(control.injectFrames.map((f) => f.url)).toEqual([`${origin}/api/cases?ref=2024-1`]);
    expect(modelCalls()).toBe(0);
  }, 60_000);

  /**
   * A RECIPE WHOSE ANSWER IS A CONSTANT IS REFUSED, CLEARED, AND ITS EVIDENCE COLLECTED.
   *
   * HOW ONE GETS COMPILED, since this case plants rather than learns one: the page fetches a
   * filtered search AND some second internal call whose body happens to be identical to the run's
   * own answer (a "summary" endpoint serving the same document, a detail pane showing the row the
   * search just returned). `isTheRunsAnswer` matches BOTH and last-match-wins names the second -
   * which carries no hole at all. Every check passed, because `ref` was placed by the search and
   * the coverage rules were recipe-wide on both sides.
   *
   * THE RECIPE PLANTED HERE IS THAT SHAPE, in its plainest form: the search carries `{{input.ref}}`
   * and the ANSWER is the constant `/api/badge`. Replaying it hands every caller `{"unread":7}` as
   * this action's answer whatever they asked for, under `success: true, replayed: true`, with no
   * drift (both calls still 200 with an unchanged shape) and no other symptom anywhere.
   *
   * The compile now refuses to LEARN that shape. This case is the OTHER half: one already stored -
   * an older build's, i.e. every build of this slice before the rule existed - planted through the
   * REAL store, so what the replay reads is a real stored recipe.
   */
  it('a stored recipe whose ANSWER is a constant is refused, cleared, and its evidence goes with it', async () => {
    const CONSTANT_CAPTURE = 'cap-constant-answer';
    await captures.appendCapturedCall(
      { orgId: actor.orgId, integrationKey: KEY, actionName: ACTION, captureId: CONSTANT_CAPTURE },
      0,
      { method: 'GET', url: `${origin}/api/badge`, requestHeaderNames: ['accept'], responseBody: '{"unread":7}' },
    );
    await recipes.putRecipe(actor.orgId, KEY, ACTION, {
      goal: `replay of ${KEY}/${ACTION}`,
      injectedCalls: [
        { method: 'GET', urlTemplate: `${origin}/api/cases?ref={{input.ref}}`, headerNames: ['x-csrf-token'], idempotent: true },
        { method: 'GET', urlTemplate: `${origin}/api/badge`, headerNames: [], idempotent: true },
      ],
      // THE DEFECT, stored: the action answers with the call that has no hole at all.
      answersWith: { callIndex: 1, matchedBy: 'run-output-identity' },
      scriptedSteps: [],
      lessons: [],
      capturedCallsRef: CONSTANT_CAPTURE,
    }, {});

    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    const machine = daemonForFixture();
    setDaemonConnectionResolver(() => machine);
    const runsBefore = (await automationRuns.find({})).length;

    // THE ARGUMENT'S VALUE IS IRRELEVANT HERE, and deliberately so: the refusal is a fact about the
    // recipe's SHAPE - its answer-bearing call has no hole for `ref` at any value - decided before
    // anything is sent. The fixture page fetches `?ref=2024-1`, so passing that keeps the re-learn
    // in play and lets this case assert the SETTLE as well as the refusal.
    const result = await runTheAction({ ref: '2024-1' });

    // NOT REPLAYED, and nothing went out. Without the refusal both calls are made and the caller is
    // handed `{"unread":7}` as this action's answer, whatever they asked for.
    expect(result.success).toBe(true);
    expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
    expect(machine.injectFrames).toEqual([]);
    // THE ACTION RAN INSTEAD, so the caller's answer is still correct - only the optimisation is lost.
    expect((await automationRuns.find({})).length).toBe(runsBefore + 1);
    // THE CONSTANT-ANSWER RECIPE IS GONE. What is stored now is the one THIS pass learned: one call,
    // and no answer pointer (a browser-only automation answers nothing, so its replay must too).
    const now = (await recipes.getRecipe(actor.orgId, KEY, ACTION))!;
    expect(now.injectedCalls.map((c) => c.urlTemplate)).toEqual([`${origin}/api/cases?ref={{input.ref}}`]);
    expect(now.answersWith).toBeUndefined();
    expect(now.capturedCallsRef).not.toBe(CONSTANT_CAPTURE);
    // …AND SO IS ITS EVIDENCE. Nothing else could ever have reached it once the recipe naming it
    // was gone (`priorCaptureRef` reads the CURRENT recipe, which is now this pass's).
    expect(await captures.listCapture({
      orgId: actor.orgId, integrationKey: KEY, actionName: ACTION, captureId: CONSTANT_CAPTURE,
    })).toEqual([]);
  }, 60_000);
});

// =============================================================================================
// ACCEPTANCE: A LEARN THAT THE STORE REFUSES LEAVES NOTHING BEHIND - INCLUDING WHEN IT THROWS.
//
// THE DEFECT, and the shape of it is the lesson. The evidence collector handled every exit that
// RETURNED a verdict (`exists`, `notfound`) and none that THREW. `putRecipe`'s persistence-boundary
// proof (`assertCarriesNoValues`) THROWS by design - it refuses rather than redacts - and so does
// any store error. The throw propagates to the learn's caller, which logs a warning and reports the
// run as the success it was, so `if (!stored) discardEvidence(...)` never ran at all.
//
// AND IT REPEATS. The refusal is decided AT THE STORE from what the pass captured, so it is a
// property of the pass rather than a one-off: the recipe is never written, `priorCaptureRef` reads
// the CURRENT recipe and finds none, and every later run of the action writes a fresh pile of full
// redacted request AND response bodies. No TTL, no other index, the owner's DELETE route answers
// `evidenceDiscarded: 0` (there is no recipe to clear), and `listCaptureIds` has no production
// caller. Unbounded, forever, on an action that reports success every time.
//
// ENTERED AT `executeUserIntegrationAction` against the REAL stores, and the refusal is REAL - the
// fixture page fetches an ordinary page-state URL and the real `looksLikeLiteralSecret` refuses the
// real compiled template. Nothing here injects a failure.
// =============================================================================================
describe('ACCEPTANCE: a recipe write that THROWS takes the pass\'s evidence with it', () => {
  it('writes the evidence, is refused AT THE STORE, and leaves the capture collection empty - on every run', async () => {
    const appended = vi.spyOn(captures, 'appendCapturedCall');

    for (const run of [1, 2, 3]) {
      transport = resetAgentState({ oneShotText: RESOLVER_JSON });
      setDaemonConnectionResolver(() => daemonForFixture({ alsoFetchesPageState: true }));
      const before = appended.mock.calls.length;

      const result = await runTheAction();

      // THE RUN IS UNAFFECTED. Learning is a by-product and a refusal to learn must never turn a
      // run that WORKED into a failure - that posture is correct and is not what changed.
      expect(result.success).toBe(true);
      expect((result.data as { runId?: string }).runId).toBeTruthy();
      // The page really did make the page-state call, so the refusal below is about that call.
      expect(requests.some((r) => r.url.includes('/api/view?state='))).toBe(true);

      // THE EVIDENCE WAS WRITTEN - which is what makes "the collection is empty" a COLLECTION and
      // not an empty fixture. Both internal calls of this pass were appended, through the real store.
      expect(appended.mock.calls.length - before).toBeGreaterThanOrEqual(2);

      // THE RECIPE WAS REFUSED. Not stored, not partially stored: the store throws before it writes.
      expect(await recipes.getRecipe(actor.orgId, KEY, ACTION)).toBeNull();

      // ── THE PROPERTY ─────────────────────────────────────────────────────────────────────
      // Asserted over the WHOLE collection rather than one capture key, because the leak's shape is
      // a NEW captureId every run: keyed assertions would each be green while the pile grew. Against
      // the pre-fix code this reads 2, then 4, then 6 - which is why the run number rides along.
      expect({ run, orphans: (await integrationCapturedCalls.find({})).length }).toEqual({ run, orphans: 0 });
    }

    // ── THE CONTROL, in the same test and against the same stores ──────────────────────────
    //
    // Without it, everything above also holds for a build in which the learn writes no evidence at
    // all, or in which the page-state call is simply never captured. The identical action on the
    // identical fixture, with only that one page-state call removed, LEARNS - and its evidence is
    // still there afterwards, because that recipe landed.
    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    setDaemonConnectionResolver(() => daemonForFixture());
    expect((await runTheAction()).success).toBe(true);
    const learned = await recipes.getRecipe(actor.orgId, KEY, ACTION);
    expect(learned).not.toBeNull();
    expect(await captures.listCapture({
      orgId: actor.orgId, integrationKey: KEY, actionName: ACTION, captureId: learned!.capturedCallsRef!,
    })).not.toEqual([]);

    appended.mockRestore();
  }, 120_000);
});

// =============================================================================================
// ACCEPTANCE: THE FOURTH REMOVAL PATH - AN ORDINARY SAVE THAT RENAMES AN ACTION.
//
// `IntegrationDefinitionStore.create(..., onConflict: 'replace')` is the ordinary builder save and
// `achieve`'s in-place write. It re-attaches each stored recipe BY ACTION NAME
// (`carryRecipesForward`), so an action the incoming set no longer names loses its recipe - which is
// correct, the recipe describes that action and nothing else - and NOTHING collected the pile that
// recipe was the only index into. Renaming or removing an action is an ordinary edit, and an agent
// re-authoring an integration does it routinely.
//
// It is newly reachable BECAUSE of this slice: before it, `appendCapturedCall` had no production
// caller at all, so the collection was always empty and this path removed nothing.
//
// ENTERED AT `saveAuthoredDefinition` - the builder's own save function, not the store method - so
// the hop that actually performs this in production is the one under test.
// =============================================================================================
describe('ACCEPTANCE: a save that renames an action takes that action\'s evidence with it', () => {
  it('drops the orphaned recipe AND its capture, and leaves the surviving action\'s alone', async () => {
    // ── LEARN, for real, on both actions of the row. ────────────────────────────────────────
    setDaemonConnectionResolver(() => daemonForFixture());
    expect((await runTheAction()).success).toBe(true);
    const learned = (await recipes.getRecipe(actor.orgId, KEY, ACTION))!;
    const evidenceKey = {
      orgId: actor.orgId, integrationKey: KEY, actionName: ACTION, captureId: learned.capturedCallsRef!,
    };
    expect((await captures.listCapture(evidenceKey)).length).toBeGreaterThan(0);

    // A SECOND action on the SAME row that also learned, so the case can tell "collected what the
    // save dropped" from "wiped the row's captures". It is written through the real recipe store
    // and its evidence through the real captures store.
    const KEPT_CAPTURE = 'cap-kept-action';
    const keptKey = {
      orgId: actor.orgId, integrationKey: KEY, actionName: WRITE_ACTION, captureId: KEPT_CAPTURE,
    };
    await captures.appendCapturedCall(keptKey, 0, {
      method: 'GET', url: `${origin}/api/badge`, requestHeaderNames: ['accept'], responseBody: '{"unread":7}',
    });
    await recipes.putRecipe(actor.orgId, KEY, WRITE_ACTION, {
      goal: `replay of ${KEY}/${WRITE_ACTION}`,
      injectedCalls: [{ method: 'GET', urlTemplate: `${origin}/api/badge`, headerNames: [], idempotent: true }],
      scriptedSteps: [],
      lessons: [],
      capturedCallsRef: KEPT_CAPTURE,
    }, {});

    // ── THE ORDINARY EDIT: the author renames one action and re-saves the package. ──────────
    const row = definitionRow();
    const saved = await saveAuthoredDefinition(
      actor,
      {
        integrationKey: KEY,
        authType: 'none',
        configSchema: [],
        actions: row.actions.map((a) => (a.actionName === ACTION ? { ...a, actionName: 'listar_processos' } : a)),
      },
      row.skillMd!,
      definitions,
    );
    expect(saved.ok).toBe(true);

    // THE RECIPE IS GONE - the store's own documented behaviour, restated here as the premise of
    // the assertion that follows rather than as the thing being changed.
    expect(await recipes.getRecipe(actor.orgId, KEY, ACTION)).toBeNull();
    expect(await recipes.getRecipe(actor.orgId, KEY, 'listar_processos')).toBeNull();

    // ── THE PROPERTY: ITS EVIDENCE WENT WITH IT ────────────────────────────────────────────
    //
    // Nothing could ever have reached this pile again: `getRecipe` answers null so the owner's
    // DELETE route discards 0, `priorCaptureRef` reads a recipe that is absent, and the collection
    // has no TTL and no other index.
    expect(await captures.listCapture(evidenceKey)).toEqual([]);

    // …AND ONLY ITS OWN. The action the save kept still has its recipe and its capture, so this is
    // a collection of what was dropped and not a sweep of the row.
    expect(await recipes.getRecipe(actor.orgId, KEY, WRITE_ACTION)).not.toBeNull();
    expect((await captures.listCapture(keptKey)).length).toBe(1);
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

// =============================================================================================
// ACCEPTANCE: A MUTATING ACTION NEVER LEARNS A RECIPE THAT DOES NOT DO ITS JOB.
//
// This is the worst failure this spine can have and it is not exotic - it is what discovery does
// by default. The write action below is bound to the SAME automation as the read above and makes
// the SAME pass, so what the recorder sees underneath it is a JSON GET and nothing else: the write
// itself is a form post, or answers HTML, or carries a login-shaped body the compile drops. The
// read action learns that GET and is right to. The write action learning it would mean every later
// run replays a read, answers `ok`, and reports SUCCESS while nothing is submitted - and nobody
// finds out until somebody looks at the far system.
//
// ENTERED AT `executeUserIntegrationAction`, because the fact that decides it (`mutates`) is read
// off the resolved action there and has to cross the automation seam to matter. Every hop of that
// is production code here; a suite entering lower could not tell a carried field from a dropped one.
// =============================================================================================
describe('ACCEPTANCE: a recipe may not be a SUBSET of the action it belongs to', () => {
  /** The owner has approved this action's writes. So the ONLY thing standing between the pass and a
   *  stored read-only recipe is the coverage refusal - the approval does not open it, and must not:
   *  a human approved an ACTION, never a call set compiled afterwards from traffic nobody saw. */
  async function approveTheWrite(): Promise<void> {
    const row = await definitions.getForActor(actor, KEY);
    const action = row!.actions.find((a) => a.actionName === WRITE_ACTION)!;
    await approveAction({ orgId: actor.orgId, userId: actor.userId }, describeAction(KEY, action), 'always');
  }

  it('the WRITE action learns nothing from the pass the READ action learns everything from', async () => {
    await approveTheWrite();

    // ── THE READ. Same automation, same traffic: it learns, which is the control. ─────────────
    setDaemonConnectionResolver(() => daemonForFixture());
    expect((await runTheAction()).success).toBe(true);
    expect(await recipes.getRecipe(actor.orgId, KEY, ACTION)).not.toBeNull();

    // ── THE WRITE. Identical pass, one declared fact different, and nothing is written down. ──
    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    setDaemonConnectionResolver(() => daemonForFixture());
    const wrote = await runTheAction({ ref: '2024-1' }, WRITE_ACTION);
    expect(wrote.success).toBe(true);
    expect(await recipes.getRecipe(actor.orgId, KEY, WRITE_ACTION)).toBeNull();
  }, 60_000);

  // ===========================================================================================
  // …AND THE RECORDER IS NEVER ARMED FOR IT, WHICH IS A SECURITY PROPERTY AND NOT A SAVING.
  //
  // While a recorder is armed it holds the LIVE VALUE of every header the authenticated page sends
  // (`clients/bridge/src/browser/capture.ts` - the `live` map, which is what an injected replay
  // resolves names against). Arming it for an action whose recipe can NEVER be stored extends a
  // credential's residency on the user's machine, and ships a full pass's request and response
  // bodies across the wire, to reach a refusal that was decidable before the run began.
  //
  // The decision therefore has to be taken BEFORE the engine runs, and this is the only place that
  // can tell the difference: entered at `executeUserIntegrationAction`, so `mutates` is read off
  // the resolved action and crosses the real seam, and asserted on what the MACHINE was asked.
  // ===========================================================================================
  it('never arms the machine\'s recorder for the WRITE action, and does for the READ - decided before the run', async () => {
    await approveTheWrite();

    const readMachine = daemonForFixture();
    setDaemonConnectionResolver(() => readMachine);
    expect((await runTheAction()).success).toBe(true);
    // THE CONTROL, first: the identical automation on the identical fixture DOES arm. Without it
    // "no capture op" would also hold for a fixture that never receives one.
    expect(readMachine.captureOps).toContain('start');

    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    const writeMachine = daemonForFixture();
    setDaemonConnectionResolver(() => writeMachine);
    const wrote = await runTheAction({ ref: '2024-1' }, WRITE_ACTION);

    // THE PROPERTY: the machine was never asked to record anything at all.
    expect(writeMachine.captureOps).toEqual([]);
    // …and the action still ran, at full cost, correctly.
    expect(wrote.success).toBe(true);
    expect((wrote.data as { runId?: string }).runId).toBeTruthy();
  }, 60_000);

  it('a read-only recipe already on a writing action is REFUSED, cleared, and the action runs', async () => {
    await approveTheWrite();
    // An older build's recipe, or one written before the action was re-declared as writing. It is
    // planted through the real store, so what the replay reads is a real stored recipe.
    await recipes.putRecipe(actor.orgId, KEY, WRITE_ACTION, {
      goal: `replay of ${KEY}/${WRITE_ACTION}`,
      injectedCalls: [{
        method: 'GET',
        urlTemplate: `${origin}/api/cases?ref={{input.ref}}`,
        headerNames: ['x-csrf-token'],
        idempotent: true,
      }],
      scriptedSteps: [],
      lessons: [],
    }, {});
    expect(await recipes.getRecipe(actor.orgId, KEY, WRITE_ACTION)).not.toBeNull();

    transport = resetAgentState({ oneShotText: RESOLVER_JSON });
    const machine = daemonForFixture();
    setDaemonConnectionResolver(() => machine);
    const runsBefore = (await automationRuns.find({})).length;

    const result = await runTheAction({ ref: '2024-1' }, WRITE_ACTION);

    // NOT REPLAYED. The recipe was readable, its route was available, its write gate would have
    // opened (the owner assented) - and it still did not run, because it does not write.
    expect(result.success).toBe(true);
    expect((result.data as { replayed?: boolean }).replayed).toBeUndefined();
    expect(machine.injectFrames).toEqual([]);
    // THE ACTION RAN INSTEAD - which is the path that actually performs the write.
    expect((await automationRuns.find({})).length).toBe(runsBefore + 1);
    // …and the recipe that can never run is gone, so it costs no doomed attempt on the next run,
    // and the learn declines to write a replacement, so this settles.
    expect(await recipes.getRecipe(actor.orgId, KEY, WRITE_ACTION)).toBeNull();
  }, 60_000);
});
