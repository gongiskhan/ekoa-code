/**
 * cli/commands/serve.ts — `serve`: connect the daemon to Cortex and hold the connection open.
 *
 * Builds the bridge-token provider from the credential store (persisting any platform-token refresh),
 * dials via BridgeSocket, and logs connection state + inbound frames. Frame handling is a log-only
 * placeholder for this slice: the engine slice wires task delegation onto `onFrame` later. Shutdown is
 * graceful on SIGINT/SIGTERM (close the socket, drop the pidfile). Resolves only when signalled, so
 * unit tests exercise the pre-flight (unpaired) path, not the blocking loop.
 */
import { mkdirSync } from 'node:fs';
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
import { BridgeSocket, type BridgeSocketState } from '../../transport/index.js';
import { DaemonRuntime } from '../../runtime/index.js';
import { ProfileManager } from '../../browser/index.js';
import { AutomationEnablement } from '../../tools/tier2/index.js';
import { BridgeCapability } from '../../wire/index.js';
import { DAEMON_VERSION } from '../../version.js';
import { DEFAULT_SURFACE_PORT, startLocalSurface } from '../../surface/index.js';
import { GrantTable, NonceCache, EgressAccounting } from '../../session/index.js';
import { EgressLedger } from '../../ledger/index.js';
import { startEgressProxy, type EgressProxy } from '../../egress/proxy.js';
import { pt } from '../../i18n/pt.js';
import { EXIT, flagStr, parseFlags, type CliContext } from '../context.js';
import { isProcessAlive, readDaemonPid, removeDaemonPid, writeDaemonPid } from '../pidfile.js';

/**
 * The capabilities advertised in `hello`.
 *
 * ALWAYS: `local.filesystem` (the daemon's validated core — read/glob/grep/stat/list under the
 * containment resolver), `attended.card_login` (the ceremony implemented in src/attended), and
 * `attended.livestream` (that same ceremony's window streamed live to the dashboard, D-CEREMONY-
 * STREAM). The live stream is a UX capability, not an exfiltration surface like the tier-2 pair
 * below: it shows a human their OWN login window and takes their OWN mouse/keyboard back, gated on a
 * ceremony this machine is already holding, so advertising it whenever the build supports it is safe
 * and needs no operator opt-in. A daemon whose window cannot produce CDP still advertises it and
 * simply never sends a frame — the wire is additive (Rule 7) and Cortex never sends `ceremony.stream`
 * to a stream that will not answer without cost.
 *
 * NEVER by default: `local.bash` and `desktop.automation`. Both are exfiltration-capable tier-2
 * surfaces - a shell can curl, a browser can POST - and this daemon CAN now execute both over the
 * bridge, which makes the default matter more, not less: advertising them is the operator's
 * deliberate switch, made by editing this machine's own config file, and nothing else turns them
 * on. `egress.residential` is advertised only when an endpoint is actually configured, because
 * claiming egress with nowhere to send it would route a tenant's traffic into a black hole.
 *
 * An unknown string in `extraCapabilities` is DROPPED, not passed through: the vocabulary is closed
 * upstream, and one bad entry would fail the whole `hello` frame at Cortex's boundary and leave the
 * machine advertising nothing at all.
 */
export function resolveCapabilities(extra: string[] | undefined, egressEndpoint: string | undefined): BridgeCapability[] {
  const set = new Set<BridgeCapability>(['local.filesystem', 'attended.card_login', 'attended.livestream']);
  for (const raw of extra ?? []) {
    const parsed = BridgeCapability.safeParse(raw);
    if (parsed.success) set.add(parsed.data);
  }
  if (egressEndpoint) set.add('egress.residential');
  else set.delete('egress.residential');
  // OPT-OUT of the live stream (`EKOA_CEREMONY_NO_STREAM=1`). Streaming a HEADED window on the SAME
  // machine as the dashboard is self-defeating on macOS: to screencast an occluded window Chrome force-
  // composites it to the FRONT, so the ceremony window keeps yanking itself over the dashboard/terminal
  // and cannot be escaped. When the operator is AT the bridge machine they do not need the stream - they
  // log in IN the window - so this drops `attended.livestream`, and the dashboard then shows the
  // window-direct flow with no screencast. The stream stays the default because it is exactly right for
  // a SEPARATE bridge machine, where nothing is force-composited over the viewer's desktop.
  if (process.env.EKOA_CEREMONY_NO_STREAM === '1') set.delete('attended.livestream');
  return [...set].sort();
}

