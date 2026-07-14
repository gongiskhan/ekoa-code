/**
 * The real capability matrix (operator-run H1). REPLACES the S0 permissive-stub test: `can()` now
 * enforces the brief §9a role→capability grid, not a blanket `true`. The H5 security assertions
 * grep the source (api/src/auth/capabilities.ts) for the retired stub marker and fail if it
 * survives; this suite pins the behavior that replaced it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Capability } from '@ekoa/shared';
import { can } from '../../src/auth/capabilities.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/auth
const API_SRC = resolve(HERE, '../../src'); // <root>/api/src
const TESTS_ROOT = resolve(HERE, '..'); // <root>/api/tests
const readSrc = (rel: string) => readFileSync(resolve(API_SRC, rel), 'utf8');

// The authoritative grid. Every (role x capability) cell is asserted below - both the grants and
// the denials - so a future edit to the matrix cannot silently widen a role.
const EXPECTED: Record<'super-admin' | 'org-admin' | 'user', Record<Capability, boolean>> = {
  'super-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
  'org-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
  user: { canBuildApps: false, canEditApps: false, canCreateArtifacts: true, canUseChat: true },
};

describe('can() capability matrix (H1)', () => {
  it('every role x capability cell matches the brief grid (all 12 cells)', () => {
    for (const role of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
      for (const capability of Capability.options) {
        expect(can({ role }, capability), `${role} / ${capability}`).toBe(EXPECTED[role][capability]);
      }
    }
  });

  it('a user holds exactly canUseChat + canCreateArtifacts - never the app build/edit capabilities', () => {
    expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
    expect(can({ role: 'user' }, 'canCreateArtifacts')).toBe(true);
    expect(can({ role: 'user' }, 'canBuildApps')).toBe(false);
    expect(can({ role: 'user' }, 'canEditApps')).toBe(false);
  });

  it('admins (org-admin + super-admin) hold every capability', () => {
    for (const role of ['org-admin', 'super-admin'] as const) {
      for (const capability of Capability.options) {
        expect(can({ role }, capability), `${role} / ${capability}`).toBe(true);
      }
    }
  });

  it('a null/undefined actor holds NOTHING (fail closed)', () => {
    for (const capability of Capability.options) {
      expect(can(null, capability), `null / ${capability}`).toBe(false);
      expect(can(undefined, capability), `undefined / ${capability}`).toBe(false);
    }
  });

  it('an unknown/stale role holds NOTHING (fail closed) - a signature-valid token carrying a dead role value grants nothing', () => {
    // The `?? false` defensive branch in can(): a role not in the CAPABILITIES map (the retired
    // `builder` value that somehow bypassed the verifyToken shim, or any garbage) is refused every
    // capability. This is the security posture the H1 map §7 called out - capability must never
    // default to "more" for an unrecognised role.
    for (const capability of Capability.options) {
      expect(can({ role: 'builder' as never }, capability), `stale-builder / ${capability}`).toBe(false);
      expect(can({ role: 'root' as never }, capability), `garbage-root / ${capability}`).toBe(false);
      expect(can({ role: '' as never }, capability), `empty-role / ${capability}`).toBe(false);
    }
  });

  it('the capability vocabulary is the brief-designed set (unchanged by H1)', () => {
    expect(Capability.options).toEqual(['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat']);
  });
});

/**
 * H5 gate-wiring assertion - the matrix ABOVE is the pure decision; this block proves each cell is
 * actually ENFORCED at the routes that mint/mutate the gated resource, so the matrix cannot drift
 * away from its enforcement points. It ties every capability to at least one wired `can(actor, '…')`
 * call site, cross-referencing (NOT duplicating) the two integration suites that drive the behavior
 * end-to-end over the real routers:
 *   - api/tests/contract/jobs-capability.test.ts - POST /jobs first-build (canBuildApps) + follow-up
 *     (canEditApps + writability/IDOR); a `user` refused, an org-admin proceeds, executor never
 *     called on a refusal.
 *   - api/tests/contract/artifacts-capability.test.ts - the in-place app-edit vectors (canEditApps
 *     via denyAppEdit), import + fork-of-app (canBuildApps), and a `user` keeping non-app
 *     create/fork (canCreateArtifacts).
 * Here we assert the WIRING inventory (the source has the gate) so a future edit that silently drops
 * a gate - leaving the matrix green but the route ungated - fails this suite.
 */
