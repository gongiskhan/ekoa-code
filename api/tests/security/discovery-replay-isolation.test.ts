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

function definition(actor: Actor, opts: { posture?: 'permissive' | 'adversarial' } = {}): IntegrationDefinitionCreate {
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
      httpConfig: { baseUrl: 'https://portal.example', path: '/api/cases', method: 'GET' },
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
      { orgId: 'orgB', ownerUserId: userB.userId, integrationKey: KEY, actionName: ACTION, args: {} },
      replayDeps,
    );
    expect(owner.outcome).toBe('ok');

    const foreign = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {} },
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
      { orgId: 'orgB', ownerUserId: userB.userId, integrationKey: KEY, actionName: ACTION, args: {} },
      noSession,
    );
    // Org B's own declaration lets it leave from the server (the call itself then fails on the
    // network in a unit environment; what matters is that posture did not refuse it).
    expect(permissive.outcome).not.toBe('unavailable');

    const closed = await replayIntegrationAction(
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {} },
      noSession,
    );
    expect(closed.outcome).toBe('unavailable');
    expect((closed as { reason: string }).reason).toContain('adversarial');
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
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {} },
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
      { orgId: 'orgA', ownerUserId: userA.userId, integrationKey: KEY, actionName: ACTION, args: {} },
      noSession,
    );
    expect(result.outcome).not.toBe('unavailable');
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
