/**
 * Mock Caixa Citius (área de MANDATÁRIOS) — an ASP.NET WebForms server (node:http).
 *
 * Stands in for the authenticated mandatários portal so the read-only sync half (CS4) and the
 * assembled sync+reconciliation (CS6) can be exercised over a real socket, without a real account
 * and without touching the live portal. Every page is served as genuine ISO-8859-1 (latin1)
 * bytes with a `charset=iso-8859-1` header, matching how the real portal serves them, so the
 * charset-decode path (`portal-html.decodeHtml`) is exercised for real. The inbox HTML is shaped
 * to parse CLEANLY with CS1's `parseInboxPage` (same column headers Processo/Data/Tribunal/Ato/
 * Documento, same GET `?page=N` and `__doPostBack('...','Page$N')` pager idioms).
 *
 * SPECULATIVE BY CONSTRUCTION, exactly like the CS1 fixtures it mirrors: the authenticated
 * mandatários inbox HTML has never been observed. This mock encodes the SAME guesses the fixtures
 * do (WebForms hidden state, WAF-style cookie, session cookie, pager modes) so the first real
 * snapshot needs a fixture/mock tweak, not a rewrite.
 *
 * READ-ONLY / METADATA-ONLY, the invariant this mock exists to PROVE:
 *   The sync fetches notification METADATA ONLY and NEVER opens a document. Documento.aspx hits
 *   are COUNTED (`getDocumentHits()` / `GET /__stats`) precisely so a metadata-only test (CS6)
 *   can assert the count stays ZERO after a full sync + reconciliation. This helper never asserts
 *   it itself — it only makes the count observable.
 *
 * Endpoints:
 *   GET  /habilus/myhabilus/login.aspx          → login form (WebForms hidden state + the three
 *                                                 login selectors), sets a WAF-style cookie.
 *   POST /habilus/myhabilus/login.aspx          → validate hidden state + txtUserName/txtUserPass;
 *                                                 success → HttpOnly session cookie + 302 to inbox;
 *                                                 missing state/creds → 200 re-render (auth failed).
 *   GET  /habilus/myhabilus/CaixaCorreio.aspx   → inbox page (?page=N). No/invalid session cookie
 *                                                 → 302 back to login (session-expired behaviour).
 *   POST /habilus/myhabilus/CaixaCorreio.aspx   → __doPostBack pager navigation (__EVENTARGUMENT
 *                                                 = 'Page$N'); same session requirement.
 *   GET  /habilus/myhabilus/Documento.aspx      → COUNTS a document hit (the thing sync must never
 *                                                 do), returns a tiny stub body.
 *   POST /__scenario                            → test control (JSON): addItems | hideUntilPass2 |
 *                                                 expireSession | reset | setPaging.
 *   GET  /__stats                               → JSON { documentHits, enumerationPass, itemCount,
 *                                                 paging }.
 *
 * Usage:
 *   import { startMockCitius } from './helpers/mock-citius-webforms-server.mjs';
 *   const mock = await startMockCitius();          // { server, port, baseUrl, close, ... }
 *   // GET  `${mock.baseUrl}/habilus/myhabilus/login.aspx`
 *   mock.scenario({ cmd: 'addItems', count: 3 });  // in-process test control
 *   mock.getDocumentHits();                         // 0 after a metadata-only sync
 *   await mock.close();
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const BASE = '/habilus/myhabilus';
const LOGIN_PATH = `${BASE}/login.aspx`;
const INBOX_PATH = `${BASE}/CaixaCorreio.aspx`;
const DOC_PATH = `${BASE}/Documento.aspx`;

// Canned WebForms hidden state (base64-ish tokens; ASCII, so charset-agnostic). A real WebForms
// POST must echo these back verbatim — CS4's authenticated replay re-POSTs exactly this map.
const VIEWSTATE = '/wEPDwUKLTM2Mjc0Mzk1Ng9kFgICAw9kFgICAQ8PZBYCHgtvbmtleXByZXNz';
const VIEWSTATEGENERATOR = 'C2EE9ABB';
const EVENTVALIDATION = '/wEdAAd8Kx1sQ2p9Xg==';

const DOPOSTBACK_SCRIPT = `  <script type="text/javascript">
  function __doPostBack(eventTarget, eventArgument) {
    var theForm = document.forms['aspnetForm'];
    theForm.__EVENTTARGET.value = eventTarget;
    theForm.__EVENTARGUMENT.value = eventArgument;
    theForm.submit();
  }
  </script>`;

/** Read a request body as a raw string (form-urlencoded login/postback, or JSON scenario). */
function readRaw(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

/** Send an ISO-8859-1 HTML body. Portuguese accents are all within Latin-1, so the JS string's
 *  code points map 1:1 to latin1 bytes — the real charset-decode path then reads them back. */
function sendHtml(res, status, html, extraHeaders = {}) {
  const buf = Buffer.from(html, 'latin1');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=iso-8859-1',
    'Content-Length': buf.length,
    ...extraHeaders,
  });
  res.end(buf);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

