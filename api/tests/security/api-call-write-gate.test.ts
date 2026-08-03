import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { approvedCommands } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { executeApiCallStep, apiCallConsentShape, apiCallStepMutates } from '../../src/automation/executors/api-call.js';
import { approveCommandShape } from '../../src/automation/consent.js';
import {
  setIntegrationCredentialLoader,
  setIntegrationOriginResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import type { Step, StepRecord, Automation } from '../../src/automation/types.js';
import type { RunContext } from '../../src/automation/engine.js';

/**
 * SECURITY SUITE - THE `api_call` WRITE RAIL.
 *
 * C2's gate is a property of the ACTION model. An `api_call` step reaches the same effect one step
 * type over: any HTTP method, any URL, the same integration credentials injected via
 * `authIntegrationKey` - and it is authored by the same planner that would have been refused at the
 * Action gate (and, until the same change, by the rehearsal fixer's `replace_current`, which is
 * driven by text and pixels coming off the remote page).
 *
 * The line is the METHOD: RFC 7231's safe set auto-runs, everything else needs a human. Proved
 * here by refusal PLUS the absence of a `fetch` PLUS the absence of a credential read - a gate that
 * merely fails after decrypting the secret has already lost half of what it is for.
 *
 * The approval is the automation tier's existing one (`approved_commands`), because that is the
 * store the engine's step-consent ceremony writes to when the user clicks "aprovar sempre"; see the
 * executor's module header for why C2's action store would have been a ban rather than a gate.
 */
const SECRET = ['sk', 'live', 'PROBE', Math.random().toString(36).slice(2, 10)].join('-');
const ORG = 'orgApi';
const OTHER_ORG = 'orgApiB';
const OWNER = 'owner-1';
const PEER = 'peer-1';

let mem: MongoMemoryServer;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let credentialReads: string[] = [];

const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  ownerUserId: OWNER,
  orgId: ORG,
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
  ...over,
} as RunContext);

const baseRecord = (): StepRecord =>
  ({ stepId: 's1', index: 0, description: 'call', status: 'running', tier: 'cache', durationMs: 0 } as unknown as StepRecord);

function makeFinish() {
  const captured: { status?: string; error?: { message?: string; recoverable?: boolean; details?: unknown }; output?: unknown } = {};
  const finishRecord = (base: StepRecord, status: StepRecord['status'], _s: number, extras: { error?: unknown; output?: unknown }): StepRecord => {
    captured.status = status;
    captured.error = extras.error as { message?: string; recoverable?: boolean; details?: unknown } | undefined;
    captured.output = extras.output;
    return { ...base, status } as StepRecord;
  };
  return { finishRecord, captured };
}

type Spec = Record<string, unknown>;

async function runApiCall(spec: Spec, over: Partial<RunContext> = {}) {
  const step = { id: 's1', description: 'call', type: 'api_call', apiRequest: spec } as unknown as Step;
  const { finishRecord, captured } = makeFinish();
  await executeApiCallStep({
    step,
    index: 0,
    runId: 'r1',
    automation: { id: 'a1', name: 'A', steps: [] } as unknown as Automation,
    ctx: ctx(over),
    inputs: {},
    baseRecord: baseRecord(),
    stepStart: 0,
    finishRecord,
  });
  return captured;
}

const WRITE: Spec = {
  method: 'POST',
  url: 'https://api.example.com/messages',
  headers: { Authorization: 'Bearer {{integration.slack.token}}' },
  body: '{"channel":"general"}',
  bodyKind: 'json',
  authIntegrationKey: 'slack',
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_api_call_write_gate');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await approvedCommands.deleteMany({});
  credentialReads = [];
  setIntegrationCredentialLoader(async (key) => {
    credentialReads.push(key);
    return { token: SECRET };
  });
  setIntegrationOriginResolver(async () => ['api.example.com']);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  fetchSpy.mockRestore();
  __resetAutomationSeamsForTests();
});

/** Approve exactly the shape the gate will compute for this spec - the durable "sempre" answer. */
const approveFor = (spec: Spec, who = OWNER, org = ORG) =>
  approveCommandShape({ userId: who, orgId: org, pairingId: null }, apiCallConsentShape(spec as never));

// ---------------------------------------------------------------------------
// The method line
// ---------------------------------------------------------------------------

describe('api_call mutation derivation - the safe-method line', () => {
  it('GET / HEAD / OPTIONS are reads; every other method is a write', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get', 'head']) expect([m, apiCallStepMutates(m)]).toEqual([m, false]);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) expect([m, apiCallStepMutates(m)]).toEqual([m, true]);
  });

  it('fails closed on an absent or unrecognised method', () => {
    for (const m of [undefined, '', 'FROB', 'GET ']) expect([m, apiCallStepMutates(m as string)]).toEqual([m, true]);
  });
});

