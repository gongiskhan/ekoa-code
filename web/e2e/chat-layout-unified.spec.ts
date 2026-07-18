import { test, expect, type Page } from '@playwright/test';
import {
  ChatRun,
  ChatRunCreateResponse,
  ChatRunEvent,
  IntegrationBuilderChatResponse,
  NotificationEvent,
} from '@ekoa/shared';

/**
 * Unified chat layout (Part B slice B3, run 20260717-190134): ONE layout for every mode -
 * transcript rail left, deliverables panel right; mode changes swap PANEL CONTENT only.
 *
 * Proves the four B3 acceptance points in one deterministic journey:
 *   1. Blank conversation is full width - no side panel, welcome + composer only.
 *   2. The panel enters on the FIRST SEND, showing a skeleton sheet while the reply
 *      is in flight (bound decision B.F).
 *   3. The reply renders in the rail and the panel lists a sheet card (title +
 *      latest-revision first line) served by the REAL B1 endpoint
 *      GET /sessions/:id/sheets - the sheets read is live, never stubbed.
 *   4. Mode-agnostic frame: an integration-build intent swaps the panel content to the
 *      integration builder and integration_ready swaps it back to the sheet feed; the
 *      rail + panel frame persists across both switches.
 *
 * Deterministic (no live model): the chat run SSE, the notifications SSE and the
 * builder chat POST are schema-validated stubs (the QA rule: no protocol stubs except
 * schema-validated ones). The run stream is HELD open until the skeleton is asserted,
 * then released - so the in-flight window is controlled, not raced. Real UI login,
 * zero console errors.
 */

const RUN_ID = 'run-b3-layout-e2e';
const ANSWER = 'A resposta completa está na folha ao lado.';
// The sheet-bearing assistant message persisted server-side; its first line becomes the
// derived sheet's title (B1 read path: one sheet per assistant message, no backfill).
const SHEET_TITLE = 'Guia de reuniões eficazes';
const SHEET_BODY = `${SHEET_TITLE}\n\nPrepare a agenda com antecedência e partilhe-a com os participantes.`;

const RUN_EVENTS = [
  { type: 'ready', runId: RUN_ID },
  { type: 'text_chunk', text: ANSWER },
  { type: 'complete', result: ANSWER, durationMs: 900 },
] as const;

const INTENT_EVENT = {
  // sessionId '' (schema-valid) makes the page handler fall back to the LIVE active
  // session - same trick as integration-builder.spec.ts.
  type: 'integration_build_intent',
  sessionId: '',
  hint: 'Trello',
} as const;
const READY_EVENT = { type: 'integration_ready', integrationKey: 'trello' } as const;

const BUILDER_CHAT_STUB = {
  builderSessionId: 'builder-sess-b3-e2e',
  generatedPackage: {},
  validationErrors: [],
};

const API = 'http://localhost:4111';

