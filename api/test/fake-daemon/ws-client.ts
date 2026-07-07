/**
 * Fake-daemon WS transport (ch18 §18.7, §18.3.1): a WebSocket CLIENT that dials the Cortex bridge
 * exactly as the real daemon would, wraps the FakeDaemon enforcement engine, and speaks the frozen
 * BridgeFrame wire (@ekoa/shared). On a `delegate` frame it runs the §18.5.1 verification, executes
 * the scripted reads through the containment engine (emitting `ledger_row` frames, S6), optionally
 * asks Cortex-as-provider for a completion, and returns a derived-output-only `delegation_result`
 * (§18.2.2 — never raw file bytes). Denials produce a `denial` frame. The harness is authoritative
 * on the wire (§18.1).
 */
import { WebSocket } from 'ws';
import { BridgeFrame, type DelegatedTask } from '@ekoa/shared';
import { FakeDaemon, type FakeDaemonOptions } from './daemon.js';

/** What the scripted daemon does with a delegated task: which grant/file to read, whether it needs
 *  a provider completion, and the derived answer to return. A faithful stand-in, deterministic. */
export interface TaskScript {
  /** Read this (grantRef, relPath) within the grant, ledgered (S6). */
  read?: { grantRef: string; relPath: string };
  /** If set, send a provider_request carrying this body and wait for the provider_response. */
  provider?: { body: unknown };
  /** The derived answer to return (no raw file bytes; §18.2.2). */
  answer: string;
  citations?: { path: string; range: string }[];
}

export interface FakeDaemonClientOptions extends FakeDaemonOptions {
  /** Bridge WS base, e.g. ws://127.0.0.1:PORT ; the path is /api/v1/bridge/connect/:pairingId. */
  wsBase: string;
  /** The bridge token minted for this pairing (Authorization: Bearer). */
  bridgeToken: string;
  /** How the daemon executes a delegated task (deterministic script per test). */
  script: TaskScript;
}

export class FakeDaemonClient {
  readonly daemon: FakeDaemon;
  private ws: WebSocket | undefined;
  private readonly pendingProvider = new Map<string, (body: unknown) => void>();
  /** Correlation ids seen on provider_response frames (for the S6 join assertion). */
  readonly correlationIds: string[] = [];

  constructor(private readonly opts: FakeDaemonClientOptions) {
    this.daemon = new FakeDaemon(opts);
  }

  /** Dial the bridge and resolve once the socket is open (or reject on error/close). */
  connect(): Promise<void> {
    const url = `${this.opts.wsBase}/api/v1/bridge/connect/${this.opts.pairingId}`;
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.opts.bridgeToken}` } });
    this.ws = ws;
    ws.on('message', (data) => this.onMessage(typeof data === 'string' ? data : (data as Buffer).toString()));
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err) => reject(err));
      ws.once('unexpected-response', () => reject(new Error('bridge upgrade refused')));
    });
  }

  close(): void {
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(frame: BridgeFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private onMessage(raw: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    const res = BridgeFrame.safeParse(parsed);
    if (!res.success) return;
    const frame = res.data;
    switch (frame.type) {
      case 'delegate':
        void this.onDelegate(frame.task);
        break;
      case 'provider_response': {
        this.correlationIds.push(frame.correlationId);
        this.pendingProvider.get(frame.correlationId)?.(frame.body);
        this.pendingProvider.delete(frame.correlationId);
        break;
      }
      case 'ping':
        this.send({ type: 'pong' });
        break;
      default:
        break;
    }
  }

  private async onDelegate(task: DelegatedTask): Promise<void> {
    // §18.5.1: verify the binding first; a denial is a `denial` frame, never a result.
    const denial = this.daemon.verifyTask(task);
    if (denial) {
      this.send({ type: 'denial', taskId: task.taskId, reason: denial.reason, principle: denial.principle });
      return;
    }
    const script = this.opts.script;
    // A provider completion, if the script needs one: mint a correlation id daemon-side per request
    // (the daemon carries it; Cortex's chokepoint is the authority, but the harness needs one to key
    // the pending map). The server's provider handler echoes it back on the provider_response.
    let correlationId = `corr-${task.taskId}`;
    if (script.provider) {
      const body = await new Promise<unknown>((resolve) => {
        this.pendingProvider.set(correlationId, resolve);
        this.send({ type: 'provider_request', correlationId, session: task.session, credential: this.opts.bridgeToken, body: script.provider!.body });
      });
      void body;
    }
    // A ledgered read within a grant (S1 containment, S6 ledger). The correlationId joins the two
    // audit halves (§18.5 S6): the same id lands on the daemon ledger row AND the hosted audit.
    if (script.read) {
      try {
        this.daemon.read(task, script.read.grantRef, script.read.relPath, correlationId, 'read');
        const row = this.daemon.ledger.at(-1)!;
        this.send({ type: 'ledger_row', taskId: task.taskId, row });
      } catch {
        this.send({ type: 'denial', taskId: task.taskId, reason: 'containment or grant denial', principle: 'S1' });
        return;
      }
    }
    // Derived output only (§18.2.2): a summary + citations + telemetry, NEVER raw file bytes.
    this.send({
      type: 'delegation_result',
      taskId: task.taskId,
      result: {
        status: 'ok',
        answer: script.answer,
        citations: script.citations ?? [],
        ledgerRefs: this.daemon.ledger.map((_, i) => `${task.taskId}:${i}`),
        telemetry: { egressBytes: this.daemon.egressBytesUsed(), maskedCounts: {} },
      },
    });
  }
}
