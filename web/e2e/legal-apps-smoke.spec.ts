import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * S0-smoke (run 20260717-202309) - every legal featured app must load clean.
 * For each of the 29 legal-* served apps: the served HTML is the real app (has
 * the injected __EKOA_APP_ID, is not the "Building..." placeholder), the shared
 * Layout mounts (sidebar brand), the __ekoa.shared spine bridge comes up, and
 * the load produces zero page errors and zero console errors.
 *
 * This is the run's harness-validation gate: a red here is a load-breaking
 * defect in that app's seed (fix the seed, never this spec's expectations).
 */

/**
 * legal-agenda-reservas is the PUBLIC client-facing booking page and by design
 * does not mount the shared suite Layout (see its App.jsx header comment); its
 * own shell marker is asserted instead.
 */
const CHROME_MARKER: Record<string, string> = {
  'legal-agenda-reservas': '[data-testid="reservas-app"]',
};

const LEGAL_APPS = [
  'legal-agenda',
  'legal-agenda-reservas',
  'legal-apoio',
  'legal-assinatura',
  'legal-calculos',
  'legal-citius',
  'legal-cobrancas',
  'legal-conflitos',
  'legal-contratos',
  'legal-correio',
  'legal-dossie',
  'legal-financas',
  'legal-forms',
  'legal-honorarios',
  'legal-injuncoes',
  'legal-insolvencias',
  'legal-jurimetria',
  'legal-kanban',
  'legal-kyc',
  'legal-modelos',
  'legal-nucleo',
  'legal-pecas',
  'legal-pesquisa',
  'legal-portal',
  'legal-prazos',
  'legal-rcbe',
  'legal-recursos',
  'legal-tempos',
  'legal-transcricao',
];

for (const slug of LEGAL_APPS) {
  test(`${slug}: loads clean (app served, Layout mounts, spine up, no errors)`, async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(legalAppUrl(slug), { waitUntil: 'domcontentloaded' });

    // The served document is the real app, not the building/failed placeholder.
    await page.waitForFunction(() => Boolean((window as any).__EKOA_APP_ID), undefined, {
      timeout: 20_000,
    });
    await expect(page.locator('title')).not.toHaveText(/Building/i);

    // The app chrome mounted (shared Layout, or the app's own shell where it
    // deliberately has no suite sidebar).
    const marker = CHROME_MARKER[slug] ?? '.sidebar-brand-text';
    await expect(page.locator(marker).first()).toBeVisible({ timeout: 20_000 });

    // The spine bridge is available to the app.
    await page.waitForFunction(
      () => Boolean((window as any).__ekoa && (window as any).__ekoa.shared),
      undefined,
      { timeout: 20_000 },
    );

    // Give late boot errors a beat to surface, then assert clean.
    await page.waitForTimeout(500);
    expect(pageErrors, `page errors on ${slug}: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `console errors on ${slug}: ${consoleErrors.join(' | ')}`).toEqual([]);
  });
}
