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
  /** WS6 (build-intent inference, DO #4): the artifact type the scoping classifier most
   *  recently decided for a build in this session - persisted alongside the per-artifact
   *  verdict so a follow-up chat turn (before or after the artifact exists) has something to
   *  agree with, and so the decision is inspectable outside the per-build audit log. Internal
   *  only - never carried on the wire `Session` schema (shared/src/sessions.ts), same posture
   *  as `lastContext` below. */
  lastArtifactType?: string;
  /** The last persisted `<ekoa-context>` block (§5.6.1 step 6) - carried ad hoc (see
   *  agents/persistence.ts / agents/context.ts), never modeled on the wire `Session` schema. */
  lastContext?: string;
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
  /** Per-event usage amounts, keys reusing the metering counter names VERBATIM (A5 vocabulary
   *  memo rule 3): the ledger and the activity row never invent two names for one quantity
   *  (e.g. voice.turn -> { voice_stt_ms }, voice.tts -> { voice_tts_chars }). */
  usageCounts?: Record<string, number>;
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
/** Tenant-scoped integration DEFINITION store (slice A1). The private-by-default, org/global-tiered
 *  home for integration package definitions — the additive storage foundation A2 rewires the
 *  file-based registry (integrations/definitions.ts) onto. Untyped `Store<Doc>` here, exactly like
 *  its sibling `integrationConfigs`; the typed document shape (`IntegrationDefinitionDoc`) and the
 *  actor-scoped resolver live in integrations/definition-store.ts, which WRAPS this collection. */
export const integrationDefinitions = new Store<Doc>('integration_definitions');
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
/**
 * Non-token usage ledger (mega-run C2; BRIEF §5 "Shared surface" - one coherent schema).
 * The append-only sibling of `token_events` for quantities that are NOT tokens and are NEVER
 * converted into the token meter: today the voice counters (`voice_stt_ms`, `voice_tts_chars`),
 * per org per session as separate counters. One doc per (source, session), `_id` =
 * `<source>:<orgId>:<sessionId>`; `counters` is an open map keyed by the canonical counter names, so
 * Part D's assistant-turn metering (D6) extends this by adding a counter key under its own
 * `source` - a new counter never needs a new collection, a migration, or a new ledger concept.
 * Written ONLY by `billing/tracker.ts` (`recordUsageCounters`, the single metering writer).
 */
export interface UsageEventDoc extends Doc {
  orgId: string;
  /** Attributed user (from the verified token), mirroring token_events' billee naming. */
  billeeUserId: string;
  sessionId: string;
  /** Which product surface produced the usage: 'voice' today; D6 adds its own. */
  source: string;
  /** Canonical counter name -> integer amount, e.g. { voice_stt_ms, voice_tts_chars }. */
  counters: Record<string, number>;
  timestamp: number;
}
export const usageEvents = new Store<UsageEventDoc>('usage_events');
export const billingAccounts = new Store<Doc>('billing_accounts');
export const automations = new Store<Doc>('automations');
export const automationRuns = new Store<Doc>('automation_runs');
/**
 * Idempotent run-create mapping (slice E4). `_id` IS the sha256 hex of
 * `<automationId>|<runOwnerUserId>|<idempotencyKey>` — the SAME deterministic-`_id` insert
 * pattern the gateway-keys store uses (§4.3.2: no unique indexes anywhere; the duplicate-key
 * refusal from `insert` IS the uniqueness primitive). The mapping is written BEFORE the run is
 * created, so two concurrent POSTs with the same key race on this single-document insert and the
 * loser reads the winner's `runId` instead of starting a second run.
 *
 * The row is intentionally tiny: it carries no inputs and no key material (the caller's key is
 * only ever hashed into the `_id`, never stored).
 *
 * RETENTION IS UNBOUNDED TODAY, DELIBERATELY (E4 review, hardening 6). Nothing reads or reaps
 * `at`; a row lives forever. The trade accepted here: a row is ~120 bytes and is written ONLY by a
 * client that sends an idempotency key (the dashboard sends none, so the platform's own traffic
 * writes zero rows), which puts a heavy API consumer at single-digit MB per million keyed creates.
 * Reaping is NOT free correctness — deleting a mapping re-arms the key, so a retry that arrives
 * after the reap starts a SECOND run. Any future reaper must therefore key on `at` with a window
 * comfortably longer than a client would keep retrying (days, not hours) and must be introduced
 * with that risk stated, not as a silent cleanup job.
 *
 * The SYMMETRIC warning, for whoever takes up RUN retention: the wire contract tells a client
 * that a 404 from the GET after a 200 replay means "POST again with the same key". That loop
 * terminates only because nothing deletes runs today (there is no automationRuns delete path in
 * api/src). Add a run reaper or a delete endpoint and the mapping outlives the run it names, so
 * every retry returns the same dead runId and the documented loop never converges. Reaping runs
 * therefore requires reaping their mappings in the same sweep, or changing that contract line.
 */
