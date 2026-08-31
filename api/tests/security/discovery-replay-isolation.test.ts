/**
 * THE NEW READ AND WRITE PATHS of the discovery spine, against the tenancy boundary (Rule 5).
 *
 * `captured-calls-isolation.test.ts` attacks the two STORES. This suite attacks what P2 put IN
 * FRONT of them - the paths that now reach a recipe on a hot code path, where a mistake is not a
 * store bug but a wiring bug:
 *
 *   - `replayIntegrationAction`, mounted inside `runAutomationForAction`, so it runs on every
 *     automation-backed action of every tenant;
 *   - `healDriftedRecipe`, which supersedes one.
 *
 * THE SHARPEST SURFACE HERE IS NOT THE RECIPE ITSELF. It is the ORIGIN POSTURE the replay resolves
 * on the way: posture decides whether a call may leave from the server with no cookie jar, and it
 * is read off a DEFINITION. A replay that resolved that definition as anything other than the
 * running tenant would let one org's `permissive` declaration authorise another org's egress. So
 * the posture read is attacked as its own case, twice: across the tenant boundary, and across the
 * ORIGIN boundary inside one tenant - because the first version of the mount resolved posture from
 * the recipe's FIRST call and then applied that verdict to every later call, whatever host it went
 * to.
 *
 * Every negative is paired with the owner-side positive on the same row in the same test, so a
 * refusal is the gate firing rather than an empty database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationDefinitions, integrationCapturedCalls } from '../../src/data/stores.js';
import {
  IntegrationDefinitionStore,
  type IntegrationDefinitionCreate,
} from '../../src/integrations/definition-store.js';
import { IntegrationRecipeStore, type RecipeDraft } from '../../src/integrations/recipe-store.js';
import { replayIntegrationAction } from '../../src/automation/replay-action.js';
import { healDriftedRecipe } from '../../src/automation/self-heal.js';
import type { BrowserSession } from '../../src/automation/browser-session.js';

let mem: MongoMemoryServer;
let clock = 0;

const userA: Actor = { userId: 'userA', orgId: 'orgA', role: 'user' };
const userB: Actor = { userId: 'userB', orgId: 'orgB', role: 'user' };

const definitions = new IntegrationDefinitionStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));
const recipes = new IntegrationRecipeStore(integrationDefinitions, () => new Date(1_700_000_000_000 + clock++));

const KEY = 'portal';
const ACTION = 'list_cases';

function definition(
  actor: Actor,
  opts: { posture?: 'permissive' | 'adversarial'; withHttpConfig?: boolean } = {},
): IntegrationDefinitionCreate {
  return {
    orgId: actor.orgId,
    userId: actor.userId,
    key: KEY,
    visibility: 'org',
    configSchema: [],
    actions: [{
      actionName: ACTION,
      description: 'lista',
      mutates: false,
      ...(opts.posture ? { posture: opts.posture } : {}),
      // A BROWSER-STEPS action has none - it is bound to an automation, not to an HTTP endpoint,
      // and every minted cornerstone action is this shape. Default keeps the existing fixtures.
      ...(opts.withHttpConfig === false
        ? {}
        : { httpConfig: { baseUrl: 'https://portal.example', path: '/api/cases', method: 'GET' } }),
    }],
    skillMd: `# ${KEY}\n`,
  };
}

const recipeDraft: RecipeDraft = {
  goal: 'replay of portal/list_cases',
  injectedCalls: [{
    method: 'GET',
    urlTemplate: 'https://portal.example/api/cases',
    headerNames: ['x-csrf-token'],
    expectShape: { kind: 'object', keys: { items: { kind: 'array' } } },
    idempotent: true,
  }],
  scriptedSteps: [],
  lessons: ['the session rides x-csrf-token'],
};

/** The same recipe, plus a SECOND call to a host the action's declaration says nothing about. */
const twoOriginDraft: RecipeDraft = {
  ...recipeDraft,
  injectedCalls: [
    ...recipeDraft.injectedCalls,
    { method: 'GET', urlTemplate: 'https://cdn.other.example/api/docs', headerNames: [], idempotent: true },
  ],
};

