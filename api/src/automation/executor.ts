/**
 * Pure Playwright runner. Executes a resolved PlaywrightAction or
 * PlaywrightAssertion against a Page. No vision, no caching, no LLM —
 * the engine handles those layers and only invokes this module once it
 * has a deterministic action to run.
 *
 * Throws on failure. Caller (engine.ts) catches, marks the step failed,
 * and decides whether to fall back to vision re-resolution.
 *
 * Ported as-is from the old Cortex automation family (carryover-audit A8): Playwright + types only.
 */

import type { Page, Locator as PlaywrightLocator } from 'playwright';
import type { Locator, PlaywrightAction, PlaywrightAssertion } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const FALLBACK_PROBE_MS = 2_000;
const TYPE_DELAY_MS = 35;

/**
 * Resolve our Locator type to a Playwright Locator. Throws on
 * unsupported strategy.
 */
export function resolveLocator(page: Page, locator: Locator): PlaywrightLocator {
  switch (locator.strategy) {
    case 'role':
      return page.getByRole(locator.role as Parameters<Page['getByRole']>[0], {
        name: locator.name,
        exact: locator.exact,
      });
    case 'text':
      return page.getByText(locator.value, { exact: locator.exact });
    case 'label':
      return page.getByLabel(locator.value, { exact: locator.exact });
    case 'placeholder':
      return page.getByPlaceholder(locator.value);
    case 'testid':
      return page.getByTestId(locator.value);
    case 'altText':
      return page.getByAltText(locator.value);
    case 'title':
      return page.getByTitle(locator.value);
    case 'css':
      return page.locator(locator.selector);
  }
}

/**
 * Resolve a locator with a small fallback ladder.
 *
 * Why this exists: vision picks `role + accessible name` whenever it can
 * — that's the right default — but on some sites the same intent is
 * reachable via several different ARIA shapes (Google's search field is
 * `combobox` / `searchbox` / `textbox` depending on layout), or the
 * accessible name has trailing whitespace, or the element is inside a
 * shadow root the role query can't see. Rather than always escalating
 * to the (expensive) fixer on a routine miss, we try a small ladder of
 * deterministic alternates first. If anything in the ladder is visible
 * within a couple of seconds, we use it; otherwise we fall back to the
 * primary locator so the caller's error message reflects what was
 * originally requested.
 */
async function resolveWithLadder(
  page: Page,
  locator: Locator,
  hint: 'click' | 'fill' | 'other',
  fillValue?: string,
): Promise<PlaywrightLocator> {
  const primary = resolveLocator(page, locator).first();

  // If the primary is already visible, use it. We probe quickly — the
  // full timeout is reserved for the actual action call.
  const primaryHit = await tryLocator(primary, FALLBACK_PROBE_MS);
  if (primaryHit) return primaryHit;

  for (const cand of buildLocatorCandidates(page, locator, hint, fillValue)) {
    const hit = await tryLocator(cand.first(), FALLBACK_PROBE_MS);
    if (hit) return hit;
  }
  // Nothing in the ladder hit; return the primary. The caller's
  // .click() / .fill() will fail with the original locator's error
  // message, which is what the fixer expects to read.
  return primary;
}

async function tryLocator(loc: PlaywrightLocator, timeoutMs: number): Promise<PlaywrightLocator | null> {
  try {
    await loc.waitFor({ state: 'visible', timeout: timeoutMs });
    return loc;
  } catch {
    return null;
  }
}

function buildLocatorCandidates(
  page: Page,
  primary: Locator,
  hint: 'click' | 'fill' | 'other',
  fillValue?: string,
): PlaywrightLocator[] {
  const out: PlaywrightLocator[] = [];

  // Same accessible name across multiple strategies — covers cases where
  // the screenshot showed e.g. "Sign in" but the actual ARIA role isn't
  // exactly what the model guessed.
  const accessibleName =
    primary.strategy === 'role' ? primary.name :
    primary.strategy === 'text' ? primary.value :
    primary.strategy === 'label' ? primary.value :
    primary.strategy === 'placeholder' ? primary.value :
    undefined;

  if (accessibleName && accessibleName.trim().length > 0) {
    if (primary.strategy !== 'label') {
      out.push(page.getByLabel(accessibleName));
    }
    if (primary.strategy !== 'placeholder') {
      out.push(page.getByPlaceholder(accessibleName));
    }
    if (primary.strategy !== 'text') {
      out.push(page.getByText(accessibleName, { exact: false }));
    }
    if (hint === 'fill') {
      const slug = accessibleName.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (slug.length > 0) {
        // Common pattern: name attribute matches the visible label.
        out.push(page.locator(`input[name*="${slug}" i], textarea[name*="${slug}" i]`));
        // ARIA-label matches the visible label.
        out.push(page.locator(`input[aria-label*="${slug}" i], textarea[aria-label*="${slug}" i]`));
      }
    }
  }

  // For text inputs, well-known shapes that work across most search /
  // login / email forms: name="q", role="searchbox", common type
  // attributes, the autofocus heuristic.
  if (hint === 'fill') {
    out.push(page.locator('input[name="q"], textarea[name="q"]'));
    out.push(page.locator('input[type="search"], textarea[role="searchbox"]'));
    out.push(page.locator('input[type="email"]'));
    out.push(page.locator('input[autofocus], textarea[autofocus]'));
    if (fillValue && fillValue.length > 0) {
      // If the model already half-filled something, the focused input
      // is the right target.
      out.push(page.locator(':focus'));
    }
  }
  if (hint === 'click' && accessibleName) {
    // Submit buttons sometimes have value= rather than text content.
    out.push(page.locator(`button[aria-label*="${accessibleName}" i]`));
    out.push(page.locator(`input[type="submit"][value*="${accessibleName}" i]`));
  }

  return out;
}

