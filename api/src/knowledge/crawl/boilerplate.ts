/**
 * Boilerplate stripper for crawled HTML (WS8c, ported from ekoa-dev's
 * `cortex/src/services/knowledge-boilerplate.ts`) - removes cookie-consent banners and skip-links
 * before text extraction.
 *
 * `extractContent` already strips structural chrome tags (nav/header/footer/aside/form/script/
 * style). Cookie banners, though, are usually plain `<div id/class*="cookie|consent|gdpr|
 * privacy(Modal)">`, which survive tag-based removal and otherwise prefix EVERY page of a site
 * with "...utiliza cookies..." (e.g. the ACT SharePoint portal). That boilerplate pollutes the
 * legal text, the cited snippet, and adds noise to search.
 *
 * Conservative by design: matches only clearly-chrome id/class keywords (cookie / consent / gdpr
 * / privacy-bar|modal|banner / skip-link) via a regex on the element's id+class - never on text
 * content (a page that merely mentions the word "cookie" in its body is untouched).
 */
import type { CheerioAPI } from 'cheerio';

/**
 * id/class keywords that mark a cookie/consent BANNER WIDGET or a skip-link. Deliberately
 * requires a COMPOUND widget name (cookie-bar, cookieconsent, consent-popup, privacy-modal, ...)
 * - NOT a bare token like "cookie"/"cookies"/"consent" - so a legitimate CONTENT wrapper such as
 * `<section class="cookies">` or a cookie-policy article is never removed.
 */
const BOILERPLATE_RE =
  /cookie-?(bar|banner|notice|consent|popup|modal|warning|law|message|wrap)|cookieconsent|consent-?(bar|banner|popup|modal|manager|notice)|gdpr-?(bar|banner|popup|consent|notice)|privacy-?(bar|modal|banner|popup)|skip-?(to-?content|link|nav)/i;

/** Remove cookie-consent / skip-link widgets in place. Collect-then-remove so removing a parent
 *  can't disturb iteration. Never throws - extraction must survive a stripping bug. */
export function stripBoilerplate($: CheerioAPI): void {
  try {
    const toRemove: Parameters<typeof $>[0][] = [];
    $('div, section, aside, dialog, ul, span, a, button').each((_i, el) => {
      const attribs = (el as { attribs?: Record<string, string> }).attribs;
      if (!attribs) return;
      const idcls = `${attribs.id ?? ''} ${attribs.class ?? ''} ${attribs['aria-label'] ?? ''}`;
      if (idcls.trim() && BOILERPLATE_RE.test(idcls)) toRemove.push(el);
    });
    for (const el of toRemove) $(el).remove();
  } catch {
    /* extraction must never fail because of boilerplate stripping */
  }
}
