import { describe, it, expect } from 'vitest';
import { mappedIpv4FirstOctets } from '../../src/services/url-fetcher.js';
import { isBlockedIpv4Octets } from '../../src/services/url-safety.js';

/**
 * IPv4-mapped IPv6 SSRF-guard normalization (Codex checkpoint, url-fetcher). A private IPv4 mapped
 * into IPv6 must be blocked in BOTH the dotted (::ffff:10.0.0.1) AND the hex (::ffff:0a00:0001,
 * ::ffff:a00:1) notations - each hextet left-padded to 4 digits before decoding the mapped octets.
 */
describe('mappedIpv4FirstOctets - dotted + hex (incl shortened) forms', () => {
  const priv: Array<[string, [number, number]]> = [
    ['::ffff:10.0.0.1', [10, 0]],
    ['::ffff:0a00:0001', [10, 0]],
    ['::ffff:a00:1', [10, 0]], // shortened hex - the bug the recheck caught
    ['::ffff:ac10:1', [172, 16]],
    ['::ffff:c0a8:1', [192, 168]],
    ['::ffff:a9fe:1', [169, 254]],
    ['::ffff:7f00:1', [127, 0]],
  ];
  for (const [addr, exp] of priv) {
    it(`${addr} -> ${exp.join('.')}.x and is BLOCKED`, () => {
      const o = mappedIpv4FirstOctets(addr);
      expect(o).toEqual(exp);
      expect(isBlockedIpv4Octets(o![0], o![1])).toBe(true);
    });
  }
  it('a public mapped address (8.8.8.8) is decoded but NOT blocked', () => {
    const o = mappedIpv4FirstOctets('::ffff:0808:0808');
    expect(o).toEqual([8, 8]);
    expect(isBlockedIpv4Octets(o![0], o![1])).toBe(false);
  });
  it('non-mapped IPv6 returns null', () => {
    expect(mappedIpv4FirstOctets('2001:db8::1')).toBeNull();
    expect(mappedIpv4FirstOctets('fe80::1')).toBeNull();
  });
});
