import { test, expect, type Page, type Route } from '@playwright/test';
import {
  SessionSummaryListResponse,
  SessionMessageListResponse,
  ArtifactListResponse,
  ArtifactFilesResponse,
  JobCreateResponse,
  Job,
  JobEvent,
} from '@ekoa/shared';

/**
 * Session parallelism - the multi-job stream manager (S4, ch13 §13.6 gap plan).
 *
 * Two sessions each run a build at the same time. The liveness-owned job-stream manager
 * (web/lib/job-stream-manager.ts) opens one SSE stream per job and writes every event to the
 * OWNING session's buckets - never the focused session. This spec proves: two concurrent
 * builds render their own output, switching between them loses nothing and never cross-
 * contaminates, and a refresh re-derives each session's live build from the server and
 * reattaches its stream. Zero console errors throughout.
 *
 * Deterministic + LLM-free: every REST/SSE stub is schema-validated in-spec (the QA rule),
 * carries CORS headers reflecting the request Origin (the cross-origin api; a hardcoded port
 * breaks under the harness), and real UI login drives the dashboard.
 */

const NOW = new Date().toISOString();

const SESS_A = 'e2e-parallel-sess-a';
const SESS_B = 'e2e-parallel-sess-b';
const ART_A = 'e2e-parallel-art-a';
const ART_B = 'e2e-parallel-art-b';
const JOB_A = 'e2e-parallel-job-a';
const JOB_B = 'e2e-parallel-job-b';

const OUTPUT_A = 'A construir a Aplicacao Alfa';
const OUTPUT_B = 'A construir a Aplicacao Beta';

const sessions = {
  items: [
    { id: SESS_A, name: 'Sessao Alfa', artifactId: ART_A, createdAt: NOW, updatedAt: NOW },
    { id: SESS_B, name: 'Sessao Beta', artifactId: ART_B, createdAt: NOW, updatedAt: NOW },
  ],
};

