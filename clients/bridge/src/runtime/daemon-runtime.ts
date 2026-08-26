/**
 * runtime/daemon-runtime.ts — the executor runtime that ties the wire transport to S2 verification
 * and the delegation engine. This is the REAL frame handler behind `serve`: on a `delegate` frame it
 * runs the §18.5.1 ordered binding verification (a denial → a `denial` frame, ledgered), then the
 * structured TaskProgram executor; it streams the reads' egress-ledger rows up as `ledger_row` frames
 * (S6 display metadata), sends `provider_request` frames when the program's single compose step needs
 * a completion (resolving on the matching `provider_response`), and returns a derived-output-only
 * `delegation_result`. A `cancel` frame aborts the running task.
 *
 * No local reasoning loop lives here (ADR-001): the runtime dispatches frames and runs a bounded
 * program; the only model call is the engine's single provider round trip, brokered back to Cortex.
 */
import { join } from 'node:path';
import type { BridgeCapability, BridgeFrame, CeremonyInputEvent, DelegatedTask, EgressLedgerRow } from '../wire/index.js';
import { verifyDelegatedTask, type VerifyContext } from '../verify/index.js';
import { runDelegatedTask, type EngineDeps } from '../engine/index.js';
import type { GrantTable, NonceCache, EgressAccounting } from '../session/index.js';
import type { EgressLedger, ReadLedgerRow } from '../ledger/index.js';
import { runAttendedCeremony, type CeremonyDeps, type CeremonyRequest, type CeremonyStreamController } from '../attended/index.js';
import type { ProfileManager } from '../browser/index.js';
import type { AutomationEnablement } from '../tools/tier2/index.js';
import { executeToolInvocation, type ToolExecutorDeps } from './tool-executor.js';
import { OutboundRedactor } from './outbound-redactor.js';
import { SecretHold } from './secret-hold.js';
import { SessionHold } from './session-hold.js';

/** The half of the daemon's identity that Cortex OWNS and can rotate: the org the pairing is scoped
 *  to, and the HMAC secret it signs task bindings with. Both arrive on the pre-dial token mint. */
export interface TaskBinding {
  org: string;
  signingSecret: string;
}

export interface DaemonRuntimeDeps {
  /** This daemon's identity — the verify layer refuses a task for another pairing/org. */
  pairingId: string;
  /** The INITIAL org; rebindable via `setBinding` (see it for why this is not fixed at construction). */
  org: string;
  /** The INITIAL shared HMAC secret Cortex signed the task binding with (§18.5.1 step 1). */
  signingSecret: string;
  grants: GrantTable;
  nonces: NonceCache;
  egress: EgressAccounting;
  ledger: EgressLedger;
  /** Send a frame up the bridge (BridgeSocket.send). */
  send: (frame: BridgeFrame) => boolean;
  /** The current bridge token to authenticate a provider_request (pairing-bound credential, §18.4.4). */
  getCredential: () => string;
  /** User-visible progress in Portuguese. An attended ceremony happens in front of a human, so it
   *  needs a channel to speak on; defaults to a no-op for the non-interactive paths and tests. */
  log?: (message: string) => void;
  /** Injected for tests so the ceremony can be driven without Playwright. */
  launchBrowser?: CeremonyDeps['launchBrowser'];
  now?: () => number;

  // ---- the EXECUTION plane (P1.2). All optional: a daemon wired without them keeps the old
  // behaviour of refusing `tool.invoke`, which is the honest answer for a build that has no
  // executor rather than a half-running stub.
  /** What this machine advertised - gate 1 of the executor. */
  capabilities?: readonly BridgeCapability[];
  /** ADR-002 per-session tier-2 enablement - gate 2. */
  enablement?: AutomationEnablement;
  /** Persistent headed profiles for browser steps. */
  profiles?: ProfileManager;
  /** The enablement/ledger session bridge-invoked steps run under (one per pairing). */
  toolSession?: string;
  /** Cofre session state for a run, when Cortex supplied one. */
  sessionStateFor?: ToolExecutorDeps['sessionStateFor'];
  /** Which persistent profile a step targets. Default: the pairing (one stable jar per machine). */
  profileIdFor?: ToolExecutorDeps['profileIdFor'];
  /** Where a bash step runs when its own step names no grant. See `ToolExecutorDeps`. */
  defaultWorkRoot?: string;
  /** `EKOA_BRIDGE_HOME`. The attended ceremony opens its persistent per-origin profiles under
   *  `<home>/ceremony-profiles`; passed explicitly so a custom home flag cannot diverge from what
   *  the ceremony resolves on its own. */
  home?: string;
}

