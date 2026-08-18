/**
 * auth/home.ts — resolve and create EKOA_BRIDGE_HOME, the daemon's private state directory.
 *
 * Default `~/.ekoa-bridge`, overridable with the EKOA_BRIDGE_HOME env var (the override the tests and
 * the integration harness use to point at a scratch tree — architecture.md "Integration points").
 * The directory holds the credential store, grants, and the ledger, so it is created 0700 (owner
 * only) and re-tightened on every ensure, even if it pre-existed with looser permissions.
 */
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolve the home directory path: EKOA_BRIDGE_HOME if set and non-empty, else `~/.ekoa-bridge`. */
export function ekoaBridgeHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.EKOA_BRIDGE_HOME;
  if (typeof override === 'string' && override.length > 0) return override;
  return join(homedir(), '.ekoa-bridge');
}

/** Ensure the home directory exists and is owner-only (0700). Returns the path. */
export function ensureHome(home: string = ekoaBridgeHome()): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by umask (and a no-op when the dir already existed), so tighten
  // explicitly: this dir carries credentials and must never be group/other readable.
  chmodSync(home, 0o700);
  return home;
}
