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

function capturingTransportRejectOnly(): ChokepointTransport {
  return {
    // eslint-disable-next-line require-yield
    async *streamAgent() { throw new Error('unreached'); },
    async oneShot() { throw new Error('unreached'); },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
}

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
describe('F25 finding 2: an unconfigured credential REJECTS (never hangs) — sandbox lifecycle inside the try', () => {
  it('runOneShot with no credential rejects rather than hanging', async () => {
    __resetCredentialsForTests(); // getSecret now throws
    __setTransportForTests(capturingTransportRejectOnly());
    await expect(
      Promise.race([
        runOneShot({ prompt: 'q', decision: decideForTier('FAST') }, { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'u' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG')), 3000)),
      ]),
    ).rejects.not.toThrow('HUNG');
  });

  it('runAgent with no credential rejects `result` rather than hanging', async () => {
    __resetCredentialsForTests();
    __setTransportForTests(capturingTransportRejectOnly());
    const handle = runAgent({ prompt: 'q', decision: decideForTier('WORKHORSE') }, tenant);
    try { for await (const _ of handle.events) { /* drain */ } } catch { /* expected */ }
    await expect(
      Promise.race([handle.result, new Promise((_, rej) => setTimeout(() => rej(new Error('HUNG')), 3000))]),
    ).rejects.not.toThrow('HUNG');
  });
});

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

/**
 * F25 memory-vector (S7 review question 5): the ORIGINAL leak included an operator AUTO-MEMORY,
 * not just a path. HOME=sandbox + settingSources:[] close the `~/.claude` path, but the inherited
 * env still carries the operator's Claude Code SESSION IDENTITY (`CLAUDE_CODE_SESSION_ID` and the
 * other CLAUDE_*), and `XDG_*_HOME` can point config/state/memory reads OUTSIDE HOME — defeating
 * the HOME sandbox. A tenant subprocess must carry NONE of the operator's session/config identity.
 */
import { buildSubprocessEnv } from '../../src/llm/credentials.js';

describe('F25: the subprocess env carries no operator Claude-Code session or XDG identity', () => {
  it('strips inherited CLAUDE_*/XDG_*_HOME while keeping the vars the chokepoint sets', async () => {
    const saved = { ...process.env };
    try {
      process.env.CLAUDE_CODE_SESSION_ID = 'operator-session-xyz';
      process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
      process.env.CLAUDE_EFFORT = 'ultracode';
      process.env.XDG_CONFIG_HOME = '/home/operator/.config'; // would redirect ~/.claude reads
      process.env.XDG_DATA_HOME = '/home/operator/.local/share';
      const env = await buildSubprocessEnv({ homeDir: '/tmp/ekoa-run-xyz' });

      // operator session identity is gone
      expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
      expect(env.CLAUDE_EFFORT).toBeUndefined();
      // XDG per-user home vars cannot escape the sandbox
      expect(env.XDG_CONFIG_HOME).not.toBe('/home/operator/.config');
      expect(env.XDG_DATA_HOME).not.toBe('/home/operator/.local/share');
      const serialized = JSON.stringify(env);
      expect(serialized).not.toContain('operator-session-xyz');
      expect(serialized).not.toContain('/home/operator');

      // the vars the chokepoint itself sets survive
      expect(env.ANTHROPIC_BASE_URL).toBeTruthy();
      expect(env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS).toBe('1');
      expect(env.HOME).toBe('/tmp/ekoa-run-xyz');
    } finally {
      for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_EFFORT', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });

  it('drops the operator HOME path from PATH + other vars, and the operator username (S7 finding 1)', async () => {
    const saved = { ...process.env };
    try {
      process.env.HOME = '/home/operator';
      process.env.USER = 'operator'; process.env.LOGNAME = 'operator'; process.env.USERNAME = 'operator';
      process.env.NVM_DIR = '/home/operator/.nvm';
      process.env.PATH = '/home/operator/.claude/skills/watch/bin:/home/operator/.nvm/v/bin:/usr/bin:/bin';
      const env = await buildSubprocessEnv({ homeDir: '/tmp/ekoa-run-z' });

      // no operator home path survives anywhere (PATH segments, NVM_DIR, ...)
      const serialized = JSON.stringify(env);
      expect(serialized).not.toContain('/home/operator');
      // the operator username identity is gone
      expect(env.USER).toBeUndefined();
      expect(env.LOGNAME).toBeUndefined();
      expect(env.USERNAME).toBeUndefined();
      // PATH is filtered, not emptied — the system dirs remain so the spawn can still find node
      expect(env.PATH!.split(':')).toContain('/usr/bin');
    } finally {
      for (const k of ['HOME', 'USER', 'LOGNAME', 'USERNAME', 'NVM_DIR', 'PATH']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });

  it('the PATH filter never empties PATH even if the server root is a short/edge path (S7 finding 3)', async () => {
    const saved = { ...process.env };
    try {
      // a sibling dir must NOT be over-matched: /repo/ekoa filtering /repo/ekoa-2 out.
      process.env.INIT_CWD = '/repo/ekoa';
      process.env.PATH = '/repo/ekoa/node_modules/.bin:/repo/ekoa-2/bin:/usr/bin';
      const env = await buildSubprocessEnv({ homeDir: '/tmp/ekoa-run-p' });
      const segs = env.PATH!.split(':');
      expect(segs).not.toContain('/repo/ekoa/node_modules/.bin'); // under the root -> filtered
      expect(segs).toContain('/repo/ekoa-2/bin');                 // a SIBLING -> kept (boundary, not startsWith)
      expect(segs).toContain('/usr/bin');
    } finally {
      for (const k of ['INIT_CWD', 'PATH']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });
});
