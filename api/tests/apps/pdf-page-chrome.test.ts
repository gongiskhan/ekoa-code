import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { parsePdfMarginShorthand, renderHtmlToPdf } from '../../src/apps/pdf.js';
import { closeSharedBrowser } from '../../src/services/browser-pool.js';
import { extractPdfText } from '../../src/services/pdf-text.js';

/**
 * Per-page letterhead chrome in renderHtmlToPdf (ported from ekoa-dev `a7b5e10a`).
 *
 * A `<template data-pdf-footer>` must be painted in the physical page margin of EVERY
 * page via Chromium's native displayHeaderFooter - the fix for the PROP-0244 "floating
 * footer" (the in-flow thead/tfoot trick dropped the footer mid-page on the last page
 * of each section). The margin-shorthand parser is pure and always tested; the real
 * render is Chromium-guarded exactly like browser-pool.test.ts (skips with a clear
 * reason when the binary is not installed rather than failing for an infra reason).
 */

describe('parsePdfMarginShorthand', () => {
  it('1 value -> all four sides', () => {
    expect(parsePdfMarginShorthand('26mm')).toEqual({ top: '26mm', right: '26mm', bottom: '26mm', left: '26mm' });
  });
  it('2 values -> vertical / horizontal', () => {
    expect(parsePdfMarginShorthand('26mm 20mm')).toEqual({ top: '26mm', right: '20mm', bottom: '26mm', left: '20mm' });
  });
  it('3 values -> top / horizontal / bottom', () => {
    expect(parsePdfMarginShorthand('1mm 2mm 3mm')).toEqual({ top: '1mm', right: '2mm', bottom: '3mm', left: '2mm' });
  });
  it('4 values -> top / right / bottom / left', () => {
    expect(parsePdfMarginShorthand('1mm 2mm 3mm 4mm')).toEqual({ top: '1mm', right: '2mm', bottom: '3mm', left: '4mm' });
  });
  it('collapses surrounding and repeated whitespace', () => {
    expect(parsePdfMarginShorthand('  26mm   20mm  ')).toEqual({ top: '26mm', right: '20mm', bottom: '26mm', left: '20mm' });
  });
  it('rejects an empty shorthand', () => {
    expect(parsePdfMarginShorthand('')).toBeUndefined();
  });
  it('rejects more than four values', () => {
    expect(parsePdfMarginShorthand('1mm 2mm 3mm 4mm 5mm')).toBeUndefined();
  });
});

let chromiumOk = false;
try {
  const { chromium } = await import('playwright');
  chromiumOk = existsSync(chromium.executablePath());
} catch {
  chromiumOk = false;
}

it.runIf(!chromiumOk)('SKIPPED: playwright Chromium binary is not installed on this machine', () => {
  expect(chromiumOk).toBe(false);
});

const FOOTER = 'RODAPE_FIRMA_TESTE_XYZ';
const ALPHA = 'CONTEUDO_ALFA_PAGINA_UM';
const BRAVO = 'CONTEUDO_BRAVO_PAGINA_DOIS';

/** Two pages (explicit .page-break, which the vetted reset turns into break-before:page). */
const twoPageHtml = (withFooter: boolean): string => `<!doctype html><html><head><meta charset="utf-8">
<style>@page{size:A4}body{font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:0}</style>
</head><body>
${
  withFooter
    ? `<template data-pdf-footer data-pdf-margin="18mm 15mm 26mm 15mm">
         <div style="font-size:9px;width:100%;text-align:center;">${FOOTER}</div>
       </template>`
    : ''
}
<h1>${ALPHA}</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.</p>
<div class="page-break"></div>
<h1>${BRAVO}</h1>
<p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea.</p>
</body></html>`;

describe.skipIf(!chromiumOk)('renderHtmlToPdf per-page chrome (Chromium available)', () => {
  afterAll(async () => {
    await closeSharedBrowser();
  });

  it('paints a <template data-pdf-footer> in the margin of EVERY page', async () => {
    const pdf = await renderHtmlToPdf(twoPageHtml(true));
    const text = await extractPdfText(pdf);
    // Both content pages rendered...
    expect(text).toContain(ALPHA);
    expect(text).toContain(BRAVO);
    // ...and the footer repeats once per physical page (the PROP-0244 fix).
    const occurrences = text.split(FOOTER).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('renders no footer chrome when the document embeds no template', async () => {
    const pdf = await renderHtmlToPdf(twoPageHtml(false));
    const text = await extractPdfText(pdf);
    expect(text).toContain(ALPHA);
    expect(text).toContain(BRAVO);
    // Without a template, displayHeaderFooter stays off - the footer string never appears.
    expect(text).not.toContain(FOOTER);
  }, 60_000);
});
