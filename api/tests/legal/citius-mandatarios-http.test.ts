/**
 * CS4 — the Caixa Citius (mandatários) TRANSPORT half: cookie-jar enumerate + session replay.
 *
 * Most of this suite drives the REAL CS2 mock server over a real socket (a real login, a real
 * `Set-Cookie`, real ISO-8859-1 bytes, both pager idioms), because the properties under test are
 * transport properties and a stubbed response cannot see them. The stub-driven blocks exist for the
 * shapes the mock deliberately cannot produce — a page the parser refuses, a pager that advertises
 * more than it links, a pager link pointing at another host.
 *
 * What this suite protects, in order of how much it would cost to get wrong:
 *   1. METADATA ONLY. A full multi-page enumerate leaves the mock's document-hit counter at ZERO
 *      (with the counter proven able to increment, so the assertion cannot pass vacuously), and the
 *      module structurally cannot address a document at all.
 *   2. NO FALSE EMPTY, EVER. A page the parser refuses, a dead session, a truncated walk and a
 *      pager disagreement are each their OWN outcome; none of them can present as "no
 *      notifications". The genuinely-empty inbox is tested alongside them so the distinction is
 *      real and not an artefact of the outcome never being `complete` with zero rows.
 *   3. THE CONNECTOR ONLY EVER REQUESTS ITS OWN CONFIGURED URL — no href, no `Location`, no form
 *      action from the page is ever fetched, even when the page offers one.
 *   4. The default transport really is `credentialedFetch` (origin binding + SSRF guard), and the
 *      origin binding holds even when a test injects its own transport.
 *   5. The throttle is real, bounded and injectable, and no credential value reaches an outcome.
 *
 * NOTE ON THE INJECTED TRANSPORT: the guarded default (correctly) refuses a 127.0.0.1 mock, so the
 * mock-driven blocks inject a plain `fetch` — the house pattern (`integrations/pipedream.test.ts`).
 * The default transport is exercised separately, against destinations that must be REFUSED, so no
 * test ever touches the real portal.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeHtml, parseHiddenFields } from '../../src/legal/portal-html.js';
import { parseInboxPage } from '../../src/legal/citius-mandatarios.js';
import {
  enumerateInbox,
  CITIUS_INBOX_PATH,
  CITIUS_MANDATARIOS_BASE_URL,
  CITIUS_MANDATARIOS_HOST,
  type CitiusTransport,
  type CitiusInboxEnumeration,
} from '../../src/legal/citius-mandatarios-http.js';
import * as connector from '../../src/legal/citius-mandatarios-http.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockCitius } from '../helpers/mock-citius-webforms-server.mjs';

const MODULE_PATH = fileURLToPath(new URL('../../src/legal/citius-mandatarios-http.ts', import.meta.url));
const MODULE_SRC = readFileSync(MODULE_PATH, 'utf-8');
/** MODULE_SRC with block + line comments stripped: the docblock legitimately DISCUSSES documents. */
const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const fxPath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/citius-mandatarios/${name}`, import.meta.url));
const loadFixture = (name: string): string =>
  decodeHtml(readFileSync(fxPath(name)), 'text/html; charset=iso-8859-1');

let mock: Awaited<ReturnType<typeof startMockCitius>>;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface RecordedRequest {
  url: string;
  method: string;
  cookie?: string;
  body?: string;
  headers?: Record<string, string>;
}

/** A transport that really talks to the mock (plain fetch — the guarded default refuses loopback),
 *  recording every request so the "only ever its own URL" invariant is observable. Redirects are
 *  surfaced, never followed, exactly as the connector requires. */
function recordingTransport(recorded: RecordedRequest[], afterEach?: () => void): CitiusTransport {
  return async (url, init) => {
    recorded.push({ url, method: init.method, cookie: init.headers.Cookie, body: init.body, headers: init.headers });
    const res = await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: 'manual',
    });
    if (afterEach) afterEach();
    return res;
  };
}

/** A transport serving canned latin1 pages by page number (the mock cannot produce these shapes). */
function stubTransport(
  pageHtml: (page: number) => string | { status: number; location?: string; html?: string },
  recorded?: RecordedRequest[],
): CitiusTransport {
  return async (url, init) => {
    const u = new URL(url);
    const fromQuery = Number(u.searchParams.get('page') ?? '1') || 1;
    // the postback body is form-URL-ENCODED (`Page%242`), so it is decoded before it is read —
    // a raw regex over the encoded body silently re-serves page 1 and reads as a clamping pager
    const fromBody = /Page\$(\d+)/.exec(new URLSearchParams(init.body ?? '').get('__EVENTARGUMENT') ?? '')?.[1];
    const page = fromBody ? Number(fromBody) : fromQuery;
    recorded?.push({ url, method: init.method, cookie: init.headers.Cookie, body: init.body });
    const out = pageHtml(page);
    const spec = typeof out === 'string' ? { status: 200, html: out } : out;
    const buf = Buffer.from(spec.html ?? '', 'latin1');
    const headers = new Headers({ 'Content-Type': 'text/html; charset=iso-8859-1' });
    if (spec.location) headers.set('Location', spec.location);
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      headers,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    };
  };
}

/** Log in to the mock for real and return the session cookie as a Playwright-shaped storageState —
 *  the exact artefact CS5's `ensureSession` hands over. The value is minted by the server at
 *  runtime, never a literal in this file (the run's secrets-gate rule). */
async function establishSession(): Promise<{ state: unknown; cookieValue: string }> {
  const loginRes = await fetch(`${mock.baseUrl}${mock.loginPath}`);
  const html = decodeHtml(Buffer.from(await loginRes.arrayBuffer()), loginRes.headers.get('content-type') ?? '');
  const hidden = parseHiddenFields(html);
  const res = await fetch(`${mock.baseUrl}${mock.loginPath}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      __VIEWSTATE: hidden.__VIEWSTATE!,
      __VIEWSTATEGENERATOR: hidden.__VIEWSTATEGENERATOR!,
      __EVENTVALIDATION: hidden.__EVENTVALIDATION!,
      'ctl00$cph$txtUserName': 'advogado',
      'ctl00$cph$txtUserPass': ['segredo', 'de', 'teste'].join('-'),
    }).toString(),
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('ASP.NET_SessionId'));
  const value = setCookie!.split(';')[0]!.split('=')[1]!;
  return {
    cookieValue: value,
    state: { cookies: [{ name: 'ASP.NET_SessionId', value, domain: '127.0.0.1', path: '/', secure: false }] },
  };
}

/** The enumerate call every mock-driven block makes, with the transport/sleep seams injected. */
async function enumerateAgainstMock(
  state: unknown,
  opts: { maxPages?: number; throttleMs?: number } = {},
  recorded: RecordedRequest[] = [],
  sleeps: number[] = [],
  afterEachRequest?: () => void,
): Promise<CitiusInboxEnumeration> {
  return enumerateInbox(
    {
      sessionState: state,
      baseUrl: mock.baseUrl,
      inboxPath: mock.inboxPath,
      boundOrigins: ['127.0.0.1'],
      throttleMs: opts.throttleMs ?? 0,
      ...(opts.maxPages === undefined ? {} : { maxPages: opts.maxPages }),
    },
    {
      transport: recordingTransport(recorded, afterEachRequest),
      sleep: async (ms) => { sleeps.push(ms); },
    },
  );
}

