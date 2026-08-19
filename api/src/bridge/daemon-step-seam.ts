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
  /**
   * Has the ORG granted this capability on THIS machine (I-3, default deny)?
   *
   * THE FIRST QUESTION ASKED, AND THE REASON THIS DEPENDENCY EXISTS. The only per-machine
   * authorisation used to live inside `invoke` (`invokeTool` refuses an ungranted capability before
   * sending a frame), which made it the LAST thing consulted here - after `deliverSecrets` had
   * redeemed the nonce, unwrapped a Cofre item through `unwrap()`, armed the ingress filter, put
   * the plaintext on the machine's socket and written a Registo "use" row. Every one of those is
   * irreversible, and the daemon then held the value in RAM for the delivery TTL. An ungranted
   * machine got the credential and was refused afterwards.
   *
   * It stays inside `invokeTool` as well. That is not a duplicate to be tidied away: that check
   * guards every OTHER caller of the invocation coordinator, and this one guards the disclosure
   * that happens before it is ever reached. Removing either leaves a path with no check on it.
   *
   * RE-READ EVERY STEP, NEVER CACHED, for the reason `tool-invocation.ts` gives: a grant revoked
   * mid-run must stop the NEXT step. Revocation does not close the socket, so this check is the
   * only thing between a de-authorised machine and the next credential.
   */
  isCapabilityGranted(orgId: string, pairingId: string, capability: BridgeCapability): Promise<boolean>;
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

      // ORDER: GRANT -> authorise -> deliver -> invoke, all under ONE invocationId.
      //
      // THE GRANT COMES FIRST because everything after it is irreversible disclosure, not dispatch.
      // `deliverSecrets` redeems a single-use nonce, unwraps a Cofre item, arms the ingress filter,
      // puts the PLAINTEXT on a user's socket and records a Registo "use" - and the machine then
      // holds that value in RAM for the delivery TTL. Asking afterwards whether the org authorised
      // this machine asks after the credential is already on someone's laptop. The sibling suite
      // states the property for dispatch ("a refusal after dispatch would already have asked a
      // user's computer to run something"); delivering a decrypted credential is strictly more.
      if (!(await deps.isCapabilityGranted(conn.org, conn.pairingId, capability))) {
        return refused(`esta máquina não está autorizada para ${capability} nesta organização`);
      }

      const invocationId = deps.newInvocationId();

      // Authorise before delivering because it is the single-use check: a replay is refused before
      // any credential is unwrapped, so a replayed step cannot even cause a decrypt. Deliver before
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

/**
 * An AUTHORISATION refusal, which is not the same thing as a failure.
 *
 * `retryable: false` is load-bearing rather than decorative: `local-command.ts` records
 * `recoverable: env.error?.retryable !== false`, so an unflagged refusal is a recoverable step and
 * the engine retries it - and every retry used to be another decrypt-and-ship to the same
 * unauthorised machine. Retrying a grant that does not exist can only produce the same refusal.
 */
function refused(message: string): DaemonStepResultEnvelope {
  return { ok: false, error: { message, retryable: false }, observation: { data: {} } };
}
