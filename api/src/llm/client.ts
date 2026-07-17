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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadConfig } from '../config.js';
import { recordTokenEvent, resolvePlatformBillee, type TokenEventInput } from '../billing/tracker.js';
import { checkRateCaps, recordSpend, type RateCapKey, type RateCapVerdict } from '../billing/rate-caps.js';
import { users } from '../data/stores.js';
import {
  type LlmAttribution,
  type UserWorkAgentType,
  requireAttribution,
  assertNotPlatformCall,
  billeeOf,
} from './attribution.js';
import { decideForTier, type RouterDecision, type Tier } from './router.js';
import { buildMcpServers, translateAllowedTools, type SdkToolSpec } from './sdk-tools.js';
import { buildSubprocessEnv, getSecret, forceRefresh, currentMode, noteProviderError, providerErrorClassOf, type CredentialMode } from './credentials.js';
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
async function admitOrThrow(
  billeeUserId: string,
  keyScope?: { keyId: string; keyCaps?: { maxCallsPerWindow?: number; maxSpendPerWindow?: number } },
): Promise<RateCapKey> {
  const key: RateCapKey = { ...(await capKeyFor(billeeUserId)), ...(keyScope ?? {}) };
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
    // Same disjoint namespacing as the gateway path (S7): a conversation id is BILLEE-scoped
    // (`csid:<billee>:<conv>`) so the hosted SDK turn and the delegated gateway turn - which the
    // bridge deliberately shares a vault between (§18.4.3, §17.5: bridge/provider sets
    // meta.session_id = the conversation id) - derive the SAME vault key, while no conversation
    // id can collide with the reserved `gwkey:<keyId>` per-key vault space.
    return { sessionId: `csid:${billeeOf(attribution)}:${attribution.sessionId}`, ephemeral: false };
  }
  return { sessionId: `eph:${newCorrelationId()}`, ephemeral: true };
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
  /** Provider REST path under /v1/messages (S3, run 20260717): 'count_tokens' selects
   *  /v1/messages/count_tokens; absent (or 'messages') keeps the Messages endpoint. An optional
   *  field so every existing full-object test fake stays compilable and behavior-identical. */
  endpoint?: 'messages' | 'count_tokens';
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
  /** Working commentary, not answer: extended-thinking blocks plus the text of intermediate
   *  turns (a turn that also carries tool_use is commentary — the SDK only continues past a
   *  turn through tool use, so the answer is exactly the toolless final turn's text). */
  | { kind: 'thinking'; text: string }
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

/**
 * Split one assistant SDK message into answer text vs working commentary ("thinking"), in
 * block order. Two commentary sources: real extended-thinking blocks, and the text of an
 * intermediate turn — the agent loop only continues past a turn via tool_use, so text sharing
 * a message with tool_use is the model narrating its work ("let me check…", where the engine
 * happily self-identifies), never the answer. The answer is exactly the toolless final turn's
 * text. `redacted_thinking` blocks are encrypted and dropped. Exported for unit tests.
 */
export function classifyAssistantContent(msg: SDKMessage): { answer: string; thinking: string } {
  if (msg.type !== 'assistant') return { answer: '', thinking: '' };
  const content = (msg.message as { content?: unknown }).content;
  if (typeof content === 'string') return { answer: content, thinking: '' };
  if (!Array.isArray(content)) return { answer: '', thinking: '' };
  const blocks = content.filter(
    (b): b is { type?: string; text?: string; thinking?: string } => !!b && typeof b === 'object',
  );
  const hasToolUse = blocks.some((b) => b.type === 'tool_use');
  let answer = '';
  let thinking = '';
  for (const b of blocks) {
    if (b.type === 'thinking' && typeof b.thinking === 'string') thinking += b.thinking;
    else if (b.type === 'text' && typeof b.text === 'string') {
      if (hasToolUse) thinking += b.text;
      else answer += b.text;
    }
  }
  return { answer, thinking };
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
    // SDK ≥0.2 option name is `systemPrompt` (a plain string = full custom prompt). The old
    // `customSystemPrompt` name was silently IGNORED by the installed SDK, so every system
    // prompt (planner shape contract, brand research, chat context) vanished on the live path
    // while fake-transport tests kept passing — found live 2026-07-11 (planner emitted an
    // invented JSON shape because it never saw the required one).
    ...(p.systemPrompt ? { systemPrompt: p.systemPrompt } : {}),
    // In-process MCP tools (§5.4.4) — instantiated at spawn time, in-process only (no egress).
    ...(p.sdkTools?.length ? { mcpServers: buildMcpServers(p.sdkTools) } : {}),
  };
}

