/**
 * automation/screenshot-masking.ts — mask credential-bearing fields BEFORE the pixels exist
 * (Cofre H-2; invariants I1, I2).
 *
 * THE GAP THIS CLOSES. `llm/client.ts` anonymises `prompt` and `systemPrompt` at the egress
 * chokepoint and then forwards `images: opts.images` VERBATIM — and a test pinned that forwarding
 * as the contract. So the anonymisation pipeline covered the text plane and not the pixel plane,
 * while `docs/security.md` described it as covering "all model-bound text", which is true and
 * false-by-omission at the same time. For this product the pixels are screenshots of an
 * authenticated session on a court portal: processo numbers, client NIFs, and — during a login
 * step — the credential itself.
 *
 * WHY BROWSER-SIDE. A Cortex-side transform would have to find the sensitive regions in a finished
 * PNG, which is OCR-and-hope. Playwright can mask by LOCATOR at capture time, so the sensitive
 * pixels are never rendered into the buffer at all. That also means the mask list is a property of
 * the page, which is why it belongs here and not in `llm/`: the chokepoint cannot know which parts
 * of an image are a password field.
 *
 * WHAT IS MASKED. Every input that is structurally credential-bearing (`type=password`), plus the
 * conventional one-time-code and credential field names. This is deliberately a NAME/TYPE-based
 * list rather than a value-based one: at capture time we are not trying to hide a value we know —
 * we are hiding a REGION that structurally holds one.
 */
import type { Page, Locator } from 'playwright';

/**
 * Selectors for regions that must never reach a model as pixels.
 *
 * `input[type=password]` is the structural case and the most important one. The rest are the
 * conventional names for one-time codes and credential fields, in EN and PT-PT, because the portals
 * this product drives are Portuguese.
 */
export const CREDENTIAL_FIELD_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="one-time-code"]',
  'input[name*="password" i]',
  'input[name*="passwd" i]',
  'input[name*="senha" i]',
  'input[name*="palavra-passe" i]',
  'input[name*="otp" i]',
  'input[name*="mfa" i]',
  'input[name*="totp" i]',
  'input[name*="token" i]',
  'input[name*="secret" i]',
  'input[name*="pin" i]',
  'input[id*="password" i]',
  'input[id*="senha" i]',
  'input[id*="otp" i]',
  '[data-ekoa-mask]',
] as const;

/** Build the mask locator list for a page. Never throws: a masking failure must degrade to a
 *  SUPPRESSED capture at the call site, never to an unmasked one. */
export function credentialMaskLocators(page: Page): Locator[] {
  return CREDENTIAL_FIELD_SELECTORS.map((sel) => page.locator(sel));
}

/**
 * A solid colour, not a blur. A blurred credential is still a credential to anyone with the
 * original font metrics, and the point of the mask is that the information is absent from the
 * buffer rather than obscured in it.
 */
export const MASK_COLOR = '#000000';

export interface MaskedScreenshotOptions {
  /**
   * Suppress the capture entirely. Used for the typist's login window (H-3): during a credential
   * fill there is no screenshot worth the risk, and "mask the field" is a weaker guarantee than
   * "take no picture".
   */
  suppressed?: boolean;
}

/**
 * Take a PNG with credential regions masked, or nothing at all when suppressed.
 *
 * Returns `null` for both "suppressed" and "failed", and the caller treats null as "no screenshot
 * this step" — which is exactly how `capture()` already handles a failed shot, so a masking failure
 * can never silently downgrade to an UNMASKED capture.
 */
export async function maskedScreenshot(page: Page, opts: MaskedScreenshotOptions = {}): Promise<Buffer | null> {
  if (opts.suppressed) return null;
  try {
    return await page.screenshot({
      type: 'png',
      mask: credentialMaskLocators(page),
      maskColor: MASK_COLOR,
    });
  } catch {
    return null;
  }
}
