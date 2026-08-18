/**
 * bridge/daemon-step-seam.ts - the ONE place a resolved automation step becomes a `tool.invoke`.
 *
 * WHY THIS IS A MODULE AND NOT SIX LINES IN `server.ts`. It used to be six lines in `server.ts`,
 * and all three of the following were wrong or missing in them, invisibly, because nothing could
 * import them to assert on:
 *
 *  - A BROWSER step was dispatched as `local.filesystem` (`req.capability === 'bash' ? 'local.bash'
 *    : 'local.filesystem'`). That is the FILE-delegation capability; the daemon advertises
 *    `desktop.automation` for driving a browser. The consequence ran both ways: an org that had
 *    correctly granted `desktop.automation` saw every browser step refused, and one that had
 *    granted `local.filesystem` for file reads had silently also authorised browser automation.
 *  - The SCREENSHOT was dropped. `observation: { data: res.output }` and nothing else, while
 *    `DaemonBrowserSession.ingest` reads `observation.screenshotB64` - so a bridge run produced no
 *    visual evidence while a hosted run produced it for every step.
 *  - SECRET DELIVERY had no production caller at all. `authoriseDelivery`/`deliverSecrets` existed,
 *    were tested, and were invoked by nothing; `local-command.ts` sent `env: undefined`.
 *
 * IT DEPENDS ON NOTHING. Every collaborator arrives as a typed callback, so this module imports
 * neither `automation/` (which owns the seam's consumer) nor the concrete bridge functions. The
 * composition root supplies the real ones and is where the structural match to
 * `automation/seams.ts`'s `DaemonConnection` is checked.
 */
import type { Actor, BridgeCapability } from '@ekoa/shared';

/** What the daemon answered. Structurally the bridge's `ToolResult`. */
export interface DaemonStepToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  screenshotB64?: string;
}

export interface DaemonStepDeps {
  invoke(input: {
    pairingId: string;
    orgId: string;
    capability: BridgeCapability;
    payload: unknown;
    /** Supplied so a delivery and its invocation share one id. */
    invocationId?: string;
  }): Promise<DaemonStepToolResult>;
  newInvocationId(): string;
  authoriseDelivery(invocationId: string, pairingId: string): string;
  deliverSecrets(
    actor: Actor,
    input: { invocationId: string; pairingId: string; mapping: Record<string, string>; processLabel?: string },
  ): Promise<unknown>;
}

export interface DaemonStepRequest {
  capability: 'browser' | 'bash';
  input: unknown;
  stepId?: string;
  runId: string;
  /**
   * The step's declared env-var -> `cofre:` REFERENCE mapping (I9). Never values: the values are
   * resolved by `deliverSecrets` through the Cofre's `unwrap()`, so the grant, the tenancy and the
   * lock all apply, and they reach the machine on the single frame in the union that carries
   * credential material. Absent (the overwhelmingly common case) means no delivery happens at all.
   */
  secretEnv?: Record<string, string>;
  /** The run's actor - required to resolve a `secretEnv`, unused otherwise. */
  actor?: Actor;
}

export interface DaemonStepResultEnvelope {
  ok: boolean;
  observation?: { screenshotB64?: string; text?: string; data?: unknown };
  error?: { message?: string; retryable?: boolean };
  meta?: { truncated?: boolean };
}

export interface DaemonStepConnection {
  readonly pairingId: string;
  runStep(req: DaemonStepRequest, opts?: unknown): Promise<DaemonStepResultEnvelope>;
}

/**
 * The capability a step is grant-checked against.
 *
 * `local.filesystem` is deliberately unreachable from here: it is the FILE-delegation rail
 * (`delegate`/`delegation_result`), a different frame family with a different verification path,
 * and conflating it with step execution is the bug this function exists to make impossible.
 */
export function capabilityForStep(kind: 'browser' | 'bash'): BridgeCapability {
  return kind === 'bash' ? 'local.bash' : 'desktop.automation';
}

export function createDaemonStepConnection(
  conn: { pairingId: string; org: string },
  deps: DaemonStepDeps,
): DaemonStepConnection {
  return {
    pairingId: conn.pairingId,
    async runStep(req: DaemonStepRequest, opts?: unknown): Promise<DaemonStepResultEnvelope> {
      void opts; // streamed progress arrives as its own frames; not part of the invoke contract
      const capability = capabilityForStep(req.capability);
      const invocationId = deps.newInvocationId();

      // ORDER: authorise -> deliver -> invoke, all under ONE invocationId.
      //
      // Authorise first because it is the single-use check: a replay is refused before any
      // credential is unwrapped, so a replayed step cannot even cause a decrypt. Deliver before
      // invoke because the daemon must already HOLD the value when the step that consumes it
      // arrives - the reverse order has a window in which the child spawns without its
      // environment. And a failed delivery means the step does NOT run: a child that believes it
      // has credentials it never received produces an authentication failure on the user's machine
      // with no explanation anywhere.
      if (req.secretEnv && Object.keys(req.secretEnv).length > 0) {
        if (!req.actor) {
          return failed('a credencial declarada precisa do contexto do utilizador');
        }
        try {
          deps.authoriseDelivery(invocationId, conn.pairingId);
          await deps.deliverSecrets(req.actor, {
            invocationId,
            pairingId: conn.pairingId,
            mapping: req.secretEnv,
            processLabel: 'local_command',
          });
        } catch (err) {
          return failed(err instanceof Error ? err.message : String(err));
        }
      }

      const res = await deps.invoke({
        pairingId: conn.pairingId,
        orgId: conn.org,
        capability,
        payload: {
          capability: req.capability,
          input: req.input,
          ...(req.stepId !== undefined ? { stepId: req.stepId } : {}),
          runId: req.runId,
        },
        invocationId,
      });

      // A refusal is an ordinary failed observation, not a thrown error: the engine's step record
      // is where a user-visible failure belongs.
      return {
        ok: res.ok,
        ...(res.error ? { error: { message: res.error } } : {}),
        observation: {
          data: (res.output ?? {}) as Record<string, unknown>,
          // Omitted rather than empty-stringed when the machine captured none: an empty string
          // would claim a screenshot that does not exist, and `ingest` would cache it.
          ...(res.screenshotB64 ? { screenshotB64: res.screenshotB64 } : {}),
        },
      };
    },
  };
}

function failed(message: string): DaemonStepResultEnvelope {
  return { ok: false, error: { message }, observation: { data: {} } };
}
