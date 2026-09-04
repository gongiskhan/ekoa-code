/**
 * Reusable server-side form-login capability (api/src/integrations/form-login.ts) + its two shared
 * primitives (services/cookie-jar.ts, services/portal-forms.ts).
 *
 * The end-to-end leg drives the in-process mock ASP.NET WebForms portal (the same helper the CITIUS
 * sync suites use) over a real socket — GET login page, echo __VIEWSTATE/__EVENTVALIDATION, POST
 * username/password, capture the session Set-Cookie off the 302, fetch the authed inbox — with NO
 * real account. The origin binding is asserted by the runner itself; the loopback transport only
 * stands in for the SSRF-guarded production transport (which would refuse 127.0.0.1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performFormLogin, type FormLoginDescriptor, type ManualFetch } from '../../src/integrations/form-login.js';
import { CookieJar } from '../../src/services/cookie-jar.js';
import { parseHiddenInputs, parseFormAction, looksLikeLoginForm, parseAspNetGridRows } from '../../src/services/portal-forms.js';
import { secretRegistryFromValues } from '../../src/security/redaction.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockCitius } from '../helpers/mock-citius-webforms-server.mjs';

// A loopback transport: plain fetch with redirect:'manual' so the runner sees each 3xx + Set-Cookie.
// It intentionally skips the SSRF guard (which blocks 127.0.0.1); the runner still asserts the
// origin binding before every call, so this cannot reach a host outside allowedOrigins.
const loopback: ManualFetch = (url, opts) =>
  fetch(url, { method: opts.method, headers: opts.headers, body: opts.body, redirect: 'manual' });

let mock: Awaited<ReturnType<typeof startMockCitius>>;

beforeAll(async () => {
  mock = await startMockCitius();
});
afterAll(async () => {
  await mock.close();
});

function citiusDescriptor(): FormLoginDescriptor {
  return {
    loginUrl: `${mock.baseUrl}/habilus/myhabilus/login.aspx`,
    usernameField: 'ctl00$cph$txtUserName',
    passwordField: 'ctl00$cph$txtUserPass',
    submitField: 'ctl00$cph$ImBtnLogin',
    submitKind: 'image',
    successUrlContains: 'CaixaCorreio.aspx',
    failureBodyContains: 'Autenticação falhou',
    targetUrl: `${mock.baseUrl}/habilus/myhabilus/CaixaCorreio.aspx`,
    targetLoginRedirectContains: 'login.aspx',
  };
}

describe('performFormLogin against a real ASP.NET WebForms portal (mock)', () => {
  it('logs in, captures the session cookie, and reads the authenticated inbox', async () => {
    mock.scenario({ cmd: 'reset' });
    mock.scenario({ cmd: 'addItems', count: 3 });
    const result = await performFormLogin(
      citiusDescriptor(),
      { username: '51934', password: 'demo-passphrase' },
      { allowedOrigins: ['127.0.0.1'], fetchManual: loopback, credentialLabel: 'sessão Citius (teste)' },
    );

    expect(result.status).toBe('authenticated');
    expect(result.ok).toBe(true);
    // The HttpOnly session cookie the portal set on the 302 was captured into the jar.
    expect(result.cookies.some((c) => c.name === 'ASP.NET_SessionId')).toBe(true);
    // The WAF cookie set on the GET was carried forward too (proves the jar spans the whole flow).
    expect(result.cookies.some((c) => c.name === 'visid_incap_citius')).toBe(true);
    // The authenticated inbox HTML came back (not the login page).
    expect(result.targetStatus).toBe(200);
    expect(result.targetHtml ?? '').toMatch(/Processo/i);
    expect(looksLikeLoginForm(result.targetHtml ?? '')).toBe(false);
  });

  it('never leaks the password into any returned field', async () => {
    mock.scenario({ cmd: 'reset' });
    const password = 'S3cret-Palavra-Passe!';
    const result = await performFormLogin(
      citiusDescriptor(),
      { username: '51934', password },
      { allowedOrigins: ['127.0.0.1'], fetchManual: loopback },
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it('classifies a rejected login as auth-failed, does not retry, and returns no session', async () => {
    mock.scenario({ cmd: 'reset' });
    let posts = 0;
    const counting: ManualFetch = (url, opts) => {
      if (opts.method === 'POST') posts += 1;
      return loopback(url, opts);
    };
    // An empty password → the mock re-renders the login form (HTTP 200) = auth failed.
    const result = await performFormLogin(
      citiusDescriptor(),
      { username: '51934', password: '' },
      { allowedOrigins: ['127.0.0.1'], fetchManual: counting },
    );
    expect(result.status).toBe('auth-failed');
    expect(result.ok).toBe(false);
    expect(result.cookies).toHaveLength(0);
    expect(posts).toBe(1); // AT MOST ONCE: exactly one credential POST, no retry
  });

  it('refuses a login whose URL is outside the declared origin binding', async () => {
    const d = citiusDescriptor();
    await expect(
      performFormLogin(
        d,
        { username: 'x', password: 'yyy' },
        { allowedOrigins: ['example.org'], fetchManual: loopback }, // 127.0.0.1 not bound
      ),
    ).rejects.toThrow(/bound origin|not a bound origin/i);
  });

  it('does not egress at all when the caller passes an empty binding', async () => {
    const d = citiusDescriptor();
    await expect(
      performFormLogin(d, { username: 'x', password: 'yyy' }, { allowedOrigins: [], fetchManual: loopback }),
    ).rejects.toThrow(/bound origin/i);
  });
});

describe('CookieJar (origin-scoped, credential-safe)', () => {
  it('carries a Set-Cookie from one request to a same-host request, path- and secure-scoped', () => {
    const jar = new CookieJar();
    jar.absorbOne('sid=abc; path=/app; Secure; HttpOnly', 'https://portal.example/app/login');
    // in scope: https + host + path
    expect(jar.header('https://portal.example/app/inbox')).toBe('sid=abc');
    // out of path
    expect(jar.header('https://portal.example/other')).toBe('');
    // Secure cookie withheld from http
    expect(jar.header('http://portal.example/app/inbox')).toBe('');
    // different host
    expect(jar.header('https://other.example/app')).toBe('');
  });

  it('honours a Domain only when the setting host is within it, never a forged wider domain', () => {
    const jar = new CookieJar();
    // legit: set on sub.example with Domain=example → sent to example subtree
    jar.absorbOne('a=1; Domain=example.com; path=/', 'https://sub.example.com/x');
    expect(jar.header('https://www.example.com/y')).toBe('a=1');
    // forged: evil.test tries to set Domain=example.com → rejected (host not within the domain)
    jar.absorbOne('b=2; Domain=example.com; path=/', 'https://evil.test/x');
    expect(jar.header('https://www.example.com/y')).toBe('a=1'); // b never stored
  });

  it('deletes a cookie on an expired Set-Cookie', () => {
    const jar = new CookieJar();
    jar.absorbOne('sid=abc; path=/', 'https://portal.example/');
    expect(jar.header('https://portal.example/')).toBe('sid=abc');
    jar.absorbOne('sid=; path=/; Max-Age=0', 'https://portal.example/');
    expect(jar.header('https://portal.example/')).toBe('');
  });
});

describe('portal-forms (login-page parsing)', () => {
  const html = `
    <form name="aspnetForm" method="post" action="./login.aspx" id="aspnetForm">
      <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="ab&amp;cd" />
      <input value="GEN" type="hidden" name="__VIEWSTATEGENERATOR" />
      <input type='hidden' name='__EVENTVALIDATION' value='ev123' />
      <input type="text" name="ctl00$cph$txtUserName" />
      <input type="password" name="ctl00$cph$txtUserPass" />
    </form>`;

  it('extracts every hidden input, entity-decoded, across quote styles and attribute order', () => {
    const hidden = parseHiddenInputs(html);
    expect(hidden['__VIEWSTATE']).toBe('ab&cd');
    expect(hidden['__VIEWSTATEGENERATOR']).toBe('GEN');
    expect(hidden['__EVENTVALIDATION']).toBe('ev123');
    // non-hidden inputs are not collected
    expect(hidden['ctl00$cph$txtUserName']).toBeUndefined();
  });

  it('reads the form action and detects a login page', () => {
    expect(parseFormAction(html)).toBe('./login.aspx');
    expect(looksLikeLoginForm(html)).toBe(true);
    expect(looksLikeLoginForm('<html><body>Bem-vindo à sua caixa</body></html>')).toBe(false);
  });
});

describe('parseAspNetGridRows (declarative ASP.NET DataGrid extraction)', () => {
  // Shaped after the real CITIUS NotCitIndex.aspx dgNotificacoes DataGrid: header rows carry no named
  // cell controls; data rows are ctlNN with per-cell control ids <grid>_ctlNN_<FieldSuffix>.
  const G = 'ctl00_ctl00_Conteudo_cpHabilus_dgNotificacoes';
  const cell = (ctl: string, suffix: string, value: string, tag = 'span') =>
    `<td><${tag} id="${G}_${ctl}_${suffix}">${value}</${tag}></td>`;
  const dataRow = (ctl: string, o: Record<string, string>) =>
    `<tr><td><input id="chkSelection" type="checkbox" /></td>` +
    cell(ctl, 'lblOrigem', o.origem) + cell(ctl, 'DataElaboracao', o.data) + cell(ctl, 'NomeActo', o.ato) +
    cell(ctl, 'lnkDoc', o.documento, 'a') + cell(ctl, 'NomeTribunal', o.tribunal) +
    cell(ctl, 'DescricaoUnidadeOrganica', o.unidade) + cell(ctl, 'DescricaoEspecie', o.especie) + `</tr>`;
  const grid = `<table id="${G}">
    <tr align="center"><td>Origem</td><td>Data</td><td>Acto</td></tr>
    ${dataRow('ctl02', { origem: 'Tribunal Judicial da Comarca', data: '01-09-2026', ato: 'Cita&ccedil;&atilde;o', documento: 'peticao.pdf', tribunal: 'Ju&iacute;zo Central C&iacute;vel', unidade: 'Unidade 1', especie: 'A&ccedil;&atilde;o comum' })}
    ${dataRow('ctl03', { origem: 'Tribunal X', data: '28-08-2026', ato: 'Notifica&ccedil;&atilde;o', documento: 'despacho.pdf', tribunal: 'Ju&iacute;zo Local', unidade: 'Unidade 2', especie: 'Execu&ccedil;&atilde;o' })}
  </table>`;
  const FIELDS = { ato: 'NomeActo', data: 'DataElaboracao', tribunal: 'NomeTribunal', unidade: 'DescricaoUnidadeOrganica', especie: 'DescricaoEspecie', origem: 'lblOrigem', documento: 'lnkDoc' };

  it('extracts one object per data row with the declared fields, entity-decoded, in order', () => {
    const rows = parseAspNetGridRows(grid, 'dgNotificacoes', FIELDS);
    expect(rows).toHaveLength(2); // header row excluded (no named cell controls)
    expect(rows[0]).toMatchObject({ _row: '02', ato: 'Citação', data: '01-09-2026', tribunal: 'Juízo Central Cível', documento: 'peticao.pdf', especie: 'Ação comum' });
    expect(rows[1]).toMatchObject({ _row: '03', ato: 'Notificação', documento: 'despacho.pdf' });
  });

  it('returns no rows when the grid is absent', () => {
    expect(parseAspNetGridRows('<html><body>no grid here</body></html>', 'dgNotificacoes', FIELDS)).toHaveLength(0);
  });
});
