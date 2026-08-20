/**
 * Reading an ACTION off the capability payload (slice S2).
 *
 * `IntegrationDefinition.actions` rides the wire as an OPEN record (`z.record(z.unknown())` in
 * `shared/src/integrations.ts`) - deliberately, because a package's action carries fields the
 * contract does not enumerate. That makes every read of one a narrowing, and doing the narrowing
 * inline in JSX is how a client ends up with four slightly different readings of `httpConfig`.
 *
 * So it lives here, once, and every accessor answers `undefined` rather than throwing or inventing:
 * an action with no binding legitimately has no run history, and an action with no `httpConfig`
 * legitimately has no request to show. The page renders the absence; it never renders a guess.
 *
 * NOTHING HERE RE-DERIVES A DECISION THE SERVER MADE. `backingType`, `requiresApproval`, `target`
 * and `approved` all arrive on `IntegrationCapabilityAction`, computed by the executor's own
 * resolver and the write gate's own predicate. This module reads DISPLAY detail off the definition
 * and nothing else - it must never grow a second reading of `mutates`.
 */

import type { IntegrationCapability } from '@ekoa/shared';

/** The request an `api-call` action makes, in the words the definition declares it. */
export interface ActionHttpTemplate {
  method: string;
  /** `baseUrl` + `path`, with the `{{...}}` placeholders left exactly as authored. */
  url: string;
}

/** The raw action record for one action name, or undefined. */
export function actionRecordOf(
  capability: IntegrationCapability | null | undefined,
  actionName: string,
): Record<string, unknown> | undefined {
  return (capability?.integration.actions ?? []).find((a) => a['actionName'] === actionName);
}

/**
 * The automation an action's binding names.
 *
 * Absent for every api-call action, which is why the caller treats `undefined` as "this action has
 * no run history" rather than as an error.
 */
export function automationIdOf(
  capability: IntegrationCapability | null | undefined,
  actionName: string,
): string | undefined {
  const binding = actionRecordOf(capability, actionName)?.['automationBinding'];
  if (typeof binding !== 'object' || binding === null) return undefined;
  const id = (binding as { automationId?: unknown }).automationId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * The METHOD + URL TEMPLATE an api-call action declares.
 *
 * The template is shown WITH its placeholders, not resolved: what the definition says is the fact
 * the read-only view is for, and a resolved URL would need argument values this page does not have
 * and must not invent. The evidence sample beside it is where a REAL, already-redacted URL appears.
 */
export function httpTemplateOf(
  capability: IntegrationCapability | null | undefined,
  actionName: string,
): ActionHttpTemplate | undefined {
  const http = actionRecordOf(capability, actionName)?.['httpConfig'];
  if (typeof http !== 'object' || http === null) return undefined;
  const { method, baseUrl, path } = http as { method?: unknown; baseUrl?: unknown; path?: unknown };
  if (typeof method !== 'string' || method === '') return undefined;
  const base = typeof baseUrl === 'string' ? baseUrl : '';
  const rest = typeof path === 'string' ? path : '';
  // Join without inventing or swallowing a separator: an authored `path` may or may not lead with
  // a slash, and showing `https://host/api` as `https://hostapi` would misdescribe the call.
  const url = base !== '' && rest !== '' && !base.endsWith('/') && !rest.startsWith('/')
    ? `${base}/${rest}`
    : `${base}${rest}`;
  return { method: method.toUpperCase(), url };
}
