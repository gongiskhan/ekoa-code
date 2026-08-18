/**
 * cli/commands/serve.ts — `serve`: connect the daemon to Cortex and hold the connection open.
 *
 * Builds the bridge-token provider from the credential store (persisting any platform-token refresh),
 * dials via BridgeSocket, and logs connection state + inbound frames. Frame handling is a log-only
 * placeholder for this slice: the engine slice wires task delegation onto `onFrame` later. Shutdown is
 * graceful on SIGINT/SIGTERM (close the socket, drop the pidfile). Resolves only when signalled, so
 * unit tests exercise the pre-flight (unpaired) path, not the blocking loop.
 */
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  createBridgeTokenProvider,
  CredentialsError,
  ensureHome,
  loadConfig,
  loadGrants,
  saveConfig,
  type PlatformCredentials,
} from '../../auth/index.js';
import { BridgeSocket } from '../../transport/index.js';
import { DaemonRuntime } from '../../runtime/index.js';
import { BridgeCapability } from '../../wire/index.js';
import { DAEMON_VERSION } from '../../version.js';
import { DEFAULT_SURFACE_PORT, startLocalSurface } from '../../surface/index.js';
import { GrantTable, NonceCache, EgressAccounting } from '../../session/index.js';
import { EgressLedger } from '../../ledger/index.js';
import { pt } from '../../i18n/pt.js';
import { EXIT, flagStr, parseFlags, type CliContext } from '../context.js';
import { isProcessAlive, readDaemonPid, removeDaemonPid, writeDaemonPid } from '../pidfile.js';

/**
 * The capabilities advertised in `hello`.
 *
 * ALWAYS: `local.filesystem` (the daemon's validated core — read/glob/grep/stat/list under the
 * containment resolver) and `attended.card_login` (the ceremony implemented in src/attended).
 *
 * NEVER by default: `local.bash` and `desktop.automation`. Both are exfiltration-capable tier-2
 * surfaces that this daemon does not yet execute over the bridge at all, and a machine that claims
 * them would appear in an operator's grant UI as a plausible thing to switch on. `egress.residential`
 * is advertised only when an endpoint is actually configured, because claiming egress with nowhere
 * to send it would route a tenant's traffic into a black hole.
 *
 * An unknown string in `extraCapabilities` is DROPPED, not passed through: the vocabulary is closed
 * upstream, and one bad entry would fail the whole `hello` frame at Cortex's boundary and leave the
 * machine advertising nothing at all.
 */
export function resolveCapabilities(extra: string[] | undefined, egressEndpoint: string | undefined): BridgeCapability[] {
  const set = new Set<BridgeCapability>(['local.filesystem', 'attended.card_login']);
  for (const raw of extra ?? []) {
    const parsed = BridgeCapability.safeParse(raw);
    if (parsed.success) set.add(parsed.data);
  }
  if (egressEndpoint) set.add('egress.residential');
  else set.delete('egress.residential');
  return [...set].sort();
}

