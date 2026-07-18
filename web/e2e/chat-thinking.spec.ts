import { test, expect, type Page } from '@playwright/test';
import { ChatRunEvent, ChatRun, ChatRunCreateResponse } from '@ekoa/shared';

/**
 * Chat thinking channel — deterministic, LLM-free (ch05 §5.7 + ch12 white-label).
 *
 * The agent's working commentary streams as `thinking_chunk` and renders as a collapsible
 * thinking section: expanded while the run thinks, collapsed (re-expandable) once the answer
 * lands. The engine identity must NEVER reach the DOM — the server redacts the wire, and the
 * client render is the net for replayed pre-fix events, which this spec simulates by streaming
 * a RAW engine self-identification through the schema-validated SSE stub.
 *
 * Real UI login, no protocol stubs except schema-validated ones (every stubbed payload is
 * safeParse-checked against the shared/ schemas in-spec), zero console errors.
 */

const RUN_ID = 'run-thinking-e2e';
const ANSWER = 'Sou o Agente EKOA, o assistente da plataforma.';
const LEAK = /\b(claude|anthropic|sonnet)\b/i;

const SSE_EVENTS = [
  { type: 'ready', runId: RUN_ID },
  { type: 'thinking_chunk', text: 'O utilizador pergunta que modelo sou. ' },
  // A raw engine mention: simulates a replayed event from BEFORE the server-side redaction —
  // the client render net must keep it out of the DOM.
  { type: 'thinking_chunk', text: 'Eu sou o Claude Sonnet, mas apresento-me como Agente EKOA.' },
  { type: 'text_chunk', text: ANSWER },
  { type: 'complete', result: ANSWER, durationMs: 1200 },
] as const;

function sseBody(): string {
  return SSE_EVENTS.map((e, i) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\nid: ${i + 1}\n\n`).join('');
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('chat thinking channel', () => {
  test('thinking streams into a collapsible section, collapses on completion, and no engine identity ever reaches the DOM', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    // Every stub below is schema-validated (the QA rule: no protocol stubs except
    // schema-validated ones).
    for (const e of SSE_EVENTS) {
      expect(ChatRunEvent.safeParse(e).success, `stub event ${e.type} validates`).toBe(true);
    }
    const createResponse = { runId: RUN_ID };
    expect(ChatRunCreateResponse.safeParse(createResponse).success).toBe(true);
    const runView = { id: RUN_ID, status: 'running' };
    expect(ChatRun.safeParse(runView).success).toBe(true);

    // DOM leak sentinel: records any engine-name appearance ANY time, so even a transient
    // flash during streaming fails the spec (the original bug was exactly that flash).
    await page.addInitScript(() => {
      const w = window as unknown as { __engineLeaks: string[] };
      w.__engineLeaks = [];
      const scan = (text: string | null) => {
        if (text && /\b(claude|anthropic|sonnet)\b/i.test(text)) w.__engineLeaks.push(text.slice(0, 200));
      };
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'characterData') scan(m.target.textContent);
          for (const n of m.addedNodes) scan(n.textContent);
        }
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    });

    await page.route('**/api/v1/chat/runs', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(createResponse) })
        : route.fallback(),
    );
    await page.route(`**/api/v1/chat/runs/${RUN_ID}/events**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: sseBody(),
      }),
    );
    await page.route(`**/api/v1/chat/runs/${RUN_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runView) }),
    );

    await login(page);

    // Send a free-form chat message from the composer.
    const composer = page.locator('textarea').first();
    await composer.fill('que modelo és tu?');
    await composer.press('Enter');

    // The answer arrives…
    await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 30_000 });

    // …with the thinking section collapsed into its duration row.
    const thinkingToggle = page.getByRole('button', { name: /Pensou durante \d+s|Thought for \d+s/ }).first();
    await expect(thinkingToggle).toBeVisible({ timeout: 10_000 });
    await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'false');

    // Re-expanding reveals the REDACTED commentary.
    await thinkingToggle.click();
    await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(/apresento-me como Agente EKOA/).first()).toBeVisible();

    // The engine identity never appeared in the DOM — not even as a transient flash.
    const leaks = await page.evaluate(() => (window as unknown as { __engineLeaks: string[] }).__engineLeaks);
    expect(leaks, `engine identity flashed in the DOM: ${leaks.join(' | ')}`).toHaveLength(0);
    expect(await page.locator('body').textContent()).not.toMatch(LEAK);

    // Zero console errors on the dashboard (carried e2e discipline).
    const meaningful = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('Download the React DevTools'),
    );
    expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  });

  const STUCK_RUN_ID = 'run-thinking-stuck-e2e';

  test('a wedged worker times out with a retryable error instead of a stuck spinner forever', async ({ page }) => {
    // Dogfood bug: a queued message can sit in "A pensar..." indefinitely when
    // the backend worker never emits another event (observed live stuck for
    // 182 minutes — no error, no timeout, no retry). Simulate the wedge with
    // an SSE stub that sends only `ready`, never `thinking_chunk`/`complete`/
    // `error` — the native EventSource reconnects and gets the same
    // single-event body every time, so the run never settles on its own.
    const createResponse = { runId: STUCK_RUN_ID };
    expect(ChatRunCreateResponse.safeParse(createResponse).success).toBe(true);
    const stillRunning = { id: STUCK_RUN_ID, status: 'running' };
    expect(ChatRun.safeParse(stillRunning).success).toBe(true);
    const readyEvent = { type: 'ready', runId: STUCK_RUN_ID };
    expect(ChatRunEvent.safeParse(readyEvent).success).toBe(true);

    await page.route('**/api/v1/chat/runs', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(createResponse) })
        : route.fallback(),
    );
    await page.route(`**/api/v1/chat/runs/${STUCK_RUN_ID}/events**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: `event: ready\ndata: ${JSON.stringify(readyEvent)}\nid: 1\n\n`,
      }),
    );
    // The `ready` re-sync path (GET .../runs/:id) also reports still-running,
    // so re-sync never settles the run early either — this is a GENUINE wedge.
    await page.route(`**/api/v1/chat/runs/${STUCK_RUN_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stillRunning) }),
    );

    await login(page);

    // Install the mock clock AFTER login/compile (never before — it would
    // freeze the dev-server's own real-time chunk loading) but BEFORE the
    // send, so the page's own `setTimeout(..., CHAT_RUN_STUCK_TIMEOUT_MS)`
    // for THIS run is captured as a virtual timer from the moment it is
    // created — a timer already scheduled on the real clock before install()
    // is not retroactively fast-forwardable.
    await page.clock.install();

    const composer = page.locator('textarea').first();
    await composer.fill('mensagem que nunca mais chega...');
    await composer.press('Enter');

    // The run is genuinely in flight before we fast-forward past the deadline.
    await expect(page.getByText(/A pensar|Pensando|Thinking/i).first()).toBeVisible({ timeout: 10_000 });

    // Jump past the client's stuck-run deadline (CHAT_RUN_STUCK_TIMEOUT_MS =
    // 5min in the page) without a real 5-minute wait.
    await page.clock.fastForward('05:01');

    // A retryable, branded error surfaces — never a spinner stuck forever.
    await expect(
      page.getByText(/demorou demasiado tempo|took too long/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The composer is usable again — the user can actually retry.
    await composer.fill('a segunda tentativa');
    await expect(composer).toHaveValue('a segunda tentativa');
  });
});
