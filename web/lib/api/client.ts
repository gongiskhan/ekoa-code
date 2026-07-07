/**
 * API Client for Ekoa App
 *
 * Comprehensive API client for the ekoa Next.js frontend.
 * Mirrors the relevant functions from app/src/lib/api/client.ts.
 */

const API_VERSION = 'v1';

// ============================================
// TYPES
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface ExecuteRequest {
  agent: string;
  project: string;
  config: Record<string, unknown>;
  webhook?: { url: string; headers?: Record<string, string>; secret?: string };
  metadata?: Record<string, unknown>;
  sessionId?: string;
  language?: 'en' | 'pt';
}

export interface JobInfo {
  jobId: string;
  traceId: string;
  status: string;
  agent: string;
  project: string;
  streamUrl: string;
  createdAt: string;
  projectPath: string;
  artifactInstanceId?: string;
  templateFiles?: string[];
}

export interface InferenceResult {
  suggestedName: string;
  suggestedIntegrations: Array<{ id: string; relevance: string; reasoning: string }>;
  inferredTemplate: { id: string; confidence: string; reasoning: string } | null;
}

export interface FileAttachment {
  attachmentId: string;
  displayName: string;
  path: string;
  type: 'file' | 'folder' | 'url';
  size?: number;
}

// Auth types
export interface AuthUser {
  id: string;
  username: string;
  role: 'super-admin' | 'admin' | 'builder';
  companyId: string;
  teamId?: string;
  passwordChangeRequired: boolean;
  isActive: boolean;
  allocationPercentage?: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  passwordChangeRequired: boolean;
  expiresIn: string;
}

