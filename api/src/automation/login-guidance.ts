/**
 * automation/login-guidance.ts - the one thing a person needs to be told at a login pause that the
 * page in front of them will not tell them.
 *
 * WHY THIS EXISTS. Google refuses OAuth sign-in from the browser this product drives. Measured in
 * acceptance run 1 (findings, `google-sso-refuses-the-automated-ceremony-browser`): the headed
 * Chrome the bridge launches - real `channel:'chrome'`, the AutomationControlled blink feature
 * disabled, `navigator.webdriver` deleted - still lands on "Couldn't sign you in / This browser or
 * app may not be secure" at `accounts.google.com/v3/signin/rejected`. The hardening defeats
 * client-side `navigator.webdriver` checks and not Google's server-side detection, which is an
 * industry-wide block on automated browsers and not a defect here.
 *
 * SO THE PRODUCT CANNOT FIX IT, AND STOPS LETTING PEOPLE WALK INTO IT. A pause is the one moment
 * the human is at the keyboard and can still choose HOW to sign in, and on most targets "Continue
 * with Google" sits next to an email/phone form that works perfectly. Without a word from us the
 * obvious button is the one that cannot work, and the run dies on a route the user had a free
 * alternative to. One sentence at the pause turns that into a non-event.
 *
 * WHY IT IS APPENDED HERE RATHER THAN ASKED OF THE MODEL. The rest of a pause Post-it is written by
 * the vision model from the screenshot, and a line in that prompt would make this guidance LIKELY -
 * present when the model felt it was relevant, absent on the run where it mattered, and untestable
 * either way. Appended by the engine it is CERTAIN, and it is a deterministic string a test can
 * pin. The model keeps the part it is good at: what the page is asking for.
 *
 * ONE SENTENCE PER LANGUAGE, ONE MEANING. The web surfaces render from `web/locales` and pick the
 * user's language there; the strings below are for the two producers that emit finished prose -
 * the model-written pause Post-it, which is pt-PT by instruction, and the English fast-path pause
 * copy in `rehearsal.ts`. Keeping both here is what stops the two from drifting into saying
 * different things.
 */

/** pt-PT. Appended to a login pause whose copy is Portuguese (the vision-written Post-it). */
export const GOOGLE_SSO_PAUSE_GUIDANCE_PT =
  'Se o site oferecer início de sessão com a Google, use o email ou o telemóvel - a Google bloqueia navegadores automatizados.';

/** English. Carried by the English fast-path login copy in `rehearsal.ts`. */
export const GOOGLE_SSO_PAUSE_GUIDANCE_EN =
  'If the site offers Google sign-in, use email or phone instead - Google blocks automated browsers.';

/**
 * Add the guidance to a login pause's instructions, and to nothing else.
 *
 * GATED ON THE KIND, deliberately. A CAPTCHA, a 3-D Secure screen or an OTP box has no Google
 * sign-in choice to make, and pasting the sentence onto every pause would train people to skip
 * reading the Post-it - which costs more than the sentence buys on the one pause where it counts.
 *
 * IDEMPOTENT, because the model is told to write about the page and sometimes says this itself, and
 * because a resumed run re-enters the same pause path. Matching on the distinctive tail rather than
 * the whole sentence keeps the check working if the phrasing around it is ever edited.
 */
export function withGoogleSsoGuidance(userInstructions: string, kind: string | null | undefined): string {
  if (kind !== 'login') return userInstructions;
  // BOTH LANGUAGES, because both producers can now reach this function. The English fast-path copy
  // carries the sentence inline (`rehearsal.ts`), and once that path started reporting a `login`
  // KIND it started reaching this append too - which without the second check would staple the
  // Portuguese sentence onto the English one, saying the same thing twice, in two languages, on the
  // one pause where the wording is the whole point.
  if (
    userInstructions.includes('bloqueia navegadores automatizados') ||
    userInstructions.includes(GOOGLE_SSO_PAUSE_GUIDANCE_EN)
  ) {
    return userInstructions;
  }
  const trimmed = userInstructions.trimEnd();
  return trimmed.length === 0 ? GOOGLE_SSO_PAUSE_GUIDANCE_PT : `${trimmed}\n\n${GOOGLE_SSO_PAUSE_GUIDANCE_PT}`;
}
