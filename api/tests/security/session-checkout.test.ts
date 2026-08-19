import { describe, it, expect } from 'vitest';
import type { CofreItemDoc } from '../../src/cofre/types.js';
import { checkoutSession, reestablishRouteFor, markUnhealthy } from '../../src/cofre/session-checkout.js';

/**
 * SECURITY SUITE — session health and egress-matched checkout (Cofre G-4 / G-5).
 *
 * WHY A SESSION IS NOT A TOKEN YOU CAN USE ANYWHERE. It was established from a particular vantage
 * point, and portals notice when that changes. Replaying a session captured on a lawyer's home
 * connection from a datacenter IP is the exact pattern fraud systems exist to flag: same cookie,
 * different continent. The failure is not clean either — it is an account lock, a forced
 * re-verification, or a silent shadow-ban that presents as the automation being flaky.
 *
 * So the decision is ordered: health first, then egress. Asking about the route for a dead session
 * answers the wrong question and points the operator at the network when the problem is the
 * credential.
 */
const at = (ms: number) => new Date(ms).toISOString();
const NOW = 1_800_000_000_000;

function sessionItem(over: Partial<Record<string, unknown>> = {}): CofreItemDoc {
  return {
    _id: 'itm-1',
    type: 'session',
    label: 'Citius',
    expiresAt: at(NOW + 86_400_000),
    sessionMetadata: {
      establishedBy: { kind: 'machine', pairingId: 'p-home' },
      boundEgress: { kind: 'residential', pairingId: 'p-home' },
      establishedAt: at(NOW - 3_600_000),
      healthy: true,
    },
    ...over,
  } as unknown as CofreItemDoc;
}

describe('G-4: health decides FIRST, and the route follows provenance', () => {
  it('an expired session is refused with a re-establishment route, not an egress verdict', () => {
    const d = checkoutSession({ item: sessionItem({ expiresAt: at(NOW - 1) }), residentialAvailable: ['p-home'], now: NOW });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    // Reporting "no route" for something that needs re-authentication sends the operator to look
    // at the network when the problem is the credential.
    expect(d.reason).toBe('expired');
  });

  it('an UNHEALTHY session is refused even while unexpired', () => {
    const d = checkoutSession({ item: markUnhealthy(sessionItem()), residentialAvailable: ['p-home'], now: NOW });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('unhealthy');
  });

  it('health is checked BEFORE egress — an expired session with no egress still reports expired', () => {
    const d = checkoutSession({ item: sessionItem({ expiresAt: at(NOW - 1) }), residentialAvailable: [], now: NOW });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('expired');
  });

  it('a card-established session re-establishes ATTENDED — a typist cannot repeat a ceremony', () => {
    expect(reestablishRouteFor(sessionItem())).toBe('attended');
  });

  /**
   * A DEFENSIVE BRANCH OVER A SHAPE NOTHING CURRENTLY WRITES, and that is stated here so a reader
   * cannot mistake this fixture for evidence that the product emits one.
   *
   * `sessionMetadata` is persisted opaque and never re-validated on the way back, so this function
   * must answer for whatever a row happens to carry - which is why machine+datacenter has a branch
   * at all. But no writer in this repo produces it: `bridge/attended.ts` writes machine+residential
   * and the hosted typist writes cloud+datacenter (`automation/session-establishment.ts`), and
   * `EstablishmentVantage`, the only other route to the field, has no production producer. Fixtures
   * elsewhere that treated this pairing as an ordinary session made the whole P4.2 path look
   * exercised while it was dead (docs/findings.md, 2026-08-19).
   */
  it('a plain machine session re-establishes via the TYPIST', () => {
    const item = sessionItem({
      sessionMetadata: {
        establishedBy: { kind: 'machine', pairingId: 'p1' },
        boundEgress: { kind: 'datacenter' },
        establishedAt: at(NOW),
        healthy: true,
      },
    });
    expect(reestablishRouteFor(item)).toBe('typist');
  });

  it('UNKNOWN provenance is treated as ATTENDED — the conservative direction', () => {
    // A session we cannot read might have come from a card ceremony. Quietly re-running a typist
    // against a portal that wanted a smartcard fails in a way that looks like a bad password,
    // which is how accounts get locked.
    expect(reestablishRouteFor({ _id: 'x', type: 'session' } as unknown as CofreItemDoc)).toBe('attended');
  });
});

describe('G-5: checkout matches the egress the session was made from', () => {
  it('a residential session checks out over ITS machine', () => {
    const d = checkoutSession({ item: sessionItem(), residentialAvailable: ['p-home'], now: NOW });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.egress).toEqual({ kind: 'residential', pairingId: 'p-home' });
  });

  it('THE CASE THAT MATTERS: it refuses when only datacenter egress is available', () => {
    // Same cookie, different continent. The plan's own acceptance: "a session bound to residential
    // egress refuses checkout when only datacenter egress is available."
    const d = checkoutSession({ item: sessionItem(), residentialAvailable: [], now: NOW });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('egress-unavailable');
    if (d.reason === 'egress-unavailable') expect(d.required).toEqual({ kind: 'residential', pairingId: 'p-home' });
  });

  it('ANOTHER machine\'s residential line is not a substitute', () => {
    // A different household on a different ASN is as foreign to the portal as a datacenter, and
    // more confusing when it fails.
    const d = checkoutSession({ item: sessionItem(), residentialAvailable: ['p-someone-else'], now: NOW });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('egress-unavailable');
  });

  it('a datacenter-bound session checks out over datacenter', () => {
    const item = sessionItem({
      sessionMetadata: {
        establishedBy: { kind: 'cloud' },
        boundEgress: { kind: 'datacenter' },
        establishedAt: at(NOW),
        healthy: true,
      },
    });
    const d = checkoutSession({ item, residentialAvailable: [], now: NOW });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.egress).toEqual({ kind: 'datacenter' });
  });

  it('a session with NO recorded binding takes the datacenter route', () => {
    // Predates the metadata. Datacenter is the honest default: it fails visibly at the portal
    // rather than silently succeeding from somewhere unexpected.
    const d = checkoutSession({ item: { _id: 'x', type: 'session' } as unknown as CofreItemDoc, residentialAvailable: [], now: NOW });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.egress).toEqual({ kind: 'datacenter' });
  });

  it('returns a DECISION, never a fallback — the caller owns the offline policy', () => {
    // The refusal carries what was required so the run can apply fail/queue/datacenter itself. A
    // checkout helper that silently downgraded to datacenter would take that choice away.
    const d = checkoutSession({ item: sessionItem(), residentialAvailable: [], now: NOW });
    expect(d.ok).toBe(false);
    if (!d.ok && d.reason === 'egress-unavailable') expect(d.required.pairingId).toBe('p-home');
  });
});