// Team types
export interface Team {
  id: string;
  name: string;
  description?: string;
  canPublicRelease: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamWithMemberCount extends Team {
  memberCount: number;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
  canPublicRelease?: boolean;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string;
  canPublicRelease?: boolean;
}

// Company types
export interface CompanyBranding {
  primaryColor: string;
  secondaryColor: string;
  logo: string;
  favicon: string;
  [key: string]: unknown;
}

export interface CompanyConfig {
  id: string;
  name: string;
  displayName: string;
  branding: CompanyBranding;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Integration types
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

// Activity log types
export interface ActivityLogEntry {
  id: string;
  userId: string;
  username: string;
  category: string;
  type: string;
  description: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

export interface ActivityLogResult {
  logs: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ActivityLogQuery {
  userId?: string;
  category?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// Project types
export interface ApiProject {
  id: string;
  name: string;
  templateId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

// ============================================
// CORE -- HTTP+SSE API client
// ============================================

import { getConnection, reconnectWithToken, getPortFromEnv } from '@/lib/cortex/connection';

export function getApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    // Empty string is an explicit "same-origin (Caddy proxy)" marker.
    if (fromEnv === '') {
      return `${window.location.protocol}//${window.location.hostname}`;
    }
    // Anything else: trust NEXT_PUBLIC_API_URL verbatim. It already carries
    // protocol + host + (optional) port — prod cortex lives on a different
    // hostname (api.ekoa.io) than the frontend (app.ekoa.io), so stripping
    // anything but the port lands API calls on the Next.js 404 page.
    if (fromEnv) return fromEnv;
    // Fallback for the rare browser-side caller that runs before bundle
    // injection ran (shouldn't happen — next.config.ts fails the build
    // when NEXT_PUBLIC_API_URL is missing).
    return `${window.location.protocol}//${window.location.hostname}`;
  }
  // Server-side rendering: NEXT_PUBLIC_API_URL is injected by next.config.ts
  // from ../backend.port. If it's missing, the bundle was built wrong.
  if (!fromEnv) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set (server-side). next.config.ts should " +
        "inject it from backend.port — check garrison and the dev scripts."
    );
  }
  return fromEnv;
}

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('ekoa_token');
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('ekoa_token', token);
  // Reconnect SSE with the new token
  reconnectWithToken(token);
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('ekoa_token');
  getConnection().disconnect();
}

/**
 * Send an action via HTTP POST and wrap the result in ApiResponse format.
 * All API functions use this internally.
 */
export async function wsAction<T>(
  app: string,
  intent: string,
  params: Record<string, unknown> | object = {},
  timeout?: number,
): Promise<ApiResponse<T>> {
  try {
    const raw = await getConnection().sendAction<unknown>(app, intent, params as Record<string, unknown>, timeout);
    // Unwrap recipe responses: { success, recipe_id, data, response_type } -> data
    const data = (raw && typeof raw === 'object' && 'recipe_id' in (raw as Record<string, unknown>))
      ? (raw as Record<string, unknown>).data as T
      : raw as T;
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Handle explicit auth rejection from server (not connection/network errors)
    const isAuthRejection = message.includes('Unauthorized') || message.includes('Authentication failed');
    const isConnectionError = message.includes('Not connected') || message.includes('timeout');
    if (isAuthRejection && !isConnectionError) {
      if (typeof window !== 'undefined') {
        clearAuthToken();
        localStorage.removeItem('ekoa_auth');
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
    }

    return {
      success: false,
      error: { code: 'API_ERROR', message },
    };
  }
}

// ============================================
// CLAUDE OAUTH (Standalone Mode)
// ============================================

export async function startClaudeOAuth(): Promise<ApiResponse<{ authUrl: string; state: string }>> {
  return wsAction('ekoa.claude-oauth', 'start');
}

export async function getClaudeOAuthStatus(): Promise<ApiResponse<{ connected: boolean; email?: string; expiresAt?: string }>> {
  return wsAction('ekoa.claude-oauth', 'status');
}

export async function disconnectClaudeOAuth(): Promise<ApiResponse<{ success: boolean }>> {
  return wsAction('ekoa.claude-oauth', 'disconnect');
}

// ============================================
// AUTH
// ============================================

export async function login(data: {
  username: string;
  password: string;
  rememberMe?: boolean;
}): Promise<ApiResponse<LoginResponse>> {
  const result = await wsAction<LoginResponse>('ekoa.auth', 'login', {
    username: data.username,
    password: data.password,
    rememberMe: data.rememberMe ?? true,
  });
  // On success, store token (setAuthToken also reconnects SSE with auth)
  if (result.success && result.data?.token) {
    setAuthToken(result.data.token);
  }
  return result;
}

export async function changePassword(data: {
  oldPassword: string;
  newPassword: string;
}): Promise<ApiResponse<{ message: string }>> {
  return wsAction('ekoa.auth','change-password', {
    currentPassword: data.oldPassword,
    newPassword: data.newPassword,
  });
}

export async function getCurrentUser(): Promise<ApiResponse<AuthUser & { token?: string }>> {
  return wsAction('ekoa.auth','get-me');
}

/**
 * Approve (or deny) a pending Ekoa Local device login by its human user code.
 * Backs the /activate page; the device is bound to the currently authenticated
 * user, so it logs the terminal in as whoever approves here.
 */
export async function approveDevice(userCode: string, deny = false): Promise<ApiResponse<{ ok: boolean }>> {
  return wsAction('ekoa.auth', 'device-approve', { userCode, deny });
}

export function logout(): void {
  clearAuthToken();
}

// ============================================
// USER MANAGEMENT (Admin only)
// ============================================

export async function listUsers(): Promise<ApiResponse<AuthUser[]>> {
  return wsAction('ekoa.users','list');
}

export async function createUser(data: {
  username: string;
  password?: string;
  role: 'admin' | 'builder';
  companyId?: string;
  teamId?: string;
  passwordChangeRequired?: boolean;
}): Promise<ApiResponse<AuthUser>> {
  return wsAction('ekoa.auth','create-user', {
    username: data.username,
    password: data.password || data.username.padEnd(6, '0'),
    role: data.role,
  });
}

export async function deleteUser(userId: string): Promise<ApiResponse<void>> {
  return wsAction('ekoa.users','delete', { userId });
}

export async function resetUserPassword(
  userId: string,
  newPassword: string
): Promise<ApiResponse<{ message: string }>> {
  return wsAction('ekoa.auth','reset-password', { userId, newPassword });
}

// ============================================
// TEAMS (On-prem only)
// ============================================

export async function getTeams(): Promise<ApiResponse<TeamWithMemberCount[]>> {
  return wsAction('ekoa.teams','list');
}

export async function createTeam(data: CreateTeamRequest): Promise<ApiResponse<Team>> {
  return wsAction('ekoa.teams','create', data);
}

export async function updateTeam(id: string, data: UpdateTeamRequest): Promise<ApiResponse<Team>> {
  return wsAction('ekoa.teams','update', { id, ...data });
}

export async function deleteTeam(id: string): Promise<ApiResponse<void>> {
  return wsAction('ekoa.teams','delete', { id });
}

// ============================================
// COMPANY
// ============================================

export async function getCompany(): Promise<ApiResponse<CompanyConfig>> {
  return wsAction('ekoa.company','get');
}

export async function updateCompany(data: {
  displayName?: string;
  branding?: Partial<CompanyBranding>;
  settings?: Partial<CompanyConfig['settings']>;
}): Promise<ApiResponse<CompanyConfig>> {
  return wsAction('ekoa.company','update', data);
}

export async function updateCompanyBranding(
  branding: Partial<CompanyBranding>,
  displayName?: string,
): Promise<ApiResponse<CompanyConfig>> {
  // Routed through ekoa.branding/save-branding because the legacy
  // ekoa.company/update-branding recipe is read-only.
  return wsAction('ekoa.branding', 'save-branding', { branding, displayName });
}

// ============================================
// BRANDING
// ============================================

export interface BrandResearchResult {
  jobId: string;
  traceId: string;
  status: string;
  websiteUrl: string;
}

export async function startBrandResearch(websiteUrl: string): Promise<ApiResponse<BrandResearchResult>> {
  return wsAction('ekoa.branding', 'start-research', { websiteUrl });
}

// ============================================
// INTEGRATIONS
// ============================================

export async function listIntegrationSkills(): Promise<ApiResponse<IntegrationSkill[]>> {
  return wsAction('ekoa.integrations','list-skills');
}

export async function getActiveIntegrations(): Promise<ApiResponse<ActiveIntegration[]>> {
  return wsAction('ekoa.integrations','list-active');
}

export async function getIntegrationConfigs(): Promise<ApiResponse<IntegrationCompanyConfig[]>> {
  return wsAction('ekoa.integrations','list-configs');
}

export async function configureIntegration(
  integrationKey: string,
  configValues: Record<string, string | number | boolean>
): Promise<ApiResponse<{
  id: string;
  integrationKey: string;
  enabled: boolean;
  configuredAt: string;
}>> {
  return wsAction('ekoa.integrations','create-config', { integrationKey, configValues });
}

export async function setIntegrationEnabled(
  integrationKey: string,
  enabled: boolean
): Promise<ApiResponse<{ integrationKey: string; enabled: boolean }>> {
  return wsAction('ekoa.integrations','update-config', { integrationKey, enabled });
}

export async function grantIntegrationAccess(
  integrationKey: string,
  userId: string,
  allowedActions?: string[]
): Promise<ApiResponse<{ userId: string; integrationKey: string; allowed: boolean; allowedActions?: string[] }>> {
  return wsAction('ekoa.integrations','grant-access', { integrationKey, userId, allowedActions });
}

export async function revokeIntegrationAccess(
  integrationKey: string,
  userId: string
): Promise<ApiResponse<{ userId: string; integrationKey: string; revoked: boolean }>> {
  return wsAction('ekoa.integrations','revoke-access', { integrationKey, userId });
}

export async function deleteIntegrationSkill(
  integrationKey: string
): Promise<ApiResponse<void>> {
  return wsAction('ekoa.integrations','delete-skill', { integrationKey });
}

export async function refreshIntegrationRegistry(): Promise<ApiResponse<{
  skillCount: number;
  skills: string[];
}>> {
  return wsAction('ekoa.integrations','refresh-registry');
}

// ---- Browser session connect (authType 'browser_session') ----

/** One action row from `session-status`, enriched with its automation binding state. */
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

export async function integrationSessionStatus(
  integrationKey: string
): Promise<ApiResponse<IntegrationSessionStatus>> {
  return wsAction('ekoa.integrations', 'session-status', { integrationKey });
}

export async function integrationConnectSession(
  integrationKey: string
): Promise<ApiResponse<IntegrationConnectSessionResult>> {
  return wsAction('ekoa.integrations', 'connect-session', { integrationKey });
}

export async function integrationProvisionAutomations(
  integrationKey: string
): Promise<ApiResponse<IntegrationProvisionAutomationsResult>> {
  return wsAction('ekoa.integrations', 'provision-automations', { integrationKey });
}

// ============================================
// INTEGRATION BUILDER
// ============================================

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

/** Send a message to the integration builder and get streaming response */
export async function integrationBuilderChat(
  message: string,
  sessionId?: string,
  language?: string,
): Promise<ApiResponse<{
  sessionId: string;
  generatedPackage: IntegrationBuilderOutput | null;
  validationErrors: string[];
}>> {
  return wsAction('ekoa.integration-builder', 'chat', { message, sessionId, language }, 300_000);
}

/** Load an existing integration into the builder */
export async function integrationBuilderLoad(
  integrationKey: string,
): Promise<ApiResponse<{
  sessionId: string;
  generatedPackage: IntegrationBuilderOutput | null;
  messages: BuilderChatMessage[];
  validationErrors: string[];
}>> {
  return wsAction('ekoa.integration-builder', 'load', { integrationKey });
}

/** Save the current builder output as an integration skill */
export async function integrationBuilderSave(
  sessionId: string,
  generatedPackage?: IntegrationBuilderOutput,
  testCredentials?: Record<string, string | number | boolean>,
): Promise<ApiResponse<{
  integrationKey: string;
  displayName: string;
  saved: boolean;
  configured?: boolean;
}>> {
  return wsAction('ekoa.integration-builder', 'save', { sessionId, generatedPackage, testCredentials });
}

/** Test an integration action with credentials */
export async function integrationBuilderTest(
  sessionId: string,
  actionKey: string,
  testCredentials?: Record<string, string | number | boolean>,
  testInput?: Record<string, unknown>,
): Promise<ApiResponse<{
  actionKey: string;
  success: boolean;
  statusCode?: number;
  response?: unknown;
  error?: string;
}>> {
  return wsAction('ekoa.integration-builder', 'test', {
    sessionId,
    actionKey,
    testCredentials,
    testInput,
  }, 60_000);
}

/** Save an integration directly (no chat session required) */
export async function saveIntegrationDirect(
  pkg: IntegrationBuilderOutput,
): Promise<ApiResponse<{
  integrationKey: string;
  displayName: string;
  saved: boolean;
}>> {
  return wsAction('ekoa.integration-builder', 'save', { generatedPackage: pkg });
}

/** Load full integration package (skillMd + config with httpConfig) for editing */
export async function loadIntegrationFull(
  integrationKey: string,
): Promise<ApiResponse<{
  sessionId: string;
  generatedPackage: IntegrationBuilderOutput | null;
  messages: BuilderChatMessage[];
  validationErrors: string[];
}>> {
  return integrationBuilderLoad(integrationKey);
}

// ============================================
// SETTINGS
// ============================================

export async function getSettings(): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.settings', 'get');
}

export async function updateSettings(data: {
  general?: { platformName?: string; language?: string; timezone?: string };
  chat?: { defaultMode?: string; autoOpenSidePanel?: boolean; showExampleCards?: boolean; enableContextDividers?: boolean };
  build?: { showFileTreeByDefault?: boolean };
  integration?: { autoTestAfterCreation?: boolean; defaultConfigExpanded?: boolean };
}): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.settings', 'update', data);
}