export class DaemonRuntime {
  /** provider_request correlationId → resolver for the awaited provider_response body. */
  private readonly pendingProviders = new Map<string, (body: unknown) => void>();
  /** taskId → abort controller, so a `cancel` frame stops a running program. */
  private readonly running = new Map<string, AbortController>();
  /**
   * The ceremony this machine is currently holding, or null.
   *
   * ONE AT A TIME: they are HEADED browser windows a human must sit at, so two at once would race
   * for the same pair of eyes and the second would be answered by nobody.
   *
   * It carries the requestId and the ceremony's "done, capture now" resolver rather than a bare
   * boolean, because the dashboard's Done button (D-CEREMONY-DONE) arrives here as a
   * `ceremony.capture` frame and has to reach THAT ceremony's loop. The requestId is what makes it
   * that ceremony's: a capture naming a different one is a no-op, so a stale or misrouted frame can
   * never end a window this daemon is holding for a different errand.
   *
   * `stream` is the live-stream controller (D-CEREMONY-STREAM), set once the ceremony's window is
   * open and null until then (or forever, if the window cannot produce a CDP session). The same
   * requestId guard routes `ceremony.stream` / `ceremony.input` to it, so a frame for any other
   * requestId can never start a stream of, or dispatch input into, the window this daemon is holding.
   */
  private ceremonyInFlight: { requestId: string; finishNow: () => void; stream: CeremonyStreamController | null } | null =
    null;
  /**
   * The rebindable half of this daemon's identity (org + signing secret).
   *
   * It is MUTABLE and read per task rather than captured at construction because Cortex owns both
   * values and delivers them on every token mint, which happens once per dial. A re-pair or an
   * admin secret reset therefore arrives on the next reconnect of a process that may have been up
   * for weeks; with these fixed at construction, that daemon would deny every task until somebody
   * noticed and restarted it.
   */
  private binding: TaskBinding;

  /**
   * THE EGRESS FILTER, and the single point every outbound frame passes through.
   *
   * `this.send` is the ONLY sender this class uses - `deps.send` is never called directly after
   * the constructor. That is deliberate and load-bearing: the moment `tool.invoke` executes,
   * unredacted child stdout/stderr and page text start crossing back, and a filter applied at the
   * call sites is only as good as the next person's memory of it. Wrapping once means a frame
   * added later is filtered by construction rather than by review.
   */
  private readonly redactor = new OutboundRedactor();
  private readonly send: (frame: BridgeFrame) => boolean;

  /** RAM-only credential custody for `secret.deliver` (I9). Registers with the redactor on
   *  delivery and clears it on zeroize, so the filter's lifetime is the value's lifetime. */
  private readonly secrets: SecretHold;

  /**
   * RAM-only custody for `session.deliver` (S-inject) - the run-keyed twin of `secrets`.
   *
   * OWNED BY THE RUNTIME rather than by `serve.ts`, and one reason decides it: the delivery frame
   * lands HERE, and taking custody of a session means arming `this.redactor` with its cookies in
   * the same breath. A map living in the CLI would have to be fed from this method anyway, and
   * would leave the arming either forgotten or performed at a second site - which is exactly the
   * class of failure `wrapSend` exists to make impossible on the outbound side.
   */
  private readonly sessions = new SessionHold({
    // Arm the filter BEFORE the run those cookies authenticate can echo one back. Same ordering
    // argument as `SecretHold`'s `onRegister`, and the same reason: registering afterwards leaves
    // a window in which a fast first step's observation crosses back unfiltered.
    onRegister: (values) => this.redactor.register(values),
  });

