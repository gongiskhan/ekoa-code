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
import type { BridgeCapability, BridgeFrame, DelegatedTask, EgressLedgerRow } from '../wire/index.js';
import { verifyDelegatedTask, type VerifyContext } from '../verify/index.js';
import { runDelegatedTask, type EngineDeps } from '../engine/index.js';
import type { GrantTable, NonceCache, EgressAccounting } from '../session/index.js';
import type { EgressLedger, ReadLedgerRow } from '../ledger/index.js';
import { runAttendedCeremony, type CeremonyDeps } from '../attended/index.js';

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
}

export class DaemonRuntime {
  /** provider_request correlationId → resolver for the awaited provider_response body. */
  private readonly pendingProviders = new Map<string, (body: unknown) => void>();
  /** taskId → abort controller, so a `cancel` frame stops a running program. */
  private readonly running = new Map<string, AbortController>();
  /** One ceremony at a time: they are HEADED browser windows a human must sit at, so two at once
   *  would race for the same pair of eyes and the second would be answered by nobody. */
  private ceremonyInFlight = false;
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

  constructor(private readonly deps: DaemonRuntimeDeps) {
    this.binding = { org: deps.org, signingSecret: deps.signingSecret };
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
      case 'tool.invoke':
        // J-1's frame pair. The EXECUTION side of this (running a bash/browser step on the machine
        // on Cortex's behalf) is not implemented here, and this refusal is deliberate rather than a
        // stub: it is an exfiltration-capable surface that would need the tier-2 enablement gate,
        // the I9 secret-delivery lifecycle and evidence validation behind it before it could
        // honestly be turned on. What this DOES fix is the silent version — before the v2 frames
        // were vendored, an invocation failed the union, was dropped by the transport, and Cortex
        // waited out its full invocation timeout to report "the machine did not answer in time".
        // An immediate, named refusal is the honest failure; a stub that half-ran steps would not be.
        this.deps.send({
          type: 'tool.result',
          invocationId: frame.invocationId,
          ok: false,
          error: `esta ponte não executa a capacidade ${frame.capability} (não implementado nesta versão)`,
        });
        break;
      case 'secret.deliver':
        // Credential material, and the only frame in the union that carries any. Its paired
        // `tool.invoke` is refused above, so there is nothing to inject it into: drop it without
        // storing it, without echoing it, and WITHOUT LOGGING IT — not even its env-var names, which
        // are themselves a map of what this tenant holds.
        break;
      default:
        break; // provider_request/ledger_row/delegation_result/denial/ping/pong are not inbound work
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

  private async handleAttended(frame: { requestId: string; kind: 'card_login' | 'relay_code'; origin: string; reason: string }): Promise<void> {
    const log = this.deps.log ?? ((): void => undefined);
    if (this.ceremonyInFlight) {
      log('Já está uma autenticação a decorrer nesta máquina; conclua-a primeiro.');
      return;
    }
    this.ceremonyInFlight = true;
    try {
      await runAttendedCeremony(
        { requestId: frame.requestId, kind: frame.kind, origin: frame.origin, reason: frame.reason },
        {
          send: (f) => this.deps.send(f),
          log,
          ...(this.deps.launchBrowser ? { launchBrowser: this.deps.launchBrowser } : {}),
          ...(this.deps.now ? { now: this.deps.now } : {}),
        },
      );
    } finally {
      this.ceremonyInFlight = false;
    }
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
      this.deps.send({ type: 'denial', taskId: task.taskId, reason: denial.reason, principle: denial.principle });
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
        this.deps.send({ type: 'ledger_row', taskId: task.taskId, row: toWireRow(row) });
      }
    }

    this.deps.send({ type: 'delegation_result', taskId: task.taskId, result });
  }

  /** Send a provider_request and await the provider_response body (the engine's single compose step). */
  private providerComplete(session: string, body: unknown, correlationId: string): Promise<unknown> {
    return new Promise<unknown>((resolve) => {
      this.pendingProviders.set(correlationId, resolve);
      this.deps.send({
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