// ============================================
// AGENT EXECUTION
// ============================================

export async function executeAgent(request: ExecuteRequest): Promise<ApiResponse<JobInfo>> {
  return wsAction('ekoa.execute','execute-job', {
    agent: request.agent,
    config: {
      ...request.config,
      project: request.project,
      sessionId: request.sessionId,
      language: request.language,
    },
  });
}

export async function getJob(id: string): Promise<ApiResponse<JobInfo>> {
  return wsAction('ekoa.execute','get-job', { jobId: id });
}

export async function cancelJob(id: string): Promise<ApiResponse<void>> {
  return wsAction('ekoa.execute','cancel-job', { jobId: id });
}

export async function inferIntegrations(
  prompt: string,
  projectId?: string
): Promise<ApiResponse<InferenceResult>> {
  return wsAction('ekoa.execute','infer-integrations', { prompt, projectId });
}

// ============================================
// ARTIFACTS
// ============================================

export async function getArtifactInstance(id: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates','get-instance', { id });
}

export async function listArtifactInstances(): Promise<ApiResponse<unknown[]>> {
  return wsAction('ekoa.templates','list-instances');
}

export async function deleteArtifactInstance(id: string): Promise<ApiResponse<void>> {
  return wsAction('ekoa.templates','delete-instance', { id });
}