// --- HTML builders -------------------------------------------------------------------------

function loginHtml(authFailed) {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />
  <title>Citius - Área de Mandatários :: Autenticação</title>
  <!-- SYNTHETIC WAF fronting layer (Incapsula/BIG-IP style challenge stub) -->
  <script type="text/javascript">var ___utmvc = 'synthetic-waf-token'; /* WAF challenge cookie stub */</script>
</head>
<body>
  <form name="aspnetForm" method="post" action="./login.aspx" id="aspnetForm">
    <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${VIEWSTATE}" />
    <input value="${VIEWSTATEGENERATOR}" type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" />
    <input type='hidden' name='__EVENTVALIDATION' id='__EVENTVALIDATION' value='${EVENTVALIDATION}' />
    <input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="" />
    <input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value="" />
    <div class="loginPanel">
      <h1>Área reservada a mandatários</h1>
      ${authFailed ? '<p class="err">Autenticação falhou. Verifique as credenciais.</p>' : ''}
      <label for="txtUserName">Utilizador (n.º de cédula)</label>
      <input type="text" name="ctl00$cph$txtUserName" id="txtUserName" />
      <label for="txtUserPass">Palavra-passe</label>
      <input type="password" name="ctl00$cph$txtUserPass" id="txtUserPass" />
      <input type="image" name="ctl00$cph$ImBtnLogin" id="ImBtnLogin" src="btnEntrar.gif" alt="Entrar" />
    </div>
  </form>
</body>
</html>`;
}

function pagerHtml(page, totalPages, paging) {
  if (totalPages < 1) return '';
  const links = [];
  for (let n = 1; n <= totalPages; n++) {
    const href = paging === 'postback'
      ? `javascript:__doPostBack('ctl00$cph$gvNotificacoes','Page$${n}')`
      : `CaixaCorreio.aspx?page=${n}`;
    const label = n === page ? `<span class="cur">${n}</span>` : `<a href="${href}">${n}</a>`;
    links.push(label);
  }
  return `    <div class="pager">
      <span>Páginas:</span>
      ${links.join('\n      ')}
    </div>`;
}

function inboxRowHtml(it, cls) {
  const docCell = it.temDocumento
    ? `<td><a href="Documento.aspx?docId=${it.docId}&amp;t=not">Descarregar</a></td>`
    : '<td>&nbsp;</td>';
  return `      <tr class="${cls}">
        <td>${it.processo}</td>
        <td>${it.data}</td>
        <td>${it.tribunal}</td>
        <td>${it.ato}</td>
        ${docCell}
      </tr>`;
}

function inboxHtml({ pageItems, page, totalPages, paging }) {
  const body = pageItems.length
    ? pageItems.map((it, i) => inboxRowHtml(it, i % 2 === 0 ? 'rgRow' : 'rgAltRow')).join('\n')
    : '      <tr class="rgEmpty"><td colspan="5">Não existem notificações na caixa de correio.</td></tr>';
  // The __doPostBack function definition ships on every WebForms page; parseInboxPage only reads
  // it as a pager when an ANCHOR invokes it (postback mode below), so a GET-paged page stays 'get'.
  const script = paging === 'postback' ? DOPOSTBACK_SCRIPT : '';
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />
  <title>Citius - Caixa de Correio (Mandatários)</title>
${script}
</head>
<body>
  <form name="aspnetForm" method="post" action="./CaixaCorreio.aspx" id="aspnetForm">
    <input type="hidden" name="__VIEWSTATE" value="${VIEWSTATE}" />
    <input type="hidden" name="__EVENTVALIDATION" value="${EVENTVALIDATION}" />
    <input type="hidden" name="__EVENTTARGET" value="" />
    <input type="hidden" name="__EVENTARGUMENT" value="" />
    <h1>Caixa de correio &ndash; Notificações</h1>
    <table id="ctl00_cph_gvNotificacoes" class="rgMasterTable">
      <tr>
        <th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th>
      </tr>
${body}
    </table>
${pagerHtml(page, totalPages, paging)}
  </form>
</body>
</html>`;
}

