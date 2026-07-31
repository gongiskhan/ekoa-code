/**
 * automation/typist.ts — THE trusted login primitive (Cofre WS-F / F-2).
 *
 * The agent's ONLY credential-touching browser capability is `login(credential_ref)`. It is an
 * atomic macro executed by deterministic Cortex code; the model chooses WHICH reference and WHEN,
 * never HOW (invariant I5).
 *
 * THE SEQUENCE, and why each step is where it is:
 *   1. Verify the current page origin against the item's `boundOrigins` (I6) — BEFORE unwrapping,
 *      so a wrong-origin page never causes a decrypt.
 *   2. Open a credential window: suppress the screencast and the automation screenshot capture.
 *      `Page.startScreencast` has NO mask option, so suppression (not masking) is the only correct
 *      control on the media channel. The typist REFUSES to fill if it cannot confirm suppression.
 *   3. Unwrap through the Cofre seam, so the grant, the tenancy and the lock all apply.
 *   4. Fill via CDP `Input.dispatchKeyEvent` — out-of-band input events, so the value never appears
 *      in a script, a tool call, a page snapshot, or any agent-visible stream (I1).
 *   5. Submit and wait for navigation IN THE SAME UNIT. Fill-and-submit being atomic is what makes
 *      read-back impossible by construction: control never returns to the agent while a filled
 *      password field is on the page.
 *   6. Return only when no password field remains in the DOM.
 *
 * UNKNOWN PATTERNS FAIL TO RELAY OR ATTENDED MODE, never to LLM improvisation. A login form the
 * generic pattern cannot drive is a `TypistUnknownPattern`, which the caller turns into a paused
 * run — it is never handed to the fixer to guess at.
 */
import type { Page } from 'playwright';
import type { Actor } from '@ekoa/shared';
import { unwrap, recordUse, type UnwrappedCredential } from '../cofre/index.js';
import { SecretRegistry } from '../security/redaction.js';
import { recipeForHost } from './login-recipes.js';
import { dispatchKeyEvent, newCdpSession } from '../streaming/cdp.js';

/** A login form the generic pattern could not drive. Fails to relay/attended, never to the model. */
export class TypistUnknownPattern extends Error {
  readonly code = 'TYPIST_UNKNOWN_PATTERN';
  constructor(message: string) {
    super(message);
    this.name = 'TypistUnknownPattern';
  }
}

/** The typist refused because it could not guarantee the credential would not be observed. */
export class TypistNotSuppressed extends Error {
  readonly code = 'TYPIST_NOT_SUPPRESSED';
  constructor(message: string) {
    super(message);
    this.name = 'TypistNotSuppressed';
  }
}

/** Selectors the generic pattern understands. Fixed DATA, never model-authored. */
const USERNAME_SELECTORS = [
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[name*="email" i]',
  'input[name*="utilizador" i]',
  'input[id*="user" i]',
  'input[id*="email" i]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete="current-password"]',
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name*="login" i]',
  'button[id*="login" i]',
  'button[id*="entrar" i]',
];

export interface TypistDeps {
  /** Open a credential window on any attached viewer. Returns a resume disposer. */
  beginCredentialWindow: (traceId: string) => Promise<() => Promise<void>>;
  /** True when no attached viewer is receiving frames. The typist refuses to fill if this is false. */
  isSuppressed: (traceId: string) => boolean;
  /** Suppress the automation's own screenshot capture for the window. */
  withCaptureSuppressed: <T>(fn: () => Promise<T>) => Promise<T>;
  now?: () => number;
}

export interface TypistLoginInput {
  page: Page;
  actor: Actor;
  traceId: string;
  runId: string;
  /** `cofre:<itemId>` — a REFERENCE. The typist never accepts a value. */
  credentialRef: string;
  /** Optional username to fill alongside the password (also a reference, or a plain non-secret). */
  username?: string;
  /** Per-site recipe override; fixed data from api/assets, never model-authored. */
  recipe?: TypistRecipe;
}

/** A per-site recipe. Selectors only — nothing here may carry executable content. */
export interface TypistRecipe {
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  /** Multi-step forms: click this to reveal the password field after the username. */
  nextSelector?: string;
}

export interface TypistResult {
  /** The registry holding the filled value, so the caller can filter the run's streams. */
  secrets: SecretRegistry;
  itemId: string;
  /** How the submit was performed — useful in the Registo without disclosing anything. */
  submittedVia: 'button' | 'enter';
}

/** eTLD+1-ish host match, same rule as security/origin-binding.ts. */
function hostMatches(host: string, allowed: string): boolean {
  const h = host.toLowerCase();
  const a = allowed.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}

async function firstVisible(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const visible = await loc.isVisible({ timeout: 1_000 }).catch(() => false);
    if (visible) return sel;
  }
  return null;
}

/**
 * Type a value into the focused element using out-of-band CDP key events.
 *
 * NOT `locator.fill()`: fill sets the DOM value directly, which is observable to any page script
 * and to anything reading the DOM afterwards. Dispatching raw key events reproduces real typing at
 * the input layer, so the value exists only in the browser's input pipeline.
 */