// Phase 2-4: Featured Artifacts + Fork + Bundle (export/import).
export async function setFeatured(
  artifactInstanceId: string,
  featured: boolean,
  featuredRank?: number,
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates', 'set-featured', { artifactInstanceId, featured, featuredRank });
}

export async function forkArtifact(sourceId: string, name?: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates', 'fork-instance', { sourceId, ...(name && { name }) });
}

export async function exportArtifact(id: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates', 'export-instance', { id });
}

export async function importArtifact(bundle: unknown): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates', 'import-instance', { bundle });
}

/**
 * Re-import a bundle IN PLACE: ships a new revision of an app the user already
 * owns, keeping its id, slug/URL and app-data. Returns the updated instance
 * plus { safetyNetSnapshotId, preUpdateVersionId } for the "repor" guidance.
 */
export async function updateArtifactFromBundle(
  id: string,
  bundle: unknown,
  force = false,
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates', 'update-from-bundle', { id, bundle, force });
}

/**
 * Consent to sync a customized featured artifact with the latest ekoa-data
 * source (U1). Safety-nets app-data + commits a pre-update version first, so it
 * is recoverable from Versões / Dados e cópias de segurança. No-op success for a
 * non-customized instance (it auto-updates at boot).
 */
export async function updateFeaturedFromSource(id: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates', 'update-featured-from-source', { id });
}

/** Keep the current version of a featured artifact: dismisses the update badge. */
export async function ignoreFeaturedUpdate(id: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.templates', 'ignore-featured-update', { id });
}

export interface ArtifactVersion {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  buildFailed: boolean;
  isRestore: boolean;
}

export async function listArtifactVersions(
  artifactId: string,
  limit?: number,
): Promise<ApiResponse<{ versions: ArtifactVersion[] }>> {
  return wsAction('ekoa.templates', 'versions-list', { artifactId, limit });
}

/** Walk the artifact's projectDir on the server, return a flat list of
 *  relative file paths. Used to re-populate the Files panel when a session
 *  is resumed (the live tool_use SSE stream isn't replayed on reload). */