/** A session state for the stub-driven blocks: one cookie bound to `portal.example`. */
const offlineState = (value: string, domain = 'portal.example'): unknown => ({
  cookies: [{ name: 'ASP.NET_SessionId', value, domain, path: '/' }],
});

beforeAll(async () => {
  mock = await startMockCitius({ pageSize: 2 });
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.scenario({ cmd: 'reset' });
  mock.scenario({ cmd: 'setPaging', paging: 'get' });
});

// ---------------------------------------------------------------------------
// 1. the happy walk, both pager idioms
// ---------------------------------------------------------------------------

describe('citius-mandatarios-http · enumerate over a GET pager (against the CS2 mock)', () => {
  it('replays the session cookie, walks every page and reports COMPLETE', async () => {
    const { state, cookieValue } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 3 }); // 2 seeded + 3 = 5 rows over 3 pages of 2

    const recorded: RecordedRequest[] = [];
    const out = await enumerateAgainstMock(state, {}, recorded);

    expect(out.status).toBe('complete');
    expect(out.rows).toHaveLength(5);
    expect(out.pagesWalked).toBe(3);
    expect(out.advertisedPageCount).toBe(3);
    expect(out.pages.map((p) => p.outcome)).toEqual(['ok', 'ok', 'ok']);
    expect(out.pages.map((p) => p.rows)).toEqual([2, 2, 1]);

    // the cookie jar was really replayed on every hop (page 1 included)
    expect(recorded).toHaveLength(3);
    expect(recorded.every((r) => r.cookie === `ASP.NET_SessionId=${cookieValue}`)).toBe(true);
    expect(recorded.map((r) => r.method)).toEqual(['GET', 'GET', 'GET']);

    // rows carry the parsed metadata, including the latin1 accent and the INERT document ref
    expect(out.rows[0]).toMatchObject({ processo: '1234/26.0T8LSB', ato: 'Citação', temDocumento: true });
    expect(out.rows[0]!.documentoRef).toBe('Documento.aspx?docId=abc123&t=not');
  });

  it('a single-page inbox is COMPLETE after one request (no pager, no second hit)', async () => {
    const { state } = await establishSession();
    const recorded: RecordedRequest[] = [];
    const out = await enumerateAgainstMock(state, {}, recorded);

    expect(out.status).toBe('complete');
    expect(out.rows).toHaveLength(2);
    expect(recorded).toHaveLength(1);
    expect(out.advertisedPageCount).toBeUndefined();
  });
});

describe('citius-mandatarios-http · enumerate over a __doPostBack pager', () => {
  it('carries the WebForms hidden state forward and posts Page$N for each page', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'setPaging', paging: 'postback' });
    mock.scenario({ cmd: 'addItems', count: 3 });

    const recorded: RecordedRequest[] = [];
    const out = await enumerateAgainstMock(state, {}, recorded);

    expect(out.status).toBe('complete');
    expect(out.rows).toHaveLength(5);
    expect(out.pagesWalked).toBe(3);

    // page 1 is a GET; every later page is a POST echoing the page's own hidden state
    expect(recorded.map((r) => r.method)).toEqual(['GET', 'POST', 'POST']);
    const body2 = new URLSearchParams(recorded[1]!.body ?? '');
    expect(body2.get('__EVENTARGUMENT')).toBe('Page$2');
    expect(body2.get('__EVENTTARGET')).toBe('ctl00$cph$gvNotificacoes');
    expect(body2.get('__VIEWSTATE')).toBeTruthy();
    expect(body2.get('__EVENTVALIDATION')).toBeTruthy();
    expect(new URLSearchParams(recorded[2]!.body ?? '').get('__EVENTARGUMENT')).toBe('Page$3');
    // the postback carries a Referer, and it can only ever be this connector's own inbox URL
    expect(recorded[1]!.headers!.Referer).toBe(`${mock.baseUrl}${mock.inboxPath}`);
  });

  it('a postback pager with no recognisable target is INCOMPLETE, never complete', async () => {
    const rows = '<tr><td>1234/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>';
    const pager = `<a href="javascript:__doPostBack('&lt;script&gt;','Page$2')">2</a>`;
    const out = await enumerateInbox(
      { sessionState: offlineState('t1'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => gridPage(rows, pager)), sleep: async () => {} },
    );
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('pager-unavailable');
    expect(out.rows).toHaveLength(1); // page 1's row is kept, not thrown away
  });
});

// ---------------------------------------------------------------------------
// 2. METADATA ONLY — behavioural
// ---------------------------------------------------------------------------