// ---------------------------------------------------------------------------
// The gate on the wire
// ---------------------------------------------------------------------------

describe('api_call write gate', () => {
  it('REFUSES an unapproved POST - no request, and NO CREDENTIAL READ', async () => {
    const captured = await runApiCall(WRITE);
    expect(captured.status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
    // The gate sits before the credential loader on purpose: an unapproved write must not cause a
    // secret to be decrypted, let alone interpolated into a URL.
    expect(credentialReads).toEqual([]);
    // NON-RECOVERABLE, so `shouldAttemptFix` refuses it and the self-heal fixer is never invited to
    // "repair" the refusal by rewriting the step it just refused.
    expect(captured.error?.recoverable).toBe(false);
    const details = captured.error?.details as Record<string, unknown>;
    expect(details.kind).toBe('awaiting_consent');
    expect(String(details.shape)).toMatch(/^api_call:[0-9a-f]{64}$/);
    expect(details.argv).toEqual(['POST', 'https://api.example.com/messages']);
    expect(String(details.description)).toContain('slack');
  });

  it('for each non-idempotent method: refused, no request', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const captured = await runApiCall({ ...WRITE, method });
      expect([method, captured.status]).toEqual([method, 'failed']);
      expect([method, (captured.error?.details as Record<string, unknown>).kind]).toEqual([method, 'awaiting_consent']);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a GET still auto-runs with no approval anywhere (Rule 7 - existing automations untouched)', async () => {
    const captured = await runApiCall({ ...WRITE, method: 'GET', body: undefined });
    expect(captured.status).toBe('completed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(credentialReads).toEqual(['slack']);
    expect(await approvedCommands.find({})).toEqual([]); // no store was consulted or written
  });

  it('a durable "aprovar sempre" lets the write through', async () => {
    await approveFor(WRITE);
    const captured = await runApiCall(WRITE);
    expect(captured.status).toBe('completed');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a run-scoped "aprovar uma vez" lets the write through for THIS run only', async () => {
    const shape = apiCallConsentShape(WRITE as never);
    const once = new Set<string>([shape]);
    const captured = await runApiCall(WRITE, {
      runApprovedShapes: { has: (s: string) => once.has(s), add: (s: string) => void once.add(s) },
    });
    expect(captured.status).toBe('completed');
    // Nothing persisted: a second run with a fresh (empty) run scope asks again.
    expect(await approvedCommands.find({})).toEqual([]);
    const second = await runApiCall(WRITE);
    expect(second.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Non-transferability: one component of the key changed per case
// ---------------------------------------------------------------------------

describe('api_call write gate - an approval is not transferable', () => {
  beforeEach(async () => {
    await approveFor(WRITE);
  });

  it('control: the exact shape, user and org RUNS', async () => {
    expect((await runApiCall(WRITE)).status).toBe('completed');
  });

  it('CROSS-USER: a colleague is refused', async () => {
    expect((await runApiCall(WRITE, { ownerUserId: PEER })).status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('CROSS-ORG: the same user in another tenant is refused', async () => {
    expect((await runApiCall(WRITE, { orgId: OTHER_ORG })).status).toBe('failed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('SHAPE DRIFT: the URL, the body, a header, the method or the credential - any one re-prompts', async () => {
    const drifts: Array<[string, Spec]> = [
      ['url', { ...WRITE, url: 'https://api.example.com/messages/all' }],
      ['body', { ...WRITE, body: '{"channel":"*"}' }],
      ['header', { ...WRITE, headers: { Authorization: 'Bearer {{integration.slack.token}}', 'X-Admin': '1' } }],
      ['method', { ...WRITE, method: 'DELETE' }],
      ['credential', { ...WRITE, authIntegrationKey: 'stripe' }],
      ['bodyKind', { ...WRITE, bodyKind: 'text' }],
    ];
    for (const [what, spec] of drifts) {
      const captured = await runApiCall(spec);
      expect([what, captured.status]).toEqual([what, 'failed']);
      expect([what, (captured.error?.details as Record<string, unknown>).kind]).toEqual([what, 'awaiting_consent']);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('header ORDER and CASE are not drift (a Mongo round trip must not re-prompt spuriously)', async () => {
    const reordered: Spec = {
      ...WRITE,
      headers: { authorization: 'Bearer {{integration.slack.token}}' },
    };
    expect(apiCallConsentShape(reordered as never)).toBe(apiCallConsentShape(WRITE as never));
  });
});
