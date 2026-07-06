/**
 * SSRF guard (ch09 invariant 8, FIXED-8). Zero-dependency. Whenever the platform itself
 * fetches a user-supplied URL (brand research target, knowledge crawl sources, uploaded
 * link fetches), the URL passes this guard first: scheme allowlist + private/link-local/
 * loopback address rejection, hardened against the common bypasses (trailing-dot, decimal/
 * hex IP encodings, IPv6-mapped IPv4, bracketed IPv6). The guardedFetch layer additionally
 * resolves the hostname and re-checks every resolved IP (defense against DNS rebinding).
 * User-defined INTEGRATION actions are deliberately out of scope (they call arbitrary
 * user-configured endpoints under the owner's own credentials — ch09 invariant 8 scope).
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/** Is this IPv4 (as four octets) in a private / loopback / link-local / reserved range? */
export function isBlockedIpv4Octets(a: number, b: number): boolean {
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local (cloud metadata!)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT 100.64/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/** Parse a host as a possibly-encoded IPv4 literal (dotted, decimal, or hex). Returns octets or null. */
function parseIpv4(host: string): [number, number, number, number] | null {
  // dotted-quad
  const dotted = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (dotted) {
    const o = dotted.slice(1).map(Number) as [number, number, number, number];
    if (o.every((n) => n <= 255)) return o;
  }
  // single decimal (e.g. 2130706433 = 127.0.0.1) or hex (0x7f000001)
  let n: number | null = null;
  if (/^\d+$/.test(host)) n = Number(host);
  else if (/^0x[0-9a-f]+$/i.test(host)) n = parseInt(host, 16);
  if (n !== null && Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  return null;
}

/** Is a bracket-stripped IPv6 (or IPv4-mapped) address blocked? */
function isBlockedIpv6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === '::1' || a === '::') return true; // loopback / unspecified
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // unique-local
  if (a.startsWith('fe80')) return true; // link-local
  // IPv4-mapped (::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(a);
  if (mapped) {
    const o = parseIpv4(mapped[1] as string);
    return o ? isBlockedIpv4Octets(o[0], o[1]) : true;
  }
  const mappedHex = /::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (mappedHex) {
    // Only the high 16 bits (the first two IPv4 octets) decide every blocked class.
    const hi = parseInt(mappedHex[1] as string, 16);
    return isBlockedIpv4Octets((hi >> 8) & 255, hi & 255) || ((hi >> 8) & 255) === 127;
  }
  return false;
}

/** Normalize a hostname: lowercase and strip a single trailing dot. */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/** Check a hostname (already normalized) against name + IP blocklists. */
export function isBlockedHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  // bracketed IPv6
  if (host.startsWith('[') && host.endsWith(']')) return isBlockedIpv6(host.slice(1, -1));
  // bare IPv6 (URL usually brackets, but be safe)
  if (host.includes(':')) return isBlockedIpv6(host);
  const octets = parseIpv4(host);
  if (octets) return isBlockedIpv4Octets(octets[0], octets[1]);
  return false;
}

/** Validate a user-supplied URL for SSRF safety. Throws SsrfError on rejection. */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfError(`Scheme not allowed: ${url.protocol}`);
  }
  const host = normalizeHost(url.hostname);
  if (isBlockedHost(host)) throw new SsrfError(`Blocked host: ${host}`);
  return url;
}

export function isSafeUrl(raw: string): boolean {
  try {
    assertSafeUrl(raw);
    return true;
  } catch {
    return false;
  }
}
