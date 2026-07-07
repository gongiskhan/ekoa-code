/**
 * Page fingerprint computation.
 *
 * The cache key for a resolved Playwright action is
 * (automationId, stepId, fingerprint). We need the fingerprint to:
 *   - be stable across runs of the same page state (so cache hits)
 *   - discriminate same-shape pages with different content (so SPA
 *     templates like Google Docs don't collide across documents)
 *   - be cheap (~10–20ms per step)
 *   - never include text/attribute values (those change per session,
 *     per A/B variant, per timestamp render)
 *
 * Strategy: include URL components, hashes of title and first heading
 * (cheap content discriminators), plus a structural sketch of the DOM
 * (counts of tags + roles + landmarks, no text).
 *
 * Ported as-is from the old Cortex automation family (carryover-audit A8).
 */

import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import type { PageFingerprint } from './types.js';

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

/**
 * Run inside the page: build a normalised structural sketch of the
 * visible DOM. Counts elements by tag, by ARIA role, and by landmark
 * region; ignores text content and attribute values. Stringified output
 * is hashed by the caller.
 *
 * DOM globals are read off `globalThis` and typed `any` so this file does
 * NOT pull the `dom` lib into the (Node-only) api compilation — a
 * `/// <reference lib="dom" />` here would add DOM's `fetch`/`BodyInit`
 * typings to the whole program and break unrelated modules.
 */
function buildShapeSketchInPage(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const doc: any = (globalThis as any).document;
  const NodeFilter: any = (globalThis as any).NodeFilter;
  const tagCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};
  let landmarkCount = 0;

  const LANDMARK_TAGS = new Set(['header', 'nav', 'main', 'aside', 'footer', 'section', 'article']);

  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_ELEMENT);
  let node: any = walker.currentNode;
  while (node) {
    const el: any = node;
    const tag = el.tagName.toLowerCase();
    tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    if (LANDMARK_TAGS.has(tag)) landmarkCount++;
    const role = el.getAttribute('role');
    if (role) roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    node = walker.nextNode();
  }

  // Stable, sorted serialisation
  const tagPart = Object.keys(tagCounts).sort().map(k => `${k}=${tagCounts[k]}`).join(',');
  const rolePart = Object.keys(roleCounts).sort().map(k => `${k}=${roleCounts[k]}`).join(',');
  return `tags:${tagPart}|roles:${rolePart}|landmarks:${landmarkCount}`;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Read the first H1/H2 visible text, lowercased and trimmed. Used as a
 * cheap content-discrimination signal on SPAs.
 */
function readFirstHeadingInPage(): string {
  const doc: any = (globalThis as any).document; // eslint-disable-line @typescript-eslint/no-explicit-any
  const candidates = doc.querySelectorAll('h1, h2');
  for (const h of Array.from(candidates) as unknown[]) {
    const text = (h as { innerText?: string }).innerText?.trim();
    if (text) return text.toLowerCase();
  }
  return '';
}

export async function computePageFingerprint(page: Page): Promise<PageFingerprint> {
  const url = page.url();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    parsed = new URL('about:blank');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const pathSuffix = segments.length > 0 ? (segments[segments.length - 1] ?? '') : '';

  const [shapeSketch, headingText, title] = await Promise.all([
    page.evaluate(buildShapeSketchInPage).catch(() => 'tags:|roles:|landmarks:0'),
    page.evaluate(readFirstHeadingInPage).catch(() => ''),
    page.title().catch(() => ''),
  ]);

  const viewportSize = page.viewportSize() ?? { width: 0, height: 0 };

  return {
    origin: parsed.origin,
    pathname: parsed.pathname,
    pathSuffix,
    titleHash: sha1((title ?? '').toLowerCase().trim()),
    headingHash: sha1(headingText ?? ''),
    domShapeHash: sha1(shapeSketch),
    viewport: { w: viewportSize.width, h: viewportSize.height },
  };
}

/**
 * Stable string key suitable for memory tag matching or cache lookup.
 * Joins the fingerprint fields in a deterministic order.
 */
export function fingerprintKey(fp: PageFingerprint): string {
  return [
    fp.origin,
    fp.pathname,
    fp.pathSuffix,
    fp.titleHash,
    fp.headingHash,
    fp.domShapeHash,
    `${fp.viewport.w}x${fp.viewport.h}`,
  ].join('|');
}

/**
 * Compute a fingerprint from the same inputs the in-page hooks would
 * produce. Exported so tests can drive the function deterministically
 * without needing a running Playwright page.
 */
export function fingerprintFromParts(parts: {
  url: string;
  title: string;
  headingText: string;
  shapeSketch: string;
  viewport: { w: number; h: number };
}): PageFingerprint {
  let parsed: URL;
  try {
    parsed = new URL(parts.url);
  } catch {
    parsed = new URL('about:blank');
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const pathSuffix = segments.length > 0 ? (segments[segments.length - 1] ?? '') : '';

  return {
    origin: parsed.origin,
    pathname: parsed.pathname,
    pathSuffix,
    titleHash: sha1((parts.title ?? '').toLowerCase().trim()),
    headingHash: sha1((parts.headingText ?? '').toLowerCase().trim()),
    domShapeHash: sha1(parts.shapeSketch),
    viewport: parts.viewport,
  };
}