async function typeOutOfBand(page: Page, selector: string, value: string): Promise<void> {
  const cdp = await newCdpSession(page);
  try {
    await page.locator(selector).first().focus();
    for (const ch of value) {
      await dispatchKeyEvent(cdp, { type: 'keyDown', key: ch, code: '', text: ch });
      await dispatchKeyEvent(cdp, { type: 'keyUp', key: ch, code: '' });
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * `login(credential_ref)` — the whole primitive.
 *
 * Throws rather than returning a failure union: every failure here is terminal for the step, and a
 * union invites a caller to continue past one.
 */
export async function typistLogin(input: TypistLoginInput, deps: TypistDeps): Promise<TypistResult> {
  const { page, actor, credentialRef, traceId, runId } = input;
  const itemId = credentialRef.startsWith('cofre:') ? credentialRef.slice('cofre:'.length) : '';
  if (!itemId) throw new TypistUnknownPattern('login requires an opaque cofre: reference');

  // 1. ORIGIN FIRST — before any unwrap. A wrong-origin page must not cause a decrypt.
  const origin = new URL(page.url()).hostname;

  // F-3: a per-site recipe is FIXED DATA from api/assets/login-recipes/, looked up by host. An
  // explicitly-passed recipe still wins (tests and the caller may pin one), but nothing here is
  // model-authored: the registry validates every entry as a plain CSS selector on load, and a
  // recipe can only point the FIXED sequence below at different elements — never change what it
  // does. That is the I5 line: the typist is the one primitive that handles a decrypted credential
  // against a live page, so anything steering it sits inside the credential's trust boundary.
  const recipe = input.recipe ?? recipeForHost(origin);

  // 2. Suppress every observation channel for the fill window, and REFUSE if we cannot.
  const resume = await deps.beginCredentialWindow(traceId);
  try {
    if (!deps.isSuppressed(traceId)) {
      throw new TypistNotSuppressed(
        'refusing to fill: a viewer is attached and the screencast is not suppressed',
      );
    }

    return await deps.withCaptureSuppressed(async () => {
      // 3. Unwrap through the Cofre seam. `usageContext.origin` is the LIVE page origin, so the
      //    item's own boundOrigins decide — the typist does not re-implement the check.
      // An origin refusal or a locked item throws from here; both are surfaced UNCHANGED, because
      // the caller distinguishes them (CredentialOriginError -> a bound-origin problem the user can
      // fix; CofreLockedError -> route to the unlock page).
      const credential: UnwrappedCredential = await unwrap(
        itemId,
        actor,
        { kind: 'browser', origin },
        { runId },
      );

      const secrets = new SecretRegistry();
      secrets.register(credential.value);

      // 4. Locate the form. An unknown shape fails to relay, never to improvisation.
      const passwordSel =
        recipe?.passwordSelector ?? (await firstVisible(page, PASSWORD_SELECTORS));
      if (!passwordSel) {
        // Multi-step (email -> next -> password): try the generic reveal once.
        const nextSel = recipe?.nextSelector ?? null;
        if (nextSel) {
          await page.locator(nextSel).first().click({ timeout: 5_000 }).catch(() => {});
        }
      }
      const resolvedPasswordSel =
        recipe?.passwordSelector ?? (await firstVisible(page, PASSWORD_SELECTORS));
      if (!resolvedPasswordSel) {
        throw new TypistUnknownPattern('no password field found — pausing for the relay');
      }

      if (input.username) {
        const userSel = recipe?.usernameSelector ?? (await firstVisible(page, USERNAME_SELECTORS));
        if (userSel) await typeOutOfBand(page, userSel, input.username);
      }

      // 5. FILL AND SUBMIT AS ONE UNIT. Control never returns to the agent with a filled password
      //    field on the page, which is what makes read-back impossible by construction.
      await typeOutOfBand(page, resolvedPasswordSel, credential.value);

      const submitSel = recipe?.submitSelector ?? (await firstVisible(page, SUBMIT_SELECTORS));
      let submittedVia: 'button' | 'enter';
      const navigation = page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      if (submitSel) {
        submittedVia = 'button';
        await page.locator(submitSel).first().click({ timeout: 10_000 });
      } else {
        submittedVia = 'enter';
        await page.locator(resolvedPasswordSel).first().press('Enter');
      }
      await navigation;

      // 6. Return only when no password field remains.
      const stillThere = await firstVisible(page, PASSWORD_SELECTORS);
      if (stillThere) {
        throw new TypistUnknownPattern('a password field is still present after submit — pausing for the relay');
      }

      await recordUse(actor, itemId, `typist:${origin}`, deps.now?.() ?? Date.now());
      return { secrets, itemId, submittedVia };
    });
  } finally {
    await resume();
  }
}

/** Exported for the security suite: the generic pattern's selector vocabulary is fixed DATA. */
export const TYPIST_SELECTORS = {
  username: USERNAME_SELECTORS,
  password: PASSWORD_SELECTORS,
  submit: SUBMIT_SELECTORS,
} as const;

export { hostMatches as __hostMatchesForTests };
