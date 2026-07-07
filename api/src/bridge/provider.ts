/**
 * bridge/provider.ts — the Anthropic-compatible provider endpoint for bridge traffic (ch18 §18.4).
 * The local Pi loop reasons on the user's machine but has no model of its own; it emits
 * `provider_request` frames and Cortex serves the completion. This face exists ONLY for bridge
 * traffic and routes EVERY completion through the one LLM chokepoint (`api/src/llm/`, FIXED-13) —
 * anonymisation, attribution (`user_work`, billed to the delegating user), and metering all happen
 * there, on the single egress path, with no bypass. This module imports the chokepoint's PUBLIC
 * entry only (`proxyGatewayMessages`); it never imports the provider SDK directly.
 *
 * The cross-org guard (§18.4.4) is checked server-side, per request, BEFORE any model call, as a
 * chain: `provider credential -> pairing -> org`. The credential resolves to exactly one LIVE,
 * non-revoked pairing; the pairing resolves to exactly one org (from the registry, never a request
 * body); the conversation id the request carries must belong to that org. Because org is derived
 * from the pairing and not the request, a credential for org A can never address org B's vault —
 * there is no request field that would let it name one. Activation admission joins the chain: a
 * deactivated / billing-locked owner is refused before any model call (§18.3.2, §18.4.4).
 */
import type { BridgeFrame } from '@ekoa/shared';
import { proxyGatewayMessages } from '../llm/index.js';
import { getActivation as defaultGetActivation } from '../data/activation.js';
import { sessions, users } from '../data/stores.js';
import { readBridgeToken, BridgeAuthError } from './token.js';
import { getPairingById, isLive } from './registry.js';

type ProviderRequestFrame = Extract<BridgeFrame, { type: 'provider_request' }>;
type ProviderResponseFrame = Extract<BridgeFrame, { type: 'provider_response' }>;

/** The pairing a provider credential resolves to (§18.4.4). */
export interface ResolvedPairing {
  pairingId: string;
  org: string;
  ownerUserId: string;
}

export interface ProviderDeps {
  /** credential -> exactly one LIVE, non-revoked pairing (§18.4.4 step 1). Throws to reject. */
  resolvePairingByCredential?: (credential: string) => Promise<ResolvedPairing>;
  /** conversation id -> its owning org (§18.4.4 step 3). Undefined => unknown session (rejected). */
  resolveSessionOrg?: (sessionId: string) => Promise<string | undefined>;
  /** The chokepoint completion. Default: the llm/ gateway pass-through (anonymise + attribute +
   *  meter; FIXED-13). The `correlationId` is recorded on the hosted anon-audit so it joins the
   *  daemon's egress-ledger row (§18.5 S6). Injected as a fake in tests. */
  runCompletion?: (reqBody: Record<string, unknown>, billeeUserId: string, correlationId: string) => Promise<{ status: number; body: string }>;
  getActivation?: (userId: string) => { active: boolean; billingLocked: boolean } | undefined;
}

export interface ProviderOutcome {
  /** The frame to send back to the daemon (always a `provider_response`, correlated by id). */
  frame: ProviderResponseFrame;
  /** false when the request was rejected before any model call (auth/cross-org/activation). */
  ok: boolean;
  /** Stable reason for server-side audit/logging on a rejection. */
  reason?: string;
}

export interface ProviderHandler {
  handle(frame: ProviderRequestFrame): Promise<ProviderOutcome>;
}

/** Default credential resolution (§18.4.4 step 1). The pairing-bound provider credential is the
 *  bridge-token class ({org, pairing} scoping): it names its pairing, which the registry resolves
 *  to its org — the request never asserts its own org. A credential that does not verify, or
 *  resolves to no live / a revoked pairing, is rejected. */
async function defaultResolvePairingByCredential(credential: string): Promise<ResolvedPairing> {
  let pairingId: string;
  try {
    pairingId = readBridgeToken(credential).pairingId;
  } catch {
    throw new BridgeAuthError('invalid-credential', 'provider credential did not verify');
  }
  const row = await getPairingById(pairingId);
  if (!row || row.revokedAt !== null || !isLive(pairingId)) {
    throw new BridgeAuthError('no-live-pairing', 'credential resolves to no live, non-revoked pairing');
  }
  return { pairingId: row.pairingId, org: row.org, ownerUserId: row.ownerUserId };
}

