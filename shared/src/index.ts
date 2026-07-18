/**
 * shared/ — the API contract (ch02 §2.2). Re-exports every domain's zod schemas,
 * inferred types, and endpoint descriptor maps. `api/` mounts validation from these;
 * `web/` derives its typed client from them. Nothing else lives in shared/ (FIXED-1).
 */
import type { DomainDescriptorMap } from './descriptor.js';
import { authEndpoints } from './auth.js';
import { usersEndpoints } from './users.js';
import { orgEndpoints } from './org.js';
import { settingsEndpoints } from './settings.js';
import { sessionsEndpoints } from './sessions.js';
import { sheetsEndpoints } from './sheets.js';
import { chatEndpoints } from './chat.js';
import { jobsEndpoints } from './jobs.js';
import { artifactsEndpoints } from './artifacts.js';
import { companySpaceEndpoints } from './company-space.js';
import { integrationsEndpoints } from './integrations.js';
import { integrationBuilderEndpoints } from './integration-builder.js';
import { platformIntegrationsEndpoints } from './platform-integrations.js';
import { pipedreamEndpoints } from './pipedream.js';
import { triggersEndpoints } from './triggers.js';
import { automationsEndpoints } from './automations.js';
import { memoriesEndpoints } from './memories.js';
import { knowledgeEndpoints } from './knowledge.js';
import { billingEndpoints } from './billing.js';
import { credentialsEndpoints } from './credentials.js';
import { uploadsEndpoints } from './uploads.js';
import { registoEndpoints } from './registo.js';
import { changeRequestsEndpoints } from './change-request.js';
import { appAssistantEndpoints } from './app-assistant.js';
import { servedAppEndpoints } from './served-app.js';
import { ekoaLocalEndpoints } from './ekoa-local.js';
import { gatewayKeysEndpoints } from './gateway-keys.js';
import { notificationsEndpoints } from './notifications.js';

export * from './descriptor.js';
export * from './common.js';
export * from './errors.js';
export * from './events.js';
export * from './auth.js';
export * from './users.js';
export * from './org.js';
export * from './settings.js';
export * from './sessions.js';
export * from './sheets.js';
export * from './chat.js';
export * from './jobs.js';
export * from './artifacts.js';
export * from './company-space.js';
export * from './integrations.js';
export * from './integration-builder.js';
export * from './platform-integrations.js';
export * from './pipedream.js';
export * from './triggers.js';
export * from './automations.js';
export * from './memories.js';
export * from './knowledge.js';
export * from './billing.js';
export * from './credentials.js';
export * from './uploads.js';
export * from './registo.js';
export * from './change-request.js';
export * from './capabilities.js';
export * from './action-manifest.js';
export * from './artifact-type.js';
export * from './app-assistant.js';
export * from './served-app.js';
export * from './ekoa-local.js';
export * from './gateway-keys.js';
export * from './notifications.js';
// Voice WS message contract (mega-run C1) - a WS carve-out like streaming/, so it has
// schemas + path constants here but NO descriptor-map entry (not a REST endpoint).
export * from './voice.js';

/** Every domain's descriptor map, keyed by domain. The route census + protocol-parity
 *  gate (ch13 §13.5) walk this against the mounted routes. */
export const ALL_ENDPOINTS: Record<string, DomainDescriptorMap> = {
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
  credentials: credentialsEndpoints,
  uploads: uploadsEndpoints,
  registo: registoEndpoints,
  changeRequests: changeRequestsEndpoints,
  appAssistant: appAssistantEndpoints,
  servedApp: servedAppEndpoints,
  ekoaLocal: ekoaLocalEndpoints,
  gatewayKeys: gatewayKeysEndpoints,
  notifications: notificationsEndpoints,
};

/** Flat list of every endpoint descriptor across all domains. */
export function allEndpointsFlat() {
  return Object.entries(ALL_ENDPOINTS).flatMap(([domain, map]) =>
    Object.entries(map).map(([name, d]) => ({ domain, name, ...d })),
  );
}
