import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enableAutostart,
  disableAutostart,
  autostartStatus,
  launchdPlist,
  registrationPath,
  AutostartError,
  AUTOSTART_LABEL,
  SYSTEMD_UNIT,
  type AutostartDeps,
} from '../../src/autostart/index.js';
import { autostart } from '../../src/cli/commands/autostart.js';
import { EXIT, type CliContext } from '../../src/cli/context.js';

/**
 * Reboot survival (launchd LaunchAgent / systemd user unit). These assert the REAL file contents
 * and the REAL command sequences against a fake launchctl/systemctl — the properties that make the
 * registration work on the machines it exists for (nvm paths, Aqua session, crash throttle), not
 * that Apple's launchd behaves.
 */

interface Call {
  cmd: string;
  args: string[];
}

function fakeDeps(platform: NodeJS.Platform, over: Partial<AutostartDeps> = {}) {
  const files = new Map<string, string>();
  const calls: Call[] = [];
  const removed: string[] = [];
  const deps: AutostartDeps = {
    platform,
    home: '/Users/maria/.ekoa-bridge',
    homeIsDefault: true,
    nodePath: '/Users/maria/.nvm/versions/node/v22.22.2/bin/node',
    scriptPath: '/Users/maria/.nvm/versions/node/v22.22.2/lib/node_modules/ekoa-bridge/dist/cli/index.js',
    uid: 501,
    env: { HOME: '/Users/maria' },
    writeFile: (p, c) => files.set(p, c),
    mkdir: () => undefined,
    rm: (p) => {
      removed.push(p);
      files.delete(p);
    },
    exists: (p) => files.has(p),
    run: (cmd, args) => {
      calls.push({ cmd, args });
      return Promise.resolve({ code: 0, output: '' });
    },
    ...over,
  };
  return { deps, files, calls, removed };
}

describe('launchd plist (macOS)', () => {
  it('carries ABSOLUTE nvm paths — a service manager PATH cannot find node', () => {
    const { deps } = fakeDeps('darwin');
    const plist = launchdPlist(deps);
    expect(plist).toContain('<string>/Users/maria/.nvm/versions/node/v22.22.2/bin/node</string>');
    expect(plist).toContain('/lib/node_modules/ekoa-bridge/dist/cli/index.js</string>');
    expect(plist).toContain('<string>serve</string>');
  });

  it('binds to the Aqua session — the ceremony opens a WINDOW, and only a gui-session agent can', () => {
    const { deps } = fakeDeps('darwin');
    expect(launchdPlist(deps)).toContain('<key>LimitLoadToSessionType</key>\n  <string>Aqua</string>');
  });

  it('KeepAlive with a 30s throttle — serve exits non-zero when unpaired, and a bare restart-forever would hot-loop it', () => {
    const { deps } = fakeDeps('darwin');
    const plist = launchdPlist(deps);
    expect(plist).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(plist).toContain('<key>ThrottleInterval</key>\n  <integer>30</integer>');
  });

  it('pins a CUSTOM home into the job env, and leaves the default home unpinned', () => {
    const custom = fakeDeps('darwin', { home: '/srv/bridge-home', homeIsDefault: false });
    expect(launchdPlist(custom.deps)).toContain('<key>EKOA_BRIDGE_HOME</key>');
    expect(launchdPlist(custom.deps)).toContain('<string>/srv/bridge-home</string>');
    const dflt = fakeDeps('darwin');
    expect(launchdPlist(dflt.deps)).not.toContain('EKOA_BRIDGE_HOME');
  });

  it('XML-escapes paths — spaces are fine, but & < > in a path must not corrupt the plist', () => {
    const { deps } = fakeDeps('darwin', { nodePath: '/Users/maria/tools & bin/node' });
    expect(launchdPlist(deps)).toContain('<string>/Users/maria/tools &amp; bin/node</string>');
  });

  it('enable writes the plist under ~/Library/LaunchAgents and boots out BEFORE bootstrapping', async () => {
    const { deps, files, calls } = fakeDeps('darwin');
    const { path } = await enableAutostart(deps);
    expect(path).toBe(`/Users/maria/Library/LaunchAgents/${AUTOSTART_LABEL}.plist`);
    expect(files.has(path)).toBe(true);
    expect(calls.map((c) => `${c.cmd} ${c.args[0]}`)).toEqual(['launchctl bootout', 'launchctl bootstrap']);
    // bootout first: bootstrap refuses an already-loaded label, and re-enabling must load the
    // REWRITTEN plist (the nvm-upgrade cure), not keep running the old one.
    expect(calls[1]!.args).toEqual(['bootstrap', 'gui/501', path]);
  });

  it('falls back to legacy `launchctl load -w` when bootstrap is refused', async () => {
    const { deps, calls } = fakeDeps('darwin', {
      run: (cmd, args) => {
        calls.push({ cmd, args });
        const refused = args[0] === 'bootstrap';
        return Promise.resolve({ code: refused ? 1 : 0, output: refused ? 'Bootstrap failed' : '' });
      },
    });
    await enableAutostart(deps);
    expect(calls.map((c) => c.args[0])).toEqual(['bootout', 'bootstrap', 'load']);
  });

  it('disable boots the label out and removes the plist; a missing plist is a no-op', async () => {
    const { deps, files, calls, removed } = fakeDeps('darwin');
    const { path } = await enableAutostart(deps);
    await disableAutostart(deps);
    expect(removed).toEqual([path]);
    expect(files.has(path)).toBe(false);
    expect(calls.filter((c) => c.args[0] === 'bootout')).toHaveLength(2);
    await disableAutostart(deps); // nothing left — must not throw
  });
});