/** A session whose injected call always succeeds, so the only thing that can stop a replay is the
 *  tenancy gate or the posture gate - never the transport. */
/** A session whose in-page call is REFUSED by the portal - the shape a signed-out replay meets. */
function refusingSession(status: number): BrowserSession {
  return {
    ...(workingSession() as unknown as Record<string, unknown>),
    injectCall: async () => ({ status, ok: false, bodyText: '{"error":"sessao necessaria"}', responseHeaderNames: [] }),
  } as unknown as BrowserSession;
}

function workingSession(): BrowserSession {
  return {
    act: async () => undefined,
    assert: async () => true as const,
    observe: async () => undefined,
    ensureObserved: async () => undefined,
    hasObservation: () => true,
    screenshotPng: () => Buffer.from('png'),
    screenshotB64: () => 'cG5n',
    url: () => 'https://portal.example/',
    fingerprint: () => ({ origin: 'https://portal.example', pathname: '/', pathSuffix: '', titleHash: 'h', headingHash: 'h', domShapeHash: 'h', viewport: { w: 1, h: 1 } }),
    accessibilitySnapshot: () => undefined,
    injectCall: async () => ({ status: 200, ok: true, bodyText: '{"items":[]}', responseHeaderNames: [] }),
  } as unknown as BrowserSession;
}

const replayDeps = {
  loadRecipe: (orgId: string, key: string, actionName: string) => recipes.getRecipe(orgId, key, actionName),
  openSession: async () => ({ browser: workingSession(), close: async () => undefined }),
};

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_security_discovery_replay_isolation');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 0;
  await integrationDefinitions.deleteMany({});
  await integrationCapturedCalls.deleteMany({});
});

const createRow = (input: IntegrationDefinitionCreate) =>
  definitions.create(input, { actor: { userId: input.userId, orgId: input.orgId, role: 'user' } });

describe('replay: one org\'s learning never runs for another', () => {
  it('org A gets no-recipe for the same integration+action org B has learned', async () => {
    await createRow(definition(userB, { posture: 'permissive' }));
    await createRow(definition(userA, { posture: 'permissive' }));
    expect((await recipes.putRecipe('orgB', KEY, ACTION, recipeDraft)).verdict).toBe('ok');

    // OWNER SIDE FIRST: org B replays it, so the refusal below is the gate and not an empty store.
    const owner = await replayIntegrationAction(
      { orgId: 'orgB', ownerUserId: userB.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      replayDeps,
    );
    expect(owner.outcome).toBe('ok');

    const foreign = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      replayDeps,
    );
    expect(foreign.outcome).toBe('no-recipe');
  });

  it('does NOT inherit another org\'s permissive posture - the closed default stands per tenant', async () => {
    // Org B declares the origin permissive; org A declares nothing. Both have a recipe of their own,
    // so the ONLY difference between the two replays is whose posture declaration applies.
    await createRow(definition(userB, { posture: 'permissive' }));
    await createRow(definition(userA));
    await recipes.putRecipe('orgB', KEY, ACTION, recipeDraft);
    await recipes.putRecipe('orgA', KEY, ACTION, recipeDraft);

    // No session at all: the server-side rung is the only one available, and posture is what
    // decides whether it may be taken.
    const noSession = { ...replayDeps, openSession: async () => null };
    const permissive = await replayIntegrationAction(
      { orgId: 'orgB', ownerUserId: userB.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      noSession,
    );
    // Org B's own declaration lets it leave from the server (the call itself then fails on the
    // network in a unit environment; what matters is that posture did not refuse it).
    // ITS OWN DECLARATION LETS IT LEAVE FROM THE SERVER, and the assertion says exactly which rung
    // ran rather than merely "not refused": the node-http rung was taken and the request was
    // actually attempted (`portal.example` is a reserved TLD, so it fails at DNS - which is proof
    // the call left the posture gate, not proof of anything about the network).
    // A bare `not.toBe('unavailable')` here would also have been satisfied by `no-recipe` - i.e. by
    // any mutation that broke the recipe read - which is no evidence about posture at all.
    expect(permissive.outcome).toBe('drift');
    expect((permissive as { reason: string }).reason).toContain('could not be made');

    const closed = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      noSession,
    );
    expect(closed.outcome).toBe('unavailable');
    expect((closed as { reason: string }).reason).toContain('adversarial');
  });
});

