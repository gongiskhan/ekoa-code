/**
 * auth/grants-store.ts — the on-disk grants list: `grants.json` under EKOA_BRIDGE_HOME.
 *
 * A grant is a user pre-authorisation of a directory, session-scoped. This module persists them; the
 * in-memory session table (src/session/grants.ts) and the actual path containment (src/containment)
 * consume them later. Record shape is a superset of that module's `Grant` (adds `createdAt`):
 *   { grantRef, root, session, createdAt }
 * The file is written 0600 like the rest of the store. A corrupt file is tolerated as "no grants"
 * rather than crashing the CLI (the next add rewrites it cleanly).
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const StoredGrant = z.object({
  grantRef: z.string(),
  root: z.string(),
  session: z.string(),
  createdAt: z.string(),
  /** Human label the picker/browser attached (e.g. the chosen file's name). Optional: CLI grants have none. */
  label: z.string().optional(),
});
export type StoredGrant = z.infer<typeof StoredGrant>;

const GrantsFile = z.array(StoredGrant);

export function grantsPath(home: string): string {
  return join(home, 'grants.json');
}

export function loadGrants(home: string): StoredGrant[] {
  let raw: string;
  try {
    raw = readFileSync(grantsPath(home), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return []; // unreadable: treat as empty rather than block grant management
  }
  try {
    const parsed = GrantsFile.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return []; // corrupt JSON: start fresh
  }
}

export function saveGrants(home: string, grants: StoredGrant[]): void {
  const path = grantsPath(home);
  writeFileSync(path, `${JSON.stringify(grants, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Append a grant to the store and return the full updated list. */
export function addGrant(home: string, grant: StoredGrant): StoredGrant[] {
  const grants = loadGrants(home);
  grants.push(grant);
  saveGrants(home, grants);
  return grants;
}

/** Remove a grant from the store by ref (idempotent). Returns whether anything was removed. */
export function removeGrant(home: string, grantRef: string): boolean {
  const grants = loadGrants(home);
  const kept = grants.filter((g) => g.grantRef !== grantRef);
  if (kept.length === grants.length) return false;
  saveGrants(home, kept);
  return true;
}