describe('citius-mandatarios-http · metadata-only, behaviourally (zero document hits)', () => {
  it('a full multi-page enumerate over rows WITH documents never hits Documento.aspx', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 5 });

    // NON-VACUITY FIRST: prove the counter can move, then reset it and run the real enumerate.
    const probe = await fetch(`${mock.baseUrl}${mock.documentPath}?docId=abc123`);
    await probe.arrayBuffer();
    expect(mock.getDocumentHits()).toBe(1);
    mock.scenario({ cmd: 'reset' });
    expect(mock.getDocumentHits()).toBe(0);
    mock.scenario({ cmd: 'addItems', count: 5 });

    const out = await enumerateAgainstMock(state);
    expect(out.status).toBe('complete');
    expect(out.rows.length).toBe(7);
    expect(out.rows.some((r) => r.temDocumento && r.documentoRef)).toBe(true); // documents WERE offered
    expect(mock.getDocumentHits()).toBe(0); // …and never opened

    // the same run over the postback rail
    mock.scenario({ cmd: 'setPaging', paging: 'postback' });
    const out2 = await enumerateAgainstMock(state);
    expect(out2.status).toBe('complete');
    expect(mock.getDocumentHits()).toBe(0);
  });

  it('never requests a URL other than its own configured inbox URL, whatever the page offers', async () => {
    // A page whose rows link to documents on ANOTHER host and whose pager link points there too.
    const rows =
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td>' +
      '<td><a href="https://evil.example/Documento.aspx?docId=1">Descarregar</a></td></tr>';
    const pager = '<a href="https://evil.example/CaixaCorreio.aspx?page=2">2</a>';
    const recorded: RecordedRequest[] = [];
    const out = await enumerateInbox(
      { sessionState: offlineState('t2'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => gridPage(rows, pager), recorded), sleep: async () => {} },
    );

    // it followed the pager (page 2 exists) but only ever at ITS OWN url
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    for (const req of recorded) {
      expect(new URL(req.url).host).toBe('portal.example');
      expect(new URL(req.url).pathname).toBe(CITIUS_INBOX_PATH);
      expect(req.url).not.toContain('Documento');
    }
    // page 2 re-served page 1's row, which is a repeat, not a second notification
    expect(out.status).toBe('incomplete');
    expect(out.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. NO FALSE EMPTY — the four ways a walk stops being trustworthy
// ---------------------------------------------------------------------------

describe('citius-mandatarios-http · a genuinely empty inbox (the ONE legitimate empty)', () => {
  it('reports COMPLETE with zero rows when the portal proves the inbox empty', async () => {
    const empty = await startMockCitius({ seed: [] });
    try {
      const loginRes = await fetch(`${empty.baseUrl}${empty.loginPath}`);
      const html = decodeHtml(Buffer.from(await loginRes.arrayBuffer()), 'text/html; charset=iso-8859-1');
      const hidden = parseHiddenFields(html);
      const res = await fetch(`${empty.baseUrl}${empty.loginPath}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          __VIEWSTATE: hidden.__VIEWSTATE!,
          __EVENTVALIDATION: hidden.__EVENTVALIDATION!,
          'ctl00$cph$txtUserName': 'advogado',
          'ctl00$cph$txtUserPass': ['segredo', 'vazio'].join('-'),
        }).toString(),
      });
      const value = res.headers.getSetCookie()
        .find((c) => c.startsWith('ASP.NET_SessionId'))!.split(';')[0]!.split('=')[1]!;

      const out = await enumerateInbox(
        {
          sessionState: { cookies: [{ name: 'ASP.NET_SessionId', value, domain: '127.0.0.1', path: '/' }] },
          baseUrl: empty.baseUrl,
          inboxPath: empty.inboxPath,
          boundOrigins: ['127.0.0.1'],
          throttleMs: 0,
        },
        { transport: recordingTransport([]), sleep: async () => {} },
      );

      expect(out.status).toBe('complete');
      expect(out.rows).toEqual([]);
    } finally {
      await empty.close();
    }
  });
});

describe('citius-mandatarios-http · a page the parser refuses is INCOMPLETE, never empty', () => {
  it('keeps the rows already read and names the unparseable page', async () => {
    const chrome = loadFixture('chrome-gridview-error.html');
    expect(parseInboxPage(chrome).ok).toBe(false); // the premise, pinned

    const recorded: RecordedRequest[] = [];
    const out = await enumerateInbox(
      { sessionState: offlineState('t3'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      {
        transport: stubTransport((page) => (page === 1 ? loadFixture('inbox-get-p1.html') : chrome), recorded),
        sleep: async () => {},
      },
    );

    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('page-unparseable');
    expect(out.rows).toHaveLength(2); // page 1's real notifications survive
    expect(out.pages.map((p) => p.outcome)).toEqual(['ok', 'unparseable']);
    expect(out.pagesWalked).toBe(2);
    expect(recorded).toHaveLength(2); // and it STOPPED there rather than hammering on
  });

  it('an unreadable FIRST page is INCOMPLETE with zero rows — never a complete empty inbox', async () => {
    const out = await enumerateInbox(
      { sessionState: offlineState('t4'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => loadFixture('error.html')), sleep: async () => {} },
    );
    expect(out.status).not.toBe('complete');
    expect(out.status).toBe('incomplete');
    expect(out.rows).toEqual([]);
  });
});

describe('citius-mandatarios-http · truncation and pager disagreement are INCOMPLETE', () => {
  it('hitting maxPages with another page linked reports INCOMPLETE (max-pages)', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 3 }); // 5 rows over 3 pages

    const out = await enumerateAgainstMock(state, { maxPages: 2 });
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('max-pages');
    expect(out.rows).toHaveLength(4);
    expect(out.pagesWalked).toBe(2);
    expect(out.advertisedPageCount).toBe(3);
  });

  it('a pager advertising more pages than it links reports INCOMPLETE (page-count-disagreement)', async () => {
    const rows = '<tr><td>1234/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>';
    const pager = '<span class="cur">1</span><a href="CaixaCorreio.aspx?page=3">3</a>';
    const out = await enumerateInbox(
      { sessionState: offlineState('t5'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => gridPage(rows, pager)), sleep: async () => {} },
    );
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('page-count-disagreement');
    expect(out.advertisedPageCount).toBe(3);
    expect(out.rows).toHaveLength(1);
  });

  it('a next-only postback CONTROL (no numeric pages at all) reports INCOMPLETE (pager-unrecognised)', async () => {
    const rows = '<tr><td>1234/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>';
    // no `Page$N` anywhere: the only pager control is a labelled postback this module cannot drive
    const pager = `<a href="javascript:__doPostBack('ctl00$cph$gv','Avancar')">Seguinte &gt;&gt;</a>`;
    const out = await enumerateInbox(
      { sessionState: offlineState('t14'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => gridPage(rows, pager)), sleep: async () => {} },
    );
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('pager-unrecognised');
    expect(out.rows).toHaveLength(1);
  });

  it('a numbered postback pager on its LAST page is still COMPLETE (the guard does not over-fire)', async () => {
    const rows = '<tr><td>1234/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>';
    const pager = `<a href="javascript:__doPostBack('ctl00$cph$gv','Page$1')">1</a><span>2</span>`;
    const out = await enumerateInbox(
      { sessionState: offlineState('t15'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => gridPage(rows, pager)), sleep: async () => {} },
    );
    expect(out.status).toBe('complete');
  });

  it('a next-only pager token (Page$Next) reports INCOMPLETE (pager-unrecognised)', async () => {
    const rows = '<tr><td>1234/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>';
    const pager = `<a href="javascript:__doPostBack('ctl00$cph$gv','Page$Next')">Seguinte</a>`;
    const out = await enumerateInbox(
      { sessionState: offlineState('t6'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => gridPage(rows, pager)), sleep: async () => {} },
    );
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('pager-unrecognised');
  });
});

describe('citius-mandatarios-http · a dead session is its OWN outcome', () => {
  it('a session that dies MID-walk stops at that page and keeps what it read', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 3 });

    // expire the session as soon as the first page has been served
    let served = 0;
    const out = await enumerateAgainstMock(state, {}, [], [], () => {
      served += 1;
      if (served === 1) mock.scenario({ cmd: 'expireSession' });
    });

    expect(out.status).toBe('session-dead');
    if (out.status !== 'session-dead') return;
    expect(out.detectedBy).toBe('login-redirect');
    expect(out.atPage).toBe(2);
    expect(out.rows).toHaveLength(2); // page 1's notifications are real and are returned
    expect(out.pages.at(-1)!.outcome).toBe('login');
  });

  it('a session that was already dead is session-dead with ZERO rows — never an empty inbox', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'expireSession' });

    const out = await enumerateAgainstMock(state);
    expect(out.status).toBe('session-dead');
    expect(out.status).not.toBe('complete');
    expect(out.rows).toEqual([]);
  });

  it('a 200 that re-renders the LOGIN FORM is session-dead, not an unparseable page', async () => {
    const out = await enumerateInbox(
      { sessionState: offlineState('t7'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => loadFixture('login.html')), sleep: async () => {} },
    );
    expect(out.status).toBe('session-dead');
    if (out.status !== 'session-dead') return;
    expect(out.detectedBy).toBe('login-page');
    expect(out.rows).toEqual([]);
  });

  it('a 403 is FAILED, not session-dead — an ambiguous refusal never spends a login attempt', async () => {
    const out = await enumerateInbox(
      { sessionState: offlineState('t8'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => ({ status: 403, html: '<html>blocked</html>' })), sleep: async () => {} },
    );
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.error).toContain('403');
  });

  it('a redirect that is NOT a login is FAILED and is never followed', async () => {
    const recorded: RecordedRequest[] = [];
    const out = await enumerateInbox(
      { sessionState: offlineState('t9'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      {
        transport: stubTransport(() => ({ status: 302, location: 'https://evil.example/collect' }), recorded),
        sleep: async () => {},
      },
    );
    expect(out.status).toBe('failed');
    expect(recorded).toHaveLength(1); // the Location was classified, never fetched
    expect(recorded[0]!.url.startsWith('https://portal.example')).toBe(true);
  });

  it('a transport that throws is FAILED, never a silent empty', async () => {
    const out = await enumerateInbox(
      { sessionState: offlineState('t10'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: async () => { throw new TypeError('fetch failed'); }, sleep: async () => {} },
    );
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.rows).toEqual([]);
    expect(out.pages[0]!.outcome).toBe('transport-error');
  });

  it('a repeated page (a clamping pager) stops the walk as INCOMPLETE', async () => {
    const rows = '<tr><td>1234/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>';
    const pager = '<a href="CaixaCorreio.aspx?page=1">1</a><a href="CaixaCorreio.aspx?page=2">2</a>';
    const out = await enumerateInbox(
      { sessionState: offlineState('t11'), baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: stubTransport(() => gridPage(rows, pager)), sleep: async () => {} },
    );
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('repeat-page');
    expect(out.rows).toHaveLength(1); // the repeat did not duplicate the notification
  });
});

// ---------------------------------------------------------------------------
// 4. the credential rail: the default transport, the origin binding, no leakage
// ---------------------------------------------------------------------------

describe('citius-mandatarios-http · the default transport is credentialedFetch', () => {
  it('refuses a destination that is not bound to the session credential, before any request', async () => {
    const transportCalls: string[] = [];
    const out = await enumerateInbox(
      {
        sessionState: offlineState('t12', CITIUS_MANDATARIOS_HOST),
        baseUrl: CITIUS_MANDATARIOS_BASE_URL,
        boundOrigins: ['outra-coisa.example'],
      },
      {
        transport: async (url) => { transportCalls.push(url); throw new Error('must not be reached'); },
        sleep: async () => {},
      },
    );
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.error).toContain('not a bound origin');
    // the binding is enforced by the CONNECTOR, so an injected transport cannot escape it
    expect(transportCalls).toEqual([]);
    expect(out.pages[0]!.outcome).toBe('refused');
  });

  it('with NO injected transport, the SSRF guard in the default path refuses a loopback portal', async () => {
    const before = mock.getDocumentHits();
    const out = await enumerateInbox({
      sessionState: offlineState('t13', '127.0.0.1'),
      baseUrl: mock.baseUrl, // 127.0.0.1 — bound, reachable, and correctly refused by guardedFetch
      inboxPath: mock.inboxPath,
      boundOrigins: ['127.0.0.1'],
      throttleMs: 0,
    });
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.error).toContain('SsrfError');
    expect(mock.getDocumentHits()).toBe(before);
  });

  it('refuses a session state with no cookie for the origin rather than fetching anonymously', async () => {
    const transportCalls: string[] = [];
    const out = await enumerateInbox(
      { sessionState: { cookies: [] }, baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] },
      { transport: async (url) => { transportCalls.push(url); throw new Error('unreachable'); }, sleep: async () => {} },
    );
    expect(out.status).toBe('failed');
    expect(transportCalls).toEqual([]);
  });

  it('refuses a cookie that names no domain rather than replaying it at the configured host', async () => {
    const transportCalls: string[] = [];
    const out = await enumerateInbox(
      {
        sessionState: { cookies: [{ name: 'sess', value: 'sem-dominio', path: '/' }] },
        baseUrl: 'https://portal.example',
        boundOrigins: ['portal.example'],
      },
      { transport: async (url) => { transportCalls.push(url); throw new Error('unreachable'); }, sleep: async () => {} },
    );
    expect(out.status).toBe('failed');
    expect(transportCalls).toEqual([]);
  });

  it('sends only the cookies that match the request host and path', async () => {
    const recorded: RecordedRequest[] = [];
    await enumerateInbox(
      {
        sessionState: {
          cookies: [
            { name: 'sess', value: 'keep', domain: 'portal.example', path: '/' },
            { name: 'other', value: 'drop', domain: 'outro.example', path: '/' },
            { name: 'deep', value: 'drop', domain: 'portal.example', path: '/algures/profundo' },
            { name: 'https_only', value: 'drop', domain: 'portal.example', path: '/', secure: true },
          ],
        },
        baseUrl: 'http://portal.example',
        boundOrigins: ['portal.example'],
      },
      { transport: stubTransport(() => loadFixture('inbox-empty.html'), recorded), sleep: async () => {} },
    );
    expect(recorded[0]!.cookie).toBe('sess=keep');
  });

  it('absorbs a rotated session cookie mid-walk and replays the NEW one', async () => {
    const recorded: RecordedRequest[] = [];
    const rows = (n: string) =>
      `<tr><td>${n}/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>`;
    const transport: CitiusTransport = async (url, init) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '1') || 1;
      recorded.push({ url, method: init.method, cookie: init.headers.Cookie });
      const html = page === 1
        ? gridPage(rows('1234'), '<a href="CaixaCorreio.aspx?page=2">2</a>')
        : gridPage(rows('5678'), '<a href="CaixaCorreio.aspx?page=1">1</a>');
      const buf = Buffer.from(html, 'latin1');
      const headers = new Headers({ 'Content-Type': 'text/html; charset=iso-8859-1' });
      if (page === 1) headers.append('Set-Cookie', 'sess=rotacionado; path=/');
      return {
        status: 200,
        ok: true,
        headers,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      };
    };
    const out = await enumerateInbox(
      {
        sessionState: { cookies: [{ name: 'sess', value: 'inicial', domain: 'portal.example', path: '/' }] },
        baseUrl: 'https://portal.example',
        boundOrigins: ['portal.example'],
      },
      { transport, sleep: async () => {} },
    );
    expect(out.status).toBe('complete');
    expect(recorded[0]!.cookie).toBe('sess=inicial');
    expect(recorded[1]!.cookie).toBe('sess=rotacionado');
  });

  it('no cookie value ever reaches the outcome', async () => {
    const { state, cookieValue } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 3 });
    const out = await enumerateAgainstMock(state);
    expect(cookieValue.length).toBeGreaterThan(8);
    expect(JSON.stringify(out)).not.toContain(cookieValue);
  });
});

// ---------------------------------------------------------------------------
// 5. the throttle
// ---------------------------------------------------------------------------

describe('citius-mandatarios-http · throttle', () => {
  it('waits between pages, once per hop after the first, at the configured delay', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 3 }); // 3 pages
    const sleeps: number[] = [];
    const out = await enumerateAgainstMock(state, { throttleMs: 250 }, [], sleeps);
    expect(out.pagesWalked).toBe(3);
    expect(sleeps).toEqual([250, 250]);
  });

  it('defaults to a real, bounded delay and clamps an absurd one', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 1 }); // 2 pages -> exactly one wait

    const byDefault: number[] = [];
    await enumerateInbox(
      { sessionState: state, baseUrl: mock.baseUrl, inboxPath: mock.inboxPath, boundOrigins: ['127.0.0.1'] },
      { transport: recordingTransport([]), sleep: async (ms) => { byDefault.push(ms); } },
    );
    expect(byDefault).toHaveLength(1);
    expect(byDefault[0]).toBeGreaterThan(0);
    expect(byDefault[0]).toBeLessThanOrEqual(60_000);

    const clamped: number[] = [];
    await enumerateInbox(
      {
        sessionState: state,
        baseUrl: mock.baseUrl,
        inboxPath: mock.inboxPath,
        boundOrigins: ['127.0.0.1'],
        throttleMs: 10 * 60 * 1000,
      },
      { transport: recordingTransport([]), sleep: async (ms) => { clamped.push(ms); } },
    );
    expect(clamped).toEqual([60_000]);
  });
});

// ---------------------------------------------------------------------------
// 6. COMPLETENESS HONESTY — the round-6 fresh-context review
//
// `complete` maps to CS6's `reachedEnd:true`, which lets `verified-sync.ts` advance the watermark:
// a FALSE `complete` silently loses legal notifications for ever. The reviewer's 56 probes found
// six real pagers that each walked ONE page and certified the sweep, because the recogniser only
// ever matched a literal `?p=N` / `?page=N` in a quoted href and only ever inspected POSTBACK
// anchors. Each block below drives a REAL two-page portal: page 2 exists and carries a second
// notification, so "complete after one request" is provably a lost notification and not a shape
// that happened to have nothing behind it.
// ---------------------------------------------------------------------------

/** One notification row, addressable so page 1 and page 2 are distinguishable. */
const gridRow = (n: string): string =>
  `<tr><td>${n}/26.0T8LSB</td><td>2026-06-15</td><td>Lisboa</td><td>Citação</td><td>&nbsp;</td></tr>`;
/** The pager page 2 renders: a link BACK to page 1 and its own number as a label (WebForms). */
const PAGE_2_PAGER = '<a href="CaixaCorreio.aspx?page=1">1</a><span class="cur">2</span>';

/** A portal with a REAL page 2, whose page 1 renders `pager`. Page 2 is the last page. */
function twoPagePortal(pager: string, recorded?: RecordedRequest[]): CitiusTransport {
  return stubTransport(
    (page) => (page === 1 ? gridPage(gridRow('1234'), pager) : gridPage(gridRow('5678'), PAGE_2_PAGER)),
    recorded,
  );
}

const OFFLINE: Pick<Parameters<typeof enumerateInbox>[0], 'baseUrl' | 'boundOrigins'> =
  { baseUrl: 'https://portal.example', boundOrigins: ['portal.example'] };

async function walkTwoPagePortal(
  pager: string,
  recorded: RecordedRequest[] = [],
  extra: Partial<Parameters<typeof enumerateInbox>[0]> = {},
): Promise<CitiusInboxEnumeration> {
  return enumerateInbox(
    { sessionState: offlineState('cs4'), ...OFFLINE, ...extra },
    { transport: twoPagePortal(pager, recorded), sleep: async () => {} },
  );
}

describe('citius-mandatarios-http · a truncated sweep is never COMPLETE (round-6 CRITICAL-1)', () => {
  it('NON-VACUITY: the very same portal, with the ONE pager shape the old recogniser knew, walks both pages', async () => {
    const recorded: RecordedRequest[] = [];
    const out = await walkTwoPagePortal('<a href="CaixaCorreio.aspx?page=2">2</a>', recorded);
    expect(out.status).toBe('complete');
    expect(out.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '5678/26.0T8LSB']);
    expect(recorded).toHaveLength(2);
  });

  // ---- the shapes that used to certify a one-page sweep -------------------------------------
  // (a) an ENTITY-ENCODED `&`: the pager is drivable once hrefs are decoded, so the walk must
  //     actually REACH page 2 — not merely refuse to say `complete`.
  it.each([
    ['&amp;', '<a href="CaixaCorreio.aspx?o=d&amp;page=2">2</a>'],
    ['&#38;', '<a href="CaixaCorreio.aspx?o=d&#38;page=2">2</a>'],
  ])('an %s-encoded multi-parameter pager href is decoded and page 2 is really fetched', async (_label, pager) => {
    const recorded: RecordedRequest[] = [];
    const out = await walkTwoPagePortal(pager, recorded);
    expect(out.status).toBe('complete');
    expect(out.rows).toHaveLength(2); // the second notification was NOT lost
    expect(recorded).toHaveLength(2);
    // the raw markup does NOT contain the literal the old recogniser looked for — the decode is
    // load-bearing, not incidental
    expect(pager).not.toMatch(/[?&]p(?:age)?=2/);
  });

  // (b) pagers this module cannot DRIVE. It must refuse `complete`, keep page 1's rows, and name
  //     the refusal as the high-confidence one (a control inside the pager region).
  it.each([
    ['a page parameter it does not know', '<a href="CaixaCorreio.aspx?pagina=2">2</a>'],
    ['a labelled GET next link', '<a href="CaixaCorreio.aspx?pg=2">Seguinte &gt;&gt;</a>'],
    ['an image-only next control', '<a href="CaixaCorreio.aspx?idx=2"><img alt="Seguinte" src="n.gif"></a>'],
    ['a script-driven next link', '<a href="#" onclick="goPage(2)">Próxima</a>'],
    ['a submit-button next control', '<input type="submit" name="ctl00$cph$btnNext" value="Seguinte"/>'],
  ])('%s is INCOMPLETE (pager-unrecognised), never complete', async (_label, pager) => {
    const recorded: RecordedRequest[] = [];
    const out = await walkTwoPagePortal(pager, recorded);
    expect(out.status).not.toBe('complete');
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('pager-unrecognised');
    expect(out.rows).toHaveLength(1); // page 1's notification is real and is kept
    expect(recorded).toHaveLength(1);
  });

  it('THE FLOOR: a full last page with no pager account of itself cannot be complete', async () => {
    // A pager control this module recognises as neither numeric nor next-labelled. Nothing says
    // "there is more" — and nothing proves there is not, because the grid came back FULL.
    const pager = '<div class="pager"><a href="CaixaCorreio.aspx?dir=next"><img src="n.gif"></a></div>';
    const full = await enumerateInbox(
      { sessionState: offlineState('floor'), ...OFFLINE, pageSize: 1 },
      { transport: stubTransport(() => gridPage(gridRow('1234'), pager)), sleep: async () => {} },
    );
    expect(full.status).toBe('incomplete');
    if (full.status !== 'incomplete') return;
    expect(full.reason).toBe('page-full-no-pager');
    expect(full.rows).toHaveLength(1);
  });

  it('…and the floor does NOT over-fire: a grid under the page size, or a pager that accounts for the page, is complete', async () => {
    const pager = '<div class="pager"><a href="CaixaCorreio.aspx?dir=next"><img src="n.gif"></a></div>';
    // same page, same pager — but the grid is not full, so nothing is suspicious
    const notFull = await enumerateInbox(
      { sessionState: offlineState('floor2'), ...OFFLINE, pageSize: 5 },
      { transport: stubTransport(() => gridPage(gridRow('1234'), pager)), sleep: async () => {} },
    );
    expect(notFull.status).toBe('complete');

    // full grid, but the pager NAMES page 1 and nothing beyond it: that is the end, stated
    const accounted = await enumerateInbox(
      { sessionState: offlineState('floor3'), ...OFFLINE, pageSize: 1 },
      {
        transport: stubTransport(() =>
          gridPage(gridRow('1234'), '<div class="pager">Páginas: <span class="cur">1</span></div>')),
        sleep: async () => {},
      },
    );
    expect(accounted.status).toBe('complete');
  });
});

describe('citius-mandatarios-http · pageParam is really wired (round-6 CRITICAL-2)', () => {
  /** A portal whose pager parameter is `pagina`, with a real second page behind it. */
  function paginaPortal(recorded: RecordedRequest[]): CitiusTransport {
    return async (url, init) => {
      recorded.push({ url, method: init.method, cookie: init.headers.Cookie, body: init.body });
      const page = Number(new URL(url).searchParams.get('pagina') ?? '1') || 1;
      const html = page === 1
        ? gridPage(gridRow('1234'), '<a href="CaixaCorreio.aspx?pagina=2">2</a>')
        : gridPage(gridRow('5678'), '<a href="CaixaCorreio.aspx?pagina=1">1</a><span class="cur">2</span>');
      const buf = Buffer.from(html, 'latin1');
      return {
        status: 200,
        ok: true,
        headers: new Headers({ 'Content-Type': 'text/html; charset=iso-8859-1' }),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      };
    };
  }

  it('configuring pageParam makes the portal drivable — the SPIKE #2 mitigation is a config change', async () => {
    const recorded: RecordedRequest[] = [];
    const out = await enumerateInbox(
      { sessionState: offlineState('cfg'), ...OFFLINE, pageParam: 'pagina' },
      { transport: paginaPortal(recorded), sleep: async () => {} },
    );
    expect(out.status).toBe('complete');
    expect(out.rows).toHaveLength(2);
    expect(recorded).toHaveLength(2);
    expect(new URL(recorded[1]!.url).searchParams.get('pagina')).toBe('2');
  });

  it('…and WITHOUT it the same portal is INCOMPLETE, never a silently truncated complete', async () => {
    const out = await enumerateInbox(
      { sessionState: offlineState('cfg2'), ...OFFLINE },
      { transport: paginaPortal([]), sleep: async () => {} },
    );
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('pager-unrecognised');
  });
});

describe('citius-mandatarios-http · the pager scans are scoped, and cry-wolf is named apart (round-6 HIGH)', () => {
  /** A row whose OWN links carry page-ish parameters — ordinary inbox content, not a pager. */
  const noisyRow =
    '<tr><td><a href="Ver.aspx?page=2">1234/26.0T8LSB</a></td><td>2026-06-15</td><td>Lisboa</td>' +
    '<td>Citação</td><td><a href="Documento.aspx?docId=abc&amp;p=3">Descarregar</a></td></tr>';

  it('a page parameter inside a ROW link neither advertises a page nor causes a phantom fetch', async () => {
    const recorded: RecordedRequest[] = [];
    const out = await enumerateInbox(
      { sessionState: offlineState('h1'), ...OFFLINE },
      { transport: stubTransport(() => gridPage(noisyRow, ''), recorded), sleep: async () => {} },
    );
    expect(out.status).toBe('complete');
    expect(recorded).toHaveLength(1);           // no phantom page-2 request
    expect(out.advertisedPageCount).toBeUndefined(); // and no bogus advertised count from `&p=3`
  });

  it('a Page$ token inside a <script>, and a help link in page prose, do not block complete', async () => {
    const chrome =
      '<script type="text/javascript">var tpl = "Page$" + n; // pager template</script>' +
      '<p class="ajuda"><a href="/ajuda/paginacao.html">Como usar a página seguinte</a></p>';
    const out = await enumerateInbox(
      { sessionState: offlineState('h2'), ...OFFLINE },
      { transport: stubTransport(() => gridPage(gridRow('1234'), '') + chrome), sleep: async () => {} },
    );
    expect(out.status).toBe('complete');
  });

  it('a next-shaped control OUTSIDE the pager region is pager-ambiguous, not pager-unrecognised', async () => {
    // the pager region itself says "one page"; the next-ish control is loose page chrome
    const body = gridPage(gridRow('1234'), '<span class="cur">1</span>')
      + '<div class="toolbar"><a href="Relatorio.aspx?ver=2">Seguinte</a></div>';
    const out = await enumerateInbox(
      { sessionState: offlineState('h3'), ...OFFLINE },
      { transport: stubTransport(() => body), sleep: async () => {} },
    );
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    // fail-closed either way, but the operator can tell this apart from a real pager refusal
    expect(out.reason).toBe('pager-ambiguous');
    expect(out.rows).toHaveLength(1);
  });
});

describe('citius-mandatarios-http · the postback BODY is allowlisted (round-6 MEDIUM 1)', () => {
  it('replays only the WebForms state fields and drops everything else the page seeded', async () => {
    const seeded =
      '<input type="hidden" name="__VIEWSTATEGENERATOR" value="C2EE9ABB" />' +
      '<input type="hidden" name="__LASTFOCUS" value="" />' +
      '<input type="hidden" name="__SCROLLPOSITIONX" value="0" />' +
      '<input type="hidden" name="ctl00$cph$hdnAbrirDocumento" value="abc123" />' +
      '<input type="hidden" name="ctl00$cph$hdnComando" value="DownloadTodos" />';
    const pager = (n: number) =>
      `<a href="javascript:__doPostBack('ctl00$cph$gvNotificacoes','Page$${n}')">${n}</a>`;
    const recorded: RecordedRequest[] = [];
    const out = await enumerateInbox(
      { sessionState: offlineState('m1'), ...OFFLINE },
      {
        transport: stubTransport(
          (page) => (page === 1
            ? gridPage(gridRow('1234'), `${seeded}${pager(1)}${pager(2)}`)
            : gridPage(gridRow('5678'), `${seeded}${pager(1)}<span class="cur">2</span>`)),
          recorded,
        ),
        sleep: async () => {},
      },
    );
    expect(out.status).toBe('complete');
    expect(recorded).toHaveLength(2);
    const body = new URLSearchParams(recorded[1]!.body ?? '');
    // what a WebForms server needs, and what this module generated
    expect(body.get('__VIEWSTATE')).toBeTruthy();
    expect(body.get('__VIEWSTATEGENERATOR')).toBe('C2EE9ABB');
    expect(body.get('__EVENTVALIDATION')).toBeTruthy();
    expect(body.get('__SCROLLPOSITIONX')).toBe('0');
    expect(body.get('__EVENTTARGET')).toBe('ctl00$cph$gvNotificacoes');
    expect(body.get('__EVENTARGUMENT')).toBe('Page$2');
    // …and NOTHING the page tried to hand back to itself
    expect(body.get('ctl00$cph$hdnAbrirDocumento')).toBeNull();
    expect(body.get('ctl00$cph$hdnComando')).toBeNull();
    expect(recorded[1]!.body).not.toContain('DownloadTodos');
    // non-vacuity: the page really did offer those fields
    expect(parseHiddenFields(seeded)['ctl00$cph$hdnComando']).toBe('DownloadTodos');
  });
});

describe('citius-mandatarios-http · login detection agrees with the 401/403 decision (round-6 MEDIUM 2)', () => {
  /** A WAF challenge (SPIKE #7): a 200 the parser refuses, that happens to carry a password field. */
  const wafChallenge =
    '<!DOCTYPE html><html><head><title>Verificação</title></head><body>' +
    '<h1>A verificar o seu navegador</h1>' +
    '<form method="post" action="/_Incapsula_Resource?SWCGHOECIU=2"><input type="password" name="chk" /></form>' +
    '</body></html>';

  it('a challenge page carrying a bare password field is INCOMPLETE — it never spends a login attempt', async () => {
    expect(parseInboxPage(wafChallenge).ok).toBe(false); // the premise, pinned
    const out = await enumerateInbox(
      { sessionState: offlineState('m2'), ...OFFLINE },
      { transport: stubTransport(() => wafChallenge), sleep: async () => {} },
    );
    expect(out.status).not.toBe('session-dead');
    expect(out.status).toBe('incomplete');
    if (out.status !== 'incomplete') return;
    expect(out.reason).toBe('page-unparseable');
  });

  it('…but a password field on a form that POSTS TO AUTHENTICATION still is session-dead', async () => {
    const realLogin = wafChallenge.replace('/_Incapsula_Resource?SWCGHOECIU=2', '/portal/Login.aspx');
    expect(realLogin).not.toContain('txtUser'); // no pinned control id: the AND branch is what fires
    const out = await enumerateInbox(
      { sessionState: offlineState('m2b'), ...OFFLINE },
      { transport: stubTransport(() => realLogin), sleep: async () => {} },
    );
    expect(out.status).toBe('session-dead');
    if (out.status !== 'session-dead') return;
    expect(out.detectedBy).toBe('login-page');
  });
});

describe('citius-mandatarios-http · the small refusals (round-6 LOW)', () => {
  it('a FOREIGN error wearing the CREDENTIAL_ORIGIN_REFUSED code never echoes its message', async () => {
    const foreign = Object.assign(new Error('cookie ASP.NET_SessionId=nao-repetir rejeitada'), {
      code: 'CREDENTIAL_ORIGIN_REFUSED',
    });
    const out = await enumerateInbox(
      { sessionState: offlineState('l1'), ...OFFLINE },
      { transport: async () => { throw foreign; }, sleep: async () => {} },
    );
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.error).not.toContain('nao-repetir');
    expect(JSON.stringify(out)).not.toContain('nao-repetir');
    expect(out.error).toBe('erro de transporte (Error)');
  });

  it('a Set-Cookie whose Domain is not the request host (or a parent) is never replayed', async () => {
    const recorded: RecordedRequest[] = [];
    const transport: CitiusTransport = async (url, init) => {
      recorded.push({ url, method: init.method, cookie: init.headers.Cookie });
      const page = Number(new URL(url).searchParams.get('page') ?? '1') || 1;
      const html = page === 1
        ? gridPage(gridRow('1234'), '<a href="CaixaCorreio.aspx?page=2">2</a>')
        : gridPage(gridRow('5678'), PAGE_2_PAGER);
      const buf = Buffer.from(html, 'latin1');
      const headers = new Headers({ 'Content-Type': 'text/html; charset=iso-8859-1' });
      if (page === 1) {
        headers.append('Set-Cookie', 'intruso=nao; Domain=outro.example; path=/');
        headers.append('Set-Cookie', 'waf=sim; Domain=portal.example; path=/');
      }
      return {
        status: 200,
        ok: true,
        headers,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      };
    };
    await enumerateInbox({ sessionState: offlineState('l2'), ...OFFLINE }, { transport, sleep: async () => {} });
    expect(recorded).toHaveLength(2);
    expect(recorded[1]!.cookie).not.toContain('intruso');
    expect(recorded[1]!.cookie).toContain('waf=sim'); // non-vacuous: a legitimate rotation DID land

    // HONEST NOTE ON THIS ASSERTION: because this connector only ever requests ONE url, the
    // SEND-side matcher (`domainMatches` in `cookieHeaderFor`) already withholds that cookie, so
    // the assertion above cannot on its own prove the ABSORB-side RFC 6265 §5.3 rejection exists.
    // It is belt-and-braces — a jar entry a future multi-host change would replay — so it is pinned
    // structurally instead of pretended to be observable here.
    expect(/function absorbSetCookies[\s\S]*?\n}/.exec(MODULE_SRC)?.[0] ?? '').toMatch(/domainMatches\(host,/);
  });

  it('sends one cookie per NAME, longest path first (RFC 6265 §5.4)', async () => {
    const recorded: RecordedRequest[] = [];
    await enumerateInbox(
      {
        sessionState: {
          cookies: [
            { name: 'sess', value: 'raiz', domain: 'portal.example', path: '/' },
            { name: 'sess', value: 'especifico', domain: 'portal.example', path: '/habilus/myhabilus' },
          ],
        },
        ...OFFLINE,
      },
      { transport: stubTransport(() => loadFixture('inbox-empty.html'), recorded), sleep: async () => {} },
    );
    expect(recorded[0]!.cookie).toBe('sess=especifico');
  });

  it('a response DECLARING a length above the cap is refused before its body is read', async () => {
    let bodyRead = false;
    const out = await enumerateInbox(
      { sessionState: offlineState('l3'), ...OFFLINE },
      {
        transport: async () => ({
          status: 200,
          ok: true,
          headers: new Headers({ 'Content-Type': 'text/html', 'Content-Length': String(64 * 1024 * 1024) }),
          arrayBuffer: async () => { bodyRead = true; return new ArrayBuffer(0); },
        }),
        sleep: async () => {},
      },
    );
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.error).toContain('acima do limite');
    expect(bodyRead).toBe(false);
  });

  it('the default origin binding comes from baseUrl, so an absolute inboxPath cannot redefine it', async () => {
    const transportCalls: string[] = [];
    const out = await enumerateInbox(
      {
        sessionState: offlineState('l4', 'outra.example'),
        baseUrl: 'https://portal.example',
        inboxPath: 'https://outra.example/CaixaCorreio.aspx', // an absolute path wins the URL resolve…
        // …and NO boundOrigins, so the binding is the derived one
      },
      { transport: async (url) => { transportCalls.push(url); throw new Error('unreachable'); }, sleep: async () => {} },
    );
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.error).toContain('not a bound origin');
    expect(transportCalls).toEqual([]);
  });

  it('a redirect whose LOGIN target hides in the query string is FAILED (SPIKE #1, pinned not fixed)', async () => {
    const out = await enumerateInbox(
      { sessionState: offlineState('l5'), ...OFFLINE },
      {
        transport: stubTransport(() => ({ status: 302, location: '/?ReturnUrl=%2fLogin.aspx' })),
        sleep: async () => {},
      },
    );
    // `failed` spends nothing; `session-dead` would spend a login attempt on a pathname guess
    expect(out.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// 7. METADATA ONLY — structural
// ---------------------------------------------------------------------------

describe('citius-mandatarios-http · structural metadata-only guard', () => {
  /** Anything that would ADDRESS a document. The module cannot fetch what it cannot name. */
  const DOC_REFERENCE_RE = /document(?!ation)|docid|descarreg|download|anexo|\.pdf|abrirdoc/i;
  /** A bare `fetch(` that is not the credentialed entry point. */
  const BARE_FETCH_RE = /(?<![A-Za-z])fetch\s*\(/;
  const REQUIRE_RE = /\brequire\s*\(/;
  const DYN_IMPORT_RE = /\bimport\s*\(/;
  const XHR_RE = /\bXMLHttpRequest\b/;

  it('the module CODE never names a document, so no code path can address one', () => {
    expect(MODULE_CODE).not.toMatch(DOC_REFERENCE_RE);
    expect(MODULE_CODE).not.toMatch(/Documento\.aspx/i);
    // `documentoRef` rides through inside the opaque row type and is never read here
    expect(MODULE_CODE).not.toMatch(/documentoRef/);
  });

  it('every request goes through the injected transport seam — no bare fetch, no require/import()', () => {
    expect(MODULE_CODE).not.toMatch(BARE_FETCH_RE);
    expect(MODULE_CODE).not.toMatch(REQUIRE_RE);
    expect(MODULE_CODE).not.toMatch(DYN_IMPORT_RE);
    expect(MODULE_CODE).not.toMatch(XHR_RE);
    // …and the ONE egress primitive it may use is the credential-bound one
    expect(MODULE_CODE).toMatch(/credentialedFetch\(/);
    expect(MODULE_CODE).not.toMatch(/\bguardedFetch\b/);
  });

  it('exports exactly the reviewed surface — a new export cannot appear unnoticed', () => {
    expect(Object.keys(connector).sort()).toEqual([
      'CITIUS_INBOX_PATH',
      'CITIUS_MANDATARIOS_BASE_URL',
      'CITIUS_MANDATARIOS_HOST',
      'enumerateInbox',
    ]);
    for (const [name, value] of Object.entries(connector)) {
      expect(name).not.toMatch(DOC_REFERENCE_RE);
      if (typeof value === 'function') expect(name).toBe('enumerateInbox');
    }
    expect(CITIUS_MANDATARIOS_HOST).toBe('citius.tribunaisnet.mj.pt');
    expect(CITIUS_INBOX_PATH).toContain('CaixaCorreio');
  });

  it('those guard matchers actually FIRE on planted violations (non-tautological)', () => {
    expect('const bytes = await fetch(row.documentoRef);').toMatch(BARE_FETCH_RE);
    expect('export async function abrirDocumento(ref: string) {}').toMatch(DOC_REFERENCE_RE);
    expect('const u = new URL(row.documentoRef, base);').toMatch(DOC_REFERENCE_RE);
    expect("const doc = 'Documento.aspx?docId=' + id;").toMatch(/Documento\.aspx/i);
    expect('const x = require("node:https");').toMatch(REQUIRE_RE);
    expect('const m = await import("node:https");').toMatch(DYN_IMPORT_RE);
    // and the allowlist assertion is not vacuous: it names a real, callable function
    expect(typeof connector.enumerateInbox).toBe('function');
  });

  it('never emits a field named pageTotal (the CS3 item-total trap)', async () => {
    const { state } = await establishSession();
    mock.scenario({ cmd: 'addItems', count: 3 });
    const out = await enumerateAgainstMock(state);
    expect(out).not.toHaveProperty('pageTotal');
    expect(out.advertisedPageCount).toBe(3); // a PAGE count, and named like one
    expect(JSON.stringify(out)).not.toContain('pageTotal');
  });

  it('the CS6 wiring contract names every collision across the seam, so CS6 cannot re-open one', () => {
    // The reviewer independently confirmed the `pageTotal` hazard and the mitigation; these are the
    // instructions that have to SURVIVE into CS6, and the docblock is where CS6 will read them.
    const contract = MODULE_SRC.slice(
      MODULE_SRC.indexOf('CS6 WIRING CONTRACT'),
      MODULE_SRC.indexOf('FIRST-REAL-ACCOUNT SPIKE'),
    );
    expect(contract.length).toBeGreaterThan(500); // the slice really landed on the contract
    expect(contract).toMatch(/MUST OMIT CS3's `pageTotal`\s*\n?\s*\*?\s*ENTIRELY/);
    expect(contract).toMatch(/NOT SYNTHESISE ONE FROM `rows\.length`/);
    expect(contract).toMatch(/`pages` HERE is `CitiusPageOutcome\[\]`/);
    expect(contract).toMatch(/`EnumerateResult\.result\.pages` upstream is a NUMBER/);
    expect(contract).toMatch(/MUST\s*\n?\s*\*?\s*FORWARD the window's bound/);
  });
});

// ---------------------------------------------------------------------------
// a minimal notifications grid, in the same latin1 WebForms shape as the fixtures
// ---------------------------------------------------------------------------

function gridPage(rowsHtml: string, pagerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" /><title>Caixa</title></head>
<body>
  <form name="aspnetForm" method="post" action="./CaixaCorreio.aspx" id="aspnetForm">
    <input type="hidden" name="__VIEWSTATE" value="/wEPDwUKMTk4NzY1NDMyMA9kFgJmD2QWAgIBD2QWAg" />
    <input type="hidden" name="__EVENTVALIDATION" value="/wEdAAQb1aXg" />
    <input type="hidden" name="__EVENTTARGET" value="" />
    <input type="hidden" name="__EVENTARGUMENT" value="" />
    <table id="ctl00_cph_gvNotificacoes" class="rgMasterTable">
      <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>
${rowsHtml}
    </table>
    <div class="pager">${pagerHtml}</div>
  </form>
</body>
</html>`;
}
