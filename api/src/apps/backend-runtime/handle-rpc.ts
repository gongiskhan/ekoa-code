/**
 * Capability handle - the security + lifecycle boundary (Layer 2, B19). Ported
 * from the old services/artifact-backend/handle-rpc.ts, with TWO seams swapped for
 * ekoa-code architecture (ch02 §2.8):
 *
 *   - MODEL capability (`llm.classify` / `llm.complete`): the old code called an
 *     external LLM adapter directly. Here it is an INJECTED, typed async callback
 *     (`deps.callModel`) - the llm/ egress module lands at G7, so this seam is
 *     explicit and default-throws until wired (FIXED-3: no LLM import outside llm/).
 *   - NOTIFY capability (`notify.inApp` / `notify.email`): the delivery side is an
 *     INJECTED callback (`deps.sendToUser` / `deps.sendEmail`) - never an import of
 *     events/ (ch02 §2.8 seam).
 *
 * The worker holds NO DB credentials and NO OAuth tokens. Core mints a short-lived
 * capability token and CORE validates + EXECUTES every call core-side. Two
 * invariants enforced here, not in the worker:
 *   1. appId is FIXED by the token (`claims.artifactId`) - a worker can pass any
 *      collection but can NEVER address another app's data.
 *   2. Billing/owner is FIXED to `claims.ownerUserId` - the worker cannot choose
 *      the billee. Dry-run suppresses + captures persistent effects; reads + model
 *      calls still run.
 */
import jwt from 'jsonwebtoken';
import { loadConfig } from '../../config.js';
import { collectionName } from '../../data/collections-engine.js';

export interface DryRunEffect {
  capability: string;
  detail: Record<string, unknown>;
}

export interface CapabilityClaims {
  artifactId: string;
  ownerUserId: string;
  scopes: string[];
  entrypoint: string;
  dryRun: boolean;
  /** manifest `sharedData: true` opt-in, minted core-side (the worker cannot self-grant). */
  sharedData: boolean;
}

/** Model call the `llm.*` capability routes to (the llm/ egress module wires this at G7). */
export type ModelCapability = (opts: {
  system?: string;
  message: string;
  ownerUserId: string;
  billingArtifactId: string;
  agentType: string;
  language?: string;
}) => Promise<string>;

