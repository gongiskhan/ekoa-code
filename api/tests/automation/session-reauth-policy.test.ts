import { describe, it, expect, vi } from 'vitest';
import type { Actor } from '@ekoa/shared';
import {
  decideReauthRoute,
  ensureSession,
  type EnsureSessionDeps,
  type EnsureSessionInput,
} from '../../src/automation/session-establishment.js';
import type { TypistDeps } from '../../src/automation/typist.js';
import { SecretRegistry } from '../../src/security/redaction.js';

/**
 * P3.3 — THE RE-AUTH POLICY, as a table and as behaviour.
 *
 * Two suites in one file on purpose. `decideReauthRoute` is a pure function and the table is its
 * whole specification, but a pure function nothing calls proves nothing — so the second block
 * drives the SAME four cells through `ensureSession` and asserts what actually happens: whether a
 * browser was opened at all, and whether the typist ever saw a credential.
 *
 * THE ROW THAT MATTERS is attended-required + live grant. A standing grant is the user saying "use
 * this credential without asking me again"; it is NOT the user saying "solve my OTP". On an
 * attended origin the typist would fill the password, submit, meet a code prompt it cannot answer,
 * and leave a spent login attempt against a portal with an unknown lock-out policy.
 */

const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' } as Actor;
const HOST = 'citius.mj.pt';
const LOGIN_URL = `https://${HOST}/portal/login.aspx`;

const typistDeps: TypistDeps = {
  beginCredentialWindow: () => ({ close: () => {} }) as never,
  isSuppressed: () => true,
  withCaptureSuppressed: (fn) => fn(),
};

function runInput(over: Partial<EnsureSessionInput> = {}): EnsureSessionInput {
  return {
    actor,
    integrationKey: 'anything',
    origin: HOST,
    credentialRef: 'cofre:itm_password_1',
    loginUrl: LOGIN_URL,
    runId: 'run_1',
    // The P4.1 hosted-typist permit, which defaults CLOSED. This suite is about the RE-AUTH table
    // (attended x standing grant), so every case here grants the permit and lets the table decide;
    // the permit's own refusal is driven in `session-establishment.test.ts`.
    hostedTypist: {},
    ...over,
  };
}

/** Nothing stored, so the route is a FIRST establishment — the cheapest way to reach the policy. */
function harness(opts: { standingGrant: boolean }) {
  const typist = vi.fn(async () => {
    const secrets = new SecretRegistry();
    secrets.register('hunter2hunter2');
    return { secrets, itemId: 'itm_password_1', submittedVia: 'button' as const };
  });
  const openBrowser = vi.fn(async () => ({
    page: {
      url: () => LOGIN_URL,
      goto: async () => undefined,
    },
    storageState: async () => ({ cookies: [{ domain: HOST, name: 's', value: 'x' }], origins: [] }),
    close: async () => undefined,
  }));
  const deps: Partial<EnsureSessionDeps> = {
    findSessionItems: async () => [],
    unwrap: (async () => ({ itemId: 'x', type: 'session', value: '{}' })) as never,
    openBrowser: openBrowser as unknown as EnsureSessionDeps['openBrowser'],
    typist: typist as unknown as EnsureSessionDeps['typist'],
    typistDeps,
    capture: (async () => ({
      item: { _id: 'itm_session_fresh' },
      grant: { _id: 'grt_1' },
    })) as never,
    hasStandingGrant: async () => opts.standingGrant,
    recipeLoginUrl: () => LOGIN_URL,
    recipes: () => ({ usernameSelector: '#u', passwordSelector: '#p', submitSelector: '#s' }),
    clock: () => Date.parse('2026-08-18T10:00:00.000Z'),
  };
  return { deps, typist, openBrowser };
}

describe('decideReauthRoute — the table', () => {
  const cases: Array<{ attended: boolean; grant: boolean; expected: 'typist' | 'ceremony' }> = [
    { attended: false, grant: true, expected: 'typist' },
    { attended: false, grant: false, expected: 'ceremony' },
    { attended: true, grant: true, expected: 'ceremony' },
    { attended: true, grant: false, expected: 'ceremony' },
  ];

  for (const c of cases) {
    it(`attended=${c.attended} standingGrant=${c.grant} -> ${c.expected}`, () => {
      expect(
        decideReauthRoute({
          requiresAttendedAuth: c.attended,
          grantAllowsUnattendedRelogin: c.grant,
        }),
      ).toBe(c.expected);
    });
  }

  it('ATTENDED WINS: no grant value can produce a typist route on an attended origin', () => {
    // Exhaustive over the other input, which is the only other input there is. The property is
    // "attended is not a tiebreaker, it is a veto", and a table that only checked one grant value
    // would pass with the veto implemented as a tiebreaker.
    for (const grantAllowsUnattendedRelogin of [true, false]) {
      expect(decideReauthRoute({ requiresAttendedAuth: true, grantAllowsUnattendedRelogin })).toBe('ceremony');
    }
  });
});

describe('ensureSession applies the policy before it opens anything', () => {
  it('permissive origin + standing grant -> the typist runs (the silent re-login)', async () => {
    const h = harness({ standingGrant: true });
    const result = await ensureSession(runInput(), h.deps);
    expect(result.status).toBe('reestablished');
    expect(h.typist).toHaveBeenCalledTimes(1);
  });

  it('permissive origin + NO standing grant -> ceremony, and nothing was opened or typed', async () => {
    const h = harness({ standingGrant: false });
    const result = await ensureSession(runInput(), h.deps);

    expect(result).toMatchObject({ status: 'needs-human', route: 'attended', attempted: false });
    expect(result.status === 'needs-human' && result.reason).toContain('no standing grant');
    // The load-bearing half: a refusal that still opened a browser would still have unwrapped a
    // password on its way to failing.
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('ATTENDED origin NEVER re-auths via the typist, even with a live grant', async () => {
    const h = harness({ standingGrant: true });
    const result = await ensureSession(runInput({ requiresAttendedAuth: true }), h.deps);

    expect(result).toMatchObject({ status: 'needs-human', route: 'attended', attempted: false });
    expect(result.status === 'needs-human' && result.reason).toContain('attended login');
    expect(h.openBrowser).not.toHaveBeenCalled();
    expect(h.typist).not.toHaveBeenCalled();
  });

  it('attended + no grant is also a ceremony, and reports the attended reason first', async () => {
    const h = harness({ standingGrant: false });
    const result = await ensureSession(runInput({ requiresAttendedAuth: true }), h.deps);
    // Both reasons are true; the one reported is the one the user cannot fix by issuing a grant.
    expect(result.status === 'needs-human' && result.reason).toContain('attended login');
    expect(h.typist).not.toHaveBeenCalled();
  });
});
