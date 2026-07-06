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
import { getSharedBrowser } from '../services/browser-pool.js';

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