/** The tier-2 (automation) capabilities. Advertising either is what turns local execution on. */
const TIER2_CAPABILITIES: readonly BridgeCapability[] = ['local.bash', 'desktop.automation'];

/**
 * How long shutdown waits for the browser teardown. Long enough for a real Chromium to clear its
 * jar and close (seconds, not milliseconds); short enough that a wedged browser cannot hold the
 * daemon hostage. Past it the operator is told a window may still be open, which is a better
 * outcome than a daemon that will not die.
 */
const SHUTDOWN_TEARDOWN_MS = 10_000;

/**
 * Whether this machine's operator opted into running steps locally at all.
 *
 * ADR-002 requires a per-session tier-2 enablement that is OFF by default and turned on by an
 * explicit user action. On this daemon there is no interactive session and no runtime toggle, so
 * the explicit user action IS the config edit that advertises a tier-2 capability - made by the
 * human at the machine, in the machine's own file. The executor still checks the enablement table
 * before every step (`runtime/tool-executor.ts` gate 2), which keeps ONE place to flip when a
 * runtime toggle lands and makes an unenabled session a real, ledgered refusal rather than an
 * unreachable branch. That this derives gate 2 from gate 1 today is recorded, as a limitation
 * rather than a design win, in docs/decisions.md.
 */
export function tier2Advertised(capabilities: readonly BridgeCapability[]): boolean {
  return capabilities.some((c) => TIER2_CAPABILITIES.includes(c));
}

/**
 * The socket's state callback, as `serve` wires it - EXTRACTED SO IT CAN BE DRIVEN BY A TEST.
 *
 * It was an inline lambda, and that made one of its three jobs untestable in the way that matters.
 * The custody backstop below is the only thing that drops a delivered, credential-equivalent
 * session when the channel goes away, and a test that called `runtime.clearSessions()` directly
 * would pin the METHOD while leaving the WIRING free to be deleted - a test that cannot fail for
 * the defect it is named after. As a function it can be handed to a real `BridgeSocket` in a test,
 * so dropping a real socket is what proves the session is dropped with it
 * (`test/cli/serve-socket-custody.test.ts`).
 *
 * `advertise` is a thunk rather than the socket, because `serve` assigns its socket on the same
 * statement that builds this handler; see the call site.
 */