describe('capability gate wiring (H5) - the matrix is enforced at the routes', () => {
  // capability -> the source file that must carry an enforcing `can(actor, '<capability>')` gate,
  // with the vector it guards, AND the BEHAVIORAL suite that would fail if the gate stopped being
  // reached at runtime. This structural inventory is a SMOKE (a route file that still contains the
  // can() literal keeps this green even if a handler stopped CALLING it - codex-h5 Medium); the
  // named behavioral suites are the AUTHORITATIVE proof: they drive the real route end to end, so a
  // handler that returned a constant / dropped its gate FAILS there. Each row lists both so a broken
  // gate is caught behaviorally, not merely asserted structurally.
  const WIRING: Array<{ capability: Capability; file: string; vector: string; behavioral: string }> = [
    { capability: 'canBuildApps', file: 'routes/jobs.ts', vector: 'first build (POST /jobs, no artifactId)', behavioral: 'tests/contract/jobs-capability.test.ts (user 403, admin 202)' },
    { capability: 'canEditApps', file: 'routes/jobs.ts', vector: 'follow-up build (POST /jobs, artifactId)', behavioral: 'tests/contract/jobs-capability.test.ts (follow-up 403/404)' },
    { capability: 'canUseChat', file: 'routes/chat.ts', vector: 'chat run (POST /chat/runs)', behavioral: 'tests/contract/jobs-capability.test.ts + chat suites' },
    { capability: 'canCreateArtifacts', file: 'routes/artifacts.ts', vector: 'artifact create (POST /artifacts)', behavioral: 'tests/contract/artifacts-capability.test.ts' },
    { capability: 'canEditApps', file: 'routes/artifacts.ts', vector: 'in-place app-edit vectors (denyAppEdit)', behavioral: 'tests/contract/artifacts-capability.test.ts (bundle-update/file/restore/backend 403)' },
    { capability: 'canBuildApps', file: 'routes/artifacts.ts', vector: 'import + fork-of-app', behavioral: 'tests/contract/artifacts-capability.test.ts (import/fork 403)' },
    { capability: 'canEditApps', file: 'apps/app-assistant-route.ts', vector: 'served-app admin detection (whoami)', behavioral: 'tests/apps/app-assistant.test.ts (whoami fail-closed matrix over the real route)' },
  ];

  it.each(WIRING)('$capability is wired at $file - $vector', ({ capability, file }) => {
    const src = readSrc(file);
    // A real gate is a `can(` call whose argument list carries the capability literal. The fork
    // vector passes the capability through a `forkCap` variable, but the literal is defined
    // adjacent on the same statement, so the file-scoped literal-near-can() assertion still holds.
    expect(src.includes('can('), `${file} must call can()`).toBe(true);
    expect(src.includes(`'${capability}'`), `${file} must reference the ${capability} capability literal`).toBe(true);
    // Tie them together: a `can(...)` call referencing this capability literal (allowing the
    // forkCap indirection in artifacts.ts, where the literal sits on the ternary feeding can()).
    const wiredDirectly = new RegExp(`can\\([^;]*'${capability}'`).test(src);
    const wiredViaForkCap =
      file === 'routes/artifacts.ts' && /forkCap\s*=\s*isAppArtifact[^;]*'canBuildApps'[^;]*'canCreateArtifacts'/.test(src) && /can\([^;]*forkCap/.test(src);
    expect(wiredDirectly || wiredViaForkCap, `${file}: no can(actor, '${capability}') gate found`).toBe(true);
    // The whoami row's structural check is the WEAKEST (the can() literal lives in the isAppEditor
    // helper, so the file stays green even if the handler stopped calling it - codex-h5 Medium).
    // Tighten it: the whoami HANDLER must actually invoke detectAppEditor (the code path that reaches
    // the gate); a handler returning a constant would drop this token. The behavioral whoami matrix
    // (tests/apps/app-assistant.test.ts) is the authoritative catch either way.
    if (file === 'apps/app-assistant-route.ts') {
      expect(/detectAppEditor\(/.test(src), 'whoami must call detectAppEditor (the gate path), not return a constant').toBe(true);
      expect(/admin:\s*await\s+detectAppEditor\(/.test(src), 'the whoami response `admin` must be the detectAppEditor result').toBe(true);
    }
  });

  it('every wired capability has a named AUTHORITATIVE behavioral suite (structural inventory is only a smoke)', () => {
    // codex-h5 Medium: the structural inventory can go stale-green; each row must point at a suite
    // that drives the real route and would fail on a broken gate. Assert the referenced suite files
    // exist so the pointer never rots.
    for (const w of WIRING) {
      expect(w.behavioral, `${w.capability}@${w.file} must name a behavioral suite`).toBeTruthy();
      const suiteFile = w.behavioral.split(' ')[0]!; // the leading path token (api/tests-relative, e.g. tests/contract/...)
      expect(existsSync(resolve(TESTS_ROOT, '..', suiteFile)), `behavioral suite ${suiteFile} must exist`).toBe(true);
    }
  });

  it('the two admin-only capabilities (a user is denied) are each enforced by a wired gate', () => {
    // The matrix denies a `user` canBuildApps + canEditApps; both MUST have at least one enforcing
    // gate, else the denial is unenforceable. (canUseChat + canCreateArtifacts are user-held; their
    // gates refuse only a null/no-capability actor.)
    for (const cap of ['canBuildApps', 'canEditApps'] as const) {
      const enforced = WIRING.some((w) => w.capability === cap);
      expect(enforced, `${cap} (admin-only) must be enforced somewhere`).toBe(true);
      expect(can({ role: 'user' }, cap), `matrix: a user is denied ${cap}`).toBe(false);
    }
  });
});