/**
 * Build a one-message streaming-input prompt for a vision one-shot: a single user message whose
 * content is the text followed by the base64 image blocks. The SDK accepts `prompt` as
 * `string | AsyncIterable<SDKUserMessage>`; a finite generator that yields once and completes is
 * processed as a single turn (bounded by `maxTurns`). Used ONLY when `p.images` is non-empty.
 */
async function* imagePromptInput(
  text: string,
  images: Array<{ mediaType: string; data: string }>,
): AsyncGenerator<SDKUserMessage> {
  const content = [
    { type: 'text', text },
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
  ];
  yield {
    type: 'user',
    parent_tool_use_id: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: { role: 'user', content: content as any },
  } as SDKUserMessage;
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
          const { answer, thinking } = classifyAssistantContent(msg);
          // Thinking precedes the turn's answer/tool blocks in content order — emit it first.
          if (thinking) yield { kind: 'thinking', text: thinking };
          if (answer) {
            text += answer;
            yield { kind: 'text', text: answer };
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
          // F20: the accumulated deltas ARE the answer — the SDK result field can carry only the
          // LAST delta, and overwriting the accumulation truncated complete.result + the persisted
          // assistant message to a tail. Fall back to it only when nothing streamed.
          if (msg.subtype === 'success' && !text) text = (msg as { result: string }).result;
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
      // Vision one-shots (§6.2.1 runOneShot images): a plain string prompt cannot carry image
      // blocks, so when images are present the prompt becomes a one-message streaming input whose
      // content is [text, ...image blocks]. Text-only one-shots keep the plain string prompt
      // (byte-identical to before), so this change cannot affect any non-image caller.
      const promptInput = p.images && p.images.length > 0 ? imagePromptInput(p.prompt, p.images) : p.prompt;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = query({ prompt: promptInput, options: sdkOptions({ ...p, maxTurns: p.maxTurns ?? 1 }) as any });
      for await (const msg of q) {
        if (msg.type === 'assistant') text += classifyAssistantContent(msg).answer;
        else if (msg.type === 'result') {
          usage = rawFromSdkUsage((msg as { usage?: unknown }).usage);
          // F20 parity: prefer the accumulated assistant text; the result field only as fallback.
          if (msg.subtype === 'success' && !text) text = (msg as { result: string }).result;
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
    const suffix = p.endpoint === 'count_tokens' ? '/count_tokens' : '';
    const url = `${p.providerBaseUrl}/v1/messages${suffix}${isOauth ? '?beta=true' : ''}`;
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
  /** The answer: the toolless final turn's text (working commentary lives in thinkingText). */
  text: string;
  /** Accumulated working commentary (intermediate turns + thinking blocks), de-tokenized. */
  thinkingText: string;
  usage: RawUsage;
  aborted: boolean;
}

export interface AgentRunHandle {
  /** The streamed run: yields answer (`text`) and working-commentary (`thinking`) events, then
   *  RETURNS the final result. Metering fires once when the stream finishes (or aborts with
   *  reported usage). */
  events: AsyncGenerator<{ type: 'text' | 'thinking'; text: string }, AgentRunResult, void>;
  /** Resolves with the final result when the stream completes; rejects on a hard failure. */
  result: Promise<AgentRunResult>;
  /** Cancel the run. */
  abort(): void;
}

/**
 * F25 subprocess isolation (ch05 §5.4.1). A spawn that supplies neither `cwd` nor `homeDir` used
 * to inherit the API server's `process.cwd()` (the repo checkout — which the Agent SDK reports to
 * the model as its working directory) and `HOME` (the operator's home, putting `~/.claude` in
 * reach). Both are host/operator context with no business inside a tenant run.
 *
 * Every run therefore gets an EMPTY per-run sandbox for whatever the caller did not pin: `cwd`
 * falls back to the sandbox, and `HOME` follows `cwd` (build runs already set both to their
 * project dir, and this must never override an explicit caller value). The directory is removed
 * when the run ends. Defense-in-depth: `settingSources: []` and the per-agent tool allow-list are
 * the primary gates; this removes the inherited-path vector underneath them.
 */
async function runSandbox(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ekoa-run-'));
}
function discardSandbox(dir: string | undefined): void {
  // Fire-and-forget: the run result must not wait on cleanup. An rm failure is logged (not
  // silently swallowed) so a persistently-failing tmpdir surfaces rather than accumulating empty
  // per-run dirs invisibly (F25 finding 5). An empty dir lingering to reboot is not a data leak.
  if (dir) void rm(dir, { recursive: true, force: true }).catch((err) => console.warn('[llm] sandbox cleanup failed:', err instanceof Error ? err.message : err));
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
  // Every consumer drains `events` first and only then awaits `result`, so a stream error throws
  // out of the `for await` and `result`'s rejection is never observed — an UNHANDLED rejection on
  // every failed run. Pre-handle it here: a genuine awaiter still sees the rejection (this creates
  // a derived promise; the original is unchanged), but the process no longer reports it as unhandled.
  void result.catch(() => {});

  async function* run(): AsyncGenerator<{ type: 'text' | 'thinking'; text: string }, AgentRunResult, void> {
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
    // The thinking channel gets its own straddle buffer: interleaving both channels through
    // one detokenizer would mis-stitch a token split across a thinking/text boundary.
    const detokThinking = createDetokenizer(handle);
    let rawText = ''; // the tokenized text as it comes off the transport
    let rawThinking = ''; // tokenized working commentary (intermediate turns + thinking blocks)
    const cb = opts.callbacks;
    // F25: never let the subprocess inherit the host cwd/HOME. A caller that pins them (build,
    // verify) keeps its own; everyone else gets an empty per-run sandbox, removed at run end.
    let sandbox: string | undefined;
    try {
      // F25 finding 2: create the sandbox INSIDE the try. A throw here (mkdtemp failure, or
      // buildSubprocessEnv when the credential is unconfigured) must reach the catch — which
      // rejects `result` and discards the sandbox — not hang `result` or orphan an empty dir.
      if (!opts.cwd || !opts.homeDir) sandbox = await runSandbox();
      const runCwd = opts.cwd ?? sandbox!;
      const runHome = opts.homeDir ?? runCwd;
      const env = await buildSubprocessEnv({
        homeDir: runHome,
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
        cwd: runCwd,
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
          case 'thinking': {
            rawThinking += msg.text;
            const clear = detokThinking.push(msg.text);
            if (clear) yield { type: 'thinking', text: clear };
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
            // F20: keep the accumulated streamed deltas — the final frame's text can be just the
            // last delta (SDK result field), and clobbering here truncated the persisted assistant
            // message + complete.result to a tail. Final text only when nothing streamed.
            rawText = rawText || msg.text;
            usage = msg.usage;
            aborted = !!msg.aborted;
            break;
        }
      }
      const thinkingTail = detokThinking.end();
      if (thinkingTail) yield { type: 'thinking', text: thinkingTail };
      const tail = detok.end();
      if (tail) yield { type: 'text', text: tail };
    } catch (err) {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      discardSandbox(sandbox);
      // Clear the ephemeral vault on the ERROR/abort path too (§17.5, Codex checkpoint M1): the
      // token->value map is a re-identification key and must not linger to TTL after a failed call.
      if (sk.ephemeral) endSession(handle);
      rejectResult(err);
      throw err;
    }
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    discardSandbox(sandbox);
    text = deanonymize(rawText, handle); // final result is cleartext (incl any tool_use values)
    const thinkingText = deanonymize(rawThinking, handle);
    if (sk.ephemeral) endSession(handle); // a session-less run keeps no vault past the call (§17.5)
    // Single metering point: bill the reported usage even on abort (P-19); zero => nothing billed.
    const metered = await meter(attribution, decision.tier, decision.model, usage);
    recordSpend({ ...capKey, metered }); // accrue the admitted call's spend into the window (§6.6.4)
    const r: AgentRunResult = { text, thinkingText, usage, aborted };
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
  // F25: a one-shot spawns a subprocess too — isolate its cwd/HOME from the host (see runSandbox).
  const sandbox = await runSandbox();
  try {
    // F25 finding 2: buildSubprocessEnv inside the try — if getSecret throws (unconfigured/
    // unrefreshable credential) the finally still discards the sandbox instead of orphaning it.
    const env = await buildSubprocessEnv({ homeDir: sandbox });
    const res = await transport.oneShot({
      prompt: promptAnon.text,
      model: decision.model,
      effort: decision.effort,
      env,
      systemPrompt: systemAnon?.text,
      images: opts.images,
      cwd: sandbox,
      disallowedTools: ['*'], // no tools on a one-shot
      // Tool-less, so >1 turn is only a model continuation (observed live 2026-07-11: an
      // EXPERT thinking run needs a second turn to emit the text after a thinking-heavy
      // first turn — maxTurns:1 made the SDK error with "Reached maximum number of turns").
      // A small ceiling keeps the runaway-loop guarantee.
      maxTurns: 3,
      signal: opts.signal,
    });
    // Bill the reported usage even on abort (P-19), THEN reject abort as abort.
    const metered = await meter(attribution, decision.tier, decision.model, res.usage);
    recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
    const text = deanonymize(res.text, promptAnon.handle);
    if (res.aborted) throw new LlmAbortedError();
    return { text, usage: res.usage };
  } finally {
    discardSandbox(sandbox); // F25: the per-run sandbox never outlives the run
    // Clear the ephemeral vault on EVERY exit - success, transport error, or abort (§17.5, Codex
    // checkpoint M1): the re-identification key must not linger to TTL after a failed call.
    if (sk.ephemeral) endSession(promptAnon.handle);
  }
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
export async function completeFast(
  opts: MessagesOptions,
  attribution: LlmAttribution,
  /** Per-key cap scope (S4a): present when the caller acts for a gateway-key principal, so the
   *  key window composes here exactly as on the messages path. Optional - existing callers
   *  are untouched. */
  capScope?: { keyId: string; keyCaps?: { maxCallsPerWindow?: number; maxSpendPerWindow?: number } },
): Promise<MessagesResult> {
  requireAttribution(attribution);
  assertNotPlatformCall(attribution);
  const capKey = await admitOrThrow(billeeOf(attribution), capScope); // §6.6.4 pre-admission cap (+ key window)
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
/**
 * Top-level Messages API request fields the gateway forwards upstream (F2 live-turn fix).
 * The Anthropic OAuth beta endpoint (/v1/messages?beta=true) validates request bodies STRICTLY
 * and 400s on any key outside its schema ("context_management: Extra inputs are not permitted",
 * observed live from the installed Agent SDK subprocess). An ALLOWLIST - not a blocklist - so
 * the next unknown field a future SDK version adds is dropped instead of breaking every
 * default-topology turn. Dropped KEY NAMES are logged for observability; values never are.
 * `model` and `metadata` are set explicitly by the gateway below (clamp + attribution), so they
 * need not be listed, but are included for clarity.
 */
const GATEWAY_FORWARD_FIELDS: ReadonlySet<string> = new Set([
  'model', 'messages', 'max_tokens', 'system', 'metadata', 'stop_sequences', 'stream',
  'temperature', 'top_k', 'top_p', 'tools', 'tool_choice', 'thinking', 'output_config',
  'service_tier', 'betas', 'mcp_servers', 'container', 'cache_control',
]);

/** The tier whose CONFIGURED model matches the requested wire model, or null for any other
 *  string (which keeps the historical always-FAST clamp). Matching tolerates the client
 *  omitting a configured trailing '[1m]' long-context marker (and vice versa). */
function matchConfiguredTier(requestedModel: string): Tier | null {
  if (!requestedModel) return null;
  const strip = (m: string): string => m.replace(/\[1m\]$/, '');
  const tiers = loadConfig().llm.tiers;
  for (const t of ['FAST', 'WORKHORSE', 'EXPERT'] as const) {
    if (strip(tiers[t].model) === strip(requestedModel)) return t;
  }
  return null;
}

/** The tier a stock model-id FAMILY maps to (S2, run 20260717): opus -> EXPERT,
 *  sonnet -> WORKHORSE, haiku -> FAST. The family name must appear as a whole TOKEN of the id
 *  (segments split on non-alphanumerics) — never as a within-word substring, so an unrelated id
 *  like `opusculum-1` keeps the historical FAST clamp (codex S2 finding: raw `includes` let any
 *  substring bypass the clamp and carry reasoning params). Case-insensitive, tolerant of
 *  `claude-` prefixes, generation infixes, dated suffixes, and the `[1m]` marker. Exact
 *  configured-tier match always wins first. Checked opus -> sonnet -> haiku for determinism. */
export function matchFamilyTier(requestedModel: string): Tier | null {
  const tokens = requestedModel.replace(/\[1m\]$/, '').toLowerCase().split(/[^a-z0-9]+/);
  if (tokens.includes('opus')) return 'EXPERT';
  if (tokens.includes('sonnet')) return 'WORKHORSE';
  if (tokens.includes('haiku')) return 'FAST';
  return null;
}

export interface GatewayForwardResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  /** true when the (2xx) body had no parseable usage — the caller counts it as unmetered. */
  unmetered: boolean;
  metered: number;
  /** The correlation id the hosted anon-audit was recorded under (ch18 §18.5 S6 join key). */
  correlationId: string;
  /** The tier/model that actually ran (S4a: the gateway's Registo row records them). */
  wireTier: Tier;
  wireModel: string;
}

/** Per-call options for gateway forwards (S4a). Every field optional so existing callers are
 *  untouched: agentType defaults to the historical 'pi-fast-loop'; keyId/keyCaps add the
 *  per-key rate-cap window for user-key principals. */
export interface GatewayForwardOpts {
  agentType?: UserWorkAgentType;
  keyId?: string;
  keyCaps?: { maxCallsPerWindow?: number; maxSpendPerWindow?: number };
}

/** A content block is an empty text block when it is `{type:'text', text: ''|whitespace}`. The
 *  Anthropic API rejects `cache_control` on such a block, so it must never reach the provider. */
function isEmptyTextBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false;
  const b = block as { type?: unknown; text?: unknown };
  return b.type === 'text' && (typeof b.text !== 'string' || b.text.trim() === '');
}

/** Remove empty text blocks from ONE message's `content` (only when it is a block array). Guarded:
 *  if scrubbing would empty the array, the content is left untouched (an empty `content: []` is
 *  itself invalid — better to forward the original and let a real error surface than fabricate one). */
function stripEmptyTextBlocksFromContent(content: unknown): { value: unknown; removed: number } {
  if (!Array.isArray(content)) return { value: content, removed: 0 };
  const kept = content.filter((block) => !isEmptyTextBlock(block));
  const removed = content.length - kept.length;
  if (removed === 0 || kept.length === 0) return { value: content, removed: 0 };
  return { value: kept, removed };
}

/** Scrub empty text blocks from every message's content array. Returns the (possibly new) messages
 *  array and the total number of blocks removed. Non-array input passes through untouched. */
function stripEmptyTextBlocks(messages: unknown): { value: unknown; removed: number } {
  if (!Array.isArray(messages)) return { value: messages, removed: 0 };
  let removed = 0;
  const value = messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    const m = msg as { content?: unknown };
    const scrubbed = stripEmptyTextBlocksFromContent(m.content);
    if (scrubbed.removed === 0) return msg;
    removed += scrubbed.removed;
    return { ...m, content: scrubbed.value };
  });
  return removed > 0 ? { value, removed } : { value: messages, removed: 0 };
}

/**
 * Derive the anonymisation vault session key for a gateway call (S7). The three namespaces are
 * DISJOINT so no client-supplied value can reach another principal's vault (codex S7 High):
 *  - `csid:<billee>:<session_id>` - a client-supplied metadata.session_id, BILLEE-scoped so a
 *    crafted "gwkey:<victim>" can never equal the reserved per-key vault name;
 *  - `gwkey:<keyId>` - a gateway-KEY principal (keyId from the verified seam, unforgeable), so
 *    one stock-client session shares one vault across its agentic tool loop;
 *  - `eph:<correlationId>` - truly session-less + key-less, a fresh per-request vault.
 * `ephemeral` is true only for the last case (the finally clears exactly those).
 */
function deriveVaultSession(args: { metaSessionId: unknown; billeeUserId: string; keyId?: string; correlationId: string }): { sessionId: string; ephemeral: boolean } {
  const explicitSession = typeof args.metaSessionId === 'string';
  const keyVaultId = args.keyId ? `gwkey:${args.keyId}` : undefined;
  if (explicitSession) return { sessionId: `csid:${args.billeeUserId}:${args.metaSessionId as string}`, ephemeral: false };
  if (keyVaultId) return { sessionId: keyVaultId, ephemeral: false };
  return { sessionId: `eph:${args.correlationId}`, ephemeral: true };
}

export async function proxyGatewayMessages(
  reqBody: Record<string, unknown>,
  billeeUserId: string,
  /** The correlation id to record the hosted anon-audit under (ch18 §18.5 S6). When the bridge
   *  provider endpoint passes the daemon's per-request id, the hosted audit and the daemon's egress
   *  ledger row share ONE correlation id — the join key (§18.4.5, §18.8 criterion 5). Absent for a
   *  non-bridge caller: mint a fresh one as before. */
  correlationIdIn?: string,
  opts?: GatewayForwardOpts,
): Promise<GatewayForwardResult> {
  // §6.6.4 pre-admission cap (empty => platform admin); a key principal adds its per-key window.
  const capKey = await admitOrThrow(billeeUserId, opts?.keyId ? { keyId: opts.keyId, keyCaps: opts.keyCaps } : undefined);
  // Tier resolution (rc-1 amendment to §6.5.4, decision logged 2026-07-11): a requested model
  // that IS one of the three configured tier models runs at THAT tier — the chokepoint no longer
  // silently degrades its own subprocess traffic (the Agent-SDK spawns ride this gateway via
  // ANTHROPIC_BASE_URL, so the old always-FAST clamp ran chat/build/planner on the FAST model
  // regardless of the configured tier, and the strict-JSON planner starved). Any OTHER model
  // string keeps the historical behavior: clamp to FAST and strip model-tuned reasoning params.
  const requestedModel = typeof reqBody.model === 'string' ? reqBody.model : '';
  // Resolution order (S2, run 20260717): exact configured-tier match -> model-FAMILY match
  // (opus/sonnet/haiku -> EXPERT/WORKHORSE/FAST, so stock Claude Code ids land on real tiers)
  // -> the historical FAST clamp for anything else.
  const matchedTier = matchConfiguredTier(requestedModel);
  const resolvedTier = matchedTier ?? matchFamilyTier(requestedModel);
  const wireTier: Tier = resolvedTier ?? 'FAST';
  const decision = decideForTier(wireTier);
  const mode = (await currentMode()) ?? 'oauth';
  const isStream = reqBody.stream === true;
  // Keep the client's other fields; ensure OAuth metadata.
  const meta = (reqBody.metadata as Record<string, unknown> | undefined) ?? {};

  // Anonymise the bridge/subprocess request BEFORE the transport (§17.3, §17.2: subprocess
  // traffic funnels through this chokepoint via ANTHROPIC_BASE_URL). The vault is keyed by the
  // propagated conversation id so one vault serves both the hosted and delegated turns (§17.5).
  const correlationId = correlationIdIn ?? newCorrelationId();
  const orgId = (await orgResolver(billeeUserId)) ?? '';
  const ruleset = await resolveRuleset(orgId);
  // Vault session key (S7, run 20260717). Order: an explicit conversation id wins; else, for a
  // gateway-KEY principal (a stock Anthropic client like Claude Code, which sends no session_id)
  // key the vault by the KEY id so ALL of that key's requests share ONE vault across the agentic
  // tool loop - a deny-list literal then tokenizes consistently turn-to-turn and prior-turn tokens
  // detokenize reliably (without this, each request opened a fresh vault and the CLI saw a
  // "directory that does not exist"; findings gateway-vault-per-request-instability). A stable
  // vault persists to its 30-min TTL and is NOT cleared per request; only a truly ephemeral
  // (no-session, no-key) vault is cleared in the finally.
  const { sessionId, ephemeral: ephemeralVault } = deriveVaultSession({ metaSessionId: meta.session_id, billeeUserId, keyId: opts?.keyId, correlationId });
  const anonCtx: AnonymiseContext = {
    sessionId,
    ruleset,
    correlationId,
    actor: { userId: billeeUserId, orgId, username: billeeUserId },
  };
  const anon = anonymizeRequestBody(reqBody, anonCtx);
  // Forward ONLY the documented Messages API top-level fields (see GATEWAY_FORWARD_FIELDS):
  // the OAuth beta endpoint rejects unknown keys with a 400, killing the whole turn.
  const forwarded: Record<string, unknown> = {};
  const droppedFields: string[] = [];
  for (const [key, value] of Object.entries(anon.body)) {
    if (GATEWAY_FORWARD_FIELDS.has(key)) forwarded[key] = value;
    else droppedFields.push(key);
  }
  // Reasoning params travel with a matched OR family-matched tier model: the wire model is the
  // tier the client targeted (exactly or by family), so its thinking/output_config are valid for
  // it. Only on the unknown-model clamp do the client's model-tuned params target THEIR model,
  // not the FAST wire model - which can reject them outright (observed live: 400 "adaptive
  // thinking is not supported on <model>").
  if (resolvedTier === null) {
    for (const key of ['thinking', 'output_config']) {
      if (key in forwarded) {
        delete forwarded[key];
        droppedFields.push(`${key} (fast-clamp)`);
      }
    }
  }
  // Belt-and-braces: the Agent SDK occasionally appends an empty text block that still carries a
  // `cache_control` breakpoint (observed live 2026-07-11 on multi-turn chat runs incl. the
  // integration-build handoff: the OAuth endpoint 400s "messages.N.content.M.text: cache_control
  // cannot be set for empty text blocks", killing the whole turn). The chokepoint is the last
  // place we control before the provider, so scrub empty text blocks out of the forwarded
  // messages/system here. Guarded so a message never ends up with an empty content array.
  const scrubbed = stripEmptyTextBlocks(forwarded.messages);
  if (scrubbed.removed > 0) {
    forwarded.messages = scrubbed.value;
    console.warn(`[llm] gateway forward: scrubbed ${scrubbed.removed} empty text block(s) from messages`);
  }
  const scrubbedSystem = stripEmptyTextBlocksFromContent(forwarded.system);
  if (scrubbedSystem.removed > 0) forwarded.system = scrubbedSystem.value;
  if (droppedFields.length > 0) {
    console.warn(`[llm] gateway forward: dropped unknown top-level fields: ${droppedFields.join(', ')}`);
  }
  // The wire Messages API accepts ONLY metadata.user_id and 400s on ANY extra key (observed
  // live: "metadata.session_id: Extra inputs are not permitted", which silently emptied every
  // bridge compose answer). The first fix stripped just the chokepoint's own session_id vault
  // key (§18.4.3); the s0b retro review found the sibling — any OTHER client metadata key
  // masks the same way — so the forward is now an ALLOWLIST: user_id only, dropped key NAMES
  // logged for observability (values never are).
  // session_id is the chokepoint's OWN expected channel (consumed above on every bridge
  // call) — stripping it is routine, so it is excluded from the warning to keep logs honest
  // about the unexpected keys only.
  const droppedMetaKeys = Object.keys(meta).filter((k) => k !== 'user_id' && k !== 'session_id');
  if (droppedMetaKeys.length > 0) {
    console.warn(`[llm] gateway forward: dropped metadata keys (wire accepts user_id only): ${droppedMetaKeys.join(', ')}`);
  }
  const payload: Record<string, unknown> = {
    ...forwarded,
    // A trailing '[1m]' long-context marker is a CLIENT-side alias, not a wire-legal model id -
    // strip it before the provider call (the configured EXPERT model may carry it). Metadata is
    // the ALLOWLIST established above: user_id only (any other key 400s on the wire).
    model: decision.model.replace(/\[1m\]$/, ''),
    metadata: { user_id: (meta.user_id as string) ?? 'ekoa-llm-gateway' },
  };

  let resp: RawRestResponse;
  try {
    resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await getSecret(), payload, stream: isStream });
    if (resp.status === 401) {
      resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await forceRefresh(), payload, stream: isStream });
    }
    // De-tokenize the response body (text + tool_use argument blocks, §17.3 step 5) so the local
    // loop acts on the REAL value, not a placeholder that does not exist on disk.
    resp = { ...resp, body: deanonymize(resp.body, anon.handle) };
  } finally {
    // Clear a truly EPHEMERAL (no-session, no-key) vault on EVERY exit incl. a transport error
    // (§17.5, Codex checkpoint M1): the re-identification key must not linger to TTL after a
    // failed gateway call. A stable per-key vault (S7) is deliberately kept - it must persist
    // across the Claude Code session's requests; it TTL-sweeps on its own (30 min).
    if (ephemeralVault) endSession(anon.handle);
  }

  // Diagnostics honesty (run s7, D6): a terminal provider status is CLASSED onto /health's
  // claudeAuth.lastProviderError — class + timestamp only, never the body. The response still
  // passes through untouched (the caller decides what to surface); this ends the
  // invisible-failure family (400-emptied compose answers, 502-masks-401).
  const errClass = providerErrorClassOf(resp.status);
  if (errClass && errClass !== 'transient' && errClass !== 'rate_limit') noteProviderError(errClass);

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
        ? { kind: 'user_work', agentType: opts?.agentType ?? 'pi-fast-loop', billeeUserId }
        : { kind: 'platform', agentType: 'pi-fast-loop', justification: 'ekoa-local gateway API-key principal — platform overhead billed to the platform admin (§6.5.4)' };
      // Metered at the tier that actually ran (§6.3): a matched EXPERT call bills EXPERT weight.
      metered = await meter(attribution, wireTier, decision.model, usage);
      recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
    } else {
      unmetered = true; // parse-or-skip (§6.5.4); the caller bumps gateway_unmetered_call
    }
  }
  return { status: resp.status, headers: resp.headers, body: resp.body, unmetered, metered, correlationId, wireTier, wireModel: decision.model };
}

