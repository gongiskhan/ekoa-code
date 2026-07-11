/**
 * Artifact PDF export (ch03 §3.8.9/§3.8.23, ch07 §7.12). Ported from the old
 * services/artifact-pdf.ts, adapted to the ekoa-code browser pool
 * (services/browser-pool.ts) and data dir.
 *
 * `GET /artifacts/:id/pdf` renders the built artifact to PDF and 302-redirects to
 * the served file under `/artifact-pdfs/`. The id is CHARSET-GUARDED because it
 * becomes the output basename (`isSafePdfBasename`). The vetted print-reset CSS
 * fixes screen-first pagination bugs (atomic cards/rows split mid-element) WITHOUT
 * touching the source HTML, and imposes no @page margin so full-bleed covers
 * survive. Chromium unavailability degrades explicitly (the route surfaces a 503).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Router, json, type Request, type Response } from 'express';
import { getSharedBrowser } from '../services/browser-pool.js';
import { loadConfig } from '../config.js';

const RENDER_TIMEOUT_MS = 30_000;
const RENDER_SETTLE_MS = 800;
const VIEWPORT = { width: 1280, height: 1600 };

/** The id becomes the output basename - allow only a filesystem-safe charset. */
const PDF_BASENAME = /^[a-zA-Z0-9._-]{1,120}$/;
export function isSafePdfBasename(id: string): boolean {
  return PDF_BASENAME.test(id) && id !== '.' && id !== '..';
}