/** The minimal core surface the capability executor needs (all seams injected). */
export interface CapabilityDeps {
  appData: {
    list(scopeKey: string, collection: string): Promise<Array<Record<string, unknown>>>;
    get(scopeKey: string, collection: string, id: string): Promise<Record<string, unknown> | null>;
    create(scopeKey: string, collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
    update(scopeKey: string, collection: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
    delete(scopeKey: string, collection: string, id: string): Promise<boolean>;
  };
  /** MODEL seam (G7). Default stub throws; owner/billing fixed core-side. */
  callModel: ModelCapability;
  /** NOTIFY seam - in-app delivery (injected; never imports events/). */
  sendToUser(userId: string, event: { type: string; [k: string]: unknown }): void;
  /** NOTIFY seam - email delivery (injected). */
  sendEmail(ownerUserId: string, args: { to: string[]; subject: string; body: string; bodyContentType?: string }): Promise<{ success: boolean; error?: string }>;
  /** Optional external-integration seam (Pipedream connect layer; lands with integrations). */
  runIntegration?(opts: { key: string; action: string; args: Record<string, unknown>; userId: string }): Promise<unknown>;
  now(): number;
}

export interface CapabilityContext {
  claims: CapabilityClaims;
  deps: CapabilityDeps;
  dryRun: boolean;
  dryRunEffects: DryRunEffect[];
  /** True while the artifact's worker is alive; false after shutdown (revocation). */
  isLive(artifactId: string): boolean;
}

/** The collection platform notifications land in (appId-scoped, neutral name). */
export const NOTIFICATIONS_COLLECTION = '_notifications';

/** The default MODEL seam: refuse until the llm/ egress module wires it (G7). */
export const unavailableModelCapability: ModelCapability = async () => {
  throw new Error('llm capability is not available until the egress module lands (G7)');
};

export function mintCapabilityToken(claims: CapabilityClaims, ttlSec: number): string {
  return jwt.sign(claims, loadConfig().jwtSecret, { expiresIn: ttlSec });
}

export function verifyCapabilityToken(token: string): CapabilityClaims | null {
  try {
    const p = jwt.verify(token, loadConfig().jwtSecret) as Partial<CapabilityClaims>;
    if (typeof p.artifactId !== 'string' || typeof p.ownerUserId !== 'string') return null;
    return {
      artifactId: p.artifactId,
      ownerUserId: p.ownerUserId,
      scopes: Array.isArray(p.scopes) ? p.scopes : [],
      entrypoint: typeof p.entrypoint === 'string' ? p.entrypoint : '',
      dryRun: Boolean(p.dryRun),
      sharedData: Boolean(p.sharedData),
    };
  } catch {
    return null;
  }
}

/** The owner-shared scope key `usr.<owner>` (matches the served plane's sharedScope). */
function sharedScopeKey(claims: CapabilityClaims): string {
  if (!claims.sharedData) {
    throw new Error('artifact has not opted into shared data (set manifest.sharedData: true)');
  }
  return `usr.${claims.ownerUserId}`;
}

/**
 * Execute one capability call core-side. Throws on an unknown/forbidden method or
 * an underlying failure. All appId scoping + billing identity comes from the token.
 */
export async function executeCapability(
  method: string,
  args: Record<string, unknown>,
  ctx: CapabilityContext,
): Promise<unknown> {
  const { claims, deps } = ctx;
  if (!ctx.isLive(claims.artifactId)) throw new Error('artifact backend capability has been revoked');
  const appId = claims.artifactId; // FIXED by core.

  switch (method) {
    case 'appData.list':
      return deps.appData.list(appId, coll(args));
    case 'appData.get':
      return deps.appData.get(appId, coll(args), str(args.id));
    case 'appData.create':
      if (ctx.dryRun) return captureEffect(ctx, 'appData.create', { collection: coll(args), data: args.data });
      return deps.appData.create(appId, coll(args), obj(args.data));
    case 'appData.update':
      if (ctx.dryRun) return captureEffect(ctx, 'appData.update', { collection: coll(args), id: str(args.id), patch: args.patch });
      return deps.appData.update(appId, coll(args), str(args.id), obj(args.patch));
    case 'appData.delete':
      if (ctx.dryRun) return captureEffect(ctx, 'appData.delete', { collection: coll(args), id: str(args.id) });
      return deps.appData.delete(appId, coll(args), str(args.id));

    case 'appData.shared.list':
      return deps.appData.list(sharedScopeKey(claims), coll(args));
    case 'appData.shared.get':
      return deps.appData.get(sharedScopeKey(claims), coll(args), str(args.id));
    case 'appData.shared.create':
      if (ctx.dryRun) return captureEffect(ctx, 'appData.shared.create', { collection: coll(args), data: args.data });
      return deps.appData.create(sharedScopeKey(claims), coll(args), obj(args.data));
    case 'appData.shared.update':
      if (ctx.dryRun) return captureEffect(ctx, 'appData.shared.update', { collection: coll(args), id: str(args.id), patch: args.patch });
      return deps.appData.update(sharedScopeKey(claims), coll(args), str(args.id), obj(args.patch));
    case 'appData.shared.delete':
      if (ctx.dryRun) return captureEffect(ctx, 'appData.shared.delete', { collection: coll(args), id: str(args.id) });
      return deps.appData.delete(sharedScopeKey(claims), coll(args), str(args.id));

    // MODEL seam - always runs (owner pays; worker cannot choose billee/tier).
    case 'llm.classify':
    case 'llm.complete':
      return deps.callModel({
        system: typeof args.system === 'string' ? args.system : undefined,
        message: str(args.message),
        ownerUserId: claims.ownerUserId,
        billingArtifactId: appId,
        agentType: `artifact-backend:${claims.entrypoint}`,
        language: typeof args.language === 'string' ? args.language : undefined,
      });

    // NOTIFY seam (scoped to owner; suppressed in dry-run).
    case 'notify.inApp': {
      const detail = { title: str(args.title), body: str(args.body), meta: args.meta ?? null };
      if (ctx.dryRun) return captureEffect(ctx, 'notify.inApp', detail);
      const row = await deps.appData.create(appId, NOTIFICATIONS_COLLECTION, {
        title: detail.title, body: detail.body, meta: detail.meta, read: false,
        createdAt: new Date(deps.now()).toISOString(),
      });
      deps.sendToUser(claims.ownerUserId, {
        type: 'artifact_notification', artifactId: appId, notificationId: row.id, title: detail.title, body: detail.body,
      });
      return { delivered: true, id: row.id };
    }
    case 'notify.email': {
      const to = buildEmailRecipientAddresses(args.to);
      const detail = { to, subject: str(args.subject) };
      if (ctx.dryRun) return captureEffect(ctx, 'notify.email', detail);
      const r = await deps.sendEmail(claims.ownerUserId, {
        to, subject: str(args.subject), body: str(args.body),
        bodyContentType: typeof args.bodyContentType === 'string' ? args.bodyContentType : undefined,
      });
      if (!r.success) throw new Error(`notify.email failed: ${r.error ?? 'unknown'}`);
      return { sent: true };
    }

    case 'integration.call': {
      const key = str(args.key);
      if (!/^pipedream:[\w-]+$/.test(key)) throw new Error('integration.call supports only pipedream:* keys');
      const action = str(args.action);
      const callArgs = obj(args.args);
      if (ctx.dryRun) return captureEffect(ctx, 'integration.call', { key, action, args: callArgs });
      if (!deps.runIntegration) throw new Error('integration.call is not available (no integration seam wired)');
      return deps.runIntegration({ key, action, args: callArgs, userId: claims.ownerUserId });
    }

    default:
      throw new Error(`unknown capability method: ${method}`);
  }
}

function coll(args: Record<string, unknown>): string {
  const c = str(args.collection);
  if (!collectionName.safeParse(c).success) throw new Error(`invalid collection name: ${c}`);
  return c;
}

function captureEffect(ctx: CapabilityContext, capability: string, detail: Record<string, unknown>): { dryRun: true; id: string } {
  ctx.dryRunEffects.push({ capability, detail });
  return { dryRun: true, id: `dry-${ctx.dryRunEffects.length}` };
}

export function buildEmailRecipientAddresses(to: unknown): string[] {
  const raw = Array.isArray(to) ? to : [to];
  return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
