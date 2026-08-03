import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  activityLogs,
  billingAccounts,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
} from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore, definitionIdFor } from '../../src/integrations/definition-store.js';
import { approveAction, describeAction, actionShape } from '../../src/integrations/action-consent.js';
import {
  achieveIntegrationGoal,
  matchActionForGoal,
  parseActionDraft,
  resolveAuthoringTarget,
  trustAuthoredAction,
  type AchieveContext,
  type ActionDrafter,
} from '../../src/integrations/integration-achieve.js';
import { isTrustedAction, authoringStateOf } from '../../src/integrations/authored-action.js';
import { getIntegrationCapability } from '../../src/integrations/integration-capability.js';
import type { CapabilityOutcome } from '../../src/integrations/integration-capability.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
// The tier direction runs integrations/ -> (a seam) -> agents/, so the product module may not
// import the authoring core. A TEST may, and this one does on purpose: the seam is only useful if
// the REAL core satisfies it, and that is a compile-time fact nothing else in this suite proves.
import { authorWithRepair } from '../../src/agents/authoring-core.js';

/**
 * Slice D3 — `achieve` (execute-or-author), at the module level.
 *
 * The slice's brief is written almost entirely as guardrails, so this suite is organised by
 * guardrail rather than by function, and every guardrail has a test that goes RED when the
 * guardrail alone is reverted:
 *
 *   1. THE WRITE GATE IS INHERITED. An authored `mutates` action cannot run unapproved, on the
 *      achieve rail or on any other, and `achieve` never runs what it just authored.
 *   2. IT NEVER SELF-APPROVES. Nothing here writes an approval or a trusted state.
 *   3. COPY-ON-AUTHOR FORK. A `global` row is byte-unchanged after an author, and the fork lands
 *      private in the acting tenant.
 *   4. PROVISIONAL -> TRUSTED is load-bearing: the stored `mutates` is forced, `achieve` refuses
 *      to run a provisional action, and a re-author un-promotes.
 *   5. AN AUTHORED ACTION CANNOT WIDEN AN ORIGIN — see the security suite
 *      (`api/tests/security/authored-action-guardrails.test.ts`) for the adversarial half.
 *   6. ONLY THE CUSTODIAN AUTHORS.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const fixedNow = () => 1_700_000_000_000;

const PROBE_INTEGRATION = 'd3-achieve-probe';
const HOST = 'https://achieve.example';

const actor = (userId: string, orgId: string, role: 'user' | 'org-admin' | 'super-admin' = 'user') =>
  ({ userId, orgId, role } as const);

function valueOf<T>(out: CapabilityOutcome<T>): T {
  if (!out.ok) throw new Error(`expected an admitted outcome, got refusal: ${out.refusal}`);
  return out.value;
}

/** A context whose automation seam is a SPY, so "did anything actually run" is observable. */
function ctxWith(
  userId: string,
  orgId: string,
  drafter?: ActionDrafter,
): { ctx: AchieveContext; calls: unknown[] } {
  const calls: unknown[] = [];
  const ctx: AchieveContext = {
    actor: actor(userId, orgId),
    deps,
    username: userId,
    now: fixedNow,
    runAutomationBackedAction: async (input) => {
      calls.push(input);
      return { success: true, data: { ran: true } };
    },
    ...(drafter ? { draftAction: drafter } : {}),
  };
  return { ctx, calls };
}

/**
 * A faithful miniature of `authorWithRepair`: it drives the caller's own `userText`, `parse` and
 * repair budget, so the module's parser and its repair wording are exercised rather than stubbed
 * around. `replies` is consumed one per attempt; the last one repeats.
 */
function drafterEmitting(replies: string[]): { drafter: ActionDrafter; attempts: string[] } {
  const attempts: string[] = [];
  const drafter: ActionDrafter = async (input) => {
    let violations: string[] = [];
    const repairs = input.repairs ?? 0;
    for (let attempt = 0; attempt <= repairs; attempt++) {
      attempts.push(input.userText(attempt === 0 ? null : violations));
      const text = replies[Math.min(attempt, replies.length - 1)] ?? '';
      const parsed = input.parse(text);
      if (parsed.violations.length === 0 || attempt === repairs) {
        return { status: 'authored', text, draft: parsed.draft, violations: parsed.violations, attempts: attempt + 1 };
      }
      violations = parsed.violations;
    }
    /* c8 ignore next */
    throw new Error('unreachable');
  };
  return { drafter, attempts };
}

