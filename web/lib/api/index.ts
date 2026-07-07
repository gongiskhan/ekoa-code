/**
 * The typed REST client (ch12 §12.2.1). A single generic factory derives the client from
 * the `shared/` endpoint descriptors - generation happens at the TYPE level, no codegen
 * script to drift. Namespaces mirror the ch03 domain map one to one and expose the whole
 * contract (including endpoints no page calls yet; unused methods tree-shake away).
 *
 * ---------------------------------------------------------------------------------------
 * TYPING LIMITATION (load-bearing for W3 - read this).
 *
 * §12.2.1's sketch declares each domain map `as const satisfies EndpointMap`, which would
 * preserve per-op literal types. The ACTUAL `shared/` maps are annotated
 * `: DomainDescriptorMap` (= `Record<string, EndpointDescriptor>`), which WIDENS them: the
 * per-method key names and the specific zod schema types are erased at the type level.
 * Consequences, given the maps as they exist today:
 *   - Domain namespaces ARE typed/autocompleted (`api.auth`, `api.chat`, ... are literal
 *     keys of the object passed to `createClient`).
 *   - Method names fall under an index signature (`api.auth.login` type-checks, but so
 *     would any name) - no per-method autocomplete.
 *   - Request bodies / path params / query are passed as a flat `Record<string, unknown>`
 *     and are NOT type-checked against the schema.
 *   - Response types resolve to `unknown` (NOT `any` - the widened branch is unknown-safe).
 *
 * The honest affordance for callers: each method is generic on its response, so W3 supplies
 * the response type from the shared inferred types (which ARE exported), with zero `any`
 * and zero cast:
 *     const res = await api.auth.login<LoginResponse>({ username, password });
 *
 * If `shared/` later tightens its maps to `as const satisfies` (the §12.2.1 form), the
 * `ResponseOf<D>` conditional below lights up automatically and the explicit type argument
 * becomes redundant - this client needs no change. Path params stay untyped regardless,
 * because they live only in the `path` string, not in a schema.
 * ---------------------------------------------------------------------------------------
 */

import type { DomainDescriptorMap, EndpointDescriptor } from '@ekoa/shared';
import {
  authEndpoints,
  usersEndpoints,
  orgEndpoints,
  settingsEndpoints,
  sessionsEndpoints,
  chatEndpoints,
  jobsEndpoints,
  artifactsEndpoints,
  companySpaceEndpoints,
  integrationsEndpoints,
  integrationBuilderEndpoints,
  platformIntegrationsEndpoints,
  pipedreamEndpoints,
  triggersEndpoints,
  automationsEndpoints,
  memoriesEndpoints,
  knowledgeEndpoints,
  billingEndpoints,
  uploadsEndpoints,
  registoEndpoints,
  appAssistantEndpoints,
  servedAppEndpoints,
  ekoaLocalEndpoints,
  notificationsEndpoints,
} from '@ekoa/shared';
import { request, type RequestArgs, type RequestOptions } from './core';
import { resolveUrl, appUrl, withPreviewToken } from './url';

// -- Type-level client generation over the descriptor maps ------------------------------

/** The response type of a descriptor: the schema's inferred output when literal, else `unknown`. */
type ResponseOf<D> = D extends { response: infer R } ? (R extends { _output: infer O } ? O : unknown) : unknown;

/**
 * One client method. Generic on the response so callers can supply the shared inferred type
 * (`api.auth.login<LoginResponse>({...})`) while the widened maps erase per-op inference.
 * The default `ResponseOf<D>` becomes the real type automatically if `shared/` tightens.
 */
type ClientMethod<D> = <T = ResponseOf<D>>(args?: RequestArgs, opts?: RequestOptions) => Promise<T>;

type DomainClient<M extends DomainDescriptorMap> = {
  [K in keyof M]: ClientMethod<M[K]>;
};

type Client<T extends Record<string, DomainDescriptorMap>> = {
  [Domain in keyof T]: DomainClient<T[Domain]>;
};

/**
 * The generic client factory (§12.2.1). Binds each descriptor to `request` at runtime; the
 * type is generated from the map shapes with no codegen.
 */
export function createClient<T extends Record<string, DomainDescriptorMap>>(maps: T): Client<T> {
  const client: Record<string, Record<string, ClientMethod<EndpointDescriptor>>> = {};
  for (const [domain, map] of Object.entries(maps)) {
    const namespace: Record<string, ClientMethod<EndpointDescriptor>> = {};
    for (const [name, descriptor] of Object.entries(map)) {
      namespace[name] = ((args, opts) => request(descriptor, args, opts)) as ClientMethod<EndpointDescriptor>;
    }
    client[domain] = namespace;
  }
  return client as unknown as Client<T>;
}

// -- The bound client -------------------------------------------------------------------
//
// Domain keys mirror ch03 / `shared` ALL_ENDPOINTS one to one (24 domains; no `teams` -
// removed end to end, Amendment 2; `company` -> `org`, renamed resource). Written as an
// object literal (not `ALL_ENDPOINTS`) so the DOMAIN keys stay literal and autocomplete.

const domainMaps = {
  auth: authEndpoints,
  users: usersEndpoints,
  org: orgEndpoints,
  settings: settingsEndpoints,
  sessions: sessionsEndpoints,
  chat: chatEndpoints,
  jobs: jobsEndpoints,
  artifacts: artifactsEndpoints,
  companySpace: companySpaceEndpoints,
  integrations: integrationsEndpoints,
  integrationBuilder: integrationBuilderEndpoints,
  platformIntegrations: platformIntegrationsEndpoints,
  pipedream: pipedreamEndpoints,
  triggers: triggersEndpoints,
  automations: automationsEndpoints,
  memories: memoriesEndpoints,
  knowledge: knowledgeEndpoints,
  billing: billingEndpoints,
  uploads: uploadsEndpoints,
  registo: registoEndpoints,
  appAssistant: appAssistantEndpoints,
  servedApp: servedAppEndpoints,
  ekoaLocal: ekoaLocalEndpoints,
  notifications: notificationsEndpoints,
} satisfies Record<string, DomainDescriptorMap>;

/** URL helpers hung off the client (§12.2.6). */
export interface UrlHelpers {
  resolveUrl: typeof resolveUrl;
  appUrl: typeof appUrl;
  withPreviewToken: typeof withPreviewToken;
}

export type Api = Client<typeof domainMaps> & UrlHelpers;

/** The single typed client bound to the whole `shared/` contract (§12.2.1). */
export const api: Api = Object.assign(createClient(domainMaps), {
  resolveUrl,
  appUrl,
  withPreviewToken,
});

// Re-export the transport surface so `web/components/providers/api-provider.tsx` and W3
// call sites have one import entry.
export { ApiError, tryCall, isApiError, type CallResult } from './errors';
export { setLanguageSource, type RequestArgs, type RequestOptions } from './core';
export { getToken, setToken, clearToken, subscribe as subscribeToken } from './token';
export { resolveBaseUrl } from './base-url';
export { resolveUrl, appUrl, withPreviewToken } from './url';
export {
  openChatRunStream,
  openJobStream,
  openAutomationRunStream,
  openNotificationsStream,
  type EventStream,
  type StreamStatus,
  type Unsubscribe,
} from './stream';
export {
  openCanvas,
  CANVAS_CLOSE_NORMAL,
  CANVAS_CLOSE_TAKEOVER,
  type CanvasSession,
  type CanvasInputEvent,
  type CanvasOpenOptions,
  type CanvasStatus,
} from './canvas';