function artifact(id: string, sessionId: string, name: string) {
  return {
    id,
    name,
    slug: id,
    userId: 'e2e-user',
    orgId: 'e2e-org',
    visibility: 'private' as const,
    featured: false,
    shareable: false,
    data: { sessionId, appUrl: `/apps/${id}/`, projectDir: `/p/${id}` },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const artifacts = { items: [artifact(ART_A, SESS_A, 'Alfa'), artifact(ART_B, SESS_B, 'Beta')], featured: [] };

function jobView(id: string, artifactId: string) {
  return { id, status: 'running', artifactId, createdAt: NOW };
}

function createResponse(job: ReturnType<typeof jobView>) {
  return { status: 'created' as const, job };
}

/** A running build's stream: ready + artifact + a distinct plan_step. No `complete`, so both
 *  builds stay live for the switch assertions (the plan_step detail is the per-session marker). */
function jobEvents(jobId: string, artifactId: string, detail: string): JobEvent[] {
  return [
    { type: 'ready', jobId },
    { type: 'artifact', artifactId, appUrl: `/apps/${artifactId}/`, slug: artifactId },
    { type: 'plan_step', status: 'building', detail },
  ];
}

function sseBody(events: JobEvent[]): string {
  return events.map((e, i) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\nid: ${i + 1}\n\n`).join('');
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** The first build send raises the verify-builds opt-in dialog ("Verificar as construções?").
 *  Dismiss it (Não verificar keeps the stubbed run deterministic); no-op when absent. */
async function dismissVerifyDialog(page: Page) {
  const btn = page.getByRole('button', { name: /não verificar/i }).first();
  await btn
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => btn.click())
    .catch(() => undefined);
}

/** Click a session card by its CURRENT label. The panel can start collapsed (expand it first),
 *  and sessions auto-rename to the first user message once one is sent - so pass whatever the
 *  card shows now (the original name before any send, the prompt text after). Cards are the
 *  cursor-pointer divs in the sessions panel; chat-thread bubbles are not clickable, so the
 *  class filter disambiguates a label that also appears in the thread. */
async function clickSessionCard(page: Page, label: string) {
  const search = page.getByPlaceholder(/pesquisar sess/i).first();
  if (!(await search.isVisible().catch(() => false))) {
    const expand = page.getByRole('button', { name: /expandir sess/i }).first();
    if (await expand.isVisible().catch(() => false)) await expand.click();
  }
  await page.locator('div[class*="cursor-pointer"]').filter({ hasText: label }).first().click();
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const devAssetNoise = /\/_next\/|hot-update|favicon/;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() < 400 || devAssetNoise.test(r.url())) return;
    // Known OPEN finding (docs/findings.md: login session double-create race).
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test.describe('session parallelism - multi-job stream manager', () => {
  test('two sessions stream builds concurrently, switch cleanly, and rehydrate on refresh', async ({ page }) => {
    // Every stub payload validates against the shared/ schemas (the QA rule: no protocol
    // stubs except schema-validated ones).
    expect(SessionSummaryListResponse.safeParse(sessions).success, 'sessions stub validates').toBe(true);
    expect(ArtifactListResponse.safeParse(artifacts).success, 'artifacts stub validates').toBe(true);
    expect(SessionMessageListResponse.safeParse({ items: [] }).success).toBe(true);
    expect(ArtifactFilesResponse.safeParse({ files: [], projectDir: null }).success).toBe(true);
    expect(JobCreateResponse.safeParse(createResponse(jobView(JOB_A, ART_A))).success, 'job create stub validates').toBe(true);
    expect(Job.safeParse(jobView(JOB_A, ART_A)).success, 'job view stub validates').toBe(true);
    for (const e of jobEvents(JOB_A, ART_A, OUTPUT_A)) {
      expect(JobEvent.safeParse(e).success, `job event ${e.type} validates`).toBe(true);
    }

    // The api is CROSS-ORIGIN from the dashboard; Playwright-fulfilled responses still pass the
    // browser CORS checks, so every stub carries ACAO reflecting the request Origin (a hardcoded
    // port breaks under the harness's shifted ports).
    const cors = (route: Route) => ({
      'access-control-allow-origin': route.request().headers()['origin'] ?? 'http://localhost:3000',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
    const json = (route: Route, status: number, body: unknown) =>
      route.fulfill({ status, contentType: 'application/json', headers: cors(route), body: JSON.stringify(body) });
    const sse = (route: Route, body: string) =>
      route.fulfill({ status: 200, headers: { ...cors(route), 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body });

    // --- REST surface (register before login so the first dashboard load is stubbed) ---
    await page.route('**/api/v1/sessions', (route) =>
      route.request().method() === 'GET' ? json(route, 200, sessions) : route.fallback(),
    );
    await page.route('**/api/v1/sessions/*/messages**', (route) => json(route, 200, { items: [] }));
    await page.route('**/api/v1/artifacts', (route) =>
      route.request().method() === 'GET' ? json(route, 200, artifacts) : route.fallback(),
    );
    await page.route('**/api/v1/artifacts/*/files**', (route) => json(route, 200, { files: [], projectDir: null }));

    // POST /jobs - assign the job id by the request's sessionId, so each session gets its own.
    await page.route('**/api/v1/jobs', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) });
      if (route.request().method() !== 'POST') return route.fallback();
      const body = (route.request().postDataJSON() ?? {}) as { sessionId?: string };
      const [jobId, artId] = body.sessionId === SESS_B ? [JOB_B, ART_B] : [JOB_A, ART_A];
      return json(route, 202, createResponse(jobView(jobId, artId)));
    });

    // GET /jobs/:id (rehydration + ready re-sync) - both stay running.
    await page.route('**/api/v1/jobs/*', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) });
      const url = route.request().url();
      if (/\/events\b/.test(url)) return route.fallback();
      const id = url.includes(JOB_B) ? JOB_B : JOB_A;
      const artId = id === JOB_B ? ART_B : ART_A;
      return json(route, 200, jobView(id, artId));
    });

    // GET /jobs/:id/events - the per-job SSE stream, routed to its owning session by the manager.
    await page.route(`**/api/v1/jobs/${JOB_A}/events**`, (route) => sse(route, sseBody(jobEvents(JOB_A, ART_A, OUTPUT_A))));
    await page.route(`**/api/v1/jobs/${JOB_B}/events**`, (route) => sse(route, sseBody(jobEvents(JOB_B, ART_B, OUTPUT_B))));

    // Quiet the per-user notifications stream (not under test here).
    await page.route('**/api/v1/notifications/events**', (route) => sse(route, ''));

    const errors = trackConsoleErrors(page);
    await login(page);

    // Session Alfa is a build session (artifact-bound); its composer starts a follow-up build.
    const composer = page.locator('textarea').first();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('adiciona um campo de telefone');
    await composer.press('Enter');
    await dismissVerifyDialog(page);

    // Build Alfa's output lands in Alfa's thread.
    await expect(page.getByText(OUTPUT_A).first()).toBeVisible({ timeout: 30_000 });

    // Switch to Sessao Beta (soft switch via the session card - no reload) and start its build.
    await clickSessionCard(page, 'Sessao Beta');
    const composerB = page.locator('textarea').first();
    await composerB.fill('muda a cor principal para azul');
    await composerB.press('Enter');
    await dismissVerifyDialog(page);

    // Beta's output lands in Beta's thread - and Alfa's marker is NOT here (no misattribution).
    await expect(page.getByText(OUTPUT_B).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(OUTPUT_A)).toHaveCount(0);

    // Switch back to Alfa (its card now shows its prompt - sessions auto-rename on first send):
    // its own output survived the round-trip (the background stream kept writing to Alfa's
    // buckets), and Beta's marker never leaked in.
    await clickSessionCard(page, 'adiciona um campo de telefone');
    await expect(page.getByText(OUTPUT_A).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(OUTPUT_B)).toHaveCount(0);

    // Refresh mid-two-builds: persist sanitizes running -> idle, then rehydrateJobs() re-derives
    // each session's live build from GET /jobs/:id and reattaches its stream. Both come back.
    await page.reload();
    await expect(page.getByText(OUTPUT_A).first()).toBeVisible({ timeout: 30_000 });
    await clickSessionCard(page, 'muda a cor principal para azul');
    await expect(page.getByText(OUTPUT_B).first()).toBeVisible({ timeout: 30_000 });

    // Zero console errors across the whole run (SSE-reconnect noise from the stubbed streams is
    // benign - the stubs EOF and the native EventSource reconnects).
    const real = errors.filter((e) => !/event.?source|jobs\/.*\/events|notifications\/events|network error/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });
});
