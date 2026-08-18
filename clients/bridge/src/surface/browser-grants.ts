/**
 * surface/browser-grants.ts — grant list/mint/revoke behind the loopback surface (C3 +
 * decisions.md 2026-07-11). The browser's mint path is the same authorization the CLI's
 * `grant add` records, with two differences the UX demanded:
 *  - the grant binds to the REAL hosted chat session id the dashboard passes (fixing the
 *    'default'-session mismatch that made CLI grants foreign to chat delegations), and
 *  - selecting a FILE authorizes its PARENT folder — stated honestly in the response
 *    (`path` is always the granted root), with the file's name as the default label.
 *
 * Mint updates BOTH truths: grants.json (durable, what a restart reloads) and the live
 * GrantTable (what the running daemon resolves against). Revoke drops both; it takes effect
 * at the next grant resolution, never retroactively (§12.6.3).
 */
import { statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { addGrant, loadGrants, removeGrant, type StoredGrant } from '../auth/index.js';
import type { GrantTable } from '../session/index.js';

export interface BrowserGrantsDeps {
  home: string;
  /** The live table the running daemon resolves delegations against. */
  table: GrantTable;
  randomSuffix: () => string;
  now?: () => number;
}

export interface CreateGrantInput {
  path: string;
  session: string;
  label?: string | undefined;
}

export type CreateGrantOutcome =
  | { ok: true; grant: StoredGrant; requested: 'dir' | 'file' }
  | { ok: false; status: 400 | 404; error: string };

export function listBrowserGrants(deps: BrowserGrantsDeps): StoredGrant[] {
  return loadGrants(deps.home);
}

export function createBrowserGrant(deps: BrowserGrantsDeps, input: CreateGrantInput): CreateGrantOutcome {
  if (input.path.length === 0) return { ok: false, status: 400, error: 'path required' };
  if (input.session.length === 0) return { ok: false, status: 400, error: 'session required' };

  const abs = resolve(input.path);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return { ok: false, status: 404, error: 'path not found' };
  }
  const requested: 'dir' | 'file' = stat.isDirectory() ? 'dir' : 'file';
  const root = requested === 'dir' ? abs : dirname(abs);
  const label = input.label && input.label.length > 0 ? input.label : basename(abs);

  const record: StoredGrant = {
    grantRef: `g-${deps.randomSuffix()}`,
    root,
    session: input.session,
    createdAt: new Date((deps.now ?? Date.now)()).toISOString(),
    label,
  };
  addGrant(deps.home, record);
  deps.table.add({ grantRef: record.grantRef, root: record.root, session: record.session });
  return { ok: true, grant: record, requested };
}

/** Idempotent revoke across both truths. True when either held the ref. */
export function revokeBrowserGrant(deps: BrowserGrantsDeps, grantRef: string): boolean {
  const fromStore = removeGrant(deps.home, grantRef);
  const fromTable = deps.table.remove(grantRef);
  return fromStore || fromTable;
}
