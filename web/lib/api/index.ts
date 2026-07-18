/**
 * The typed REST client (ch12 §12.2.1). A single generic factory derives the client from
 * the `shared/` endpoint descriptors - generation happens at the TYPE level, no codegen
 * script to drift. Namespaces mirror the ch03 domain map one to one and expose the whole
 * contract (including endpoints no page calls yet; unused methods tree-shake away).
 *
 * ---------------------------------------------------------------------------------------
 * TYPE-LEVEL GENERATION (§12.2.1, criterion 7).
 *
 * The `shared/` domain maps are declared `as const satisfies DomainDescriptorMap`, so each
 * op's method/path literals AND its zod request/response schema types are preserved. The
 * client is generated from those precise types with no codegen:
 *   - Domain namespaces are typed keys (`api.auth`, `api.chat`, ...).
 *   - Method names are the literal op keys (`api.auth.login` autocompletes; a typo fails).
 *   - `args` is inferred from the op's `request` schema input (`z.input`); path params live
 *     only in the `path` string (not a schema) so they ride an index signature, untyped by
 *     design (§12.2.1). Query fields likewise.
 *   - The return type is inferred from the op's `response` schema output (`z.output`).
 * So `await api.auth.login({ username, password })` is `Promise<LoginResponse>` with no cast
 * and no explicit type argument. A method still accepts an optional response override for the
 * rare endpoint whose response type a caller wants to narrow.
 * ---------------------------------------------------------------------------------------
 */

import type { DomainDescriptorMap, EndpointDescriptor } from '@ekoa/shared';
import {
  authEndpoints,
  usersEndpoints,
  orgEndpoints,
  settingsEndpoints,
  sessionsEndpoints,
  sheetsEndpoints,
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
  changeRequestsEndpoints,
  appAssistantEndpoints,
  servedAppEndpoints,
  ekoaLocalEndpoints,
  gatewayKeysEndpoints,
  notificationsEndpoints,
} from '@ekoa/shared';
import { request, type RequestArgs, type RequestOptions } from './core';
import { resolveUrl, appUrl, withPreviewToken } from './url';

// -- Type-level client generation over the descriptor maps ------------------------------

/** The response type of a descriptor: the response schema's inferred output, else `unknown`. */
type ResponseOf<D> = D extends { response: infer R } ? (R extends { _output: infer O } ? O : unknown) : unknown;

/**
 * The args type of a descriptor: the request schema's inferred INPUT (typed body fields),
 * intersected with an index signature so flat path params / query fields (which live in the
 * `path` string / query schema, not the request schema) are allowed alongside, untyped. When
 * the op has no `request` schema (GET/DELETE), args is an optional flat record for params/query.
 */
type RequestInputOf<D> = D extends { request: infer R }
  ? (R extends { _input: infer I } ? I & Record<string, unknown> : RequestArgs)
  : RequestArgs;

/**
 * One client method. `args` is inferred from the op's request schema, the return from its
 * response schema (§12.2.1) - no cast, no explicit type argument at the call site. `T` remains
 * an optional response override for the rare endpoint a caller wants to narrow.
 */
type ClientMethod<D> = <T = ResponseOf<D>>(args?: RequestInputOf<D>, opts?: RequestOptions) => Promise<T>;

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
// Domain keys mirror ch03 / `shared` ALL_ENDPOINTS one to one (25 domains incl. H4
// changeRequests; no `teams` - removed end to end, Amendment 2; `company` -> `org`, renamed
// resource; `credentials` is api-only, not surfaced here). Written as an
// object literal (not `ALL_ENDPOINTS`) so the DOMAIN keys stay literal and autocomplete.

const domainMaps = {
  auth: authEndpoints,
  users: usersEndpoints,
  org: orgEndpoints,
  settings: settingsEndpoints,
  sessions: sessionsEndpoints,
  sheets: sheetsEndpoints,
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
  changeRequests: changeRequestsEndpoints,
  appAssistant: appAssistantEndpoints,
  servedApp: servedAppEndpoints,
  ekoaLocal: ekoaLocalEndpoints,
  gatewayKeys: gatewayKeysEndpoints,
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
