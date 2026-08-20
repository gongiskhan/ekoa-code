/**
 * automation/screenshot-plane.ts — the AUTHENTICATED per-step screenshot plane (Cofre R-1..R-3; R-3).
 *
 * WHAT THIS REPLACES. `/automation-screenshots` was an `express.static` mount over
 * `<dataDir>/automation-runs` with no auth middleware and no tenant check. `docs/decisions.md`
 * recorded the rationale — an `<img>` cannot carry an Authorization header, so "the unguessable
 * automationId/runId path IS the capability". Two things make that untenable:
 *
 *   1. The PNGs are screenshots of an AUTHENTICATED session on a client's portal. For this product
 *      that means court filings, processo numbers and client NIFs — rendered as pixels, in
 *      cleartext, on an unauthenticated URL, with no tenant check and no expiry.
 *   2. The capability leaks by construction. A run id travels in SSE frames, persisted step
 *      records, the run API, logs and any error report; nothing about it is treated as secret
 *      elsewhere, so "unguessable" is a property the rest of the system does not maintain.
 *
 * THE FIX keeps the `<img>` constraint honest instead of trading the control away: the same
 * short-lived-token-in-the-query-string pattern the SSE stream already uses (`verifySseToken`,
 * because EventSource cannot set headers either). The token is the caller's ordinary platform JWT,
 * so it carries revocation, activation and the token epoch; the handler then resolves the RUN and
 * checks the caller's org and ownership before a single byte is streamed.
 *
 * RETENTION. Nothing ever deleted these PNGs — every reference in `api/src` was a write or a path
 * builder. That is a GDPR erasure gap over an unindexed tree, so the sweeper below is part of the
 * same change rather than a follow-up.
 */
import { createReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Request, Response, Router } from 'express';
import express from 'express';
import { resolveContained, PathContainmentError } from '../security/path-containment.js';
import { automationRunStore, automationRunsRoot } from './persistence.js';
import { automationStore } from './persistence.js';

/** Default retention for per-step screenshots. Overridable per deployment. */
export const DEFAULT_SCREENSHOT_RETENTION_DAYS = 7;

export interface ScreenshotPlaneDeps {
  /** Verify a query-string platform JWT (the SSE-token verifier). */
  verifyQueryToken: (token: string | undefined) =>
    | { ok: true; claims: { sub: string; orgId: string; role: string } }
    | { ok: false; status: number; code: string };
  /** Emitted for the 403 path so a cross-tenant probe is visible in the Registo. */
  onDenied?: (info: { runId: string; actorUserId: string; actorOrg: string }) => void;
}

/**
 * `GET /automation-screenshots/:automationId/:runId/:file`
 *
 * The URL SHAPE is unchanged, so `screenshotUrlFromPath` and every persisted `screenshotUrl` keep
 * working; only the authorization changes. The client appends `?token=<jwt>`.
 */
export function screenshotPlaneRouter(deps: ScreenshotPlaneDeps): Router {
  const r = express.Router();

  r.get('/:automationId/:runId/:file', async (req: Request, res: Response): Promise<void> => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined;
    const auth = deps.verifyQueryToken(token);
    if (!auth.ok) {
      res.status(auth.status).json({ error: { code: auth.code, message: 'authentication required' } });
      return;
    }
    const { automationId, runId, file } = req.params as { automationId: string; runId: string; file: string };

    const run = await automationRunStore.findById(automationId, runId);
    if (!run || run.automationId !== automationId) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'screenshot not found' } });
      return;
    }

    // Ownership. `startRun` stamps every run with orgId + ownerUserId (engine.ts), so the org comes
    // from the run alone: a run with NO org is a pre-stamp legacy row we cannot attribute, and an
    // unattributable artifact is REFUSED rather than served — that is exactly the case the old
    // static mount handed to anyone. The owner falls back to the automation, whose `ownerUserId` is
    // required, so a legacy run under a known automation stays reachable by its owner.
    const automation = await automationStore.findById(automationId);
    const org = run.orgId;
    const owner = run.ownerUserId ?? automation?.ownerUserId;
    const sameOrg = org !== undefined && org === auth.claims.orgId;
    const isOwner = owner !== undefined && owner === auth.claims.sub;
    const isOrgAdmin = auth.claims.role === 'org-admin' || auth.claims.role === 'super-admin';
    if (!sameOrg || !(isOwner || isOrgAdmin)) {
      deps.onDenied?.({ runId, actorUserId: auth.claims.sub, actorOrg: auth.claims.orgId });
      // 404, not 403: a 403 confirms the run exists to a caller from another tenant.
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'screenshot not found' } });
      return;
    }

    // The path segments are request-controlled, so they go through the containment resolver rather
    // than being joined directly (express.static did its own; a hand-rolled join would not).
    let abs: string;
    try {
      abs = resolveContained(automationRunsRoot(), join(automationId, runId, file)).real;
    } catch (err) {
      if (err instanceof PathContainmentError) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'screenshot not found' } });
        return;
      }
      throw err;
    }
    if (!abs.endsWith('.png')) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'screenshot not found' } });
      return;
    }

    try {
      await stat(abs);
    } catch {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'screenshot not found' } });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    // Authenticated, tenant-scoped bytes must never land in a shared cache.
    res.setHeader('Cache-Control', 'private, max-age=60');
    createReadStream(abs).pipe(res);
  });

  return r;
}

