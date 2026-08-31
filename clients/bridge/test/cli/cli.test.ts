import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main, isCliEntrypoint } from '../../src/cli/index.js';
import { configPath, loadConfig, type FetchLike } from '../../src/auth/index.js';
import { EXIT, type CliContext } from '../../src/cli/context.js';
import { pt } from '../../src/i18n/pt.js';

/**
 * The CLI commands, exercised through main() with an injected context (scratch EKOA_BRIDGE_HOME,
 * captured IO, fake fetch/clock, stubbed folder picker) — no real network, no waits, and NEVER the
 * real osascript picker. One spawned smoke runs the built binary end to end when dist exists.
 */

const NOW = 1_700_000_000_000;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-cli-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake fetch that drives device login straight to "approved". */
const approvingFetch: FetchLike = async (input) => {
  const url = String(input);
  if (url.endsWith('/api/v1/auth/device')) {
    return jsonResponse({ deviceCode: 'dc', userCode: 'BCDF-2345', verificationUri: '/settings/devices', interval: 5, expiresIn: 600 });
  }
  if (url.endsWith('/api/v1/auth/device/poll')) {
    return jsonResponse({ status: 'approved', token: 'jwt-cli', user: { id: 'u1', username: 'ana', role: 'user' }, expiresIn: 3600 });
  }
  throw new Error(`unexpected url ${url}`);
};

async function run(argv: string[], over: Partial<CliContext> = {}): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const base: Partial<CliContext> = {
    home,
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    now: () => NOW,
    sleep: async () => {},
    env: {},
    pickFolder: async () => ({ ok: false, reason: 'unavailable' }),
    randomSuffix: () => 'sfx',
    fetchImpl: async () => jsonResponse({}),
  };
  const code = await main(argv, { ...base, ...over });
  return { code, out, err };
}

describe('cli — status on an unpaired home', () => {
  it('reports "não emparelhado" and exits 0', async () => {
    const { code, out } = await run(['status']);
    expect(code).toBe(EXIT.OK);
    expect(out.join('\n')).toContain(pt.statusNotPaired);
  });
});