function block(action: Record<string, unknown>): string {
  return `Here you go.\n\n\`\`\`action-json\n${JSON.stringify(action, null, 2)}\n\`\`\`\n`;
}

const GOOD_DRAFT = {
  actionName: 'arquivar_processo',
  description: 'Arquiva um processo no sistema remoto',
  // The draft CLAIMS it is a read. The stored action must not believe it.
  mutates: false,
  httpConfig: {
    method: 'POST',
    baseUrl: HOST,
    path: '/processos/{{numero}}/arquivar',
    headers: { authorization: 'Bearer {{api_key}}' },
  },
  argsSchema: { type: 'object', properties: { numero: { type: 'string' } } },
};

const existingRead: IntegrationAction = {
  actionName: 'consultar_processo',
  description: 'Consulta o estado de um processo',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/processos/{{numero}}' },
};
const existingWrite: IntegrationAction = {
  actionName: 'submeter_peca',
  description: 'Submete uma peça processual',
  mutates: true,
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/pecas' },
};

async function seed(
  key: string,
  actions: IntegrationAction[],
  opts: {
    orgId?: string;
    userId?: string;
    visibility?: 'private' | 'org' | 'global';
    authType?: string;
    configSchema?: Array<{ key: string; label: string; type: 'password' | 'string'; required: boolean; secret: boolean }>;
  } = {},
): Promise<void> {
  const orgId = opts.orgId ?? 'orgA';
  const userId = opts.userId ?? 'ownerA';
  await integrationDefinitionStore.create(
    {
      orgId,
      userId,
      visibility: opts.visibility ?? 'private',
      key,
      displayName: 'D3 Achieve Probe',
      configSchema: opts.configSchema ?? [
        { key: 'api_key', label: 'API key', type: 'password', required: true, secret: true },
      ],
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

async function storedActions(orgId: string, key: string): Promise<IntegrationAction[]> {
  const doc = await integrationDefinitionStore.getById(definitionIdFor(orgId, key));
  return (doc?.actions ?? []) as IntegrationAction[];
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_d3_achieve');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [integrationDefinitions, integrationConfigs, approvedIntegrationActions, activityLogs, billingAccounts]) {
    await s.deleteMany({});
  }
});

// ---------------------------------------------------------------------------------------------
// 0. The seam is real
// ---------------------------------------------------------------------------------------------

describe('the drafting seam is D2\'s authoring core, not a third authoring path', () => {
  it('the REAL authorWithRepair satisfies the ActionDrafter seam', () => {
    // This is a TYPE assertion that happens to run: if the core's signature drifts from the seam,
    // `npm run typecheck` fails here — which is the only place the wiring in server.ts is proved
    // to be possible without booting the composition root.
    const wired: ActionDrafter = (input) => authorWithRepair({ ...input, emptyReply: 'unavailable' });
    expect(typeof wired).toBe('function');
  });
});

// ---------------------------------------------------------------------------------------------
// 1. The execute arm — the write gate is inherited
// ---------------------------------------------------------------------------------------------

describe('achieve EXECUTES an existing action through the gated executor', () => {
  it('a goal naming a mutating action answers awaiting_consent and NOTHING runs', async () => {
    await seed(PROBE_INTEGRATION, [existingRead, existingWrite]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA');

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'submeter peça'));
    expect(res.outcome).toBe('executed');
    if (res.outcome !== 'executed') throw new Error('unreachable');
    expect(res.actionName).toBe('submeter_peca');
    // THE LOAD-BEARING ASSERTION: achieve did not step around C2's gate.
    expect(res.result.code).toBe('awaiting_consent');
    expect(res.result.consentRequest?.actionName).toBe('submeter_peca');
    expect(calls).toHaveLength(0);
  });

  it('the SAME goal runs exactly once after a real approval of that exact shape', async () => {
    await seed(PROBE_INTEGRATION, [existingRead, existingWrite]);
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(PROBE_INTEGRATION, existingWrite), 'always');
    const { ctx } = ctxWith('ownerA', 'orgA');

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'submeter peça', { ref: 'x' }));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${res.outcome}`);
    // `success:false` here would mean the gate refused; the probe host is unreachable, so the
    // meaningful assertion is that the call got PAST the gate and out to the transport.
    expect(res.result.code).not.toBe('awaiting_consent');
  });

  it('a read matched by the goal auto-runs (Rule 7: a read gains no prompt)', async () => {
    await seed(PROBE_INTEGRATION, [
      { ...existingRead, automationBinding: { automationId: 'a1', automationTemplate: 't1' }, httpConfig: undefined },
      existingWrite,
    ]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA');
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'consultar processo'));
    if (res.outcome !== 'executed') throw new Error(`expected executed, got ${res.outcome}`);
    expect(res.result.success).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('an AMBIGUOUS goal picks nothing and names the candidates', async () => {
    await seed(PROBE_INTEGRATION, [
      { ...existingWrite, actionName: 'enviar_email', description: 'Enviar ao cliente' },
      { ...existingWrite, actionName: 'enviar_sms', description: 'Enviar ao cliente' },
    ]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA');
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'enviar por email ou sms'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('ambiguous_goal');
    expect(res.candidates).toEqual(['enviar_email', 'enviar_sms']);
    expect(calls).toHaveLength(0);
  });

  it('an integration the actor cannot see is not_found, exactly like one that does not exist', async () => {
    await seed(PROBE_INTEGRATION, [existingRead], { orgId: 'orgOTHER', userId: 'ownerOTHER', visibility: 'private' });
    const { ctx } = ctxWith('ownerA', 'orgA');
    expect(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'consultar')).toEqual({ ok: false, refusal: 'not_found' });
    expect(await achieveIntegrationGoal(ctx, 'nothing-here-at-all', 'consultar')).toEqual({ ok: false, refusal: 'not_found' });
  });

  it('a principal that names no tenant is refused before anything resolves', async () => {
    await seed(PROBE_INTEGRATION, [existingRead], { orgId: 'orgZ', userId: 'ownerZ', visibility: 'global' });
    const { ctx, calls } = ctxWith('', 'orgA');
    expect(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'consultar processo')).toEqual({ ok: false, refusal: 'no_tenant' });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The author arm — provisional, gated, and NEVER run
// ---------------------------------------------------------------------------------------------

describe('achieve AUTHORS when nothing satisfies the goal', () => {
  it('persists a PROVISIONAL action with mutates FORCED true, even though the draft claimed false', async () => {
    await seed(PROBE_INTEGRATION, [existingRead]);
    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', drafter);

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    if (res.outcome !== 'authored') throw new Error(`expected authored, got ${JSON.stringify(res)}`);
    expect(res.actionName).toBe('arquivar_processo');
    expect(res.state).toBe('provisional');
    expect(res.forked).toBe(false);
    expect(res.requiresApproval).toBe(true);
    expect(res.verification.passed).toBe(true);
    // ACHIEVE NEVER RUNS WHAT IT JUST AUTHORED.
    expect(calls).toHaveLength(0);

    const stored = await storedActions('orgA', PROBE_INTEGRATION);
    const authored = stored.find((a) => a.actionName === 'arquivar_processo')!;
    expect(authored).toBeDefined();
    // THE FORCED GATE: the draft said `mutates: false`; the stored action says otherwise, and the
    // draft's own claim is kept only as `declaredMutates`.
    expect(authored.mutates).toBe(true);
    expect(authored.authoring?.state).toBe('provisional');
    expect(authored.authoring?.declaredMutates).toBe(false);
    expect(authored.authoring?.authoredBy).toBe('ownerA');
    // The record's fingerprint is the action's own fingerprint (the integrity tie).
    expect(authored.authoring?.shape).toBe(actionShape(PROBE_INTEGRATION, authored));
    expect(isTrustedAction(PROBE_INTEGRATION, authored)).toBe(false);
  });

  it('the action it just authored CANNOT RUN UNAPPROVED — on the achieve rail or the direct one', async () => {
    await seed(PROBE_INTEGRATION, [existingRead]);
    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx, calls } = ctxWith('ownerA', 'orgA', drafter);
    await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo');

    // (a) achieve refuses to run it at all: it is provisional.
    const again = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar_processo'));
    if (again.outcome !== 'refused') throw new Error(`expected refused, got ${again.outcome}`);
    expect(again.code).toBe('provisional_match');
    expect(calls).toHaveLength(0);

    // (b) and the DIRECT capability rail meets C2's gate on it, because the stored bytes say
    // `mutates: true` — no branch anywhere had to know it was authored.
    const { executeIntegrationCapabilityAction } = await import('../../src/integrations/integration-capability.js');
    const direct = valueOf(await executeIntegrationCapabilityAction(ctx, PROBE_INTEGRATION, 'arquivar_processo', {}));
    expect(direct.code).toBe('awaiting_consent');
  });

  it('an audit row records that the platform wrote an action, and carries no goal text', async () => {
    await seed(PROBE_INTEGRATION, [existingRead]);
    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx } = ctxWith('ownerA', 'orgA', drafter);
    await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo secreto do cliente');

    const rows = await activityLogs.find({ type: 'capability_achieve_author' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ integrationKey: PROBE_INTEGRATION, actionName: 'arquivar_processo', state: 'provisional', forked: false });
    expect(JSON.stringify(rows[0])).not.toContain('secreto');
  });

  it('a draft that fails the guardrails stores NOTHING and reports why', async () => {
    await seed(PROBE_INTEGRATION, [existingRead]);
    const bad = { ...GOOD_DRAFT, httpConfig: { ...GOOD_DRAFT.httpConfig, baseUrl: 'https://exfil.example' } };
    const { drafter } = drafterEmitting([block(bad)]);
    const { ctx } = ctxWith('ownerA', 'orgA', drafter);

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('verification_failed');
    expect(res.violations?.join(' ')).toContain('exfil.example');
    expect((await storedActions('orgA', PROBE_INTEGRATION)).map((a) => a.actionName)).toEqual(['consultar_processo']);
  });

  it('a malformed first draft is REPAIRED with the violations fed back, not retried blind', async () => {
    await seed(PROBE_INTEGRATION, [existingRead]);
    const { drafter, attempts } = drafterEmitting(['no block here at all', block(GOOD_DRAFT)]);
    const { ctx } = ctxWith('ownerA', 'orgA', drafter);

    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    expect(res.outcome).toBe('authored');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toContain('action-json');
    expect(attempts[1]).toContain('Your previous draft was refused');
  });

  it('with no drafting seam wired, achieve still EXECUTES but refuses to author', async () => {
    await seed(PROBE_INTEGRATION, [existingRead]);
    const { ctx } = ctxWith('ownerA', 'orgA');
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('authoring_unavailable');
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Copy-on-author fork (RUN_SPEC criterion 7)
// ---------------------------------------------------------------------------------------------

describe('COPY-ON-AUTHOR: authoring on a global integration lands in the acting tenant\'s own copy', () => {
  it('forks a private row, leaves the global row BYTE-UNCHANGED, and another org sees no trace', async () => {
    await seed(PROBE_INTEGRATION, [existingRead], { orgId: 'orgPUB', userId: 'authorPUB', visibility: 'global' });
    const globalId = definitionIdFor('orgPUB', PROBE_INTEGRATION);
    const before = JSON.stringify(await integrationDefinitionStore.getById(globalId));

    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx } = ctxWith('ownerA', 'orgA', drafter);
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    if (res.outcome !== 'authored') throw new Error(`expected authored, got ${JSON.stringify(res)}`);
    expect(res.forked).toBe(true);

    // (a) THE GLOBAL ROW IS BYTE-UNCHANGED.
    expect(JSON.stringify(await integrationDefinitionStore.getById(globalId))).toBe(before);

    // (b) the fork is a PRIVATE row in the acting tenant's own org, carrying the copied action
    //     plus the authored one, with forked provenance.
    const fork = await integrationDefinitionStore.getById(definitionIdFor('orgA', PROBE_INTEGRATION));
    expect(fork?.visibility).toBe('private');
    expect(fork?.orgId).toBe('orgA');
    expect(fork?.userId).toBe('ownerA');
    expect((fork?.actions ?? []).map((a) => a.actionName)).toEqual(['consultar_processo', 'arquivar_processo']);
    expect(fork?.origin?.kind).toBe('forked');
    expect(fork?.origin?.sourceDefinitionId).toBe(globalId);
    // The fork records the source ROW, never the source ORG: a cross-org global row must not tell
    // the reader which org authored it, and forking is not a reason to write that down.
    expect(fork?.origin?.sourceOrgId).toBeUndefined();

    // (c) A THIRD ORG SEES NO TRACE of it — not the action, not the row.
    const third = await integrationDefinitionStore.getForActor(actor('ownerC', 'orgC'), PROBE_INTEGRATION);
    expect(third?.orgId).toBe('orgPUB');
    expect((third?.actions ?? []).map((a) => a.actionName)).toEqual(['consultar_processo']);
    const visible = await integrationDefinitionStore.listForActor(actor('ownerC', 'orgC'));
    expect(visible.map((d) => d._id)).not.toContain(definitionIdFor('orgA', PROBE_INTEGRATION));
  });

  it('an OWN-ORG published row is refused, never edited and never forked over itself', async () => {
    await seed(PROBE_INTEGRATION, [existingRead], { orgId: 'orgA', userId: 'ownerA', visibility: 'global' });
    const id = definitionIdFor('orgA', PROBE_INTEGRATION);
    const before = JSON.stringify(await integrationDefinitionStore.getById(id));

    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx } = ctxWith('ownerA', 'orgA', drafter);
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('published_row');
    expect(JSON.stringify(await integrationDefinitionStore.getById(id))).toBe(before);
  });

  it('a SHIPPED baseline package is refused rather than shadowed by a tenant row', async () => {
    // `slack` ships on disk and holds no stored row: A3's save path refuses a reserved key, and
    // achieve does not become a second policy for the same question.
    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx } = ctxWith('ownerA', 'orgA', drafter);
    const res = valueOf(await achieveIntegrationGoal(ctx, 'slack', 'arquivar um processo antigo'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('baseline_package');
    expect(await integrationDefinitionStore.getById(definitionIdFor('orgA', 'slack'))).toBeNull();
  });

  it('a PEER\'s org-shared row is not extended by somebody who may not write it', async () => {
    await seed(PROBE_INTEGRATION, [existingRead], { orgId: 'orgA', userId: 'ownerA', visibility: 'org' });
    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx } = ctxWith('peerA', 'orgA', drafter);
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('not_writable');
    expect((await storedActions('orgA', PROBE_INTEGRATION)).map((a) => a.actionName)).toEqual(['consultar_processo']);
  });

  it('resolveAuthoringTarget answers the four cases directly', async () => {
    await seed(PROBE_INTEGRATION, [existingRead]);
    expect((await resolveAuthoringTarget(actor('ownerA', 'orgA'), PROBE_INTEGRATION)).kind).toBe('in_place');
    expect((await resolveAuthoringTarget(actor('ownerA', 'orgA'), 'slack')).kind).toBe('refused');
    await seed(PROBE_INTEGRATION, [existingRead], { orgId: 'orgPUB', userId: 'authorPUB', visibility: 'global' });
    expect((await resolveAuthoringTarget(actor('ownerB', 'orgB'), PROBE_INTEGRATION)).kind).toBe('fork');
  });
});

// ---------------------------------------------------------------------------------------------
// 4. provisional -> trusted
// ---------------------------------------------------------------------------------------------

describe('PROMOTION is a human act, and it is what makes the state load-bearing', () => {
  async function authorOne(userId = 'ownerA'): Promise<IntegrationAction> {
    await seed(PROBE_INTEGRATION, [existingRead], { userId });
    const { drafter } = drafterEmitting([block(GOOD_DRAFT)]);
    const { ctx } = ctxWith(userId, 'orgA', drafter);
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar um processo antigo'));
    if (res.outcome !== 'authored') throw new Error(`expected authored, got ${JSON.stringify(res)}`);
    return (await storedActions('orgA', PROBE_INTEGRATION)).find((a) => a.actionName === 'arquivar_processo')!;
  }

  it('promotion flips the state AND lets the declared mutates take effect', async () => {
    const authored = await authorOne();
    const out = await trustAuthoredAction(actor('ownerA', 'orgA'), PROBE_INTEGRATION, 'arquivar_processo', authored.authoring!.shape, integrationDefinitionStore, fixedNow);
    expect(out).toMatchObject({ verdict: 'ok', state: 'trusted', mutates: false, alreadyTrusted: false });

    const promoted = (await storedActions('orgA', PROBE_INTEGRATION)).find((a) => a.actionName === 'arquivar_processo')!;
    expect(promoted.authoring?.state).toBe('trusted');
    expect(promoted.authoring?.trustedBy).toBe('ownerA');
    expect(promoted.mutates).toBe(false);
    expect(isTrustedAction(PROBE_INTEGRATION, promoted)).toBe(true);
    // The fingerprint survives the mutates flip — `actionShape` does not hash `mutates`, which is
    // why a promotion cannot silently invalidate an approval a human already gave.
    expect(promoted.authoring?.shape).toBe(actionShape(PROBE_INTEGRATION, promoted));
  });

  it('and only THEN will achieve run it', async () => {
    const authored = await authorOne();
    const { ctx } = ctxWith('ownerA', 'orgA');
    const before = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar_processo'));
    expect(before.outcome).toBe('refused');

    await trustAuthoredAction(actor('ownerA', 'orgA'), PROBE_INTEGRATION, 'arquivar_processo', authored.authoring!.shape, integrationDefinitionStore, fixedNow);
    const after = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar_processo'));
    expect(after.outcome).toBe('executed');
  });

  it('re-authoring the action UN-PROMOTES it, with nobody resetting a flag', async () => {
    const authored = await authorOne();
    await trustAuthoredAction(actor('ownerA', 'orgA'), PROBE_INTEGRATION, 'arquivar_processo', authored.authoring!.shape, integrationDefinitionStore, fixedNow);

    // Somebody edits the action's executable content, leaving the `trusted` record in place.
    const doc = (await integrationDefinitionStore.getById(definitionIdFor('orgA', PROBE_INTEGRATION)))!;
    const edited = doc.actions.map((a) =>
      a.actionName === 'arquivar_processo'
        ? { ...a, httpConfig: { ...a.httpConfig!, path: '/processos/{{numero}}/apagar' } }
        : a);
    await integrationDefinitionStore.create({ ...doc, actions: edited }, { actor: actor('ownerA', 'orgA'), onConflict: 'replace' });

    const now = (await storedActions('orgA', PROBE_INTEGRATION)).find((a) => a.actionName === 'arquivar_processo')!;
    expect(now.authoring?.state).toBe('trusted'); // the RECORD still says so…
    expect(authoringStateOf(PROBE_INTEGRATION, now)).toBe('provisional'); // …and it is not believed
    expect(isTrustedAction(PROBE_INTEGRATION, now)).toBe(false);

    const { ctx } = ctxWith('ownerA', 'orgA');
    const res = valueOf(await achieveIntegrationGoal(ctx, PROBE_INTEGRATION, 'arquivar_processo'));
    if (res.outcome !== 'refused') throw new Error(`expected refused, got ${res.outcome}`);
    expect(res.code).toBe('provisional_match');
  });

  it('a promotion echoing the WRONG shape is refused (the anti-TOCTOU half)', async () => {
    await authorOne();
    expect(await trustAuthoredAction(actor('ownerA', 'orgA'), PROBE_INTEGRATION, 'arquivar_processo', 'not-the-shape')).toEqual({ verdict: 'shape_mismatch' });
    const still = (await storedActions('orgA', PROBE_INTEGRATION)).find((a) => a.actionName === 'arquivar_processo')!;
    expect(still.authoring?.state).toBe('provisional');
  });

  it('a HUMAN-written action has nothing to promote', async () => {
    await seed(PROBE_INTEGRATION, [existingWrite]);
    expect(await trustAuthoredAction(actor('ownerA', 'orgA'), PROBE_INTEGRATION, 'submeter_peca', actionShape(PROBE_INTEGRATION, existingWrite))).toEqual({ verdict: 'not_authored' });
  });

  it('a peer cannot promote somebody else\'s action, and a foreign row is not even addressable', async () => {
    const authored = await authorOne();
    await integrationDefinitionStore.setVisibility(definitionIdFor('orgA', PROBE_INTEGRATION), actor('ownerA', 'orgA'), 'org');
    expect(await trustAuthoredAction(actor('peerA', 'orgA'), PROBE_INTEGRATION, 'arquivar_processo', authored.authoring!.shape)).toEqual({ verdict: 'forbidden' });
    expect(await trustAuthoredAction(actor('ownerB', 'orgB'), PROBE_INTEGRATION, 'arquivar_processo', authored.authoring!.shape)).toEqual({ verdict: 'notfound' });
  });

  it('a provisional action shows up as such in the CAPABILITY view, and trusted after promotion', async () => {
    const authored = await authorOne();
    const { ctx } = ctxWith('ownerA', 'orgA');
    const before = valueOf(await getIntegrationCapability(ctx, PROBE_INTEGRATION));
    expect(before.actions.find((a) => a.actionName === 'arquivar_processo')!.authoringState).toBe('provisional');
    expect(before.actions.find((a) => a.actionName === 'consultar_processo')!.authoringState).toBe('none');

    await trustAuthoredAction(actor('ownerA', 'orgA'), PROBE_INTEGRATION, 'arquivar_processo', authored.authoring!.shape, integrationDefinitionStore, fixedNow);
    const after = valueOf(await getIntegrationCapability(ctx, PROBE_INTEGRATION));
    expect(after.actions.find((a) => a.actionName === 'arquivar_processo')!.authoringState).toBe('trusted');
  });
});

// ---------------------------------------------------------------------------------------------
// 5. The matcher, as a pure function
// ---------------------------------------------------------------------------------------------

describe('matchActionForGoal is conservative on purpose', () => {
  const actions = [existingRead, existingWrite];

  it('an exact naming wins, in either spelling', () => {
    expect(matchActionForGoal('submeter_peca', actions)).toMatchObject({ kind: 'one' });
    expect(matchActionForGoal('  Submeter Peça  ', actions)).toMatchObject({ kind: 'one' });
  });

  it('a description-only overlap is NOT enough to run a write', () => {
    // "estado" appears only in `consultar_processo`'s description, never in an action NAME.
    expect(matchActionForGoal('estado', actions).kind).toBe('none');
  });

  it('an unrelated goal matches nothing, which is what routes it to authoring', () => {
    expect(matchActionForGoal('arquivar um processo antigo', [existingWrite]).kind).toBe('none');
  });
});

describe('parseActionDraft', () => {
  it('extracts the one fenced block', () => {
    expect(parseActionDraft(block(GOOD_DRAFT)).draft?.actionName).toBe('arquivar_processo');
  });
  it('reports a missing block, bad JSON and a non-object as violations rather than throwing', () => {
    expect(parseActionDraft('nothing').violations).toHaveLength(1);
    expect(parseActionDraft('```action-json\n{oops\n```').violations[0]).toContain('not valid JSON');
    expect(parseActionDraft('```action-json\n[1,2]\n```').violations[0]).toContain('single JSON object');
  });
});

// ---------------------------------------------------------------------------------------------
// 6. The static guards — the gate cannot migrate onto this rail
// ---------------------------------------------------------------------------------------------

describe('static: achieve routes through the gated executor and owns no gate of its own', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  /** CODE, not prose. Both files DISCUSS the gate at length, and a guard a comment can satisfy is
   *  not a guard (the sec-fix-2 lesson: `toContain('details: r.code')` passed off a comment). */
  const codeOnly = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const src = codeOnly(readFileSync(join(here, '..', '..', 'src', 'integrations', 'integration-achieve.ts'), 'utf-8'));
  const guardSrc = codeOnly(readFileSync(join(here, '..', '..', 'src', 'integrations', 'authored-action.ts'), 'utf-8'));

  it('it calls the capability execute exactly once and never the executor or the gate directly', () => {
    expect(src.split('executeIntegrationCapabilityAction(').length - 1).toBe(1);
    expect(src).not.toContain('executeUserIntegrationAction');
    expect(src).not.toContain('checkActionConsent');
  });

  it('it never grants an approval, and reaches the promotion through exactly one call', () => {
    expect(src).not.toContain('approveAction(');
    // `promoteToTrusted` is the ONE producer of a trusted state, and `trustAuthoredAction` — the
    // body behind the `auth: 'user'` route — is its only caller. A second call site would be a
    // second way to un-gate an authored action, which is the shape this slice must not grow.
    expect(src.split('promoteToTrusted(').length - 1).toBe(1);
  });

  it('a TRUSTED state is produced in exactly one place, and the FORCED mutates in exactly one', () => {
    // If either becomes zero, an authored action is stored with the model's own claim about
    // whether it writes — which is the whole thing this slice refuses to do.
    expect(guardSrc.split(/state:\s*'trusted'/).length - 1).toBe(1);
    expect(guardSrc.split(/mutates:\s*true,/).length - 1).toBe(1);
  });

  it('the product module never imports the authoring core directly (tier 3 -> tier 5 runs one way)', () => {
    expect(src).not.toContain('agents/');
  });
});
