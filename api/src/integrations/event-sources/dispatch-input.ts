/**
 * Dispatch-input builder (2A-S2) — the per-source branching that turns a claimed queue row into the
 * INPUT an artifact backend is invoked with. Extracted (deps-injected) from ekoa-dev's monolithic
 * `dispatchEvent` (cortex/src/services/trigger-dispatcher.ts): ekoa-code's `events/delivery.ts`
 * already owns the queue claim, the automation-vs-artifact target routing, and ALL retry/dead
 * semantics, so THIS module owns only the one concern dev's dispatcher folded in — building the
 * artifact-backend input:
 *
 *   - an EMAIL source (a platform provider: M365 / Google) hydrates the FULL message into the
 *     frozen `EmailInput` envelope (via the injected `hydrateEmail`, which reads the body through
 *     core's OAuth boundary). A read failure THROWS out of here so the delivery pipeline retries —
 *     the backend is NEVER handed a truncated preview body.
 *   - any OTHER source keeps the generic envelope ekoa-code already delivered (`{ event, trigger }`),
 *     unchanged, so non-email artifact backends see the exact input they saw before.
 *
 *   - a WHATSAPP source (2A-S3) FANS OUT: one Meta webhook envelope batches N inbound messages, so
 *     it produces N backend invocations — one neutral `MessageInput` each. A statuses-only
 *     notification (delivery receipts, no inbound messages) produces ZERO inputs, which the caller
 *     delivers as a no-op SUCCESS (never an error, never a dropped event).
 *
 * DEPS-INJECTED: the hydration collaborator arrives via `DispatchInputDeps` (wired at the
 * composition root, server.ts). This module imports only its sibling `email-hydrate.ts` /
 * `whatsapp-hydrate.ts` predicates; it defines its own trigger projection so it stays decoupled
 * from `events/` (events/ imports THIS direction).
 *
 * BINDING (integrations/event-sources/): may import integrations/ siblings + data/, never apps/ or
 * web/, never events/.
 */

import { isEmailSource, type EmailInput } from './email-hydrate.js';
import { hydrateWhatsAppMessages, isWhatsAppSource, type MessageInput } from './whatsapp-hydrate.js';

/** Minimal trigger projection the input builder needs — a decoupled subset of the durable TriggerDoc. */
export interface DispatchTrigger {
  id: string;
  integrationKey: string;
  eventName: string;
}

/** The generic (non-email) envelope handed to an artifact backend. Preserves ekoa-code's existing
 *  artifact-backend dispatch shape verbatim (a non-email source sees no behavioural change). */
export interface GenericBackendInput {
  event: unknown;
  trigger: { id: string; eventName: string };
}

export interface DispatchInputDeps {
  /** Hydrate an email-source trigger's full message into the frozen `EmailInput`. Bound at the
   *  composition root to `read_email` through `callPlatformIntegration` (OAuth refresh in core), so
   *  a read failure REJECTS and the delivery pipeline retries. */
  hydrateEmail(trigger: DispatchTrigger, listItem: unknown): Promise<EmailInput>;
}

/**
 * Build the input for an artifact-backend dispatch. Email sources hydrate to `EmailInput`; every
 * other source keeps the generic `{ event, trigger }` envelope. A hydration failure PROPAGATES
 * (never swallowed into a preview body) so the queue's retry schedule re-attempts.
 */
export async function buildArtifactBackendInput(
  trigger: DispatchTrigger,
  payload: unknown,
  deps: DispatchInputDeps,
): Promise<EmailInput | GenericBackendInput> {
  if (isEmailSource(trigger)) {
    // Core fetches the full message so the artifact never touches Graph/OAuth. A read failure throws
    // out of hydrateEmail → out of here → the delivery pipeline schedules a retry.
    return deps.hydrateEmail(trigger, payload);
  }
  return { event: payload, trigger: { id: trigger.id, eventName: trigger.eventName } };
}

/**
 * Build the FULL list of inputs one claimed event dispatches as (2A-S3) — the entry point the
 * composition root calls. Every source but WhatsApp yields exactly one input (delegated to
 * `buildArtifactBackendInput`, unchanged); a WhatsApp envelope fans out to one `MessageInput` per
 * inbound message.
 *
 * ZERO inputs is a legitimate outcome, NOT an error: a Meta statuses-only notification (delivery
 * receipts for messages WE sent) carries no inbound message, so the caller invokes the backend zero
 * times and marks the delivery successful — a dispatched no-op. Dropping it at ingress instead
 * would lose the audit row; failing it would burn the retry schedule on an event that can never
 * succeed.
 *
 * The backend still MUST dedupe on `MessageInput.id` (the wamid): on a mid-batch failure the WHOLE
 * event is retried, which re-invokes the messages already delivered in that batch.
 */
export async function buildArtifactBackendInputs(
  trigger: DispatchTrigger,
  payload: unknown,
  deps: DispatchInputDeps,
): Promise<Array<EmailInput | GenericBackendInput | MessageInput>> {
  if (isWhatsAppSource(trigger)) {
    // Parses the queue's JSON-TEXT payload first (a raw string would flatten to [] — the 2A-S2
    // wiring bug class); a non-JSON payload THROWS so the delivery retries instead of silently
    // reporting a statuses-only no-op.
    return hydrateWhatsAppMessages(payload);
  }
  return [await buildArtifactBackendInput(trigger, payload, deps)];
}