function pdfDir(): string {
  return join(process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data'), 'artifact-pdfs');
}
export function getArtifactPdfDir(): string {
  return pdfDir();
}
function pdfPathFor(name: string): string {
  return join(pdfDir(), `${name}.pdf`);
}
export function getArtifactPdfUrl(id: string): string | undefined {
  return existsSync(pdfPathFor(id)) ? `/artifact-pdfs/${id}.pdf` : undefined;
}

export type PdfPageFormat = 'A4' | 'Letter' | 'Legal';
export interface PdfRenderOptions {
  format?: PdfPageFormat;
  landscape?: boolean;
  rawCss?: boolean;
}
export interface PdfSource {
  url?: string;
  html?: string;
}
export interface ArtifactPdfResult {
  path: string;
  url: string;
}

/** Vetted print reset, injected LAST (wins) with !important. See §7.12. */
export const PDF_PRINT_RESET_CSS = `
*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
html,body{background:#fff!important}
body,main,header,footer,section,article,div,
[class*="grid"],[class*="list"],[class*="row"],[class*="stack"],
[class*="page"],[class*="sheet"],[class*="body"],[class*="content"],[class*="wrap"]{
  break-inside:auto!important;page-break-inside:auto!important;
  break-before:auto!important;break-after:auto!important;
  page-break-before:auto!important;page-break-after:auto!important;
}
[class*="cover"],[class*="hero"],[class*="title-page"],[class*="titlepage"]{
  break-after:page!important;page-break-after:always!important;
  break-inside:avoid!important;page-break-inside:avoid!important;
}
img,svg,picture,figure,table,thead,tr,pre,blockquote,li,
[class*="card"],[class*="tile"],[class*="item"],[class*="box"]{
  break-inside:avoid!important;page-break-inside:avoid!important;
}
h1,h2,h3,h4,h5,h6,[class*="title"],[class*="heading"],[class*="eyebrow"],[class*="tag"]{
  break-after:avoid!important;page-break-after:avoid!important;
}
.page-break,[data-page-break]{break-before:page!important;page-break-before:always!important}
`;

/**
 * Render a PDF from a served-app URL (or raw HTML) to
 * `<dataDir>/artifact-pdfs/<outName>.pdf`, served at `/artifact-pdfs/<outName>.pdf`.
 * Rejects if the shared browser is unavailable (the route degrades to a 503).
 */
export async function renderArtifactPdf(
  source: PdfSource,
  outName: string,
  opts: PdfRenderOptions = {},
): Promise<ArtifactPdfResult> {
  if (!isSafePdfBasename(outName)) throw new Error('invalid pdf output name');
  mkdirSync(pdfDir(), { recursive: true });

  const browser = await getSharedBrowser();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const filePath = pdfPathFor(outName);
  try {
    if (source.html != null) {
      await page.setContent(source.html, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS });
    } else if (source.url) {
      await page.goto(source.url, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS });
    } else {
      throw new Error('renderArtifactPdf: url or html is required');
    }
    await page.emulateMedia({ media: 'print' });
    if (!opts.rawCss) await page.addStyleTag({ content: PDF_PRINT_RESET_CSS });
    await page.waitForTimeout(RENDER_SETTLE_MS);
    await page.pdf({
      path: filePath,
      format: opts.format ?? 'A4',
      landscape: opts.landscape ?? false,
      printBackground: true,
      preferCSSPageSize: true,
    });
    return { path: filePath, url: `/artifact-pdfs/${outName}.pdf` };
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// App-facing document export (window.__ekoa.exportPdf -> POST /api/app-pdf)
// ---------------------------------------------------------------------------

/** Subresource allowlist for caller-supplied HTML: data/blob/about pass; loopback only on OUR
 *  port (the app's own assets via the injected <base>); private ranges + cloud metadata blocked. */
function isAllowedSubresource(urlStr: string): boolean {
  if (urlStr.startsWith('data:') || urlStr.startsWith('blob:') || urlStr.startsWith('about:')) return true;
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (isLoopback) return u.port === String(loadConfig().port);
  if (host === 'metadata.google.internal') return false;
  if (/^(10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

/** Insert a <base href> so the serialized DOM's relative asset URLs resolve. */
function injectBaseHref(html: string, baseHref: string): string {
  const baseTag = `<base href="${baseHref}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return baseTag + html;
}

/**
 * Render a served app's SERIALIZED DOM (posted via `window.__ekoa.exportPdf`) to a
 * cleanly-paginated PDF (carried from the old services/artifact-pdf.ts). Hardening — the HTML
 * is caller-supplied: page JavaScript is DISABLED (the payload is already-rendered markup) and
 * every subresource fetch is filtered through `isAllowedSubresource`.
 */
export async function renderAppDocumentPdf(
  appId: string,
  html: string,
  opts: PdfRenderOptions = {},
): Promise<ArtifactPdfResult> {
  mkdirSync(pdfDir(), { recursive: true });

  const browser = await getSharedBrowser();
  const page = await browser.newPage({ viewport: VIEWPORT, javaScriptEnabled: false });
  const outName = `${appId}-doc-${Date.now()}`;
  const filePath = pdfPathFor(outName);

  try {
    await page.route('**/*', (route) => {
      if (isAllowedSubresource(route.request().url())) void route.continue();
      else void route.abort();
    });

    const baseHref = `http://localhost:${loadConfig().port}/apps/${appId}/`;
    let content = injectBaseHref(html, baseHref);
    if (!opts.rawCss) {
      // The reset must be the LAST stylesheet so it wins. page.addStyleTag is NOT usable
      // here: it awaits the tag's onload via page JavaScript, which never fires with
      // javaScriptEnabled:false — it hangs forever. Embed the reset in the document instead.
      const resetTag = `<style>${PDF_PRINT_RESET_CSS}</style>`;
      content = content.includes('</body>') ? content.replace('</body>', `${resetTag}</body>`) : content + resetTag;
    }
    await page.setContent(content, { waitUntil: 'networkidle', timeout: RENDER_TIMEOUT_MS });

    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(RENDER_SETTLE_MS);

    // Documents must never render edge-to-edge: when the app declares its own @page geometry it
    // wins (preferCSSPageSize), otherwise apply a sane print margin. The rule usually lives in a
    // LINKED stylesheet (resolved via the injected <base>), so inspect the CSSOM, not the HTML
    // string; page JS being disabled does not affect CDP evaluate. String-evaluate: no DOM lib
    // in the api tsconfig (same pattern as services/branding).
    const declaresPageRule =
      /@page\b/.test(html) ||
      ((await page
        .evaluate(
          `(function () {
            try {
              var sheets = Array.prototype.slice.call(document.styleSheets);
              for (var i = 0; i < sheets.length; i++) {
                var rules;
                try { rules = sheets[i].cssRules; } catch (e) { continue; }
                for (var j = 0; j < (rules ? rules.length : 0); j++) {
                  if (rules[j].constructor && rules[j].constructor.name === 'CSSPageRule') return true;
                }
              }
            } catch (e) {}
            return false;
          })()`,
        )
        .catch(() => false)) as boolean);
    await page.pdf({
      path: filePath,
      format: opts.format ?? 'A4',
      landscape: opts.landscape ?? false,
      printBackground: true,
      preferCSSPageSize: true,
      ...(declaresPageRule ? {} : { margin: { top: '22mm', bottom: '22mm', left: '20mm', right: '20mm' } }),
    });

    return { path: filePath, url: `/artifact-pdfs/${outName}.pdf` };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Max serialized-DOM payload (carried: 4MB). */
const MAX_APP_PDF_HTML = 4_000_000;

/**
 * `POST /api/app-pdf` — the served-app document-export endpoint `window.__ekoa.exportPdf`
 * calls (carried byte-compatible from the old plane; X-Ekoa-App-Id header scoping like the
 * other app-runtime routes). Was never mounted in the port — the injected client shipped but
 * every export 404'd (caught LIVE by the per-build verifier, 2026-07-11: "o botão 'Descarregar
 * PDF' não funciona — o servidor retorna um erro 404").
 */
export function appPdfRouter(): Router {
  const r = Router();
  r.post('/api/app-pdf', json({ limit: '4500kb' }), async (req: Request, res: Response) => {
    const appId = String(req.headers['x-ekoa-app-id'] || '');
    if (!/^[A-Za-z0-9._-]+$/.test(appId)) {
      res.status(400).json({ error: 'missing or invalid X-Ekoa-App-Id' });
      return;
    }
    const { html, format, landscape } = (req.body ?? {}) as { html?: unknown; format?: unknown; landscape?: unknown };
    if (typeof html !== 'string' || html.trim().length === 0) {
      res.status(400).json({ error: 'html is required' });
      return;
    }
    if (html.length > MAX_APP_PDF_HTML) {
      res.status(413).json({ error: 'html too large (max 4MB)' });
      return;
    }
    const fmt: PdfPageFormat = format === 'Letter' || format === 'Legal' ? format : 'A4';
    try {
      const result = await renderAppDocumentPdf(appId, html, { format: fmt, landscape: landscape === true });
      res.json({ data: { url: result.url } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[artifact-pdf] app document export failed for ${appId}:`, message);
      res.status(500).json({ error: 'pdf export failed' });
    }
  });
  return r;
}