/**
 * THE REPLAY'S OWN SESSION - the leg that made a missing cookie look like a moved website.
 *
 * A replay mints its own execution id (`replay-<uuid>`), and the daemon holds delivered sessions
 * keyed by runId - so the authored run's delivery, made under a different id, was never found and
 * the replay drove a signed-out jar. `replayCompiledAction` cannot tell a browser LEASE from an
 * authenticated one, so it issued the call anyway, took the portal's 401, and superseded the recipe
 * as DRIFT. Observed live 2026-08-31 against a fixture that had not changed, on every run.
 */
describe('replay: the session the recipe needs travels with it', () => {
  it('checks out the stored session for the recipe origin and hands it to the browser', async () => {
    await createRow(definition(userA));
    await recipes.putRecipe('orgA', KEY, ACTION, recipeDraft);

    let handed: unknown = 'not-called';
    const resolved = { cookies: [{ name: 'sid', value: 'v', domain: 'portal.example' }] };
    await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      {
        ...replayDeps,
        // The origin comes off the recipe's own compiled call, which for a browser-steps action is
        // the only statement of where it goes.
        resolveSession: async (_input, origin) => (origin === 'https://portal.example' ? resolved : null),
        openSession: async (_input, sessionState) => {
          handed = sessionState;
          return { browser: workingSession(), close: async () => undefined };
        },
      },
    );
    expect(handed).toEqual(resolved);
  });

  it("reads the origin off the recipe's OWN calls when the action declares no baseUrl", async () => {
    // THE BROWSER-STEPS SHAPE, which is the only shape a minted cornerstone action has - and the
    // one the first version of this code got wrong by reading the wire projection's `calls` instead
    // of the stored `injectedCalls`. The suite passed anyway because every other fixture here
    // declares an `httpConfig.baseUrl`, so the fallback branch was never taken. Live, it was the
    // only branch: no origin was resolved, no session was looked up, and the replay ran signed out.
    await createRow(definition(userA, { withHttpConfig: false }));
    await recipes.putRecipe('orgA', KEY, ACTION, recipeDraft);

    const seen: string[] = [];
    await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      {
        ...replayDeps,
        resolveSession: async (_input, origin) => {
          seen.push(origin);
          return { cookies: [] };
        },
      },
    );
    expect(seen).toEqual(['https://portal.example']);
  });

  it('reads a 401 with NO delivered session as unavailable, never as drift', async () => {
    // The recipe must SURVIVE a credential problem. Superseding on a 401 destroyed a correct
    // compile - and repeating it every run consumed the heal budget until the recipe was cleared.
    await createRow(definition(userA));
    await recipes.putRecipe('orgA', KEY, ACTION, recipeDraft);

    const res = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      {
        ...replayDeps,
        resolveSession: async () => null,
        openSession: async () => ({ browser: refusingSession(401), close: async () => undefined }),
      },
    );
    expect(res.outcome).toBe('unavailable');
    expect((res as { reason: string }).reason).toContain('no stored session was delivered');
    // Untouched: still v1, so the next authored run re-authenticates and the recipe still applies.
    expect((await recipes.getRecipe('orgA', KEY, ACTION) as { version: number }).version).toBe(1);
  });

  it('still reads a 401 as DRIFT once a session WAS delivered - then the site really did change', async () => {
    await createRow(definition(userA));
    await recipes.putRecipe('orgA', KEY, ACTION, recipeDraft);

    const res = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      {
        ...replayDeps,
        resolveSession: async () => ({ cookies: [{ name: 'sid', value: 'v', domain: 'portal.example' }] }),
        openSession: async () => ({ browser: refusingSession(401), close: async () => undefined }),
      },
    );
    expect(res.outcome).toBe('drift');
  });

});