describe('systemd user unit (Linux)', () => {
  it('writes the unit under XDG config and enables --now', async () => {
    const { deps, files, calls } = fakeDeps('linux', { env: { HOME: '/home/maria' } });
    const { path } = await enableAutostart(deps);
    expect(path).toBe(`/home/maria/.config/systemd/user/${SYSTEMD_UNIT}`);
    const unit = files.get(path)!;
    expect(unit).toContain('ExecStart=/Users/maria/.nvm/versions/node/v22.22.2/bin/node');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('RestartSec=30');
    expect(unit).toContain('WantedBy=default.target');
    expect(calls.map((c) => c.args.join(' '))).toEqual([
      '--user daemon-reload',
      `--user enable --now ${SYSTEMD_UNIT}`,
    ]);
  });

  it('respects XDG_CONFIG_HOME over ~/.config', () => {
    const path = registrationPath({ platform: 'linux', env: { HOME: '/home/maria', XDG_CONFIG_HOME: '/home/maria/cfg' } });
    expect(path).toBe(`/home/maria/cfg/systemd/user/${SYSTEMD_UNIT}`);
  });

  it('a refused enable surfaces the systemd output rather than a generic failure', async () => {
    const { deps } = fakeDeps('linux', {
      env: { HOME: '/home/maria' },
      run: (_c, args) =>
        Promise.resolve(args.includes('enable') ? { code: 1, output: 'Failed to connect to bus' } : { code: 0, output: '' }),
    });
    await expect(enableAutostart(deps)).rejects.toThrow(/Failed to connect to bus/);
  });
});

describe('unsupported platforms', () => {
  it('windows is an honest refusal, not a silent success', async () => {
    const { deps } = fakeDeps('win32');
    await expect(enableAutostart(deps)).rejects.toThrow(AutostartError);
    await expect(enableAutostart(deps)).rejects.toThrow(/Windows/);
    expect(autostartStatus(deps).supported).toBe(false);
  });
});

describe('the CLI command', () => {
  function cliCtx(home: string) {
    const out: string[] = [];
    const err: string[] = [];
    const ctx: CliContext = {
      home,
      io: { out: (l) => out.push(l), err: (l) => err.push(l) },
      fetchImpl: (() => Promise.reject(new Error('no network in tests'))) as unknown as CliContext['fetchImpl'],
      now: () => 0,
      sleep: () => Promise.resolve(),
      env: { HOME: '/Users/maria' },
      pickFolder: () => Promise.resolve({ ok: false, reason: 'unavailable' }),
      randomSuffix: () => 'abcd',
    };
    return { ctx, out, err };
  }

  it('`on` REFUSES an unpaired machine — registering serve would put launchd in a crash loop', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ekoa-as-'));
    const { ctx, err } = cliCtx(home);
    const { deps } = fakeDeps('darwin');
    const code = await autostart(['on'], ctx, deps);
    expect(code).toBe(EXIT.ERROR);
    expect(err.join('\n')).toContain('não está emparelhado');
  });

  it('`on` registers a paired machine and says where the registration lives', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ekoa-as-'));
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        cortexBaseUrl: 'https://cortex.example',
        pairingId: 'p1',
        credentials: { access: 'a', expires: 4102444800000 },
      }),
    );
    const { ctx, out } = cliCtx(home);
    const { deps, files } = fakeDeps('darwin');
    const code = await autostart(['on'], ctx, deps);
    expect(code).toBe(EXIT.OK);
    expect(out.join('\n')).toContain('Arranque automático ativado');
    expect([...files.keys()][0]).toContain('LaunchAgents');
  });

  it('`off` then `status` report honestly', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ekoa-as-'));
    const { ctx, out } = cliCtx(home);
    const { deps } = fakeDeps('darwin');
    expect(await autostart(['off'], ctx, deps)).toBe(EXIT.OK);
    expect(await autostart(['status'], ctx, deps)).toBe(EXIT.OK);
    expect(out.join('\n')).toContain('Arranque automático: inativo.');
  });

  it('an unknown action is a usage error', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ekoa-as-'));
    const { ctx } = cliCtx(home);
    expect(await autostart(['sideways'], ctx, fakeDeps('darwin').deps)).toBe(EXIT.USAGE);
  });
});
