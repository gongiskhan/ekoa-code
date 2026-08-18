/**
 * autostart/autostart.ts — keep the daemon alive across reboots (and crashes) by registering it
 * with the OS's own service manager, instead of the `nohup … & disown` that dies with the machine.
 *
 * PER-USER, NEVER SYSTEM-WIDE. On macOS this is a **LaunchAgent** (`gui/$UID`), not a
 * LaunchDaemon, and the plist pins `LimitLoadToSessionType: Aqua`. That is a functional
 * requirement, not a preference: the attended ceremony opens a HEADED browser window a human must
 * see, and only an agent in the user's Aqua session can put a window on their screen — a
 * LaunchDaemon runs outside any GUI session and the ceremony would launch a browser into the void.
 * On Linux it is a **systemd user unit** for the same reason (and because the daemon's state,
 * `~/.ekoa-bridge`, is per-user).
 *
 * THE PATHS ARE ABSOLUTE AND RESOLVED AT ENABLE TIME. Both machines in the field run node under
 * nvm, so a service manager's minimal PATH (`/usr/bin:/bin`) cannot find `node` or `ekoa-bridge`.
 * The plist/unit therefore carries `process.execPath` (the exact node binary running this command)
 * and the realpath of the CLI entry script. The cost is honest and documented: upgrading node with
 * nvm moves the binary, breaking the registration — `autostart on` again after a node upgrade.
 *
 * WHY `KeepAlive`/`Restart=always` IS SAFE HERE. `serve` refuses to start when a daemon already
 * holds the pidfile, and exits non-zero on an unpaired machine. A bare restart-forever policy
 * would hot-loop on those, so both registrations carry a 30s throttle — and `enable` refuses
 * outright on an unpaired machine, closing the common case before it loops even slowly.
 */
export const AUTOSTART_LABEL = 'pt.ekoa.bridge';
export const SYSTEMD_UNIT = 'ekoa-bridge.service';

/** Everything OS-touching is injected, so tests assert the real file contents and the real command
 *  sequences without a launchd or a systemd anywhere near them. */
export interface AutostartDeps {
  platform: NodeJS.Platform;
  /** The bridge home (logs live under it; a non-default home is carried into the service env). */
  home: string;
  /** Whether this home is the default `~/.ekoa-bridge` (default homes are NOT pinned into the service). */
  homeIsDefault: boolean;
  /** The exact node binary running this command (process.execPath). */
  nodePath: string;
  /** Realpath of the CLI entry script (dist/cli/index.js). */
  scriptPath: string;
  /** The user's numeric uid — launchctl's gui domain is addressed by it. */
  uid: number;
  /** $HOME / $XDG_CONFIG_HOME, for placing the plist / unit file. */
  env: NodeJS.ProcessEnv;
  writeFile: (path: string, content: string) => void;
  mkdir: (dir: string) => void;
  rm: (path: string) => void;
  exists: (path: string) => boolean;
  /** Run a service-manager command; never throws — failures come back as {code, output}. */
  run: (cmd: string, args: string[]) => Promise<{ code: number; output: string }>;
}

export class AutostartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutostartError';
  }
}

