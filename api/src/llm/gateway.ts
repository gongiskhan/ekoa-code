/**
 * llm/gateway.ts — the ekoa-local LLM gateway sub-app (ch03 §3.10; carryover B12). An
 * Anthropic-compatible Messages endpoint that external tools (the ekoa-local fast loop) call
 * instead of the provider; the chokepoint injects the central credential and meters the call.
 *
 * Metering moved INSIDE the chokepoint (§6.5.4): every proxied call bills at the WIRE tier =
 * FAST (that is what actually crosses the wire on the OAuth seam), regardless of what the
 * router would classify — via client.proxyGatewayMessages. Usage is parsed from streamed +
 * non-streamed bodies; an unparseable body SKIPS billing and increments the observable
 * `gateway_unmetered_call` counter surfaced on /health (§6.5.4). The billee is the JWT
 * principal; gateway-key principals bill the platform admin.
 *
 * Streaming (S1, run 20260717): the upstream transport stays BUFFERED (anonymisation operates
 * on the complete body — it outranks streaming). A stream:true client instead gets
 * heartbeat-and-replay: the SSE 200 commits after auth + allowance, protocol-legal ping frames
 * keep the connection alive while the buffered call runs, then the verbatim detokenized SSE
 * body replays in one write. Post-commitment failures arrive as in-stream `error` events.
 *
 * Boundary: llm/ may not import auth/ (ch02 §2.7), so `verifyToken` is injected by the
 * composition root (the same seam servingRouter uses).
 */
import express, { type Express, type Request, type Response, type Router } from 'express';
import { loadConfig } from '../config.js';
import { checkAllowance } from '../billing/allowance.js';
import { classify, type Tier } from './router.js';
import { completeFast, proxyGatewayMessages } from './client.js';
import { LlmAbortedError, LlmRateCapError } from './client.js';
import { CredentialError } from './credentials.js';

/** The injected JWT verifier (returns at least the subject + org). */
export type VerifyToken = (token: string) => { sub: string; orgId?: string };

export interface GatewayDeps {
  verifyToken: VerifyToken;
  /** Heartbeat cadence for stream:true responses (ms). Tests inject a small value; the
   *  composition root omits it and gets the 15 s default. */
  pingIntervalMs?: number;
}

// --- /health counter (§6.5.4) ------------------------------------------------------------

let gatewayUnmeteredCalls = 0;

/** The `gateway_unmetered_call` count surfaced on /health — a 2xx gateway response whose body
 *  had no parseable usage, so billing was skipped. Makes silent metering drift detectable. */
export function gatewayUnmeteredCount(): number {
  return gatewayUnmeteredCalls;
}
export function __resetGatewayCountersForTests(): void {
  gatewayUnmeteredCalls = 0;
}

// --- Auth --------------------------------------------------------------------------------

/** A gateway principal: a JWT user (bill that user), the static gateway key (bill the platform
 *  admin — resolved by the tracker from the empty billee), or unauthenticated. */
type GatewayPrincipal = { kind: 'jwt'; userId: string; orgId?: string } | { kind: 'apikey' } | null;

function authenticate(req: Request, deps: GatewayDeps): GatewayPrincipal {
  const apiKey = req.headers['x-api-key'];
  const configuredKey = loadConfig().llm.gatewayApiKey;
  if (typeof apiKey === 'string' && configuredKey && apiKey === configuredKey) return { kind: 'apikey' };

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    try {
      const claims = deps.verifyToken(auth.slice(7));
      return { kind: 'jwt', userId: claims.sub, orgId: claims.orgId };
    } catch {
      return null;
    }
  }
  return null;
}

/** The user id to bill for a principal: the JWT subject, or '' (platform admin) for the key. */
function billeeOf(principal: NonNullable<GatewayPrincipal>): string {
  return principal.kind === 'jwt' ? principal.userId : '';
}

