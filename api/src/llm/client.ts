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
import { buildSubprocessEnv, getSecret, forceRefresh, currentMode, type CredentialMode } from './credentials.js';

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

/** One normalized message off an agent stream. The LAST message is always `final`. */
export type AgentStreamMsg =
  | { kind: 'text'; text: string }
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

function sdkOptions(p: SdkCallParams): Record<string, unknown> {
  return {
    model: p.model,
    effort: p.effort,
    env: p.env,
    abortController: controllerFor(p.signal),
    ...(p.resume ? { resume: p.resume } : {}),
    ...(p.forkSession ? { forkSession: true } : {}),
    ...(p.allowedTools ? { allowedTools: p.allowedTools } : {}),
    ...(p.disallowedTools ? { disallowedTools: p.disallowedTools } : {}),
    ...(p.cwd ? { cwd: p.cwd } : {}),
    ...(p.maxTurns !== undefined ? { maxTurns: p.maxTurns } : {}),
    ...(p.systemPrompt ? { customSystemPrompt: p.systemPrompt } : {}),
  };
}

const defaultTransport: ChokepointTransport = {
  async *streamAgent(p) {
    let text = '';
    let usage: RawUsage = { ...ZERO_USAGE };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = query({ prompt: p.prompt, options: sdkOptions(p) as any });
      for await (const msg of q) {
        if (msg.type === 'assistant') {
          const t = textOfSdkMessage(msg);
          if (t) {
            text += t;
            yield { kind: 'text', text: t };
          }
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
    try {
      const env = await buildSubprocessEnv();
      const stream = transport.streamAgent({
        prompt: opts.prompt,
        model: decision.model,
        effort: decision.effort,
        env,
        systemPrompt: opts.systemPrompt,
        resume: opts.resume,
        forkSession: opts.forkSession,
        allowedTools: opts.allowedTools,
        disallowedTools: opts.disallowedTools,
        cwd: opts.cwd,
        maxTurns: opts.maxTurns,
        signal: ac.signal,
      });
      for await (const msg of stream) {
        if (msg.kind === 'text') {
          text += msg.text;
          yield { type: 'text', text: msg.text };
        } else {
          text = msg.text || text;
          usage = msg.usage;
          aborted = !!msg.aborted;
        }
      }
    } catch (err) {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      rejectResult(err);
      throw err;
    }
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
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
  const env = await buildSubprocessEnv();
  const res = await transport.oneShot({
    prompt: opts.prompt,
    model: decision.model,
    effort: decision.effort,
    env,
    systemPrompt: opts.systemPrompt,
    images: opts.images,
    disallowedTools: ['*'], // no tools on a one-shot
    maxTurns: 1,
    signal: opts.signal,
  });
  // Bill the reported usage even on abort (P-19), THEN reject abort as abort.
  const metered = await meter(attribution, decision.tier, decision.model, res.usage);
  recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
  if (res.aborted) throw new LlmAbortedError();
  return { text: res.text, usage: res.usage };
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
  const payload: Record<string, unknown> = {
    model: decision.model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: opts.messages,
    ...(opts.system ? { system: opts.system } : {}),
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
  const usage = parseUsageFromBody(resp.body, false) ?? { ...ZERO_USAGE };
  const metered = await meter(attribution, 'FAST', decision.model, usage);
  recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
  return { text: textFromBody(resp.body), usage, status: resp.status };
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
}

export async function proxyGatewayMessages(
  reqBody: Record<string, unknown>,
  billeeUserId: string,
): Promise<GatewayForwardResult> {
  const capKey = await admitOrThrow(billeeUserId); // §6.6.4 pre-admission cap (empty => platform admin)
  const decision = decideForTier('FAST'); // wire tier is FAST (§6.5.4)
  const mode = (await currentMode()) ?? 'oauth';
  const isStream = reqBody.stream === true;
  // Clamp the wire model to FAST; keep the client's other fields. Ensure OAuth metadata.
  const meta = (reqBody.metadata as Record<string, unknown> | undefined) ?? {};
  const payload: Record<string, unknown> = {
    ...reqBody,
    model: decision.model,
    metadata: { ...meta, user_id: (meta.user_id as string) ?? 'ekoa-llm-gateway' },
  };

  let resp: RawRestResponse;
  resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await getSecret(), payload, stream: isStream });
  if (resp.status === 401) {
    resp = await transport.messages({ providerBaseUrl: providerBaseUrl(), mode, secret: await forceRefresh(), payload, stream: isStream });
  }

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
  return { status: resp.status, headers: resp.headers, body: resp.body, unmetered, metered };
}