// --- count_tokens forwarding (S3, run 20260717) --------------------------------------------

/** count_tokens forward allowlist — the documented count_tokens request surface ONLY (the
 *  strict endpoint 400s on extras): no stream, no max_tokens, no sampling params, no metadata. */
const COUNT_TOKENS_FORWARD_FIELDS: ReadonlySet<string> = new Set([
  'model', 'messages', 'system', 'tools', 'tool_choice', 'thinking', 'output_config',
  'mcp_servers', 'betas',
]);

/** Fields a stock Messages client (Claude Code) sends on EVERY call that count_tokens simply
 *  does not accept — dropping them is routine, so they are excluded from the unexpected-key
 *  warning (same honesty rule as the metadata session_id exclusion above). */
const COUNT_TOKENS_ROUTINE_DROPS: ReadonlySet<string> = new Set([
  'stream', 'max_tokens', 'metadata', 'temperature', 'top_k', 'top_p', 'stop_sequences',
  'service_tier', 'cache_control', 'container',
]);

export interface GatewayCountTokensResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
  correlationId: string;
}

/**
 * Forward a count_tokens request through the chokepoint (S3, run 20260717). Same credential
 * injection and FULL anonymisation posture as proxyGatewayMessages (request tokenized before
 * transport, response detokenized, ephemeral vault cleared), and the same tier resolution so
 * the count is honest for the model that will actually run. Deliberately NO admitOrThrow, NO
 * allowance gate, NO metering: count_tokens is free upstream and produces no usage, and Claude
 * Code polls it continuously for context management — counting it against the shared per-user
 * call window would starve real turns (decision 2026-07-17; abuse residual in docs/security.md).
 */