function gatewayError(res: Response, status: number, message: string, type = 'authentication_error'): void {
  if (!res.headersSent) {
    res.status(status).json({ type: 'error', error: { type, message } });
  }
}

// --- SSE heartbeat-and-replay (S1, run 20260717) -------------------------------------------

/** Heartbeat cadence for stream:true responses — comfortably under common 60 s proxy/client
 *  idle timeouts while the buffered upstream call runs. */
const GATEWAY_PING_INTERVAL_MS = 15_000;

/** A protocol-legal SSE ping frame (the provider's own ping shape; stock clients ignore it).
 *  Liveness is carried ENTIRELY by SSE framing — never by status text in message content,
 *  which would enter the client's transcript and pollute its context + cache. */
const SSE_PING_FRAME = 'event: ping\ndata: {"type": "ping"}\n\n';

/** A terminal SSE error event in the provider's error shape. */
function sseErrorFrameOf(type: string, message: string): string {
  return `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type, message } })}\n\n`;
}

/** Wrap an upstream non-2xx JSON error body as a terminal SSE error event. The payload is
 *  re-serialized (never raw-embedded) so the data line is guaranteed single-line; an
 *  unparseable body is replaced by a generic api_error, never leaked into the frame. */
function sseErrorFrame(errorBody: string): string {
  try {
    const parsed: unknown = JSON.parse(errorBody);
    if (parsed && typeof parsed === 'object' && (parsed as { type?: unknown }).type === 'error') {
      return `event: error\ndata: ${JSON.stringify(parsed)}\n\n`;
    }
  } catch {
    // fall through to the synthesized frame
  }
  return sseErrorFrameOf('api_error', 'Provider request failed');
}

// --- Routes ------------------------------------------------------------------------------

const TIER_ORDER: Record<Tier, number> = { FAST: 1, WORKHORSE: 2, EXPERT: 3 };

