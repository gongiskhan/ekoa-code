import { describe, it, expect } from 'vitest';
import { assertSafeUrl, isSafeUrl, SsrfError } from '../../src/services/url-safety.js';

/** SSRF guard unit tests (ch09 invariant 8): localhost, 169.254.x, RFC-1918, file: all rejected. */
describe('SSRF guard (ch09 invariant 8)', () => {
  const blocked = [
    'http://localhost/x',
    'http://127.0.0.1/x',
    'https://127.0.0.1:8080/admin',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata — the classic SSRF target
    'http://10.0.0.5/x',
    'http://172.16.0.1/x',
    'http://192.168.1.1/x',
    'http://100.64.0.1/x',
    'http://0.0.0.0/x',
    'file:///etc/passwd',
    'gopher://evil/x',
    'http://[::1]/x',
    'ftp://host/x',
    'not-a-url',
  ];
  for (const u of blocked) {
    it(`rejects ${u}`, () => {
      expect(isSafeUrl(u)).toBe(false);
      expect(() => assertSafeUrl(u)).toThrow(SsrfError);
    });
  }

  // Codex-review regressions: encoded-IP and normalization bypasses.
  const bypasses = [
    'http://localhost./admin', // trailing-dot loopback
    'http://LOCALHOST/x', // uppercase
    'http://2130706433/x', // decimal 127.0.0.1
    'http://0x7f000001/x', // hex 127.0.0.1
    'http://[::ffff:127.0.0.1]/x', // IPv6-mapped loopback
    'http://[::ffff:169.254.169.254]/x', // IPv6-mapped metadata
    'http://[::1]/x', // IPv6 loopback
    'http://[fd00::1]/x', // IPv6 ULA
  ];
  for (const u of bypasses) {
    it(`rejects bypass ${u}`, () => {
      expect(isSafeUrl(u)).toBe(false);
    });
  }

  const allowed = ['https://example.com/x', 'http://8.8.8.8/x', 'https://dgsi.pt/jtrl'];
  for (const u of allowed) {
    it(`allows ${u}`, () => {
      expect(isSafeUrl(u)).toBe(true);
    });
  }
});
