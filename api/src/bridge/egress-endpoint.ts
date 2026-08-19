/**
 * bridge/egress-endpoint.ts - what a machine's SELF-ASSERTED egress address is allowed to be.
 *
 * THE GAP THIS CLOSES. `hello.egressEndpoint` is typed in the wire contract as a free
 * `z.string().max(255).optional()`, and it was carried verbatim from the frame to `registerPairing`
 * to the pairing row to `egressCandidatesForOrg` to `resolveEgress` to `proxyOptionFor` to
 * `browser.newContext({ proxy })`. Nothing on that path looked at it. A daemon could therefore name
 * ANY address - `http://attacker.example:8080`, `http://127.0.0.1:9`, `http://169.254.169.254` -
 * and the org's hosted Chromium would launch through it, credential-gated steps included.
 *
 * I-3 already says the right thing about the CAPABILITY: what a machine advertises is a
 * self-assertion, what the org granted is the authorisation. The address travelled beside the
 * capability and inherited none of that - it was the one part of the advertisement that was
 * believed. This module is the shape half of the answer (`capability-grants.ts` carries the
 * authorisation half: the grant now names the endpoint it authorises).
 *
 * WHAT IS AND IS NOT REFUSED, and why the private-range rule is not the obvious one. The endpoint
 * is a TAILNET address, and a tailnet address is 100.64.0.0/10 (RFC 6598 shared address space) or
 * Tailscale's ULA prefix fd7a:115c:a1e0::/48 - i.e. exactly the ranges a naive "reject private
 * addresses" rule would throw away. So the refusal list is drawn around what a proxy target may
 * never be rather than around "private": loopback, the unspecified address, link-local (which is
 * where the cloud metadata service lives), multicast/broadcast, and the RFC1918 ranges. The tailnet
 * ranges are allowed by name.
 *
 * Link-local is refused UNCONDITIONALLY - `allowPrivate` does not lift it. 169.254.169.254 is an
 * instance metadata endpoint, never a proxy, and a dev switch for loopback has no business
 * reopening it.
 *
 * WHAT THIS CANNOT DO, stated rather than implied: a DNS name is accepted on its shape alone. This
 * function does not resolve, so a hostname pointing at loopback (or re-pointed after validation)
 * is not caught here. That is why validation is only half the fix - a public name is refused by
 * the GRANT not naming it, not by this module.
 */

/** Schemes Playwright will actually proxy through (`newContext({ proxy: { server } })`). */
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'socks5:']);

/** The wire contract's own ceiling (`shared/src/ekoa-local.ts`), re-applied where it is used. */
const MAX_LENGTH = 255;

export interface EgressEndpointPolicy {
  /**
   * Permit loopback and the RFC1918 ranges. OFF by default; a developer running a proxy on their
   * own machine turns it on with `EKOA_BRIDGE_ALLOW_PRIVATE_EGRESS`. It does NOT lift link-local,
   * multicast, or the unspecified address - see the module docblock.
   */
  allowPrivate: boolean;
}

/** Read the policy from env, with the closed default. */
export function egressEndpointPolicy(): EgressEndpointPolicy {
  const raw = process.env.EKOA_BRIDGE_ALLOW_PRIVATE_EGRESS;
  const on = raw !== undefined && raw.trim() !== '' && raw !== 'false' && raw !== '0';
  return { allowPrivate: on };
}

/**
 * The endpoint in CANONICAL form (`scheme://host[:port]`), or null when it may not be used as a
 * proxy target at all.
 *
 * Canonical rather than verbatim because the grant binding downstream is an EQUALITY TEST: two
 * spellings of one address (`100.64.0.7:1080` and `http://100.64.0.7:1080/`) must not be able to
 * read as two different authorisations, in either direction.
 */
export function normaliseEgressEndpoint(
  raw: string | null | undefined,
  policy: EgressEndpointPolicy = egressEndpointPolicy(),
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_LENGTH) return null;

  // Playwright treats the short form `host:port` as an HTTP proxy. Spell it out rather than letting
  // `new URL` guess - `100.64.0.7:1080` has no valid scheme and would simply fail to parse.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return null;
  // Credentials embedded in the address are refused rather than carried: Playwright takes proxy
  // credentials as their own fields, so a `user:pass@` here is either a mistake or an attempt to
  // smuggle something through a field nobody reads.
  if (url.username !== '' || url.password !== '') return null;
  // A proxy target is a host and a port. A path, query or fragment means this is not one.
  if (url.pathname !== '' && url.pathname !== '/') return null;
  if (url.search !== '' || url.hash !== '') return null;
  if (url.hostname === '') return null;
  if (!hostMayCarryEgress(url.hostname, policy)) return null;

  return `${url.protocol}//${url.host}`;
}

