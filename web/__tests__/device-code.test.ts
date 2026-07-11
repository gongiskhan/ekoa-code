import { describe, it, expect } from 'vitest';
import { normalizeUserCode } from '@/lib/device-code';

/** s3 — the /settings/devices input normalizer must produce the server's exact
 *  `XXXX-XXXX` shape (approve is an exact-string match on a pending row). */
describe('normalizeUserCode', () => {
  it('uppercases and inserts the hyphen after 4 characters', () => {
    expect(normalizeUserCode('bcdf2345')).toBe('BCDF-2345');
    expect(normalizeUserCode('BCDF-2345')).toBe('BCDF-2345');
  });
  it('strips separators and noise the user may paste', () => {
    expect(normalizeUserCode(' bcdf 2345 ')).toBe('BCDF-2345');
    expect(normalizeUserCode('bc-df-23-45')).toBe('BCDF-2345');
  });
  it('caps at 8 code characters', () => {
    expect(normalizeUserCode('BCDF2345XXXX')).toBe('BCDF-2345');
  });
  it('partial input stays unhyphenated until the 5th character', () => {
    expect(normalizeUserCode('bcd')).toBe('BCD');
    expect(normalizeUserCode('bcdf2')).toBe('BCDF-2');
  });
});