/** Build the gateway router. Mounted at /api/v1/llm by the composition root. */
export function gatewayRouter(deps: GatewayDeps): Router {
  const router = express.Router();
  // Base64 screenshots in request bodies can exceed the default limit; use a generous one.
  const largeJson = express.json({ limit: '50mb' });

  const handleMessages = async (req: Request, res: Response): Promise<void> => {
    const principal = authenticate(req, deps);
    if (!principal) {
      gatewayError(res, 401, 'Invalid or missing API key / JWT');
      return;
    }
    const billeeUserId = billeeOf(principal);

    // Allowance gate for JWT principals (§6.6.3 gateway row). Key principals (platform) skip.
    if (principal.kind === 'jwt') {
      const verdict = await checkAllowance(billeeUserId);
      if (!verdict.ok) {
        res.status(402).json({
          error: { code: 'BILLING_BLOCKED', message: verdict.message, details: { billingUrl: verdict.billingUrl } },
        });
        return;
      }
    }

    // Heartbeat-and-replay (S1): a stream:true client gets its SSE 200 committed NOW — after
    // auth + allowance, so those keep clean HTTP statuses — with protocol-legal pings while the
    // buffered upstream call runs, then the verbatim detokenized SSE body replayed in one write.
    // The transport stays fully buffered (anonymisation outranks streaming). Provider response
    // headers cannot be forwarded on this path: they arrive only after the 200 commitment.
    const wantsStream = (req.body as { stream?: unknown } | undefined)?.stream === true;
    const canWrite = (): boolean => !res.writableEnded && !res.destroyed;
    let ping: NodeJS.Timeout | undefined;
    const stopPing = (): void => {
      if (ping) {
        clearInterval(ping);
        ping = undefined;
      }
    };
    if (wantsStream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders?.();
      if (canWrite()) res.write(SSE_PING_FRAME);
      ping = setInterval(() => {
        if (canWrite()) res.write(SSE_PING_FRAME);
      }, deps.pingIntervalMs ?? GATEWAY_PING_INTERVAL_MS);
      // A client disconnect stops the heartbeat but never aborts the upstream call: the
      // provider tokens are consumed either way, so metering inside the proxy must land.
      res.on('close', stopPing);
    }

    try {
      const result = await proxyGatewayMessages((req.body ?? {}) as Record<string, unknown>, billeeUserId);
      if (result.unmetered) gatewayUnmeteredCalls++;
      if (wantsStream) {
        stopPing();
        if (result.status >= 200 && result.status < 300) {
          // The buffered body IS the provider's verbatim (post-detokenization) SSE text —
          // replay it raw; never re-parse/re-serialize events.
          if (canWrite()) res.write(result.body);
        } else if (canWrite()) {
          // Post-commitment upstream failure: 200 + SSE framing are already on the wire, so
          // the provider's JSON error body is delivered as a terminal SSE error event.
          res.write(sseErrorFrame(result.body));
        }
        if (canWrite()) res.end();
        return;
      }
      // Pass the provider response through, minus hop-by-hop headers. `content-encoding`
      // must also drop: the upstream fetch already DECODED the body (result.body is
      // plaintext), so forwarding the gzip label makes the SDK client fail with ZlibError
      // (F2 — surfaced the first time an authenticated turn crossed the gateway).
      for (const [k, v] of Object.entries(result.headers)) {
        const lower = k.toLowerCase();
        if (['connection', 'transfer-encoding', 'keep-alive', 'content-length', 'content-encoding'].includes(lower)) continue;
        res.setHeader(k, v);
      }
      res.status(result.status).send(result.body);
    } catch (err) {
      // Diagnostics honesty (run s7, D6 — closes FINDINGS 502-masks-401): a TERMINAL failure
      // is classed distinctly from a transient one instead of the old catch-all "retryable"
      // 502. Callers (the daemon's C5 surfacing, the TUI) can now tell "fix the credential"
      // from "try again". Messages stay generic — no bodies, no secrets on the wire.
      console.error('[llm-gateway] forward failed:', err instanceof Error ? err.message : err);
      if (wantsStream) {
        // Same classing, delivered in-stream: the SSE framing is committed, so a status change
        // is impossible. A rate-cap trip refused the call BEFORE any upstream spend/metering —
        // only the delivery vehicle differs from the non-stream 429 (decision 2026-07-17).
        stopPing();
        const frame =
          err instanceof CredentialError
            ? sseErrorFrameOf('api_error', 'Provider credential unavailable (terminal). See /health claudeAuth.')
            : err instanceof LlmRateCapError
              ? sseErrorFrameOf('rate_limit_error', 'Rate cap exceeded. Retry later.')
              : sseErrorFrameOf('api_error', 'Provider request failed');
        if (canWrite()) res.write(frame);
        if (canWrite()) res.end();
        return;
      }
      if (err instanceof CredentialError) {
        // Terminal: the central credential is missing/rejected/unrefreshable. Non-retryable
        // until an operator acts; /health.claudeAuth carries the class + latched alert.
        gatewayError(res, 503, 'Provider credential unavailable (terminal). See /health claudeAuth.', 'credential_error');
        return;
      }
      if (err instanceof LlmRateCapError) {
        gatewayError(res, 429, 'Rate cap exceeded. Retry later.', 'rate_limit_error');
        return;
      }
      gatewayError(res, 502, 'Provider request failed', 'api_error');
    }
  };

  router.post('/messages', largeJson, handleMessages);
  router.post('/v1/messages', largeJson, handleMessages);

  router.get('/models', (req: Request, res: Response) => {
    if (!authenticate(req, deps)) {
      gatewayError(res, 401, 'Invalid or missing API key / JWT');
      return;
    }
    const tiers = loadConfig().llm.tiers;
    // Anthropic-style envelope per the shared LlmModelsResponse contract: { data: [...] }.
    // All three tiers are listed (S2 honesty fix: WORKHORSE was missing) — family mapping makes
    // every tier reachable through this gateway, not only the FAST wire tier.
    res.json({
      data: [
        { id: tiers.FAST.model, route: 'gateway', note: 'wire tier (OAuth-compatible)' },
        { id: tiers.WORKHORSE.model, route: 'gateway', note: 'workhorse tier' },
        { id: tiers.EXPERT.model, route: 'sdk', note: 'SDK-only strong tier' },
      ],
    });
  });

  /**
   * Classify a TUI turn so the local loop decides per-turn to stay local (FAST) or escalate to
   * the strong agent face. Default mode is a real FAST classification via the chokepoint
   * (completeFast, classifier attribution, hard budget) with the keyword scorer as automatic
   * fallback; EKOA_TUI_CLASSIFY_MODE=keyword restores the pure deterministic path. This
   * endpoint NEVER 500s — any failure degrades to the keyword decision (§6.4.2 site 19).
   */
  router.post('/classify', largeJson, async (req: Request, res: Response) => {
    const principal = authenticate(req, deps);
    if (!principal) {
      gatewayError(res, 401, 'Invalid or missing API key / JWT');
      return;
    }
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
    const wantMin = (process.env.EKOA_TUI_ESCALATE_MIN_TIER || 'WORKHORSE').toUpperCase();
    const minTier: Tier = wantMin === 'FAST' || wantMin === 'EXPERT' ? (wantMin as Tier) : 'WORKHORSE';
    const mode = (process.env.EKOA_TUI_CLASSIFY_MODE || 'llm').toLowerCase();

    let tier: Tier = 'FAST';
    let classifier: 'keyword' | 'llm' | 'keyword-fallback' = 'keyword';
    const t0 = Date.now();

    if (mode === 'keyword') {
      tier = classify(prompt);
      classifier = 'keyword';
    } else {
      try {
        tier = await classifyViaModel(prompt, billeeOf(principal));
        classifier = 'llm';
      } catch {
        tier = classify(prompt);
        classifier = 'keyword-fallback';
      }
    }

    res.json({
      tier,
      tierName: tier,
      minTier,
      minTierName: minTier,
      escalate: TIER_ORDER[tier] >= TIER_ORDER[minTier],
      classifier,
      elapsedMs: Date.now() - t0,
    });
  });

  return router;
}