/** Whether a host (an IP literal or a DNS name) may be a proxy target under `policy`. */
function hostMayCarryEgress(hostname: string, policy: EgressEndpointPolicy): boolean {
  // `URL` lowercases the host but KEEPS the IPv6 brackets (`[::1]`), and a bracketed literal that
  // simply fails to parse would be refused for the wrong reason - which is a false negative today
  // and a false POSITIVE the moment anything downstream reads the address differently. Strip them,
  // and normalise away the trailing-dot form of a fully-qualified name so `localhost.` cannot slip
  // past the name check.
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname.replace(/\.$/, '');
  if (host === '') return false;

  const v4 = parseIPv4(host);
  if (v4) return ipv4MayCarryEgress(v4, policy);

  if (host.includes(':')) {
    const v6 = parseIPv6(host);
    return v6 ? ipv6MayCarryEgress(v6, policy) : false;
  }

  // A DNS name. `localhost` and the `.localhost` special-use TLD (RFC 6761) are loopback by
  // definition, so they follow the loopback rule; everything else is accepted on shape (see the
  // module docblock on what that does and does not prove).
  if (host === 'localhost' || host.endsWith('.localhost')) return policy.allowPrivate;
  return true;
}

/** A strict dotted quad, or null when `host` is not an IPv4 literal. */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function ipv4MayCarryEgress(ip: [number, number, number, number], policy: EgressEndpointPolicy): boolean {
  const [a, b] = ip;
  // THE TAILNET RANGE, allowed by name and checked FIRST so no later rule can take it back:
  // 100.64.0.0/10 is what Tailscale hands out, and it is the whole point of this field.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return false; // "this network" / unspecified
  if (a === 169 && b === 254) return false; // link-local, incl. 169.254.169.254 (metadata)
  if (a >= 224) return false; // multicast, reserved, and 255.255.255.255
  if (a === 127) return policy.allowPrivate; // loopback
  if (a === 10) return policy.allowPrivate;
  if (a === 172 && b >= 16 && b <= 31) return policy.allowPrivate;
  if (a === 192 && b === 168) return policy.allowPrivate;
  return true;
}

/** Eight 16-bit groups, or null when `host` is not an IPv6 literal. Handles `::` and the
 *  IPv4-in-IPv6 tail (`::ffff:127.0.0.1`), which is exactly how a loopback slips past a check
 *  written against the textual form. */
function parseIPv6(host: string): number[] | null {
  const lastColon = host.lastIndexOf(':');
  if (lastColon === -1) return null;

  // Rewrite an IPv4 tail into the two hex groups it stands for, so everything below parses one
  // shape. `::ffff:127.0.0.1` becomes `::ffff:7f00:0001`.
  let text = host;
  const tailText = host.slice(lastColon + 1);
  if (tailText.includes('.')) {
    const v4 = parseIPv4(tailText);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${host.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const toGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const out: number[] = [];
    for (const piece of segment.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = toGroups(halves[0]!);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]!);
  if (!tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null; // `::` stands for AT LEAST one zero group
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function ipv6MayCarryEgress(groups: number[], policy: EgressEndpointPolicy): boolean {
  const g0 = groups[0]!;
  // IPv4-mapped (::ffff:a.b.c.d) is an IPv4 address wearing a hat; judge it as one.
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    const a = (groups[6]! >> 8) & 0xff;
    const b = groups[6]! & 0xff;
    const c = (groups[7]! >> 8) & 0xff;
    const d = groups[7]! & 0xff;
    return ipv4MayCarryEgress([a, b, c, d], policy);
  }
  if (groups.every((g) => g === 0)) return false; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return policy.allowPrivate; // ::1
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g0 >> 8) === 0xff) return false; // ff00::/8 multicast
  // Tailscale's ULA prefix, allowed by name for the same reason 100.64.0.0/10 is.
  if (g0 === 0xfd7a && groups[1] === 0x115c && groups[2] === 0xa1e0) return true;
  if ((g0 & 0xfe00) === 0xfc00) return policy.allowPrivate; // the rest of fc00::/7
  return true;
}