describe('replay: posture does not travel from one origin to the next', () => {
  it('a permissive first hop does not authorise server-side egress to a second host', async () => {
    // ONE tenant, ONE declaration, TWO hosts. The first call is to the origin the action declares
    // permissive; the second is somewhere the author never classified. A verdict resolved from the
    // first call and reused for the list authorises an egress nobody asked for.
    await createRow(definition(userA, { posture: 'permissive' }));
    await recipes.putRecipe('orgA', KEY, ACTION, twoOriginDraft);
    const noSession = { ...replayDeps, openSession: async () => null };

    const result = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      noSession,
    );
    expect(result.outcome).toBe('unavailable');
    expect((result as { reason: string }).reason).toContain('cdn.other.example');
  });

  it('…and the single-origin recipe in the SAME tenant still leaves, so the refusal is about the host', async () => {
    await createRow(definition(userA, { posture: 'permissive' }));
    await recipes.putRecipe('orgA', KEY, ACTION, recipeDraft);
    const noSession = { ...replayDeps, openSession: async () => null };

    const result = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {}, mutates: false },
      noSession,
    );
    // Same precision as above: the single-origin recipe in this tenant genuinely TOOK the
    // server-side rung, so the refusal in the case above is about the HOST and not about the org.
    expect(result.outcome).toBe('drift');
    expect((result as { reason: string }).reason).toContain('could not be made');
  });
});

describe('self-heal: the supersede stays in-tenant and touches nothing else', () => {
  it('bumps the version in org A and leaves org B\'s row and org A\'s visibility untouched', async () => {
    await createRow(definition(userA));
    await createRow(definition(userB));
    await recipes.putRecipe('orgA', KEY, ACTION, recipeDraft);
    await recipes.putRecipe('orgB', KEY, ACTION, recipeDraft);

    const before = await definitions.getForActor(userA, KEY);
    const healed = await healDriftedRecipe(
      {
        orgId: 'orgA',
        integrationKey: KEY,
        actionName: ACTION,
        reason: 'response.items disappeared',
      },
      { ...recipeDraft, lessons: ['the endpoint moved to /api/v2/cases'] },
      {
        supersedeRecipe: (orgId, key, actionName, next, opts) => recipes.supersedeRecipe(orgId, key, actionName, next, opts ?? {}),
      },
    );

    expect(healed).toEqual({ outcome: 'healed', version: 2, supersededVersion: 1 });
    expect((await recipes.getRecipe('orgA', KEY, ACTION))?.supersedes).toEqual({ version: 1, reason: 'response.items disappeared' });
    // Org B is at v1 still: a heal in one tenant is invisible in the other.
    expect((await recipes.getRecipe('orgB', KEY, ACTION))?.version).toBe(1);

    // NOT A PUBLICATION. `publishSnapshot` would have moved the row to `global` and stamped a
    // snapshot; a heal must be indistinguishable from "the action learned something" on every other
    // axis of the row.
    const after = await definitions.getForActor(userA, KEY);
    expect(after?.visibility).toBe(before?.visibility);
    expect(after?.publishedSnapshot).toBeUndefined();
    expect(after?.publishRequest).toBeUndefined();
  });

  it('a heal aimed at an org with no recipe supersedes nothing, in either tenant', async () => {
    await createRow(definition(userA));
    await createRow(definition(userB));
    await recipes.putRecipe('orgB', KEY, ACTION, recipeDraft);

    const refused = await healDriftedRecipe(
      { orgId: 'orgA', integrationKey: KEY, actionName: ACTION, reason: 'drifted' },
      recipeDraft,
      { supersedeRecipe: (o, k, a, n, opts) => recipes.supersedeRecipe(o, k, a, n, opts ?? {}) },
    );
    expect(refused.outcome).toBe('refused');
    // Org B's recipe is untouched: a heal keyed on the wrong org must not reach across.
    expect((await recipes.getRecipe('orgB', KEY, ACTION))?.version).toBe(1);
  });
});