export interface RunIdempotencyDoc extends Doc {
  /** The run the FIRST accepted call minted for this key. */
  runId: string;
  /** ISO timestamp of that first acceptance. The reap key IF a reaper is ever added — see the
   *  retention note above; nothing reads this today. */
  at: string;
}
export const automationRunIdempotency = new Store<RunIdempotencyDoc>('automation_run_idempotency');
export const approvedCommands = new Store<Doc>('approved_commands');
/**
 * Durable human approvals for MUTATING integration actions (slice C2, the write gate).
 *
 * The sibling of `approved_commands`, for the other thing this platform does on a user's behalf
 * without a human watching: `approved_commands` answers "may this command shape run on your
 * machine", this one answers "may this integration action WRITE to your account". Same tested
 * shape — org+user scoped, TTL'd, fail-closed on a missing/expired row — with the third scope
 * component being the action's own SHAPE (integrations/action-consent.ts) rather than a command
 * shape, so re-authoring an action does not inherit the approval the human gave the old one.
 *
 * A separate collection rather than a discriminated column on `approved_commands`: the two are
 * read on different rails, by different tiers (automation/ vs integrations/), and a shared
 * collection would put a lookup for one on the same key space as the other for no gain.
 */
export const approvedIntegrationActions = new Store<Doc>('approved_integration_actions');
export const triggers = new Store<Doc>('triggers');
export const appSessions = new Store<Doc>('app_sessions');
export const appSsoPending = new Store<Doc>('app_sso_pending');
export const adobeAgreements = new Store<Doc>('adobe_agreements');
/** Reverse index: Zoho Sign requestId (`_id`) -> the ERP proposal (+ owning app/user)
 *  that created it. Sibling of `adobe_agreements` (Zoho replaced Adobe on the SALOMAO
 *  ERP). Written at send time, read by the inbound `/api/zoho-sign/webhook` handler to
 *  route a signature event back to the exact app + `propostas` record and to pick the
 *  owner-scoped credentials for the authenticity re-fetch. Tiny + non-sensitive (no
 *  credentials); rides the ch10 migration passthrough (import-tool.ts) verbatim. The
 *  typed record/find helpers live in integrations/sign-agreements.ts. */
export const zohoAgreements = new Store<Doc>('zoho_agreements');
export const knowledgeSources = new Store<Doc>('knowledge_sources');
export const knowledgeUploads = new Store<Doc>('knowledge_uploads');
export const anonymisationDenyLists = new Store<Doc>('anonymisation_deny_lists');
export const bridgePairings = new Store<Doc>('bridge_pairings');
/** Per-tenant-per-machine capability grants (Cofre I-3). Advertisement says what a machine CAN do;
 *  a row here is the org saying what it MAY be used for. Default deny: no row, no capability. */
export const bridgeCapabilityGrants = new Store<Doc>('bridge_capability_grants');
export const eventQueue = new Store<Doc>('event_queue');
export const webhookAudit = new Store<Doc>('webhook_audit');
/** Per-listener poll state (2A-S1): one row per `kind:'listener'` trigger (`_id` = triggerId),
 *  holding the durable poll cursor / high-water mark plus a failure counter. The generic listener
 *  runtime (events/listener-state.ts) owns the typed accessors; the supervisor advances the cursor
 *  ONLY after every polled item is durably enqueued, so a crash re-polls rather than drops. */
export const listenerState = new Store<Doc>('listener_state');
/** Per-action completeness-verification state (slice CS3): one row per
 *  `(orgId, integrationKey, actionKey)` (`_id` = `sha256(JSON.stringify([orgId, integrationKey, actionKey]))`,
 *  holding the durable watermark, the bounded seen-set, and the incomplete/failure streaks. The
 *  two-pass orchestrator (events/verified-sync.ts) owns the discipline; the typed accessors live in
 *  events/sync-state.ts, which WRAPS this collection (mirrors listenerState/listener-state.ts).
 *  Untyped `Store<Doc>` here — the typed `SyncStateDoc` lives in events/ (a higher tier than data/). */
export const syncState = new Store<Doc>('sync_state');
/** Capped per-key history of `SyncRunReport`s (slice CS3): the audit trail of every verified-sync
 *  run (`_id` = the report id; `stateKey` indexes back to the syncState row). Written + pruned by
 *  events/sync-state.ts's `persistSyncReport`. Untyped `Store<Doc>` (the report shape is the shared
 *  contract in shared/src/sync.ts). */
export const syncReports = new Store<Doc>('sync_reports');
