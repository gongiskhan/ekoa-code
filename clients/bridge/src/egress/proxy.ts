/**
 * egress/proxy.ts - the machine's own residential egress, served by the daemon that lives on it.
 *
 * WHY THIS EXISTS. `egress.residential` is the capability that says "a run may leave the network
 * through this machine's connection", and Cortex will only route through a pairing that advertises
 * it AND names an `egressEndpoint` a run can actually be pointed at (`api/src/bridge/egress-
 * endpoint.ts`, `automation/egress-policy.ts` `residentialEgressPairings`). Until now the daemon had
 * no way to BE that endpoint: `egressEndpoint` was a config string the operator had to fill with the
 * address of some proxy they stood up themselves. Nobody does, so in practice no bridge advertised
 * residential egress at all - and the consequence is not merely a missing feature.
 *
 * THE CONSEQUENCE, found live on 2026-08-31 running the cornerstone acceptance runbook. The attended
 * ceremony stamps every session it captures `boundEgress: { kind: 'residential', pairingId: M }`
 * (`api/src/bridge/attended.ts` is the only writer of `establishedBy: machine`). `checkoutSession`
 * then releases that session only while M offers residential egress. A machine with no endpoint
 * offers none, so the session captured BY a ceremony ON that machine could never be checked out
 * again - on the very machine that made it, with the automation already running there. The run saw
 * no session, hit the login wall, and halted asking for the ceremony that had just succeeded.
 *
 * So the daemon serves the endpoint itself. It is on the residential connection by definition; that
 * is the whole reason Cortex wants to route through it.
 *
 * WHAT IT IS. An ordinary forward proxy, the shape Playwright's `proxy.server` speaks:
 *   - `CONNECT host:port`         -> a blind TCP tunnel (every https request)
 *   - `GET http://host/path`      -> an absolute-form request, forwarded (plain http)
 * Nothing is inspected, cached, rewritten or logged beyond a counter. A proxy that read the traffic
 * would be a second place tenant data exists, and this one is carrying sessions.
 *
 * WHY IT IS OPT-IN AND LOOPBACK BY DEFAULT. An open forward proxy on a laptop is an exfiltration
 * surface and, bound to a routable address, an open relay for anyone who can reach the port. So it
 * follows the `local.bash` / `desktop.automation` precedent exactly: off unless the operator turns
 * it on in this machine's own config file, and even then bound to `127.0.0.1` unless they also name
 * a host. Same-machine Cortex (the dev and single-box case) needs nothing more. A remote Cortex
 * needs the daemon reachable at a routable address, which is a deliberate act on a private network -
 * the tailnet the original design assumed - and never a default this code chooses for anyone.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';

/** Loopback: reachable by a Cortex on this machine, by nothing off it. The only safe default. */
const DEFAULT_HOST = '127.0.0.1';

/**
 * A FIXED port, and the reason is the grant.
 *
 * An `egress.residential` grant NAMES the endpoint it authorises and Cortex compares the two by
 * EQUALITY (`api/src/bridge/capability-grants.ts`, `egress-endpoint.ts` canonicalises precisely so
 * that two spellings cannot read as two authorisations). An ephemeral port therefore breaks the
 * grant on every daemon restart: the machine advertises a new address, the stored grant still names
 * the old one, and the capability silently stops being usable until an admin re-grants. A stable
 * port is what makes the authorisation outlive a reboot. Sits next to the local surface's 8791.
 */
const DEFAULT_PORT = 8792;

/** How long a half-open tunnel may sit idle before it is dropped, so a dead peer cannot pin a socket. */
const TUNNEL_IDLE_MS = 120_000;

export interface EgressProxyOptions {
  /** Port to listen on. Defaults to a FIXED port so the grant survives a restart; 0 takes an
   *  ephemeral one, which `address()` then reports. */
  port?: number;
  /** Interface to bind. Defaults to loopback; anything else is the operator's deliberate choice. */
  host?: string;
  /** Progress + refusals, in the daemon's voice. */
  log?: (message: string) => void;
}

export interface EgressProxy {
  /** `host:port` as Cortex should be told to reach it - what becomes `egressEndpoint`. */
  readonly address: string;
  /** Tunnels and forwards served since start. Operational counter; never per-destination. */
  readonly served: number;
  close(): Promise<void>;
}

/**
 * Start the proxy and resolve once it is accepting connections.
 *
 * Rejects rather than resolving degraded when the port cannot be bound: a daemon that advertised
 * `egress.residential` and then had nowhere to serve it would send Cortex routing traffic into a
 * closed port, which is the "black hole" `resolveCapabilities` refuses to create.
 */
export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<EgressProxy> {
  const host = opts.host ?? DEFAULT_HOST;
  const log = opts.log ?? (() => {});
  let served = 0;

  const server: Server = createServer();

  // Plain http, absolute-form. `req.url` is the whole URL rather than a path, which is what makes
  // this a proxy request and not an ordinary one.
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      // https never arrives here - it arrives as CONNECT. Anything else is not a proxy request.
      res.writeHead(400).end();
      return;
    }
    served += 1;
    const upstream = connect(
      { host: target.hostname, port: Number(target.port || 80) },
      () => {
        // Re-emit the request in origin form. The hop-by-hop `proxy-connection` header is dropped;
        // everything else is the client's and is forwarded verbatim.
        const path = `${target.pathname}${target.search}`;
        const headers = Object.entries(req.headers)
          .filter(([k]) => k.toLowerCase() !== 'proxy-connection')
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`)
          .join('');
        upstream.write(`${req.method} ${path} HTTP/1.1\r\n${headers}\r\n`);
        req.pipe(upstream);
      },
    );
    upstream.setTimeout(TUNNEL_IDLE_MS, () => upstream.destroy());
    upstream.on('error', () => {
      // The destination is the caller's problem, not this proxy's. A 502 says the hop failed
      // without pretending to know why the far side is unreachable.
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    // The upstream's raw bytes (status line and headers included) are the response.
    upstream.pipe(res.socket ?? res);
    res.on('close', () => upstream.destroy());
  });

  // https, and anything else tunnelled. The proxy never sees inside - that is the point.
  server.on('connect', (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const [rawHost, rawPort] = (req.url ?? '').split(':');
    const port = Number(rawPort || 443);
    if (!rawHost || !Number.isInteger(port) || port <= 0 || port > 65535) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    served += 1;
    const upstream = connect({ host: rawHost, port }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.setTimeout(TUNNEL_IDLE_MS, () => upstream.destroy());
    const drop = (): void => {
      upstream.destroy();
      clientSocket.destroy();
    };
    upstream.on('error', () => {
      // Before the tunnel is established the client is still speaking HTTP and can be told; after
      // it, there is no framing left to say anything in, so the socket just closes.
      if (!clientSocket.destroyed) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      drop();
    });
    clientSocket.on('error', drop);
    clientSocket.setTimeout(TUNNEL_IDLE_MS, drop);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? DEFAULT_PORT, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    await new Promise<void>((r) => server.close(() => r()));
    throw new Error('egress proxy: the listener reported no address');
  }
  const address = `${host}:${addr.port}`;
  log(`Saída residencial local em http://${address} (proxy servido por esta ponte).`);

  return {
    address,
    get served() {
      return served;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
