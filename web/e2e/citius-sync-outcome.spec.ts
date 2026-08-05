import { test, expect, type Page } from '@playwright/test';
import { SyncStateView } from '@ekoa/shared';
import { uiLogin } from './helpers/ui-login';

/**
 * CS7 - the Citius sync outcome panel, through the real dashboard with a real login.
 *
 * WHAT IS BEING PROVEN. The whole completeness-verified sync workstream exists so that a lawyer can
 * tell three things apart:
 *
 *   Completa   - the inbox is synced and two passes agree nothing was missed;
 *   INCOMPLETA - notifications MAY be missing; the read pointer was deliberately held back;
 *   Falhou     - the sync never ran, so nothing at all is known about the inbox.
 *
 * If the UI renders those as three shades of the same chip, every invariant underneath (the two-pass
 * enumeration, the watermark that refuses to advance, the failed/incomplete split kept distinct all
 * the way down `shared/src/sync.ts`) buys the user nothing. So this spec asserts the distinction the
 * way a person perceives it: it reads the COMPUTED styles off the live page and requires the three
 * states to differ in accent bar, colour family and headline weight - not merely in class names,
 * which would make the assertion a restatement of the markup.
 *
 * STUBS. The api's sync rail is flag-gated OFF by default (CS6: `CITIUS_SYNC_ENABLED === 'true'`,
 * and enabling it drives a real court portal with a real lawyer's credential), so the three outcomes
 * are supplied by intercepting the ONE state endpoint. Every stub body is validated in-spec against
 * the shared `SyncStateView` schema (the house rule: no protocol stubs except schema-validated
 * ones), so a contract change breaks this spec instead of silently making it fictional. Nothing else
 * on the page is stubbed - the login, the integrations page and every other call are live.
 */

const STATE_PATH = '**/api/v1/sync/citius/notificacoes/state';

// Fulfilled responses still pass the browser's CORS checks, and the api is cross-origin from the
// dashboard (:3000 -> :4111), so every stub carries ACAO and answers its own preflight.
const CORS_HEADERS = {
  'access-control-allow-origin': 'http://localhost:3000',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

const BASE_REPORT = {
  id: 'r-e2e-1',
  syncKey: 'org-e2e::citius::inbox',
  orgId: 'org-e2e',
  startedAt: '2026-08-03T10:40:00.000Z',
  endedAt: '2026-08-03T10:42:00.000Z',
  outcome: 'complete' as const,
  window: { since: null, until: '2026-08-03T10:42:00.000Z' },
  verification: {
    pass1: { pages: 2, itemsSeen: 12, newRefs: 4, reachedEnd: true },
    pass2: { pages: 2, itemsSeen: 12, refsOnlyInPass2: [] as string[], reachedEnd: true },
    maxPages: 5,
  },
  landed: 4,
  duplicatesSuppressed: 0,
  sessionEvents: ['reused' as const],
};

const COMPLETE_STATE = {
  watermark: '2026-08-03T10:42:00.000Z',
  lastRunAt: '2026-08-03T10:42:00.000Z',
  lastOutcome: 'complete' as const,
  consecutiveIncomplete: 0,
  consecutiveFailures: 0,
  seenRefs: 12,
  landed: 31,
  latest: BASE_REPORT,
};

const INCOMPLETE_STATE = {
  ...COMPLETE_STATE,
  lastOutcome: 'incomplete' as const,
  consecutiveIncomplete: 2,
  landed: 33,
  latest: {
    ...BASE_REPORT,
    id: 'r-e2e-2',
    outcome: 'incomplete' as const,
    landed: 2,
    verification: {
      ...BASE_REPORT.verification,
      pass2: { pages: 2, itemsSeen: 13, refsOnlyInPass2: ['citius-ref-4471'], reachedEnd: true },
    },
  },
};

const FAILED_STATE = {
  ...COMPLETE_STATE,
  lastOutcome: 'failed' as const,
  consecutiveFailures: 1,
  latest: {
    ...BASE_REPORT,
    id: 'r-e2e-3',
    outcome: 'failed' as const,
    landed: 0,
    error: 'enumerate: o portal respondeu 503',
  },
};

// The house rule, executed rather than asserted in prose: a stub that does not validate against the
// shared schema is a fiction, and a spec built on one proves nothing about the product.
for (const [name, fixture] of [
  ['complete', COMPLETE_STATE],
  ['incomplete', INCOMPLETE_STATE],
  ['failed', FAILED_STATE],
] as const) {
  const parsed = SyncStateView.safeParse(fixture);
  if (!parsed.success) {
    throw new Error(`CS7 e2e: the ${name} stub does not validate against SyncStateView: ${parsed.error.message}`);
  }
}

async function login(page: Page) {
  await uiLogin(page);
}

/**
 * Console + non-asset 4xx tracking (the regressions-dashboard pattern). `expected404` is the ONE
 * escape hatch, used by the flag-off test: there, the sync state endpoint answering 404 IS the
 * behaviour under test, and it stays scoped to that single URL so every other 404 still fails.
 */
function trackConsoleErrors(page: Page, expected404?: RegExp): string[] {
  const errors: string[] = [];
  const devAssetNoise = /\/_next\/|hot-update|favicon/;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return; // pinned by URL below
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() < 400 || devAssetNoise.test(r.url())) return;
    // Known OPEN finding (docs/findings.md: login session double-create race).
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    if (expected404 && r.status() === 404 && expected404.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

/** Serve one state fixture (or a 404, i.e. the feature flag off) for the sync state endpoint. */
async function serveState(page: Page, body: unknown | null) {
  await page.unroute(STATE_PATH).catch(() => {});
  await page.route(STATE_PATH, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    if (body === null) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Sincronização Citius não está disponível.' } }),
      });
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS_HEADERS,
      body: JSON.stringify(body),
    });
  });
}

