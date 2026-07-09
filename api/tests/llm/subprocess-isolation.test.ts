import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import {
  runAgent,
  runOneShot,
  setOrgResolver,
  __resetOrgResolverForTests,
  __setTransportForTests,
  __resetTransportForTests,
  type ChokepointTransport,
  type SdkCallParams,
} from '../../src/llm/client.js';
import { decideForTier } from '../../src/llm/router.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { __resetAttributionCountersForTests } from '../../src/llm/attribution.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';
import { __resetPlatformBilleeForTests } from '../../src/billing/tracker.js';
import { setRulesetResolver, __resetRulesetResolverForTests, __resetVaultForTests, __resetAuditForTests, type OrgRuleset } from '../../src/llm/anonymise/index.js';

/**
 * F25 (batch-1 S7) — host-context isolation of the SDK subprocess (ch05 §5.4.1).
 *
 * The observed symptom was a TENANT chat reply surfacing the OPERATOR's host context: the path
 * `~/dev/ekoa-code` and an operator auto-memory. The deterministic mechanism, pinned here:
 * `build` runs pass `cwd`+`homeDir` (the project sandbox), but chat / brand-research / one-shot
 * passed NEITHER — so the spawned subprocess inherited the API server's `process.cwd()` (the repo
 * checkout) and `HOME` (the operator home). The Agent SDK tells the model its working directory,
 * which alone explains the leaked path; an inherited `HOME` is what would put `~/.claude` in reach.
 *
 * These assertions are LLM-free: they check what the chokepoint hands the transport, so they hold
 * regardless of whether a given model happens to echo the path back.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;

function capturingTransport(sink: { calls: SdkCallParams[] }): ChokepointTransport {
  return {
    async *streamAgent(p) {
      sink.calls.push(p);
      yield { kind: 'final', text: 'ok', usage: { input: 1, output: 1, cacheCreate: 0, cacheRead: 0 }, aborted: false };
    },
    async oneShot(p) {
      sink.calls.push(p);
      return { text: 'ok', usage: { input: 1, output: 1, cacheCreate: 0, cacheRead: 0 } };
    },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_subprocess_isolation');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetTransportForTests(); __resetCredentialsForTests(); __resetAttributionCountersForTests();
  __resetRateCapsForTests(); __resetOrgResolverForTests(); __resetPlatformBilleeForTests();
  __resetRulesetResolverForTests(); __resetVaultForTests(); __resetAuditForTests();
  for (const c of ['token_events', 'billing_accounts', 'credentials', 'settings', 'users', 'activity_logs']) {
    await getDb().collection(c).deleteMany({});
  }
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 3_600_000 });
  setOrgResolver(async () => 'org1');
  setRulesetResolver((orgId): OrgRuleset => ({ orgId }));
});

const tenant = { kind: 'user_work', agentType: 'chat', billeeUserId: 'tenant-user', sessionId: 'conv-1' } as const;

describe('F25: a tenant subprocess never inherits the host cwd or HOME', () => {
  it('runAgent with no cwd/homeDir gets an ISOLATED sandbox — not the API server\'s repo checkout', async () => {
    const sink = { calls: [] as SdkCallParams[] };
    __setTransportForTests(capturingTransport(sink));

    const handle = runAgent({ prompt: 'olá', decision: decideForTier('WORKHORSE') }, tenant);
    for await (const _ of handle.events) { /* drain */ }
    await handle.result;

    const call = sink.calls[0]!;
    // The SDK tells the model its working directory: it must NOT be the host repo checkout.
    expect(call.cwd, 'cwd must be set to an isolated sandbox').toBeTruthy();
    expect(call.cwd).not.toBe(process.cwd());
    expect(call.cwd!).not.toContain('ekoa-code');
    // HOME must not be the operator home (which is what puts ~/.claude in reach).
    expect(call.env.HOME).toBeTruthy();
    expect(call.env.HOME).not.toBe(process.env.HOME);
    expect(call.env.HOME).toBe(call.cwd);
  });

  it('runOneShot is isolated the same way (brand-research + classifier one-shots)', async () => {
    const sink = { calls: [] as SdkCallParams[] };
    __setTransportForTests(capturingTransport(sink));
    await runOneShot({ prompt: 'q', decision: decideForTier('FAST') }, { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'tenant-user' });
    const call = sink.calls[0]!;
    expect(call.cwd).toBeTruthy();
    expect(call.cwd).not.toBe(process.cwd());
    expect(call.env.HOME).not.toBe(process.env.HOME);
  });

  it('an explicit cwd/homeDir (build runs) is respected — isolation never overrides the caller', async () => {
    const sink = { calls: [] as SdkCallParams[] };
    __setTransportForTests(capturingTransport(sink));
    const handle = runAgent(
      { prompt: 'build', decision: decideForTier('EXPERT'), cwd: '/tmp/proj-x', homeDir: '/tmp/proj-x' },
      { kind: 'user_work', agentType: 'build', billeeUserId: 'tenant-user', sessionId: 'c2' },
    );
    for await (const _ of handle.events) { /* drain */ }
    await handle.result;
    const call = sink.calls[0]!;
    expect(call.cwd).toBe('/tmp/proj-x');
    expect(call.env.HOME).toBe('/tmp/proj-x');
  });

  it('the sandbox is EMPTY and per-run: two runs get different dirs, and no host path appears in the spawn contract', async () => {
    const sink = { calls: [] as SdkCallParams[] };
    __setTransportForTests(capturingTransport(sink));
    for (const s of ['a', 'b']) {
      const h = runAgent({ prompt: s, decision: decideForTier('WORKHORSE') }, { ...tenant, sessionId: `conv-${s}` });
      for await (const _ of h.events) { /* drain */ }
      await h.result;
    }
    const [c1, c2] = sink.calls;
    expect(c1!.cwd).not.toBe(c2!.cwd); // per-run, not a shared scratch

    // Nothing in the spawn contract may carry the operator's home or the repo checkout.
    const serialized = JSON.stringify({ cwd: c1!.cwd, env: c1!.env });
    expect(serialized).not.toContain('ekoa-code');
    const home = process.env.HOME;
    if (home && home !== '/') expect(serialized).not.toContain(`"${home}"`);
  });
});

