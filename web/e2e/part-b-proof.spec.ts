import { test, expect, type Page } from '@playwright/test';
import { Sheet } from '@ekoa/shared';

/**
 * Part B proof (slice B7, run 20260717-190134): ONE LIVE-MODEL session against the
 * credentialed boot-b stack (api/tests/journeys/boot-b.mjs). NO run stubs - every chat
 * turn is a real agent run through the live pipeline; every sheets/messages read is the
 * live B1 endpoint. This is the BRIEF §4 proof session:
 *
 *   1. Plain short Q&A  -> summary card + display-scale sheet (locked 3 + 10).
 *   2. Long structured Q&A -> streaming placeholder card while the reply streams, then an
 *      article/dense-scale sheet.
 *   3. Drafting flow: a short client-message draft, then THREE successive chip-targeted
 *      edits (imperative PT sets the chip - decision B.D). ONE sheet whose revisions grow
 *      1 -> 4, asserted turn-by-turn via the LIVE sheets read; auto-follow + scroll-flash
 *      on each agent revision (the B4 carried item); the revision card focuses the SAME
 *      sheet (locked 5).
 *   4. Chip dismiss -> the next reply lands on a NEW sheet (locked 6).
 *   5. Reload -> everything restored from the server: cards INCLUDING the upgraded summary
 *      TITLE (B7 finding 1: the reply_summary is persisted onto the turn's metadata at emit
 *      time and rehydrated by the transcript read), revision framing, sheets, revisions,
 *      chip gone.
 *   6. Provenance (B1 carried item, best-effort branch): IF any sheet-bearing turn used
 *      memories, its provenance line pins `memoriesUsed > 0`; the traceId provenance is
 *      pinned unconditionally on the first sheet.
 *   7. Summary-failure degradation (decision B.E, spec level): with the notifications SSE
 *      blocked (route abort - no reply_summary can arrive), a turn's card KEEPS the
 *      first-line placeholder. The positive half (a live reply_summary upgrading the card)
 *      is asserted in step 1, so this negative is meaningful.
 *
 * DIVISION OF PROOF (do not widen this spec): build-mode panel coexistence in the unified
 * frame is proven deterministically by chat-layout-unified.spec.ts and the mobile FAB
 * overlay by mobile-sheet-feed.spec.ts (both schema-validated-stub band4 specs). They are
 * deliberately NOT redone against the live model here - live turns are slow and those
 * behaviors are layout wiring, not pipeline behavior.
 *
 * RUNNING: needs `node api/tests/journeys/boot-b.mjs up` (claudeAuth.ok=true is asserted
 * up front - an uncredentialed stack fails loudly, never a false green). ~8 live turns at
 * up to ~60s each: expect 8-15 minutes. Ledgered under band5_live_proof (OPERATOR-RUN
 * posture: run deliberately, never in the per-PR lane - it burns real model tokens).
 * Real UI login, PT-PT strings, zero console errors.
 */

const API = 'http://localhost:4111';

/** Generous per-turn ceiling: a live chat turn is ~60s (walkthrough notes), builds longer. */
const TURN_TIMEOUT = 120_000;

// Short/long prompts kept SHORT (the auto-resizing composer trap) and firmly shaped so the
// length-scaled typography tiers are deterministic: <240 chars = display, >240 = article/dense.
const PROMPT_SHORT = 'Que dia é hoje? Responde numa única frase curta, sem mais nada.';
const PROMPT_LONG =
  'Explica, com títulos e 4 a 6 parágrafos, as fases principais de um processo civil em Portugal.';
const PROMPT_DRAFT =
  'Escreve uma mensagem curta (3 a 4 frases) para um cliente a adiar a reunião de amanhã.';
// Imperative PT edit instructions - each matches the B.D heuristic (torna/encurta/acrescenta)
// so the chip auto-sets before every send.
const EDITS = [
  'Torna o tom mais formal.',
  'Encurta a mensagem para metade.',
  'Acrescenta uma despedida cordial no final.',
] as const;
const PROMPT_DISMISS = 'Acrescenta uma nota sobre a disponibilidade na próxima semana.';
const PROMPT_DEGRADED = 'Qual é a capital de França? Responde numa frase curta.';

