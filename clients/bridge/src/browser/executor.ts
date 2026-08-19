/**
 * browser/executor.ts - the daemon-side runner for ONE `LocalBrowserAction`, plus the post-action
 * observation Cortex ingests.
 *
 * PROVENANCE, STATED BECAUSE IT MATTERS. The action semantics are a port-with-review of Cortex's
 * own page runner (`api/src/automation/executor.ts`) and the observation is a port of its
 * fingerprint hooks (`api/src/automation/fingerprint.ts`). They are ported rather than shared
 * because the two live in different processes with different compilations - the daemon has no DOM
 * lib and must not import `api/` (lint-enforced) - and they are ported FAITHFULLY because the
 * `domShapeSketch` string is hashed into the page fingerprint that keys the hosted action cache. A
 * sketch that differs by one character is not a visible error; it is a cache that never hits again.
 *
 * ACT AND OBSERVE. Every step returns the state of the page AFTER it ran: url, title, first
 * heading, DOM-shape sketch, a trimmed accessibility outline, viewport, and a screenshot. That
 * observation is what the hosted vision resolver and the fingerprint cache feed on for the NEXT
 * step, so an action that "worked" but reported nothing is a run that stalls.
 *
 * THE FULL VOCABULARY. `dblclick`, `select`, `check`, `uncheck`, `wait_for` and `scroll` are
 * implemented here. `browser-session.ts` noted the daemon lacked them and left reconciling the sets
 * as a follow-up; a step resolved to one of those verbs used to die at the daemon's zod boundary
 * and fall through to the (expensive) vision path on every single run.
 */
import type { LocalBrowserAction, LocalBrowserLocator, LocalBrowserObservation } from '@ekoa/shared';
import type { ProfileLocator, ProfilePage } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const FALLBACK_PROBE_MS = 2_000;
const TYPE_DELAY_MS = 35;
/** Bound on the accessibility outline. It rides a frame and reaches a model prompt; unbounded page
 *  text on an authenticated page is exactly the disclosure Cofre H-1 exists to stop. */
const A11Y_CAP_CHARS = 4_000;

export class BrowserStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserStepError';
  }
}

/** Origin + pathname only. A URL's query string is where magic-link tokens and SSO codes live, and
 *  this message reaches Cortex, the run record and a model prompt. */
function safeUrlForMessage(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '<url>';
  }
}