export async function listArtifactFiles(
  artifactId: string,
): Promise<ApiResponse<{ files: Array<{ path: string; fullPath: string; action: 'created' }>; projectDir: string | null }>> {
  return wsAction('ekoa.templates', 'list-files', { artifactId });
}

export async function restoreArtifactVersion(
  artifactId: string,
  sha: string,
): Promise<ApiResponse<{ newHeadSha: string }>> {
  return wsAction('ekoa.templates', 'versions-restore', { artifactId, sha });
}

// ============================================
// APP DATA BACKUPS ("Dados e cópias de segurança")
// ============================================

export interface BackupRestorePoint {
  id: string;
  at: string;
  kind: string;
  source: 'local' | 'pitr' | 'gcs';
  label: string;
}

export interface BackupStatus {
  appId: string;
  lastBackupAt: string | null;
  automatic: boolean;
  pitrAvailable: boolean;
  restorePoints: BackupRestorePoint[];
}

export interface AppDataDump {
  appId: string;
  exportedAt: string;
  collections: Record<string, Array<Record<string, unknown>>>;
  counts: Record<string, number>;
  totalItems: number;
}

export async function getBackupStatus(appId: string): Promise<ApiResponse<BackupStatus>> {
  return wsAction<BackupStatus>('ekoa.app-data-backups', 'status', { appId });
}

export async function downloadAppDataDump(appId: string): Promise<ApiResponse<AppDataDump>> {
  return wsAction<AppDataDump>('ekoa.app-data-backups', 'download', { appId });
}

export async function previewBackupPoint(appId: string, point: BackupRestorePoint): Promise<ApiResponse<AppDataDump>> {
  return wsAction<AppDataDump>('ekoa.app-data-backups', 'preview', { appId, pointId: point.id, source: point.source, at: point.at });
}

export async function createBackupSnapshot(appId: string): Promise<ApiResponse<BackupRestorePoint>> {
  return wsAction<BackupRestorePoint>('ekoa.app-data-backups', 'snapshot', { appId });
}

// ============================================
// ARTIFACT BACKEND (Layer 2 — server-side code)
// ============================================

export interface BackendLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  meta?: Record<string, unknown>;
  at: string;
}

export interface BackendDryRunEffect {
  capability: string;
  detail: Record<string, unknown>;
}

export interface BackendStatus {
  artifactId: string;
  state: 'idle' | 'running' | 'crashed' | 'stopped' | 'disabled';
  live: boolean;
  enabled: boolean;
  pending: number;
  lastInvocationAt?: string;
  lastError?: string;
}

export interface BackendInvocation {
  invokeId: string;
  entrypoint: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  error?: string;
  dryRun: boolean;
  invokedBy: string;
  logs: BackendLogEntry[];
  dryRunEffects?: BackendDryRunEffect[];
}

export interface BackendDeclared { entryPoint: string; handlers: string[]; }

export interface ArtifactBackendStatusResponse {
  status: BackendStatus;
  declared: BackendDeclared | null;
  hasBackend: boolean;
}

export interface BackendInvokeResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  logs: BackendLogEntry[];
  dryRunEffects?: BackendDryRunEffect[];
}

export async function getArtifactBackendStatus(id: string): Promise<ApiResponse<ArtifactBackendStatusResponse>> {
  return wsAction<ArtifactBackendStatusResponse>('ekoa.artifact-backend', 'status', { id });
}

export async function getArtifactBackendLogs(id: string, limit?: number): Promise<ApiResponse<{ logs: BackendLogEntry[] }>> {
  return wsAction<{ logs: BackendLogEntry[] }>('ekoa.artifact-backend', 'logs', { id, limit });
}

export async function getArtifactBackendInvocations(id: string, limit?: number): Promise<ApiResponse<{ invocations: BackendInvocation[] }>> {
  return wsAction<{ invocations: BackendInvocation[] }>('ekoa.artifact-backend', 'invocations', { id, limit });
}

export async function setArtifactBackendEnabled(id: string, enabled: boolean): Promise<ApiResponse<{ enabled: boolean }>> {
  return wsAction<{ enabled: boolean }>('ekoa.artifact-backend', 'set-enabled', { id, enabled });
}

export async function runArtifactBackendSample(id: string, entrypoint: string, input: unknown): Promise<ApiResponse<{ result: BackendInvokeResult }>> {
  return wsAction<{ result: BackendInvokeResult }>('ekoa.artifact-backend', 'run-sample', { id, entrypoint, input });
}

export async function restoreBackupPoint(
  appId: string,
  point: BackupRestorePoint,
): Promise<ApiResponse<{ restored: number; cleared: number; safetyNetId: string }>> {
  return wsAction('ekoa.app-data-backups', 'restore', { appId, pointId: point.id, source: point.source, at: point.at });
}

