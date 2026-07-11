/**
 * Guarded URL fetcher (ch09 invariant 8). The single write path for platform-initiated
 * fetches of user-supplied URLs — it calls the SSRF guard before every request. A route or
 * service that fetches a request-derived URL without this fetcher is a review-rejectable
 * finding (stated in CLAUDE.md).
 */
import { lookup } from 'node:dns/promises';
import { assertSafeUrl, isBlockedIpv4Octets, SsrfError } from './url-safety.js';

/** The first two octets of an IPv4-mapped IPv6 address, in EITHER form, or null if not mapped:
 *   ::ffff:10.0.0.1        (dotted)   and   ::ffff:0a00:0001 / ::ffff:a00:1   (hex groups).
 *  Node's dns.lookup usually returns the dotted form, but a resolver may hand back hex - the
 *  hex form was bypassing the dotted-only guard (Codex checkpoint recheck). We normalize both to
 *  the mapped IPv4's first two octets so the private-IPv4 block list applies uniformly. */
export function mappedIpv4FirstOctets(a: string): [number, number] | null {
  if (!a.startsWith('::ffff:')) return null;
  const rest = a.slice('::ffff:'.length);
  if (rest.includes('.')) {
    const p = rest.split('.');
    return p.length === 4 ? [Number(p[0]), Number(p[1])] : null;
  }
  // Hex form: the mapped IPv4 is the last 32 bits = two hextets. Each `:`-separated group is one
  // hextet and MUST be left-padded to 4 digits BEFORE concatenation (::ffff:a00:1 is 0a00:0001 =
  // 10.0.0.1, NOT a0:01) - concatenating the raw groups mis-decodes the octets.
  const groups = rest.split(':');
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const padded = groups.map((g) => g.padStart(4, '0'));
  while (padded.length < 2) padded.unshift('0000');
  const h = padded.slice(-2).join(''); // last two hextets = the 32-bit mapped IPv4
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16)];
}

export interface GuardedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/** Resolve the hostname and reject if ANY resolved address is private/loopback/link-local —
 *  defense against DNS rebinding (a public name resolving to 127.0.0.1 / 169.254.169.254).
 *  A residual TOCTOU between resolve and connect remains; true IP-pinning needs a custom
 *  socket agent (noted as a hardening follow-up), but this closes the common rebinding path. */
async function assertResolvedIpsSafe(hostname: string): Promise<void> {
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    return; // resolution failure surfaces as a normal fetch error downstream
  }
  for (const { address, family } of addrs) {
    if (family === 4) {
      const o = address.split('.').map(Number);
      if (isBlockedIpv4Octets(o[0] as number, o[1] as number)) throw new SsrfError(`Resolved to blocked address: ${address}`);
    } else if (family === 6) {
      const a = address.toLowerCase();
      // IPv4-mapped IPv6 (::ffff:a.b.c.d OR the hex form ::ffff:0a00:0001): apply the SAME IPv4
      // block list, not just the 127/8 case (Codex checkpoint: ::ffff:10/8, 172.16/12, 192.168/16,
      // 169.254/16 - in either notation - were bypassing the guard).
      const mapped = mappedIpv4FirstOctets(a);
      if (mapped && isBlockedIpv4Octets(mapped[0], mapped[1])) {
        throw new SsrfError(`Resolved to blocked address: ${address}`);
      }
      if (a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) {
        throw new SsrfError(`Resolved to blocked address: ${address}`);
      }
    }
  }
}

export async function guardedFetch(url: string, opts: GuardedFetchOptions = {}): Promise<Response> {
  const parsed = assertSafeUrl(url); // throws SsrfError on a private/loopback/disallowed URL literal
  await assertResolvedIpsSafe(parsed.hostname); // re-check resolved IPs (DNS rebinding)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      redirect: 'error', // do not silently follow a redirect to a private address
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Guarded fetch that FOLLOWS redirects, re-validating every hop through the SSRF guard (ch09
 * invariant 8; the brief's "redirects re-validated"). `guardedFetch` uses `redirect: 'error'`,
 * which is correct when a redirect would be an SSRF vector but wrong for legitimate public
 * fetches that hop apex->www or http->https (brand-research targets, logo CDNs). This variant
 * fetches with `redirect: 'manual'` and re-runs `assertSafeUrl` + the resolved-IP re-check on the
 * `Location` of every 3xx before following it, so a redirect to a private/loopback address is
 * rejected the same way a direct one is. Bounded by `maxRedirects` (a redirect loop throws).
 * The returned Response's `url` is the final hop (manual mode does not rewrite it).
 */
export async function guardedFetchFollow(
  url: string,
  opts: GuardedFetchOptions = {},
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = assertSafeUrl(current); // per-hop literal guard (scheme + private-IP encodings)
    await assertResolvedIpsSafe(parsed.hostname); // per-hop resolved-IP guard (DNS rebinding)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await fetch(current, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        redirect: 'manual', // we follow by hand so each hop is re-validated above
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res; // a non-redirect response (or a 3xx without Location) is the answer
    // Resolve the next hop against the current URL and loop — the top of the loop re-guards it.
    current = new URL(location, current).toString();
  }
  throw new SsrfError('Too many redirects');
}
