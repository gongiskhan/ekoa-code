/**
 * Platform domain stores (ch04 §4.3.1). Every store is a `Store<T>` over one physical
 * Mongo collection. Names and tenancy carried from the §4.3.1 map. The `teams` store is
 * DROPPED (Amendment 2); the dual app-data backend selector is not carried (§4.2.8) —
 * Firestore Mongo-compat is the only backend.
 */
import { Store, type Doc } from './store.js';

// --- Core identity / tenancy ---
export interface UserDoc extends Doc {
  username: string;
  passwordHash: string;
  role: 'super-admin' | 'org-admin' | 'builder';
  orgId: string;
  active: boolean;
  passwordChangeRequired?: boolean;
  preferences?: Record<string, unknown>;
}
export interface OrgDoc extends Doc {
  name: string;
  displayName?: string;
  branding?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  createdAt: string;
  /** Stamped by updateOrg on every patch — the web's re-sync fingerprint (a branding page left
   *  open must pick up a research merge without a reload; live 2026-07-12). */
  updatedAt?: string;
}
export interface CredentialsDoc extends Doc {
  // singleton _id: 'default'
  credentialCiphertext?: string;
  mode: 'oauth' | 'api-key';
  refreshMeta?: Record<string, unknown>;
}
export interface RevokedTokenDoc extends Doc {
  userId: string;
  revokedAt: string;
  expiresAt: number; // epoch seconds
}
export interface SessionDoc extends Doc {
  userId: string;
  /** Store-side name (ch04 §4.3.1 carries `title`); the wire field is `name` (ch03 §3.8.6). */
  title?: string;
  type?: string;
  artifactId?: string;
  status?: string;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}
export interface ActivityLogDoc extends Doc {
  userId: string;
  username: string;
  orgId: string;
  category: string;
  type: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
export interface SettingsDoc extends Doc {
  [k: string]: unknown;
}
export interface UserSettingsDoc extends Doc {
  build?: { verifyBuilds?: boolean };
  memory?: { autoExtract?: boolean };
  [k: string]: unknown;
}

export const users = new Store<UserDoc>('users');
export const orgs = new Store<OrgDoc>('orgs');
export const credentials = new Store<CredentialsDoc>('credentials');
export const revokedTokens = new Store<RevokedTokenDoc>('revoked_tokens');
export const sessions = new Store<SessionDoc>('sessions');
export const messages = new Store<Doc>('messages');
export const sessionContexts = new Store<Doc>('session_contexts');
export const memories = new Store<Doc>('memories');
export const artifacts = new Store<Doc>('artifacts');
export const slugs = new Store<Doc>('slugs');
export const integrationConfigs = new Store<Doc>('integration_configs');
/** Integration-builder chat sessions (ch03 §3.8.14). PERSISTED — the old cortex builder kept an
 *  in-memory Map that died on restart; load-by-key durability requires a store. Holds the running
 *  transcript + the last generated package/skill so a session can be reloaded and edited. */
export const integrationBuilderSessions = new Store<Doc>('integration_builder_sessions');
export const activityLogs = new Store<ActivityLogDoc>('activity_logs');
export const jobs = new Store<Doc>('jobs');
export const settings = new Store<SettingsDoc>('settings');
export const userSettings = new Store<UserSettingsDoc>('user_settings');
export const tokenEvents = new Store<Doc>('token_events');
export const billingAccounts = new Store<Doc>('billing_accounts');
export const automations = new Store<Doc>('automations');
export const automationRuns = new Store<Doc>('automation_runs');
export const approvedCommands = new Store<Doc>('approved_commands');
export const triggers = new Store<Doc>('triggers');
export const appSessions = new Store<Doc>('app_sessions');
export const appSsoPending = new Store<Doc>('app_sso_pending');
export const adobeAgreements = new Store<Doc>('adobe_agreements');
export const knowledgeSources = new Store<Doc>('knowledge_sources');
export const knowledgeUploads = new Store<Doc>('knowledge_uploads');
export const anonymisationDenyLists = new Store<Doc>('anonymisation_deny_lists');
export const bridgePairings = new Store<Doc>('bridge_pairings');
export const eventQueue = new Store<Doc>('event_queue');
export const webhookAudit = new Store<Doc>('webhook_audit');