/**
 * A separate hazard found while proving F25 (S5 re-review finding 1): when the SDK stream throws,
 * `runAgent` rejects BOTH the events generator and the `result` promise. Every consumer drains
 * `handle.events` first and only then awaits `handle.result`, so on a stream error the `for await`
 * throws and `result`'s rejection is never handled — an unhandled rejection on every failed run
 * (chat, build, brand-research). In tests it turns a green suite into a non-zero exit; in prod it
 * is swallowed by the process-level handler, masking the real error. The chokepoint must mark the
 * promise handled without swallowing it for genuine awaiters.
 */
describe('runAgent: a failing stream never produces an UNHANDLED rejection', () => {
  it('draining only the events generator (never awaiting result) leaves no unhandled rejection', async () => {
    __setTransportForTests({
      // eslint-disable-next-line require-yield
      async *streamAgent() { throw new Error('transport exploded'); },
      async oneShot() { throw new Error('nope'); },
      async messages() { return { status: 500, headers: {}, body: '{}' }; },
    });
    const handle = runAgent({ prompt: 'x', decision: decideForTier('WORKHORSE') }, tenant);
    // Exactly what every consumer does: drain the stream, and on a throw never reach `await result`.
    try {
      for await (const _ of handle.events) { /* drain */ }
    } catch (e) {
      expect((e as Error).message).toContain('transport exploded');
    }
    // Turn the microtask/macrotask queue. Pre-fix, `result`'s rejection is unhandled here and
    // vitest exits non-zero even though every assertion passed (which is how this hid).
    await new Promise((r) => setTimeout(r, 30));
  });

  it('`result` still rejects for a genuine awaiter (pre-handling must not swallow the error)', async () => {
    __setTransportForTests({
      // eslint-disable-next-line require-yield
      async *streamAgent() { throw new Error('transport exploded'); },
      async oneShot() { throw new Error('nope'); },
      async messages() { return { status: 500, headers: {}, body: '{}' }; },
    });
    const handle = runAgent({ prompt: 'x', decision: decideForTier('WORKHORSE') }, tenant);
    // `events` is a lazy generator: nothing runs (and `result` cannot settle) until it is drained.
    try { for await (const _ of handle.events) { /* drain */ } } catch { /* expected */ }
    await expect(handle.result).rejects.toThrow('transport exploded');
  });
});
