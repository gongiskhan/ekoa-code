import { describe, it, expect } from 'vitest';
import { ALL_ENDPOINTS, allEndpointsFlat } from '@ekoa/shared';

/**
 * Schema-coverage gate (ch13 §13.5 item 3, §14.2.5). Every endpoint descriptor in `shared/`
 * is accounted for exactly once: either COVERED (a contract test exercises it now) or PENDING
 * (a committed allowlist of not-yet-landed endpoints). The gate fails if any descriptor is in
 * NEITHER list — so adding an endpoint/schema to `shared/` without a contract test AND without
 * allowlisting it is an automatic build failure (this is the ch13 §13.11 item-5 deliberate-red
 * mechanism). PENDING must SHRINK at every domain gate and be EMPTY at G9.
 */

// Endpoints with a committed contract/e2e test now (G2 auth + G3 CRUD domains).
const COVERED = new Set<string>([
  'auth.login', 'auth.me',
  'users.list', 'users.create', 'users.update', 'users.remove',
  'org.getOrg', 'org.updateOrg', 'org.saveBranding', 'org.createOrg', 'org.listOrgs', 'org.patchOrg',
  'settings.get', 'settings.update', 'settings.updateMe',
  'sessions.create', 'sessions.list', 'sessions.get', 'sessions.update', 'sessions.delete', 'sessions.getMessages', 'sessions.addMessage',
  'memories.list', 'memories.get', 'memories.create', 'memories.update', 'memories.delete',
  'registo.listRegisto',
  'billing.getUsage', 'billing.getHistory',
]);

// Not-yet-landed endpoints (committed allowlist; SHRINKS each gate, EMPTY at G9). Computed as
// "every descriptor endpoint not in COVERED" here, but pinned by an expected-count assertion so
// a NEW endpoint added to shared/ without being COVERED bumps the count and fails the gate.
const EXPECTED_PENDING_COUNT = 176;

describe('schema-coverage gate (ch13 §13.5 item 3)', () => {
  it('every descriptor endpoint is COVERED or PENDING (no unaccounted schema)', () => {
    const all = allEndpointsFlat().map((e) => `${e.domain}.${e.name}`);
    // Every COVERED name must be a real descriptor (no drift / stale coverage claim).
    for (const c of COVERED) {
      expect(all, `COVERED names a real descriptor: ${c}`).toContain(c);
    }
    const pending = all.filter((k) => !COVERED.has(k));
    // The deliberate-red bite: a new endpoint added to shared/ that is neither COVERED nor
    // expected in PENDING changes this count, failing the gate. (Verified by a temporary
    // shared/ addition during the build — logged in RUN_LOG per ch13 §13.11 item 5.)
    expect(pending.length, 'PENDING allowlist count (shrinks each gate, 0 at G9)').toBe(EXPECTED_PENDING_COUNT);
  });

  it('landed domains at G3 are present and covered', () => {
    for (const d of ['auth', 'users', 'org', 'settings', 'sessions', 'memories', 'registo', 'billing']) {
      expect(ALL_ENDPOINTS[d as keyof typeof ALL_ENDPOINTS]).toBeTruthy();
    }
    // A representative endpoint from each landed domain is covered.
    for (const c of ['users.list', 'memories.get', 'registo.listRegisto', 'org.getOrg']) {
      expect(COVERED.has(c)).toBe(true);
    }
  });
});