export function socketStateHandler(deps: {
  io: CliContext['io'];
  runtime: { clearSessions(): void };
  advertise: () => void;
}): (state: BridgeSocketState) => void {
  return (state: BridgeSocketState): void => {
    deps.io.out(pt.serveState(state));
    if (state === 'revoked') deps.io.err(`${pt.errPrefix} ${pt.serveRevoked}`);
    // THE SOCKET IS NO LONGER OPEN: drop every delivered browser session (S-inject).
    //
    // Cortex fails every in-flight invocation for a pairing whose socket closed, so no run whose
    // session this daemon holds can still be running - and a daemon can sit in `reconnecting` for
    // a long time. What would otherwise stay resident is credential-equivalent material belonging
    // to nothing, and `SessionHold.sweep` cannot be relied on to collect it: the sweep is passive,
    // running only inside `deliver`/`get`, so an idle reconnecting daemon never reaches it. This
    // callback is the whole backstop.
    //
    // `open` and `idle` are excluded because neither is a loss of the channel: `open` is the
    // channel ARRIVING, and clearing on it would wipe a delivery that raced the callback.
    if (state === 'reconnecting' || state === 'revoked' || state === 'closed') {
      deps.runtime.clearSessions();
    }
    // Advertise on EVERY open, not once at startup: Cortex holds the advertised list on the
    // pairing row and a reconnect after a server restart would otherwise leave the machine
    // listed as capable of nothing, silently un-selecting it for every capability it has.
    if (state === 'open') deps.advertise();
  };
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

  // What this machine advertises it can do (I-1). Advertisement authorises NOTHING on its own -
  // Cortex intersects it with a per-org capability grant (I-3, default deny) - so the honest list is
  // "what is implemented and validated here", with the rest opt-in via config. Resolved BEFORE the
  // runtime because it is also the executor's first gate: the runtime must know what this machine
  // claims in order to refuse anything it does not.
  // RESIDENTIAL EGRESS, SERVED HERE (see `egress/proxy.ts` for why this must be possible at all).
  // An explicit `egressEndpoint` wins - an operator who wrote an address meant it - so the daemon
  // only becomes the endpoint when it was asked to AND nobody named another one. Failure to bind is
  // NOT fatal: the daemon runs on without residential egress, which is exactly the state it was in
  // before this existed. What it must never do is advertise the capability with nowhere to serve it.
  let egressProxy: EgressProxy | undefined;
  let egressEndpoint = cfg.egressEndpoint;
  if (cfg.egressProxy && !egressEndpoint) {
    const wanted = cfg.egressProxy === true ? {} : cfg.egressProxy;
    try {
      egressProxy = await startEgressProxy({
        ...(wanted.port !== undefined ? { port: wanted.port } : {}),
        ...(wanted.host !== undefined ? { host: wanted.host } : {}),
        log: (message) => ctx.io.out(message),
      });
      egressEndpoint = egressProxy.address;
    } catch (error) {
      ctx.io.err(
        `${pt.errPrefix} a saída residencial local não arrancou (${error instanceof Error ? error.message : String(error)}); `
        + 'a ponte continua sem oferecer egresso.',
      );
    }
  }
  const capabilities = resolveCapabilities(cfg.extraCapabilities, egressEndpoint);
  const machineName = cfg.machineName ?? hostname();

  // The local execution plane (P1.2). Persistent headed profiles live under the daemon's OWN home,
  // never the user's real Chrome directory; the tier-2 table is enabled only when the operator
  // advertised a tier-2 capability (see `tier2Advertised`).
  const enablement = new AutomationEnablement();
  const toolSession = `bridge:${cfg.pairingId}`;
  if (tier2Advertised(capabilities)) enablement.enable(toolSession);
  const profiles = new ProfileManager({
    home,
    log: (message) => ctx.io.out(message),
    ...(ctx.now ? { now: ctx.now } : {}),
  });
  // Where a bash step runs when it names no grant. The alternative is the daemon's OWN process cwd
  // - whatever directory the LaunchAgent or systemd unit started it in, which is unbounded, differs
  // per machine, and is nobody's deliberate choice. Created 0700 under the daemon's home.
  const workRoot = join(home, 'work');
  mkdirSync(workRoot, { recursive: true, mode: 0o700 });

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
    // RAW socket send. The runtime wraps this in its own outbound redactor, so every frame it
    // emits - including a `tool.result` carrying child stdout - is filtered on the way out.
    send: (frame) => socket.send(frame),
    getCredential: () => lastToken,
    log: (message) => ctx.io.out(message),
    capabilities,
    enablement,
    profiles,
    toolSession,
    // One persistent profile PER MACHINE by default. A run that names an integration/origin key
    // gets its own jar (so two adversarial targets never share cookies); a run that names none
    // must not mint a new profile each time, which would make every run a cold, obviously-fresh
    // browser - the exact opposite of what a persistent profile is for.
    profileIdFor: ({ owner }) => owner ?? cfg.pairingId,
    defaultWorkRoot: workRoot,
    // The attended ceremony opens its persistent per-origin profiles under `<home>/ceremony-profiles`.
    home,
  });

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
    onStateChange: socketStateHandler({
      io: ctx.io,
      runtime,
      // A THUNK, because `socket` is assigned by the very statement this object is an argument to.
      // The handler only ever runs after construction, so the binding is there by then; passing the
      // socket itself would capture `undefined`.
      advertise: () => {
        socket.send(
          DaemonRuntime.helloFrame({
            machineName,
            capabilities,
            daemonVersion: DAEMON_VERSION,
            ...(egressEndpoint ? { egressEndpoint } : {}),
          }),
        );
        ctx.io.out(pt.serveAdvertised(capabilities));
      },
    }),
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

  const stopped = installShutdown({
    io: ctx.io,
    socket,
    runtime,
    profiles,
    surface: () => surface,
    // The proxy is a listener like the surface, and stops the same way. Closing it first means a
    // daemon that is going away stops accepting egress before it stops answering Cortex.
    onExit: () => {
      void egressProxy?.close();
      removeDaemonPid(home);
    },
  });
  void socket.connect();
  return await stopped;
}

