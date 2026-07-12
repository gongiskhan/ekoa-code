/**
 * Served-app static serving (ch07 §7.5-§7.7; carryover B4 - extracted from the old
 * monolith, logic unchanged; FIXED-9). The request pipeline for GET /apps/:idOrSlug/*
 * is carried in exactly this order: 301 trailing-slash redirect -> canonical id
 * resolution (slug first, raw id fallback) -> shareability gate on document requests
 * only (revoked -> 410 PT page, owner bypass via Authorization header / ekoa_token
 * cookie / ?token= query) -> dist resolution via the registry -> lazy heal from the
 * persisted artifact record -> "Building..." responses (uncacheable: 503 plain text
 * for asset extensions, 200 auto-refreshing (3 s) HTML for navigations - a cached
 * 200 HTML body under an asset URL would later execute as JavaScript and permanently
 * brick the app) -> HTML through the context injector with no-cache headers ->
 * cached static middleware with the carried cache discipline (HTML no-cache; hashed
 * js/css 1 year immutable; non-hashed bundle.js/bundle.css no-cache for hot reload;
 * everything else 1 hour). A static miss on an asset path returns JSON 404 (never
 * HTML-as-JS); a navigation miss falls back SPA-style to the injected index.html.
 * All /apps/* responses carry Access-Control-Allow-Origin: *.
 *
 * Also on this plane: GET /__ekoa/demo-bridge.js (the guided-tour client) and
 * POST /api/app-health (the injected probe's report sink: unknown ids dropped
 * silently, featured artifacts skipped, 60 s same-status dedupe, verdict persisted
 * on the artifact record).
 *
 * Auth is NOT imported here (module tiers, ch02 §2.7): the owner-bypass token
 * verifier is injected by the composition root (server.ts), seam-style.
 */