// ============================================
// SESSIONS
// ============================================

export async function createSession(
  data?: { name?: string; type?: string; artifactInstanceId?: string; projectPath?: string }
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.sessions','create', data || {});
}

export async function getSession(sessionId: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.sessions','get', { sessionId });
}

export async function updateSession(
  sessionId: string,
  data: Record<string, unknown>
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.sessions','update', { sessionId, ...data });
}

export async function listSessions(): Promise<ApiResponse<unknown[]>> {
  return wsAction('ekoa.sessions','list');
}

export async function getSessionWithMessages(sessionId: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.sessions','get', { sessionId, includeMessages: true });
}

export async function addMessage(
  sessionId: string,
  data: { role: string; content: string; metadata?: Record<string, unknown> }
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.sessions','add-message', { sessionId, ...data });
}

export async function renameSession(
  sessionId: string,
  name: string
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.sessions','update', { sessionId, name });
}

/** Bump a session's `updatedAt` to now without changing anything else.
 *  Used when "new chat" reuses an existing empty session so the session
 *  jumps to the top of the recency-sorted sidebar list. The `update`
 *  intent always stamps `updatedAt`, so an empty patch is enough. */
export async function touchSession(
  sessionId: string,
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.sessions', 'update', { sessionId });
}

export async function getMessages(sessionId: string): Promise<ApiResponse<unknown[]>> {
  return wsAction('ekoa.sessions', 'get-messages', { sessionId });
}

export async function deleteSession(sessionId: string): Promise<ApiResponse<void>> {
  return wsAction('ekoa.sessions','delete', { sessionId });
}

// ============================================
// APPS (static serving)
// ============================================

/**
 * Build the static app URL for an artifact instance.
 * Apps are served at /apps/{app-id}/ by Cortex.
 */
export function getAppUrl(appId: string): string {
  return `${getApiBaseUrl()}/apps/${appId}/`;
}

/**
 * Append the auth token to an apps/ URL via `?token=` so cortex can verify
 * ownership when serving a non-shareable artifact preview. The app runtime
 * itself uses window.__EKOA_APP_ID + the __ekoa helper for data access; this
 * inline token is only consumed by the static-serving owner-check in
 * /apps/:appId. Cross-origin dev setups can't share the ekoa_token cookie,
 * so the query-string fallback is required.
 */
export function appendAuthTokenToUrl(url: string | null, token: string | null | undefined): string | null {
  if (!url) return url;
  if (!token) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

// ============================================
// AGENT CONFIG
// ============================================

// Agent config types
interface CentralizedAgentConfig {
  global?: {
    companyKnowledge?: string;
    instructions?: string;
    guardrails?: string[];
  };
  agents?: Record<string, AgentSpecificConfig>;
}

interface AgentSpecificConfig {
  companyKnowledge?: string;
  instructions?: string;
  guardrails?: string[];
}

export async function getAgentConfig(): Promise<ApiResponse<CentralizedAgentConfig>> {
  return wsAction('ekoa.agent-config','get');
}

export async function updateAgentConfig(data: {
  global?: {
    companyKnowledge?: string;
    instructions?: string;
    guardrails?: string[];
  };
  agents?: Record<string, Partial<AgentSpecificConfig>>;
}): Promise<ApiResponse<CentralizedAgentConfig>> {
  return wsAction('ekoa.agent-config','update', data);
}

// ============================================
// COMPANY KNOWLEDGE
// ============================================

// Company knowledge types
interface CompanyKnowledgeData {
  content?: string;
  updatedAt?: string;
}

interface CompanyFileMetadata {
  filename: string;
  size: number;
  mimeType?: string;
  uploadedAt?: string;
  description?: string;
}

export async function getCompanyKnowledge(): Promise<ApiResponse<CompanyKnowledgeData>> {
  return wsAction('ekoa.knowledge','get');
}

export async function updateCompanyKnowledge(
  content: string
): Promise<ApiResponse<CompanyKnowledgeData>> {
  return wsAction('ekoa.knowledge','update', { content });
}

export async function getCompanyKnowledgeFiles(): Promise<ApiResponse<{ files: CompanyFileMetadata[] }>> {
  return wsAction('ekoa.knowledge','list-files');
}

export async function uploadCompanyKnowledgeFile(
  file: File,
  description?: string
): Promise<ApiResponse<CompanyFileMetadata>> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    );

    return wsAction('ekoa.knowledge', 'upload-file', {
      filename: file.name,
      contentBase64: base64,
      mimeType: file.type,
      size: file.size,
      description,
    });
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'UPLOAD_ERROR',
        message: error instanceof Error ? error.message : 'Upload failed',
      },
    };
  }
}

