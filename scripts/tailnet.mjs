/**
 * Resolve this machine's tailscale addresses, for exposing the dev stack on the tailnet
 * (`npm run dev -- --tailnet`, or EKOA_TAILNET=1 on the run-ekoa-code driver).
 *
 * MagicDNS name first (memorable, and what `tailscale status` advertises to every peer),
 * IPv4 second (still works from a peer that has MagicDNS resolution off). Returns null when
 * the tailscale CLI is absent or the backend is not Running - callers decide how loud to be.
 */
import { spawnSync } from 'node:child_process';

export function resolveTailnetHosts() {
  const st = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
  if (st.status !== 0 || !st.stdout) return null;
  let status;
  try {
    status = JSON.parse(st.stdout);
  } catch {
    return null;
  }
  if (status.BackendState !== 'Running' || !status.Self) return null;
  const dnsName = (status.Self.DNSName || '').replace(/\.$/, '');
  const ipv4 = (status.Self.TailscaleIPs || []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || '';
  const hosts = [dnsName, ipv4].filter(Boolean);
  if (!hosts.length) return null;
  const certsEnabled = Array.isArray(status.CertDomains) && status.CertDomains.length > 0;
  return { hosts, dnsName: dnsName || null, ipv4: ipv4 || null, certsEnabled };
}

/**
 * Idempotently ensure `tailscale serve` terminates TLS on the given ports and proxies to the
 * given local targets (https://<node>:<port> -> target). Chrome treats a ts.net host it has
 * seen HTTPS on as https-only (HSTS is host-wide and port-agnostic, and the dashboard itself
 * sends a 2y HSTS header), so plain-http tailnet URLs on such a host die with
 * ERR_SSL_PROTOCOL_ERROR - TLS on the SAME port numbers makes the forced upgrade just work.
 *
 * Never touches ports it was not given, and never rebinds a port someone else configured to a
 * different target (returns a conflict instead - this box carries many standing serve mounts).
 *
 * mappings: [{ port, target }] - returns 'on' | 'no-certs' | 'unavailable' | 'error: ...'.
 */
export function ensureTailnetServe(mappings) {
  const tailnet = resolveTailnetHosts();
  if (!tailnet || !tailnet.dnsName) return 'unavailable';
  if (!tailnet.certsEnabled) return 'no-certs';
  const cur = spawnSync('tailscale', ['serve', 'status', '--json'], { encoding: 'utf8' });
  let existing = {};
  try {
    existing = JSON.parse(cur.stdout || '{}') || {};
  } catch { /* treat as empty */ }
  for (const { port, target } of mappings) {
    const mount = existing.Web?.[`${tailnet.dnsName}:${port}`]?.Handlers?.['/']?.Proxy;
    if (mount === target) continue; // already ours
    if (mount || existing.TCP?.[String(port)]) {
      return `error: tailscale serve port ${port} is already mapped to ${mount || 'a TCP handler'} - not rebinding it`;
    }
    const r = spawnSync('tailscale', ['serve', '--bg', `--https=${port}`, target], { encoding: 'utf8' });
    if (r.status !== 0) return `error: tailscale serve --https=${port} failed: ${(r.stderr || r.stdout || '').trim()}`;
  }
  return 'on';
}
