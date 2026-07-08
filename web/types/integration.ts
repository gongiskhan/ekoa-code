/**
 * Frontend view-model types for the integrations surface.
 *
 * These are the rich shapes the integrations UI reads (cards, dialog, builder,
 * session-connect). They previously lived on the legacy transport client
 * (`web/lib/api/client.ts`); with the W3 migration to the typed REST client the
 * wire contracts in `@ekoa/shared` model only the minimal typed envelope (and are
 * `.passthrough()`), so the rich fields ride through untyped. This file is the
 * hand-maintained web mirror - the same pattern as `web/types/automation.ts`.
 *
 * Source of truth for the payloads: `shared/src/integrations.ts`,
 * `shared/src/integration-builder.ts`, and the api integrations mappers.
 */

export interface IntegrationConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'url' | 'select' | 'password' | 'textarea';
  required: boolean;
  secret: boolean;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface IntegrationActionHttpConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  baseUrl: string;
  path: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
  authHelpers?: Array<{
    type: string;
    outputVariable: string;
    config: Record<string, unknown>;
  }>;
}

export interface IntegrationAction {
  actionName: string;
  description: string;
  argsSchema: Record<string, unknown>;
  returnSchema: Record<string, unknown>;
  mutates: boolean;
  httpConfig?: IntegrationActionHttpConfig;
  /** Present when the action executes a materialized automation instead of an HTTP call. */
  automationBinding?: {
    automationId: string;
    automationTemplate?: string;
    argMap?: Record<string, string>;
    passCredentials?: boolean;
  };
}

/** Browser-session connect descriptor (config.json `sessionConnect`, authType 'browser_session'). */
export interface IntegrationSessionConnect {
  loginUrl: string;
  successUrlContains: string;
  guidePt?: string;
}

export interface IntegrationSkill {
  integrationKey: string;
  displayName: string;
  description: string;
  provider: string;
  category: string;
  authType: 'api_key' | 'oauth2' | 'service_account' | 'none' | 'browser_session';
  configSchema: IntegrationConfigField[];
  actions: IntegrationAction[];
  /** Step-by-step markdown on how to obtain credentials for this integration. */
  credentialGuide?: string;
  /** Present when the integration authenticates via a captured browser session. */
  sessionConnect?: IntegrationSessionConnect;
  createdAt?: string;
  updatedAt?: string;
}

export interface IntegrationCompanyConfig {
  id: string;
  integrationKey: string;
  enabled: boolean;
  configuredBy: string;
  configuredAt: string;
  lastTestedAt?: string | null;
  lastTestResult?: string | null;
}

export interface ActiveIntegration {
  integrationKey: string;
  displayName: string;
  description: string;
  provider: string;
  category: string;
  actions: IntegrationAction[];
}

export interface IntegrationSessionActionRow {
  actionName: string;
  description: string;
  mutates: boolean;
  automationTemplate: string | null;
  automationId: string | null;
  automationName: string | null;
  provisioned: boolean;
}

export interface IntegrationSessionStatus {
  integrationKey: string;
  sessionConnect: {
    supported: boolean;
    available: boolean;
    loginUrl?: string;
    message: string;
  };
  session: {
    status: 'none' | 'waiting_login' | 'captured' | 'failed';
    capturedAt: string | null;
    message?: string;
  };
  actions: IntegrationSessionActionRow[];
}

export interface IntegrationConnectSessionResult {
  started: boolean;
  session: { status: 'waiting_login' | 'failed'; message: string };
}

export interface IntegrationProvisionAutomationsResult {
  provisioned: true;
  created: string[];
  updated: string[];
  actions: IntegrationSessionActionRow[];
}

export interface IntegrationBuilderConfig {
  version: string;
  skillType: string;
  integrationKey: string;
  displayName: string;
  description: string;
  authType: 'api_key' | 'oauth2' | 'service_account' | 'none';
  provider: string;
  category: string;
  configSchema: IntegrationConfigField[];
  actions: IntegrationAction[];
  /** Step-by-step markdown on how to obtain credentials for this integration. */
  credentialGuide?: string;
  proxyContract?: {
    executeEndpoint: string;
    requiredInputs: string[];
  };
}

export interface IntegrationBuilderOutput {
  skillMd: string;
  config: IntegrationBuilderConfig;
}

export interface BuilderChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface IntegrationTestResult {
  actionKey: string;
  success: boolean;
  statusCode?: number;
  response?: unknown;
  error?: string;
  timestamp: string;
}