export async function deleteCompanyKnowledgeFile(
  fileId: string
): Promise<ApiResponse<{ deleted: boolean }>> {
  return wsAction('ekoa.knowledge','delete-file', { fileId });
}

// ============================================
// TUNNEL (On-prem only)
// ============================================

export async function getTunnelConfig(): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.tunnel','get-config');
}

export async function configureTunnel(config: {
  tunnelId: string;
  accountId: string;
  apiToken: string;
  baseDomain: string;
}): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.tunnel','configure', config);
}

export async function startTunnel(): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.tunnel','start');
}

export async function stopTunnel(): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.tunnel','stop');
}

export async function getTunnelStatus(): Promise<ApiResponse<{ status: string }>> {
  return wsAction('ekoa.tunnel','status');
}

// ============================================
// ACTIVITY LOGS
// ============================================

export async function getActivityLogs(
  params?: ActivityLogQuery
): Promise<ApiResponse<ActivityLogResult>> {
  return wsAction('ekoa.activity','list', params || {});
}

// ============================================
// COMPANY SPACE (On-prem only)
// ============================================

export async function getCompanySpaceEntries(): Promise<ApiResponse<unknown[]>> {
  return wsAction('ekoa.company-space','list');
}

export async function startCompanySpaceEntry(
  artifactId: string
): Promise<ApiResponse<{ status: string; url?: string; deploymentId?: string }>> {
  return wsAction('ekoa.company-space','start', { artifactId });
}

export async function stopCompanySpaceEntry(
  artifactId: string
): Promise<ApiResponse<void>> {
  return wsAction('ekoa.company-space','stop', { artifactId });
}

// ============================================
// PROJECTS
// ============================================

export async function listProjects(options?: {
  includeArchived?: boolean;
  templateId?: string;
}): Promise<ApiResponse<ApiProject[]>> {
  return wsAction('ekoa.projects','list', options || {});
}

export async function getProject(id: string): Promise<ApiResponse<ApiProject>> {
  return wsAction('ekoa.projects','get', { id });
}

export async function createProject(data: Record<string, unknown>): Promise<ApiResponse<ApiProject>> {
  return wsAction('ekoa.projects','create', data);
}

export async function deleteProject(id: string): Promise<ApiResponse<void>> {
  return wsAction('ekoa.projects','delete', { id });
}

// ============================================
// CHAT
// ============================================

export async function sendChatMessage(
  data: { message: string; conversationHistory?: unknown[]; attachments?: unknown[] }
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.chat','send', data);
}

// ============================================
// MEMORY
// ============================================

export interface MemorySearchParamsAPI {
  type?: string;
  scope?: string;
  visibility?: string;
  tags?: string;  // comma-separated
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
}

export async function getMemories(params?: MemorySearchParamsAPI): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.memory','list', params || {});
}

export async function getMemory(id: string): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.memory','get', { id });
}

export async function createMemory(data: {
  type: string;
  title: string;
  content: string;
  tags?: string[];
  visibility?: string;
  scope?: string;
}): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.memory','create', data);
}

export async function updateMemory(
  id: string,
  data: {
    title?: string;
    content?: string;
    type?: string;
    tags?: string[];
    visibility?: string;
    scope?: string;
    verified?: boolean;
    tier?: 'core' | 'active' | 'archive';
  }
): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.memory','update', { id, ...data });
}

export async function deleteMemory(id: string): Promise<ApiResponse<void>> {
  return wsAction('ekoa.memory','delete', { id });
}

export async function bulkDeleteMemories(ids: string[]): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.memory','bulk-delete', { ids });
}

export async function submitMemorySignal(
  traceId: string,
  signal: 'positive' | 'negative',
): Promise<ApiResponse<{ affectedMemories: string[]; adjustedScores: Record<string, number> }>> {
  return wsAction('ekoa.memory', 'submit-signal', { traceId, signal });
}

export async function getMemoryTags(): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.memory','list-tags');
}

export async function getMemoryStats(): Promise<ApiResponse<unknown>> {
  return wsAction('ekoa.memory','stats');
}

// ============================================
// ARTIFACT FILES
// ============================================

export async function getArtifactFileContent(
  filePath: string
): Promise<{ success: true; data: string } | { success: false; error: { code: string; message: string } }> {
  try {
    const data = await getConnection().sendAction<string>('ekoa.templates', 'read-file', {
      filePath,
    });
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'FILE_READ_ERROR',
        message: error instanceof Error ? error.message : 'Failed to read file',
      },
    };
  }
}

// ============================================
// ARTIFACT FILES
// ============================================

export async function saveArtifactFileContent(
  filePath: string,
  content: string
): Promise<ApiResponse<{ path: string; size: number }>> {
  return wsAction('ekoa.templates','write-file', { filePath, content });
}

// ============================================
// AUTOMATIONS
// ============================================

