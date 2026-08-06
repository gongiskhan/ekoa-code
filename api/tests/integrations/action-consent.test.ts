import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
  eventQueue,
  listenerState,
} from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { createConfig } from '../../src/integrations/service.js';
import { executeUserIntegrationAction, type FetchLike } from '../../src/integrations/action-executor.js';
import {
  approveAction,
  describeAction,
  actionRequiresConsent,
  actionShape,
  ACTION_APPROVAL_TTL_DAYS,
  ONCE_APPROVAL_TTL_MINUTES,
} from '../../src/integrations/action-consent.js';
import { pollUserDefinedSource, type UserDefinedPollTrigger } from '../../src/integrations/event-sources/user-defined-poll.js';
import { readListenerCursor, writeListenerCursor } from '../../src/events/listener-state.js';
import { enqueueListenerEvent } from '../../src/events/listener-supervisor.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * Slice C2 — the WRITE GATE, at the executor.
 *
 * RUN_SPEC criterion 6: "`mutates: true` actions are an execution gate: a write requires human
 * confirmation BEFORE first run AND BEFORE an authored one persists as executable; reads auto-run."
 *
 * WHAT THIS SUITE IS FOR, in one sentence: the gate is a property of
 * `executeUserIntegrationAction`, not of any route, so a call arriving by ANY rail hits it. Three
 * things follow, and each is asserted rather than argued:
 *
 *  1. the executor refuses an unapproved write itself (every rail bottoms out here);
 *  2. the REAL listener poll module — the rail that runs with no human present — is refused too,
 *     driven through the exact lambda `server.ts` binds, with only the transport faked;
 *  3. a STATIC guard over `server.ts` proves the other two rails (the agent/automation action
 *     seam and the listener supervisor) still route through this one function, so the day someone
 *     adds a fourth call path that skips it, this file goes red. That is the same machine-caught
 *     form the 2A-S4 suite uses for the automation-seam omission.
 *
 * NON-TAUTOLOGY. Every allow case here is paired with a refusal that differs by exactly one fact
 * (the org, the user, the action, the shape, the clock). Deleting the gate makes the refusals pass
 * as successes; weakening any single scope component makes exactly one of them fail.
 *
 * Definitions are seeded into MONGO (`integrationDefinitionStore`) rather than onto disk: the
 * write gate's whole second half is about AUTHORED actions, and an authored action is a Mongo row.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const ORG = 'orgW';
const OWNER = 'u-writer';

let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = (userId = OWNER, orgId = ORG) => ({ userId, orgId, role: 'user' as const });

interface FakeResponse {
  ok: boolean; status: number; statusText?: string;
  headers: { forEach: (cb: (v: string, k: string) => void) => void };
  text: () => Promise<string>;
}
const mkResponse = (status: number, body: string): FakeResponse => ({
  ok: status >= 200 && status < 300, status, statusText: '',
  headers: { forEach: () => undefined }, text: async () => body,
});
function fakeFetch(body = '{"ok":true}'): { fn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    return mkResponse(200, body) as unknown as Response;
  };
  return { fn, calls };
}

const HOST = 'https://writes.example';
const readAction: IntegrationAction = {
  actionName: 'list_things', description: 'Listar coisas', mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/things' },
};
const writeAction: IntegrationAction = {
  actionName: 'send_message', description: 'Enviar mensagem', mutates: true,
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/messages', bodyTemplate: { text: '{{text}}' } },
};
/** A second write, so an approval for one can be proven NOT to cover the other. */
const otherWriteAction: IntegrationAction = {
  actionName: 'delete_thing', description: 'Apagar coisa', mutates: true,
  httpConfig: { method: 'DELETE', baseUrl: HOST, path: '/things/{{id}}' },
};
/** `mutates` ABSENT — the fail-closed case. `config.json` is parsed, never schema-validated. */
const undeclaredAction = {
  actionName: 'do_something', description: 'Fazer algo',
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/do' },
} as unknown as IntegrationAction;
/** `mutates` present but NOT a boolean — an authored row can carry anything. */
const stringyMutatesAction = {
  actionName: 'stringy', description: 'Falso negativo', mutates: 'false',
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/stringy' },
} as unknown as IntegrationAction;

