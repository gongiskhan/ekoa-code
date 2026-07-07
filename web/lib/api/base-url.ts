/**
 * The single API base-URL resolver (ch12 §12.2.5). No other module in `web/` constructs
 * an API origin (acceptance criterion 5: exactly one resolver). This reconciles the two
 * divergent copies the old client carried (FC-016): the REST path trusted
 * `NEXT_PUBLIC_API_URL` verbatim, while the connection/provider path took only the PORT
 * from the env value and the host from `window.location.hostname` for LAN/Tailscale dev
 * access (FC-025). Both semantics live here as one function.
 *
 * Semantics:
 *  - `NEXT_PUBLIC_API_URL` unset-or-empty-string in the browser -> same-origin (Caddy proxy).
 *  - env points at localhost (dev) -> keep its PORT, adopt the browser's hostname+protocol,
 *    so access via a Tailscale/LAN IP does not resolve "localhost" to the client device.
 *  - env points at a real host (prod: api.ekoa.io vs app.ekoa.io) -> taken verbatim.
 *  - SSR without an env value throws (the bundle was built without next.config.ts injection).
 *
 * Build-time injection from `../backend.port` stays in `next.config.ts` (unchanged).
 */

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function resolveBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;

  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;

    // Explicit same-origin marker (empty string) or missing value: use the browser origin.
    if (!fromEnv) {
      return `${protocol}//${hostname}`;
    }

    // Dev convenience: env is localhost -> keep the port, adopt the browser's host so the
    // app reached over a LAN/Tailscale address still hits the dev machine's API.
    try {
      const parsed = new URL(fromEnv);
      if (isLocalHost(parsed.hostname)) {
        return parsed.port ? `${protocol}//${hostname}:${parsed.port}` : `${protocol}//${hostname}`;
      }
    } catch {
      // Non-URL env value: fall through to verbatim.
    }

    // Production: env carries protocol + host + (port) for a distinct API origin. Verbatim.
    return fromEnv;
  }

  // Server-side rendering: NEXT_PUBLIC_API_URL is injected by next.config.ts from
  // ../backend.port. If it is missing the bundle was built wrong; surface loudly.
  if (!fromEnv) {
    throw new Error(
      'resolveBaseUrl(): NEXT_PUBLIC_API_URL is not set (server-side). next.config.ts ' +
        'should inject it from backend.port - check the dev scripts and the build environment.',
    );
  }
  return fromEnv;
}