export interface AutostartStatus {
  supported: boolean;
  installed: boolean;
  /** The registration file, when installed. */
  path?: string;
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export function registrationPath(deps: Pick<AutostartDeps, 'platform' | 'env'>): string | null {
  const home = deps.env.HOME;
  if (deps.platform === 'darwin') {
    if (!home) return null;
    return joinPath(home, 'Library', 'LaunchAgents', `${AUTOSTART_LABEL}.plist`);
  }
  if (deps.platform === 'linux') {
    const configHome = deps.env.XDG_CONFIG_HOME ?? (home ? joinPath(home, '.config') : null);
    if (!configHome) return null;
    return joinPath(configHome, 'systemd', 'user', SYSTEMD_UNIT);
  }
  return null;
}

/** XML-escape for plist string values — paths with spaces are common under /Users. */
function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function launchdPlist(deps: AutostartDeps): string {
  const logPath = joinPath(deps.home, 'logs', 'serve.log');
  // A custom EKOA_BRIDGE_HOME must survive into the launchd job or the daemon would serve a
  // DIFFERENT home than the one the user paired; the default home is deliberately not pinned, so
  // the registration keeps working if the user's home directory moves.
  const envBlock = deps.homeIsDefault
    ? ''
    : `
  <key>EnvironmentVariables</key>
  <dict>
    <key>EKOA_BRIDGE_HOME</key>
    <string>${xml(deps.home)}</string>
  </dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${AUTOSTART_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(deps.nodePath)}</string>
    <string>${xml(deps.scriptPath)}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>${envBlock}
</dict>
</plist>
`;
}

export function systemdUnit(deps: AutostartDeps): string {
  const logPath = joinPath(deps.home, 'logs', 'serve.log');
  const envLine = deps.homeIsDefault ? '' : `Environment=EKOA_BRIDGE_HOME=${deps.home}\n`;
  // `default.target`, not a graphical target: the daemon must come up for file delegations even on
  // a box someone reaches only over ssh; a ceremony on a displayless session fails at launch and is
  // reported honestly by the ceremony itself.
  return `[Unit]
Description=Ponte Ekoa (ekoa-bridge)
After=network-online.target

[Service]
ExecStart=${deps.nodePath} ${deps.scriptPath} serve
Restart=always
RestartSec=30
${envLine}StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;
}

/**
 * Register and start. Idempotent: re-enabling rewrites the file (picking up a moved node binary —
 * the nvm-upgrade cure) and re-bootstraps.
 */
export async function enableAutostart(deps: AutostartDeps): Promise<{ path: string }> {
  const path = registrationPath(deps);
  if (!path) {
    throw new AutostartError(
      deps.platform === 'win32'
        ? 'o arranque automático ainda não é suportado no Windows; use "ekoa-bridge serve" numa janela'
        : `o arranque automático não é suportado nesta plataforma (${deps.platform})`,
    );
  }

  deps.mkdir(path.slice(0, path.lastIndexOf('/')));
  deps.mkdir(joinPath(deps.home, 'logs'));

  if (deps.platform === 'darwin') {
    deps.writeFile(path, launchdPlist(deps));
    // Boot out any prior registration first: `bootstrap` refuses an already-loaded label, and the
    // point of re-enabling is to load the REWRITTEN plist. A failure here is fine (not loaded).
    await deps.run('launchctl', ['bootout', `gui/${deps.uid}`, AUTOSTART_LABEL]);
    const boot = await deps.run('launchctl', ['bootstrap', `gui/${deps.uid}`, path]);
    if (boot.code !== 0) {
      // Older macOS (or a session without the modern domain): fall back to the legacy loader.
      const legacy = await deps.run('launchctl', ['load', '-w', path]);
      if (legacy.code !== 0) {
        throw new AutostartError(`o launchd recusou o registo: ${boot.output || legacy.output}`);
      }
    }
    return { path };
  }

  // linux
  deps.writeFile(path, systemdUnit(deps));
  const reload = await deps.run('systemctl', ['--user', 'daemon-reload']);
  if (reload.code !== 0) {
    throw new AutostartError(`o systemd (sessão de utilizador) não respondeu: ${reload.output}`);
  }
  const enable = await deps.run('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT]);
  if (enable.code !== 0) {
    throw new AutostartError(`o systemd recusou o serviço: ${enable.output}`);
  }
  return { path };
}

/** Unregister and stop. Removing a registration that does not exist is a no-op, not an error. */
export async function disableAutostart(deps: AutostartDeps): Promise<void> {
  const path = registrationPath(deps);
  if (!path) return;

  if (deps.platform === 'darwin') {
    await deps.run('launchctl', ['bootout', `gui/${deps.uid}`, AUTOSTART_LABEL]);
    if (deps.exists(path)) deps.rm(path);
    return;
  }
  await deps.run('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT]);
  if (deps.exists(path)) deps.rm(path);
}

export function autostartStatus(deps: Pick<AutostartDeps, 'platform' | 'env' | 'exists'>): AutostartStatus {
  const path = registrationPath(deps);
  if (!path) return { supported: false, installed: false };
  return deps.exists(path) ? { supported: true, installed: true, path } : { supported: true, installed: false };
}
