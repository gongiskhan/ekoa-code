/**
 * CS2 — smoke test for the mock Caixa Citius WebForms server. Proves the mock behaves like the
 * real portal WOULD (WebForms hidden state, WAF + session cookies, session-expired redirect,
 * both pager idioms) and — the load-bearing point — that its inbox HTML parses CLEANLY with CS1's
 * `parseInboxPage`, and that Documento.aspx hits are COUNTED (so CS6's metadata-only test can
 * assert the count stays 0). Pages are decoded with the real charset path (`decodeHtml`), exactly
 * as the CS1 fixture tests do.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { decodeHtml, parseHiddenFields } from '../../src/legal/portal-html.js';
import { parseInboxPage } from '../../src/legal/citius-mandatarios.js';
import { startMockCitius } from './mock-citius-webforms-server.mjs';

let mock: Awaited<ReturnType<typeof startMockCitius>>;

/** Fetch a page and decode it via the real ISO-8859-1 charset path (like CS1's `load`). */
async function getPage(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ res: Response; html: string }> {
  const res = await fetch(url, { headers, redirect: 'manual' });
  const ct = res.headers.get('content-type') ?? '';
  const html = decodeHtml(Buffer.from(await res.arrayBuffer()), ct);
  return { res, html };
}

/** POST the login form with the given fields (form-urlencoded, as WebForms does). */
async function postLogin(fields: Record<string, string>): Promise<Response> {
  return fetch(`${mock.baseUrl}${mock.loginPath}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
}

/** GET the inbox at page 1 with the session cookie and parse it; returns the parsed row count. */
async function enumerateRowCount(cookie: string): Promise<number> {
  const { html } = await getPage(`${mock.baseUrl}${mock.inboxPath}?page=1`, { Cookie: cookie });
  const parsed = parseInboxPage(html);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return -1;
  return parsed.rows.length;
}

beforeAll(async () => {
  mock = await startMockCitius();
});

afterAll(async () => {
  await mock.close();
});

describe('mock-citius · login page (GET)', () => {
  it('serves a 200 login form with the three selectors and the WebForms hidden state', async () => {
    const { res, html } = await getPage(`${mock.baseUrl}${mock.loginPath}`);
    expect(res.status).toBe(200);

    // the three login selectors CS1 pins
    expect(html).toContain('id="txtUserName"');
    expect(html).toContain('id="txtUserPass"');
    expect(html).toContain('id="ImBtnLogin"');

    // the hidden state parses with the CS1 extractor
    const hidden = parseHiddenFields(html);
    expect(hidden.__VIEWSTATE).toBeTruthy();
    expect(hidden.__VIEWSTATEGENERATOR).toBeTruthy();
    expect(hidden.__EVENTVALIDATION).toBeTruthy();

    // a WAF-style cookie is set on the login GET
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('visid_incap'))).toBe(true);
  });
});

describe('mock-citius · login (POST)', () => {
  it('POST without hidden state re-renders the login (auth failed), HTTP 200 — not a redirect', async () => {
    const res = await postLogin({ 'ctl00$cph$txtUserName': 'adv', 'ctl00$cph$txtUserPass': 'pw' });
    expect(res.status).toBe(200);
    const html = decodeHtml(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type') ?? '');
    expect(html).toContain('id="txtUserName"'); // re-rendered login form
    expect(res.headers.getSetCookie().some((c) => c.startsWith('ASP.NET_SessionId'))).toBe(false);
  });

  it('POST with hidden state + credentials sets an HttpOnly session cookie and 302s to the inbox', async () => {
    const { html: loginHtmlText } = await getPage(`${mock.baseUrl}${mock.loginPath}`);
    const hidden = parseHiddenFields(loginHtmlText);
    const res = await postLogin({
      __VIEWSTATE: hidden.__VIEWSTATE!,
      __VIEWSTATEGENERATOR: hidden.__VIEWSTATEGENERATOR!,
      __EVENTVALIDATION: hidden.__EVENTVALIDATION!,
      'ctl00$cph$txtUserName': 'advogado',
      'ctl00$cph$txtUserPass': 'segredo',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(mock.inboxPath);
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith('ASP.NET_SessionId'));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.toLowerCase()).toContain('httponly');
    expect(sessionCookie!.toLowerCase()).not.toContain('expires'); // session cookie, no Expires
  });
});

describe('mock-citius · inbox session + parseInboxPage', () => {
  it('no session cookie → 302 back to login (session-expired behaviour)', async () => {
    const { res } = await getPage(`${mock.baseUrl}${mock.inboxPath}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(mock.loginPath);
  });

  it('with the session cookie the inbox parses cleanly with CS1 parseInboxPage (seeded rows)', async () => {
    const cookie = await loginAndGetCookie();
    const { res, html } = await getPage(`${mock.baseUrl}${mock.inboxPath}`, { Cookie: cookie });
    expect(res.status).toBe(200);

    const parsed = parseInboxPage(html);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.length).toBe(2); // the two default seeded rows

    // metadata parsed correctly, including a latin1 accent and an inert documentoRef
    expect(parsed.rows[0]).toMatchObject({
      processo: '1234/26.0T8LSB',
      data: '2026-06-15',
      ato: 'Citação',
      temDocumento: true,
    });
    expect(parsed.rows[0]!.documentoRef).toBe('Documento.aspx?docId=abc123&t=not');
    expect(parsed.rows[1]).toMatchObject({ processo: '5678/26.1T8PRT', temDocumento: false });
  });
});

describe('mock-citius · hideUntilPass2 (a pass-1 miss reconciliation must catch)', () => {
  it('a hidden row is absent on the next enumeration and present on the one after', async () => {
    const cookie = await loginAndGetCookie();

    // deterministic scenario: 2 seeded + 3 added = 5 rows, then hide the last one for the next pass
    mock.scenario({ cmd: 'reset' });
    mock.scenario({ cmd: 'addItems', count: 3 });
    mock.scenario({ cmd: 'hideUntilPass2' });

    const pass1 = await enumerateRowCount(cookie); // first enumeration → hidden row withheld
    const pass2 = await enumerateRowCount(cookie); // second enumeration → hidden row revealed

    expect(pass1).toBe(4);
    expect(pass2).toBe(5);
  });
});

describe('mock-citius · Documento.aspx hit counter (proves CS6 can assert it stays 0)', () => {
  it('a document fetch increments the counter', async () => {
    const before = mock.getDocumentHits();
    const res = await fetch(`${mock.baseUrl}${mock.documentPath}?docId=abc123`);
    expect(res.status).toBe(200);
    await res.arrayBuffer(); // drain
    expect(mock.getDocumentHits()).toBe(before + 1);
  });
});

/** Log in for real over the socket and return the `ASP.NET_SessionId=...` cookie string. */
async function loginAndGetCookie(): Promise<string> {
  const { html } = await getPage(`${mock.baseUrl}${mock.loginPath}`);
  const hidden = parseHiddenFields(html);
  const res = await postLogin({
    __VIEWSTATE: hidden.__VIEWSTATE!,
    __VIEWSTATEGENERATOR: hidden.__VIEWSTATEGENERATOR!,
    __EVENTVALIDATION: hidden.__EVENTVALIDATION!,
    'ctl00$cph$txtUserName': 'advogado',
    'ctl00$cph$txtUserPass': 'segredo',
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('ASP.NET_SessionId'));
  return setCookie ? setCookie.split(';')[0]! : '';
}
