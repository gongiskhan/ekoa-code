/**
 * llm/client.ts — the chokepoint entry points (ch06 §6.2.1) and the SINGLE metering point
 * (§6.5.1). This is the only file in the service that touches an Anthropic transport: the
 * Claude Agent SDK subprocess (streaming + one-shot) and the direct Messages REST call.
 *
 * Every entry takes `attribution` as a REQUIRED positional parameter (§6.3) — no overload
 * without it, no default. After every completed call it computes raw provider counts and
 * hands ONE event to `billing/` via recordTokenEvent (§6.5.1); callers cannot meter because
 * callers cannot reach the transport. Abort is fixed by construction: runOneShot/completeFast
 * reject with a typed LlmAbortedError and never resolve empty (§6.2.1); a cancelled call still
 * bills the usage the provider reported up to the abort (RESOLVED P-19, §6.9).
 *
 * The transport is injectable (a seam) so tests exercise metering + attribution + abort +
 * retry WITHOUT a live model; the default transport is the real SDK + provider REST.
 */
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadConfig } from '../config.js';
import { recordTokenEvent, resolvePlatformBillee, type TokenEventInput } from '../billing/tracker.js';
import { checkRateCaps, recordSpend, type RateCapKey, type RateCapVerdict } from '../billing/rate-caps.js';
import { users } from '../data/stores.js';
import {
  type LlmAttribution,
  requireAttribution,
  assertNotPlatformCall,
  billeeOf,
} from './attribution.js';
import { decideForTier, type RouterDecision, type Tier } from './router.js';
import { buildMcpServers, translateAllowedTools, type SdkToolSpec } from './sdk-tools.js';
import { buildSubprocessEnv, getSecret, forceRefresh, currentMode, type CredentialMode } from './credentials.js';
import {
  anonymize,
  deanonymize,
  anonymizeRequestBody,
  createDetokenizer,
  newCorrelationId,
  resolveRuleset,
  endSession,
  type AnonymiseContext,
  type VaultHandle,
} from './anonymise/index.js';

/** The provider host literal lives HERE, inside the egress module (never in config.ts, which
 *  the chokepoint grep gate scans). Env-overridable via `config.llm.providerBaseUrl`. */
const DEFAULT_PROVIDER_BASE_URL = 'https://api.anthropic.com';

/** OAuth-mode beta flags, discovered from the Claude Code CLI headers (carried). */
const OAUTH_BETA_FLAGS = 'claude-code-20250219,oauth-2025-04-20';

function providerBaseUrl(): string {
  return loadConfig().llm.providerBaseUrl || DEFAULT_PROVIDER_BASE_URL;
}

// --- Shared types ------------------------------------------------------------------------

/** Raw provider token counts — the metering input (§6.5.2). */
export interface RawUsage {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

const ZERO_USAGE: RawUsage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

/** Typed abort rejection (§6.2.1). A user Stop propagates as abort — it never falls through
 *  to a deterministic fallback (conflict 11); the fallbacks fire on failure/timeout only. */
export class LlmAbortedError extends Error {
  constructor(message = 'LLM call aborted') {
    super(message);
    this.name = 'LlmAbortedError';
  }
}

/** A provider/transport failure that is NOT an abort (surfaced to the caller). */
export class LlmTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LlmTransportError';
  }
}

/**
 * Blocked by a per-user or per-org rate limit / spend cap (§6.6.4). Thrown at the entry point
 * BEFORE the call is admitted, so a blocked request is never forwarded, metered, or recorded —
 * only admitted calls accrue against the sliding window (§6.6.4).
 */
export class LlmRateCapError extends Error {
  constructor(readonly verdict: RateCapVerdict) {
    super(verdict.reason ?? 'LLM rate/spend cap exceeded');
    this.name = 'LlmRateCapError';
  }
}

// --- Rate/spend caps at the chokepoint (§6.6.4) ------------------------------------------
// The caps group per-org AND per-user, but LlmAttribution carries only the billee. The org is
// resolved from the billee through an injected seam (default: the users store — llm/ MAY import
// data/), so per-org caps work without threading orgId through every call site.

/** userId -> orgId resolver. Default reads the users store; injectable for tests + the root. */
type OrgResolver = (userId: string) => Promise<string | undefined>;
const defaultOrgResolver: OrgResolver = async (userId) => {
  if (!userId) return undefined;
  try {
    const u = (await users.get(userId)) as { orgId?: string } | null;
    return u?.orgId;
  } catch {
    return undefined; // a resolver hiccup never fails the model call — caps fail open on org
  }
};
let orgResolver: OrgResolver = defaultOrgResolver;
export function setOrgResolver(fn: OrgResolver): void {
  orgResolver = fn;
}
export function __resetOrgResolverForTests(): void {
  orgResolver = defaultOrgResolver;
}

