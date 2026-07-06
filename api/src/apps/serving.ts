/**
 * Served-app static serving + context injection (ch07 §7.5, §7.6) — byte-compatible.
 * GET /apps/:idOrSlug/ serves the app's built HTML with the window.__ekoa handle injected,
 * `<base href="/apps/<id>/">`, and the demo-bridge script. This is the exact contract the
 * 37 legal e2e specs drive through the injected handle. Serving pipeline order (§7.5):
 * trailing-slash redirect → canonical id resolution → shareability gate → HTML injection.
 *
 * The dist bytes come from the app registry (built by the esbuild pipeline). This module owns
 * the byte-compatible WIRE surface; the build pipeline (esbuild) fills dist and lands next.
 */
import { Router, type Request, type Response } from 'express';
import { resolveApp } from './registry.js';
import { artifacts } from '../data/stores.js';

/** The window.__ekoa context script injected into every served-app HTML (§7.6). */
export function ekoaContextScript(appId: string): string {
  return `<script>
window.__EKOA_APP_ID=${JSON.stringify(appId)};
(function(){
  var base='/api/app-data/', shared='/api/app-shared/', H={'X-Ekoa-App-Id':window.__EKOA_APP_ID,'Content-Type':'application/json'};
  function j(r){return r.then(function(x){return x.json()})}
  function crud(root){return{
    list:function(c){return j(fetch(root+c,{headers:H}))},
    get:function(c,i){return j(fetch(root+c+'/'+i,{headers:H}))},
    create:function(c,d){return j(fetch(root+c,{method:'POST',headers:H,body:JSON.stringify(d)}))},
    update:function(c,i,d){return j(fetch(root+c+'/'+i,{method:'PUT',headers:H,body:JSON.stringify(d)}))},
    delete:function(c,i){return j(fetch(root+c+'/'+i,{method:'DELETE',headers:H}))}
  }}
  window.__ekoa=Object.assign({fetch:function(u,o){o=o||{};o.headers=Object.assign({'X-Ekoa-App-Id':window.__EKOA_APP_ID},o.headers||{});return fetch(u,o)}},crud(base),{shared:crud(shared)});
})();
</script>`;
}

/** Inject the context handle, base href, and demo-bridge into an app's HTML (§7.6). */
export function injectContext(html: string, appId: string): string {
  const head = `<base href="/apps/${appId}/">\n${ekoaContextScript(appId)}\n<script src="/__ekoa/demo-bridge.js"></script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${head}`);
  return `${head}\n${html}`;
}

export function servingRouter(): Router {
  // strict routing so `/apps/x` (no slash) and `/apps/x/` (slash) are distinct routes —
  // otherwise the trailing-slash redirect would match `/apps/x/` and loop forever.
  const r = Router({ strict: true });

  // Trailing-slash redirect (§7.5 step 1): /apps/slug → /apps/slug/
  r.get('/apps/:idOrSlug', (req: Request, res: Response) => {
    res.redirect(301, `/apps/${req.params.idOrSlug}/`);
  });

  r.get('/apps/:idOrSlug/', async (req: Request, res: Response) => {
    const app = await resolveApp(req.params.idOrSlug as string);
    if (!app) return res.status(404).type('html').send('<!doctype html><title>Not found</title>');
    const art = await artifacts.get(app.appId);
    // Shareability gate on document requests (§7.5 step 3): non-shareable needs a token.
    const shareable = Boolean((art as { shareable?: boolean } | null)?.shareable);
    if (!shareable && !req.query.token) {
      return res.status(403).type('html').send('<!doctype html><title>Forbidden</title>');
    }
    const dist = (art as { data?: { distHtml?: string } } | null)?.data?.distHtml;
    if (!dist) {
      // "Building…" placeholder — uncacheable auto-refresh (§7.5 step 6).
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).type('html').send('<!doctype html><meta http-equiv="refresh" content="2"><title>Building…</title>');
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.type('html').send(injectContext(dist, app.appId));
  });

  // Demo bridge script (served-app coupling, §7.6).
  r.get('/__ekoa/demo-bridge.js', (_req: Request, res: Response) => {
    res.type('application/javascript').send('/* ekoa demo bridge */window.__EKOA_DEMO_BRIDGE=true;');
  });

  return r;
}