describe('cli — pair → status → unpair round trip', () => {
  it('pairs (writing config 0600), reports paired status, then unpairs', async () => {
    const paired = await run(['pair', '--url', 'https://cortex.example', '--pairing-id', 'p-test'], {
      fetchImpl: approvingFetch,
    });
    expect(paired.code).toBe(EXIT.OK);
    expect(paired.out.join('\n')).toContain('BCDF-2345'); // the code was surfaced to the user
    expect(paired.out.join('\n')).toContain(pt.pairSuccess('ana'));

    // config.json exists, 0600, with the stored pairing + credential.
    expect(statSync(configPath(home)).mode & 0o777).toBe(0o600);
    const config = loadConfig(home);
    expect(config?.pairingId).toBe('p-test');
    expect(config?.cortexBaseUrl).toBe('https://cortex.example');
    expect(config?.credentials?.access).toBe('jwt-cli');
    expect(config?.credentials?.expires).toBe(NOW + 3600 * 1000);

    const status = await run(['status']);
    expect(status.code).toBe(EXIT.OK);
    const statusText = status.out.join('\n');
    expect(statusText).toContain(pt.statusPairing('p-test', 'https://cortex.example'));
    expect(statusText).toContain('válida'); // credential not expired
    expect(statusText).toContain(pt.statusServeStopped);

    const unpaired = await run(['unpair']);
    expect(unpaired.code).toBe(EXIT.OK);
    expect(unpaired.out.join('\n')).toContain(pt.unpairDone);
    expect(existsSync(configPath(home))).toBe(false);

    const after = await run(['status']);
    expect(after.out.join('\n')).toContain(pt.statusNotPaired);
  });

  it('a RE-PAIR carries the operator decisions forward, not just the identity', async () => {
    // WHAT THIS PINS, and why it is not cosmetic. `extraCapabilities` and `egressProxy` were
    // dropped on re-pair (found 2026-08-31 re-pairing after an ephemeral-Mongo wipe), and both
    // failures are silent and misleading:
    //   - a dropped `desktop.automation` (a tier-2 opt-in that exists ONLY as this config edit)
    //     makes the daemon stop advertising, so Cortex refuses attended flows with a message
    //     about the bridge being too OLD - pointing at a version instead of an erased opt-in;
    //   - a dropped `egressProxy` means no residential endpoint is served, so `checkoutSession`
    //     refuses to release the session this very machine just captured. A re-pair therefore
    //     re-opened a HIGH finding that had already been fixed.
    await run(['pair', '--url', 'https://cortex.example', '--pairing-id', 'p-one'], { fetchImpl: approvingFetch });
    // Stand in for the operator's own edits to the config file.
    const first = loadConfig(home)!;
    writeFileSync(configPath(home), JSON.stringify({
      ...first,
      org: 'org-9',
      signingSecret: 'sig-9',
      extraCapabilities: ['desktop.automation'],
      egressProxy: true,
    }), { mode: 0o600 });

    const again = await run(['pair', '--url', 'https://cortex.example', '--pairing-id', 'p-two'], {
      fetchImpl: approvingFetch,
    });
    expect(again.code).toBe(EXIT.OK);

    const after = loadConfig(home) as Record<string, unknown>;
    // The IDENTITY half is replaced...
    expect(after.pairingId).toBe('p-two');
    // ...and every operator decision survives.
    expect(after.org).toBe('org-9');
    expect(after.signingSecret).toBe('sig-9');
    expect(after.extraCapabilities).toEqual(['desktop.automation']);
    expect(after.egressProxy).toBe(true);
  });

  it('a RE-PAIR keeps an explicit egressProxy:false rather than treating it as absent', async () => {
    // Carried by PRESENCE, not truthiness: `false` is an answer the operator gave.
    await run(['pair', '--url', 'https://cortex.example', '--pairing-id', 'p-one'], { fetchImpl: approvingFetch });
    const first = loadConfig(home)!;
    writeFileSync(configPath(home), JSON.stringify({ ...first, egressProxy: false }), { mode: 0o600 });

    await run(['pair', '--url', 'https://cortex.example', '--pairing-id', 'p-two'], { fetchImpl: approvingFetch });
    const after = loadConfig(home) as Record<string, unknown>;
    expect(after.egressProxy).toBe(false);
  });

  it('pair without --url is a usage error (exit 2)', async () => {
    const { code, err } = await run(['pair']);
    expect(code).toBe(EXIT.USAGE);
    expect(err.join('\n')).toContain(pt.pairUrlRequired);
  });

  it('a denied device login exits 1 with the PT-PT message and writes no config', async () => {
    const denyFetch: FetchLike = async (input) =>
      String(input).endsWith('/api/v1/auth/device')
        ? jsonResponse({ deviceCode: 'dc', userCode: 'BCDF-2345', verificationUri: '/x', interval: 5, expiresIn: 600 })
        : jsonResponse({ status: 'denied' });
    const { code, err } = await run(['pair', '--url', 'https://cortex.example'], { fetchImpl: denyFetch });
    expect(code).toBe(EXIT.ERROR);
    expect(err.join('\n')).toContain(pt.deviceDenied);
    expect(existsSync(configPath(home))).toBe(false);
  });
});

describe('cli — grant', () => {
  let grantable: string;
  beforeEach(() => {
    grantable = mkdtempSync(join(tmpdir(), 'ekoa-grantable-'));
  });
  afterEach(() => {
    rmSync(grantable, { recursive: true, force: true });
  });

  it('grant add --path records a 0600 grants.json and exits 0', async () => {
    const { code, out } = await run(['grant', 'add', '--path', grantable, '--session', 's-1']);
    expect(code).toBe(EXIT.OK);
    expect(out.join('\n')).toContain('g-sfx');
    const grantsFile = join(home, 'grants.json');
    expect(statSync(grantsFile).mode & 0o777).toBe(0o600);
  });

  it('grant add with no --path uses the folder picker', async () => {
    const { code, out } = await run(['grant', 'add'], {
      pickFolder: async () => ({ ok: true, path: grantable }),
    });
    expect(code).toBe(EXIT.OK);
    expect(out.join('\n')).toContain(pt.grantAdded('g-sfx', resolve(grantable), 'default'));
  });

  it('grant add with no --path and no picker is a usage error (exit 2)', async () => {
    const { code, err } = await run(['grant', 'add'], {
      pickFolder: async () => ({ ok: false, reason: 'unavailable' }),
    });
    expect(code).toBe(EXIT.USAGE);
    expect(err.join('\n')).toContain(pt.grantNoPath);
  });

  it('grant add with a cancelled picker exits 1', async () => {
    const { code, err } = await run(['grant', 'add'], {
      pickFolder: async () => ({ ok: false, reason: 'cancelled' }),
    });
    expect(code).toBe(EXIT.ERROR);
    expect(err.join('\n')).toContain(pt.grantPickerCancelled);
  });

  it('grant add --path to a non-directory exits 1', async () => {
    const { code, err } = await run(['grant', 'add', '--path', join(grantable, 'nope')]);
    expect(code).toBe(EXIT.ERROR);
    expect(err.join('\n')).toContain('não é uma pasta');
  });
});