/** Build the cap key for a billee. An empty billee (platform / gateway-key traffic) resolves to
 *  the platform-admin id — the same account the ledger bills (§6.3 rule 3) — so platform traffic
 *  is capped under a real account, never an empty pseudo-key. */
async function capKeyFor(billeeUserId: string): Promise<RateCapKey> {
  const userId = billeeUserId || (await resolvePlatformBillee());
  const orgId = (await orgResolver(userId)) ?? '';
  return { billeeUserId: userId, orgId };
}

/** Pre-admission gate (§6.6.4): resolve the cap key, check the sliding window, and throw a typed
 *  LlmRateCapError WITHOUT recording when a cap is tripped. Returns the key so the caller records
 *  spend against the same identity AFTER metering succeeds. */
async function admitOrThrow(billeeUserId: string): Promise<RateCapKey> {
  const key = await capKeyFor(billeeUserId);
  const verdict = checkRateCaps(key);
  if (!verdict.ok) throw new LlmRateCapError(verdict);
  return key;
}

// --- Anonymisation context (ch17 §17.3) --------------------------------------------------
// The egress module's second concern: model-bound text is anonymised BEFORE the transport and
// de-tokenized on the way back, on this single code path (FIXED-13; §17.2 - no bypass). The
// per-org ruleset (deny-list) is loaded through the anonymise resolver seam; the vault is keyed
// by the session identity (§17.5), falling back to a per-call ephemeral key when a call carries
// no session.

/** The vault session key for a call: the propagated conversation id (user_work), else a fresh
 *  per-call key so a session-less call still gets a consistent, isolated vault. `ephemeral` is
 *  true for the per-call fallback so the entry can clear that vault as soon as it is done (a
 *  session vault is left to live for the conversation + its TTL, §17.5). */
function sessionKeyFor(attribution: LlmAttribution): { sessionId: string; ephemeral: boolean } {
  if (attribution.kind === 'user_work' && attribution.sessionId) {
    return { sessionId: attribution.sessionId, ephemeral: false };
  }
  return { sessionId: `sess_${newCorrelationId()}`, ephemeral: true };
}

/** Build the anonymisation context: resolve the billee's org, load its ruleset, and stamp the
 *  audit actor. One correlation id is minted per provider request and shared by every part. */
async function anonContextFor(
  attribution: LlmAttribution,
  sessionId: string,
  correlationId: string,
): Promise<AnonymiseContext> {
  const userId = billeeOf(attribution);
  const orgId = (await orgResolver(userId)) ?? '';
  const ruleset = await resolveRuleset(orgId);
  return { sessionId, ruleset, correlationId, actor: { userId, orgId, username: userId } };
}

// --- Transport seam ----------------------------------------------------------------------

export interface SdkCallParams {
  prompt: string;
  model: string;
  effort: RouterDecision['effort'];
  env: Record<string, string>;
  systemPrompt?: string;
  resume?: string;
  forkSession?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  maxTurns?: number;
  /** In-process MCP tool specs the spawn mounts (§5.4.4; instantiated in sdk-tools.ts). */
  sdkTools?: SdkToolSpec[];
  /** Base64 image attachments for vision one-shots (§6.2.1 runOneShot). */
  images?: Array<{ mediaType: string; data: string }>;
  signal?: AbortSignal;
}

export interface RestCallParams {
  providerBaseUrl: string;
  mode: CredentialMode;
  secret: string;
  /** The Messages API request body (already carrying the FAST model). */
  payload: Record<string, unknown>;
  stream: boolean;
  signal?: AbortSignal;
}

export interface RawRestResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}

/** One normalized message off an agent stream. The LAST message is always `final`. The
 *  intermediate kinds beyond `text` are what `agents/` needs to build the typed streaming
 *  pipeline (ch05 §5.4.6, §5.7.1): tool-use start/finish, the once-only sdkSessionId, usage
 *  deltas (internal billing capture), and plan/subtask notifications (internal — reset the
 *  inactivity timer, §5.3.6). Tool `args`/`result` are tokenized here and de-tokenized in
 *  `runAgent` through the SAME vault handle before they leave `llm/` (§5.7.1). */
export type AgentStreamMsg =
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; tool: string; toolId?: string; args?: Record<string, unknown> }
  | { kind: 'tool_result'; tool: string; toolId?: string; result?: unknown; isError?: boolean }
  | { kind: 'session'; sessionId: string }
  | { kind: 'usage'; usage: RawUsage }
  | { kind: 'plan' }
  | { kind: 'final'; text: string; usage: RawUsage; aborted?: boolean };