  constructor(private readonly deps: DaemonRuntimeDeps) {
    this.binding = { org: deps.org, signingSecret: deps.signingSecret };
    this.send = this.redactor.wrapSend((frame) => this.deps.send(frame));
    this.secrets = new SecretHold({
      ...(deps.now ? { now: deps.now } : {}),
      // Arm the filter BEFORE the value can be echoed. Registering after the child runs would
      // leave a window in which a fast step's output crosses back unfiltered.
      onRegister: (values) => this.redactor.register(values),
      // NO onRelease. The filter deliberately OUTLIVES the hold, for the lifetime of the process.
      //
      // Tying its lifetime to the hold's is the obvious design and it is WRONG, provably: the hold
      // is zeroized in `withChildEnv`'s `finally`, which runs BEFORE the `tool.result` carrying
      // that child's stdout is built and sent - so the frame the value is most likely to appear in
      // is precisely the one that would go out with the filter already disarmed. (Found by
      // `test/security/outbound-redaction.test.ts`, which failed on exactly that window.)
      //
      // Cortex's ingress mirror makes the same choice for the same reason: `byPairing` is released
      // when the SOCKET drops, not when a delivery is consumed. The cost is bounded - one entry per
      // distinct value a daemon is ever handed - and `zeroizeSecrets()` clears it at shutdown.
    });
  }

  /** The outbound filter, for tests and for a caller that needs to arm it from elsewhere. */
  outboundRedactor(): OutboundRedactor {
    return this.redactor;
  }

  /** How many deliveries are currently held in RAM. Tests assert this returns to zero; the
   *  redactor's size deliberately does NOT (see the constructor). */
  heldSecretCount(): number {
    return this.secrets.size;
  }

  /** How many delivered sessions are currently held in RAM (S-inject). Tests assert this returns to
   *  zero after a release, a socket drop and a shutdown. */
  heldSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Drop every delivered session - THE SOCKET WENT AWAY (S-inject).
   *
   * Not over-caution: Cortex fails every in-flight invocation for a pairing whose socket closed
   * (`bridge/tool-invocation.ts` `failInvocationsForPairing`), so no run whose session is held here
   * can still be running. What is left is an authenticated session belonging to nothing, and the
   * daemon may sit in `reconnecting` for a long time before anyone asks it for anything again.
   *
   * The REDACTOR is deliberately NOT cleared here, for the reason the constructor gives about
   * `SecretHold`: the filter outlives the value on purpose, because the frames most likely to carry
   * an echo are built after the thing that produced them is gone. `zeroizeSecrets` clears it at
   * shutdown, and that is the only place it should be cleared.
   */
  clearSessions(): void {
    this.sessions.clear();
  }

  /** Zeroize every held credential (daemon shutdown), delivered sessions included. */
  zeroizeSecrets(): void {
    this.secrets.zeroizeAll();
    this.sessions.clear();
    this.redactor.clear();
  }

  /**
   * Adopt a binding learned from a token mint. Only the halves actually supplied are replaced: a
   * mint that omits one is Cortex declining to say, not Cortex saying "none", and blanking a live
   * binding on an omission would fail the daemon closed for no reason. Returns true when something
   * actually changed, so the caller can persist only on a real rotation.
   */
  setBinding(next: Partial<TaskBinding>): boolean {
    const merged: TaskBinding = {
      org: next.org ?? this.binding.org,
      signingSecret: next.signingSecret ?? this.binding.signingSecret,
    };
    if (merged.org === this.binding.org && merged.signingSecret === this.binding.signingSecret) return false;
    this.binding = merged;
    return true;
  }

  /** The binding currently in force (tests and the surface read it; never logged). */
  currentBinding(): TaskBinding {
    return { ...this.binding };
  }

