import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../../src/cli/commands/serve.js';
import { loadConfig, saveConfig, type BridgeConfig, type FetchLike } from '../../src/auth/index.js';
import { EXIT, type CliContext } from '../../src/cli/context.js';
import { pt } from '../../src/i18n/pt.js';

/**
 * `serve` learning its TASK BINDING from the token mint (the P0.1 regression).
 *
 * Cortex owns both halves of the binding - the pairing's HMAC signing secret and the org it is
 * scoped to - and returns them on `POST /bridge/token`, which the daemon calls once per dial. The
 * daemon used to parse only `token`, so it verified every delegated task against an empty secret
 * and an empty org and denied all of them. These cases pin the three behaviours that fix it:
 * the mint's values are ADOPTED, they are PERSISTED, and a later mint REBINDS a running daemon
 * without a restart (a re-pair or admin secret reset lands on the next reconnect of a process that
 * may have been up for weeks).
 *
 * No real network: the socket dials a closed loopback port, so it never opens and the run unwinds
 * on SIGINT. The mint itself is a fake fetch.
 */

const NOW = 1_700_000_000_000;
let home: string;

beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ekoa-bind-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A paired config with a far-future platform credential (so no /auth/refresh hop is needed). */
function pairedConfig(over: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    // Port 1 is never listening, so the WS dial fails and retries under backoff - the mint still
    // runs, which is the whole point: `getToken` is awaited BEFORE the socket is opened.
    cortexBaseUrl: 'http://127.0.0.1:1',
    pairingId: 'p-1',
    credentials: { access: 'platform-jwt', refresh: 'platform-jwt', expires: NOW + 86_400_000, user: { id: 'u1', username: 'ana', role: 'user' } },
    ...over,
  };
}

/** A free-ish high port per test so two runs never fight over the loopback surface. */
let portSeq = 0;
function surfacePort(): number { return 39_000 + ((process.pid + portSeq++) % 2000); }

interface Run { code: Promise<number>; out: string[]; stop: () => void }

function startServe(mints: unknown[]): Run {
  const out: string[] = [];
  let mintIndex = 0;
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/bridge/token')) {
      const body = mints[Math.min(mintIndex, mints.length - 1)];
      mintIndex += 1;
      return jsonResponse(body);
    }
    throw new Error(`unexpected url ${url}`);
  };
  const ctx: CliContext = {
    home,
    io: { out: (l) => out.push(l), err: (l) => out.push(l) },
    fetchImpl,
    now: () => NOW,
    sleep: async () => {},
    env: {},
    pickFolder: async () => ({ ok: false, reason: 'unavailable' }),
    randomSuffix: () => 'sfx',
  };
  const code = serve(['--port', String(surfacePort())], ctx);
  return { code, out, stop: () => { process.emit('SIGINT'); } };
}

/** Poll until `check` holds or the budget runs out (the dial + mint are async). */
async function waitFor(check: () => boolean, label: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('serve - the task binding is learned from the token mint', () => {
  it('adopts and PERSISTS the signingSecret + org a first mint returns', async () => {
    saveConfig(home, pairedConfig());
    const run = startServe([{ token: 'bt', expiresIn: 600, signingSecret: 'hmac-1', org: 'orgA' }]);
    try {
      await waitFor(() => loadConfig(home)?.signingSecret === 'hmac-1', 'the first binding to persist');
      const saved = loadConfig(home)!;
      expect(saved.org).toBe('orgA');
      expect(saved.signingSecret).toBe('hmac-1');
      // The platform credential is not collateral damage of the binding write.
      expect(saved.credentials?.access).toBe('platform-jwt');
      expect(run.out).toContain(pt.serveBindingUpdated);
    } finally {
      run.stop();
      await expect(run.code).resolves.toBe(EXIT.OK);
    }
  });

  it('REBINDS on a later mint: a rotated secret takes effect and is persisted, no restart', async () => {
    saveConfig(home, pairedConfig({ org: 'orgA', signingSecret: 'hmac-old' }));
    // The dial fails against port 1 and retries, so the second mint arrives on the next dial -
    // exactly how a real rotation reaches a long-lived daemon.
    const run = startServe([
      { token: 'bt', expiresIn: 600, signingSecret: 'hmac-old', org: 'orgA' },
      { token: 'bt2', expiresIn: 600, signingSecret: 'hmac-new', org: 'orgB' },
    ]);
    try {
      await waitFor(() => loadConfig(home)?.signingSecret === 'hmac-new', 'the rotated binding to persist', 15_000);
      expect(loadConfig(home)!.org).toBe('orgB');
    } finally {
      run.stop();
      await expect(run.code).resolves.toBe(EXIT.OK);
    }
  }, 20_000);

  it('a mint that OMITS the binding leaves a working one intact (absent means silent, not "none")', async () => {
    saveConfig(home, pairedConfig({ org: 'orgA', signingSecret: 'hmac-keep' }));
    const run = startServe([{ token: 'bt', expiresIn: 600 }]);
    try {
      // Nothing to wait on when nothing should change, so give the dial + mint room to have run.
      await waitFor(() => run.out.some((l) => l.startsWith('Estado da ligação')), 'the first dial');
      await new Promise((r) => setTimeout(r, 50));
      const saved = loadConfig(home)!;
      expect(saved.signingSecret).toBe('hmac-keep');
      expect(saved.org).toBe('orgA');
      expect(run.out).not.toContain(pt.serveBindingUpdated);
    } finally {
      run.stop();
      await expect(run.code).resolves.toBe(EXIT.OK);
    }
  });
});