/**
 * WHAT A SIGNAL DOES, as one testable function.
 *
 * This is a whole function rather than a closure inside `serve` because its ORDER is a security
 * property and the security property was previously untestable: `serve` needs a config file, a
 * pairing, a live socket and a real SIGINT before any of this runs, so nothing could assert it and
 * a regression in it was invisible. The signal registration is injected for the same reason - a
 * test that raised a real SIGINT would be asking the test runner to shut itself down.
 *
 * THE ORDER IS THE POINT:
 *  1. Credential material, SYNCHRONOUSLY. A shutdown that closes browsers before it overwrites held
 *     secrets is a shutdown that can be interrupted with the secrets still resident.
 *  2. The socket and the local surface, so nothing new arrives while the rest happens.
 *  3. The browsers, AWAITED (see `teardownBrowsers`) - the wipe that clears an injected session out
 *     of a jar whose cookies are a file on disk. `serveStopped` is printed and the process is
 *     allowed to exit only AFTER that resolves or times out. `void profiles.closeAll()` here was
 *     the bug: it let the process exit with the wipe still in flight.
 *  4. THE PIDFILE LAST, and this is a change. The pidfile is the CROSS-PROCESS lock on the profile
 *     directory - `browser/profile.ts` rests its "an in-process mutex is sufficient" argument on it
 *     - so dropping it before the browsers have closed opens a window in which a second `serve` on
 *     the same home may start and launch Chromium against a `userDataDir` the dying daemon has not
 *     released: exactly the SingletonLock collision the lock exists to prevent. It is held until
 *     the profiles are actually free (or the teardown deadline has passed, after which holding it
 *     would just prevent a restart).
 */
export function installShutdown(deps: {
  io: CliContext['io'];
  socket: { close(): void };
  runtime: { zeroizeSecrets(): void };
  profiles: { closeAll(): Promise<void> };
  surface: () => { close(): Promise<void> } | undefined;
  onExit: () => void;
  teardownMs?: number;
  /** Injected so a test can fire the handler without raising a real signal at the test runner. */
  onSignal?: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void;
}): Promise<number> {
  return new Promise<number>((resolve) => {
    let done = false;
    const shutdown = (): void => {
      if (done) return;
      done = true;
      deps.io.out(pt.serveStopping);
      deps.socket.close();
      deps.runtime.zeroizeSecrets();
      void deps.surface()?.close();
      void teardownBrowsers(
        deps.profiles,
        () => deps.io.err(`${pt.errPrefix} ${pt.serveTeardownTimedOut}`),
        deps.teardownMs ?? SHUTDOWN_TEARDOWN_MS,
      ).then(() => {
        deps.onExit();
        deps.io.out(pt.serveStopped);
        resolve(EXIT.OK);
      });
    };
    const on = deps.onSignal ?? ((signal, handler): void => void process.once(signal, handler));
    on('SIGINT', shutdown);
    on('SIGTERM', shutdown);
  });
}

/**
 * Close the browsers, AWAITED and BOUNDED, and never throw.
 *
 * WHY AWAITED. `ProfileManager.closeAll` releases live RUN leases before it closes their contexts,
 * and that release is what clears the injected Cofre session out of the jar. The profile is
 * PERSISTENT - its cookies are a file on disk - so a shutdown that resolves before the wipe
 * finishes can let the process exit with a live session still written under the profile directory,
 * where the NEXT run inherits it. This used to be `void profiles.closeAll()`, which was harmless
 * only while every lease was released at the end of its own invoke; with run-scoped leases a run in
 * flight at SIGINT is exactly the case that has something to wipe.
 *
 * WHY BOUNDED. A wedged browser must not hold the daemon hostage. Past the deadline shutdown
 * continues and the operator is TOLD a window may still be open, which is a better outcome than a
 * daemon that will not die - and better than a silent `void`, which is what this replaces.
 *
 * Extracted as a named function, rather than inlined in the signal handler, so it can be tested
 * without raising a real SIGINT.
 */
export async function teardownBrowsers(
  profiles: { closeAll(): Promise<void> },
  onTimeout: () => void,
  deadlineMs: number = SHUTDOWN_TEARDOWN_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deadlineMs);
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([
      profiles.closeAll().then(() => 'closed' as const).catch(() => 'closed' as const),
      deadline,
    ]);
    if (outcome === 'timeout') onTimeout();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
