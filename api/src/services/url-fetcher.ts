/**
 * Guarded URL fetcher (ch09 invariant 8). The single write path for platform-initiated
 * fetches of user-supplied URLs — it calls the SSRF guard before every request. A route or
 * service that fetches a request-derived URL without this fetcher is a review-rejectable
 * finding (stated in CLAUDE.md).
 */
import { lookup } from 'node:dns/promises';
import { assertSafeUrl, isBlockedIpv4Octets, SsrfError } from './url-safety.js';

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
      // IPv4-mapped IPv6 (::ffff:a.b.c.d): apply the SAME IPv4 block list, not just the 127/8 case
      // (Codex checkpoint: ::ffff:10/8, 172.16/12, 192.168/16, 169.254/16 were bypassing the guard).
      const mapped = /^::ffff:(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(a);
      if (mapped && isBlockedIpv4Octets(Number(mapped[1]), Number(mapped[2]))) {
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