// The api is CROSS-ORIGIN from the dashboard (:3000 -> :4111); stubs carry ACAO and the
// preflighted calls get their OPTIONS answered (pattern from integration-builder.spec.ts).
const CORS_HEADERS = {
  'access-control-allow-origin': 'http://localhost:3000',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

function sseBody(events: ReadonlyArray<Record<string, unknown>>, retryMs?: number): string {
  const head = retryMs !== undefined ? `retry: ${retryMs}\n\n` : '';
  return head + events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** Console + non-asset 4xx tracking (regressions-dashboard pattern). */
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
    // Known OPEN finding (docs/findings.md: login session double-create race): the /chat
    // landing intermittently GETs a just-created session id that 404s. Scoped exclusion.
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test.describe('unified chat layout (B3)', () => {
  test('blank state is full width; first send brings the panel with a skeleton; the reply lists a sheet card; the frame persists across a mode switch', async ({ page }) => {
    // Every stub is schema-validated in-spec.
    for (const e of RUN_EVENTS) {
      expect(ChatRunEvent.safeParse(e).success, `run stub event ${e.type} validates`).toBe(true);
    }
    const createResponse = { runId: RUN_ID };
    expect(ChatRunCreateResponse.safeParse(createResponse).success).toBe(true);
    const runView = { id: RUN_ID, status: 'running' };
    expect(ChatRun.safeParse(runView).success).toBe(true);
    expect(NotificationEvent.safeParse(INTENT_EVENT).success, 'intent stub validates').toBe(true);
    expect(NotificationEvent.safeParse(READY_EVENT).success, 'ready stub validates').toBe(true);
    expect(NotificationEvent.safeParse({ type: 'ready' }).success).toBe(true);
    expect(IntegrationBuilderChatResponse.safeParse(BUILDER_CHAT_STUB).success).toBe(true);

    // -- Pre-clean: /chat auto-resumes the most recent session, so any leftover session
    //    with content would hide the blank state this spec starts from. API requests here
    //    ride Playwright's request context, not the page - the stubs below never see them.
    const loginRes = await page.request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'admin', password: 'tmp12345' },
    });
    expect(loginRes.ok()).toBe(true);
    const { token } = (await loginRes.json()) as { token: string };
    const auth = { authorization: `Bearer ${token}` };
    const listRes = await page.request.get(`${API}/api/v1/sessions`, { headers: auth });
    expect(listRes.ok()).toBe(true);
    const { items: existing } = (await listRes.json()) as { items: Array<{ id: string }> };
    for (const s of existing) {
      await page.request.delete(`${API}/api/v1/sessions/${s.id}`, { headers: auth });
    }

    // -- Stub 1: the chat run create (202 + runId).
    await page.route('**/api/v1/chat/runs', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      return route.request().method() === 'POST'
        ? route.fulfill({
            status: 202,
            contentType: 'application/json',
            headers: CORS_HEADERS,
            body: JSON.stringify(createResponse),
          })
        : route.fallback();
    });

    // -- Stub 2: the run event stream, HELD until the in-flight layout is asserted. The
    //    hold keeps isExecuting=true deterministically so the skeleton window never races.
    let releaseRun = false;
    await page.route(`**/api/v1/chat/runs/${RUN_ID}/events**`, async (route) => {
      while (!releaseRun) await new Promise((r) => setTimeout(r, 100));
      await route
        .fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { ...CORS_HEADERS, 'cache-control': 'no-cache' },
          body: sseBody(RUN_EVENTS as unknown as Array<Record<string, unknown>>),
        })
        .catch(() => {/* connection torn down while held - the reconnect gets the body */});
    });

    // -- Stub 3: the run re-sync GET (fired on the stream's ready event).
    await page.route(`**/api/v1/chat/runs/${RUN_ID}`, (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify(runView),
      });
    });

    // -- Stub 4: the notifications SSE, phase-driven. EventSource reconnects every
    //    `retry` ms (each fulfilled body ends the connection); each connection serves the
    //    current phase's event exactly once, then the phase resets - so the mode-switch
    //    events fire at the moment the spec flips the phase, never earlier, never twice.
    let notifPhase: 'idle' | 'intent' | 'integrationReady' = 'idle';
    await page.route('**/api/v1/notifications/events**', async (route) => {
      const events: Array<Record<string, unknown>> = [{ type: 'ready' }];
      if (notifPhase === 'intent') {
        events.push({ ...INTENT_EVENT });
        notifPhase = 'idle';
      } else if (notifPhase === 'integrationReady') {
        events.push({ ...READY_EVENT });
        notifPhase = 'idle';
      }
      await route
        .fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { ...CORS_HEADERS, 'cache-control': 'no-cache' },
          body: sseBody(events, 400),
        })
        .catch(() => {/* reconnect races are benign */});
    });

    // -- Stub 5: the integration builder's model-backed chat turn (auto-seeded on mount).
    await page.route('**/api/v1/integration-builder/chat', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify(BUILDER_CHAT_STUB),
      });
    });

    const errors = trackConsoleErrors(page);
    await login(page);

    // 1. BLANK STATE: full-width welcome + composer, no panel, no rail split.
    const composer = page.locator('textarea').first();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('side-panel-container')).toHaveCount(0);
    await expect(page.getByTestId('sheet-feed')).toHaveCount(0);

    // 2. FIRST SEND: the layout switches to rail + panel and the panel shows a skeleton
    //    sheet while the run is in flight (the stream is still held here).
    await composer.fill('Prepara um guia de reuniões eficazes');
    await composer.press('Enter');

    await expect(page.getByTestId('chat-rail')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('side-panel-container')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sheet-feed')).toBeVisible();
    await expect(page.getByTestId('sheet-skeleton')).toBeVisible();

    // The session is real (created by the send path); grab its id from the URL.
    await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split('/').pop()!;

    // Persist the sheet-bearing assistant reply server-side (the stubbed run pipeline
    // never reaches the server), so the panel's REAL sheets read has data to serve.
    const msgRes = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
      headers: auth,
      data: { role: 'assistant', content: SHEET_BODY, metadata: { isEssential: true, type: 'text' } },
    });
    expect(msgRes.status()).toBe(201);

    // 3. Release the run: the reply renders in the rail; the run settles and the feed
    //    refetches from the live endpoint - the sheet card appears (title + first line).
    //    The sheets read is LIVE (the B1 endpoint, never stubbed): capture the actual
    //    response and prove the asserted card title came from the server body.
    const sheetsResponsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        r.url().includes(`/api/v1/sessions/${sessionId}/sheets`),
      { timeout: 30_000 },
    );
    releaseRun = true;
    await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 30_000 });
    const sheetsResponse = await sheetsResponsePromise;
    expect(sheetsResponse.status(), 'live B1 sheets read returns 200').toBe(200);
    const sheetsBody = (await sheetsResponse.json()) as { items: Array<{ title: string }> };
    expect(
      sheetsBody.items.map((i) => i.title),
      'the asserted card title is served by the live endpoint',
    ).toContain(SHEET_TITLE);
    const card = page.getByTestId('sheet-card').filter({ hasText: SHEET_TITLE });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sheet-skeleton')).toHaveCount(0);

    // Frame persistence must be PROVEN, not inferred from visibility (a remount could
    // hide behind a passing toBeVisible): stamp sentinel expando properties on the live
    // rail + panel container DOM nodes. A remount replaces the nodes and loses the
    // expandos, so the sentinels surviving both mode swaps proves the same nodes lived
    // through them.
    await page.evaluate(() => {
      type Stamped = Element & { __b3FrameSentinel?: string };
      const rail = document.querySelector<Element>('[data-testid="chat-rail"]') as Stamped | null;
      const panel = document.querySelector<Element>(
        '[data-testid="side-panel-container"]',
      ) as Stamped | null;
      if (!rail || !panel) throw new Error('frame nodes missing before mode swap');
      rail.__b3FrameSentinel = 'rail';
      panel.__b3FrameSentinel = 'panel';
    });
    const readSentinels = () =>
      page.evaluate(() => {
        type Stamped = Element & { __b3FrameSentinel?: string };
        return {
          rail: (document.querySelector('[data-testid="chat-rail"]') as Stamped | null)
            ?.__b3FrameSentinel,
          panel: (
            document.querySelector('[data-testid="side-panel-container"]') as Stamped | null
          )?.__b3FrameSentinel,
        };
      });

    // 4a. MODE SWITCH IN: the integration-build intent swaps the panel content to the
    //     integration builder. The frame (rail + panel) must persist untouched.
    notifPhase = 'intent';
    await expect(page.getByText(/Integration Builder/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('chat-rail')).toBeVisible();
    await expect(page.getByTestId('side-panel-container')).toBeVisible();
    await expect(page.getByTestId('sheet-feed')).toHaveCount(0);
    expect(await readSentinels(), 'frame nodes survived the swap INTO integrate').toEqual({
      rail: 'rail',
      panel: 'panel',
    });

    // 4b. MODE SWITCH BACK: integration_ready returns the panel to chat-mode content -
    //     the sheet feed, with the same card, inside the same frame.
    notifPhase = 'integrationReady';
    await expect(page.getByTestId('sheet-feed')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('sheet-card').filter({ hasText: SHEET_TITLE })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('chat-rail')).toBeVisible();
    await expect(page.getByTestId('side-panel-container')).toBeVisible();
    expect(await readSentinels(), 'frame nodes survived the swap BACK to sheet feed').toEqual({
      rail: 'rail',
      panel: 'panel',
    });

    // Zero console errors on the dashboard (carried e2e discipline). SSE-reconnect noise
    // from the stubbed notifications stream is benign and excluded.
    const real = errors.filter((e) => !/event.?source|notifications\/events|network error/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });
});