/** Default conversation -> org resolution (§18.4.4 step 3): the session's user's org. */
async function defaultResolveSessionOrg(sessionId: string): Promise<string | undefined> {
  const s = (await sessions.get(sessionId)) as { userId?: string } | null;
  if (!s?.userId) return undefined;
  const u = (await users.get(s.userId)) as { orgId?: string } | null;
  return u?.orgId ?? undefined;
}

/** Build an Anthropic-style error response frame, correlated so the daemon's pending request
 *  resolves. `errorType` carries the CONV-2 code for activation refusals (§18.4.4). */
function errorFrame(correlationId: string, errorType: string, message: string): ProviderResponseFrame {
  return { type: 'provider_response', correlationId, body: { type: 'error', error: { type: errorType, message } } };
}

/** Set the propagated conversation id on the request metadata so the chokepoint keys the
 *  anonymisation vault by {org, session} (§18.4.3, §17.5). */
function withSessionIdentity(body: unknown, session: string): Record<string, unknown> {
  const obj = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {};
  const meta = obj.metadata && typeof obj.metadata === 'object' ? { ...(obj.metadata as Record<string, unknown>) } : {};
  meta.session_id = session;
  obj.metadata = meta;
  return obj;
}

/** Parse a provider body string to an object when possible (the frame body is `unknown`; the daemon
 *  gets a JSON object), else pass the raw string through. */
function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * Build the provider-request handler. The composition root wires the default deps (real chokepoint
 * + real registry + real session resolution); tests inject fakes to exercise the auth chain without
 * a model.
 */
export function createProviderHandler(deps: ProviderDeps = {}): ProviderHandler {
  const resolvePairing = deps.resolvePairingByCredential ?? defaultResolvePairingByCredential;
  const resolveSessionOrg = deps.resolveSessionOrg ?? defaultResolveSessionOrg;
  const runCompletion = deps.runCompletion ?? proxyGatewayMessages;
  const getActivation = deps.getActivation ?? defaultGetActivation;

  return {
    async handle(frame: ProviderRequestFrame): Promise<ProviderOutcome> {
      const { correlationId, session, credential, body } = frame;

      // 1. credential -> live, non-revoked pairing (§18.4.4 step 1).
      let pairing: ResolvedPairing;
      try {
        pairing = await resolvePairing(credential);
      } catch {
        return { frame: errorFrame(correlationId, 'authentication_error', 'no live pairing for credential'), ok: false, reason: 'no-live-pairing' };
      }

      // Activation admission BEFORE any model call (§18.3.2, §18.4.4). Fail closed on a cache miss.
      const act = getActivation(pairing.ownerUserId);
      if (!act || !act.active) {
        return { frame: errorFrame(correlationId, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.'), ok: false, reason: 'ACCOUNT_DISABLED' };
      }
      if (act.billingLocked) {
        return { frame: errorFrame(correlationId, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.'), ok: false, reason: 'BILLING_LOCKED' };
      }

      // 2 + 3. pairing -> org (registry), and the conversation must belong to that org — checked
      // BEFORE any model call (§18.4.4). org is derived from the pairing, never the request body,
      // so a credential for org A can never name org B's vault.
      const sessionOrg = await resolveSessionOrg(session);
      if (!sessionOrg || sessionOrg !== pairing.org) {
        return { frame: errorFrame(correlationId, 'permission_error', 'conversation does not belong to this pairing org'), ok: false, reason: 'cross-org-session' };
      }

      // Route through the chokepoint: session-identity propagation + attribution to the delegating
      // user + metering all happen inside llm/ (FIXED-13). Only the de-tokenized completion returns.
      // The daemon's per-request correlationId is recorded on the hosted anon-audit (§18.5 S6), so
      // the audit entry and the daemon's egress-ledger row share ONE join key (§18.8 criterion 5).
      const reqBody = withSessionIdentity(body, session);
      const forward = await runCompletion(reqBody, pairing.ownerUserId, correlationId);
      return { frame: { type: 'provider_response', correlationId, body: parseBody(forward.body) }, ok: forward.status >= 200 && forward.status < 300 };
    },
  };
}