export function resolveLocator(page: ProfilePage, locator: LocalBrowserLocator): ProfileLocator {
  switch (locator.strategy) {
    case 'role':
      return page.getByRole(locator.role, {
        ...(locator.name !== undefined ? { name: locator.name } : {}),
        ...(locator.exact !== undefined ? { exact: locator.exact } : {}),
      });
    case 'text':
      return page.getByText(locator.value, ...(locator.exact !== undefined ? [{ exact: locator.exact }] : []));
    case 'label':
      return page.getByLabel(locator.value, ...(locator.exact !== undefined ? [{ exact: locator.exact }] : []));
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
 * Resolve with the same small deterministic ladder Cortex uses, for the same reason: vision picks
 * `role + accessible name` when it can, and on some sites the identical intent is reachable through
 * several ARIA shapes. Trying a couple of cheap alternates beats escalating to the expensive fixer
 * on a routine miss. On a total miss the PRIMARY is returned, so the failure message names what was
 * actually asked for.
 */
async function resolveWithLadder(
  page: ProfilePage,
  locator: LocalBrowserLocator,
  hint: 'click' | 'fill' | 'other',
): Promise<ProfileLocator> {
  const primary = resolveLocator(page, locator).first();
  if (await isHit(primary)) return primary;
  for (const candidate of buildCandidates(page, locator, hint)) {
    const first = candidate.first();
    if (await isHit(first)) return first;
  }
  return primary;
}

async function isHit(loc: ProfileLocator): Promise<boolean> {
  try {
    await loc.waitFor({ state: 'visible', timeout: FALLBACK_PROBE_MS });
    return true;
  } catch {
    return false;
  }
}

function buildCandidates(page: ProfilePage, primary: LocalBrowserLocator, hint: 'click' | 'fill' | 'other'): ProfileLocator[] {
  const out: ProfileLocator[] = [];
  const accessibleName =
    primary.strategy === 'role' ? primary.name
    : primary.strategy === 'text' ? primary.value
    : primary.strategy === 'label' ? primary.value
    : primary.strategy === 'placeholder' ? primary.value
    : undefined;

  if (accessibleName && accessibleName.trim().length > 0) {
    if (primary.strategy !== 'label') out.push(page.getByLabel(accessibleName));
    if (primary.strategy !== 'placeholder') out.push(page.getByPlaceholder(accessibleName));
    if (primary.strategy !== 'text') out.push(page.getByText(accessibleName, { exact: false }));
  }
  if (hint === 'fill') {
    out.push(page.locator('input[type="search"], textarea[role="searchbox"]'));
    out.push(page.locator('input[type="email"]'));
    out.push(page.locator('input[autofocus], textarea[autofocus]'));
  }
  return out;
}

/**
 * Run one step. Returns the assertion verdict when the step WAS an assertion, and undefined
 * otherwise - an assertion that does not hold returns `false` rather than throwing, because the
 * hosted side wants a reported verdict it can fall back from, not an exception it has to classify.
 * A genuine failure to RUN the step (a missing element for a click, a navigation that never
 * resolved) still throws: those are different outcomes and collapsing them loses the distinction
 * the hosted vision fallback is keyed on.
 */
export async function runBrowserAction(page: ProfilePage, action: LocalBrowserAction): Promise<boolean | undefined> {
  switch (action.action) {
    case 'navigate':
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    case 'click': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.click({ timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'dblclick': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.dblclick({ timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'fill': {
      const target = await resolveWithLadder(page, action.locator, 'fill');
      // Human-shape input, matching the hosted runner: focus, clear, then type per keystroke.
      // `fill()` writes in one shot, which several high-traffic sites fingerprint as bot input.
      await target.click({ timeout: DEFAULT_TIMEOUT_MS });
      try {
        await target.fill('', { timeout: 2_000 });
      } catch {
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
      }
      await target.pressSequentially(action.value, { delay: TYPE_DELAY_MS, timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'press': {
      if (action.locator) {
        const target = await resolveWithLadder(page, action.locator, 'click');
        await target.press(action.key, { timeout: DEFAULT_TIMEOUT_MS });
      } else {
        await page.keyboard.press(action.key);
      }
      return undefined;
    }
    case 'select': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.selectOption(action.value, { timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'check': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.check({ timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'uncheck': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.uncheck({ timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'hover': {
      const target = await resolveWithLadder(page, action.locator, 'click');
      await target.hover({ timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'wait':
      await page.waitForTimeout(action.durationMs);
      return undefined;
    case 'wait_for': {
      const target = resolveLocator(page, action.locator);
      await target.waitFor({ state: action.state, timeout: DEFAULT_TIMEOUT_MS });
      return undefined;
    }
    case 'scroll': {
      if (action.locator) {
        await resolveLocator(page, action.locator).scrollIntoViewIfNeeded({ timeout: DEFAULT_TIMEOUT_MS });
      } else {
        const pixels = action.pixels ?? 600;
        await page.mouse.wheel(0, action.direction === 'up' ? -pixels : pixels);
      }
      return undefined;
    }
    case 'screenshot':
      // A pure OBSERVE at this layer: the caller captures the observation for every step anyway,
      // so `screenshot` exists to let a run ask for one without touching the page.
      return undefined;
    case 'noop':
      // The hosted resolver decided the step is already satisfied. Do not touch the browser.
      return undefined;
    case 'release':
      // A LIFECYCLE verb, not a page action: `runBrowserStep` ends the run and returns before it
      // ever asks the lease for a page. Reaching here means that interception was lost, and running
      // on would observe (and screenshot) a page belonging to a run that just ended - so it fails
      // loudly instead.
      throw new BrowserStepError('o fim de execução é tratado antes do navegador, não como um passo');
    case 'expect_visible': {
      const target = resolveLocator(page, action.locator);
      return await target.isVisible({ timeout: DEFAULT_TIMEOUT_MS }).catch(() => false);
    }
    case 'expect_hidden': {
      const target = resolveLocator(page, action.locator);
      const visible = await target.isVisible({ timeout: 2_000 }).catch(() => false);
      return !visible;
    }
    case 'expect_text': {
      const target = resolveLocator(page, action.locator);
      const text = await target.innerText({ timeout: DEFAULT_TIMEOUT_MS }).catch(() => '');
      return (text ?? '').includes(action.contains);
    }
    case 'expect_url':
      return page.url().includes(action.pattern);
    case 'expect_title': {
      const title = await page.title().catch(() => '');
      return (title ?? '').includes(action.contains);
    }
  }
}

/**
 * The structural sketch of the page - a byte-for-byte port of Cortex's `buildShapeSketchInPage`.
 * Counts by tag, by ARIA role, and landmark regions; NO text, NO attribute values. Sorted, so it is
 * stable across runs of the same page state.
 */
const SHAPE_SKETCH_SCRIPT = `(()=>{try{
const LANDMARK=new Set(['header','nav','main','aside','footer','section','article']);
const tagCounts={},roleCounts={};let landmarkCount=0;
const walker=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_ELEMENT);
let node=walker.currentNode;
while(node){const tag=node.tagName.toLowerCase();tagCounts[tag]=(tagCounts[tag]||0)+1;if(LANDMARK.has(tag))landmarkCount++;const role=node.getAttribute('role');if(role)roleCounts[role]=(roleCounts[role]||0)+1;node=walker.nextNode();}
const tagPart=Object.keys(tagCounts).sort().map(k=>k+'='+tagCounts[k]).join(',');
const rolePart=Object.keys(roleCounts).sort().map(k=>k+'='+roleCounts[k]).join(',');
return 'tags:'+tagPart+'|roles:'+rolePart+'|landmarks:'+landmarkCount;
}catch(e){return 'tags:|roles:|landmarks:0';}})()`;

/** First H1/H2 visible text, lowercased - the same cheap content discriminator Cortex hashes. */
const HEADING_SCRIPT = `(()=>{try{
for(const h of Array.from(document.querySelectorAll('h1, h2'))){const t=(h.innerText||'').trim();if(t)return t.toLowerCase();}
return '';}catch(e){return '';}})()`;

/**
 * A trimmed accessibility outline: the interactive/landmark elements with their role and accessible
 * name, capped. Built from the DOM rather than Playwright's deprecated `accessibility.snapshot()`
 * so it does not depend on an API scheduled for removal, and capped because it reaches a prompt.
 */
const A11Y_SCRIPT = `(()=>{try{
const out=[];const sel='a,button,input,select,textarea,[role],h1,h2,h3,nav,main,form';
for(const el of Array.from(document.querySelectorAll(sel))){
  if(out.length>=200)break;
  const r=el.getAttribute('role')||el.tagName.toLowerCase();
  const n=(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('name')||(el.innerText||'').trim().slice(0,60)||'').replace(/\\s+/g,' ');
  out.push(n?r+' "'+n+'"':r);
}
return out.join('\\n');}catch(e){return '';}})()`;

export interface PageObservation {
  data: LocalBrowserObservation;
  /** Raw base64 PNG, or undefined when the capture failed (never an empty string claiming one). */
  screenshotB64?: string;
}

/**
 * Capture the post-action observation. EVERY read is individually fault-tolerant: a page mid-
 * navigation makes any one of them throw, and losing the whole observation because the title read
 * lost a race would stall a run that is otherwise fine.
 */
export async function observePage(page: ProfilePage): Promise<PageObservation> {
  const [title, heading, domShapeSketch, accessibilitySnapshot] = await Promise.all([
    page.title().catch(() => ''),
    page.evaluate(HEADING_SCRIPT).then(asString).catch(() => ''),
    page.evaluate(SHAPE_SKETCH_SCRIPT).then(asString).catch(() => 'tags:|roles:|landmarks:0'),
    page.evaluate(A11Y_SCRIPT).then(asString).catch(() => ''),
  ]);

  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  const data: LocalBrowserObservation = {
    url: safeCall(() => page.url(), 'about:blank'),
    title,
    heading,
    domShapeSketch: domShapeSketch || 'tags:|roles:|landmarks:0',
    viewport: { w: vp.width, h: vp.height },
    ...(accessibilitySnapshot ? { accessibilitySnapshot: accessibilitySnapshot.slice(0, A11Y_CAP_CHARS) } : {}),
  };

  const screenshotB64 = await captureScreenshot(page);
  return { data, ...(screenshotB64 ? { screenshotB64 } : {}) };
}

/**
 * One retry, then give up. A screenshot fails transiently mid-navigation ("page is navigating and
 * changing content"); an EMPTY capture handed to the vision tier is worse than none, so the field
 * is omitted rather than set to a blank string.
 */
async function captureScreenshot(page: ProfilePage): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const buf = await page.screenshot({ type: 'png' });
      if (buf && buf.length > 0) return Buffer.from(buf).toString('base64');
    } catch {
      /* fall through to the settle + retry */
    }
    if (attempt === 0) {
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(250).catch(() => undefined);
    }
  }
  return undefined;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** A failure message for a step that could not run. Free text: it goes through the outbound
 *  redactor before it leaves the machine, and it never quotes page content. */
export function describeStepFailure(action: LocalBrowserAction, err: unknown, url: string): string {
  const message = err instanceof Error ? err.message : String(err);
  return `passo "${action.action}" falhou em ${safeUrlForMessage(url)}: ${message}`;
}