import type {
  Automation,
  Step,
  AutomationInputField,
  RunRecord,
  AutomationCatalogEntry,
  IntegrationActionCatalogEntry,
} from '@/types/automation';

export interface PlanFromGoalSuccessResult {
  status: 'ok';
  name: string;
  description: string;
  inputSchema?: { fields: AutomationInputField[] };
  steps: Step[];
  reasoning: string;
}
export interface PlanFromGoalAwaitingResult {
  status: 'awaiting_integration';
  service: string;
  reason: string;
}
export type PlanFromGoalResult = PlanFromGoalSuccessResult | PlanFromGoalAwaitingResult;

export async function listAutomations(): Promise<ApiResponse<{ automations: Automation[] }>> {
  return wsAction('ekoa.automations', 'list');
}

export async function getAutomation(id: string): Promise<ApiResponse<{ automation: Automation }>> {
  return wsAction('ekoa.automations', 'get', { id });
}

export async function createAutomation(data: {
  name: string;
  description?: string;
  steps?: Step[];
  inputSchema?: { fields: AutomationInputField[] };
  id?: string;
}): Promise<ApiResponse<{ automation: Automation }>> {
  return wsAction('ekoa.automations', 'create', data);
}

export async function updateAutomation(
  id: string,
  patch: Partial<Pick<Automation, 'name' | 'description' | 'steps' | 'inputSchema'>>,
): Promise<ApiResponse<{ automation: Automation }>> {
  return wsAction('ekoa.automations', 'update', { id, ...patch });
}

export async function deleteAutomation(id: string): Promise<ApiResponse<{ deleted: string }>> {
  return wsAction('ekoa.automations', 'delete', { id });
}

export async function planAutomationFromGoal(
  goal: string,
  name?: string,
  automationId?: string,
): Promise<ApiResponse<{
  plan: PlanFromGoalResult;
  automation?: Automation;
  traceId?: string;
  rehearsing?: boolean;
}>> {
  return wsAction('ekoa.automations', 'plan-from-goal', {
    goal,
    ...(name ? { name } : {}),
    ...(automationId ? { automationId } : {}),
  });
}

export async function runAutomation(
  id: string,
  inputs?: Record<string, unknown>,
  traceId?: string,
): Promise<ApiResponse<{ traceId: string; accepted: boolean }>> {
  return wsAction('ekoa.automations', 'run', {
    id,
    inputs: inputs ?? {},
    ...(traceId ? { traceId } : {}),
  });
}

export async function resumeAutomationRun(traceId: string): Promise<ApiResponse<{ resumed: boolean }>> {
  return wsAction('ekoa.automations', 'resume-run', { traceId });
}

export async function cancelAutomationRun(traceId: string): Promise<ApiResponse<{ cancelled: boolean }>> {
  return wsAction('ekoa.automations', 'cancel-run', { traceId });
}

export async function listAutomationRuns(
  automationId?: string,
  limit?: number,
): Promise<ApiResponse<{ runs: RunRecord[] }>> {
  return wsAction('ekoa.automations', 'list-runs', {
    ...(automationId ? { automationId } : {}),
    ...(limit ? { limit } : {}),
  });
}

export async function getAutomationRun(
  automationId: string,
  runId: string,
): Promise<ApiResponse<{ run: RunRecord }>> {
  return wsAction('ekoa.automations', 'get-run', { automationId, runId });
}

export async function submitAutomationStepFeedback(input: {
  automationId: string;
  runId: string;
  stepId: string;
  kind: 'thumbs_up' | 'thumbs_down' | 'correction';
  note?: string;
}): Promise<ApiResponse<{ ok: boolean; evicted?: { actionsRemoved: number; assertionsRemoved: number } }>> {
  return wsAction('ekoa.automations', 'submit-step-feedback', input);
}

export async function listAutomationCatalog(): Promise<
  ApiResponse<{ automations: AutomationCatalogEntry[]; integrationActions: IntegrationActionCatalogEntry[] }>
> {
  return wsAction('ekoa.automations', 'list-catalog');
}

export async function resolveAutomationConsent(input: {
  traceId: string;
  decision: 'once' | 'always' | 'stop';
  shape: string;
}): Promise<ApiResponse<{ resumed?: boolean; stopped?: boolean; decision?: string }>> {
  return wsAction('ekoa.automations', 'resolve-consent', input);
}

export interface ApprovedLocalCommand {
  shape: string;
  approvedAt: string;
  lastUsedAt?: string;
  note?: string;
}

export async function listApprovedCommands(): Promise<ApiResponse<{ approved: ApprovedLocalCommand[] }>> {
  return wsAction('ekoa.automations', 'list-approved-commands');
}

export async function revokeApprovedCommand(shape: string): Promise<ApiResponse<{ revoked: boolean; remaining: number }>> {
  return wsAction('ekoa.automations', 'revoke-approved-command', { shape });
}