  /** Route one inbound bridge frame. Presence frames are handled by the transport, not here. */
  onFrame(frame: BridgeFrame): void {
    switch (frame.type) {
      case 'delegate':
        void this.handleDelegate(frame.task);
        break;
      case 'provider_response': {
        const resolve = this.pendingProviders.get(frame.correlationId);
        if (resolve) {
          this.pendingProviders.delete(frame.correlationId);
          resolve(frame.body);
        }
        break;
      }
      case 'cancel':
        this.running.get(frame.taskId)?.abort();
        break;
      case 'attended.request':
        void this.handleAttended(frame);
        break;
      case 'ceremony.capture':
        // The dashboard's "done - capture now" (D-CEREMONY-DONE). Synchronous and tiny on purpose:
        // it resolves the running ceremony's own signal and returns. Everything that follows -
        // snapshot, push, close the window - is the ceremony's, unchanged, so this is a new TRIGGER
        // for the existing capture rather than a second path a session can travel.
        this.handleCeremonyCapture(frame.requestId);
        break;
      case 'ceremony.stream':
        // A dashboard viewer connected (`on:true`) or dropped (`on:false`) for the live ceremony
        // stream (D-CEREMONY-STREAM). Routed to the in-flight ceremony's controller by requestId
        // only; a frame for any other requestId is a no-op, so it can never start a stream of a
        // window this daemon is holding for a different errand.
        this.handleCeremonyStream(frame.requestId, frame.on);
        break;
      case 'ceremony.input':
        // ONE input event the human produced in the dashboard, dispatched into the live ceremony
        // window (D-CEREMONY-STREAM). Keyed by requestId so it can only reach the caller's own
        // ceremony; the event is credential-bearing (a keystroke may be a password character) and is
        // NEVER logged here or in the producer it reaches.
        this.handleCeremonyInput(frame.requestId, frame.event);
        break;
      case 'tool.invoke':
        // J-1's frame pair, now EXECUTED (P1.2). The refusal this replaces was deliberate rather
        // than a stub - running a step on someone's machine on remote instruction needed the
        // tier-2 gate, the I9 secret lifecycle and an evidence channel behind it first, and all
        // three now exist. A daemon built WITHOUT an executor (no capabilities/enablement/profiles
        // wired) still refuses by name below, because a silent drop makes Cortex wait out its full
        // invocation timeout and then report "the machine did not answer in time".
        void this.handleToolInvoke(frame);
        break;
      case 'secret.deliver':
        // The one frame in the union carrying credential material. Taken into RAM-ONLY custody
        // keyed by invocationId, values held as Buffers so they can actually be overwritten, and
        // armed into the outbound filter on the way in. NEVER written to config.json, never to the
        // ledger, never logged - not even the env-var NAMES, which are themselves a map of what
        // this tenant holds. The matching `tool.invoke` consumes it and zeroizes it in a `finally`;
        // a delivery whose invoke never arrives is swept and zeroized on TTL.
        this.secrets.deliver(frame.invocationId, frame.nonce, frame.env);
        break;
      case 'session.deliver':
        // The OTHER frame in the union carrying credential material (S-inject). Taken into RAM-only
        // custody keyed by runId, armed into the outbound filter on the way in, and dropped when
        // the run's lease is released or the socket goes away. NEVER written to bridge disk, never
        // ledgered, never logged - not even the fact of it, because "a session arrived for run X"
        // plus a run listing is a statement about which portals this tenant holds sessions for.
        //
        // NOT ACKNOWLEDGED, deliberately. There is no result frame for a delivery and there should
        // not be one: the observable consequence is that the run's first page is authenticated, and
        // an ack would be a second channel saying so that could disagree with the page.
        this.sessions.deliver(frame.runId, frame.storageState);
        break;
      default:
        // provider_request/ledger_row/delegation_result/denial/ping/pong are not inbound work, and
        // `ceremony.frame` is the daemon's OWN outbound stream frame (D-CEREMONY-STREAM) — the daemon
        // produces it, never receives it, so it lands here and is ignored.
        break;
    }
  }