async function seedDefinition(key: string, actions: IntegrationAction[], over: Record<string, unknown> = {}): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: ORG, userId: OWNER, visibility: 'private', key,
      displayName: key, configSchema: [], actions, skillMd: `# ${key}`, authType: 'none',
      ...over,
    },
    { actor: actor(), onConflict: 'replace' },
  );
}

const run = (actionName: string, fetchImpl?: FetchLike, who = OWNER, org = ORG, key = 'writer') =>
  executeUserIntegrationAction(
    { orgId: org, ownerUserId: who, integrationKey: key, actionName, args: { text: 'olá', id: '7' } },
    fetchImpl ? { fetchImpl } : {},
  );

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_action_consent');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  for (const s of [integrationConfigs, integrationDefinitions, approvedIntegrationActions, eventQueue, listenerState]) {
    await s.deleteMany({});
  }
  await seedDefinition('writer', [readAction, writeAction, otherWriteAction, undeclaredAction, stringyMutatesAction]);
});

// ---------------------------------------------------------------------------------------------
// 1. The gate itself
// ---------------------------------------------------------------------------------------------

describe('write gate: a mutating action is refused until a human approves it', () => {
  it('refuses the write with awaiting_consent and issues NO request', async () => {
    const ff = fakeFetch();
    const res = await run('send_message', ff.fn);
    expect(res.success).toBe(false);
    expect(res.code).toBe('awaiting_consent');
    expect(ff.calls).toHaveLength(0);
  });

  it('the refusal SAYS WHAT it is refusing — integration, action, description and target', async () => {
    const res = await run('send_message');
    const req = res.consentRequest!;
    expect(req.integrationKey).toBe('writer');
    expect(req.actionName).toBe('send_message');
    expect(req.description).toBe('Enviar mensagem');
    // The target is the real destination, not a label: a dialog that cannot name where the write
    // lands is not consent.
    expect(req.target).toBe(`POST ${HOST}/messages`);
    expect(req.shape).toMatch(/^[0-9a-f]{32}$/);
  });

  it('a READ auto-runs, prompt-free — Rule 7 additive for every existing integration', async () => {
    const ff = fakeFetch();
    const res = await run('list_things', ff.fn);
    expect(res.success).toBe(true);
    expect(ff.calls).toEqual([`${HOST}/things`]);
    // …and nothing was written to the approval store on the way past.
    expect(await approvedIntegrationActions.find({})).toHaveLength(0);
  });

  it('an "always" approval lets the SAME write run, repeatedly', async () => {
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('writer', writeAction), 'always');
    const ff = fakeFetch();
    expect((await run('send_message', ff.fn)).success).toBe(true);
    expect((await run('send_message', ff.fn)).success).toBe(true);
    expect(ff.calls).toEqual([`${HOST}/messages`, `${HOST}/messages`]);
  });

  it('a "once" approval is SINGLE-USE: the second call is refused again', async () => {
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('writer', writeAction), 'once');
    const ff = fakeFetch();
    expect((await run('send_message', ff.fn)).success).toBe(true);
    const second = await run('send_message', ff.fn);
    expect(second.success).toBe(false);
    expect(second.code).toBe('awaiting_consent');
    expect(ff.calls).toHaveLength(1);
    // The claim IS the delete — nothing is left behind for a third attempt to find.
    expect(await approvedIntegrationActions.find({})).toHaveLength(0);
  });

  it('a standing "always" is preferred over a stale "once" — the single-use row is not burnt', async () => {
    const d = describeAction('writer', writeAction);
    await approveAction({ orgId: ORG, userId: OWNER }, d, 'once');
    await approveAction({ orgId: ORG, userId: OWNER }, d, 'always');
    const ff = fakeFetch();
    expect((await run('send_message', ff.fn)).success).toBe(true);
    expect(await approvedIntegrationActions.find({ decision: 'once' })).toHaveLength(1);
  });

  it('the gate runs BEFORE the credential lookup: an unapproved write on an UNCONNECTED integration answers awaiting_consent, not not_connected', async () => {
    // `authType: 'api_key'` and no config row -> the pre-C2 answer here was `not_connected`.
    await seedDefinition('needs-key', [writeAction], { authType: 'api_key' });
    const res = await run('send_message', undefined, OWNER, ORG, 'needs-key');
    expect(res.code).toBe('awaiting_consent');
    // …and the same call, once approved, DOES reach the credential stage. Without this half the
    // assertion above would also pass if the executor simply never got that far for any reason.
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('needs-key', writeAction), 'always');
    expect((await run('send_message', undefined, OWNER, ORG, 'needs-key')).code).toBe('not_connected');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Fail-closed
// ---------------------------------------------------------------------------------------------

describe('fail-closed: an action whose `mutates` cannot be determined is a write', () => {
  it('ABSENT `mutates` is gated', async () => {
    const ff = fakeFetch();
    const res = await run('do_something', ff.fn);
    expect(res.code).toBe('awaiting_consent');
    expect(ff.calls).toHaveLength(0);
  });

  it('a NON-BOOLEAN `mutates` ("false" as a string) is gated — only a literal false is a read', async () => {
    const ff = fakeFetch();
    const res = await run('stringy', ff.fn);
    expect(res.code).toBe('awaiting_consent');
    expect(ff.calls).toHaveLength(0);
  });

  it('the predicate itself: every falsy-looking non-boolean reads as MUTATING', () => {
    for (const mutates of [undefined, null, 'false', 'no', 0, '', NaN] as unknown[]) {
      expect(actionRequiresConsent({ mutates } as never), `mutates=${String(mutates)}`).toBe(true);
    }
    expect(actionRequiresConsent({ mutates: false })).toBe(false);
    expect(actionRequiresConsent({ mutates: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. An APPROVAL IS NOT TRANSFERABLE (the security half; see also tests/security/)
// ---------------------------------------------------------------------------------------------

describe('an approval is scoped to (org, user, action, shape) and transfers to none of them', () => {
  it('does not transfer to another ACTION of the same integration', async () => {
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('writer', writeAction), 'always');
    const ff = fakeFetch();
    expect((await run('send_message', ff.fn)).success).toBe(true);
    const other = await run('delete_thing', ff.fn);
    expect(other.success).toBe(false);
    expect(other.code).toBe('awaiting_consent');
  });

  it('does not transfer to another INTEGRATION with an identically-named action', async () => {
    await seedDefinition('other-writer', [writeAction]);
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('writer', writeAction), 'always');
    const res = await run('send_message', fakeFetch().fn, OWNER, ORG, 'other-writer');
    expect(res.code).toBe('awaiting_consent');
  });

  it('does not survive the action being RE-AUTHORED — the shape is in the key', async () => {
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('writer', writeAction), 'always');
    const ff = fakeFetch();
    expect((await run('send_message', ff.fn)).success).toBe(true);

    // The same action name, re-authored to post somewhere else. This is criterion 6's second half:
    // an authored action does not become executable on the strength of the answer a human gave to
    // a different action that happened to share its name.
    await seedDefinition('writer', [
      { ...writeAction, httpConfig: { ...writeAction.httpConfig!, baseUrl: 'https://elsewhere.example' } },
    ]);
    const res = await run('send_message', ff.fn);
    expect(res.success).toBe(false);
    expect(res.code).toBe('awaiting_consent');
    expect(res.consentRequest!.target).toBe('POST https://elsewhere.example/messages');
    expect(ff.calls).toHaveLength(1); // only the pre-edit call went out
  });

  it('does not survive a rewritten BODY TEMPLATE either — the payload is part of what was approved', async () => {
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('writer', writeAction), 'always');
    await seedDefinition('writer', [
      { ...writeAction, httpConfig: { ...writeAction.httpConfig!, bodyTemplate: { text: '{{text}}', broadcast: 'all' } } },
    ]);
    expect((await run('send_message', fakeFetch().fn)).code).toBe('awaiting_consent');
  });

  it('EXPIRES: a stored approval past its TTL reads as absent', async () => {
    const d = describeAction('writer', writeAction);
    const past = Date.now() - (ACTION_APPROVAL_TTL_DAYS + 1) * 24 * 60 * 60 * 1000;
    await approveAction({ orgId: ORG, userId: OWNER }, d, 'always', () => past);
    expect((await run('send_message', fakeFetch().fn)).code).toBe('awaiting_consent');
  });

  it('a row with NO expiry is treated as expired, never as permanent (consent.ts J-7 rule)', async () => {
    const d = describeAction('writer', writeAction);
    await approveAction({ orgId: ORG, userId: OWNER }, d, 'always');
    const rows = await approvedIntegrationActions.find({});
    expect(rows).toHaveLength(1);
    await approvedIntegrationActions.update(rows[0]!._id, (cur) => {
      const next = { ...cur };
      delete (next as Record<string, unknown>).expiresAt;
      return next;
    });
    expect((await run('send_message', fakeFetch().fn)).code).toBe('awaiting_consent');
  });

  it('a "once" approval expires on its own SHORT clock, not the 90-day one', async () => {
    expect(ONCE_APPROVAL_TTL_MINUTES).toBeLessThan(60);
    const d = describeAction('writer', writeAction);
    const past = Date.now() - (ONCE_APPROVAL_TTL_MINUTES + 1) * 60 * 1000;
    await approveAction({ orgId: ORG, userId: OWNER }, d, 'once', () => past);
    expect((await run('send_message', fakeFetch().fn)).code).toBe('awaiting_consent');
  });
});

// ---------------------------------------------------------------------------------------------
// 4. The shape function's own determinism
// ---------------------------------------------------------------------------------------------

describe('actionShape is deterministic under key reordering (a Mongo round-trip must not re-prompt)', () => {
  it('the same action with its object keys written in a different order hashes the same', () => {
    const a: IntegrationAction = {
      actionName: 'x', description: 'd', mutates: true,
      httpConfig: { method: 'POST', baseUrl: HOST, path: '/p', headers: { A: '1', B: '2' }, bodyTemplate: { m: 1, n: 2 } },
    };
    const reordered = {
      description: 'd', mutates: true, actionName: 'x',
      httpConfig: { bodyTemplate: { n: 2, m: 1 }, headers: { B: '2', A: '1' }, path: '/p', baseUrl: HOST, method: 'POST' },
    } as unknown as IntegrationAction;
    expect(actionShape('k', reordered)).toBe(actionShape('k', a));
  });

  it('but a changed DESTINATION, METHOD, BINDING or TRANSPORT each produce a different shape', () => {
    const base: IntegrationAction = { actionName: 'x', description: 'd', mutates: true, httpConfig: { method: 'POST', baseUrl: HOST, path: '/p' } };
    const shapes = new Set([
      actionShape('k', base),
      actionShape('k', { ...base, httpConfig: { ...base.httpConfig!, baseUrl: 'https://other.example' } }),
      actionShape('k', { ...base, httpConfig: { ...base.httpConfig!, method: 'PUT' } }),
      actionShape('k', { ...base, httpConfig: { ...base.httpConfig!, path: '/q' } }),
      actionShape('k', { ...base, transport: 'imap' }),
      actionShape('k2', base), // the integration key is in the shape too
    ]);
    expect(shapes.size).toBe(6);
    // The DESCRIPTION is deliberately NOT in it: documentation cannot change what an action does.
    expect(actionShape('k', { ...base, description: 'reworded' })).toBe(actionShape('k', base));
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Entry paths — the gate is in the executor, so every rail hits it
// ---------------------------------------------------------------------------------------------

describe('entry path: the LISTENER rail (no human present) is gated too', () => {
  const TRIGGER: UserDefinedPollTrigger = {
    id: 'trg-write', orgId: ORG, ownerUserId: OWNER, integrationKey: 'poller',
  };

  /** The production dep bundle: `call` is what server.ts binds, only the transport faked. */
  const realDeps = (fetchImpl: FetchLike) => ({
    call: (input: { integrationKey: string; actionName: string; args: Record<string, unknown> }) =>
      executeUserIntegrationAction(
        { orgId: ORG, ownerUserId: OWNER, integrationKey: input.integrationKey, actionName: input.actionName, args: input.args },
        { fetchImpl },
      ),
    readCursor: (id: string) => readListenerCursor(id),
    writeCursor: (id: string, cursor: string) => writeListenerCursor(id, cursor, '2026-08-03T00:00:00.000Z'),
    enqueue: (input: Parameters<typeof enqueueListenerEvent>[0]) => enqueueListenerEvent(input, '2026-08-03T00:00:00.000Z'),
    now: () => '2026-08-03T00:00:00.000Z',
  });

  const listenerConfig = {
    pollAction: 'poll', intervalMs: 60_000, cursorField: 'next',
    eventArrayField: 'items', dedupKeyField: 'id',
  };

  it('a poll action declared NON-mutating polls normally (the rail is not broken by the gate)', async () => {
    await seedDefinition('poller', [{
      actionName: 'poll', description: 'poll', mutates: false,
      httpConfig: { method: 'GET', baseUrl: HOST, path: '/poll' },
    }], { listenerConfig });
    const ff = fakeFetch('{"items":[],"next":"c1"}');
    const res = await pollUserDefinedSource(TRIGGER, realDeps(ff.fn));
    expect(res.initialized).toBe(true);
    expect(ff.calls).toHaveLength(1);
  });

  it('a trigger whose poll action MUTATES is refused at the executor — the tick throws, nothing is sent', async () => {
    // The attack this closes: `pollConfig.actionName` on a trigger can name ANY action of the
    // package, so a listener is a way to run a write on a schedule with nobody watching.
    await seedDefinition('poller', [
      { actionName: 'poll', description: 'poll', mutates: false, httpConfig: { method: 'GET', baseUrl: HOST, path: '/poll' } },
      writeAction,
    ], { listenerConfig: { ...listenerConfig, pollAction: 'send_message' } });
    const ff = fakeFetch('{"items":[],"next":"c1"}');
    await expect(pollUserDefinedSource(TRIGGER, realDeps(ff.fn))).rejects.toThrow(/awaiting_consent|approval/i);
    expect(ff.calls).toHaveLength(0);
  });
});

describe('entry path: every rail still routes through the gated executor', () => {
  const serverSrc = readFileSync(join(__dirname, '..', '..', 'src', 'server.ts'), 'utf-8');
  const capabilitySrc = readFileSync(join(__dirname, '..', '..', 'src', 'integrations', 'integration-capability.ts'), 'utf-8');

  it('the executor has exactly THREE named call sites, each an inventoried rail', () => {
    // Two in the composition root: setIntegrationActionExecutor (the agent tool + the automation
    // `integration` step) and callUserIntegration (the listener supervisor). One in the D1
    // capability core, which is the HTTP rail. A FOURTH appearing without a test is exactly the
    // drift this asserts against — and a rail that grew its own gate is caught by the next case.
    expect(serverSrc.split('executeUserIntegrationAction(').length - 1, 'server.ts executor call sites').toBe(2);
    expect(serverSrc).toContain('setIntegrationActionExecutor(');
    expect(serverSrc).toContain('callUserIntegration:');
    expect(capabilitySrc.split('executeUserIntegrationAction(').length - 1, 'integration-capability.ts executor call sites').toBe(1);
  });

  it('THE WHOLE TREE, not just server.ts: no unaccounted file calls the executor', () => {
    // WHY THIS EXISTS (2026-08-03 review, LOW). The assertion above counts occurrences IN
    // `server.ts` only, so a brand-new rail added in ANY OTHER file contributed zero to that count
    // and the guard stayed green while the funnel grew a door — which is the precise failure it was
    // written to prevent. It had already happened: the capability router (slice D1) calls the
    // executor from `integrations/integration-capability.ts`, invisible to the count.
    //
    // The invariant is NOT "only server.ts may call it" — a rail routing THROUGH the executor is
    // exactly right, because that is how it inherits the write gate. The invariant is that every
    // caller is ACCOUNTED FOR: an entry here is a claim that the rail was reviewed and is covered.
    // A file missing from disk is fine (rails come and go); a file not on the list is not.
    const ACCOUNTED_RAILS = [
      'server.ts', // the composition root: the agent/automation seam + the listener supervisor
      'integrations/action-executor.ts', // the executor itself (its own declaration)
      'integrations/integration-capability.ts', // D1's public capability router — inherits the gate
      // The served-app email plane. Reviewed 2026-08-06: it dispatches a USER-defined email
      // integration through this executor (so the gate applies unchanged) and a PLATFORM one
      // through callPlatformIntegration with the app OWNER as actingUserId (so the platform write
      // gate applies too). It carries NO consent check of its own — it surfaces `awaiting_consent`
      // from whichever executor answered. Custody: the owner is resolved server-side from the
      // admitted app scope, never from the page. Suite: integrations/app-email.test.ts.
      'integrations/app-email.ts',
    ];
    const src = join(__dirname, '..', '..', 'src');
    const callers = spawnSync(
      'grep',
      ['-rlF', '--include=*.ts', 'executeUserIntegrationAction(', src],
      { encoding: 'utf-8' },
    ).stdout
      .split('\n')
      .filter(Boolean)
      .map((p) => relative(src, p))
      .sort();
    const unaccounted = callers.filter((f) => !ACCOUNTED_RAILS.includes(f));
    expect(
      unaccounted,
      'a NEW rail calls executeUserIntegrationAction — add it here once its consent + credential-custody coverage is reviewed',
    ).toEqual([]);
    expect(callers).toContain('server.ts');
  });

  it('the gate is in the EXECUTOR, not bolted onto a caller: no rail carries its own consent check', () => {
    // If a future change moves the check to a call site, the executor stops being the funnel and
    // the other rails silently lose the gate. So: the consent module is imported by the executor
    // and by the route surface that ANSWERS the prompt — and by nothing that merely calls actions.
    const executorSrc = readFileSync(join(__dirname, '..', '..', 'src', 'integrations', 'action-executor.ts'), 'utf-8');
    expect(executorSrc).toContain('checkActionConsent(');
    expect(serverSrc).not.toContain('checkActionConsent');
    // …and the check precedes the DECRYPT in source order, which the behavioural tests above prove
    // at run time; asserted here too so a reorder is caught at the file it happens in.
    //
    // IT IS THE DECRYPT, NOT THE ROW READ (2026-08-03 review, CRITICAL-1). The config row is now
    // fetched ABOVE the gate, deliberately: the definition governing a credential has to be
    // resolved as that credential's CUSTODIAN, and the custodian is a field on the row, so the row
    // must be in hand before the package is resolved. Nothing about the gate's guarantee moved —
    // no credential is decrypted before it, and `not_connected`/`disabled` still answer after it,
    // so an unapproved caller still cannot probe connection state (pinned behaviourally above).
    expect(executorSrc.indexOf('checkActionConsent(')).toBeLessThan(executorSrc.indexOf('await decryptCredentialFields('));
    expect(executorSrc.indexOf('checkActionConsent(')).toBeLessThan(executorSrc.indexOf("code: 'not_connected'"));
  });
});

// ---------------------------------------------------------------------------------------------
// 6. A connected, credentialed integration (the full path, end to end)
// ---------------------------------------------------------------------------------------------

describe('with a real connected credential row, an approved write goes out and an unapproved one does not', () => {
  beforeEach(async () => {
    await seedDefinition('writer', [readAction, writeAction], { authType: 'api_key' });
    await createConfig(actor(), { integrationKey: 'writer', configValues: { api_key: 'k-runtime' } }, deps);
  });

  it('unapproved: refused, zero requests', async () => {
    const ff = fakeFetch();
    expect((await run('send_message', ff.fn)).code).toBe('awaiting_consent');
    expect(ff.calls).toHaveLength(0);
  });

  it('approved: the request goes out to the bound host', async () => {
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('writer', writeAction), 'always');
    const ff = fakeFetch();
    const res = await run('send_message', ff.fn);
    expect(res.success).toBe(true);
    expect(ff.calls).toEqual([`${HOST}/messages`]);
  });
});
