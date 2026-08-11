/**
 * Knowledge crawl extraction core (WS8c, ported from ekoa-dev's `cortex/src/services/
 * knowledge-crawl.ts` pure-helper half) - URL scoping/normalization, link discovery, and
 * readable-text extraction from a fetched HTML page. No network I/O lives here (that's
 * `engine.ts`); this module is pure/testable against saved fixture HTML.
 *
 * DELIBERATE CUT vs. upstream (stated, not silent - see the WS8c parity ledger row): upstream
 * additionally extracts PDF/office DOCUMENT bodies via `officeparser` (`knowledge-extract.ts`).
 * This build recognizes a document URL (`docExtFor`) so the crawler can skip it HONESTLY -
 * discovered, logged, never fetched-and-silently-dropped, never fabricated as ingested - rather
 * than attempting extraction. Wiring a real extractor (this repo already has `pdfjs-dist` for
 * `app-vision.ts`) is an OPEN follow-up.
 */
import { load, type CheerioAPI } from 'cheerio';
import { stripBoilerplate } from './boilerplate.js';

const MAX_TEXT_CHARS = 200_000;
export const MIN_TEXT_CHARS = 40;

/** File extensions this build recognizes as a document link (never HTML-parsed, never
 *  extracted in this pass - see the module doc). Kept intentionally small: the actual crawl
 *  targets (DGSI/PGDL/DGERT/ACT/DRE) are overwhelmingly server-rendered HTML. */
const DOC_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'rtf']);

/** Recognize a document URL/content-type. Returns the lowercase extension, or null (treat as
 *  HTML/other). Content-type takes priority when present and unambiguous. */
export function docExtFor(contentType: string, url: string): string | null {
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('msword')) return 'doc';
  if (ct.includes('wordprocessingml')) return 'docx';
  if (ct.includes('ms-excel')) return 'xls';
  if (ct.includes('spreadsheetml')) return 'xlsx';
  if (ct.includes('ms-powerpoint')) return 'ppt';
  if (ct.includes('presentationml')) return 'pptx';
  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
    if (ext && DOC_EXTENSIONS.has(ext)) return ext;
  } catch {
    /* malformed URL - not a recognizable doc link */
  }
  return null;
}

function hostBase(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** same-domain = exact host (modulo www.) or a subdomain of the seed's host. */
export function inScope(candidate: string, seedUrl: string, scope: 'same-domain' | 'any'): boolean {
  if (scope === 'any') return true;
  let c: URL;
  let s: URL;
  try {
    c = new URL(candidate);
    s = new URL(seedUrl);
  } catch {
    return false;
  }
  const base = hostBase(s.hostname);
  const cand = c.hostname.toLowerCase();
  return cand === base || cand === `www.${base}` || cand.endsWith(`.${base}`);
}

/** Normalize a URL for dedup: drop the fragment, keep the query, strip a trailing slash on the path. */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  u.hash = '';
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

/** Absolute, http(s), deduped links from an HTML page (scope filtering happens at the caller,
 *  which also has the SSRF guard - keeping both checks together at the call site). */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = load(html);
  const out = new Set<string>();
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('javascript:') || trimmed.startsWith('tel:')) {
      return;
    }
    const abs = normalizeUrl(trimmed, baseUrl);
    if (abs && (abs.startsWith('http://') || abs.startsWith('https://'))) out.add(abs);
  });
  return [...out];
}

/**
 * Remove tags that never carry readable content (script/style/noscript/iframe/svg) + consent/
 * skip-link boilerplate, mutating the parsed document in place. When `stripStructural` is true
 * it ALSO removes page chrome (form/nav/header/footer/aside) - the right default for modern
 * pages; the caller retries with it false for legacy portals that template their whole content
 * inside a form (e.g. pgdlisboa.pt).
 */
function stripNoise($: CheerioAPI, stripStructural: boolean): void {
  $('script, style, noscript, iframe, svg').remove();
  if (stripStructural) $('form, nav, header, footer, aside').remove();
  stripBoilerplate($);
}

/** Main readable text (main > article > body) from an already-stripped document. */
function bodyText($: CheerioAPI): string {
  const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  return root.text().replace(/\s+/g, ' ').trim();
}

/** Extract a display title + the main readable text from an HTML page. */
export function extractContent(html: string, url: string): { title: string; text: string } {
  // Pass 1 - aggressive: drop always-noise tags AND page chrome. Title is read from THIS
  // stripped DOM so a header/nav/form <h1> can't leak in as the title; <title> lives in <head>
  // and is untouched by the strip, so it survives regardless.
  const $strip = load(html);
  stripNoise($strip, true);
  let title = ($strip('title').first().text() || '').trim();
  if (!title) title = ($strip('h1').first().text() || '').trim();
  if (!title) {
    try {
      title = new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname;
    } catch {
      title = url;
    }
  }

  let text = bodyText($strip);
  // Pass 2 - fallback for legacy government portals (e.g. pgdlisboa.pt) that wrap the ENTIRE
  // content area in a site-wide search <form> (or in header/aside): the aggressive strip
  // collapses such a page below the ingest floor, so it would be silently dropped. Retry keeping
  // the structural wrappers. Only triggers when pass 1 yields < MIN_TEXT_CHARS.
  if (text.length < MIN_TEXT_CHARS) {
    const $keep = load(html);
    stripNoise($keep, false);
    const kept = bodyText($keep);
    if (kept.length > text.length) text = kept;
  }

  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
  return { title: title.replace(/\s+/g, ' ').slice(0, 300), text };
}

/**
 * Decode an HTML response body using its declared charset. Portuguese legal portals (dgsi.pt,
 * pgdlisboa.pt, ...) commonly serve ISO-8859-1 / Windows-1252, not UTF-8 - decoding those as
 * UTF-8 mojibakes every accented character (c,a,o,e...), breaking both readability and
 * accent-folded search. Reads the charset from the Content-Type header, falling back to a
 * `<meta charset>` sniff; decodes 8859-1/15 + cp1252 as latin1 (Node's latin1 reproduces every
 * Portuguese accented letter exactly); everything else as UTF-8.
 */
export function decodeHtmlBuffer(buf: Buffer, contentType: string): string {
  let charset = '';
  const m = /charset\s*=\s*["']?([^;"'>\s]+)/i.exec(contentType || '');
  if (m) charset = m[1] as string;
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const mm = /<meta[^>]+charset\s*=\s*["']?\s*([^;"'>\s]+)/i.exec(head);
    if (mm) charset = mm[1] as string;
  }
  const c = charset.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (c.includes('8859') || c.includes('1252') || c.includes('latin')) {
    return buf.toString('latin1');
  }
  return buf.toString('utf-8');
}

/**
 * Read a response body into a Buffer, stopping at `max` bytes - streams the body and cancels the
 * rest so a huge (or hostile) response can never buffer past the cap. Falls back to a capped
 * arrayBuffer read when the body isn't streamable.
 */
export async function readCapped(res: Response, max: number): Promise<Buffer> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body || typeof body.getReader !== 'function') {
    return Buffer.from(await res.arrayBuffer()).subarray(0, max);
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = max - total;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total = max;
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks);
}