/**
 * Execute a resolved Playwright action. Throws on failure.
 *
 * Each action enforces DEFAULT_TIMEOUT_MS unless the action carries its
 * own time budget (wait kind). Click/fill auto-wait for visibility via
 * Playwright's built-in actionability checks.
 */
export async function executePlaywrightAction(page: Page, action: PlaywrightAction): Promise<void> {
  switch (action.kind) {
    case 'navigate': {
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'click': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.click({ timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'dblclick': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.dblclick({ timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'fill': {
      const target = await resolveWithLadder(page, action.locator, 'fill', action.value);
      // Human-shape input: focus by clicking, clear any existing value,
      // then type per-keystroke with a small delay. `fill()` writes the
      // value in one shot which a few high-traffic sites (Google, some
      // banks) fingerprint as bot input. pressSequentially dispatches
      // real keydown / keypress / input events.
      await target.click({ timeout: DEFAULT_TIMEOUT_MS });
      try {
        await target.fill('', { timeout: 2_000 });
      } catch {
        // Some elements (combobox-with-dropdown) reject .fill('');
        // fall back to selecting all + delete via keyboard.
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
      }
      await target.pressSequentially(action.value, { delay: TYPE_DELAY_MS, timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'press': {
      if (action.locator) {
        const target = await resolveWithLadder(page, action.locator, 'click');
        await target.press(action.key, { timeout: DEFAULT_TIMEOUT_MS });
      } else {
        await page.keyboard.press(action.key);
      }
      return;
    }
    case 'select': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.selectOption(action.value, { timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'check': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.check({ timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'uncheck': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.uncheck({ timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'hover': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.hover({ timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'wait': {
      await page.waitForTimeout(action.durationMs);
      return;
    }
    case 'wait_for': {
      const target = resolveLocator(page, action.locator);
      await target.waitFor({ state: action.state, timeout: DEFAULT_TIMEOUT_MS });
      return;
    }
    case 'scroll': {
      if (action.locator) {
        const target = resolveLocator(page, action.locator);
        await target.scrollIntoViewIfNeeded({ timeout: DEFAULT_TIMEOUT_MS });
      } else {
        const pixels = action.pixels ?? 600;
        const direction = action.direction === 'up' ? -pixels : pixels;
        await page.mouse.wheel(0, direction);
      }
      return;
    }
    case 'screenshot': {
      // Screenshot is a no-op at this layer — the engine takes a screenshot
      // after every step regardless. Step kind exists so the user can
      // request an explicit "take a screenshot" step in their automation.
      return;
    }
    case 'noop': {
      // Resolver said the step is already satisfied (page already in the
      // requested state, redundant planner step, etc.). Don't touch the
      // browser; the engine treats this as a successful completion.
      return;
    }
  }
}

/**
 * Execute a resolved assertion. Returns true on pass, throws on fail.
 *
 * For `expect_url` and `expect_title`, the `pattern` / `contains` field
 * is matched as a literal substring against the current URL or title
 * respectively (not a regex — we stay deterministic).
 */
export async function executePlaywrightAssertion(
  page: Page,
  assertion: PlaywrightAssertion,
): Promise<true> {
  switch (assertion.kind) {
    case 'expect_visible': {
      const target = resolveLocator(page, assertion.locator);
      const visible = await target.isVisible({ timeout: DEFAULT_TIMEOUT_MS }).catch(() => false);
      if (!visible) throw new Error(`expected locator to be visible`);
      return true;
    }
    case 'expect_hidden': {
      const target = resolveLocator(page, assertion.locator);
      const visible = await target.isVisible({ timeout: 2_000 }).catch(() => false);
      if (visible) throw new Error(`expected locator to be hidden`);
      return true;
    }
    case 'expect_text': {
      const target = resolveLocator(page, assertion.locator);
      const text = (await target.innerText({ timeout: DEFAULT_TIMEOUT_MS })) ?? '';
      if (!text.includes(assertion.contains)) {
        throw new Error(`expected text to contain "${assertion.contains}", got "${text.slice(0, 200)}"`);
      }
      return true;
    }
    case 'expect_url': {
      const url = page.url();
      if (!url.includes(assertion.pattern)) {
        throw new Error(`expected URL to contain "${assertion.pattern}", got "${url}"`);
      }
      return true;
    }
    case 'expect_title': {
      const title = await page.title();
      if (!title.includes(assertion.contains)) {
        throw new Error(`expected title to contain "${assertion.contains}", got "${title}"`);
      }
      return true;
    }
  }
}