export async function proxyGatewayCountTokens(
  reqBody: Record<string, unknown>,
  billeeUserId: string,
): Promise<GatewayCountTokensResult> {
  const requestedModel = typeof reqBody.model === 'string' ? reqBody.model : '';
  const matchedTier = matchConfiguredTier(requestedModel);
  const resolvedTier = matchedTier ?? matchFamilyTier(requestedModel);
  const wireTier: Tier = resolvedTier ?? 'FAST';
  const decision = decideForTier(wireTier);
  const mode = (await currentMode()) ?? 'oauth';
  const meta = (reqBody.metadata as Record<string, unknown> | undefined) ?? {};

  const correlationId = newCorrelationId();
  const orgId = (await orgResolver(billeeUserId)) ?? '';
  const ruleset = await resolveRuleset(orgId);
  // count_tokens threads no keyId, so a client session_id is billee-scoped and everything else is
  // ephemeral - the SAME disjoint namespacing as messages (S7 codex High: this sibling path must
  // not let a crafted session_id open a reserved gwkey vault either).
  const { sessionId, ephemeral: hasEphemeralVault } = deriveVaultSession({ metaSessionId: meta.session_id, billeeUserId, correlationId });
  const anonCtx: AnonymiseContext = {
    sessionId,
    ruleset,
    correlationId,
    actor: { userId: billeeUserId, orgId, username: billeeUserId },
  };
  const anon = anonymizeRequestBody(reqBody, anonCtx);
  const forwarded: Record<string, unknown> = {};
  const droppedFields: string[] = [];
  for (const [key, value] of Object.entries(anon.body)) {
    if (COUNT_TOKENS_FORWARD_FIELDS.has(key)) forwarded[key] = value;
    else droppedFields.push(key);
  }
  if (resolvedTier === null) {
    for (const key of ['thinking', 'output_config']) {
      if (key in forwarded) {
        delete forwarded[key];
        droppedFields.push(`${key} (fast-clamp)`);
      }
    }
  }
  const scrubbed = stripEmptyTextBlocks(forwarded.messages);
  if (scrubbed.removed > 0) forwarded.messages = scrubbed.value;
  const scrubbedSystem = stripEmptyTextBlocksFromContent(forwarded.system);
  if (scrubbedSystem.removed > 0) forwarded.system = scrubbedSystem.value;
  // A '(fast-clamp)'-suffixed drop is routine on every unknown-model call (S3 fresh review F3).
  const noisyDrops = droppedFields.filter((k) => !COUNT_TOKENS_ROUTINE_DROPS.has(k.replace(/ \(fast-clamp\)$/, '')));
  if (noisyDrops.length > 0) {
    console.warn(`[llm] gateway count_tokens: dropped unexpected top-level fields: ${noisyDrops.join(', ')}`);
  }
  const payload: Record<string, unknown> = {
    ...forwarded,
    model: decision.model.replace(/\[1m\]$/, ''),
  };

  let resp: RawRestResponse;
  try {
    resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await getSecret(), payload, stream: false, endpoint: 'count_tokens' });
    if (resp.status === 401) {
      resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await forceRefresh(), payload, stream: false, endpoint: 'count_tokens' });
    }
    resp = { ...resp, body: deanonymize(resp.body, anon.handle) };
  } finally {
    // Same vault hygiene as proxyGatewayMessages: never let an ephemeral re-identification key
    // linger to TTL after the call (a client-scoped csid: vault persists, like messages).
    if (hasEphemeralVault) endSession(anon.handle);
  }
  const errClass = providerErrorClassOf(resp.status);
  if (errClass && errClass !== 'transient' && errClass !== 'rate_limit') noteProviderError(errClass);
  return { status: resp.status, headers: resp.headers, body: resp.body, correlationId };
}
