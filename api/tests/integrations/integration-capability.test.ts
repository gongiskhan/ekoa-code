import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, integrationDefinitions, approvedIntegrationActions } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
import {
  capabilityWireOutcome,
  executeIntegrationCapabilityAction,
  getIntegrationCapability,
  type CapabilityContext,
  type CapabilityOutcome,
} from '../../src/integrations/integration-capability.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import type { ExecuteIntegrationActionResult } from '../../src/integrations/action-executor.js';
import { integrationsEndpoints } from '@ekoa/shared';

/**
 * Slice D1 — the capability CORE (`integrations/integration-capability.ts`), at the module level.
 *
 * WHAT THIS SUITE IS FOR, and what it deliberately leaves to its siblings:
 *
 *  1. THE WRITE GATE IS INHERITED, PROVED BEHAVIOURALLY. The capability execute is driven with a
 *     SPY as the automation seam: an unapproved `mutates` action must come back `awaiting_consent`
 *     with the spy NEVER called, and the same call after a real approval must reach it exactly
 *     once. That is the difference between "the gate is in the executor" and "the capability rail
 *     forgot to ask", and it cannot be satisfied by a route stub.
 *  2. AND STATICALLY. The module must call `executeUserIntegrationAction` and must NOT contain the
 *     gate itself — a future change that "optimises" the rail by inlining the consent check would
 *     make this rail's behaviour independent of the executor's, which is the exact drift C2's own
 *     static guard exists to prevent one file over.
 *  3. FAIL CLOSED ON A MISSING TENANT (the standing A2/A3/B2 precedent), on BOTH operations.
 *  4. The PROJECTION reveals no authorship for a cross-org `global` row.
 *
 * The HTTP statuses, the error envelopes and the admission classes are the contract suite's
 * (`tests/contract/integrations-capability.test.ts`); cross-tenant blindness is the security
 * suite's (`tests/security/integration-capability-isolation.test.ts`).
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

// The probe integration's own identifier. Deliberately NOT held in a constant whose name reads as a
// credential: the secret scanner flags a hyphenated literal assigned to an identifier called `KEY`,
// and the right answer to that is to stop naming an integration identifier like a secret, not to
// teach the scanner an exception.
const PROBE_INTEGRATION = 'd1-capability-probe';
const HOST = 'https://caps.example';

const actor = (userId: string, orgId: string) => ({ userId, orgId, role: 'user' as const });

/**
 * Narrow a capability outcome to its value. A cast would have done the same job silently; this
 * THROWS on a refusal, so a test that was meant to exercise the happy path fails saying which
 * refusal it hit instead of reading `undefined` off a lie.
 */
function valueOf<T>(out: CapabilityOutcome<T>): T {
  if (!out.ok) throw new Error(`expected an admitted outcome, got refusal: ${out.refusal}`);
  return out.value;
}

/** A context with a SPY automation seam, so "did the action actually run" is observable. */
function ctxWithSpy(userId: string, orgId: string): { ctx: CapabilityContext; calls: unknown[] } {
  const calls: unknown[] = [];
  const ctx: CapabilityContext = {
    actor: actor(userId, orgId),
    deps,
    username: userId,
    runAutomationBackedAction: async (input) => {
      calls.push(input);
      return { success: true, data: { ran: true } };
    },
  };
  return { ctx, calls };
}

const boundWrite: IntegrationAction = {
  actionName: 'submeter_peca',
  description: 'Submete uma peça processual',
  mutates: true,
  automationBinding: { automationId: 'auto-1', automationTemplate: 'submissao', passCredentials: false },
};
const boundRead: IntegrationAction = {
  actionName: 'consultar',
  description: 'Consulta o estado',
  mutates: false,
  automationBinding: { automationId: 'auto-2', automationTemplate: 'consulta', passCredentials: false },
};
const httpWrite: IntegrationAction = {
  actionName: 'send_message',
  description: 'Enviar mensagem',
  mutates: true,
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/messages' },
};

