/**
 * cli/commands/autostart.ts — `autostart on|off|status`: register the daemon with launchd (macOS)
 * or the systemd user session (Linux) so it survives reboots and crashes, instead of dying with
 * the terminal that started it.
 *
 * `on` REFUSES ON AN UNPAIRED MACHINE. `serve` exits non-zero without a pairing, so registering it
 * would put the service manager into a slow crash loop (30s throttle) that looks like "the bridge
 * is broken" — when the truth is one `pair` away. Refusing with that instruction is the honest
 * failure. The real-OS deps live behind `AutostartDeps`, so tests drive this command end to end
 * with a fake launchctl/systemctl and assert the exact files and command sequences.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialsError, ekoaBridgeHome, loadConfig } from '../../auth/index.js';
import {
  AutostartError,
  autostartStatus,
  disableAutostart,
  enableAutostart,
  type AutostartDeps,
} from '../../autostart/index.js';
import { pt } from '../../i18n/pt.js';
import { EXIT, type CliContext } from '../context.js';
import { isProcessAlive, readDaemonPid } from '../pidfile.js';

/** Build the real-OS deps. Exported for the command's tests to override piecemeal. */
export function realAutostartDeps(ctx: CliContext): AutostartDeps {
  return {
    platform: process.platform,
    home: ctx.home,
    homeIsDefault: ctx.home === ekoaBridgeHome({}),
    nodePath: process.execPath,
    // The service manager needs the REAL entry script, and `process.argv[1]` is npm's global-bin
    // SYMLINK. Rather than realpath it (reserved for containment/resolver.ts, S1 single-resolver
    // rule), derive it from THIS module's url — Node resolves module URLs through symlinks, so
    // `<here>/../index.js` IS `dist/cli/index.js` at its real location.
    scriptPath: join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.js'),
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    env: { ...ctx.env, HOME: ctx.env.HOME ?? homedir() },
    writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
    mkdir: (dir) => mkdirSync(dir, { recursive: true }),
    rm: (path) => rmSync(path),
    exists: (path) => existsSync(path),
    run: (cmd, args) =>
      new Promise((resolve) => {
        execFile(cmd, args, { timeout: 30_000 }, (err, stdout, stderr) => {
          resolve({ code: err ? 1 : 0, output: `${stdout}${stderr}`.trim() });
        });
      }),
  };
}

export async function autostart(
  args: string[],
  ctx: CliContext,
  depsOverride?: Partial<AutostartDeps>,
): Promise<number> {
  const [action] = args;
  const deps: AutostartDeps = { ...realAutostartDeps(ctx), ...depsOverride };

  if (action === 'status' || action === undefined) {
    const st = autostartStatus(deps);
    if (!st.supported) {
      ctx.io.out(pt.autostartUnsupported);
      return EXIT.OK;
    }
    const pid = readDaemonPid(ctx.home);
    const running = pid !== null && isProcessAlive(pid);
    ctx.io.out(st.installed ? pt.autostartInstalled(st.path!) : pt.autostartNotInstalled);
    ctx.io.out(running ? pt.statusServeRunning(pid!) : pt.statusServeStopped);
    return EXIT.OK;
  }

  if (action === 'on') {
    // The pairing gate. A corrupt config is an error with its own message; no config is unpaired.
    let config;
    try {
      config = loadConfig(ctx.home);
    } catch (err) {
      if (err instanceof CredentialsError) {
        ctx.io.err(`${pt.errPrefix} ${err.message}`);
        return EXIT.ERROR;
      }
      throw err;
    }
    if (!config || !config.credentials) {
      ctx.io.err(`${pt.errPrefix} ${pt.autostartUnpaired}`);
      return EXIT.ERROR;
    }

    try {
      const { path } = await enableAutostart(deps);
      ctx.io.out(pt.autostartEnabled(path));
      return EXIT.OK;
    } catch (err) {
      if (err instanceof AutostartError) {
        ctx.io.err(`${pt.errPrefix} ${err.message}`);
        return EXIT.ERROR;
      }
      throw err;
    }
  }

  if (action === 'off') {
    try {
      await disableAutostart(deps);
    } catch (err) {
      if (err instanceof AutostartError) {
        ctx.io.err(`${pt.errPrefix} ${err.message}`);
        return EXIT.ERROR;
      }
      throw err;
    }
    ctx.io.out(pt.autostartDisabled);
    return EXIT.OK;
  }

  ctx.io.err(pt.autostartUsage);
  return EXIT.USAGE;
}

/** The log path the service writes — status/help reference it so the user can find it. */
export function autostartLogPath(home: string): string {
  return join(home, 'logs', 'serve.log');
}
