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
 * DEPS-INJECTED: the hydration collaborator arrives via `DispatchInputDeps` (wired at the
 * composition root, server.ts). This module imports only its sibling `email-hydrate.ts` predicate;
 * it defines its own trigger projection so it stays decoupled from `events/` (events/ imports THIS
 * direction). WhatsApp fan-out is a separate source and lands in slice 2A-3.
 *
 * BINDING (integrations/event-sources/): may import integrations/ siblings + data/, never apps/ or
 * web/, never events/.
 */

import { isEmailSource, type EmailInput } from './email-hydrate.js';

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