async function seed(
  key: string,
  actions: IntegrationAction[],
  opts: { orgId?: string; userId?: string; visibility?: 'private' | 'org' | 'global'; authType?: string } = {},
): Promise<void> {
  const orgId = opts.orgId ?? 'orgA';
  const userId = opts.userId ?? 'ownerA';
  await integrationDefinitionStore.create(
    {
      orgId,
      userId,
      visibility: opts.visibility ?? 'private',
      key,
      displayName: 'D1 Capability Probe',
      configSchema: [],
      actions,
      skillMd: '# probe',
      authType: opts.authType ?? 'none',
    },
    {
      actor: { userId, orgId, role: opts.visibility === 'global' ? 'super-admin' : 'user' },
      onConflict: 'replace',
    },
  );
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_d1_capability_core');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [integrationDefinitions, integrationConfigs, approvedIntegrationActions]) await s.deleteMany({});
});

// ---------------------------------------------------------------------------------------------
// 1. The write gate, inherited
// ---------------------------------------------------------------------------------------------

describe('the capability execute INHERITS the executor write gate', () => {
  it('an unapproved mutating action answers awaiting_consent and the action NEVER runs', async () => {
    await seed(PROBE_INTEGRATION, [boundRead, boundWrite]);
    const { ctx, calls } = ctxWithSpy('ownerA', 'orgA');

    const out = await executeIntegrationCapabilityAction(ctx, PROBE_INTEGRATION, 'submeter_peca', {});
    expect(out.ok).toBe(true);
    const result = valueOf(out);
    expect(result.success).toBe(false);
    expect(result.code).toBe('awaiting_consent');
    // The descriptor a human must be shown rides with the refusal — an agent that cannot reach a
    // human still has something to hand the user.
    expect(result.consentRequest?.actionName).toBe('submeter_peca');
    expect(result.consentRequest?.integrationKey).toBe(PROBE_INTEGRATION);
    // THE LOAD-BEARING ASSERTION: nothing ran.
    expect(calls).toHaveLength(0);
  });

  it('the SAME call runs exactly once after a real approval of that exact shape', async () => {
    await seed(PROBE_INTEGRATION, [boundRead, boundWrite]);
    const { ctx, calls } = ctxWithSpy('ownerA', 'orgA');
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, boundWrite), 'always');

    const out = await executeIntegrationCapabilityAction(ctx, PROBE_INTEGRATION, 'submeter_peca', { numero: '123' });
    const result = valueOf(out);
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect((calls[0] as { args: Record<string, unknown> }).args).toEqual({ numero: '123' });
  });

  it('an approval granted to ANOTHER user does not let this one through (the key is not the rail)', async () => {
    await seed(PROBE_INTEGRATION, [boundWrite], { visibility: 'org' });
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, boundWrite), 'always');
    const { ctx, calls } = ctxWithSpy('peerA', 'orgA');

    const result = valueOf(await executeIntegrationCapabilityAction(ctx, PROBE_INTEGRATION, 'submeter_peca', {}));
    expect(result.code).toBe('awaiting_consent');
    expect(calls).toHaveLength(0);
  });

  it('a mutates:false action runs with no approval at all (Rule 7: a read gains no prompt)', async () => {
    await seed(PROBE_INTEGRATION, [boundRead, boundWrite]);
    const { ctx, calls } = ctxWithSpy('ownerA', 'orgA');

    const result = valueOf(await executeIntegrationCapabilityAction(ctx, PROBE_INTEGRATION, 'consultar', {}));
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('the refusal ORDER is the executor\'s: an unapproved write on an UNCONNECTED integration is awaiting_consent, not not_connected', async () => {
    // C2 placed the gate before `findConfigForOwner` on purpose, so the gate cannot be probed for
    // connection state by a caller who has not been approved. A pre-check in the capability module
    // would silently re-order that for this rail alone.
    await seed(PROBE_INTEGRATION, [httpWrite], { authType: 'api_key' });
    const { ctx } = ctxWithSpy('ownerA', 'orgA');
    const result = valueOf(await executeIntegrationCapabilityAction(ctx, PROBE_INTEGRATION, 'send_message', {}));
    expect(result.code).toBe('awaiting_consent');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The static guard — the gate cannot migrate onto this rail
// ---------------------------------------------------------------------------------------------

describe('static: the capability rail routes through the gated executor and owns no gate of its own', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  /**
   * CODE, not prose. Both files DISCUSS the gate at length in their docblocks — that documentation
   * is the point, and a guard that could be satisfied by deleting a comment (or defeated by writing
   * one) would be measuring the wrong thing. Block comments go entirely; only WHOLE-LINE `//`
   * comments are dropped, so a mid-line string literal can never be truncated by this.
   */
  const codeOnly = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');

  const capabilitySrc = codeOnly(readFileSync(join(here, '..', '..', 'src', 'integrations', 'integration-capability.ts'), 'utf-8'));
  const routesSrc = codeOnly(readFileSync(join(here, '..', '..', 'src', 'routes', 'integrations.ts'), 'utf-8'));

  it('it CALLS executeUserIntegrationAction — the one funnel every rail goes through', () => {
    expect(capabilitySrc.split('executeUserIntegrationAction(').length - 1).toBe(1);
  });

  it('it never contains the gate, and never grants an approval', () => {
    // A copy of the check here would make this rail's behaviour independent of the executor's.
    expect(capabilitySrc).not.toContain('checkActionConsent');
    // Granting is `POST …/approval`, `auth:'user'`. A capability module that could bank an approval
    // would let the key-admitted caller answer its own prompt whatever the descriptor says.
    expect(capabilitySrc).not.toContain('approveAction');
  });

  it('the ROUTE layer does not execute actions itself — it calls the capability module', () => {
    expect(routesSrc).not.toContain('executeUserIntegrationAction');
    expect(routesSrc).not.toContain('checkActionConsent');
    expect(routesSrc).toContain('executeIntegrationCapabilityAction(');
  });

  it('the capability routes mount requireUserOrApiKey and the consent routes do NOT', () => {
    // Positional admission is what this file's two-tier layout depends on, so the two facts are
    // pinned in the source as well as probed over HTTP by the contract suite.
    expect(routesSrc).toContain("r.get('/:key', requireUserOrApiKey");
    expect(routesSrc).toContain("r.post('/:key/actions/:actionName/execute', requireUserOrApiKey");
    expect(routesSrc).toContain("r.get('/', requireUserOrApiKey");
    expect(routesSrc).not.toContain("approval', requireUserOrApiKey");
  });
});

describe('descriptors: the capability classes, and the ones C2 deliberately kept off the key surface', () => {
  it('get/execute/list are user-or-key', () => {
    expect(integrationsEndpoints.getIntegration.auth).toBe('user-or-key');
    expect(integrationsEndpoints.executeAction.auth).toBe('user-or-key');
    expect(integrationsEndpoints.list.auth).toBe('user-or-key');
    expect(integrationsEndpoints.getIntegration.path).toBe('/api/v1/integrations/:key');
    expect(integrationsEndpoints.executeAction.path).toBe('/api/v1/integrations/:key/actions/:actionName/execute');
  });

  it('all three CONSENT descriptors stay `user` — a key can never answer its own prompt', () => {
    expect(integrationsEndpoints.approveAction.auth).toBe('user');
    expect(integrationsEndpoints.revokeActionApproval.auth).toBe('user');
    expect(integrationsEndpoints.listActionApprovals.auth).toBe('user');
  });

  it('the SHARING descriptors stay off the key surface too (E1)', () => {
    expect(integrationsEndpoints.setVisibility.auth).toBe('user');
    expect(integrationsEndpoints.setGlobal.auth).toBe('super-admin');
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Fail closed on a missing tenant
// ---------------------------------------------------------------------------------------------

describe('fail closed on a principal that names no tenant', () => {
  it.each([
    ['no org', '', 'ownerA'],
    ['no user', 'orgA', ''],
  ])('%s: get and execute both refuse with no_tenant, and nothing runs', async (_label, orgId, userId) => {
    await seed(PROBE_INTEGRATION, [boundRead], { visibility: 'global', orgId: 'orgZ', userId: 'ownerZ' });
    const calls: unknown[] = [];
    const ctx: CapabilityContext = {
      actor: { userId, orgId, role: 'user' },
      deps,
      runAutomationBackedAction: async (i) => { calls.push(i); return { success: true }; },
    };
    expect(await getIntegrationCapability(ctx, PROBE_INTEGRATION)).toEqual({ ok: false, refusal: 'no_tenant' });
    expect(await executeIntegrationCapabilityAction(ctx, PROBE_INTEGRATION, 'consultar', {})).toEqual({ ok: false, refusal: 'no_tenant' });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. The projection
// ---------------------------------------------------------------------------------------------

describe('the capability projection', () => {
  it('reports each action\'s backing, target, approval requirement and live approval state', async () => {
    await seed(PROBE_INTEGRATION, [boundRead, httpWrite], { authType: 'api_key' });
    const { ctx } = ctxWithSpy('ownerA', 'orgA');

    const before = await getIntegrationCapability(ctx, PROBE_INTEGRATION);
    expect(before.ok).toBe(true);
    const view = valueOf(before);
    // `api_key` with no config row: the executor would answer `not_connected`, so the read says so.
    expect(view.connected).toBe(false);

    const read = view.actions.find((a) => a.actionName === 'consultar')!;
    expect(read.backingType).toBe('browser-steps');
    expect(read.requiresApproval).toBe(false);
    expect(read.approved).toBe(false);

    const write = view.actions.find((a) => a.actionName === 'send_message')!;
    expect(write.backingType).toBe('api-call');
    expect(write.transport).toBe('http');
    expect(write.target).toBe(`POST ${HOST}/messages`);
    expect(write.requiresApproval).toBe(true);
    expect(write.approved).toBe(false);

    // Grant, and the SAME read now reports it — advisory state, read per call, never cached.
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, httpWrite), 'always');
    const after = valueOf(await getIntegrationCapability(ctx, PROBE_INTEGRATION));
    expect(after.actions.find((a) => a.actionName === 'send_message')!.approved).toBe(true);
  });

  it('a malformed package is reported as `invalid`, never thrown out of the read', async () => {
    // `bash-cli` may not carry an httpConfig; the executor refuses it with `invalid_backing_type`.
    // A client asking "what can I do here" must be told which action is broken, not handed a 500.
    await seed(PROBE_INTEGRATION, [
      { actionName: 'broken', description: 'contradiction', mutates: false, backingType: 'bash-cli', httpConfig: { method: 'GET', baseUrl: HOST, path: '/x' } } as IntegrationAction,
    ]);
    const { ctx } = ctxWithSpy('ownerA', 'orgA');
    const view = valueOf(await getIntegrationCapability(ctx, PROBE_INTEGRATION));
    expect(view.actions[0]!.backingType).toBe('invalid');
  });

  it('a cross-org `global` row reveals no authorship: no id, no visibility, no org/user anywhere', async () => {
    await seed(PROBE_INTEGRATION, [boundRead], { orgId: 'orgFOREIGN', userId: 'authorFOREIGN', visibility: 'global' });
    const { ctx } = ctxWithSpy('ownerA', 'orgA');
    const view = valueOf(await getIntegrationCapability(ctx, PROBE_INTEGRATION));

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('orgFOREIGN');
    expect(serialized).not.toContain('authorFOREIGN');
    // `orgId`/`userId` are asserted ABSENT, so they are not on the projected type at all - the cast
    // is what lets the test ask for a field the contract promises cannot be there.
    const integration = view.integration as unknown as Record<string, unknown>;
    expect(integration.id).toBeUndefined();
    expect(integration.visibility).toBeUndefined();
    expect(integration.orgId).toBeUndefined();
    expect(integration.userId).toBeUndefined();
  });

  it('the caller\'s OWN-ORG row stays addressable (E1 review F3): id + visibility are projected', async () => {
    await seed(PROBE_INTEGRATION, [boundRead], { visibility: 'org' });
    const { ctx } = ctxWithSpy('ownerA', 'orgA');
    const view = valueOf(await getIntegrationCapability(ctx, PROBE_INTEGRATION));
    expect(typeof view.integration.id).toBe('string');
    expect(view.integration.visibility).toBe('org');
  });

  it('an integration the actor cannot see is `not_found`, exactly like one that does not exist', async () => {
    await seed(PROBE_INTEGRATION, [boundRead], { orgId: 'orgOTHER', userId: 'ownerOTHER', visibility: 'private' });
    const { ctx } = ctxWithSpy('ownerA', 'orgA');
    expect(await getIntegrationCapability(ctx, PROBE_INTEGRATION)).toEqual({ ok: false, refusal: 'not_found' });
    expect(await getIntegrationCapability(ctx, 'no-such-integration-at-all')).toEqual({ ok: false, refusal: 'not_found' });
  });
});

// ---------------------------------------------------------------------------------------------
// 5. The wire mapping
// ---------------------------------------------------------------------------------------------

describe('capabilityWireOutcome: which executor result becomes which wire answer', () => {
  const r = (over: Partial<ExecuteIntegrationActionResult>): ExecuteIntegrationActionResult => ({ success: false, ...over });

  it('an unaddressable call is not_found for BOTH unknown codes', () => {
    expect(capabilityWireOutcome(r({ code: 'unknown_integration' })).kind).toBe('not_found');
    expect(capabilityWireOutcome(r({ code: 'unknown_action' })).kind).toBe('not_found');
  });

  it('awaiting_consent carries the descriptor and is NOT a 2xx result', () => {
    const out = capabilityWireOutcome(r({
      code: 'awaiting_consent',
      consentRequest: { integrationKey: PROBE_INTEGRATION, actionName: 'send_message', description: 'd', target: 't', shape: 's' },
    }));
    expect(out.kind).toBe('awaiting_consent');
    expect((out as { consentRequest: { shape: string } }).consentRequest.shape).toBe('s');
  });

  it('every OTHER outcome is a 200 result envelope, success or not', () => {
    for (const code of ['not_connected', 'disabled', 'origin_refused', 'client_4xx', 'transient_5xx', 'transport_error', 'unsupported_transport', 'invalid_backing_type', 'automation_required'] as const) {
      const out = capabilityWireOutcome(r({ code }));
      expect(out.kind, code).toBe('result');
      expect((out as { body: { success: boolean; code?: string } }).body).toMatchObject({ success: false, code });
    }
    const ok = capabilityWireOutcome({ success: true, status: 200, data: { a: 1 } });
    expect(ok).toEqual({ kind: 'result', body: { success: true, status: 200, data: { a: 1 } } });
  });

  it('the executor DIAGNOSTIC dump never reaches the wire', () => {
    // `details` carries a redacted request/response summary for an operator. It is not part of a
    // public contract and must not be echoed to a capability client.
    const out = capabilityWireOutcome(r({
      code: 'client_4xx',
      error: 'API error (400)',
      details: { request: { method: 'POST', url: `${HOST}/messages`, headers: { authorization: '[REDACTED]' } } },
    }));
    expect(JSON.stringify(out)).not.toContain('authorization');
    expect((out as { body: Record<string, unknown> }).body.details).toBeUndefined();
  });
});