export interface TransportResult {
  text: string;
  usage: RawUsage;
  aborted?: boolean;
}

/** The Anthropic transport, injectable for tests. */
export interface ChokepointTransport {
  streamAgent(params: SdkCallParams): AsyncIterable<AgentStreamMsg>;
  oneShot(params: SdkCallParams): Promise<TransportResult>;
  messages(params: RestCallParams): Promise<RawRestResponse>;
}

// --- Default transport (real SDK + provider REST) ----------------------------------------

function textOfSdkMessage(msg: SDKMessage): string {
  if (msg.type !== 'assistant') return '';
  const content = (msg.message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type?: string; text?: string } => !!b && typeof b === 'object')
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

function rawFromSdkUsage(u: unknown): RawUsage {
  const usage = (u ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    input: n(usage.input_tokens),
    output: n(usage.output_tokens),
    cacheCreate: n(usage.cache_creation_input_tokens),
    cacheRead: n(usage.cache_read_input_tokens),
  };
}

/** De-tokenize every string leaf of a tool arg/result value through the run's vault handle
 *  (§5.7.1). Whole-JSON replacement reuses `deanonymize`'s longest-token-first substitution;
 *  a plain string round-trips through JSON so quotes are handled. Undefined passes through. */
function detokJson<T>(value: T, handle: VaultHandle): T {
  if (value === undefined) return value;
  try {
    return JSON.parse(deanonymize(JSON.stringify(value), handle)) as T;
  } catch {
    return value;
  }
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
}

/** Bridge an optional AbortSignal to the AbortController the SDK expects. */
function controllerFor(signal?: AbortSignal): AbortController {
  const ac = new AbortController();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', () => ac.abort(), { once: true });
  }
  return ac;
}

/** Extract tool_use blocks from an assistant SDK message's content array. */
function toolUsesOf(msg: SDKMessage): Array<{ tool: string; toolId?: string; args?: Record<string, unknown> }> {
  if (msg.type !== 'assistant') return [];
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b): b is { type?: string; name?: string; id?: string; input?: unknown } => !!b && typeof b === 'object')
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ tool: b.name ?? 'tool', toolId: b.id, args: (b.input ?? {}) as Record<string, unknown> }));
}

/** Extract tool_result blocks from a user SDK message's content array (the SDK surfaces tool
 *  results as user-role messages). */
function toolResultsOf(msg: SDKMessage): Array<{ toolId?: string; result?: unknown; isError?: boolean }> {
  if (msg.type !== 'user') return [];
  const content = (msg.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b): b is { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean } => !!b && typeof b === 'object')
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({ toolId: b.tool_use_id, result: b.content, isError: b.is_error === true }));
}

function sessionIdOf(msg: SDKMessage): string | undefined {
  const s = (msg as { session_id?: unknown }).session_id;
  return typeof s === 'string' && s ? s : undefined;
}

function sdkOptions(p: SdkCallParams): Record<string, unknown> {
  return {
    model: p.model,
    effort: p.effort,
    env: p.env,
    // The production agent inherits nothing from any developer's ~/.claude profile (§5.4.1,
    // FIXED-6): everything ships in the repo via the content loader.
    settingSources: [],
    abortController: controllerFor(p.signal),
    ...(p.resume ? { resume: p.resume } : {}),
    ...(p.forkSession ? { forkSession: true } : {}),
    ...(p.allowedTools ? { allowedTools: p.allowedTools } : {}),
    ...(p.disallowedTools ? { disallowedTools: p.disallowedTools } : {}),
    ...(p.cwd ? { cwd: p.cwd } : {}),
    ...(p.maxTurns !== undefined ? { maxTurns: p.maxTurns } : {}),
    ...(p.systemPrompt ? { customSystemPrompt: p.systemPrompt } : {}),
    // In-process MCP tools (§5.4.4) — instantiated at spawn time, in-process only (no egress).
    ...(p.sdkTools?.length ? { mcpServers: buildMcpServers(p.sdkTools) } : {}),
  };
}