/** Hard-budget FAST classification of a turn via the chokepoint. Returns a valid tier or
 *  throws (the caller falls back to the keyword scorer). Budget: 3.5 s. */
const CLASSIFY_BUDGET_MS = 3500;
async function classifyViaModel(prompt: string, billeeUserId: string): Promise<Tier> {
  if (!billeeUserId) throw new Error('no billee for classifier');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLASSIFY_BUDGET_MS);
  try {
    const { text } = await completeFast(
      {
        system:
          'Classify the user turn into exactly one tier for routing. Reply with ONLY one word: FAST, WORKHORSE, or EXPERT. FAST = trivial lookup/classification; WORKHORSE = a single-file edit or moderate task; EXPERT = a build, feature, or complex multi-file task.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 8,
        signal: ac.signal,
      },
      { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId },
    );
    const word = text.trim().toUpperCase();
    if (word.includes('EXPERT')) return 'EXPERT';
    if (word.includes('WORKHORSE')) return 'WORKHORSE';
    if (word.includes('FAST')) return 'FAST';
    throw new Error(`classifier returned invalid tier: ${word.slice(0, 20)}`);
  } catch (err) {
    if (err instanceof LlmAbortedError) throw new Error('classifier budget exceeded');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Mount the gateway onto an Express app (or no-op when disabled). Used by server.ts. */
export function registerGateway(app: Express, deps: GatewayDeps): void {
  if (!loadConfig().llm.gatewayEnabled) {
    console.log('[llm-gateway] disabled (LLM_GATEWAY_ENABLED=false)');
    return;
  }
  app.use('/api/v1/llm', gatewayRouter(deps));
}
