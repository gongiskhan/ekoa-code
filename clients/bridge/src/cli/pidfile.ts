/**
 * cli/pidfile.ts — the daemon's liveness marker: `daemon.pid` under EKOA_BRIDGE_HOME.
 *
 * `serve` writes it on start and removes it on graceful shutdown; `status` reads it to report whether
 * the daemon is running. Liveness is confirmed with `process.kill(pid, 0)` (a probe that sends no
 * signal), so a stale pidfile left by a crash reads as "stopped" rather than "running".
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function pidPath(home: string): string {
  return join(home, 'daemon.pid');
}

export function writeDaemonPid(home: string, pid: number): void {
  writeFileSync(pidPath(home), `${pid}\n`, { mode: 0o600 });
}

export function removeDaemonPid(home: string): void {
  rmSync(pidPath(home), { force: true });
}

export function readDaemonPid(home: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(pidPath(home), 'utf-8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** True when a process with `pid` exists (EPERM means it exists but is owned by another user). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
