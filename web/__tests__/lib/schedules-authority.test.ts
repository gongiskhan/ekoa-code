/**
 * The rendering gate for schedule controls. It has to agree with the SERVER's write rule
 * (`api/src/schedules/store.ts` canEditSchedule: owner, or super-admin), because every control
 * it lets through that the server refuses becomes a click that 404s for no reason the user can
 * see - and every control it wrongly withholds is a feature the owner cannot reach.
 */
import { describe, it, expect } from 'vitest';
import { canActOnOwned } from '@/lib/schedules/authority';

const owner = { id: 'u-me', role: 'user' };
const admin = { id: 'u-admin', role: 'org-admin' };
const superAdmin = { id: 'u-super', role: 'super-admin' };

describe('canActOnOwned', () => {
  it('lets the owner act on its own', () => {
    expect(canActOnOwned(owner, 'u-me')).toBe(true);
  });

  it('refuses an org-admin on a peer\'s - reading the org is not writing to it', () => {
    expect(canActOnOwned(admin, 'u-me')).toBe(false);
  });

  it('lets an org-admin act on its own', () => {
    expect(canActOnOwned(admin, 'u-admin')).toBe(true);
  });

  it('lets a super-admin act on anything', () => {
    expect(canActOnOwned(superAdmin, 'u-me')).toBe(true);
  });

  it('withholds everything from a signed-out reader', () => {
    expect(canActOnOwned(null, 'u-me')).toBe(false);
    expect(canActOnOwned(undefined, undefined)).toBe(false);
  });

  it('treats an absent ownerId as "cannot prove this is a peer\'s"', () => {
    // The service always fills ownerId, so this is the shape of an older payload only. Stripping
    // the owner's own controls off every row would be a worse failure than one refused click.
    expect(canActOnOwned(owner, undefined)).toBe(true);
  });
});