interface VisualSignature {
  outcome: string;
  label: string;
  accentWidth: number;
  accentColor: string;
  surface: string;
  chipBackground: string;
  headlineSize: number;
  headlineWeight: number;
}

/**
 * What the panel LOOKS like, read off the live page rather than off its class attribute: the accent
 * bar, the wash and the chip fill are read as COMPUTED values, so an assertion here cannot be
 * satisfied by renaming a class - only by the pixels actually differing.
 */
async function readSignature(page: Page): Promise<VisualSignature> {
  const panel = page.getByTestId('sync-outcome-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel.evaluate((el) => {
    const statement = el.querySelector('[data-testid="sync-outcome-statement"]') as HTMLElement;
    const chip = el.querySelector('[data-testid="sync-outcome-label"]') as HTMLElement;
    const headline = el.querySelector('[data-testid="sync-outcome-headline"]') as HTMLElement;
    const style = getComputedStyle(statement);
    const chipStyle = getComputedStyle(chip);
    const headlineStyle = getComputedStyle(headline);
    return {
      outcome: el.getAttribute('data-outcome') ?? '',
      label: (chip.textContent ?? '').trim(),
      accentWidth: parseFloat(style.borderLeftWidth),
      accentColor: style.borderLeftColor,
      surface: style.backgroundColor,
      chipBackground: chipStyle.backgroundColor,
      headlineSize: parseFloat(headlineStyle.fontSize),
      headlineWeight: parseInt(headlineStyle.fontWeight, 10),
    };
  });
}

async function openIntegrations(page: Page) {
  await page.goto('/integrations');
  await expect(page.getByTestId('integrations-page')).toBeVisible({ timeout: 30_000 });
}

