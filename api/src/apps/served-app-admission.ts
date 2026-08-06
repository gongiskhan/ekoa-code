/**
 * The served-app admission plane — the ONE front half every header-scoped app API shares.
 *
 * A served page carries no platform JWT. What it carries is `X-Ekoa-App-Id`, and every plane that
 * acts on the app's behalf (the assistant, the email sender, the document extractor) must answer
 * the same four questions before it does anything: is the header well-formed, does it resolve to a
 * real artifact-backed app, is that app's OWNER in good standing, and which org/user does the work
 * run and bill under. This module answers them once.
 *
 * It exists because the alternative was three copies. `app-assistant-route.ts` grew this logic
 * first; app-email and app-vision need it verbatim, and a gate each caller re-implements is a gate
 * that drifts — one plane tightening its charset check while another keeps the old one is exactly
 * how an admission surface becomes an oracle. Capability Contract rule 1: one implementation.
 *
 * The resolved identity comes ONLY from the server-side artifact record. Nothing here reads the
 * visitor's body, and no caller may pass in an owner — a plane that lets the page name whose
 * mailbox to spend is not a plane, it is a confused deputy.
 */
import type { Request, Response } from 'express';
import { ERROR_STATUS, type ErrorCode } from '@ekoa/shared';
import { collectionName } from '../data/collections-engine.js';
import { getActivation } from '../data/activation.js';
import { users } from '../data/stores.js';
import { resolveApp, type ResolvedApp } from './registry.js';

/** The reserved shared-namespace prefix an app id may never carry. */
const SHARED_SCOPE_PREFIX = 'usr.';

/** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
export function sendAppError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
}

/**
 * Resolve `X-Ekoa-App-Id` to an artifact-backed app. A discriminated result rather than a throw,
 * so each caller maps it onto its own envelope while the DECISION stays identical everywhere:
 * `invalid-id` → 400, `not-found` → 404.
 *
 * A dev-serve / registry-only id has no artifact-backed owner, so it is `not-found` here — these
 * planes need a real owner to scope and bill, and there is no anonymous fallback to degrade to.
 */
export type AppResolution =
  | { status: 'invalid-id' }
  | { status: 'not-found' }
  | { status: 'ok'; app: ResolvedApp };

export async function resolveServedApp(header: unknown): Promise<AppResolution> {
  if (
    typeof header !== 'string' ||
    !collectionName.safeParse(header).success ||
    header.startsWith(SHARED_SCOPE_PREFIX)
  ) {
    return { status: 'invalid-id' };
  }
  const app = await resolveApp(header);
  if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
  return { status: 'ok', app };
}

/** Who the work runs as: the app's owner, and the org whose connections it may spend. */
export interface ServedAppOwner {
  userId: string;
  orgId: string;
}

export interface ServedAppAdmission {
  appId: string;
  owner: ServedAppOwner;
}

/**
 * The full admission: resolve the header, gate on the OWNER's activation (fail-closed — a disabled
 * or billing-locked owner's app cannot spend that owner's connections or model budget), and read
 * the owner's org server-side.
 *
 * Returns `null` after writing the CONV-2 envelope, so a caller is a single `if (!admission) return`.
 */
export async function admitServedApp(req: Request, res: Response): Promise<ServedAppAdmission | null> {
  const resolution = await resolveServedApp(req.header('x-ekoa-app-id'));
  if (resolution.status === 'invalid-id') {
    sendAppError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
    return null;
  }
  if (resolution.status === 'not-found') {
    sendAppError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
    return null;
  }
  const app = resolution.app;

  const activation = getActivation(app.ownerUserId);
  if (!activation || activation.active === false) {
    sendAppError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
    return null;
  }
  if (activation.billingLocked) {
    sendAppError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
    return null;
  }

  const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
  return { appId: app.appId, owner: { userId: app.ownerUserId, orgId: owner?.orgId ?? '' } };
}

/**
 * A sliding-window rate cap, per app AND globally.
 *
 * The global ceiling is the one that matters: a per-app cap alone lets N apps each sit just under
 * their limit and still bury the provider (or the model budget) between them. Both windows are
 * checked before either is charged, so a request refused by one does not consume the other's
 * budget. In-process by design — the same posture as the other served-app planes.
 */
export function makeAppRateLimiter(
  perAppMax: number,
  globalMax: number,
  windowMs = 60_000,
  now: () => number = Date.now,
): (appId: string) => boolean {
  const perAppHits = new Map<string, number[]>();
  let globalHits: number[] = [];
  return (appId: string): boolean => {
    const t = now();
    const recent = (arr: number[]): number[] => arr.filter((ts) => t - ts < windowMs);
    const perApp = recent(perAppHits.get(appId) ?? []);
    const global = recent(globalHits);
    if (perApp.length >= perAppMax || global.length >= globalMax) {
      perAppHits.set(appId, perApp);
      globalHits = global;
      return true; // limited
    }
    perApp.push(t);
    global.push(t);
    perAppHits.set(appId, perApp);
    globalHits = global;
    return false;
  };
}