import { Router, static as expressStatic, type Request, type Response } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import { appRegistry } from './app-registry.js';
import { getAppIdBySlug } from './slug-index.js';
import { lookupShareable } from './share-lookup.js';
import { injectAppContext } from './injected-context.js';
import { listDemoCards, getDemoSpec, demoAssetsDir } from '../services/demo-registry.js';
import { resolveWithinJail } from '../services/safe-path.js';
import { verifyPreviewToken } from '../services/preview-token.js';
import { artifacts, jobs } from '../data/stores.js';
import type { Doc } from '../data/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Regex for asset file extensions (not HTML-serving paths). Carried. */
const ASSET_EXT_RE = /\.(js|css|map|json|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/i;

export interface ServingDeps {
  /** Verify a platform JWT and return its claims (or throw). Injected from server.ts
   *  so apps/ never imports auth/ (ch02 §2.7). */
  verifyToken: (token: string) => { sub: string };
  /** Optional lazy-hydration hook (ch07 §7.9): clone a missing working copy back
   *  from the GitHub mirror. Wired by server.ts once the git pipeline is present. */
  hydrateAppRepoIfMissing?: (projectDir: string, appId: string) => Promise<{ hydrated: boolean }>;
  /** Optional rebuild hook used after a successful hydration. */
  rebuildApp?: (appId: string, projectDir: string) => Promise<unknown>;
}

/** Resolve the dist directory for a registered app (slug fallback). Carried. */
function resolveAppDistDir(appId: string): string | null {
  let app = appRegistry.getApp(appId);
  if (!app) {
    const resolvedId = getAppIdBySlug(appId);
    if (resolvedId) app = appRegistry.getApp(resolvedId);
  }
  if (!app) return null;
  if (!existsSync(app.distDir)) return null;
  return app.distDir;
}

interface ServedJobRow extends Doc { status?: string; artifactId?: string; createdAt?: string; error?: { code: string; message: string } }

/**
 * The served-app build disposition for an artifact (F7). Distinguishes a genuinely FAILED build
 * with nothing good to serve from a mid-build window and from a failed REBUILD over a previously
 * good app. Returns `failed` ONLY when no build ever completed AND the most recent build failed —
 * then serving shows an honest failed-state page instead of a scaffold shell or a "Building…"
 * spinner forever. A prior completed build (stale-good) always wins: its dist keeps serving.
 */
async function servedBuildDisposition(artifactId: string): Promise<'failed' | 'ok' | 'building'> {
  const rows = (await jobs.find({ artifactId })) as ServedJobRow[];
  if (rows.length === 0) return 'building'; // no build history -> not our failed state
  if (rows.some((j) => j.status === 'completed')) return 'ok'; // a prior good build exists (stale-good wins)
  const latest = rows.reduce((a, b) => ((a.createdAt ?? '') >= (b.createdAt ?? '') ? a : b));
  return latest.status === 'failed' ? 'failed' : 'building';
}

/**
 * The honest "build failed" state (F7): a failed build must NOT serve a scaffold shell or spin on
 * "Building…" forever. Never cacheable. Assets get a 503 plain-text; navigations get a 200 HTML
 * page stating the build failed — no auto-refresh loop, no bundle references (the error DETAIL is
 * F8's user-grade-error concern; this page just stops the lie).
 */
function sendAppBuildFailedResponse(req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (ASSET_EXT_RE.test(req.path)) {
    res.status(503).type('text/plain').send('/* app build failed */');
    return;
  }
  res.status(200).setHeader('Content-Type', 'text/html').send(`<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8"><title>A construção falhou</title>
<style>
  body { display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; font-family:system-ui,sans-serif; background:#fafafa; color:#525252; }
  .container { text-align:center; max-width:28rem; padding:1.5rem; }
  h1 { font-size:1.25rem; color:#b91c1c; margin:0 0 0.5rem; }
  p { font-size:0.875rem; margin:0.25rem 0; }
</style>
</head><body>
<div class="container">
  <h1>A construção falhou</h1>
  <p>Não foi possível construir esta aplicação.</p>
  <p>Reveja o pedido e tente construir novamente.</p>
</div>
</body></html>`);
}

/**
 * The "app isn't ready yet" response (carried verbatim). CRITICAL: never cacheable.
 * Assets get an uncacheable 503 plain-text; navigations get an uncacheable 200
 * auto-refreshing (3 s) placeholder.
 */
function sendAppBuildingResponse(req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (ASSET_EXT_RE.test(req.path)) {
    res.status(503).type('text/plain').send('/* app build not ready */');
    return;
  }
  res.status(200).setHeader('Content-Type', 'text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Building...</title>
<style>
  body { display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; font-family:system-ui,sans-serif; background:#fafafa; color:#525252; }
  .container { text-align:center; }
  .spinner { width:32px; height:32px; border:3px solid #e5e5e5; border-top-color:#0d9488; border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 16px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  p { font-size:14px; margin:4px 0; }
  .sub { font-size:12px; color:#a3a3a3; }
</style>
</head><body>
<div class="container">
  <div class="spinner"></div>
  <p>Building your app...</p>
  <p class="sub">This page will refresh automatically when the build is ready.</p>
</div>
<script>setTimeout(function(){location.reload()},3000);</script>
</body></html>`);
}

/**
 * Lazy heal (ch07 §7.5 step 5, carried): register an app from its persisted
 * artifact record when it is on disk but missing from the registry; optionally
 * hydrate a missing working copy from the GitHub mirror and rebuild. Constrained
 * to the sandbox tree / featured-builds mirror; registers only when
 * dist/index.html exists.
 */
async function tryRegisterAppFromInstance(appId: string, deps: ServingDeps): Promise<boolean> {
  try {
    const resolvedId = getAppIdBySlug(appId) || appId;
    const artifact = await artifacts.get(resolvedId);
    if (!artifact) return false;

    const rawProjectDir = (artifact.data as Record<string, unknown> | undefined)?.projectDir;
    if (typeof rawProjectDir !== 'string' || rawProjectDir.length === 0) return false;

    // JAIL the artifact-record projectDir before trusting it (ch09 invariant 10):
    // `data` is a client-writable bag (ArtifactPatch permits `data`), so a raw
    // `startsWith(sandboxRoot)` accepts `<sandboxRoot>/../outside` (the string starts
    // with the root but `..` escapes it) and would then serve arbitrary on-disk files.
    // resolveWithinJail normalizes + confines + symlink-checks; an escape throws.
    const sandboxRoot = process.env.SANDBOX_ROOT || join(homedir(), '.ekoa', 'sandboxes');
    const featuredRoot = process.env.EKOA_FEATURED_BUILDS_DIR || join(homedir(), '.ekoa', 'data', 'featured-builds');
    let projectDir: string;
    let underSandbox: boolean;
    try {
      projectDir = resolveWithinJail(sandboxRoot, rawProjectDir);
      underSandbox = true;
    } catch {
      try {
        projectDir = resolveWithinJail(featuredRoot, rawProjectDir);
        underSandbox = false;
      } catch {
        return false; // outside both jails - refuse to heal/serve
      }
    }

    if (!existsSync(projectDir) && underSandbox && deps.hydrateAppRepoIfMissing) {
      const hydrated = await deps.hydrateAppRepoIfMissing(projectDir, resolvedId).catch((err) => {
        console.warn(`[apps] hydrate(${resolvedId}) failed:`, err instanceof Error ? err.message : err);
        return { hydrated: false } as const;
      });
      if (hydrated.hydrated && deps.rebuildApp) {
        try {
          await deps.rebuildApp(resolvedId, projectDir);
        } catch (err) {
          console.warn(`[apps] post-hydrate build(${resolvedId}) failed:`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (!existsSync(join(projectDir, 'dist', 'index.html'))) return false;

    await appRegistry.register(resolvedId, projectDir, artifact.userId as string, artifact.name as string);
    return true;
  } catch (err) {
    console.warn(`[apps] tryRegisterAppFromInstance(${appId}) failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Cache discipline (carried verbatim): HTML no-cache; hashed js/css immutable 1y;
 *  non-hashed js/css no-cache (hot reload); everything else 1 hour. */
function setCacheHeaders(res: ServerResponse, filePath: string): void {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }
  const hasHash = /\.[a-f0-9]{6,}\./.test(filePath);
  if ((ext === '.js' || ext === '.css') && hasHash) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }
  if (ext === '.js' || ext === '.css') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
}

const staticHandlerCache = new Map<string, ReturnType<typeof expressStatic>>();

function getStaticHandler(distDir: string): ReturnType<typeof expressStatic> {
  let handler = staticHandlerCache.get(distDir);
  if (!handler) {
    handler = expressStatic(distDir, {
      index: ['index.html'],
      setHeaders: (res, filePath) => setCacheHeaders(res, filePath),
    });
    staticHandlerCache.set(distDir, handler);
  }
  return handler;
}

// In-memory dedupe for the unauthenticated app-health probe (carried: per-restart
// only; the next divergent report writes through). Keyed by resolved appId.
const APP_HEALTH_DEDUPE_MS = 60_000;
const appHealthLastSeen = new Map<string, { status: 'healthy' | 'broken'; at: number }>();

export function __resetAppHealthDedupeForTests(): void {
  appHealthLastSeen.clear();
}

/** The demo-bridge client (guided-tour postMessage machine), served at
 *  /__ekoa/demo-bridge.js. Ported verbatim as a data asset. */
const DEMO_BRIDGE_PATH = join(__dirname, '..', '..', 'assets', 'demo-bridge-client.js');
let demoBridgeSource = '/* ekoa demo bridge unavailable */';
try {
  demoBridgeSource = readFileSync(DEMO_BRIDGE_PATH, 'utf-8');
} catch (err) {
  console.error('[demo-bridge] client unavailable:', err instanceof Error ? err.message : String(err));
}

/** The in-page action runtime (executes a generated app's declared ui_actions;
 *  operator-run C3), served at /__ekoa/action-runtime.js. Same read-once-at-boot
 *  posture and unavailable-fallback as the demo bridge. */
const ACTION_RUNTIME_PATH = join(__dirname, '..', '..', 'assets', 'action-runtime-client.js');
let actionRuntimeSource = '/* ekoa action runtime unavailable */';
try {
  actionRuntimeSource = readFileSync(ACTION_RUNTIME_PATH, 'utf-8');
} catch (err) {
  console.error('[action-runtime] client unavailable:', err instanceof Error ? err.message : String(err));
}

export function servingRouter(deps: ServingDeps): Router {
  const r = Router();

  // All /apps/* responses carry CORS * (carried; §7.5).
  r.use('/apps', (_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
  });

  r.use('/apps/:appId', async (req: Request, res: Response) => {
    const appId = req.params.appId as string;

    // 301 trailing-slash redirect (carried): without it the browser resolves the
    // app's relative asset URLs against /apps/ and every asset 404s.
    const urlPath = req.originalUrl.split('?')[0] as string;
    if (req.path === '/' && !urlPath.endsWith('/')) {
      res.redirect(301, `${urlPath}/${req.originalUrl.slice(urlPath.length)}`);
      return;
    }

    // Canonical id: slug lookup first, raw id fallback (data stability; §7.5 step 2).
    const canonicalAppId = getAppIdBySlug(appId) || appId;

    // Shareability gate (§7.7): DOCUMENT requests only - browsers do not propagate
    // ?token= on sub-resource fetches, so gating assets would blank the iframe; the
    // HTML gate is the security boundary. Hardening over the old plane (which skipped
    // this for any registry hit): a revoked-then-registered artifact reached by its
    // canonical id must still 410. lookupShareable returns `ok` for featured artifacts
    // (revoke does not apply) and `not-found` for dev-serve/unregistered apps (no
    // artifact record - they fall through and serve), so only a genuinely revoked
    // artifact is gated. See RUN_LOG (G6 review, Codex finding 1).
    if (!ASSET_EXT_RE.test(req.path)) {
      const lookup = await lookupShareable(appId);
      if (lookup.kind === 'revoked') {
        // Owners may view their own non-shareable artifacts. Requester-token
        // resolution order carried: Authorization header, ekoa_token cookie,
        // ?token= query (Q-05 resolved).
        const cookieHeader = (req.headers.cookie || '') as string;
        const cookieToken = /(?:^|;\s*)ekoa_token=([^;]+)/.exec(cookieHeader)?.[1];
        const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/, '') || undefined;
        const queryToken = (req.query.token as string | undefined) || undefined;
        const token = headerToken || cookieToken || queryToken;

        let isOwner = false;
        if (token) {
          // Purpose-scoped preview token first (the per-build verifier's capability: view THIS
          // artifact only, short TTL - never a user JWT in an agent transcript).
          const previewArtifactId = verifyPreviewToken(token);
          if (previewArtifactId && previewArtifactId === canonicalAppId) {
            isOwner = true;
          } else {
            try {
              const claims = deps.verifyToken(token);
              const resolvedAppId = getAppIdBySlug(appId) || appId;
              const artifact = await artifacts.get(resolvedAppId);
              if (artifact && artifact.userId === claims.sub) isOwner = true;
            } catch {
              /* invalid token -> not the owner */
            }
          }
        }

        if (!isOwner) {
          res
            .status(410)
            .setHeader('Content-Type', 'text/html')
            .send(
              '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:3rem;">' +
                '<h2>Link já não disponível</h2>' +
                '<p>O autor revogou a partilha deste artefacto.</p>' +
                '</body></html>',
            );
          return;
        }
        // Owner: fall through to static serving below.
      }
    }

    // Honest failed-build state (F7): before serving anything, if this artifact's build genuinely
    // FAILED (never activated, no build ever completed, latest build failed) show a failed-state
    // page rather than a scaffold shell (a registered failed dist) or a "Building…" spinner
    // forever. A prior completed build (stale-good) or an in-flight build is NOT gated here. A
    // store error must NEVER break serving — fall through to the normal path on any failure.
    try {
      const failArtifact = (await artifacts.get(canonicalAppId)) as (Doc & { status?: string }) | null;
      if (failArtifact && failArtifact.status !== 'active' && (await servedBuildDisposition(canonicalAppId)) === 'failed') {
        sendAppBuildFailedResponse(req, res);
        return;
      }
    } catch {
      /* disposition check unavailable (store hiccup) — never block serving; fall through */
    }

    let distDir = resolveAppDistDir(appId);

    // Lazy heal (§7.5 step 5): one-shot; falls through to the placeholder on failure.
    if (!distDir) {
      const healed = await tryRegisterAppFromInstance(appId, deps);
      if (healed) distDir = resolveAppDistDir(appId);
    }

    if (!distDir) {
      sendAppBuildingResponse(req, res);
      return;
    }

    // HTML requests (any non-asset path - this is also the deep-route entry):
    // inject the context and serve with no-cache. A dist without index.html is
    // the mid-build window -> the placeholder, never a dead-end 404.
    if (!ASSET_EXT_RE.test(req.path)) {
      const indexPath = join(distDir, 'index.html');
      try {
        const html = readFileSync(indexPath, 'utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Type', 'text/html');
        res.send(injectAppContext(html, canonicalAppId));
        return;
      } catch {
        sendAppBuildingResponse(req, res);
        return;
      }
    }

    const staticHandler = getStaticHandler(distDir);
    staticHandler(req, res, () => {
      // Static miss. Asset extension -> JSON 404 (HTML-as-JS causes parse errors);
      // navigation -> SPA fallback to the injected index.html.
      if (ASSET_EXT_RE.test(req.path)) {
        res.status(404).json({ error: `Asset not found: ${req.path}` });
        return;
      }
      const indexPath = join(distDir as string, 'index.html');
      try {
        const html = readFileSync(indexPath, 'utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Type', 'text/html');
        res.send(injectAppContext(html, canonicalAppId));
      } catch {
        res.status(404).json({ error: 'App has no index.html' });
      }
    });
  });

  // Demo bridge client (§7.6; ch03 §3.8.23) - headers carried.
  r.get('/__ekoa/demo-bridge.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(demoBridgeSource);
  });

  // In-page action runtime (operator-run C3) - same byte-serving posture as the
  // demo bridge (JS content-type, CORS *, 5-min cache).
  r.get('/__ekoa/action-runtime.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(actionRuntimeSource);
  });

  // Public demo registry (ch03 §3.8.23, carried): versioned demo specs + assets.
  // ALL public (pre-login landing panel + cross-origin served apps). Assets mount
  // BEFORE /:appId so an asset path is never mistaken for an appId; fallthrough
  // off -> 404 on miss, dotfiles denied (path-traversal posture carried).
  r.use('/api/demos/assets', (_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cache-Control', 'public, max-age=3600');
    next();
  });
  r.use(
    '/api/demos/assets',
    expressStatic(demoAssetsDir(), { maxAge: '1h', fallthrough: false, index: false, dotfiles: 'deny' }),
  );
  r.get('/api/demos', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ demos: listDemoCards() });
  });
  r.get('/api/demos/:appId', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const spec = getDemoSpec(String(req.params.appId || ''));
    if (!spec) {
      res.status(404).json({ error: 'Demonstração não encontrada' });
      return;
    }
    res.json(spec);
  });

  // In-page health probe sink (§7.11, carried): no auth (probes have no token);
  // identity from X-Ekoa-App-Id (id or slug); unknown ids dropped silently;
  // featured artifacts skipped; 60 s same-status dedupe; verdict persisted.
  r.post('/api/app-health', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
      if (!headerId) {
        res.status(204).end();
        return;
      }
      const resolvedId = getAppIdBySlug(headerId) || headerId;
      const artifact = await artifacts.get(resolvedId);
      if (!artifact || artifact.featured === true) {
        res.status(204).end();
        return;
      }

      const body = req.body as {
        status?: 'healthy' | 'broken';
        reason?: 'uncaught-error' | 'unhandled-rejection' | 'empty-dom' | null;
        errorMessage?: string | null;
        capturedAt?: string;
      };
      const status = body?.status;
      if (status !== 'healthy' && status !== 'broken') {
        res.status(204).end();
        return;
      }

      const prior = appHealthLastSeen.get(resolvedId);
      const now = Date.now();
      if (prior && prior.status === status && now - prior.at < APP_HEALTH_DEDUPE_MS) {
        res.status(204).end();
        return;
      }
      appHealthLastSeen.set(resolvedId, { status, at: now });

      const health: Record<string, unknown> = {
        status,
        lastCheckedAt: body?.capturedAt || new Date().toISOString(),
      };
      if (status === 'broken') {
        if (body?.reason) health.lastReason = body.reason;
        if (typeof body?.errorMessage === 'string' && body.errorMessage.length > 0) {
          health.lastError = body.errorMessage.slice(0, 500);
        }
      }

      await artifacts.update(resolvedId, (a) => ({ ...a, health }));
      res.status(204).end();
    } catch (err) {
      // Telemetry endpoint - never surface failure to the probe, never crash.
      console.error('[app-health] report failed:', err instanceof Error ? err.message : err);
      res.status(204).end();
    }
  });

  return r;
}
