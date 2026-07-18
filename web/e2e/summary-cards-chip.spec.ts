import { test, expect, type Page } from '@playwright/test';
import {
  ChatRun,
  ChatRunCreateRequest,
  ChatRunCreateResponse,
  ChatRunEvent,
  NotificationEvent,
} from '@ekoa/shared';

/**
 * Summary cards + composer chip + agent-revision routing (Part B slice B5, run
 * 20260717-190134; locked decisions 3, 5, 6, 7, 8). One deterministic journey proves:
 *
 *   1. While a run streams, the transcript shows the truncated FIRST-LINE placeholder card;
 *      the B2 `reply_summary` notification upgrades it to title + summary.
 *   2. Clicking a card focuses ITS sheet in the panel (scroll-to + flash) through the store
 *      seam - never the feed's DOM.
 *   3. The B.D local heuristic sets the composer chip ("A editar: <título>") on an
 *      imperative edit message, targeting the most recent sheet.
 *   4. A chip-send carries `reviseSheetId` and the revision lands on the SAME sheet
 *      (revisions grew - proven via waitForResponse on the LIVE sheets read), rendering a
 *      revision card ("Revisão 2 · ...") that focuses the SAME sheet.
 *   5. Dismissing the chip forces the next reply onto a NEW sheet.
 *   6. A sheet-footer follow-up pill is the manual SET affordance (locked 6): clicking it
 *      drafts into the composer AND sets the chip to ITS sheet - even when another sheet is
 *      more recent - and the send revises THAT sheet.
 *
 * Deterministic (no live model): chat-run create/stream/re-sync and the notifications SSE
 * are schema-validated stubs (the chat-layout-unified pattern - live model runs are slow);
 * the sheets/messages/revisions traffic is REAL http against the live api. The stubbed
 * pipeline never reaches the server, so the spec performs the server-side effects the real
 * pipeline would (persist the reply - with the revision turn's back-reference metadata -
 * and append the revision) through the real endpoints.
 * Real UI login, PT-PT strings, zero console errors.
 *
 * Division of proof (codex fix 3): because /chat/runs is stubbed, THIS spec owns the CLIENT
 * half of the agent-revision routing - the request-payload assertions on the intercepted
 * POST bodies prove each send carries (or omits) exactly the chip's reviseSheetId. The
 * SERVER half - revision append on the targeted sheet, back-reference + ordinal, and the
 * unknown/foreign/stale-id fallback to fresh - is pinned by the chat-lifecycle unit suite
 * (api/tests/agents/chat-lifecycle.test.ts) against the real pipeline.
 */

const RUN_IDS = ['run-b5-cards-1', 'run-b5-cards-2', 'run-b5-cards-3', 'run-b5-cards-4'] as const;

const SHEET1_TITLE = 'Guia de reuniões eficazes';
const SHEET1_BODY = `${SHEET1_TITLE}\n\nPrepare a agenda com antecedência e partilhe-a com os participantes.`;
const REVISED_BODY = `${SHEET1_TITLE}\n\nPrepare a agenda com antecedência e queira partilhá-la com os participantes com a devida antecedência.`;
const SHEET2_TITLE = 'Exemplo prático de agenda';
const SHEET2_BODY = `${SHEET2_TITLE}\n\nSegue um exemplo de agenda para uma reunião de 30 minutos.`;

const SUMMARY1 = { title: 'Guia de reuniões', summary: 'Um guia curto para preparar reuniões eficazes.' };
const SUMMARY2 = { title: 'Tom mais formal', summary: 'A redação do guia ficou mais formal.' };

const API = 'http://localhost:4111';

// The api is CROSS-ORIGIN from the dashboard (:3000 -> :4111); stubs carry ACAO and the
// preflighted calls get their OPTIONS answered (pattern from chat-layout-unified.spec.ts).
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

