/**
 * agents/ injected seams (ch02 §2.8; ch05 §5.5.1, §5.6.2). Two of `agents/`'s collaborators —
 * the content loader (ch08 `assembleAgentContext`) and the knowledge grounding-block builder
 * (ch08 §8.4 slot 5) — are still stubs owned by other build slices, and the per-build
 * verification runner (ch07 §7.2.6) is an `apps/`/playwright concern. `agents/` codes against
 * these typed seams and the composition root wires the real implementations, so this module
 * never imports an unbuilt export and the direction rules hold.
 *
 * Each seam has a safe, honest default: an empty context / no grounding / a no-op verifier that
 * reports "not run". A missing collaborator degrades gracefully, never crashes a run.
 */
import type { Actor } from '@ekoa/shared';

// --- Content loader (ch05 §5.5.1, ch08) --------------------------------------------------

export interface AgentContext {
  /** Per-user composition directory the SDK is pointed at. */
  contextDir: string;
  /** Ordered system-prompt sections from agent-context content. */
  promptSections: string[];
  /** Content-addressed cache key, for audit/event payloads. */
  contentVersion: string;
}

export type AssembleAgentContext = (input: {
  agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder';
  userId: string;
}) => Promise<AgentContext>;

const defaultAssembleAgentContext: AssembleAgentContext = async () => ({
  contextDir: '',
  promptSections: [],
  contentVersion: 'none',
});
let assembleAgentContextFn: AssembleAgentContext = defaultAssembleAgentContext;
export function setAssembleAgentContext(fn: AssembleAgentContext): void {
  assembleAgentContextFn = fn;
}
export function assembleAgentContext(input: { agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder'; userId: string }): Promise<AgentContext> {
  return assembleAgentContextFn(input);
}

// --- Knowledge grounding block (ch05 §5.5.2 layer 2, ch08 §8.4 slot 5) --------------------

export interface KnowledgeGroundingInput {
  userId: string;
  orgId: string;
  query: string;
  /** chat runs always ground; builds only when the legal-context detector matches. */
  agentKind: 'chat' | 'coding' | 'automation';
}

/** Returns the cited-or-silent grounding block, or '' when nothing grounds. */
export type KnowledgeGroundingFn = (input: KnowledgeGroundingInput) => Promise<string>;

const defaultKnowledgeGrounding: KnowledgeGroundingFn = async () => '';
let knowledgeGroundingFn: KnowledgeGroundingFn = defaultKnowledgeGrounding;
export function setKnowledgeGrounding(fn: KnowledgeGroundingFn): void {
  knowledgeGroundingFn = fn;
}
export function knowledgeGrounding(input: KnowledgeGroundingInput): Promise<string> {
  return knowledgeGroundingFn(input);
}

// --- Mid-build knowledge ingest (F1 knowledge-during-build) -------------------------------

/** A scoping-provided document the build persists into the org knowledge area DURING a run. */
export interface BuildKnowledgeDoc {
  collection: string;
  title: string;
  text: string;
  /** Marks the doc as build-originated (default at the binding: `build-scoping`). */
  sourceType?: string;
  language?: string;
}

/**
 * Persist a scoping-provided document into the org knowledge area during a build. The orgId rides
 * the run's actor (org-scoped BY CONSTRUCTION - never a tool/request argument), and the real
 * binding forwards to the knowledge service's `ingestDocument`, which refuses the reserved
 * `_shared` partition (assertNotSharedActor) and indexes the doc immediately (searchable to the
 * run's knowledge tools with no rebuild/optimize). Honest default: an unwired root ingests nothing
 * and returns an empty id, so the build narrates no false "indexed" confirmation.
 */
export type IngestBuildKnowledgeFn = (
  actor: Actor,
  doc: BuildKnowledgeDoc,
  deps: { now: () => number; genId: () => string },
) => Promise<{ id: string }>;
const defaultIngestBuildKnowledge: IngestBuildKnowledgeFn = async () => ({ id: '' });
let ingestBuildKnowledgeFn: IngestBuildKnowledgeFn = defaultIngestBuildKnowledge;
export function setIngestBuildKnowledge(fn: IngestBuildKnowledgeFn): void {
  ingestBuildKnowledgeFn = fn;
}
export function ingestBuildKnowledge(
  actor: Actor,
  doc: BuildKnowledgeDoc,
  deps: { now: () => number; genId: () => string },
): Promise<{ id: string }> {
  return ingestBuildKnowledgeFn(actor, doc, deps);
}

// --- In-process MCP knowledge tools (ch05 §5.4.4) -----------------------------------------

/** A search hit the `knowledge_search` tool cites (docId + collection locate it for a read). */
export interface KnowledgeToolHit {
  docId: string;
  collection: string;
  title: string;
  sourceUrl: string;
  snip: string;
}

/** Org-partitioned search behind the `knowledge_search` tool. The orgId comes from the run's
 *  actor — NEVER from tool arguments — so cross-org search is impossible by construction. */
export type KnowledgeToolSearchFn = (input: { orgId: string; query: string; limit?: number }) => Promise<KnowledgeToolHit[]>;
const defaultKnowledgeToolSearch: KnowledgeToolSearchFn = async () => [];
let knowledgeToolSearchFn: KnowledgeToolSearchFn = defaultKnowledgeToolSearch;
export function setKnowledgeToolSearch(fn: KnowledgeToolSearchFn): void {
  knowledgeToolSearchFn = fn;
}
export function knowledgeToolSearch(input: { orgId: string; query: string; limit?: number }): Promise<KnowledgeToolHit[]> {
  return knowledgeToolSearchFn(input);
}

/** Org-partitioned document read behind the `knowledge_read` tool (same actor-owned orgId rule). */
export type KnowledgeToolReadFn = (input: { orgId: string; collection: string; docId: string }) => Promise<{ title: string; sourceUrl: string; body: string } | null>;
const defaultKnowledgeToolRead: KnowledgeToolReadFn = async () => null;
let knowledgeToolReadFn: KnowledgeToolReadFn = defaultKnowledgeToolRead;
export function setKnowledgeToolRead(fn: KnowledgeToolReadFn): void {
  knowledgeToolReadFn = fn;
}
export function knowledgeToolRead(input: { orgId: string; collection: string; docId: string }): Promise<{ title: string; sourceUrl: string; body: string } | null> {
  return knowledgeToolReadFn(input);
}

// --- On-demand agent-context content (ch05 §5.4.4 build row; ch08 on-demand files) ---------

/** The `load_context` tool: fetch a named on-demand content file from the user's composed
 *  agent context. Returns null when no such package/file exists (an honest not-found). */
export type LoadContextContentFn = (input: { userId: string; agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder'; name: string }) => Promise<string | null>;
const defaultLoadContextContent: LoadContextContentFn = async () => null;
let loadContextContentFn: LoadContextContentFn = defaultLoadContextContent;
export function setLoadContextContent(fn: LoadContextContentFn): void {
  loadContextContentFn = fn;
}
export function loadContextContent(input: { userId: string; agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder'; name: string }): Promise<string | null> {
  return loadContextContentFn(input);
}

// --- Integration pre-fetch (ch05 §5.5.2 layer 3, chat only) -------------------------------

/** Live Google/Microsoft data pre-fetched into the system prompt on keyword hits, with a 60 s
 *  cache. Owned by `integrations/`; wired at the root. Returns '' when nothing pre-fetches. */
export type IntegrationPrefetchFn = (input: { userId: string; message: string }) => Promise<string>;
const defaultIntegrationPrefetch: IntegrationPrefetchFn = async () => '';
let integrationPrefetchFn: IntegrationPrefetchFn = defaultIntegrationPrefetch;
export function setIntegrationPrefetch(fn: IntegrationPrefetchFn): void {
  integrationPrefetchFn = fn;
}
export function integrationPrefetch(input: { userId: string; message: string }): Promise<string> {
  return integrationPrefetchFn(input);
}

/** The cross-agent catalog of automations + integration actions (§5.5.2 layer 4). Non-fatal:
 *  a build failure returns '' and never fails the run. */
export type CatalogFn = (input: { userId: string; orgId: string }) => Promise<string>;
const defaultCatalog: CatalogFn = async () => '';
let catalogFn: CatalogFn = defaultCatalog;
export function setCatalog(fn: CatalogFn): void {
  catalogFn = fn;
}
export function catalog(input: { userId: string; orgId: string }): Promise<string> {
  return catalogFn(input);
}

// --- Local-bridge delegation tool (ch05 §5.4.8; ch18 §18.2) --------------------------------

/** The delegating principal: the run's owner + the hosted conversation id (ch18 §18.4.3 vault
 *  key). Both bind from the run's actor at spec-build time — NEVER from tool arguments. */
export interface DelegationToolActor {
  userId: string;
  sessionId: string;
}

/** The §18.2.1 tool arguments: an opaque task program, pass-through grant refs (Cortex never
 *  resolves or widens them — S1), and the egress/model budget. */
export interface DelegationToolRequest {
  task: string;
  grantRefs: string[];
  budget: { egressBytes: number; modelSpend: { userId: string } };
}

/** Derived output only (§18.2.2): summary, citations, patch proposals, ledger refs — raw local
 *  file content never crosses this seam. Structurally matches shared/'s DelegationResult. */
export interface DelegationToolResult {
  status: 'ok' | 'unreachable' | 'cap_reached' | 'denied';
  answer?: string;
  citations: { path: string; range: string }[];
  patches?: { path: string; diff: string }[];
  ledgerRefs: string[];
  telemetry: { egressBytes: number; maskedCounts: Record<string, number> };
}

export type DelegateToLocalFn = (actor: DelegationToolActor, req: DelegationToolRequest) => Promise<DelegationToolResult>;

/** Honest default: an unwired root means no bridge — offline is `unreachable`, and there is no
 *  degrade-to-upload anywhere (§18.2.3, invariant I1). */
const defaultDelegateToLocal: DelegateToLocalFn = async () => ({
  status: 'unreachable',
  citations: [],
  ledgerRefs: [],
  telemetry: { egressBytes: 0, maskedCounts: {} },
});
let delegateToLocalFn: DelegateToLocalFn = defaultDelegateToLocal;
export function setDelegateToLocal(fn: DelegateToLocalFn): void {
  delegateToLocalFn = fn;
}
export function delegateToLocalTool(actor: DelegationToolActor, req: DelegationToolRequest): Promise<DelegationToolResult> {
  return delegateToLocalFn(actor, req);
}

// --- Local-activity sources (run s5, FC-402; ch18 §18.2/§18.6) -----------------------------

/** The two joins behind the per-turn trust chip: the bounded in-memory ledger-row buffer
 *  (bridge/activity-buffer, wired at the root) and the anon-audit mask counts by correlation
 *  id (§17.6, via the services read). Defaults are honest empties: no buffer wired means the
 *  chip simply does not render — never invented numbers. */
export interface LocalActivitySources {
  /** Buffered daemon ledger rows for a session, narrowed to the turn's correlation ids. */
  ledgerRows(session: string, correlationIds?: string[]): Array<{ path: string; byteRange: string; bytesOut: number; correlationId: string }>;
  /** Mask counts by entity class for the turn's correlation ids (audit-join). */
  maskedCounts(orgId: string, correlationIds: string[]): Promise<Record<string, number>>;
}

const defaultLocalActivitySources: LocalActivitySources = {
  ledgerRows: () => [],
  maskedCounts: async () => ({}),
};
let localActivitySources: LocalActivitySources = defaultLocalActivitySources;
export function setLocalActivitySources(s: LocalActivitySources): void {
  localActivitySources = s;
}
export function getLocalActivitySources(): LocalActivitySources {
  return localActivitySources;
}

// --- Per-build verification runner (ch05 §5.6.2 step 5, ch07 §7.2.6) ----------------------

export interface VerifyRunInput {
  artifactId: string;
  projectDir: string;
  appUrl: string;
  userId: string;
  /** first build → full acceptance pass; follow-up → scoped tests + smoke pass. */
  depth: 'full' | 'scoped';
  /** The user's build request (F28): the verifier asserts request-FULFILMENT — the served DOM is
   *  not the Ekoa scaffold placeholder and the requested interactive elements exist — not merely
   *  that "something renders". */
  request: string;
  /** Live working-commentary hook: the runner forwards the verify agent's narration chunks so
   *  the build pipeline can stream them to the user (the verify stage used to be a silent
   *  multi-minute void). Raw model text — the CALLER owns marker-filtering + identity redaction. */
  onProgress?: (text: string) => void;
}

export interface VerifyRunResult {
  ran: boolean;
  /** Only a real ran+passed verification sets this true; a not-run is a distinct non-passing
   *  state (honest not-run, never a fake pass — ch07 §7.2.6). */
  passed: boolean;
  /** The honest user-visible note appended to `complete` when the stage did not cleanly pass —
   *  a failure it could not fix, or an honest not-run (e.g. credential-skip). Never fails the build. */
  note?: string;
}

/** The playwright-cli medium-depth verification agent (ch07 owns the mechanics). Its model
 *  calls are attributed `user_work` `build-verify` inside the runner (ch06 6.4.1 row A2). */
export type VerifyRunnerFn = (input: VerifyRunInput) => Promise<VerifyRunResult>;
const defaultVerifyRunner: VerifyRunnerFn = async () => ({ ran: false, passed: false });
let verifyRunnerFn: VerifyRunnerFn = defaultVerifyRunner;
export function setVerifyRunner(fn: VerifyRunnerFn): void {
  verifyRunnerFn = fn;
}
export function verifyRunner(input: VerifyRunInput): Promise<VerifyRunResult> {
  return verifyRunnerFn(input);
}

// --- Build mechanics (ch07 §7.2; the apps/ build pipeline, wired at the root) -------------

export interface FirstBuildPrep {
  artifactId: string;
  projectDir: string;
  slug: string;
  appUrl: string;
  /** Prompt sections of the selected internal base (operator-run B1) — the base's
   *  instructions/skills/layouts markdown, injected into the build system prompt.
   *  Absent when the build scaffolds from the generic starters. */
  basePromptSections?: string[];
}

export interface FollowUpResolution {
  projectDir: string;
  /** The SDK session id to resume with (§5.4.5). */
  resumeSessionId?: string;
  /** The artifact's existing slug + served URL. Follow-up completion re-activates the artifact
   *  with these — pre-fix, build.ts carried '' through and blanked the slug on every follow-up. */
  slug: string;
  appUrl: string;
  /** Prompt sections of the artifact's base (manifest `extends`, operator-run B1), so
   *  follow-up builds keep the base conventions in the system prompt. Absent when the
   *  artifact extends no base (or the base fails to load — non-fatal, logged). */
  basePromptSections?: string[];
}

/**
 * The heavy ch07 build mechanics `agents/` invokes but does not own: scaffold + first-build
 * artifact creation, final-bundle, version snapshot, screenshot, artifact activation, and the
 * sdkSessionId persistence. `apps/` implements these at the composition root; the defaults are
 * honest no-ops so the lifecycle + guards are testable without the real esbuild pipeline.
 */
export interface BuildMechanics {
  prepareFirstBuild(input: { userId: string; sessionId: string; description: string; language: string; templateId?: string }): Promise<FirstBuildPrep>;
  resolveFollowUp(artifactId: string): Promise<FollowUpResolution | null>;
  /**
   * Re-validate at EXECUTION time that `actor` may still WRITE `artifactId` (H1 MEDIUM, TOCTOU
   * close). The create-time gate on `POST /jobs` (loadWritable in routes/) can go stale before a
   * queued follow-up actually resolves: the owner may flip the artifact org→private, or it may be
   * deleted, between the check and execution. build.ts calls this immediately before resuming the
   * follow-up and FAILS the job on a non-`ok` verdict rather than editing an artifact the actor may
   * no longer write. Kept on the mechanics seam because the ownership rule lives in apps/
   * (loadWritable) and agents/ reaches apps/ only through this seam (tier direction, ch02 §2.7).
   * Verdict mirrors loadWritable: 'ok' | 'notfound' | 'forbidden'.
   */
  revalidateWritable(actor: Actor, artifactId: string): Promise<'ok' | 'notfound' | 'forbidden'>;
  /** Final bundle (stop watcher, clean, build w/ 2 attempts, validate). Returns an error note on failure. */
  finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }>;
  /** Version snapshot through the app repo lock (broken builds snapshotted with a failure tag). */
  snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void>;
  /** Fire-and-forget screenshot. */
  screenshot(artifactId: string): void;
  /** Persist sdkSessionId onto the artifact — ONLY when it changed (§5.4.5). */
  persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void>;
  /** Activate the artifact with a MERGE onto its existing data bag (§5.6.2 step 7). */
  activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void>;
  /** (Re)start the incremental watcher with a rebuild callback — the live-preview heartbeat:
   *  every successful watcher rebuild fires `onRebuild`, which build.ts maps to a
   *  `preview_reload` job event so the client's iframe follows the agent's writes. */
  watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void>;
  /**
   * Honest-completion gate (F16, ch05 §5.6.2 step 5a): deterministic evidence the agent's work
   * reached the SERVED surface. NOT clean when the manifest-entrypoint subtree (`frontend/src/`)
   * is unchanged vs the scaffold baseline commit, or the built output still fingerprints as the
   * Ekoa scaffold — especially when an orphan top-level `*.html` was written instead. A gate hit
   * is a distinct non-success terminal in build.ts, never a clean `completed`.
   */
  assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }>;
}

const noopBuildMechanics: BuildMechanics = {
  async prepareFirstBuild(input) {
    return { artifactId: `art_${input.sessionId}`, projectDir: '', slug: 'app', appUrl: '' };
  },
  async resolveFollowUp() {
    return null;
  },
  async revalidateWritable() {
    return 'ok';
  },
  async finalizeBundle() {
    return { ok: true };
  },
  async snapshot() {},
  screenshot() {},
  async persistSdkSessionId() {},
  async activateArtifact() {},
  async watchRebuilds() {},
  async assertProgress() {
    return { clean: true, reasons: [] };
  },
};
let buildMechanics: BuildMechanics = noopBuildMechanics;
export function setBuildMechanics(fn: BuildMechanics): void {
  buildMechanics = fn;
}
export function getBuildMechanics(): BuildMechanics {
  return buildMechanics;
}

/** Reset every seam to its default (tests). */
export function __resetAgentSeamsForTests(): void {
  assembleAgentContextFn = defaultAssembleAgentContext;
  knowledgeGroundingFn = defaultKnowledgeGrounding;
  ingestBuildKnowledgeFn = defaultIngestBuildKnowledge;
  knowledgeToolSearchFn = defaultKnowledgeToolSearch;
  knowledgeToolReadFn = defaultKnowledgeToolRead;
  loadContextContentFn = defaultLoadContextContent;
  integrationPrefetchFn = defaultIntegrationPrefetch;
  catalogFn = defaultCatalog;
  delegateToLocalFn = defaultDelegateToLocal;
  localActivitySources = defaultLocalActivitySources;
  verifyRunnerFn = defaultVerifyRunner;
  buildMechanics = noopBuildMechanics;
}
