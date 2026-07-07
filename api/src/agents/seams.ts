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
  agentKind: 'coding' | 'chat' | 'automation';
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
export function assembleAgentContext(input: { agentKind: 'coding' | 'chat' | 'automation'; userId: string }): Promise<AgentContext> {
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
export type LoadContextContentFn = (input: { userId: string; agentKind: 'coding' | 'chat' | 'automation'; name: string }) => Promise<string | null>;
const defaultLoadContextContent: LoadContextContentFn = async () => null;
let loadContextContentFn: LoadContextContentFn = defaultLoadContextContent;
export function setLoadContextContent(fn: LoadContextContentFn): void {
  loadContextContentFn = fn;
}
export function loadContextContent(input: { userId: string; agentKind: 'coding' | 'chat' | 'automation'; name: string }): Promise<string | null> {
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

// --- Per-build verification runner (ch05 §5.6.2 step 5, ch07 §7.2.6) ----------------------

export interface VerifyRunInput {
  artifactId: string;
  projectDir: string;
  appUrl: string;
  userId: string;
  /** first build → full acceptance pass; follow-up → scoped tests + smoke pass. */
  depth: 'full' | 'scoped';
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
}

export interface FollowUpResolution {
  projectDir: string;
  /** The SDK session id to resume with (§5.4.5). */
  resumeSessionId?: string;
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
  /** Final bundle (stop watcher, clean, build w/ 2 attempts, validate). Returns an error note on failure. */
  finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }>;
  /** Version snapshot through the app repo lock (broken builds snapshotted with a failure tag). */
  snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void>;
  /** Fire-and-forget screenshot. */
  screenshot(artifactId: string): void;
  /** Persist sdkSessionId onto the artifact — ONLY when it changed (§5.4.5). */
  persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void>;
  /** Activate the artifact with a MERGE onto its existing data bag (§5.6.2 step 7). */
  activateArtifact(input: { artifactId: string; slug: string; appUrl: string }): Promise<void>;
}

const noopBuildMechanics: BuildMechanics = {
  async prepareFirstBuild(input) {
    return { artifactId: `art_${input.sessionId}`, projectDir: '', slug: 'app', appUrl: '' };
  },
  async resolveFollowUp() {
    return null;
  },
  async finalizeBundle() {
    return { ok: true };
  },
  async snapshot() {},
  screenshot() {},
  async persistSdkSessionId() {},
  async activateArtifact() {},
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
  knowledgeToolSearchFn = defaultKnowledgeToolSearch;
  knowledgeToolReadFn = defaultKnowledgeToolRead;
  loadContextContentFn = defaultLoadContextContent;
  integrationPrefetchFn = defaultIntegrationPrefetch;
  catalogFn = defaultCatalog;
  verifyRunnerFn = defaultVerifyRunner;
  buildMechanics = noopBuildMechanics;
}
