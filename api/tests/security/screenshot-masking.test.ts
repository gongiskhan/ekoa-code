import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  maskedScreenshot,
  credentialMaskLocators,
  CREDENTIAL_FIELD_SELECTORS,
  MASK_COLOR,
} from '../../src/automation/screenshot-masking.js';

/**
 * SECURITY SUITE — the pixel plane (Cofre H-2/H-3; invariants I1, I2).
 *
 * `llm/client.ts` anonymises `prompt` and `systemPrompt` and forwards `images` VERBATIM, and a test
 * pinned that forwarding as the contract. The anonymisation pipeline therefore covered the text
 * plane and not the pixel plane, while `docs/security.md` described it as covering "all model-bound
 * text" — true, and false-by-omission at the same time. For this product the pixels are screenshots
 * of an authenticated session on a court portal.
 *
 * The fix is browser-side: mask by LOCATOR at capture time so the sensitive pixels are never
 * rendered into the buffer. These cases pin the mask list and, most importantly, the FAILURE MODE.
 */

/** The subset of Playwright's screenshot options these cases assert on. Declaring it on the mock
 *  (rather than casting `mock.calls[0][0]` afterwards) is what makes the recorded argument typed:
 *  a zero-arg `vi.fn` records a `[]` tuple, so indexing it is an error and the cast was a lie. */
type ScreenshotOpts = { mask?: unknown[]; maskColor?: string; type?: string };

const screenshotMock = () => vi.fn(async (_opts?: ScreenshotOpts) => Buffer.from('PNG'));

function fakePage(overrides: Partial<Page> = {}): Page {
  return {
    locator: (sel: string) => ({ __sel: sel }) as never,
    screenshot: vi.fn(async () => Buffer.from('PNG')),
    ...overrides,
  } as unknown as Page;
}

describe('maskedScreenshot', () => {
  it('passes a mask list and a solid mask colour to Playwright', async () => {
    const screenshot = screenshotMock();
    const page = fakePage({ screenshot: screenshot as never });
    const out = await maskedScreenshot(page);
    expect(out?.toString()).toBe('PNG');
    const opts = screenshot.mock.calls[0]![0]!;
    expect(opts.type).toBe('png');
    expect(Array.isArray(opts.mask)).toBe(true);
    expect((opts.mask as unknown[]).length).toBe(CREDENTIAL_FIELD_SELECTORS.length);
    // A solid colour, not a blur: a blurred credential is still a credential to anyone with the
    // original font metrics.
    expect(opts.maskColor).toBe(MASK_COLOR);
    expect(MASK_COLOR).toBe('#000000');
  });

  it('takes NO screenshot at all when suppressed (H-3 credential window)', async () => {
    const screenshot = vi.fn(async () => Buffer.from('PNG'));
    const page = fakePage({ screenshot: screenshot as never });
    expect(await maskedScreenshot(page, { suppressed: true })).toBeNull();
    // "Take no picture" is a stronger guarantee than "mask the field".
    expect(screenshot).not.toHaveBeenCalled();
  });

  it('a masking failure degrades to NO screenshot, never to an unmasked one', async () => {
    const page = fakePage({
      screenshot: vi.fn(async () => {
        throw new Error('mask locator resolution failed');
      }) as never,
    });
    // The decisive property: null, not a fallback unmasked capture.
    expect(await maskedScreenshot(page)).toBeNull();
  });
});

describe('the mask list covers what structurally holds a credential', () => {
  it('includes the structural case first', () => {
    expect(CREDENTIAL_FIELD_SELECTORS[0]).toBe('input[type="password"]');
  });

  it.each([
    'input[type="password"]',
    'input[autocomplete="one-time-code"]',
    'input[autocomplete="current-password"]',
    '[data-ekoa-mask]',
  ])('includes %s', (sel) => {
    expect(CREDENTIAL_FIELD_SELECTORS).toContain(sel);
  });

  it('covers PT-PT field names, because the portals this drives are Portuguese', () => {
    const joined = CREDENTIAL_FIELD_SELECTORS.join(' ');
    expect(joined).toContain('senha');
    expect(joined).toContain('palavra-passe');
  });

  it('covers the one-time-code family', () => {
    const joined = CREDENTIAL_FIELD_SELECTORS.join(' ');
    for (const name of ['otp', 'mfa', 'totp']) expect(joined).toContain(name);
  });

  it('builds one locator per selector', () => {
    const page = fakePage();
    expect(credentialMaskLocators(page)).toHaveLength(CREDENTIAL_FIELD_SELECTORS.length);
  });

  it('offers an explicit opt-in hook for a page we do not have a name rule for', () => {
    // A recipe can mark any element [data-ekoa-mask] rather than needing a new selector shipped.
    expect(CREDENTIAL_FIELD_SELECTORS).toContain('[data-ekoa-mask]');
  });
});