/**
 * Delete run-screenshot directories older than `retentionDays`. Best-effort and never throws: a
 * sweep failure must not take down boot or a scheduled tick.
 *
 * Granularity is the RUN directory (its mtime advances as steps are written), so a run is retained
 * or erased as a unit rather than losing individual steps out of the middle of a trace.
 */
export async function sweepExpiredScreenshots(opts?: {
  retentionDays?: number;
  now?: () => number;
  root?: string;
  /**
   * PINNED RUNS - run ids the sweep must spare however old they are (slice S1).
   *
   * An `integration_action_evidence` row for a browser-steps or bash-cli action stores
   * `{runId, stepIndex}` POINTERS into a run's screenshots rather than copies of them, so once the
   * sweep removes that run the integration detail page renders broken images and the "last
   * validated run" a promotion to `trusted` rests on stops being inspectable.
   *
   * THIS IS A RETENTION EXTENSION AND IS TREATED AS ONE. It is bounded to the ONE run each action's
   * LIVE evidence names - evidence is superseded wholesale, so a newly validated run releases the
   * previous pin in the same write - and it never grows with run volume. It is supplied by the
   * CALLER rather than read here, so this module keeps no import edge to `integrations/`.
   *
   * IT IS NOT AN ERASURE STORY, and must not be read as one. This spares a run from the AGE-BASED
   * sweep; there is no erasure request path over these directories at all today
   * (`deleteRunScreenshots` below has no production caller - see the finding of that name in
   * docs/findings.md). A pinned run is therefore retained past 7 days with nothing that can remove
   * it on request, which is a real gap and is recorded as one.
   *
   * Absent ⇒ nothing is pinned and the sweep behaves exactly as it did before this slice.
   */
  pinnedRunIds?: ReadonlySet<string>;
}): Promise<{ removed: number; scanned: number; pinned: number }> {
  const retentionDays = opts?.retentionDays ?? DEFAULT_SCREENSHOT_RETENTION_DAYS;
  const now = opts?.now?.() ?? Date.now();
  const root = opts?.root ?? automationRunsRoot();
  const pinnedRunIds = opts?.pinnedRunIds;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  let scanned = 0;
  let pinned = 0;

  let automationDirs: string[];
  try {
    automationDirs = await readdir(root);
  } catch {
    return { removed: 0, scanned: 0, pinned: 0 }; // no tree yet
  }
  for (const automationId of automationDirs) {
    let runDirs: string[];
    try {
      runDirs = await readdir(join(root, automationId));
    } catch {
      continue;
    }
    for (const runId of runDirs) {
      const dir = join(root, automationId, runId);
      scanned++;
      // The pin is checked BEFORE the mtime, not after the delete: a pinned run is spared without
      // ever becoming a candidate, so no ordering of `stat` failures can drop one.
      if (pinnedRunIds?.has(runId)) {
        pinned++;
        continue;
      }
      try {
        const st = await stat(dir);
        if (st.mtimeMs < cutoff) {
          await rm(dir, { recursive: true, force: true });
          removed++;
        }
      } catch {
        /* raced with another sweep or a live write — skip */
      }
    }
  }
  return { removed, scanned, pinned };
}

/** Erase every screenshot for one run (the delete-on-run-delete / erasure-request path). */
export async function deleteRunScreenshots(automationId: string, runId: string): Promise<void> {
  try {
    const dir = resolveContained(automationRunsRoot(), join(automationId, runId)).real;
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* nothing to erase */
  }
}