test.describe('painel de sincronização Citius', () => {
  test('os três desfechos são visualmente distintos, não três tons do mesmo aviso', async ({ page }) => {
    await serveState(page, COMPLETE_STATE);
    await login(page);

    const errors = trackConsoleErrors(page);
    await openIntegrations(page);
    const complete = await readSignature(page);

    await serveState(page, INCOMPLETE_STATE);
    await openIntegrations(page);
    const incomplete = await readSignature(page);

    await serveState(page, FAILED_STATE);
    await openIntegrations(page);
    const failed = await readSignature(page);

    // 1. Each state names itself, in the workstream's own words.
    expect(complete.label).toBe('Completa');
    expect(incomplete.label).toBe('INCOMPLETA');
    expect(failed.label).toBe('Falhou');
    expect(new Set([complete.outcome, incomplete.outcome, failed.outcome])).toEqual(
      new Set(['complete', 'incomplete', 'failed']),
    );

    // 2. INCOMPLETA carries real visual weight: an accent bar the calm state does not have.
    expect(incomplete.accentWidth).toBeGreaterThanOrEqual(4);
    expect(complete.accentWidth).toBeLessThan(4);
    expect(incomplete.headlineSize).toBeGreaterThan(complete.headlineSize);
    expect(incomplete.headlineWeight).toBeGreaterThan(complete.headlineWeight);
    expect(incomplete.surface).not.toBe(complete.surface);
    expect(incomplete.chipBackground).not.toBe(complete.chipBackground);

    // 3. Falhou is loud too, but is NOT a shade of INCOMPLETA: different colour family, at the
    //    accent bar and at the chip.
    expect(failed.accentWidth).toBeGreaterThanOrEqual(4);
    expect(failed.accentColor).not.toBe(incomplete.accentColor);
    expect(failed.surface).not.toBe(incomplete.surface);
    expect(failed.chipBackground).not.toBe(incomplete.chipBackground);

    expect(errors, `console errors on /integrations:\n${errors.join('\n')}`).toEqual([]);
  });

  test('INCOMPLETA diz o que significa, mostra a prova e diz o que acontece a seguir', async ({ page }) => {
    await serveState(page, INCOMPLETE_STATE);
    await login(page);

    const errors = trackConsoleErrors(page);
    await openIntegrations(page);

    const panel = page.getByTestId('sync-outcome-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toHaveAttribute('data-outcome', 'incomplete');

    // What it means, in plain PT-PT: notifications may be missing.
    await expect(page.getByTestId('sync-outcome-headline')).toContainText('Podem faltar notificações');
    // What happens next: the read pointer was held, and the next run re-sweeps from the same point.
    const next = page.getByTestId('sync-outcome-next');
    await expect(next).toContainText('não avançou');
    await expect(next).toContainText('a partir do mesmo ponto');
    // The proof, item-level: pass 2 saw a reference pass 1 did not.
    await expect(page.getByTestId('sync-outcome-reason')).toContainText(
      'A segunda leitura encontrou 1 notificação que a primeira não tinha visto.',
    );
    // A repeated miss is surfaced, not averaged away.
    await expect(page.getByTestId('sync-outcome-streak')).toContainText('2ª leitura incompleta seguida');
    // The evidence a user needs to trust any of it: when it ran and how much landed.
    await expect(page.getByTestId('sync-evidence-lastrun')).toContainText('03/08/2026');
    await expect(page.getByTestId('sync-evidence-landed')).toContainText('2 notificações');

    expect(errors, `console errors on /integrations:\n${errors.join('\n')}`).toEqual([]);
  });

  test('Falhou diz que não houve leitura nenhuma, e não finge um zero', async ({ page }) => {
    await serveState(page, FAILED_STATE);
    await login(page);

    const errors = trackConsoleErrors(page);
    await openIntegrations(page);

    const panel = page.getByTestId('sync-outcome-panel');
    await expect(panel).toHaveAttribute('data-outcome', 'failed');
    await expect(page.getByTestId('sync-outcome-headline')).toContainText('não chegou a correr');
    // It must NOT borrow the incomplete claim: "may be missing" is a statement a failed run cannot make.
    await expect(page.getByTestId('sync-outcome-headline')).not.toContainText('Podem faltar notificações');
    await expect(page.getByTestId('sync-outcome-reason')).toContainText('o portal respondeu 503');
    // "0 notificações nesta leitura" would read as "there were none"; a failure never claims that.
    await expect(page.getByTestId('sync-evidence-landed')).toHaveCount(0);
    await expect(page.getByTestId('sync-evidence-lastrun')).toBeVisible();

    expect(errors, `console errors on /integrations:\n${errors.join('\n')}`).toEqual([]);
  });

  test('com a funcionalidade desligada (404) o painel não existe de todo', async ({ page }) => {
    await serveState(page, null);
    await login(page);

    const errors = trackConsoleErrors(page, /\/api\/v1\/sync\/citius\/notificacoes\/state$/);
    await openIntegrations(page);
    // The page itself is fine; the panel simply is not there (an unshipped feature does not
    // advertise itself, and a 404 is not an error state to show the user).
    await expect(page.getByTestId('platform-integrations-section')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sync-outcome-panel')).toHaveCount(0);

    expect(errors, `console errors on /integrations:\n${errors.join('\n')}`).toEqual([]);
  });
});
