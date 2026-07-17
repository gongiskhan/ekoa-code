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
  role: 'super-admin' | 'org-admin' | 'user';
  orgId: string;
  active: boolean;
  passwordChangeRequired?: boolean;
  /** Durable revocation clock (unix seconds): a token whose `iat` is earlier than this is invalid.
   *  Bumped on EVERY revocation (role change, password change/reset, admin logout, deactivation, the
   *  builder→user migration) and written to the row in the SAME operation as the in-memory
   *  `bumpTokenEpoch`. Persisted here because `loadActivation` reloads the activation map from these
   *  rows at boot — without the column every revocation silently un-does on the next restart (H1). */
  tokenEpoch?: number;
  /** Durable account-level billing lock. Persisted (and boot-reloaded via `loadActivation`) so a
   *  lock is not reset to `false` on every process restart — the in-memory activation map alone
   *  defaulted it to `false` at boot (H1; the carried LANDING billing-lock item). */
  billingLocked?: boolean;
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
/** One revision of a session sheet (Part B decision B.B). Subdocument - carries no _id;
 *  the stored shape IS the wire shape (shared/src/sheets.ts SheetRevision). */
export interface SheetRevisionDoc {
  revisionId: string;
  /** Markdown body of the sheet at this revision. */
  content: string;
  createdAt: string;
  /** Username of the editor (user edits only). */
  editedBy?: string;
  editSource: 'agent' | 'user';
  /** The edit instruction that produced this revision (user edits). */
  instruction?: string;
}
/** A sheet persisted as a SUBDOCUMENT on the session record (Part B decision B.B - no new
 *  collection). Ordered revisions, oldest first; the last is canonical. */
export interface SessionSheetDoc {
  sheetId: string;
  title: string;
  createdFromMessageId: string;
  revisions: SheetRevisionDoc[];
}
export interface SessionDoc extends Doc {
  userId: string;
  /** Store-side name (ch04 §4.3.1 carries `title`); the wire field is `name` (ch03 §3.8.6). */
  title?: string;
  type?: string;
  artifactId?: string;
  status?: string;
  messageCount?: number;
  /** Sheets as subdocuments (Part B decision B.B). ABSENT on legacy sessions - readers derive
   *  a one-sheet-per-assistant-message view at read time instead (data/session-sheets.ts);
   *  a write against a derived sheet materialises it here first. No backfill. */
  sheets?: SessionSheetDoc[];
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
/** Change-requests queue (operator-run H4). A user's request to change a served app; the app
 *  OWNER's org-admins read + convert it. `orgId` is the isolation boundary (owner org for a
 *  served-app filing, the requester's own org for a dashboard refused-build filing) — always
 *  stamped server-side, never from the caller's body. `appId`/`route`/`screenState` are absent
 *  for a refused first-build filing. `jobId` is set when an admin converts it into a patch run. */
export interface ChangeRequestDoc extends Doc {
  appId?: string;
  orgId: string;
  requesterUserId: string;
  requesterName: string;
  route?: string;
  screenState?: string;
  text: string;
  status: 'open' | 'converted' | 'dismissed';
  createdAt: string;
  jobId?: string;
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

/** Per-user LLM-gateway API key (S4a, run 20260717). `_id` IS the sha256 hex of the secret:
 *  O(1) verification via `get`, duplicate-insert safety from `insert`, and the hash of a
 *  256-bit random secret is safe to expose as the public key id. The plaintext secret is
 *  NEVER stored (returned once at mint). */
export interface GatewayKeyDoc extends Doc {
  ownerUserId: string;
  /** Stamped at mint so key verification never needs a users lookup for the Registo actor. */
  ownerUsername: string;
  orgId: string;
  label: string;
  /** Last 4 chars of the secret - the UI renders 'ekoa_gk_...abcd'. */
  secretHint: string;
  createdAt: string;
  revokedAt?: string;
  /** Throttled anomaly surface (at most one write per key per minute). */
  lastUsedAt?: string;
  /** Optional per-key cap overrides; absent => the EKOA_RATECAP_*_PER_KEY defaults. */
  caps?: { maxCallsPerWindow?: number; maxSpendPerWindow?: number };
}
export const gatewayKeys = new Store<GatewayKeyDoc>('gateway_keys');
export const changeRequests = new Store<ChangeRequestDoc>('change_requests');
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
