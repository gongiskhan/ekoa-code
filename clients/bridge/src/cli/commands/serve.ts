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
import { BridgeSocket } from '../../transport/index.js';
import { DaemonRuntime } from '../../runtime/index.js';
import { ProfileManager } from '../../browser/index.js';
import { AutomationEnablement } from '../../tools/tier2/index.js';
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
  const set = new Set<BridgeCapability>(['local.filesystem', 'attended.card_login']);
  for (const raw of extra ?? []) {
    const parsed = BridgeCapability.safeParse(raw);
    if (parsed.success) set.add(parsed.data);
  }
  if (egressEndpoint) set.add('egress.residential');
  else set.delete('egress.residential');
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
  const capabilities = resolveCapabilities(cfg.extraCapabilities, cfg.egressEndpoint);
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
      // Credential material first, and SYNCHRONOUSLY: a shutdown that closes browsers before it
      // overwrites held secrets is a shutdown that can be interrupted with the secrets still
      // resident. Then the headed windows, which would otherwise outlive the daemon that owns them.
      runtime.zeroizeSecrets();
      void surface?.close();
      removeDaemonPid(home);
      // AWAITED, not fire-and-forget - see `teardownBrowsers`.
      void teardownBrowsers(profiles, () => ctx.io.err(`${pt.errPrefix} ${pt.serveTeardownTimedOut}`)).then(() => {
        ctx.io.out(pt.serveStopped);
        resolve(EXIT.OK);
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    void socket.connect();
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