describe('cli — dispatch and serve preflight', () => {
  it('an unknown command exits 2 with the unknown-command message', async () => {
    const { code, err } = await run(['frobnicate']);
    expect(code).toBe(EXIT.USAGE);
    expect(err.join('\n')).toContain(pt.unknownCommand('frobnicate'));
  });

  it('no command prints help and exits 0', async () => {
    const { code, out } = await run([]);
    expect(code).toBe(EXIT.OK);
    expect(out.join('\n')).toContain(pt.cliUsage);
  });

  it('serve without a pairing exits 1 (no credentials) and opens no socket', async () => {
    const { code, err } = await run(['serve']);
    expect(code).toBe(EXIT.ERROR);
    expect(err.join('\n')).toContain(pt.tokenNoCredentials);
  });

  it('serve refuses to start when a LIVE daemon already owns this home (review fix)', async () => {
    // Spawn a real, still-alive process and write its PID into daemon.pid, so the pre-flight sees a
    // live daemon (a stale pidfile from a crash would read as not-alive and be ignored instead).
    const { spawn } = await import('node:child_process');
    const child = spawn('node', ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    try {
      await new Promise<void>((r) => child.once('spawn', () => r()));
      const { writeDaemonPid } = await import('../../src/cli/pidfile.js');
      const { ensureHome } = await import('../../src/auth/index.js');
      writeDaemonPid(ensureHome(home), child.pid!);
      const { code, err } = await run(['serve']);
      expect(code).toBe(EXIT.ERROR);
      expect(err.join('\n')).toContain(pt.serveAlreadyRunning(child.pid!));
    } finally {
      child.kill();
    }
  });
});

// The run guard: `main()` fires only when the module IS the entry script. The compare must be
// symlink-safe, because `npm i -g` installs the bin as a symlink whose path differs from the
// module realpath — a naive compare no-ops every global install (regression fixed 2026-07-11).
describe('cli — isCliEntrypoint (symlink-safe run guard)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ekoa-entry-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('true when argv[1] is the module file itself', () => {
    const file = join(dir, 'index.js');
    writeFileSync(file, '');
    expect(isCliEntrypoint(file, pathToFileURL(file).href)).toBe(true);
  });

  it('true when argv[1] is a SYMLINK to the module (the `npm i -g` layout)', () => {
    const file = join(dir, 'index.js');
    writeFileSync(file, '');
    const link = join(dir, 'ekoa-bridge'); // npm's <prefix>/bin symlink
    symlinkSync(file, link);
    // Before the fix this returned false (link path !== module realpath) and the CLI no-opped.
    // Inode identity (statSync follows the link) makes it true.
    expect(isCliEntrypoint(link, pathToFileURL(file).href)).toBe(true);
  });

  it('false for undefined argv[1] or an unrelated module (imported, not executed)', () => {
    const file = join(dir, 'index.js');
    writeFileSync(file, '');
    expect(isCliEntrypoint(undefined, pathToFileURL(file).href)).toBe(false);
    expect(isCliEntrypoint(file, 'file:///some/other/module.js')).toBe(false);
  });
});

// End-to-end smokes against the BUILT binary. Skipped until `npm run build` has produced dist.
const builtCli = resolve(process.cwd(), 'dist/cli/index.js');
describe.skipIf(!existsSync(builtCli))('cli — built binary smoke', () => {
  it('`node dist/cli/index.js status` against a scratch home exits 0', () => {
    const smokeHome = mkdtempSync(join(tmpdir(), 'ekoa-smoke-'));
    try {
      const res = spawnSync('node', [builtCli, 'status'], {
        env: { ...process.env, EKOA_BRIDGE_HOME: smokeHome, CI: '1' },
        encoding: 'utf-8',
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(pt.statusNotPaired);
    } finally {
      rmSync(smokeHome, { recursive: true, force: true });
    }
  });

  it('runs through a SYMLINKED bin (`npm i -g` layout), not just the realpath', () => {
    // Reproduce npm's global layout: a bin symlink pointing at dist/cli/index.js. The CLI must
    // print usage through the link — the exact path a downloaded, globally-installed bridge takes.
    const linkDir = mkdtempSync(join(tmpdir(), 'ekoa-binlink-'));
    const link = join(linkDir, 'ekoa-bridge');
    try {
      symlinkSync(builtCli, link);
      const res = spawnSync('node', [link, 'help'], { encoding: 'utf-8' });
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('Utilização'); // pt.cliUsage — empty before the guard fix
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
    }
  });
});