  /** Build this machine's `hello` — the advertisement Cortex intersects with the org's grants. */
  static helloFrame(input: {
    machineName: string;
    capabilities: BridgeCapability[];
    daemonVersion: string;
    egressEndpoint?: string;
  }): BridgeFrame {
    return {
      type: 'hello',
      machineName: input.machineName.slice(0, 120),
      capabilities: input.capabilities,
      daemonVersion: input.daemonVersion.slice(0, 40),
      ...(input.egressEndpoint ? { egressEndpoint: input.egressEndpoint.slice(0, 255) } : {}),
    };
  }

  /**
   * Run one step and answer with its result. NEVER throws to the frame loop and never stays
   * silent: an unhandled rejection here would leave Cortex waiting out a two-minute invocation
   * timeout for a step that already failed, which reports the wrong cause to the user.
   */
  private async handleToolInvoke(frame: { invocationId: string; capability: BridgeCapability; input?: unknown }): Promise<void> {
    const executor = this.executorDeps();
    if (!executor) {
      // No executor wired. Zeroize any delivery that arrived for this invocation rather than
      // leaving credential material resident for a step that will never run.
      this.secrets.zeroize(frame.invocationId);
      this.send({
        type: 'tool.result',
        invocationId: frame.invocationId,
        ok: false,
        error: `esta ponte não executa a capacidade ${frame.capability} (execução local não configurada)`,
      });
      return;
    }

    let result;
    try {
      result = await executeToolInvocation(frame, executor);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      // Belt to the executor's braces: `withChildEnv` zeroizes on its own `finally`, but a step
      // that never reached it (a refusal at either gate, a malformed envelope) must not leave the
      // delivery resident either.
      this.secrets.zeroize(frame.invocationId);
    }

    this.send({
      type: 'tool.result',
      invocationId: frame.invocationId,
      ok: result.ok,
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.screenshotB64 !== undefined ? { screenshotB64: result.screenshotB64 } : {}),
    });
  }

  /** The executor's dependencies, or undefined when this daemon was built without an execution
   *  plane. All four must be present: a partial wiring is a configuration error, not a degraded
   *  mode, and running with (say) no enablement table would silently drop gate 2. */
  private executorDeps(): ToolExecutorDeps | undefined {
    const { capabilities, enablement, profiles } = this.deps;
    if (!capabilities || !enablement || !profiles) return undefined;
    return {
      capabilities,
      enablement,
      profiles,
      session: this.deps.toolSession ?? this.deps.pairingId,
      ledger: this.deps.ledger,
      grants: this.deps.grants,
      secrets: this.secrets,
      ...(this.deps.defaultWorkRoot !== undefined ? { defaultWorkRoot: this.deps.defaultWorkRoot } : {}),
      ...(this.deps.profileIdFor ? { profileIdFor: this.deps.profileIdFor } : {}),
      // S-inject. ALWAYS supplied, and the delivered session WINS over any injected dep: the hold
      // is the production source (fed by `session.deliver` above) and `deps.sessionStateFor` is the
      // test seam that predates it. A run with no delivery resolves to `undefined` here, which
      // `parseSessionState` answers `null` to - i.e. exactly the behaviour before this existed.
      sessionStateFor: (runId: string) => this.sessions.get(runId) ?? this.deps.sessionStateFor?.(runId),
      // The lease release is the moment the injected session leaves the profile's jar
      // (`profile.ts` `releaseRun` wipes it), so it is the moment this daemon's copy must go too.
      // Holding it past the release would be an authenticated session resident in RAM for a run
      // that has ended, recoverable by nothing and useful to nobody.
      releaseSessionFor: (runId: string) => this.sessions.release(runId),
      // Bound as a method reference on THIS runtime's redactor, not a snapshot of its state: a
      // credential delivered after capture was armed must be masked by the very next body.
      redactOutbound: (text: string) => this.redactor.redactText(text),
      ...(this.deps.now ? { now: this.deps.now } : {}),
      ...(this.deps.log ? { log: this.deps.log } : {}),
    };
  }

  private async handleAttended(frame: CeremonyRequest): Promise<void> {
    const log = this.deps.log ?? ((): void => undefined);
    if (this.ceremonyInFlight) {
      log('Já está uma autenticação a decorrer nesta máquina; conclua-a primeiro.');
      return;
    }
    // The ceremony's second completion signal, armed BEFORE the ceremony can start, so a Done
    // pressed the instant the window appears cannot arrive at a handle that does not exist yet.
    let finishNow!: () => void;
    const finishSignal = new Promise<void>((resolve) => {
      finishNow = resolve;
    });
    const requestId = frame.requestId;
    this.ceremonyInFlight = { requestId, finishNow, stream: null };
    try {
      await runAttendedCeremony(
        { requestId, kind: frame.kind, origin: frame.origin, reason: frame.reason },
        {
          send: (f) => this.send(f),
          log,
          finishSignal,
          // The ceremony hands back a live-stream controller once its window is open (or null when
          // the window cannot stream). Store it on THIS ceremony's handle so `ceremony.stream` /
          // `ceremony.input` reach it; guard on requestId so a controller from a superseded ceremony
          // can never overwrite the current one's.
          onStreamReady: (controller) => {
            if (this.ceremonyInFlight?.requestId === requestId) this.ceremonyInFlight.stream = controller;
          },
          ...(this.deps.launchBrowser ? { launchBrowser: this.deps.launchBrowser } : {}),
          ...(this.deps.home ? { profilesRoot: join(this.deps.home, 'ceremony-profiles') } : {}),
          ...(this.deps.now ? { now: this.deps.now } : {}),
        },
      );
    } finally {
      // The ceremony's own `finally` has already torn the stream down; clearing the handle here just
      // frees the machine for the next ceremony.
      this.ceremonyInFlight = null;
    }
  }

  /**
   * A dashboard viewer connected to or dropped from the live ceremony stream (D-CEREMONY-STREAM).
   *
   * A NO-OP unless the frame names the ceremony this daemon is actually holding AND that ceremony has
   * a stream controller (its window opened and could produce CDP). The requestId guard is the same
   * one `ceremony.capture` uses and for the same reason: a frame for another requestId must never
   * start a stream of the window this daemon holds for a different errand.
   */
  private handleCeremonyStream(requestId: string, on: boolean): void {
    const ceremony = this.ceremonyInFlight;
    if (!ceremony || ceremony.requestId !== requestId || !ceremony.stream) return;
    if (on) void ceremony.stream.start();
    else void ceremony.stream.stop();
  }

  /**
   * Dispatch ONE input event into the live ceremony window (D-CEREMONY-STREAM).
   *
   * A NO-OP unless the frame names the in-flight ceremony and it is streaming — input into the wrong
   * window is exactly what the requestId guard exists to prevent. The event is credential-bearing and
   * is passed straight to the producer, which NEVER logs it; nothing about it is logged here either.
   */
  private handleCeremonyInput(requestId: string, event: CeremonyInputEvent): void {
    const ceremony = this.ceremonyInFlight;
    if (!ceremony || ceremony.requestId !== requestId || !ceremony.stream) return;
    ceremony.stream.dispatchInput(event);
  }

  /**
   * "The human pressed Done in the dashboard" - end the ceremony this machine is holding and let it
   * capture, without the human having to close a window that keeps stealing their focus.
   *
   * BOTH REFUSALS ARE NO-OPS, and both are STATED rather than swallowed. There is no reply frame on
   * the ceremony rail (`attended/ceremony.ts`: a ceremony that fails simply never pushes), so this
   * machine's own output is the only channel this side has.
   *
   * NEITHER LINE PRESCRIBES A RECOVERY, and that is a correction rather than an omission (review
   * round 2026-08-25, F2/F3). Cortex relays the capture for EVERY ceremony it holds open for that
   * caller, origin and machine, precisely because it cannot know which one this daemon is holding -
   * so a requestId mismatch is the ORDINARY case for a person who opened a window twice, and a
   * sibling frame in the same fan-out is very likely finishing the ceremony that is really up. A line
   * here telling them to close the window would be advice against an outcome that already happened.
   * The dashboard card - where the human is actually looking - reports what did or did not arrive,
   * and names closing the window only when nothing did.
   */
  private handleCeremonyCapture(requestId: string): void {
    const log = this.deps.log ?? ((): void => undefined);
    const ceremony = this.ceremonyInFlight;
    if (!ceremony) {
      log('Pedido de captura recebido, mas não há nenhuma autenticação a decorrer nesta máquina.');
      return;
    }
    if (ceremony.requestId !== requestId) {
      log('Pedido de captura para outra autenticação; ignorado.');
      return;
    }
    ceremony.finishNow();
  }

  private async handleDelegate(task: DelegatedTask): Promise<void> {
    const now = this.deps.now ?? Date.now;

    // §18.5.1 ordered verification. A denial is a `denial` frame (never a result), and every denial
    // is ledgered by the verify layer's sink.
    const verifyCtx: VerifyContext = {
      pairingId: this.deps.pairingId,
      org: this.binding.org,
      signingSecret: this.binding.signingSecret,
      nonces: this.deps.nonces,
      grants: this.deps.grants,
      now,
    };
    const denial = verifyDelegatedTask(task, verifyCtx, (d) => {
      this.deps.ledger.append({
        kind: 'denial',
        ts: new Date(now()).toISOString(),
        // Attribute the denial to the task's claimed session (a local audit record: "a task claiming
        // session X was refused"). The task shape is already zod-validated at the frame boundary, so
        // `task.session` is a string; a denial thus lands in the same session ledger as its reads.
        session: task.session,
        ...(d.taskId !== undefined ? { taskId: d.taskId } : {}),
        reason: d.reason,
        principle: d.principle,
        tool: 'verify',
      });
    });
    if (denial) {
      this.send({ type: 'denial', taskId: task.taskId, reason: denial.reason, principle: denial.principle });
      return;
    }

    // Snapshot the ledger so we can stream up only THIS delegation's read rows afterwards.
    const before = this.deps.ledger.readAll(task.session).rows.length;

    const controller = new AbortController();
    this.running.set(task.taskId, controller);
    const engineDeps: EngineDeps = {
      grantTable: this.deps.grants,
      egress: this.deps.egress,
      ledger: this.deps.ledger,
      providerComplete: (body, correlationId) => this.providerComplete(task.session, body, correlationId),
      signal: controller.signal,
      ...(this.deps.now ? { now: this.deps.now } : {}),
    };

    let result;
    try {
      result = await runDelegatedTask(task, engineDeps);
    } finally {
      this.running.delete(task.taskId);
    }

    // Stream the reads' egress rows up as ledger_row frames (S6 display metadata) — stripped to the
    // wire EgressLedgerRow shape (no daemon-only kind/taskId envelope).
    const rows = this.deps.ledger.readAll(task.session).rows.slice(before);
    for (const row of rows) {
      if (row.kind === 'read' && row.taskId === task.taskId) {
        this.send({ type: 'ledger_row', taskId: task.taskId, row: toWireRow(row) });
      }
    }

    this.send({ type: 'delegation_result', taskId: task.taskId, result });
  }

  /** Send a provider_request and await the provider_response body (the engine's single compose step). */
  private providerComplete(session: string, body: unknown, correlationId: string): Promise<unknown> {
    return new Promise<unknown>((resolve) => {
      this.pendingProviders.set(correlationId, resolve);
      this.send({
        type: 'provider_request',
        correlationId,
        session,
        credential: this.deps.getCredential(),
        body,
      });
    });
  }
}

/** Project a daemon ReadLedgerRow onto the wire EgressLedgerRow (drop the `kind`/`taskId` envelope). */
function toWireRow(row: ReadLedgerRow): EgressLedgerRow {
  return {
    ts: row.ts,
    session: row.session,
    correlationId: row.correlationId,
    path: row.path,
    byteRange: row.byteRange,
    bytesOut: row.bytesOut,
    sha256: row.sha256,
    tool: row.tool,
  };
}
