import { describe, it, expect } from 'vitest';
import { UNLOCK_DURATIONS, offersDurationControl } from '@/stores/cofre';
import type { CofreItem } from '@ekoa/shared';

/**
 * Cofre UI rules (WS-D). Two of these are the UI half of invariants enforced twice already — in
 * the shared schema and again in the service — so this is the third layer, not the only one.
 */
const item = (over: Partial<CofreItem>): CofreItem =>
  ({
    id: 'i1',
    ref: 'cofre:i1',
    type: 'password',
    label: 'Citius',
    state: 'locked',
    boundOrigins: ['citius.tribunaisnet.mj.pt'],
    createdAt: '2026-07-27T00:00:00.000Z',
    ...over,
  }) as CofreItem;

describe('I7 — a signature identity gets NO duration control', () => {
  it('offers no duration control for a certificate identity', () => {
    expect(offersDurationControl(item({ type: 'certificate_identity' }))).toBe(false);
  });

  it.each(['password', 'api_key', 'oauth_token', 'totp_seed', 'session', 'software_certificate'] as const)(
    'offers the control for %s',
    (type) => {
      expect(offersDurationControl(item({ type }))).toBe(true);
    },
  );
});

describe('the unlock durations match the consent-page spec', () => {
  it('offers exactly the six resting choices, in order', () => {
    expect(UNLOCK_DURATIONS.map((d) => d.value)).toEqual([
      '10_minutes',
      '40_minutes',
      '1_day',
      '1_week',
      '1_month',
      'until_locked',
    ]);
  });

  it('does NOT offer this_run — it is issued BY a run, never chosen from a resting list', () => {
    // Offering it here would let a user "unlock for a run" with no run in play, producing a grant
    // that can never be consumed.
    expect(UNLOCK_DURATIONS.map((d) => d.value)).not.toContain('this_run');
  });

  it('labels every option in PT-PT', () => {
    for (const d of UNLOCK_DURATIONS) {
      expect(d.labelKey.length).toBeGreaterThan(0);
      expect(d.labelKey).not.toMatch(/minutes|day|week|month|until/i);
    }
  });
});