const defaultTransport: ChokepointTransport = {
  async *streamAgent(p) {
    let text = '';
    let usage: RawUsage = { ...ZERO_USAGE };
    let sessionEmitted = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = query({ prompt: p.prompt, options: sdkOptions(p) as any });
      for await (const msg of q) {
        // sdkSessionId is reported once on the first message carrying one (§5.4.5).
        if (!sessionEmitted) {
          const sid = sessionIdOf(msg);
          if (sid) { sessionEmitted = true; yield { kind: 'session', sessionId: sid }; }
        }
        if (msg.type === 'assistant') {
          const t = textOfSdkMessage(msg);
          if (t) {
            text += t;
            yield { kind: 'text', text: t };
          }
          for (const tu of toolUsesOf(msg)) yield { kind: 'tool_use', ...tu };
          const u = rawFromSdkUsage((msg.message as { usage?: unknown }).usage);
          if (u.input || u.output || u.cacheRead || u.cacheCreate) yield { kind: 'usage', usage: u };
        } else if (msg.type === 'user') {
          for (const tr of toolResultsOf(msg)) yield { kind: 'tool_result', tool: 'tool', ...tr };
        } else if (msg.type === 'system') {
          // Sub-task / plan notifications are consumed internally to reset the inactivity
          // timer; they are never forwarded to the wire (§5.7.3, P-11).
          yield { kind: 'plan' };
        } else if (msg.type === 'result') {
          usage = rawFromSdkUsage((msg as { usage?: unknown }).usage);
          if (msg.subtype === 'success') text = (msg as { result: string }).result;
        }
      }
    } catch (err) {
      if (isAbortError(err, p.signal)) {
        yield { kind: 'final', text, usage, aborted: true };
        return;
      }
      throw err;
    }
    yield { kind: 'final', text, usage, aborted: false };
  },

  async oneShot(p) {
    let text = '';
    let usage: RawUsage = { ...ZERO_USAGE };
    let aborted = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = query({ prompt: p.prompt, options: sdkOptions({ ...p, maxTurns: p.maxTurns ?? 1 }) as any });
      for await (const msg of q) {
        if (msg.type === 'assistant') text += textOfSdkMessage(msg);
        else if (msg.type === 'result') {
          usage = rawFromSdkUsage((msg as { usage?: unknown }).usage);
          if (msg.subtype === 'success') text = (msg as { result: string }).result;
        }
      }
    } catch (err) {
      if (isAbortError(err, p.signal)) aborted = true;
      else throw err;
    }
    return { text, usage, aborted };
  },

  async messages(p) {
    const isOauth = p.mode === 'oauth';
    const url = `${p.providerBaseUrl}/v1/messages${isOauth ? '?beta=true' : ''}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (isOauth) {
      headers.authorization = `Bearer ${p.secret}`;
      headers['anthropic-beta'] = OAUTH_BETA_FLAGS;
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers['x-api-key'] = p.secret;
    }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(p.payload), signal: p.signal });
    const body = await res.text();
    const h: Record<string, string | string[]> = {};
    res.headers.forEach((v, k) => { h[k] = v; });
    return { status: res.status, headers: h, body };
  },
};

let transport: ChokepointTransport = defaultTransport;

/** Inject a fake transport for tests (no live model). */
export function __setTransportForTests(t: ChokepointTransport): void {
  transport = t;
}
export function __resetTransportForTests(): void {
  transport = defaultTransport;
}

// --- Usage parsing for the REST + gateway bodies (ported from the old gateway) ------------

/**
 * Parse raw token usage from a complete Messages API response body. Non-streaming: a single
 * JSON object with top-level `usage`. Streaming (SSE): `message_start.message.usage` carries
 * input/cache counts, each `message_delta.usage.output_tokens` is the cumulative running
 * total (last wins). Returns null when no usage can be parsed — the caller then SKIPS billing
 * (§6.5.4 parse-or-skip).
 */
export function parseUsageFromBody(body: string, isStream: boolean): RawUsage | null {
  if (!body) return null;
  const fromObject = (u: unknown): RawUsage | null => {
    if (!u || typeof u !== 'object') return null;
    const usage = u as Record<string, unknown>;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      input: n(usage.input_tokens),
      output: n(usage.output_tokens),
      cacheCreate: n(usage.cache_creation_input_tokens),
      cacheRead: n(usage.cache_read_input_tokens),
    };
  };

  if (!isStream) {
    try {
      return fromObject((JSON.parse(body) as { usage?: unknown }).usage);
    } catch {
      return null;
    }
  }

  let result: RawUsage | null = null;
  let sawAny = false;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let evt: { type?: string; message?: { usage?: unknown }; usage?: unknown };
    try {
      evt = JSON.parse(payload);
    } catch {
      continue;
    }
    if (evt.type === 'message_start') {
      const u = fromObject(evt.message?.usage);
      if (u) { sawAny = true; result = { ...u }; }
    } else if (evt.type === 'message_delta') {
      const u = fromObject(evt.usage);
      if (u) {
        sawAny = true;
        const prev: RawUsage | null = result;
        const next: RawUsage = {
          input: prev ? prev.input : u.input,
          cacheCreate: prev ? prev.cacheCreate : u.cacheCreate,
          cacheRead: prev ? prev.cacheRead : u.cacheRead,
          output: u.output || (prev ? prev.output : 0),
        };
        result = next;
      }
    }
  }
  return sawAny ? result : null;
}

/** Assemble the assistant text from a non-streaming Messages response body. */
function textFromBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { content?: unknown };
    if (!Array.isArray(parsed.content)) return '';
    return parsed.content
      .filter((b): b is { type?: string; text?: string } => !!b && typeof b === 'object')
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
  } catch {
    return '';
  }
}

// --- The single metering point (§6.5.1) --------------------------------------------------

function meterInputFor(attribution: LlmAttribution, tier: Tier, model: string, raw: RawUsage): TokenEventInput {
  const base: TokenEventInput = {
    billeeUserId: billeeOf(attribution),
    attributionKind: attribution.kind,
    agentType: attribution.agentType,
    model,
    tier,
    raw,
  };
  if (attribution.kind === 'user_work') {
    if (attribution.artifactId) base.artifactId = attribution.artifactId;
    if (attribution.sessionId) base.sessionId = attribution.sessionId;
    if (attribution.runId) base.runId = attribution.runId;
  }
  return base;
}

/**
 * The one metering call. Hands one event to billing/ (the platform-call alarm has already
 * fired once at the entry point, covering abort/failure paths too). A ledger-write failure is
 * logged but never thrown back to the caller — the model already ran; losing the response over
 * a billing hiccup would be worse (the push fire-and-forget posture, §6.7). Returns the metered
 * token count for the caller (gateway spend-cap accounting).
 */
async function meter(attribution: LlmAttribution, tier: Tier, model: string, raw: RawUsage): Promise<number> {
  try {
    const { metered } = await recordTokenEvent(meterInputFor(attribution, tier, model, raw));
    return metered;
  } catch (err) {
    console.error('[llm] metering failed (ledger write):', err instanceof Error ? err.message : err);
    return 0;
  }
}

// --- Entry points (§6.2.1) ---------------------------------------------------------------

/** Injected callbacks surfaced from inside the chokepoint's stream loop (ch05 §5.4.6, §5.7.1).
 *  Tool args/results are de-tokenized through the run's vault handle before they reach these
 *  callbacks, so `agents/` never sees a placeholder. sdkSessionId, usage deltas, and plan
 *  notifications are all internal signals `agents/` consumes (persistence / billing / timer). */
export interface AgentRunCallbacks {
  onToolEvent?(e: {
    phase: 'started' | 'finished';
    tool: string;
    toolId?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
  }): void;
  onSessionId?(sessionId: string): void;
  onUsageDelta?(usage: RawUsage): void;
  /** A sub-task / plan notification arrived — reset the inactivity timer (§5.3.6). */
  onPlanNotification?(): void;
}

export interface AgentRunOptions {
  prompt: string;
  /** Required routing decision — a missing decision is a compile error, not an Opus default. */
  decision: RouterDecision;
  systemPrompt?: string;
  resume?: string;
  forkSession?: boolean;
  allowedTools?: string[];
  disallowedTools?: string[];
  cwd?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  /** Build runs set HOME = projectDir; agent-face runs raise the stream-close timeout (§5.4.1). */
  homeDir?: string;
  streamCloseTimeoutMs?: number;
  /** In-process MCP tools this run mounts (§5.4.4) — plain specs; the chokepoint instantiates. */
  sdkTools?: SdkToolSpec[];
  callbacks?: AgentRunCallbacks;
}

export interface AgentRunResult {
  text: string;
  usage: RawUsage;
  aborted: boolean;
}

export interface AgentRunHandle {
  /** The streamed run: yields text events, then RETURNS the final result. Metering fires once
   *  when the stream finishes (or aborts with reported usage). */
  events: AsyncGenerator<{ type: 'text'; text: string }, AgentRunResult, void>;
  /** Resolves with the final result when the stream completes; rejects on a hard failure. */
  result: Promise<AgentRunResult>;
  /** Cancel the run. */
  abort(): void;
}

/**
 * Claude Agent SDK streaming run — all tiers, tools, session resume. Used by every streaming
 * user_work site (chat, build, brand research, agent-face, ...). The chokepoint meters the run
 * once the stream finishes (§6.5.5: agent-face folds in here, no second meter).
 */
export function runAgent(opts: AgentRunOptions, attribution: LlmAttribution): AgentRunHandle {
  requireAttribution(attribution);
  assertNotPlatformCall(attribution);
  const decision = opts.decision;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }

  let resolveResult!: (r: AgentRunResult) => void;
  let rejectResult!: (e: unknown) => void;
  const result = new Promise<AgentRunResult>((res, rej) => { resolveResult = res; rejectResult = rej; });

  async function* run(): AsyncGenerator<{ type: 'text'; text: string }, AgentRunResult, void> {
    let text = '';
    let usage: RawUsage = { ...ZERO_USAGE };
    let aborted = false;
    let capKey: RateCapKey;
    try {
      // Pre-admission rate/spend cap (§6.6.4): a blocked run is never started nor recorded.
      capKey = await admitOrThrow(billeeOf(attribution));
    } catch (err) {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      rejectResult(err);
      throw err;
    }
    // Anonymise the model-bound text BEFORE the transport (§17.3): prompt + system prompt
    // tokenize into one session vault; the streamed response is de-tokenized on the way back.
    const correlationId = newCorrelationId();
    const sk = sessionKeyFor(attribution);
    const ctx = await anonContextFor(attribution, sk.sessionId, correlationId);
    const promptAnon = anonymize(opts.prompt, ctx);
    const handle: VaultHandle = promptAnon.handle;
    const systemAnon = opts.systemPrompt ? anonymize(opts.systemPrompt, ctx) : undefined;
    const detok = createDetokenizer(handle);
    let rawText = ''; // the tokenized text as it comes off the transport
    const cb = opts.callbacks;
    try {
      const env = await buildSubprocessEnv({
        ...(opts.homeDir ? { homeDir: opts.homeDir } : {}),
        ...(opts.streamCloseTimeoutMs !== undefined ? { streamCloseTimeoutMs: opts.streamCloseTimeoutMs } : {}),
      });
      const stream = transport.streamAgent({
        prompt: promptAnon.text,
        model: decision.model,
        effort: decision.effort,
        env,
        systemPrompt: systemAnon?.text,
        resume: opts.resume,
        forkSession: opts.forkSession,
        // Plain §5.4.4 names become MCP wire names for every mounted in-process tool (§5.4.4).
        allowedTools: translateAllowedTools(opts.allowedTools, opts.sdkTools),
        disallowedTools: opts.disallowedTools,
        cwd: opts.cwd,
        maxTurns: opts.maxTurns,
        sdkTools: opts.sdkTools,
        signal: ac.signal,
      });
      for await (const msg of stream) {
        switch (msg.kind) {
          case 'text': {
            rawText += msg.text;
            const clear = detok.push(msg.text); // incremental de-tokenization, straddle-buffered
            if (clear) yield { type: 'text', text: clear };
            break;
          }
          case 'tool_use':
            // De-tokenize tool args through the SAME vault handle before they leave llm/ (§5.7.1).
            cb?.onToolEvent?.({ phase: 'started', tool: msg.tool, toolId: msg.toolId, args: detokJson(msg.args, handle) });
            break;
          case 'tool_result':
            cb?.onToolEvent?.({ phase: 'finished', tool: msg.tool, toolId: msg.toolId, result: detokJson(msg.result, handle), isError: msg.isError });
            break;
          case 'session':
            cb?.onSessionId?.(msg.sessionId);
            break;
          case 'usage':
            cb?.onUsageDelta?.(msg.usage);
            break;
          case 'plan':
            cb?.onPlanNotification?.();
            break;
          case 'final':
            rawText = msg.text || rawText;
            usage = msg.usage;
            aborted = !!msg.aborted;
            break;
        }
      }
      const tail = detok.end();
      if (tail) yield { type: 'text', text: tail };
    } catch (err) {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      rejectResult(err);
      throw err;
    }
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    text = deanonymize(rawText, handle); // final result is cleartext (incl any tool_use values)
    if (sk.ephemeral) endSession(handle); // a session-less run keeps no vault past the call (§17.5)
    // Single metering point: bill the reported usage even on abort (P-19); zero => nothing billed.
    const metered = await meter(attribution, decision.tier, decision.model, usage);
    recordSpend({ ...capKey, metered }); // accrue the admitted call's spend into the window (§6.6.4)
    const r: AgentRunResult = { text, usage, aborted };
    resolveResult(r);
    return r;
  }

  return { events: run(), result, abort: () => ac.abort() };
}

export interface OneShotOptions {
  prompt: string;
  decision: RouterDecision;
  systemPrompt?: string;
  images?: Array<{ mediaType: string; data: string }>;
  signal?: AbortSignal;
}

export interface OneShotResult {
  text: string;
  usage: RawUsage;
}

/**
 * Claude Agent SDK non-streaming, no tools. Replaces the old callSimpleLlm; used by automation
 * planning/vision (strong tiers) and by FAST classifier sites that need image input. Rejects
 * with LlmAbortedError on abort — never resolves an empty string (§6.2.1).
 */
export async function runOneShot(opts: OneShotOptions, attribution: LlmAttribution): Promise<OneShotResult> {
  requireAttribution(attribution);
  assertNotPlatformCall(attribution);
  const decision = opts.decision;
  const capKey = await admitOrThrow(billeeOf(attribution)); // §6.6.4 pre-admission cap
  // Anonymise prompt + system BEFORE the transport; de-tokenize the returned text (§17.3).
  const correlationId = newCorrelationId();
  const sk = sessionKeyFor(attribution);
  const ctx = await anonContextFor(attribution, sk.sessionId, correlationId);
  const promptAnon = anonymize(opts.prompt, ctx);
  const systemAnon = opts.systemPrompt ? anonymize(opts.systemPrompt, ctx) : undefined;
  const env = await buildSubprocessEnv();
  const res = await transport.oneShot({
    prompt: promptAnon.text,
    model: decision.model,
    effort: decision.effort,
    env,
    systemPrompt: systemAnon?.text,
    images: opts.images,
    disallowedTools: ['*'], // no tools on a one-shot
    maxTurns: 1,
    signal: opts.signal,
  });
  // Bill the reported usage even on abort (P-19), THEN reject abort as abort.
  const metered = await meter(attribution, decision.tier, decision.model, res.usage);
  recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
  const text = deanonymize(res.text, promptAnon.handle);
  if (sk.ephemeral) endSession(promptAnon.handle); // session-less: no vault past the call (§17.5)
  if (res.aborted) throw new LlmAbortedError();
  return { text, usage: res.usage };
}

export interface MessagesOptions {
  // FAST-only by TYPE: no tier/model/decision field can express a tier above FAST (§6.2.2).
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface MessagesResult {
  text: string;
  usage: RawUsage;
  status: number;
}

/**
 * Direct Messages REST on the environment's central credential — FAST tier ONLY (the options
 * type cannot express a higher tier, §6.2.2). One forced-token-refresh retry on 401 (carried).
 * Rejects with LlmAbortedError on abort.
 */
export async function completeFast(opts: MessagesOptions, attribution: LlmAttribution): Promise<MessagesResult> {
  requireAttribution(attribution);
  assertNotPlatformCall(attribution);
  const capKey = await admitOrThrow(billeeOf(attribution)); // §6.6.4 pre-admission cap
  const decision = decideForTier('FAST'); // FAST by construction
  const mode = (await currentMode()) ?? 'oauth';
  // Anonymise the model-bound request body BEFORE the transport (§17.3); the response body is
  // de-tokenized before the text is parsed.
  const correlationId = newCorrelationId();
  const sk = sessionKeyFor(attribution);
  const anonCtx = await anonContextFor(attribution, sk.sessionId, correlationId);
  const anon = anonymizeRequestBody(
    { messages: opts.messages, ...(opts.system ? { system: opts.system } : {}) },
    anonCtx,
  );
  const payload: Record<string, unknown> = {
    model: decision.model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: anon.body.messages,
    ...(anon.body.system !== undefined ? { system: anon.body.system } : {}),
    metadata: { user_id: 'ekoa-llm-chokepoint' },
  };
  const base = providerBaseUrl();

  async function once(secret: string): Promise<RawRestResponse> {
    return transport.messages({ providerBaseUrl: base, mode, secret, payload, stream: false, signal: opts.signal });
  }

  let resp: RawRestResponse;
  try {
    resp = await once(await getSecret());
    if (resp.status === 401) {
      // Refresh-and-retry-once on 401 (§6.2.1 T2).
      resp = await once(await forceRefresh());
    }
  } catch (err) {
    if (isAbortError(err, opts.signal)) throw new LlmAbortedError();
    throw err;
  }
  if (opts.signal?.aborted) throw new LlmAbortedError();

  // Meter only a successful, usage-bearing response: a 4xx/5xx carries no billable usage, so it
  // is NOT metered (consistent with the gateway's meter-only-on-2xx rule, §6.5.4). The 401
  // refresh-and-retry already happened above.
  if (resp.status >= 400) throw new LlmTransportError(`Messages REST failed: HTTP ${resp.status}`, resp.status);
  // De-tokenize the whole response body (text + any tool_use argument blocks, §17.3 step 5)
  // before parsing. Usage counts are unaffected by de-tokenization (format-preserving, §6.1).
  const clearBody = deanonymize(resp.body, anon.handle);
  if (sk.ephemeral) endSession(anon.handle); // session-less: no vault past the call (§17.5)
  const usage = parseUsageFromBody(clearBody, false) ?? { ...ZERO_USAGE };
  const metered = await meter(attribution, 'FAST', decision.model, usage);
  recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
  return { text: textFromBody(clearBody), usage, status: resp.status };
}

/**
 * Metered pass-through for the ekoa-local gateway (§6.5.4). Forwards the client's Messages
 * request to the provider on the central credential (CLAMPED to the FAST wire model), streams
 * the response back, and meters at the WIRE tier = FAST regardless of the router. Usage is
 * parsed from streamed + non-streamed bodies; an unparseable body SKIPS billing and reports
 * the skip (the caller increments `gateway_unmetered_call`). `billeeUserId` is the resolved
 * principal ('' bills the platform admin via the tracker).
 */
export interface GatewayForwardResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  /** true when the (2xx) body had no parseable usage — the caller counts it as unmetered. */
  unmetered: boolean;
  metered: number;
  /** The correlation id the hosted anon-audit was recorded under (ch18 §18.5 S6 join key). */
  correlationId: string;
}

export async function proxyGatewayMessages(
  reqBody: Record<string, unknown>,
  billeeUserId: string,
  /** The correlation id to record the hosted anon-audit under (ch18 §18.5 S6). When the bridge
   *  provider endpoint passes the daemon's per-request id, the hosted audit and the daemon's egress
   *  ledger row share ONE correlation id — the join key (§18.4.5, §18.8 criterion 5). Absent for a
   *  non-bridge caller: mint a fresh one as before. */
  correlationIdIn?: string,
): Promise<GatewayForwardResult> {
  const capKey = await admitOrThrow(billeeUserId); // §6.6.4 pre-admission cap (empty => platform admin)
  const decision = decideForTier('FAST'); // wire tier is FAST (§6.5.4)
  const mode = (await currentMode()) ?? 'oauth';
  const isStream = reqBody.stream === true;
  // Clamp the wire model to FAST; keep the client's other fields. Ensure OAuth metadata.
  const meta = (reqBody.metadata as Record<string, unknown> | undefined) ?? {};

  // Anonymise the bridge/subprocess request BEFORE the transport (§17.3, §17.2: subprocess
  // traffic funnels through this chokepoint via ANTHROPIC_BASE_URL). The vault is keyed by the
  // propagated conversation id so one vault serves both the hosted and delegated turns (§17.5).
  const correlationId = correlationIdIn ?? newCorrelationId();
  const orgId = (await orgResolver(billeeUserId)) ?? '';
  const ruleset = await resolveRuleset(orgId);
  const hasSession = typeof meta.session_id === 'string';
  const sessionId = hasSession ? (meta.session_id as string) : `sess_${correlationId}`;
  const anonCtx: AnonymiseContext = {
    sessionId,
    ruleset,
    correlationId,
    actor: { userId: billeeUserId, orgId, username: billeeUserId },
  };
  const anon = anonymizeRequestBody(reqBody, anonCtx);
  const payload: Record<string, unknown> = {
    ...anon.body,
    model: decision.model,
    metadata: { ...meta, user_id: (meta.user_id as string) ?? 'ekoa-llm-gateway' },
  };

  let resp: RawRestResponse;
  resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await getSecret(), payload, stream: isStream });
  if (resp.status === 401) {
    resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await forceRefresh(), payload, stream: isStream });
  }
  // De-tokenize the response body (text + tool_use argument blocks, §17.3 step 5) so the local
  // loop acts on the REAL value, not a placeholder that does not exist on disk.
  resp = { ...resp, body: deanonymize(resp.body, anon.handle) };
  if (!hasSession) endSession(anon.handle); // no propagated conversation: no vault past the call (§17.5)

  // Meter only successful responses; a 4xx/5xx carries no billable usage (carried).
  let unmetered = false;
  let metered = 0;
  if (resp.status >= 200 && resp.status < 300) {
    const usage = parseUsageFromBody(resp.body, isStream);
    if (usage) {
      // A JWT principal is real user work billed to that user (§6.4.1 site 7); a gateway API-key
      // principal (empty billee) is platform overhead — attributed `platform`, which the tracker
      // ledgers against the platform admin (§6.3 rule 3), never user_work with an empty billee.
      const attribution: LlmAttribution = billeeUserId
        ? { kind: 'user_work', agentType: 'pi-fast-loop', billeeUserId }
        : { kind: 'platform', agentType: 'pi-fast-loop', justification: 'ekoa-local gateway API-key principal — platform overhead billed to the platform admin (§6.5.4)' };
      metered = await meter(attribution, 'FAST', decision.model, usage);
      recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
    } else {
      unmetered = true; // parse-or-skip (§6.5.4); the caller bumps gateway_unmetered_call
    }
  }
  return { status: resp.status, headers: resp.headers, body: resp.body, unmetered, metered, correlationId };
}