// --- factory -------------------------------------------------------------------------------

/**
 * Start the mock. Async, resolves to the handle below (mirrors mock-pipedream-server's factory).
 *
 * opts:
 *   port       {number}  listen port (default 0 → ephemeral).
 *   pageSize   {number}  inbox rows per page (default 25).
 *   paging     {string}  'get' (default) | 'postback' — which pager markup the inbox renders.
 *   seed       {Array}   initial notifications (default: two sample rows, one with a document).
 *
 * @returns {Promise<{
 *   server: import('node:http').Server,
 *   port: number,
 *   baseUrl: string,          // e.g. http://127.0.0.1:54123 (no trailing slash)
 *   close: () => Promise<void>,
 *   getDocumentHits: () => number,
 *   scenario: (cmd: object) => object,   // in-process twin of POST /__scenario; returns stats
 *   loginPath: string, inboxPath: string, documentPath: string,
 * }>}
 */
export async function startMockCitius(opts = {}) {
  const pageSize = opts.pageSize ?? 25;
  let paging = opts.paging === 'postback' ? 'postback' : 'get';

  let itemSeq = 0;
  let documentHits = 0;
  let enumerationPass = 0;      // bumped at the START of each enumeration (a page-1 fetch)
  const validSessions = new Set();

  function normalizeItem(it) {
    return {
      processo: it.processo ?? '',
      data: it.data ?? '',
      tribunal: it.tribunal ?? '',
      ato: it.ato ?? '',
      temDocumento: it.temDocumento ?? Boolean(it.docId),
      docId: it.docId ?? null,
      hideOnPass: null,         // when === current enumerationPass, the row is withheld that pass
    };
  }

  function makeItem() {
    itemSeq += 1;
    const n = itemSeq;
    const hasDoc = n % 2 === 1;
    return normalizeItem({
      processo: `${1000 + n}/26.${n % 10}T8GEN`,
      data: `2026-07-${String((n % 27) + 1).padStart(2, '0')}`,
      tribunal: `Tribunal Judicial da Comarca ${n}`,
      ato: hasDoc ? 'Citação' : 'Notificação',
      temDocumento: hasDoc,
      docId: hasDoc ? `gen${n}` : null,
    });
  }

  function seedItems() {
    if (Array.isArray(opts.seed)) return opts.seed.map(normalizeItem);
    return [
      normalizeItem({ processo: '1234/26.0T8LSB', data: '2026-06-15', tribunal: 'Tribunal Judicial da Comarca de Lisboa', ato: 'Citação', temDocumento: true, docId: 'abc123' }),
      normalizeItem({ processo: '5678/26.1T8PRT', data: '2026-06-16', tribunal: 'Tribunal Judicial da Comarca do Porto', ato: 'Notificação', temDocumento: false, docId: null }),
    ];
  }

  let items = seedItems();

  function stats() {
    return { documentHits, enumerationPass, itemCount: items.length, paging };
  }

  /** Apply a scenario command. Shared by POST /__scenario and the in-process `scenario()`. */
  function applyScenario(cmd) {
    const c = cmd || {};
    switch (c.cmd) {
      case 'addItems': {
        if (Array.isArray(c.items)) {
          for (const it of c.items) items.push(normalizeItem(it));
        } else {
          const n = Number(c.count ?? 1);
          for (let i = 0; i < n; i++) items.push(makeItem());
        }
        return stats();
      }
      case 'hideUntilPass2': {
        // Mark a row hidden on the NEXT enumeration pass only, then visible — simulating a pass-1
        // miss the reconciliation must catch. hideOnPass is set one pass ahead of the current one,
        // so the very next page-1 fetch (which bumps enumerationPass to match) withholds it and the
        // pass after that reveals it. Targets the given index, or the last row by default.
        const idx = Number.isInteger(c.index) ? c.index : items.length - 1;
        const it = items[idx];
        if (it) it.hideOnPass = enumerationPass + 1;
        return stats();
      }
      case 'expireSession': {
        validSessions.clear();
        return stats();
      }
      case 'setPaging': {
        paging = c.paging === 'postback' ? 'postback' : 'get';
        return stats();
      }
      case 'reset': {
        items = seedItems();
        documentHits = 0;
        enumerationPass = 0;
        itemSeq = 0;
        return stats();
      }
      default:
        return { error: 'unknown scenario', cmd: c.cmd, ...stats() };
    }
  }

  function sessionToken(req) {
    const raw = req.headers.cookie || '';
    const m = /(?:^|;\s*)ASP\.NET_SessionId=([^;]+)/.exec(raw);
    return m ? m[1] : null;
  }
  function authed(req) {
    const t = sessionToken(req);
    return Boolean(t) && validSessions.has(t);
  }

  /** Rows visible on the CURRENT enumeration pass (a hideUntilPass2 row is withheld this pass). */
  function visibleItems() {
    return items.filter((it) => it.hideOnPass !== enumerationPass);
  }

  function renderInbox(res, page) {
    // A page-1 fetch is the start of an enumeration → bump the pass counter, then compute
    // visibility against the new pass (so a hideUntilPass2 row is withheld for exactly this walk).
    if (page === 1) enumerationPass += 1;
    const visible = visibleItems();
    const totalPages = Math.ceil(visible.length / pageSize); // 0 when the inbox is empty
    const clampedPage = Math.min(Math.max(page, 1), Math.max(totalPages, 1));
    const start = (clampedPage - 1) * pageSize;
    const pageItems = visible.slice(start, start + pageSize);
    sendHtml(res, 200, inboxHtml({ pageItems, page: clampedPage, totalPages, paging }));
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const lower = path.toLowerCase();

    // ---- test control -----------------------------------------------------------------------
    if (req.method === 'POST' && path === '/__scenario') {
      const raw = await readRaw(req);
      let cmd;
      try { cmd = raw ? JSON.parse(raw) : {}; } catch { cmd = {}; }
      sendJson(res, 200, applyScenario(cmd));
      return;
    }
    if (req.method === 'GET' && path === '/__stats') {
      sendJson(res, 200, stats());
      return;
    }

    // ---- login ------------------------------------------------------------------------------
    if (lower === LOGIN_PATH.toLowerCase()) {
      if (req.method === 'GET') {
        // Set a WAF-style cookie (Incapsula idiom): not HttpOnly, as the real fronting layer does.
        const waf = `visid_incap_citius=${randomBytes(12).toString('hex')}; path=/`;
        sendHtml(res, 200, loginHtml(false), { 'Set-Cookie': waf });
        return;
      }
      if (req.method === 'POST') {
        const raw = await readRaw(req);
        const params = new URLSearchParams(raw);
        const hasField = (suffix) =>
          [...params.keys()].some((k) => k.endsWith(suffix) && (params.get(k) ?? '') !== '');
        const okState = Boolean(params.get('__VIEWSTATE')) && Boolean(params.get('__EVENTVALIDATION'));
        const okCreds = hasField('txtUserName') && hasField('txtUserPass');
        if (okState && okCreds) {
          const token = randomBytes(16).toString('hex');
          validSessions.add(token);
          // HttpOnly session cookie, no Expires → a session cookie (dies with the browser session).
          redirect(res, INBOX_PATH, { 'Set-Cookie': `ASP.NET_SessionId=${token}; path=/; HttpOnly` });
          return;
        }
        // Missing hidden state or credentials → re-render the login (auth failed), HTTP 200.
        sendHtml(res, 200, loginHtml(true));
        return;
      }
    }

    // ---- inbox (session required) -----------------------------------------------------------
    if (lower === INBOX_PATH.toLowerCase()) {
      if (!authed(req)) { redirect(res, LOGIN_PATH); return; } // session-expired → back to login
      if (req.method === 'GET') {
        const page = parseInt(url.searchParams.get('page') || '1', 10) || 1;
        renderInbox(res, page);
        return;
      }
      if (req.method === 'POST') {
        // __doPostBack pager navigation: __EVENTARGUMENT carries 'Page$N'.
        const raw = await readRaw(req);
        const params = new URLSearchParams(raw);
        const arg = params.get('__EVENTARGUMENT') || '';
        const m = /Page\$(\d+)/.exec(arg);
        const page = m ? parseInt(m[1], 10) : 1;
        renderInbox(res, page);
        return;
      }
    }

    // ---- document (READ-ONLY invariant probe: sync must NEVER hit this) ---------------------
    if (lower === DOC_PATH.toLowerCase() && req.method === 'GET') {
      documentHits += 1;
      const buf = Buffer.from('%PDF-1.4 mock citius document stub');
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': buf.length });
      res.end(buf);
      return;
    }

    sendJson(res, 404, { error: 'not found', method: req.method, path });
  }

  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    loginPath: LOGIN_PATH,
    inboxPath: INBOX_PATH,
    documentPath: DOC_PATH,
    getDocumentHits() { return documentHits; },
    scenario(cmd) { return applyScenario(cmd); },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
