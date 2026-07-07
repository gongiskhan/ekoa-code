/**
 * Unit tests for the Playwright executor module. We stub the Playwright
 * Page surface — the executor itself is pure dispatch on the action
 * kind, so we just need to verify each kind hits the right Playwright
 * call with the right arguments.
 *
 * End-to-end "drive a real Chromium" coverage lives in the e2e suite
 * (Phase 5); here we keep the unit tests fast and deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  executePlaywrightAction,
  executePlaywrightAssertion,
  resolveLocator,
} from '../../src/automation/executor.js';
import type { PlaywrightAction, PlaywrightAssertion } from '../../src/automation/types.js';

// ---------------------------------------------------------------------------
// Stub Playwright Page + Locator
// ---------------------------------------------------------------------------

function makeLocator() {
  // Locator-like with .first() returning self so the executor's
  // "ladder" path resolves on the primary candidate without needing
  // a deeper chain.
  const loc = {
    click: vi.fn().mockResolvedValue(undefined),
    dblclick: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
    uncheck: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    innerText: vi.fn().mockResolvedValue(''),
  };
  // `first` self-references `loc`, so it's attached after the literal is
  // built (a property can't reference its own object literal inline).
  return Object.assign(loc, { first: vi.fn(() => loc) });
}

function makePage() {
  const locator = makeLocator();
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    title: vi.fn().mockResolvedValue(''),
    url: vi.fn().mockReturnValue('https://example.com/'),

    // Locator factories
    getByRole: vi.fn(() => locator),
    getByText: vi.fn(() => locator),
    getByLabel: vi.fn(() => locator),
    getByPlaceholder: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    getByAltText: vi.fn(() => locator),
    getByTitle: vi.fn(() => locator),
    locator: vi.fn(() => locator),
  };
  return { page, locator };
}

// ---------------------------------------------------------------------------
// resolveLocator
// ---------------------------------------------------------------------------

describe('resolveLocator', () => {
  it('routes role to getByRole with name and exact', () => {
    const { page } = makePage();
    resolveLocator(page as never, { strategy: 'role', role: 'button', name: 'Save', exact: true });
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Save', exact: true });
  });

  it('routes text to getByText', () => {
    const { page } = makePage();
    resolveLocator(page as never, { strategy: 'text', value: 'Hello' });
    expect(page.getByText).toHaveBeenCalledWith('Hello', { exact: undefined });
  });

  it('routes label to getByLabel', () => {
    const { page } = makePage();
    resolveLocator(page as never, { strategy: 'label', value: 'Email', exact: false });
    expect(page.getByLabel).toHaveBeenCalledWith('Email', { exact: false });
  });

  it('routes placeholder to getByPlaceholder', () => {
    const { page } = makePage();
    resolveLocator(page as never, { strategy: 'placeholder', value: 'name@x.com' });
    expect(page.getByPlaceholder).toHaveBeenCalledWith('name@x.com');
  });

  it('routes testid to getByTestId', () => {
    const { page } = makePage();
    resolveLocator(page as never, { strategy: 'testid', value: 'submit' });
    expect(page.getByTestId).toHaveBeenCalledWith('submit');
  });

  it('routes css to locator()', () => {
    const { page } = makePage();
    resolveLocator(page as never, { strategy: 'css', selector: 'button.primary' });
    expect(page.locator).toHaveBeenCalledWith('button.primary');
  });

  it('routes altText to getByAltText', () => {
    const { page } = makePage();
    resolveLocator(page as never, { strategy: 'altText', value: 'Logo' });
    expect(page.getByAltText).toHaveBeenCalledWith('Logo');
  });
});

// ---------------------------------------------------------------------------
// executePlaywrightAction — each kind
// ---------------------------------------------------------------------------

describe('executePlaywrightAction', () => {
  let page: ReturnType<typeof makePage>['page'];
  let locator: ReturnType<typeof makeLocator>;

  beforeEach(() => {
    const made = makePage();
    page = made.page;
    locator = made.locator;
  });

  it('navigate calls page.goto with domcontentloaded', async () => {
    await executePlaywrightAction(page as never, { kind: 'navigate', url: 'https://x.com' });
    expect(page.goto).toHaveBeenCalledWith('https://x.com', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
  });

  it('click calls Locator.click', async () => {
    const action: PlaywrightAction = { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'OK' } };
    await executePlaywrightAction(page as never, action);
    expect(locator.click).toHaveBeenCalledTimes(1);
  });

  it('dblclick calls Locator.dblclick', async () => {
    const action: PlaywrightAction = { kind: 'dblclick', locator: { strategy: 'css', selector: 'div' } };
    await executePlaywrightAction(page as never, action);
    expect(locator.dblclick).toHaveBeenCalledTimes(1);
  });

  it('fill focuses the field, clears it, and types per-keystroke', async () => {
    const action: PlaywrightAction = {
      kind: 'fill',
      locator: { strategy: 'placeholder', value: 'email' },
      value: 'a@b.c',
    };
    await executePlaywrightAction(page as never, action);
    // We click to focus (locator-level click, not the global page click).
    expect(locator.click).toHaveBeenCalledTimes(1);
    // We clear with fill('').
    expect(locator.fill).toHaveBeenCalledWith('', expect.any(Object));
    // The actual value is typed per-keystroke so input handlers see real
    // keyup/keydown events instead of one-shot fill.
    expect(locator.pressSequentially).toHaveBeenCalledWith('a@b.c', expect.objectContaining({ delay: expect.any(Number) }));
  });

  it('press without locator calls page.keyboard.press', async () => {
    await executePlaywrightAction(page as never, { kind: 'press', key: 'Enter' });
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
  });

  it('press with locator calls Locator.press', async () => {
    const action: PlaywrightAction = {
      kind: 'press',
      key: 'Enter',
      locator: { strategy: 'role', role: 'textbox' },
    };
    await executePlaywrightAction(page as never, action);
    expect(locator.press).toHaveBeenCalledWith('Enter', expect.any(Object));
  });

  it('select calls Locator.selectOption', async () => {
    const action: PlaywrightAction = {
      kind: 'select',
      locator: { strategy: 'label', value: 'Country' },
      value: 'PT',
    };
    await executePlaywrightAction(page as never, action);
    expect(locator.selectOption).toHaveBeenCalledWith('PT', expect.any(Object));
  });

  it('check / uncheck call the corresponding Locator methods', async () => {
    const checkAction: PlaywrightAction = { kind: 'check', locator: { strategy: 'role', role: 'checkbox' } };
    const uncheckAction: PlaywrightAction = { kind: 'uncheck', locator: { strategy: 'role', role: 'checkbox' } };
    await executePlaywrightAction(page as never, checkAction);
    await executePlaywrightAction(page as never, uncheckAction);
    expect(locator.check).toHaveBeenCalledTimes(1);
    expect(locator.uncheck).toHaveBeenCalledTimes(1);
  });

  it('hover calls Locator.hover', async () => {
    const action: PlaywrightAction = { kind: 'hover', locator: { strategy: 'role', role: 'menuitem' } };
    await executePlaywrightAction(page as never, action);
    expect(locator.hover).toHaveBeenCalledTimes(1);
  });

  it('wait calls page.waitForTimeout', async () => {
    await executePlaywrightAction(page as never, { kind: 'wait', durationMs: 750 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(750);
  });

  it('wait_for calls Locator.waitFor with the given state', async () => {
    const action: PlaywrightAction = {
      kind: 'wait_for',
      locator: { strategy: 'testid', value: 'spinner' },
      state: 'hidden',
    };
    await executePlaywrightAction(page as never, action);
    expect(locator.waitFor).toHaveBeenCalledWith({ state: 'hidden', timeout: expect.any(Number) });
  });

  it('scroll without locator uses page.mouse.wheel', async () => {
    await executePlaywrightAction(page as never, { kind: 'scroll', direction: 'down', pixels: 400 });
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, 400);
  });

  it('scroll up uses negative wheel delta', async () => {
    await executePlaywrightAction(page as never, { kind: 'scroll', direction: 'up', pixels: 200 });
    expect(page.mouse.wheel).toHaveBeenCalledWith(0, -200);
  });

  it('scroll with locator calls scrollIntoViewIfNeeded', async () => {
    const action: PlaywrightAction = {
      kind: 'scroll',
      direction: 'down',
      locator: { strategy: 'css', selector: 'footer' },
    };
    await executePlaywrightAction(page as never, action);
    expect(locator.scrollIntoViewIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('screenshot kind is a no-op (engine takes screenshots itself)', async () => {
    await executePlaywrightAction(page as never, { kind: 'screenshot' });
    // No expectations beyond not throwing.
  });

  it('locator ladder: tries fallback strategies when the primary times out', async () => {
    // Build a page where:
    //   - getByRole returns a locator whose waitFor rejects (primary missing)
    //   - getByLabel returns a locator whose waitFor resolves (fallback hits)
    // The executor should end up calling click() on the fallback's locator.
    const primary = makeLocator();
    primary.waitFor = vi.fn().mockRejectedValue(new Error('timeout'));
    primary.click = vi.fn().mockResolvedValue(undefined);

    const fallback = makeLocator();
    fallback.waitFor = vi.fn().mockResolvedValue(undefined);
    fallback.click = vi.fn().mockResolvedValue(undefined);

    const fallbackPlaceholder = makeLocator();
    fallbackPlaceholder.waitFor = vi.fn().mockRejectedValue(new Error('timeout'));

    const fallbackText = makeLocator();
    fallbackText.waitFor = vi.fn().mockRejectedValue(new Error('timeout'));

    const fakePage = {
      goto: vi.fn(),
      keyboard: { press: vi.fn() },
      mouse: { wheel: vi.fn() },
      title: vi.fn(),
      url: vi.fn(),
      waitForTimeout: vi.fn(),
      // role -> primary (fails); label -> fallback (succeeds); placeholder/text -> miss
      getByRole: vi.fn(() => primary),
      getByLabel: vi.fn(() => fallback),
      getByPlaceholder: vi.fn(() => fallbackPlaceholder),
      getByText: vi.fn(() => fallbackText),
      getByTestId: vi.fn(() => makeLocator()),
      getByAltText: vi.fn(() => makeLocator()),
      getByTitle: vi.fn(() => makeLocator()),
      locator: vi.fn(() => makeLocator()),
    };

    await executePlaywrightAction(fakePage as never, {
      kind: 'click',
      locator: { strategy: 'role', role: 'button', name: 'Submit' },
    });

    expect(primary.click).not.toHaveBeenCalled();
    expect(fallback.click).toHaveBeenCalledTimes(1);
  });

  it('locator ladder: falls back on the primary when no candidate matches', async () => {
    // Every locator's waitFor rejects. Executor returns the primary so the
    // .click() error message is the original locator's, then click runs
    // (we still try the action; in real Playwright it'd throw, here we
    // just check that we ended up calling click on the primary).
    const primary = makeLocator();
    primary.waitFor = vi.fn().mockRejectedValue(new Error('timeout'));

    const miss = makeLocator();
    miss.waitFor = vi.fn().mockRejectedValue(new Error('timeout'));

    const fakePage = {
      goto: vi.fn(), keyboard: { press: vi.fn() }, mouse: { wheel: vi.fn() },
      title: vi.fn(), url: vi.fn(), waitForTimeout: vi.fn(),
      getByRole: vi.fn(() => primary),
      getByLabel: vi.fn(() => miss),
      getByPlaceholder: vi.fn(() => miss),
      getByText: vi.fn(() => miss),
      getByTestId: vi.fn(() => miss),
      getByAltText: vi.fn(() => miss),
      getByTitle: vi.fn(() => miss),
      locator: vi.fn(() => miss),
    };

    await executePlaywrightAction(fakePage as never, {
      kind: 'click',
      locator: { strategy: 'role', role: 'button', name: 'Save' },
    });

    expect(primary.click).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// executePlaywrightAssertion
// ---------------------------------------------------------------------------

describe('executePlaywrightAssertion', () => {
  it('expect_visible passes when locator is visible', async () => {
    const { page, locator } = makePage();
    locator.isVisible.mockResolvedValue(true);
    const a: PlaywrightAssertion = { kind: 'expect_visible', locator: { strategy: 'role', role: 'heading' } };
    await expect(executePlaywrightAssertion(page as never, a)).resolves.toBe(true);
  });

  it('expect_visible throws when locator is not visible', async () => {
    const { page, locator } = makePage();
    locator.isVisible.mockResolvedValue(false);
    const a: PlaywrightAssertion = { kind: 'expect_visible', locator: { strategy: 'role', role: 'heading' } };
    await expect(executePlaywrightAssertion(page as never, a)).rejects.toThrow(/visible/);
  });

  it('expect_text passes when innerText contains the substring', async () => {
    const { page, locator } = makePage();
    locator.innerText.mockResolvedValue('Welcome back, friend');
    const a: PlaywrightAssertion = {
      kind: 'expect_text',
      locator: { strategy: 'role', role: 'heading' },
      contains: 'Welcome',
    };
    await expect(executePlaywrightAssertion(page as never, a)).resolves.toBe(true);
  });

  it('expect_text throws when text does not contain substring', async () => {
    const { page, locator } = makePage();
    locator.innerText.mockResolvedValue('Goodbye');
    const a: PlaywrightAssertion = {
      kind: 'expect_text',
      locator: { strategy: 'role', role: 'heading' },
      contains: 'Welcome',
    };
    await expect(executePlaywrightAssertion(page as never, a)).rejects.toThrow(/Welcome/);
  });

  it('expect_url checks page.url() for substring', async () => {
    const { page } = makePage();
    page.url.mockReturnValue('https://example.com/inbox');
    const a: PlaywrightAssertion = { kind: 'expect_url', pattern: '/inbox' };
    await expect(executePlaywrightAssertion(page as never, a)).resolves.toBe(true);
  });

  it('expect_url throws when URL substring is missing', async () => {
    const { page } = makePage();
    page.url.mockReturnValue('https://example.com/login');
    const a: PlaywrightAssertion = { kind: 'expect_url', pattern: '/inbox' };
    await expect(executePlaywrightAssertion(page as never, a)).rejects.toThrow(/inbox/);
  });

  it('expect_title checks page.title() for substring', async () => {
    const { page } = makePage();
    page.title.mockResolvedValue('Inbox - Acme');
    const a: PlaywrightAssertion = { kind: 'expect_title', contains: 'Inbox' };
    await expect(executePlaywrightAssertion(page as never, a)).resolves.toBe(true);
  });

  it('expect_hidden passes when locator is not visible', async () => {
    const { page, locator } = makePage();
    locator.isVisible.mockResolvedValue(false);
    const a: PlaywrightAssertion = { kind: 'expect_hidden', locator: { strategy: 'css', selector: '.spinner' } };
    await expect(executePlaywrightAssertion(page as never, a)).resolves.toBe(true);
  });
});