export async function serve(args: string[], ctx: CliContext): Promise<number> {
  const home = ensureHome(ctx.home);
  const { flags } = parseFlags(args);

  // Refuse to start a SECOND daemon on the same home: two serves would fight for the pairing over the
  // socket and clobber the shared pidfile (either one's shutdown then wrongly reports "parado"). A
  // stale pidfile from a crash reads as not-alive (isProcessAlive probes with signal 0) and is ignored.
  const existingPid = readDaemonPid(home);
  if (existingPid !== null && existingPid !== process.pid && isProcessAlive(existingPid)) {
    ctx.io.err(`${pt.errPrefix} ${pt.serveAlreadyRunning(existingPid)}`);
    return EXIT.ERROR;
  }

  let config;
  try {
    config = loadConfig(home);
  } catch (err) {
    if (err instanceof CredentialsError) {
      ctx.io.err(`${pt.errPrefix} ${err.message}`);
      return EXIT.ERROR;
    }
    throw err;
  }
  if (!config || !config.credentials) {
    ctx.io.err(`${pt.errPrefix} ${pt.tokenNoCredentials}`);
    return EXIT.ERROR;
  }
  const cfg = config;

  // The persisted state this process mutates. `creds` is the platform credential (refreshed in
  // place); `binding` is the org + signing secret Cortex hands back on each mint. Both are written
  // through ONE saver so a refresh and a rotation landing in the same dial cannot clobber each
  // other by each spreading its own stale copy of `cfg`.
  let creds: PlatformCredentials = cfg.credentials!;
  let org = cfg.org;
  let signingSecret = cfg.signingSecret;
  const persist = (): void => {
    saveConfig(home, {
      ...cfg,
      credentials: creds,
      ...(org !== undefined ? { org } : {}),
      ...(signingSecret !== undefined ? { signingSecret } : {}),
    });
  };

  const provider = createBridgeTokenProvider({
    cortexBaseUrl: cfg.cortexBaseUrl,
    pairingId: cfg.pairingId,
    getCredentials: () => creds,
    setCredentials: (fresh) => {
      creds = fresh;
      persist();
    },
    fetchImpl: ctx.fetchImpl,
    now: ctx.now,
  });

  // The executor runtime: verifies each delegated task and runs its TaskProgram through the file
  // tier, ledgering under the home. `lastToken` caches the most recent bridge token (minted per dial)
  // so a provider_request during a delegation authenticates with a currently-valid credential.
  let lastToken = '';
  const grants = new GrantTable(loadGrants(home).map((g) => ({ grantRef: g.grantRef, root: g.root, session: g.session })));
  const ledger = new EgressLedger(join(home, 'ledger'));

  ctx.io.out(pt.serveStarting(cfg.cortexBaseUrl));
  // eslint-disable-next-line prefer-const -- `socket` and `runtime` reference each other; both are set below.
  let socket: BridgeSocket;
  const runtime = new DaemonRuntime({
    pairingId: cfg.pairingId,
    // The starting binding is whatever a previous run persisted; the mint below replaces it on
    // every dial. Empty is the honest fail-closed start for a daemon that has never dialled: the
    // verifier refuses an empty secret rather than accepting an unsigned task.
    org: org ?? '',
    signingSecret: signingSecret ?? '',
    grants,
    nonces: new NonceCache(),
    egress: new EgressAccounting(),
    ledger,
    send: (frame) => socket.send(frame),
    getCredential: () => lastToken,
    log: (message) => ctx.io.out(message),
  });

  // What this machine advertises it can do (I-1). Advertisement authorises NOTHING on its own —
  // Cortex intersects it with a per-org capability grant (I-3, default deny) — so the honest list is
  // "what is implemented and validated here", with the rest opt-in via config.
  const capabilities = resolveCapabilities(cfg.extraCapabilities, cfg.egressEndpoint);
  const machineName = cfg.machineName ?? hostname();

  socket = new BridgeSocket({
    wsBase: cfg.cortexBaseUrl,
    pairingId: cfg.pairingId,
    getToken: async () => {
      // The mint is the ONLY place the daemon learns its task binding. Cortex returns the pairing's
      // own signing secret and its org on this owner-bound exchange, and a task cannot be accepted
      // without both (the verifier checks the signature, then cross-org addressing). Because the
      // mint runs per dial, a re-pair or a secret rotation lands on the next reconnect - so it is
      // applied to the LIVE runtime, not just persisted, and takes effect with no restart.
      const mint = await provider.getToken();
      lastToken = mint.token;
      if (runtime.setBinding(mint)) {
        const bound = runtime.currentBinding();
        org = bound.org;
        signingSecret = bound.signingSecret;
        persist();
        // Say that it happened, never WHAT happened: the secret is credential material and the
        // config file it lands in is the thing an operator may end up pasting into a bug report.
        ctx.io.out(pt.serveBindingUpdated);
      }
      return lastToken;
    },
    onFrame: (frame) => {
      ctx.io.out(pt.serveFrame(frame.type));
      runtime.onFrame(frame);
    },
    onStateChange: (state) => {
      ctx.io.out(pt.serveState(state));
      if (state === 'revoked') ctx.io.err(`${pt.errPrefix} ${pt.serveRevoked}`);
      // Advertise on EVERY open, not once at startup: Cortex holds the advertised list on the
      // pairing row and a reconnect after a server restart would otherwise leave the machine
      // listed as capable of nothing, silently un-selecting it for every capability it has.
      if (state === 'open') {
        socket.send(
          DaemonRuntime.helloFrame({
            machineName,
            capabilities,
            daemonVersion: DAEMON_VERSION,
            ...(cfg.egressEndpoint ? { egressEndpoint: cfg.egressEndpoint } : {}),
          }),
        );
        ctx.io.out(pt.serveAdvertised(capabilities));
      }
    },
  });

  writeDaemonPid(home, process.pid);

  // The local, loopback-only browser surface (§18.6; C1/C2): served live by the daemon on a STABLE
  // port so the hosted dashboard can reach it. Best-effort — a bind failure never blocks serving,
  // but it is reported honestly (the web renders its unavailable state against a dead port).
  const flagPort = flagStr(flags, 'port');
  const surfacePort = flagPort !== undefined ? Number(flagPort) : (cfg.surfacePort ?? DEFAULT_SURFACE_PORT);
  if (!Number.isInteger(surfacePort) || surfacePort <= 0 || surfacePort > 65535) {
    ctx.io.err(`${pt.errPrefix} ${pt.serveSurfaceFailed(Number(flagPort), 'porta inválida')}`);
    return EXIT.USAGE;
  }
  let surface: { port: number; close: () => Promise<void> } | undefined;
  void startLocalSurface(
    {
      getStatus: () => ({
        paired: true,
        pairingId: cfg.pairingId,
        ...(org !== undefined ? { org } : {}),
        cortexBaseUrl: cfg.cortexBaseUrl,
        connection: socket.currentState(),
        ...(surface ? { port: surface.port } : {}),
      }),
      ledger,
      ...(cfg.surfaceOrigins !== undefined ? { corsOrigins: cfg.surfaceOrigins } : {}),
      // The browser mint/revoke path (C3): updates grants.json AND the live table the running
      // daemon resolves against, so a dashboard-minted grant works without a restart.
      grants: { home, table: grants, randomSuffix: ctx.randomSuffix, now: ctx.now },
    },
    surfacePort,
  )
    .then((h) => {
      surface = h;
      ctx.io.out(pt.serveSurface(h.port));
    })
    .catch((err: Error) => {
      ctx.io.err(`${pt.errPrefix} ${pt.serveSurfaceFailed(surfacePort, err.message)}`);
    });

  return await new Promise<number>((resolve) => {
    let done = false;
    const shutdown = (): void => {
      if (done) return;
      done = true;
      ctx.io.out(pt.serveStopping);
      socket.close();
      void surface?.close();
      removeDaemonPid(home);
      ctx.io.out(pt.serveStopped);
      resolve(EXIT.OK);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    void socket.connect();
  });
}