interface SheetItem {
  sheetId: string;
  title: string;
  createdFromMessageId: string;
  revisions: Array<{ revisionId: string; content: string }>;
}
interface MessageRow {
  id: string;
  role: string;
  content: string;
  metadata?: {
    traceId?: string;
    memoriesUsed?: number;
    sheetId?: string;
    revisionNumber?: number;
    /** B7 finding 1: the persisted post-run summary - the reload-restore source. */
    summaryTitle?: string;
    summarySummary?: string;
  };
}

/** Mirror of the client's placeholder markdown strip (chat-panel firstLineOf, finding 2):
 *  the card never renders raw bold/list/heading syntax, so the raw-content assertion must
 *  strip the same way. */
function stripMdLine(line: string): string {
  return line
    .replace(/^\s*(?:#+|>+)\s*/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
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

test.describe('Part B proof - live model (B7)', () => {
  test('one live session: Q&A scale tiers, 3-edit one-sheet drafting, chip dismiss, reload restore, provenance, summary degradation', async ({
    page,
  }, testInfo) => {
    // ~8 live turns at up to TURN_TIMEOUT each, plus asserts: 25 min ceiling.
    test.setTimeout(1_500_000);

    // -- Live-stack preflight: this proof is meaningless against an uncredentialed stack.
    const health = await page.request.get(`${API}/health`);
    expect(health.ok(), 'boot-b stack reachable on :4111').toBe(true);
    const healthBody = (await health.json()) as { claudeAuth?: { ok?: boolean } };
    expect(
      healthBody.claudeAuth?.ok,
      'claudeAuth.ok=true - run `node api/tests/journeys/boot-b.mjs up` (credentialed boot-b), not the plain dev driver',
    ).toBe(true);

    // -- Pre-clean: /chat auto-resumes the most recent session (walkthrough-notes trap);
    //    stale sessions would hide the blank state and leave ambiguous sheet cards.
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

    const errors = trackConsoleErrors(page);
    await login(page);

    const composer = page.locator('textarea').first();
    const summaryCards = page.getByTestId('summary-card');
    const sheetCards = page.getByTestId('sheet-card');
    const chip = page.getByTestId('composer-chip');

    /** Send one live turn and wait for it to settle (its summary card lands at settle). */
    const sendTurn = async (text: string, cardsAfter: number) => {
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(text);
      await composer.press('Enter');
      await expect(summaryCards).toHaveCount(cardsAfter, { timeout: TURN_TIMEOUT });
    };

    /** The LIVE sheets read (never stubbed) - the server truth every step asserts against. */
    const readSheets = async (sessionId: string): Promise<SheetItem[]> => {
      const res = await page.request.get(`${API}/api/v1/sessions/${sessionId}/sheets`, {
        headers: auth,
      });
      expect(res.status(), 'live B1 sheets read answers 200').toBe(200);
      return ((await res.json()) as { items: SheetItem[] }).items;
    };
    const readMessages = async (sessionId: string): Promise<MessageRow[]> => {
      const res = await page.request.get(`${API}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
      });
      expect(res.status()).toBe(200);
      return ((await res.json()) as { items: MessageRow[] }).items;
    };

    // ==================== 1. PLAIN SHORT Q&A -> DISPLAY-SCALE SHEET ====================
    await sendTurn(PROMPT_SHORT, 1);
    await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 15_000 });
    const sessionId = new URL(page.url()).pathname.split('/').pop()!;

    await expect(page.getByTestId('sheet-feed')).toBeVisible({ timeout: 15_000 });
    await expect(sheetCards).toHaveCount(1, { timeout: 30_000 });
    await expect(
      sheetCards.first().getByTestId('sheet-body'),
      'a one-sentence reply renders at display scale (locked 10)',
    ).toHaveClass(/sheet-scale-display/);

    const sheets1 = await readSheets(sessionId);
    expect(sheets1).toHaveLength(1);
    for (const item of sheets1) {
      expect(Sheet.safeParse(item).success, 'live sheets body validates against shared schema').toBe(
        true,
      );
    }
    expect(sheets1[0]!.revisions).toHaveLength(1);

    // The LIVE B2 loop: the post-run Haiku reply_summary arrives on the notifications SSE
    // and upgrades the placeholder to title + summary. Asserted once here so step 7's
    // blocked-stream negative (placeholder KEPT) proves the degradation, not the absence
    // of the feature.
    await expect(
      summaryCards.first().getByTestId('summary-card-title'),
      'live reply_summary upgrades the card',
    ).toBeVisible({ timeout: 90_000 });

    // ==================== 2. LONG Q&A -> ARTICLE/DENSE SHEET ====================
    await composer.fill(PROMPT_LONG);
    await composer.press('Enter');
    // While the long reply streams, the transcript shows the truncated first-line
    // placeholder card - never the full reply (locked 3 + 8), live this time. With the B7
    // transport partials real (`includePartialMessages` at the chokepoint, stream-partials
    // suite), the long turn's deltas reach the client live, so the mid-stream card is a HARD
    // assertion here - no card-vs-settled race, no annotation escape hatch. The generous
    // timeout only covers time-to-first-delta (model + gateway latency), not a burst window.
    const streamingCard = page.getByTestId('summary-card-streaming');
    await expect(streamingCard, 'live partial deltas render the streaming card mid-turn').toBeVisible({
      timeout: TURN_TIMEOUT,
    });
    await expect(summaryCards).toHaveCount(2, { timeout: TURN_TIMEOUT });
    await expect(sheetCards).toHaveCount(2, { timeout: 30_000 });
    await expect(
      sheetCards.nth(1).getByTestId('sheet-body'),
      'a multi-paragraph reply renders at article or dense scale (locked 10)',
    ).toHaveClass(/sheet-scale-(article|dense)/);
    expect(await readSheets(sessionId)).toHaveLength(2);

    // ==================== 3. DRAFTING FLOW: 3 CHIP-TARGETED EDITS, ONE SHEET ====================
    await expect(chip, 'no chip before the drafting flow').toHaveCount(0);
    await sendTurn(PROMPT_DRAFT, 3);
    await expect(sheetCards).toHaveCount(3, { timeout: 30_000 });

    const sheetsAfterDraft = await readSheets(sessionId);
    expect(sheetsAfterDraft).toHaveLength(3);
    // Sheets list in transcript order: the draft is the third (and newest) sheet.
    const draftSheet = sheetsAfterDraft[2]!;
    expect(draftSheet.sheetId).not.toBe(sheets1[0]!.sheetId);
    expect(draftSheet.revisions, 'the draft starts at revision 1').toHaveLength(1);
    const draftCard = page.locator(`[data-sheet-id="${draftSheet.sheetId}"]`);

    for (let i = 0; i < EDITS.length; i++) {
      const revisionsAfter = i + 2; // 2, 3, 4
      // Typing an imperative edit auto-sets the chip on the most recent sheet - the draft
      // (decision B.D; the visible chip is the ONLY revision-routing input, locked 6).
      await composer.fill(EDITS[i]!);
      await expect(chip, `edit ${i + 1}: the heuristic sets the chip`).toBeVisible({
        timeout: 5_000,
      });
      await expect(chip).toContainText('A editar:');
      await expect(chip).toContainText(draftSheet.title.slice(0, 24));
      await composer.press('Enter');

      // Auto-follow + scroll-flash (the B4 carried item): the settle refetch diffs the
      // grown revision list -> scroll-to + flash on the revised sheet. The expectation is
      // armed BEFORE settle so the 1.6s flash window is caught.
      await expect(
        draftCard,
        `edit ${i + 1}: the revised sheet flashes (revise-in-place, locked 5)`,
      ).toHaveClass(/sheet-flash/, { timeout: TURN_TIMEOUT });
      await expect(draftCard, `edit ${i + 1}: auto-follow brought the sheet into view`).toBeInViewport(
        { ratio: 0.1, timeout: 10_000 },
      );
      await expect(summaryCards).toHaveCount(3 + i + 1, { timeout: TURN_TIMEOUT });
      await expect(draftCard.getByTestId('sheet-rev-label')).toHaveText(
        `Revisão ${revisionsAfter} de ${revisionsAfter}`,
        { timeout: 30_000 },
      );

      // Server truth turn-by-turn: revisions grow 1 -> 4 on the SAME sheet, no siblings.
      const now = await readSheets(sessionId);
      expect(now, `edit ${i + 1}: still 3 sheets - the revision spawned no sibling`).toHaveLength(3);
      const grown = now.find((s) => s.sheetId === draftSheet.sheetId);
      expect(grown, `edit ${i + 1}: the draft sheet still exists`).toBeTruthy();
      expect(
        grown!.revisions,
        `edit ${i + 1}: revisions grew to ${revisionsAfter} on the SAME sheet`,
      ).toHaveLength(revisionsAfter);
    }

    // The last revision turn's transcript card carries the revision framing and focuses
    // the SAME sheet (locked 5: several cards, one sheet) through the store seam. Wait out
    // the settle flash first so the click's flash is a fresh signal, not a stale positive.
    await expect(draftCard).not.toHaveClass(/sheet-flash/, { timeout: 10_000 });
    const lastRevisionCard = summaryCards.nth(5);
    await expect(lastRevisionCard).toContainText('Revisão 4', { timeout: 30_000 });
    await lastRevisionCard.click();
    await expect(draftCard, 'the revision card focuses the SAME sheet').toHaveClass(/sheet-flash/, {
      timeout: 5_000,
    });

    // ==================== 4. CHIP DISMISS -> A NEW SHEET ====================
    await composer.fill(PROMPT_DISMISS);
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('composer-chip-dismiss').click();
    await expect(chip, 'dismissed chip is gone before the send').toHaveCount(0);
    await composer.press('Enter');
    await expect(summaryCards).toHaveCount(7, { timeout: TURN_TIMEOUT });
    await expect(sheetCards, 'the dismissal forced a NEW sheet').toHaveCount(4, {
      timeout: 30_000,
    });
    const sheetsAfterDismiss = await readSheets(sessionId);
    expect(sheetsAfterDismiss).toHaveLength(4);
    expect(
      sheetsAfterDismiss.find((s) => s.sheetId === draftSheet.sheetId)!.revisions,
      'the draft sheet did NOT take the dismissed turn as a revision',
    ).toHaveLength(4);

    // ==================== 5. RELOAD -> EVERYTHING RESTORED ====================
    // B7 finding 1 precondition: the step-1 summary (its live title upgrade was asserted)
    // was ALSO persisted onto the first assistant turn's metadata. Server-truth wait - the
    // metadata write lands just after the live emit, so poll it before reloading.
    await expect
      .poll(
        async () =>
          (await readMessages(sessionId)).find((r) => r.role === 'assistant')?.metadata
            ?.summaryTitle,
        {
          timeout: 30_000,
          message: 'the live reply_summary was persisted onto the first turn metadata (finding 1)',
        },
      )
      .toBeTruthy();
    const persistedTitle = (await readMessages(sessionId)).find((r) => r.role === 'assistant')!
      .metadata!.summaryTitle!;

    // Block the notifications SSE from HERE: (a) proves the restore path needs no live
    // event channel - cards, sheets, revisions AND summary titles come from persisted
    // server state; and (b) the fresh page never opens a notifications stream, so step 7's
    // degradation window is airtight (an already-open stream would survive a later route
    // block).
    await page.route('**/api/v1/notifications/events**', (route) => route.abort());
    await page.reload();

    await expect(summaryCards, 'reload restores all 7 transcript cards').toHaveCount(7, {
      timeout: 60_000,
    });
    await expect(sheetCards, 'reload restores all 4 sheets').toHaveCount(4, { timeout: 30_000 });
    await expect(
      draftCard.getByTestId('sheet-rev-label'),
      'reload restores the revision history',
    ).toHaveText('Revisão 4 de 4', { timeout: 30_000 });
    // B7 finding 1: the summary TITLE survives the reload - rehydrated from the persisted
    // turn metadata (with the notifications SSE blocked, no live event can explain it).
    await expect(
      summaryCards.first().getByTestId('summary-card-title'),
      'reload restores the upgraded summary title from persisted metadata (finding 1)',
    ).toContainText(persistedTitle, { timeout: 30_000 });
    // The persisted revisionNumber still frames the revision card after reload.
    await expect(summaryCards.nth(5)).toContainText('Revisão 4');
    await expect(chip, 'the chip does not survive a reload').toHaveCount(0);

    // ==================== 6. PROVENANCE (best-effort branch, B1 carried item) ====================
    const rows = await readMessages(sessionId);
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const sheetsFinal = await readSheets(sessionId);
    const sourceOf = (s: SheetItem) => rowById.get(s.createdFromMessageId);

    // Unconditional: the live pipeline stamps traceId on every assistant turn (B1 writer);
    // the first sheet's provenance line renders it.
    const firstSheet = sheetsFinal[0]!;
    const firstTrace = sourceOf(firstSheet)?.metadata?.traceId;
    expect(firstTrace, 'the live pipeline stamped traceId on the first reply').toBeTruthy();
    await expect(
      page.locator(`[data-sheet-id="${firstSheet.sheetId}"]`).getByTestId('sheet-provenance'),
    ).toContainText(firstTrace!);

    // Best-effort: boot-b starts with an empty memory store, but post-run extraction can
    // populate it mid-session - IF any sheet-bearing turn then used memories, pin the
    // rendered count; otherwise the traceId assert above is the provenance proof.
    const memSheet = sheetsFinal.find((s) => (sourceOf(s)?.metadata?.memoriesUsed ?? 0) > 0);
    if (memSheet) {
      const used = sourceOf(memSheet)!.metadata!.memoriesUsed!;
      testInfo.annotations.push({
        type: 'provenance-branch',
        description: `memoriesUsed=${used} pinned on sheet ${memSheet.sheetId}`,
      });
      await expect(
        page.locator(`[data-sheet-id="${memSheet.sheetId}"]`).getByTestId('sheet-provenance'),
      ).toContainText(used === 1 ? '1 memória usada' : `${used} memórias usadas`);
    } else {
      testInfo.annotations.push({
        type: 'provenance-branch',
        description: 'no turn used memories (fresh boot-b store) - traceId branch asserted',
      });
    }

    // ==================== 7. SUMMARY-FAILURE DEGRADATION (B.E, spec level) ====================
    // The notifications SSE has been blocked since step 5 - no reply_summary can reach the
    // client. The turn still settles normally (the run stream is a different route) and its
    // card KEEPS the first-line placeholder, which step 1 proved would otherwise upgrade.
    await sendTurn(PROMPT_DEGRADED, 8);
    const degradedCard = summaryCards.nth(7);
    await expect(degradedCard.getByTestId('summary-card-placeholder')).toBeVisible({
      timeout: 15_000,
    });
    const degradedReply = (await readMessages(sessionId))
      .filter((r) => r.role === 'assistant')
      .pop()!;
    // Finding 2: the placeholder renders the first line with markdown syntax STRIPPED, so
    // the raw-content comparison strips the same way.
    const degradedFirstLine = degradedReply.content
      .split('\n')
      .map((l) => stripMdLine(l))
      .find((l) => l.length > 0)!;
    await expect(degradedCard.getByTestId('summary-card-placeholder')).toContainText(
      degradedFirstLine.slice(0, 30),
    );
    // Grace window: the post-run Haiku call lands within seconds when the channel is up
    // (step 1) - after it, the card must STILL be the placeholder, never a title.
    await page.waitForTimeout(8_000);
    await expect(
      degradedCard.getByTestId('summary-card-title'),
      'no summary upgrade without the notifications channel - the card degrades to its first line',
    ).toHaveCount(0);
    await expect(degradedCard.getByTestId('summary-card-placeholder')).toBeVisible();
    await expect(sheetCards, 'the degraded turn still produced its sheet').toHaveCount(5, {
      timeout: 30_000,
    });

    // Zero console errors on the dashboard (carried e2e discipline). SSE-reconnect noise
    // from the deliberately blocked notifications stream is benign and excluded.
    const real = errors.filter((e) => !/event.?source|notifications\/events|network error/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });
});