test.describe('summary cards + composer chip (B5)', () => {
  test('streaming placeholder upgrades on reply_summary; card click focuses the sheet; the heuristic sets the chip; chip send revises the SAME sheet; dismiss forces a NEW sheet', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // -- Schema-validate every stubbed payload (the QA rule: no protocol stubs except
    //    schema-validated ones). Run streams are validated per run below.
    for (const runId of RUN_IDS) {
      expect(ChatRunCreateResponse.safeParse({ runId }).success).toBe(true);
      expect(ChatRun.safeParse({ id: runId, status: 'running' }).success).toBe(true);
      expect(ChatRunEvent.safeParse({ type: 'ready', runId }).success).toBe(true);
    }
    expect(NotificationEvent.safeParse({ type: 'ready' }).success).toBe(true);

    // -- Pre-clean: /chat auto-resumes the most recent session; stale sessions would hide
    //    the blank state and leave ambiguous sheet cards.
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

    // -- Stub 1: chat run creation. Sequential runIds; every POST body is captured (the
    //    reviseSheetId assertions read them) and must parse against the shared request schema.
    const createBodies: Array<Record<string, unknown>> = [];
    await page.route('**/api/v1/chat/runs', (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(ChatRunCreateRequest.safeParse(body).success, 'chat run request validates').toBe(true);
      const runId = RUN_IDS[createBodies.length];
      createBodies.push(body);
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify({ runId }),
      });
    });

    // -- Stub 2 + 3 per run: the event stream (phase-driven: 'streaming' serves ready + ONE
    //    text_chunk so the placeholder window is deterministic; 'complete' settles the run)
    //    and the re-sync GET (always 'running' - the stream owns the terminal event).
    const runPhase: Record<string, 'streaming' | 'complete'> = {};
    const runResult: Record<string, string> = {};
    const chunkServed: Record<string, boolean> = {};
    for (const runId of RUN_IDS) {
      runPhase[runId] = 'streaming';
      await page.route(`**/api/v1/chat/runs/${runId}/events**`, async (route) => {
        const events: Array<Record<string, unknown>> = [{ type: 'ready', runId }];
        if (runPhase[runId] === 'streaming') {
          if (!chunkServed[runId]) {
            chunkServed[runId] = true;
            events.push({ type: 'text_chunk', text: runResult[runId] ?? '' });
          }
        } else {
          events.push({ type: 'complete', result: runResult[runId] ?? '', durationMs: 900 });
        }
        for (const e of events) {
          expect(ChatRunEvent.safeParse(e).success, `run stub event ${e.type} validates`).toBe(true);
        }
        await route
          .fulfill({
            status: 200,
            contentType: 'text/event-stream',
            headers: { ...CORS_HEADERS, 'cache-control': 'no-cache' },
            body: sseBody(events, 300),
          })
          .catch(() => {/* reconnect races are benign */});
      });
      await page.route(`**/api/v1/chat/runs/${runId}`, (route) => {
        if (route.request().method() === 'OPTIONS') {
          return route.fulfill({ status: 204, headers: CORS_HEADERS });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS_HEADERS,
          body: JSON.stringify({ id: runId, status: 'running' }),
        });
      });
    }

    // -- Stub 4: the notifications SSE (chat-layout-unified pattern): each reconnect serves
    //    the queued events exactly once - reply_summary fires when the spec enqueues it.
    let notifQueue: Array<Record<string, unknown>> = [];
    await page.route('**/api/v1/notifications/events**', async (route) => {
      const events: Array<Record<string, unknown>> = [{ type: 'ready' }, ...notifQueue];
      notifQueue = [];
      await route
        .fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { ...CORS_HEADERS, 'cache-control': 'no-cache' },
          body: sseBody(events, 400),
        })
        .catch(() => {/* reconnect races are benign */});
    });

    const errors = trackConsoleErrors(page);
    await login(page);

    // ==================== 1. STREAMING PLACEHOLDER -> CARD UPGRADE ====================
    runResult[RUN_IDS[0]] = SHEET1_BODY;
    const composer = page.locator('textarea').first();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill('Prepara um guia de reuniões eficazes');
    await composer.press('Enter');

    // While the run streams (phase 'streaming' holds isExecuting), the transcript shows the
    // truncated FIRST-LINE placeholder - never the full reply (locked 3 + 8).
    const streamingCard = page.getByTestId('summary-card-streaming');
    await expect(streamingCard).toBeVisible({ timeout: 30_000 });
    await expect(streamingCard).toContainText(SHEET1_TITLE);
    await expect(streamingCard).not.toContainText('Prepare a agenda com antecedência');

    // The session is real; the stubbed pipeline never persisted the reply - do it here (the
    // server-side effect the real pipeline performs), so the LIVE sheets read serves sheet S.
    await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split('/').pop()!;
    const msgRes = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
      headers: auth,
      data: {
        role: 'assistant',
        content: SHEET1_BODY,
        // traceId emulates the pipeline's B1 provenance stamp - the settle-time
        // resolver routes by it (never by content recency).
        metadata: { isEssential: true, type: 'text', traceId: RUN_IDS[0] },
      },
    });
    expect(msgRes.status()).toBe(201);

    // Settle run 1: the transcript card appears as the first-line placeholder and the feed
    // loads sheet S from the live endpoint.
    runPhase[RUN_IDS[0]] = 'complete';
    const summaryCards = page.getByTestId('summary-card');
    await expect(summaryCards).toHaveCount(1, { timeout: 30_000 });
    await expect(summaryCards.first().getByTestId('summary-card-placeholder')).toContainText(SHEET1_TITLE);
    await expect(page.getByTestId('summary-card-streaming')).toHaveCount(0);
    const sheetCards = page.getByTestId('sheet-card');
    await expect(sheetCards).toHaveCount(1, { timeout: 30_000 });

    // The sheet's REAL ids (live read - never stubbed) feed the reply_summary stub.
    const sheetsRes1 = await page.request.get(`${API}/api/v1/sessions/${sessionId}/sheets`, { headers: auth });
    expect(sheetsRes1.status()).toBe(200);
    const sheets1 = (await sheetsRes1.json()) as {
      items: Array<{ sheetId: string; title: string; revisions: Array<{ revisionId: string }> }>;
    };
    expect(sheets1.items).toHaveLength(1);
    const sheetId = sheets1.items[0]!.sheetId;
    expect(sheets1.items[0]!.title).toBe(SHEET1_TITLE);

    // The B2 reply_summary arrives -> the placeholder upgrades to title + summary (locked 8).
    const summaryEvent1 = {
      type: 'reply_summary',
      sessionId,
      sheetId,
      revisionId: sheets1.items[0]!.revisions[0]!.revisionId,
      ...SUMMARY1,
    };
    expect(NotificationEvent.safeParse(summaryEvent1).success, 'reply_summary stub validates').toBe(true);
    notifQueue.push(summaryEvent1);
    await expect(summaryCards.first().getByTestId('summary-card-title')).toContainText(SUMMARY1.title, {
      timeout: 30_000,
    });
    await expect(summaryCards.first().getByTestId('summary-card-summary')).toContainText(SUMMARY1.summary);

    // ==================== 2. CARD CLICK FOCUSES ITS SHEET ====================
    await summaryCards.first().click();
    await expect(sheetCards.first(), 'card click flashes its sheet').toHaveClass(/sheet-flash/, {
      timeout: 5_000,
    });
    await expect(sheetCards.first()).not.toHaveClass(/sheet-flash/, { timeout: 10_000 });

    // ==================== 3. THE HEURISTIC SETS THE CHIP ====================
    await composer.fill('Torna o tom mais formal');
    const chip = page.getByTestId('composer-chip');
    await expect(chip, 'imperative edit verb auto-sets the chip').toBeVisible({ timeout: 5_000 });
    await expect(chip).toContainText(`A editar: ${SHEET1_TITLE}`);

    // ==================== 4. CHIP SEND -> REVISION ON THE SAME SHEET ====================
    runResult[RUN_IDS[1]] = REVISED_BODY;
    await composer.press('Enter');
    await expect.poll(() => createBodies.length, { timeout: 15_000 }).toBe(2);
    // The CLIENT half of the routing proof (codex fix 3): the intercepted /chat/runs POST
    // body carries the chip sheet's id. The server half lives in chat-lifecycle unit tests.
    expect(createBodies[1]!.reviseSheetId, 'chip send carries the revision target').toBe(sheetId);

    // Server-side effect of the (stubbed) pipeline: the revision lands on S via the REAL
    // revisions endpoint BEFORE the run settles, so the settle refetch sees it.
    const revRes = await page.request.post(
      `${API}/api/v1/sessions/${sessionId}/sheets/${sheetId}/revisions`,
      { headers: auth, data: { content: REVISED_BODY, instruction: 'Torna o tom mais formal' } },
    );
    expect(revRes.status()).toBe(201);
    const revised = (await revRes.json()) as { sheetId: string; revisions: Array<{ revisionId: string }> };
    expect(revised.sheetId).toBe(sheetId);
    expect(revised.revisions).toHaveLength(2);
    // ... and the pipeline persists the revision REPLY with its back-reference metadata
    // (decision B.B) - the settle-time resolution reads these ids off the server row and
    // stamps the local mirror card with them (codex fix 2: server truth, never the chip).
    const msg2Res = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
      headers: auth,
      data: {
        role: 'assistant',
        content: REVISED_BODY,
        metadata: {
          isEssential: true,
          type: 'text',
          traceId: RUN_IDS[1],
          sheetId,
          revisionId: revised.revisions[1]!.revisionId,
          revisionNumber: 2,
        },
      },
    });
    expect(msg2Res.status()).toBe(201);

    // Settle run 2 and PROVE via the live sheets read that the SAME sheet grew (locked 5:
    // no new sheet; waitForResponse captures the actual server body).
    const sheetsResponsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === 'GET' &&
        r.url().includes(`/api/v1/sessions/${sessionId}/sheets`),
      { timeout: 30_000 },
    );
    runPhase[RUN_IDS[1]] = 'complete';
    const sheetsResponse = await sheetsResponsePromise;
    expect(sheetsResponse.status()).toBe(200);
    const sheetsBody = (await sheetsResponse.json()) as {
      items: Array<{ sheetId: string; revisions: unknown[] }>;
    };
    expect(sheetsBody.items, 'still ONE sheet - the revision spawned no sibling').toHaveLength(1);
    expect(sheetsBody.items[0]!.sheetId).toBe(sheetId);
    expect(sheetsBody.items[0]!.revisions, 'revisions grew on the SAME sheet').toHaveLength(2);
    await expect(page.getByTestId('sheet-rev-label')).toHaveText('Revisão 2 de 2', { timeout: 30_000 });
    await expect(summaryCards).toHaveCount(2, { timeout: 30_000 });

    // The revision-turn reply_summary (revision ordinal included) -> the revision card
    // framing, and clicking it focuses the SAME sheet (multiple cards -> one sheet).
    const summaryEvent2 = {
      type: 'reply_summary',
      sessionId,
      sheetId,
      revisionId: revised.revisions[1]!.revisionId,
      revision: 2,
      ...SUMMARY2,
    };
    expect(NotificationEvent.safeParse(summaryEvent2).success, 'revision reply_summary validates').toBe(true);
    notifQueue.push(summaryEvent2);
    const revisionCard = summaryCards.nth(1);
    await expect(revisionCard.getByTestId('summary-card-title')).toContainText(
      `Revisão 2 · ${SUMMARY2.title}`,
      { timeout: 30_000 },
    );
    await revisionCard.click();
    const sameSheet = page.locator(`[data-sheet-id="${sheetId}"]`);
    await expect(sameSheet, 'revision card focuses the SAME sheet').toHaveClass(/sheet-flash/, {
      timeout: 5_000,
    });

    // ==================== 5. CHIP DISMISS -> NEXT REPLY IS A NEW SHEET ====================
    runResult[RUN_IDS[2]] = SHEET2_BODY;
    await composer.fill('Acrescenta um exemplo prático');
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('composer-chip-dismiss').click();
    await expect(chip).toHaveCount(0);
    await composer.press('Enter');
    await expect.poll(() => createBodies.length, { timeout: 15_000 }).toBe(3);
    expect(createBodies[2]!.reviseSheetId, 'dismissed chip sends NO revision target').toBeUndefined();

    // Server-side effect: the reply persists as a NEW assistant message -> a NEW sheet.
    const msg3Res = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
      headers: auth,
      data: {
        role: 'assistant',
        content: SHEET2_BODY,
        metadata: { isEssential: true, type: 'text', traceId: RUN_IDS[2] },
      },
    });
    expect(msg3Res.status()).toBe(201);
    runPhase[RUN_IDS[2]] = 'complete';
    await expect(sheetCards, 'a second sheet card - the dismissal forced a NEW sheet').toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('sheet-card').filter({ hasText: SHEET2_TITLE })).toBeVisible();

    // ==================== 6. FOLLOW-UP PILL -> CHIP TARGETS ITS SHEET ====================
    // The pill is the manual SET affordance (locked 6): it lives in sheet 1's footer, so it
    // sets the chip to SHEET 1 - even though sheet 2 is now the most recent - and drafts its
    // suggestion into the composer. The send then revises SHEET 1 (no heuristic involved:
    // the pill texts are infinitives the B.D classifier deliberately does not match).
    runResult[RUN_IDS[3]] = `${SHEET1_TITLE}\n\nVersão desenvolvida em mais detalhe do guia de reuniões.`;
    const sheet1Card = page.locator(`[data-sheet-id="${sheetId}"]`);
    const pill = sheet1Card.getByTestId('sheet-follow-up').first();
    const pillText = (await pill.textContent())!.trim();
    await pill.click();
    await expect(chip, 'pill click sets the chip to ITS sheet').toBeVisible({ timeout: 5_000 });
    await expect(chip).toContainText(`A editar: ${SHEET1_TITLE}`);
    await expect(composer, 'pill drafts its suggestion into the composer').toHaveValue(pillText);
    await composer.press('Enter');
    await expect.poll(() => createBodies.length, { timeout: 15_000 }).toBe(4);
    expect(createBodies[3]!.reviseSheetId, 'pill send targets the PILL sheet, not the latest').toBe(sheetId);

    // Server-side effect + settle: the revision lands on sheet 1 (rev 3), no third sheet.
    const rev3Res = await page.request.post(
      `${API}/api/v1/sessions/${sessionId}/sheets/${sheetId}/revisions`,
      { headers: auth, data: { content: runResult[RUN_IDS[3]]!, instruction: pillText } },
    );
    expect(rev3Res.status()).toBe(201);
    const rev3 = (await rev3Res.json()) as { revisions: Array<{ revisionId: string }> };
    const msg4Res = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
      headers: auth,
      data: {
        role: 'assistant',
        content: runResult[RUN_IDS[3]]!,
        metadata: {
          isEssential: true,
          type: 'text',
          traceId: RUN_IDS[3],
          sheetId,
          revisionId: rev3.revisions[2]!.revisionId,
          revisionNumber: 3,
        },
      },
    });
    expect(msg4Res.status()).toBe(201);
    runPhase[RUN_IDS[3]] = 'complete';
    await expect(page.getByTestId('sheet-rev-label')).toHaveText('Revisão 3 de 3', { timeout: 30_000 });
    await expect(sheetCards, 'pill send spawned NO sibling sheet').toHaveCount(2);

    // Zero console errors on the dashboard (carried e2e discipline). SSE-reconnect noise
    // from the stubbed notification/run streams is benign and excluded.
    const real = errors.filter((e) => !/event.?source|notifications\/events|network error/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });
});
