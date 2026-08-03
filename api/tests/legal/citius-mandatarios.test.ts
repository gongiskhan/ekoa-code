/**
 * CS1 — deterministic parser + probe tests for the Caixa Citius (mandatários) PARSE half.
 * All fixtures are SPECULATIVE synthetic ISO-8859-1 WebForms pages (see the fixtures README);
 * these tests exercise the liberal parser and the structural metadata-only guarantee. NO
 * network, NO document fetch — CS1 is fixture-driven only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeHtml, parseHiddenFields } from '../../src/legal/portal-html.js';
import {
  parseInboxPage,
  detectPagingMode,
  notificacaoRef,
  type CitiusNotificacaoMeta,
} from '../../src/legal/citius-mandatarios.js';

const fxPath = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/citius-mandatarios/${name}`, import.meta.url));

/** Read a fixture as the real portal serves it: raw ISO-8859-1 bytes, decoded via decodeHtml. */
const load = (name: string): string => decodeHtml(readFileSync(fxPath(name)), 'text/html; charset=iso-8859-1');

const MODULE_SRC = readFileSync(fileURLToPath(new URL('../../src/legal/citius-mandatarios.ts', import.meta.url)), 'utf-8');

describe('citius-mandatarios · parseHiddenFields (login.html)', () => {
  const fields = parseHiddenFields(load('login.html'));

  it('extracts the ASP.NET hidden form state (all five named fields)', () => {
    expect(fields.__VIEWSTATE).toBe('/wEPDwUKLTM2Mjc0Mzk1Ng9kFgICAw9kFgICAQ8PZBYCHgtvbmtleXByZXNz');
    expect(fields.__VIEWSTATEGENERATOR).toBe('C2EE9ABB'); // value-before-name: attribute-order tolerant
    expect(fields.__EVENTVALIDATION).toBe('/wEdAAd8Kx1sQ2p9Xg=='); // single-quoted: quote tolerant
    expect(fields.__EVENTTARGET).toBe(''); // present but empty
    expect(fields.__EVENTARGUMENT).toBe('');
  });

  it('captures hidden inputs only — not the visible login controls', () => {
    expect('ctl00$cph$txtUserName' in fields).toBe(false);
    expect('ctl00$cph$txtUserPass' in fields).toBe(false);
    expect(Object.keys(fields).sort()).toEqual(
      ['__EVENTARGUMENT', '__EVENTTARGET', '__EVENTVALIDATION', '__VIEWSTATE', '__VIEWSTATEGENERATOR'].sort(),
    );
  });

  it('the fixture carries the three login selectors (login-page shape)', () => {
    const html = load('login.html');
    expect(html).toContain('id="txtUserName"');
    expect(html).toContain('id="txtUserPass"');
    expect(html).toContain('id="ImBtnLogin"');
  });
});

describe('citius-mandatarios · parseInboxPage (rows + metadata)', () => {
  it('parses page 1 rows with correct metadata and inert documentoRef', () => {
    const res = parseInboxPage(load('inbox-get-p1.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(2);
    expect(res.pageTotal).toBe(2);

    expect(res.rows[0]).toMatchObject({
      processo: '1234/26.0T8LSB',
      data: '2026-06-15',
      tribunal: 'Tribunal Judicial da Comarca de Lisboa',
      ato: 'Citação', // accent survived the latin1 decode
      temDocumento: true,
    });
    // documentoRef is captured (with &amp; entity-decoded) but INERT.
    expect(res.rows[0]!.documentoRef).toBe('Documento.aspx?docId=abc123&t=not');
    // per-row source id is parsed and used verbatim as the dedup ref
    expect(res.rows[0]!.sourceId).toBe('14235');
    expect(res.rows[0]!.ref).toBe('14235');

    // Row 2 has no attached document.
    expect(res.rows[1]).toMatchObject({
      processo: '5678/26.1T8PRT',
      ato: 'Notificação',
      temDocumento: false,
    });
    expect(res.rows[1]!.documentoRef).toBeUndefined();
    expect(res.rows[1]!.sourceId).toBe('14236');
    expect(res.rows[1]!.ref).toBe('14236');
  });

  it('maps columns BY HEADER LABEL, not position (reordered page 2)', () => {
    const res = parseInboxPage(load('inbox-get-p2.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    // page 2 header order is Data | Processo | Ato | Tribunal | Documento
    expect(res.rows[0]).toMatchObject({
      processo: '9012/26.2T8CBR',
      data: '2026-06-17',
      ato: 'Citação',
      tribunal: 'Tribunal Judicial da Comarca de Coimbra',
      temDocumento: true,
    });
    expect(res.rows[0]!.documentoRef).toBe('Documento.aspx?docId=def456');
  });

  it('parses the postback fixture (Acto column variant)', () => {
    const res = parseInboxPage(load('inbox-postback.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ processo: '3456/26.3T8FAR', ato: 'Notificação' });
  });

  // round-3 DEFECT 2 (false-positive rows), UPDATED to the attempt-5 semantics: a European date in
  // a processo cell must never be EXTRACTED as a process number (the date guard survives the move
  // to substring extraction). Attempt 4 dropped such rows SILENTLY and returned the parseable
  // subset — the partial-parse data loss attempt 5 forbids — so this marked grid, whose data rows
  // do NOT all parse, is now an honest ok:false: never a subset, and NEVER an empty.
  it('a marked grid with DD/MM/YYYY dates in processo cells is ok:false — never a silent subset', () => {
    const res = parseInboxPage(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>15/06/2026</td><td>2026-06-15</td><td>Tribunal de Lisboa</td></tr>',
        '  <tr><td>1/1/2026</td><td>2026-01-01</td><td>Tribunal do Porto</td></tr>',
        '  <tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Tribunal de Lisboa</td></tr>',
        '  <tr><td>123/2026</td><td>2026-06-17</td><td>Tribunal de Coimbra</td></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('indisponível');
  });

  // The positive counterpart: when EVERY data row carries a real process number (lettered court
  // code or the bare NNNN/YYYY form), the grid parses fully and returns them all.
  it('a grid where every row is a real process number parses fully (both Citius forms)', () => {
    const res = parseInboxPage(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Tribunal de Lisboa</td></tr>',
        '  <tr><td>123/2026</td><td>2026-06-17</td><td>Tribunal de Coimbra</td></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '123/2026']);
  });
});

describe('citius-mandatarios · parseInboxPage (empty vs unavailable — the anti-false-empty guarantee)', () => {
  it('an EMPTY inbox (real table, zero rows) is ok:true rows:[] — never an error', () => {
    const res = parseInboxPage(load('inbox-empty.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([]);
  });

  it('an ERROR/maintenance page is ok:false indisponível — never a false empty', () => {
    const res = parseInboxPage(load('error.html'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('indisponível');
  });

  it('a LOGIN redirect (no notifications table) is ok:false — never a false empty', () => {
    const res = parseInboxPage(load('login.html'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('indisponível');
  });

  it('empty string / garbage is ok:false, not a false empty', () => {
    expect(parseInboxPage('').ok).toBe(false);
    expect(parseInboxPage('<html><body>nada aqui</body></html>').ok).toBe(false);
    // a table with the word "processo" in body text but no real header must NOT read as empty-ok
    expect(parseInboxPage('<table><tr><td>sobre o processo</td></tr></table>').ok).toBe(false);
  });

  // (a) A prose error / session-expired page laid out as a table, whose cells CONTAIN 'ato' and
  // 'data' as substrings ("imediato", "nesta data") but EQUAL no column label, must NOT be read
  // as a valid-but-empty grid. Exact-label header matching is what forces ok:false here.
  it('a session-expired prose page laid out as a table is ok:false — NOT a false empty (CRITICAL-1)', () => {
    const sessionExpired =
      '<h1>Sessao expirada</h1><table><tr>' +
      '<td>O seu processo de autenticacao terminou</td>' +
      '<td>contacte o suporte imediato</td></tr></table>';
    const res = parseInboxPage(sessionExpired);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('indisponível');
  });

  // (b) A filter / section-title table BEFORE the real grid must not shadow it: the page still
  // reports the real notification, not a false empty from the first table.
  it('a filter/section table before the real grid still yields the real row (CRITICAL-2)', () => {
    const filterThenGrid = [
      '<html><body>',
      '<table class="filtros"><tr><td colspan="2">Filtrar notificacoes</td></tr></table>',
      '<table id="ctl00_cph_gvNotificacoes">',
      '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
      '  <tr><td>1111/26.0T8LSB</td><td>2026-07-01</td><td>Tribunal de Lisboa</td><td>Citacao</td><td>&nbsp;</td></tr>',
      '</table>',
      '</body></html>',
    ].join('\n');
    const res = parseInboxPage(filterThenGrid);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.processo).toBe('1111/26.0T8LSB');
  });

  // A strong-but-EMPTY grid before the real grid (both pass strong id) must not shadow the real
  // one: the table WITH data rows wins.
  it('an empty strong grid before a populated one does not shadow it (CRITICAL-2)', () => {
    const emptyThenReal = [
      '<html><body>',
      '<table><tr><th>Processo</th><th>Data</th></tr>',
      '        <tr><td colspan="2">Sem resultados</td></tr></table>',
      '<table id="ctl00_cph_gvNotificacoes">',
      '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
      '  <tr><td>2020/26.0T8LSB</td><td>2026-07-05</td><td>Tribunal de Lisboa</td><td>Citacao</td><td>&nbsp;</td></tr>',
      '</table>',
      '</body></html>',
    ].join('\n');
    const res = parseInboxPage(emptyThenReal);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.processo).toBe('2020/26.0T8LSB');
  });

  // (MEDIUM) A caption / colspan row above the real <th> header within the SAME table must be
  // skipped, not mistaken for the header (which would fail the column test and drop the table).
  it('a caption/colspan row above the header is skipped, not mistaken for it (MEDIUM)', () => {
    const captionThenHeader = [
      '<table id="ctl00_cph_gvNotificacoes">',
      '  <tr><td colspan="5">Lista de processos</td></tr>',
      '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
      '  <tr><td>2222/26.0T8PRT</td><td>2026-07-02</td><td>Tribunal do Porto</td><td>Citacao</td><td>&nbsp;</td></tr>',
      '</table>',
    ].join('\n');
    const res = parseInboxPage(captionThenHeader);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.processo).toBe('2222/26.0T8PRT');
  });

  // (c) The genuinely-empty grid stays ok:true rows:[] — the ONE legitimate empty result.
  it('the genuinely-empty grid fixture stays ok:true rows:[] (the ONLY legitimate empty)', () => {
    const res = parseInboxPage(load('inbox-empty.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([]);
  });
});

describe('citius-mandatarios · false-empty regressions (reviewer inputs — each MUST be ok:false)', () => {
  const expectUnavailable = (html: string): void => {
    const res = parseInboxPage(html);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('indisponível');
  };

  // A search/FILTER panel whose label row cells EQUAL Processo|Data|Tribunal over an <input> row,
  // with NO real grid: the header gate passes on the label texts, but there are zero process-number-
  // shaped data rows, no GridView marker, and no empty-inbox message → NOT the notifications grid.
  // Previously this returned a FALSE EMPTY ({ok:true, rows:[]}).
  it('filter panel only (label row over an <input> row) is ok:false', () => {
    expectUnavailable(
      [
        '<html><body>',
        '<table class="filtros">',
        '  <tr><td>Processo</td><td>Data</td><td>Tribunal</td></tr>',
        '  <tr><td><input type="text" name="proc" /></td><td><input type="text" name="dt" /></td>',
        '      <td><input type="text" name="trib" /></td></tr>',
        '</table>',
        '</body></html>',
      ].join('\n'),
    );
  });

  // The same filter panel with <th> labels and a "Pesquisar" submit row.
  it('filter panel with <th> labels + a Pesquisar submit row is ok:false', () => {
    expectUnavailable(
      [
        '<html><body>',
        '<table class="pesquisa">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td><input type="text" /></td><td><input type="text" /></td>',
        '      <td><input type="submit" value="Pesquisar" /></td></tr>',
        '</table>',
        '</body></html>',
      ].join('\n'),
    );
  });

  // A login form + a search table with <th>Processo</th><th>Data</th><th>Tribunal</th> and an input row.
  it('login form + search table (th labels + input row) is ok:false', () => {
    expectUnavailable(
      [
        '<html><body>',
        '<form action="Login.aspx"><input type="text" id="txtUserName" />',
        '  <input type="password" id="txtUserPass" /></form>',
        '<table class="pesquisa">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td><input type="text" name="p" /></td><td><input type="text" name="d" /></td>',
        '      <td><input type="text" name="t" /></td></tr>',
        '</table>',
        '</body></html>',
      ].join('\n'),
    );
  });

  // An error/session page whose cells literally EQUAL "Processo" / "Data" (so the header gate
  // passes) but whose only data row is prose, not a process number.
  it('prose error/session page with cells that equal the labels is ok:false', () => {
    expectUnavailable(
      [
        '<html><body>',
        '<h1>Sessao terminada</h1>',
        '<table>',
        '  <tr><td>Processo</td><td>Data</td></tr>',
        '  <tr><td>A sua sessao expirou. Volte a autenticar-se.</td><td>-</td></tr>',
        '</table>',
        '</body></html>',
      ].join('\n'),
    );
  });

  // A WAF / session-challenge page with search chrome but no grid (no marker, no empty message,
  // no process-number-shaped row).
  it('WAF/session challenge page with search chrome but no grid is ok:false', () => {
    expectUnavailable(
      [
        '<html><head><script>var ___utmvc = "waf-token";</script></head><body>',
        '<h1>A validar o seu acesso...</h1>',
        '<table class="searchbox">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td><input type="text" /></td><td><input type="text" /></td><td><input type="text" /></td></tr>',
        '</table>',
        '</body></html>',
      ].join('\n'),
    );
  });

  // The positive counterpart: the SAME header-only-with-no-rows shape, but the grid carries a
  // GridView marker AND an explicit empty-inbox message → the ONE legitimate empty (positively
  // proven, not inferred).
  it('a marker+empty-message grid with zero rows is the ONE legitimate empty (ok:true rows:[])', () => {
    const res = parseInboxPage(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
        '  <tr class="rgEmpty"><td colspan="5">Nao existem notificacoes na caixa de correio.</td></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([]);
  });

  // A structural marker ALONE (no empty message) with zero DATA ROWS is also a structurally-proven
  // empty grid — attempt-5 classification 3 holds independently of the empty-message signal.
  it('a marker-only grid with zero rows is ok:true rows:[] (structural-marker positive proof)', () => {
    const res = parseInboxPage(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toEqual([]);
  });

  // ---- round-3 DEFECT 1 (still-open false empty) --------------------------------------------

  // The exact round-3 PROBE A: a "sessao terminou" page whose FILTER panel <table> has an id that
  // CONTAINS 'notificac' (ctl00_cph_pnlPesquisaNotificacoes) AND a Processo/Data/Tribunal label row
  // over an <input> row. The old bare-substring marker matched 'notificac' and, with a passing
  // header + zero data rows, returned a FALSE EMPTY. The GridView-STRUCTURAL marker (a pnl… panel
  // is not gv…), plus the <input>-row disqualifier, now rejects it.
  it('PROBE A: sessao-terminou filter panel with a notificac-substring id is ok:false', () => {
    expectUnavailable(
      '<h1>A sua sessao terminou</h1>' +
        '<table id="ctl00_cph_pnlPesquisaNotificacoes" class="pesquisa">' +
        '<tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>' +
        '<tr><td><input/></td><td><input/></td><td><input/></td></tr>' +
        '</table>',
    );
  });

  // An error/session page showing an empty-inbox MESSAGE inside a Processo/Data header table that
  // has NO GridView-structural marker. The message alone is NOT sufficient proof (round-3): without
  // the structural marker this is ok:false, never a false empty. (Deliberately avoids the hard
  // looksUnavailable markers, so the MARKER requirement — not looksUnavailable — is what forces it.)
  it('empty-inbox message inside a non-gv header table is ok:false (message not sufficient alone)', () => {
    expectUnavailable(
      [
        '<html><body>',
        '<h1>A sua sessao expirou</h1>',
        '<table id="tabelaMensagens">',
        '  <tr><th>Processo</th><th>Data</th></tr>',
        '  <tr><td colspan="2">Nao existem notificacoes na caixa de correio.</td></tr>',
        '</table>',
        '</body></html>',
      ].join('\n'),
    );
  });

  // Error CHROME whose id/class CONTAINS 'notificac' but is NOT gridview-structural: a
  // divNotificacoesErro wrapper + a menuNotificacoesLink table. Neither is a GridView marker, so
  // even with a Processo/Data/Tribunal label row over inputs this is ok:false (already; kept).
  it('notificac-substring error chrome (div.notificacoes-erro / table#menuNotificacoesLink) is ok:false', () => {
    expectUnavailable(
      [
        '<div class="notificacoes-erro">',
        '  <table id="menuNotificacoesLink">',
        '    <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '    <tr><td><input/></td><td><input/></td><td><input/></td></tr>',
        '  </table>',
        '</div>',
      ].join('\n'),
    );
  });
});

describe('citius-mandatarios · round-4 regressions (the attempt-5 structural redesign)', () => {
  const expectUnavailable = (html: string): void => {
    const res = parseInboxPage(html);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('indisponível');
  };

  // The SAFETY HIERARCHY is pinned in the module docblock (and enforced behaviourally by every
  // case below): false-empty is the catastrophic outcome; a partial parse presented as complete is
  // equally forbidden; when uncertain the parser says indisponível.
  it('the module docblock pins the safety hierarchy (false-empty catastrophic; uncertain => indisponível)', () => {
    expect(MODULE_SRC).toMatch(/SAFETY HIERARCHY/);
    expect(MODULE_SRC).toMatch(/FALSE EMPTY/i);
    expect(MODULE_SRC).toMatch(/indisponível/);
  });

  // ---- P1/P6: the dropped /gridview/i marker2 -----------------------------------------------

  // The committed fixture: an ERROR panel styled with the portal's GridView skin class and a
  // label-equal header, zero data rows. Attempt-4's unanchored /gridview/i marker2 read this as a
  // structurally-proven EMPTY inbox (a false empty). With marker2 DROPPED, a class alone proves
  // nothing: ok:false. (Rides the real latin1 decode path like every portal page.)
  it('P1/P6 fixture: gridview-classed error chrome is ok:false, never a false empty', () => {
    expectUnavailable(load('chrome-gridview-error.html'));
  });

  // Inline variant: a bare GridView-classed table with a header and nothing else (the minimal
  // marker2 evasion) also proves nothing.
  it('P1/P6: a header-only table with class="GridView" and zero data rows is ok:false', () => {
    expectUnavailable(
      '<table class="GridView"><tr><th>Processo</th><th>Data</th></tr></table>',
    );
  });

  // A GridView-CLASSED (unmarked-id) table whose data actually parses is still recognised through
  // the DATA path — dropping marker2 lost no populated-inbox coverage.
  it('P1/P6 counterpart: a gridview-classed table with fully-parsing data rows still parses', () => {
    const res = parseInboxPage(
      [
        '<table class="GridView" id="tblLista">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>8888/26.0T8LSB</td><td>2026-06-25</td><td>Tribunal de Lisboa</td></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['8888/26.0T8LSB']);
  });

  // ---- P3/P9: the broadened interactive-control disqualifier --------------------------------

  // The committed fixture: session-expired login chrome inside a gv-marked table whose only
  // controls are a <select> + <button> (no <input> anywhere). Attempt-4's input-only check saw a
  // marked, "input-free" table with zero parsed rows and called it EMPTY. Now: ok:false.
  it('P3/P9 fixture: gv-marked login chrome with select/button controls is ok:false', () => {
    expectUnavailable(load('chrome-login-select.html'));
  });

  // Each interactive-control shape DISQUALIFIES the empty verdict on an otherwise
  // structurally-perfect empty grid (gv marker, header, zero data rows).
  const markedShell = (control: string): string =>
    [
      '<table id="ctl00_cph_gvNotificacoes">',
      '  <tr><th>Processo</th><th>Data</th></tr>',
      `  <tr><td colspan="2">Autentique-se novamente. ${control}</td></tr>`,
      '</table>',
    ].join('\n');

  it('P3/P9: a <select> inside the marked table blocks the empty verdict', () => {
    expectUnavailable(markedShell('<select name="perfil"><option>Mandatário</option></select>'));
  });
  it('P3/P9: a <button> inside the marked table blocks the empty verdict', () => {
    expectUnavailable(markedShell('<button type="submit">Entrar</button>'));
  });
  it('P3/P9: a <textarea> inside the marked table blocks the empty verdict', () => {
    expectUnavailable(markedShell('<textarea name="obs"></textarea>'));
  });
  it('P3/P9: a contenteditable region inside the marked table blocks the empty verdict', () => {
    expectUnavailable(markedShell('<div contenteditable="true">escreva aqui</div>'));
  });
  it('P3/P9: an <input> in the HEADER row blocks the empty verdict (header no longer exempt)', () => {
    expectUnavailable(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th><input type="checkbox" name="chkAll" /></th><th>Processo</th><th>Data</th></tr>',
        '</table>',
      ].join('\n'),
    );
  });

  // ---- P4/P8 (the dangerous one): substring process-number extraction -----------------------

  // The committed fixture: a POPULATED inbox whose processo cells read "Processo n.º <number>".
  // Attempt-4's whole-cell anchored match parsed ZERO rows here — silent loss of real
  // notifications. Substring extraction must parse BOTH rows and record the CANONICAL number.
  it('P4/P8 fixture: "Processo n.º …"-prefixed cells parse, with the canonical number extracted', () => {
    const res = parseInboxPage(load('inbox-prefixed.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      processo: '1234/26.0T8LSB', // canonical — not the "Processo n.º …" cell prose
      data: '2026-06-20',
      tribunal: 'Tribunal Judicial da Comarca de Lisboa',
      ato: 'Citação',
      temDocumento: true,
    });
    expect(res.rows[0]!.documentoRef).toBe('Documento.aspx?docId=jkl012&t=not');
    expect(res.rows[0]!.sourceId).toBe('14260');
    expect(res.rows[0]!.ref).toBe('14260');
    expect(res.rows[1]).toMatchObject({
      processo: '45/26.7T8ABC-A', // the -A apenso suffix survives extraction
      temDocumento: false,
    });
    expect(res.rows[1]!.sourceId).toBe('14261');
  });

  // Glued-prefix variants: a recognised label prefix stuck to the number in one token still
  // resolves; the extraction never invents a number from an arbitrary alien token.
  it('P4/P8: glued prefixes (nº1234/…, Proc.1234/…) and trailing punctuation still parse', () => {
    const res = parseInboxPage(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>nº1234/26.0T8LSB</td><td>2026-06-26</td><td>Tribunal de Lisboa</td></tr>',
        '  <tr><td>Proc.567/2026.</td><td>2026-06-27</td><td>Tribunal do Porto</td></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '567/2026']);
  });

  // The date guard SURVIVES the substring move: a prose cell whose only slash-y token is a
  // DD/MM/YYYY date yields no extraction — and because this marked grid then has an unparseable
  // data row, the page is ok:false (never a row keyed on a date, never an empty).
  it('P4/P8 guard: a date inside prose ("Notificada em 15/06/2026") is never extracted', () => {
    expectUnavailable(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>Notificada em 15/06/2026</td><td>2026-06-15</td><td>Tribunal de Lisboa</td></tr>',
        '</table>',
      ].join('\n'),
    );
  });

  // ---- parse failure is never empty and never a subset --------------------------------------

  // The committed fixture: the real marked grid with TWO data rows, only ONE of which parses.
  // Attempt 4 would have returned the parseable subset (silent loss of the second notification);
  // an empty verdict would be worse. Attempt-5 rule 2: ok:false, honestly indisponível.
  it('partial-parse fixture: a marked grid where not all data rows parse is ok:false', () => {
    const res = parseInboxPage(load('inbox-partial-unparseable.html'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('indisponível');
  });

  // Parse-failure precedence is pinned: a poisoned marked grid makes the WHOLE page ok:false even
  // when another table parses fully — completeness cannot be claimed for a page whose (apparent)
  // real grid could not be read completely. Availability is sacrificed; data loss never is.
  it('a poisoned marked grid forces ok:false even alongside a fully-parsing table', () => {
    expectUnavailable(
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>7777/26.0T8LSB</td><td>2026-06-22</td><td>Tribunal de Lisboa</td></tr>',
        '  <tr><td>???</td><td>2026-06-23</td><td>Tribunal do Porto</td></tr>',
        '</table>',
        '<table id="tblResumo">',
        '  <tr><th>Processo</th><th>Data</th></tr>',
        '  <tr><td>9999/26.0T8LSB</td><td>2026-06-24</td></tr>',
        '</table>',
      ].join('\n'),
    );
  });

  // An UNMARKED table with unparseable "data" rows is ambiguous chrome: it proves nothing, and in
  // particular it does NOT poison a page whose real marked grid parses fully.
  it('an unmarked ambiguous table does not poison a fully-parsing real grid', () => {
    const res = parseInboxPage(
      [
        '<table class="pesquisa">',
        '  <tr><td>Processo</td><td>Data</td></tr>',
        '  <tr><td>A sua pesquisa não devolveu resultados</td><td>-</td></tr>',
        '</table>',
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>6666/26.0T8LSB</td><td>2026-06-28</td><td>Tribunal de Lisboa</td></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['6666/26.0T8LSB']);
  });

  // A marked EMPTY grid coexisting with a populated grid never shadows it (precedence: populated
  // beats proven-empty) — the empty verdict can never eat real rows.
  it('a structurally-proven empty grid never shadows a populated one on the same page', () => {
    const res = parseInboxPage(
      [
        '<table id="ctl00_cph_gvNotificacoesArquivadas">',
        '  <tr><th>Processo</th><th>Data</th></tr>',
        '</table>',
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>',
        '  <tr><td>5555/26.0T8LSB</td><td>2026-06-29</td><td>Tribunal de Lisboa</td></tr>',
        '</table>',
      ].join('\n'),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['5555/26.0T8LSB']);
  });
});

describe('citius-mandatarios · detectPagingMode', () => {
  it("GET pager (?page=N) -> 'get' (even with the __doPostBack script present)", () => {
    expect(detectPagingMode(load('inbox-get-p1.html'))).toBe('get');
    expect(detectPagingMode(load('inbox-get-p2.html'))).toBe('get');
  });

  it("postback pager (javascript:__doPostBack) -> 'postback'", () => {
    expect(detectPagingMode(load('inbox-postback.html'))).toBe('postback');
  });

  it("no pager -> 'none'", () => {
    expect(detectPagingMode(load('inbox-empty.html'))).toBe('none');
    expect(detectPagingMode(load('error.html'))).toBe('none');
  });
});

describe('citius-mandatarios · notificacaoRef (per-row source id, hash fallback)', () => {
  // Two rows that are IDENTICAL in processo|data|tribunal|ato with no doc link — a content hash
  // would collide and drop one — but each carries a DISTINCT per-row source id, so their refs
  // stay distinct. This is the real dedup-collision guard (HIGH).
  const TWIN_ROWS_DISTINCT_IDS = [
    '<table id="ctl00_cph_gvNotificacoes">',
    '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
    '  <tr><td><input type="checkbox" name="sel" value="90001" />3333/26.0T8LSB</td><td>2026-07-03</td>',
    '      <td>Tribunal de Lisboa</td><td>Citacao</td><td>&nbsp;</td></tr>',
    '  <tr><td><input type="checkbox" name="sel" value="90002" />3333/26.0T8LSB</td><td>2026-07-03</td>',
    '      <td>Tribunal de Lisboa</td><td>Citacao</td><td>&nbsp;</td></tr>',
  ].join('\n') + '\n</table>';

  it('is stable across a re-parse of the same page', () => {
    const a = parseInboxPage(load('inbox-get-p1.html'));
    const b = parseInboxPage(load('inbox-get-p1.html'));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.rows.map((r) => r.ref)).toEqual(b.rows.map((r) => r.ref));
    // and recomputing the ref off a parsed row reproduces its own ref
    expect(notificacaoRef(a.rows[0]!)).toBe(a.rows[0]!.ref);
  });

  it('the per-row source id is used VERBATIM as the ref when present', () => {
    const res = parseInboxPage(load('inbox-get-p1.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.ref)).toEqual(['14235', '14236']);
    expect(res.rows.map((r) => r.sourceId)).toEqual(['14235', '14236']);
  });

  // The rewritten "differs across distinct rows": CONTENT-IDENTICAL rows with DISTINCT source ids
  // must NOT collide — exercising the source-id path, not just distinct-content rows.
  it('differs across distinct rows (content-identical rows with distinct source ids do not collide)', () => {
    const res = parseInboxPage(TWIN_ROWS_DISTINCT_IDS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(2);
    // content is identical across the two rows...
    expect(res.rows[0]!.processo).toBe(res.rows[1]!.processo);
    expect(res.rows[0]!.data).toBe(res.rows[1]!.data);
    expect(res.rows[0]!.tribunal).toBe(res.rows[1]!.tribunal);
    expect(res.rows[0]!.ato).toBe(res.rows[1]!.ato);
    // ...but the source ids, and therefore the refs, are distinct (no dedup MISS)
    expect(res.rows.map((r) => r.sourceId)).toEqual(['90001', '90002']);
    expect(new Set(res.rows.map((r) => r.ref)).size).toBe(2);
  });

  // sourceId NON-UNIQUENESS (reviewer): two content-DISTINCT rows sharing a STATIC value="on" must
  // NOT collide on ref. "on" is non-identifying, so both drop to the content hash; distinct content
  // → distinct refs. The verbatim-id path can never introduce a collision worse than the id-less hash.
  it('two content-distinct rows sharing value="on" get distinct refs via hash fallback', () => {
    const html =
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
        '  <tr><td><input type="checkbox" name="sel" value="on" />4001/26.0T8LSB</td><td>2026-07-10</td>',
        '      <td>Tribunal de Lisboa</td><td>Citacao</td><td>&nbsp;</td></tr>',
        '  <tr><td><input type="checkbox" name="sel" value="on" />4002/26.1T8PRT</td><td>2026-07-11</td>',
        '      <td>Tribunal do Porto</td><td>Notificacao</td><td>&nbsp;</td></tr>',
      ].join('\n') + '\n</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(2);
    // the static value="on" is rejected as non-identifying → no sourceId, hash-fallback refs
    expect(res.rows.map((r) => r.sourceId)).toEqual([undefined, undefined]);
    expect(res.rows.every((r) => /^[0-9a-f]{24}$/.test(r.ref))).toBe(true);
    expect(new Set(res.rows.map((r) => r.ref)).size).toBe(2);
  });

  // Even an identifying-LOOKING id that is DUPLICATED across content-distinct rows is dropped for the
  // colliding rows (pass 2), so the verbatim-id path can never make content-distinct rows clash.
  it('a duplicated per-row id is dropped for the colliding rows (distinct content → distinct refs)', () => {
    const html =
      [
        '<table id="ctl00_cph_gvNotificacoes">',
        '  <tr><th>Processo</th><th>Data</th><th>Tribunal</th><th>Ato</th><th>Documento</th></tr>',
        '  <tr><td><input type="hidden" value="55555" />5001/26.0T8LSB</td><td>2026-07-12</td>',
        '      <td>Tribunal de Lisboa</td><td>Citacao</td><td>&nbsp;</td></tr>',
        '  <tr><td><input type="hidden" value="55555" />5002/26.1T8PRT</td><td>2026-07-13</td>',
        '      <td>Tribunal do Porto</td><td>Notificacao</td><td>&nbsp;</td></tr>',
      ].join('\n') + '\n</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(2);
    expect(res.rows.map((r) => r.sourceId)).toEqual([undefined, undefined]);
    expect(new Set(res.rows.map((r) => r.ref)).size).toBe(2);
  });

  it('two content-identical rows with DISTINCT source ids get DISTINCT refs (HIGH ref-collision)', () => {
    const withId = (id: string): Omit<CitiusNotificacaoMeta, 'ref'> => ({
      processo: '3333/26.0T8LSB',
      data: '2026-07-03',
      tribunal: 'Tribunal de Lisboa',
      ato: 'Citação',
      temDocumento: false,
      sourceId: id,
    });
    expect(notificacaoRef(withId('A'))).toBe('A'); // verbatim
    expect(notificacaoRef(withId('A'))).not.toBe(notificacaoRef(withId('B')));
  });

  // The pinned residual: with NO per-row id, content-identical notifications DO collide on the
  // hash fallback (a MISS). Documented in the module + fixtures README; the downstream
  // completeness reconciliation's count-check is the backstop.
  it('falls back to the content hash when no source id — and identical content then collides (SPIKE #5)', () => {
    const base: Omit<CitiusNotificacaoMeta, 'ref'> = {
      processo: '1/26.0T8LSB',
      data: '2026-01-01',
      tribunal: 'Lisboa',
      ato: 'Citação',
      temDocumento: false,
    };
    // hash-shaped (24 hex chars), not a verbatim id
    expect(notificacaoRef(base)).toMatch(/^[0-9a-f]{24}$/);
    // the documented residual: no id => identical content collides
    expect(notificacaoRef(base)).toBe(notificacaoRef({ ...base }));
  });

  it('changes when an id-bearing field changes, stable otherwise (hash-fallback path)', () => {
    const base: Omit<CitiusNotificacaoMeta, 'ref'> = {
      processo: '1/26.0T8LSB',
      data: '2026-01-01',
      tribunal: 'Lisboa',
      ato: 'Citação',
      temDocumento: false,
    };
    expect(notificacaoRef(base)).toBe(notificacaoRef({ ...base })); // stable
    expect(notificacaoRef(base)).not.toBe(notificacaoRef({ ...base, data: '2026-01-02' }));
    expect(notificacaoRef(base)).not.toBe(notificacaoRef({ ...base, processo: '2/26.0T8LSB' }));
  });
});

describe('citius-mandatarios · structural metadata-only guard (no document fetch)', () => {
  // A defense-in-depth TRIPWIRE — not a proof that EVERY conceivable network read is caught. It
  // flags the SHAPES a document-fetch would take: a fetch() call OR a bareword `fetch` alias, an
  // import of any http/fetch machinery, a require()/dynamic import() of it, an XMLHttpRequest, or
  // reading a response body. So a later `fetch(row.documentoRef).then((r) => r.text())`, or a
  // `const grab = fetch;` alias, is caught even under a novel name.
  const FETCH_CALL_RE = /\bfetch\s*\(/;
  const NET_IMPORT_RE =
    /from\s+['"](?:node:)?(?:https?|undici)['"]|from\s+['"][^'"]*(?:url-fetcher|fetch)[^'"]*['"]|\bguardedFetch\b|\bfetchImpl\b/i;
  const RESP_BODY_RE = /\.(?:arrayBuffer|blob|text)\s*\(/;
  // Bareword-reference / aliasing + alternative network entrypoints. Matched against the module with
  // comments stripped, so the word "fetch" in a doc comment is not a false positive.
  const BAREWORD_FETCH_RE = /\bfetch\b/;
  const REQUIRE_RE = /\brequire\s*\(/;
  const DYN_IMPORT_RE = /\bimport\s*\(/;
  const XHR_RE = /\bXMLHttpRequest\b/;

  /** MODULE_SRC with block + line comments stripped (doc comments legitimately mention "fetch"). */
  const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  it('the module makes no bare fetch() call, imports no http/fetch machinery, reads no response body', () => {
    expect(MODULE_SRC).not.toMatch(FETCH_CALL_RE);
    expect(MODULE_SRC).not.toMatch(NET_IMPORT_RE);
    expect(MODULE_SRC).not.toMatch(RESP_BODY_RE);
    // the original fixed-name checks stay as belt-and-braces
    expect(MODULE_SRC).not.toMatch(/from ['"][^'"]*url-fetcher/);
    expect(MODULE_SRC).not.toMatch(/\bguardedFetch\b/);
    expect(MODULE_SRC).not.toMatch(/\bfetchImpl\b/);
    expect(MODULE_SRC).not.toMatch(/\.arrayBuffer\s*\(/);
  });

  it('the module CODE references no bareword fetch/alias, no require()/import(), no XMLHttpRequest', () => {
    expect(MODULE_CODE).not.toMatch(BAREWORD_FETCH_RE);
    expect(MODULE_CODE).not.toMatch(REQUIRE_RE);
    expect(MODULE_CODE).not.toMatch(DYN_IMPORT_RE);
    expect(MODULE_CODE).not.toMatch(XHR_RE);
  });

  it('those guard matchers actually FIRE on planted violations (non-tautological)', () => {
    const plantedFetch = 'const bytes = await fetch(row.documentoRef).then((r) => r.arrayBuffer());';
    expect(plantedFetch).toMatch(FETCH_CALL_RE);
    expect(plantedFetch).toMatch(RESP_BODY_RE);
    expect(plantedFetch).toMatch(BAREWORD_FETCH_RE);

    const plantedTextRead = 'const body = await resp.text();';
    expect(plantedTextRead).toMatch(RESP_BODY_RE);

    // a bareword `fetch` reference / alias with NO call parens — caught by BAREWORD, missed by CALL
    const plantedFetchAlias = 'const grab = fetch;';
    expect(plantedFetchAlias).toMatch(BAREWORD_FETCH_RE);
    expect(plantedFetchAlias).not.toMatch(FETCH_CALL_RE);

    const plantedFetchImport = "import { guardedFetch } from '../net/url-fetcher.js';";
    expect(plantedFetchImport).toMatch(NET_IMPORT_RE);
    const plantedHttpsImport = "import https from 'node:https';";
    expect(plantedHttpsImport).toMatch(NET_IMPORT_RE);
    const plantedUndiciImport = "import { request } from 'undici';";
    expect(plantedUndiciImport).toMatch(NET_IMPORT_RE);

    const plantedRequire = "const https = require('node:https');";
    expect(plantedRequire).toMatch(REQUIRE_RE);
    const plantedDynImport = "const m = await import('node:https');";
    expect(plantedDynImport).toMatch(DYN_IMPORT_RE);
    const plantedXhr = 'const x = new XMLHttpRequest();';
    expect(plantedXhr).toMatch(XHR_RE);
  });

  it('defines no function that fetches/downloads/opens a document', () => {
    // A document-fetch signature would be a declared function whose name ends in Documento.
    expect(MODULE_SRC).not.toMatch(
      /(?:function|const)\s+\w*(?:fetch|download|obter|abrir|retrieve|open|get)\w*[Dd]ocumento/i,
    );
    // documentoRef exists as an inert captured field, and is never dereferenced by a fetch.
    expect(MODULE_SRC).toContain('documentoRef');
    expect(MODULE_SRC).not.toMatch(/documentoRef\s*\)[\s\S]{0,40}\.arrayBuffer/);
  });
});

describe('citius-mandatarios · round-5 regressions (walker seams under the structural redesign)', () => {
  const GRID_OPEN = '<table id="ctl00_cph_gvNotificacoes">';
  const HEADER = '<tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>';

  // ---- F1: nested-`</table>` truncation (CRITICAL — reachable false empty + silent subset) ----

  it('F1a: a nested chrome table between header and data rows never truncates the grid (was false empty)', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td colspan="3"><table class="filterbar"><tr><td>Filtro rapido</td></tr></table></td></tr>' +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Tribunal de Lisboa</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.processo).toBe('1234/26.0T8LSB');
  });

  it('F1b: an icon table nested inside a data cell never swallows the following rows (was a silent subset)', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '<tr><td><table class="ico"><tr><td>!</td></tr></table> 5678/26.1T8PRT</td><td>2026-06-17</td><td>Porto</td></tr>' +
      '<tr><td>9012/26.2T8CBR</td><td>2026-06-18</td><td>Coimbra</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '5678/26.1T8PRT', '9012/26.2T8CBR']);
  });

  it('F1c: an HTML comment containing </table> is not markup and never truncates the grid (was false empty)', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<!-- legacy markup: </table> -->' +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
  });

  it('F1d: a marked zero-data-row grid containing a NESTED table is never a proven empty (unmodelled chrome)', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td colspan="3"><table class="legend"><tr><td>Cor</td><td>Significado</td></tr></table></td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(false);
  });

  // ---- F2: interactive control OUTSIDE every <tr> (CRITICAL — evaded the disqualifier) ----

  it('F2a: a <select> in the grid <caption> blocks the empty verdict', () => {
    const html =
      GRID_OPEN +
      '<caption>Pesquisar: <select name="ctl00$cph$ddlFiltro"><option>Todas</option></select></caption>' +
      '<tr><th>Processo</th><th>Data</th></tr>' +
      '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('F2b: an <input> as a direct child of <table> (before the first row) blocks the empty verdict', () => {
    const html = GRID_OPEN + '<input type="text" name="q">' + '<tr><th>Processo</th><th>Data</th></tr>' + '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('F2c: a <button> after the last </tr> blocks the empty verdict', () => {
    const html = GRID_OPEN + '<tr><th>Processo</th><th>Data</th></tr>' + '<button>Actualizar</button>' + '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  // ---- F3: omitted </tr> (HIGH — merged rows silently dropped a notification) ----

  it('F3: an omitted </tr> (legal per the HTML spec) still yields one row per <tr> opener', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td>' + // </tr> omitted
      '<tr><td>123/2026</td><td>2026-06-17</td><td>Porto</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '123/2026']);
  });

  it('F3-cells: an omitted </td> never merges neighbouring cells (columns stay mapped)', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>1234/26.0T8LSB<td>2026-06-16<td>Lisboa</tr>' + // all </td> omitted
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.processo).toBe('1234/26.0T8LSB');
    expect(res.rows[0]!.data).toBe('2026-06-16');
    expect(res.rows[0]!.tribunal).toBe('Lisboa');
  });

  // ---- F4: 2-digit bare year invented a processo out of a date fragment / prose ref (MEDIUM) ----

  it('F4a: a DD/MM fragment ("Citada a 15/06") is never extracted as a processo — the marked grid is ok:false', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>Citada a 15/06</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(false); // the row does not parse and the marked grid poisons the page
  });

  it('F4b: a 2-digit bare-year prose ref ("Ref. interna 123/26 do tribunal") is never extracted', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>Ref. interna 123/26 do tribunal</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('F4c: the 4-digit bare form (123/2026) and the 2-digit LETTERED form (1234/26.0T8LSB) both still parse', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>123/2026</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '<tr><td>Processo n.º 1234/26.0T8LSB</td><td>2026-06-17</td><td>Porto</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['123/2026', '1234/26.0T8LSB']);
  });

  // ---- The layout-wrapper direction of F1: a grid NESTED inside chrome still parses ----

  it('F1e: the notifications grid nested inside an outer layout table is still found and parsed', () => {
    const html =
      '<table class="layout"><tr><td>' +
      GRID_OPEN +
      HEADER +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>' +
      '</td></tr></table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.processo).toBe('1234/26.0T8LSB');
  });
});

describe('citius-mandatarios · round-5b regressions (non-markup contexts + truncated structure)', () => {
  const GRID_OPEN = '<table id="ctl00_cph_gvNotificacoes">';
  const HEADER = '<tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>';
  const ROW1 = '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>';
  const ROW2 = '<tr><td>5678/26.1T8PRT</td><td>2026-06-17</td><td>Porto</td></tr>';
  const ROW3 = '<tr><td>9012/26.2T8CBR</td><td>2026-06-18</td><td>Coimbra</td></tr>';

  // ---- R6-1: </table> in non-markup contexts reached a FALSE EMPTY ----

  it('R6-1a: "</table>" inside a quoted attribute value never truncates the grid (was ok:true rows=[])', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td title="</table>">1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      ROW2 +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  it('R6-1b: a script document.write("</table>") template never truncates the grid (was ok:true rows=[])', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<script>document.write("</table>")</script>' +
      ROW1 +
      ROW2 +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(2);
  });

  // ---- R6-2: phantom / unterminated <table> openers hid rows from a POPULATED verdict ----

  it('R6-2a: an unclosed junk <table> between rows poisons the page instead of silently dropping rows 2-3', () => {
    const html = GRID_OPEN + HEADER + ROW1 + '<table class="junk">' + ROW2 + ROW3 + '</table>';
    expect(parseInboxPage(html).ok).toBe(false); // never {ok:true, rows:[ROW1]}
  });

  it('R6-2b: a phantom "<table>" inside an attribute value never hides the following rows', () => {
    const html =
      GRID_OPEN +
      HEADER +
      ROW1 +
      '<tr><td><span title="<table>">x</span> 5678/26.1T8PRT</td><td>2026-06-17</td><td>Porto</td></tr>' +
      ROW3 +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '5678/26.1T8PRT', '9012/26.2T8CBR']);
  });

  it('R6-2c: an unterminated MARKED grid (payload cut mid-grid) is ok:false, never a "complete" populated read', () => {
    const html = GRID_OPEN + HEADER + ROW1 + ROW2; // no </table> — trailing rows may be missing
    expect(parseInboxPage(html).ok).toBe(false);
  });

  // ---- R6-3: the comment strip crossed attribute values and deleted rows ----

  it('R6-3: "<!--" and "-->" split across two attribute values never delete the rows between them', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td title="<!--">1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      ROW2 +
      '<tr><td title="-->">9012/26.2T8CBR</td><td>2026-06-18</td><td>Coimbra</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '5678/26.1T8PRT', '9012/26.2T8CBR']);
  });

  // ---- R6-4: rows fabricated from script templates under ok:true ----

  it('R6-4: a client-side row template inside <script> can never fabricate a phantom notification', () => {
    const html =
      GRID_OPEN +
      HEADER +
      ROW1 +
      '<script>var tpl = "<tr><td>999/2026</td><td>2026-01-01</td><td>Fake</td></tr>";</script>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB']);
  });

  // ---- R6-5: a structurally truncated payload proves nothing ----

  it('R6-5a: an unterminated comment before the data rows is ok:false (truncated payload), never an empty', () => {
    const html = GRID_OPEN + HEADER + '<!-- ' + ROW1 + ROW2 + '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('R6-5b: an unterminated comment AFTER complete rows still marks the payload truncated (ok:false)', () => {
    const html = GRID_OPEN + HEADER + ROW1 + ROW2 + ROW3 + '</table><!-- trailing';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  // ---- R6-6: MM/YYYY month fragments invented into a processo ----

  it('R6-6a: a zero-padded month fragment ("notificada em 06/2026") is never a processo — marked grid poisons', () => {
    const html =
      GRID_OPEN + HEADER + '<tr><td>notificada em 06/2026</td><td>2026-06-16</td><td>Lisboa</td></tr>' + '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('R6-6b: a genuine unpadded bare serial (6/2026) still parses', () => {
    const html = GRID_OPEN + HEADER + '<tr><td>6/2026</td><td>2026-06-16</td><td>Lisboa</td></tr>' + '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]!.processo).toBe('6/2026');
  });

  // ---- R6-7: a phantom "<tr>" in an attribute value silently dropped an optional field ----

  it('R6-7: title="<tr>" on a trailing cell keeps the tribunal field intact', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td title="<tr>">Lisboa</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]!.tribunal).toBe('Lisboa');
  });

  // ---- The interactive-control rail survives the masking (textarea CONTENT masked, tag kept) ----

  it('a marked empty grid whose <textarea> contains "</table>" is still disqualified by the control, not truncated', () => {
    const html = GRID_OPEN + HEADER + '<textarea></table></textarea>' + '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });
});

describe('citius-mandatarios · round-5c regressions (spec-tokenizer divergences)', () => {
  // The 5c verification round proved five WHATWG-tokenizer divergences remained in the hand-rolled
  // lexing layer, each reaching a FALSE EMPTY, a SILENT SUBSET, or a FABRICATED row under ok:true.
  // The structural layer is now a parse5 (spec) parse — every expectation here is BROWSER TRUTH:
  // the rows a real browser would render are exactly the rows the parser returns, or the page is
  // honestly ok:false. Inputs are pinned; they must never regress to empty/subset again.
  const GRID_OPEN = '<table id="ctl00_cph_gvNotificacoes">';
  const HEADER = '<tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>';
  const ROW1 = '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>';
  const ROW2 = '<tr><td>5678/26.1T8PRT</td><td>2026-06-17</td><td>Porto</td></tr>';
  const ROW3 = '<tr><td>9012/26.2T8CBR</td><td>2026-06-18</td><td>Coimbra</td></tr>';

  const expectRows = (html: string, processos: string[]): void => {
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(processos);
  };

  // ---- 5c-1: abrupt comment closes (<!-->, <!--->, --!>) were over-eaten to the next --> ----

  it('5c-1a: an abrupt empty comment <!--> closes THERE (spec) — the rows after it all parse', () => {
    const html = GRID_OPEN + HEADER + '<!-->' + ROW1 + ROW2 + '</table>';
    expectRows(html, ['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  it('5c-1b: an abrupt <!---> comment closes THERE — the rows after it all parse', () => {
    const html = GRID_OPEN + HEADER + '<!--->' + ROW1 + ROW2 + '</table>';
    expectRows(html, ['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  it('5c-1c: an incorrectly-closed comment (--!>) ends THERE — a later real comment never swallows the rows between', () => {
    // The old lexer did not recognise --!> as a close and ate forward to the NEXT -->, deleting
    // ROW1 (a silent subset). Spec: the comment ends at --!>; the later <!-- legenda --> is its
    // own comment; both rows survive.
    const html = GRID_OPEN + HEADER + '<!-- aviso --!>' + ROW1 + '<!-- legenda -->' + ROW2 + '</table>';
    expectRows(html, ['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  // ---- 5c-2: <script src="…"/> is NOT self-closing (HTML script never is) ----

  it('5c-2: <script src="x.js"/> stays open to the REAL </script> — its document.write("</table>") never truncates', () => {
    // The old lexer honoured the XHTML-style trailing solidus, left the script content UNMASKED,
    // and the "</table>" inside it closed the grid after ROW1 (a silent subset). Spec: the
    // self-closing flag is ignored on script; everything to the real </script> is script text.
    const html =
      GRID_OPEN +
      HEADER +
      ROW1 +
      '<script src="x.js"/>document.write("</table>")</script>' +
      ROW2 +
      '</table>';
    expectRows(html, ['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  // ---- 5c-3: a raw-text close matched by PREFIX (</scripty>) ended the mask early ----

  it('5c-3: </scripty> does NOT end a script — the document.write("</table>") after it stays masked', () => {
    const html =
      GRID_OPEN +
      HEADER +
      ROW1 +
      '<script>if (top) { } </scripty> document.write("</table>");</script>' +
      ROW2 +
      '</table>';
    expectRows(html, ['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  // ---- 5c-4: the script double-escaped state was unmodeled ----

  it('5c-4: the double-escaped shape <script><!-- … <script>…</script> … --></script> never truncates the grid', () => {
    // Inside <script><!-- …, an inner "</script>" only exits the DOUBLE-escaped state (the outer
    // script is still open), so the "</table>" after it is still script text. The old lexer ended
    // the mask at the inner close and the "</table>" cut the grid to a subset.
    const html =
      GRID_OPEN +
      HEADER +
      ROW1 +
      '<script><!-- document.write("<script>a</script>"); document.write("</table>"); --></script>' +
      ROW2 +
      '</table>';
    expectRows(html, ['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  // ---- 5c-5: a stray quote in an UNQUOTED attribute value flipped the quote state ----

  it('5c-5: stray quotes in unquoted attr values on two rows never swallow rows — all THREE parse', () => {
    // Spec: a '"' inside an unquoted attribute value is a parse error consumed INTO the value; it
    // never opens a quoted context. The old lexer flipped into quote state at the first stray
    // quote and swallowed everything to the next one (rows lost under ok:true).
    const html =
      GRID_OPEN +
      HEADER +
      '<tr class=rgRow" align=left><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '<tr class=rgAlt" align=left><td>5678/26.1T8PRT</td><td>2026-06-17</td><td>Porto</td></tr>' +
      ROW3 +
      '</table>';
    expectRows(html, ['1234/26.0T8LSB', '5678/26.1T8PRT', '9012/26.2T8CBR']);
  });

  // ---- entity-encoded markup in cell TEXT is text, never structure ----

  it('entity-encoded &lt;/table&gt; in cell text never becomes structure (and survives as visible text)', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>anexo &lt;/table&gt; citado</td></tr>' +
      ROW2 +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '5678/26.1T8PRT']);
    expect(res.rows[0]!.tribunal).toBe('anexo </table> citado');
  });

  it('entity-encoded &lt;table&gt; in cell text never opens a phantom candidate grid', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>ver &lt;table&gt; em anexo</td></tr>' +
      '</table>';
    expectRows(html, ['1234/26.0T8LSB']);
  });
});

describe('citius-mandatarios · round-5c verification regressions (the semantic layer above the tree)', () => {
  const GRID_OPEN = '<table id="ctl00_cph_gvNotificacoes">';
  const HEADER = '<tr><th>Processo</th><th>Data</th><th>Tribunal</th></tr>';
  const ROW1 = '<tr><td>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>';
  const ROW2 = '<tr><td>5678/26.1T8PRT</td><td>2026-06-17</td><td>Porto</td></tr>';

  // ---- F1 (CRITICAL): rows ABOVE the identified header were invisible to every verdict ----

  it('F1a: a sort-glyph header + a repeating tfoot header never reports a populated grid as EMPTY', () => {
    // The real <th>s carry a sort glyph so normalizeHeader misses them; the tfoot labels pass the
    // gate instead, putting BOTH data rows above the identified header.
    const html =
      GRID_OPEN +
      '<thead><tr><th>Processo &#9650;</th><th>Data &#9650;</th><th>Tribunal &#9650;</th></tr></thead>' +
      '<tbody>' +
      ROW1 +
      ROW2 +
      '</tbody>' +
      '<tfoot>' +
      HEADER +
      '</tfoot>' +
      '</table>';
    expect(parseInboxPage(html).ok).toBe(false); // was {ok:true, rows:[]} for a 2-notification page
  });

  it('F1b: a data row ABOVE a mid-table header is never silently dropped from a populated read', () => {
    const html = GRID_OPEN + ROW1 + HEADER + ROW2 + '</table>';
    expect(parseInboxPage(html).ok).toBe(false); // was {ok:true, rows:['5678/26.1T8PRT']} — a subset
  });

  it('F1c: select-all checkboxes do not rescue the subset case (the raw-slice scan only guards EMPTY)', () => {
    const cb = '<td><input type="checkbox" value="n1"></td>';
    const html =
      GRID_OPEN +
      '<tr>' + cb + '<td>1234/26.0T8LSB</td><td>2026-06-16</td></tr>' +
      '<tr><th>Sel</th><th>Processo</th><th>Data</th></tr>' +
      '<tr>' + cb + '<td>5678/26.1T8PRT</td><td>2026-06-17</td></tr>' +
      '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('F1d: a normal grid (header first, decorative single-colspan rows above it) still parses', () => {
    const html =
      GRID_OPEN +
      '<tr><td colspan="3">Caixa de correio</td></tr>' + // single colspan: structurally not a data row
      HEADER +
      ROW1 +
      ROW2 +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows.map((r) => r.processo)).toEqual(['1234/26.0T8LSB', '5678/26.1T8PRT']);
  });

  // ---- F2 (HIGH): the walk must never throw — an unreadable page answers indisponível ----

  it('F2a: pathological nesting depth returns ok:false instead of throwing RangeError', () => {
    const html = '<div>'.repeat(20000) + GRID_OPEN + HEADER + ROW1 + '</table>';
    let res: ReturnType<typeof parseInboxPage> | undefined;
    expect(() => {
      res = parseInboxPage(html);
    }).not.toThrow();
    expect(res && res.ok === false).toBe(true);
  });

  it('F2b: deeply nested inline markup inside a cell never throws', () => {
    const deepCell = '<td>' + '<b>'.repeat(20000) + '1234/26.0T8LSB' + '</b>'.repeat(20000) + '</td>';
    const html = GRID_OPEN + HEADER + '<tr>' + deepCell + '<td>2026-06-16</td><td>Lisboa</td></tr>' + '</table>';
    expect(() => parseInboxPage(html)).not.toThrow();
  });

  it('F2c: moderate nesting (well under the old overflow threshold) still parses normally', () => {
    const html = '<div>'.repeat(500) + GRID_OPEN + HEADER + ROW1 + '</table>' + '</div>'.repeat(500);
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
  });

  // ---- F3 (MEDIUM): not-rendered content fabricated processos, ids and doc refs ----

  it('F3a: a <template> row template never replaces the cell\'s real process number', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td><template>9999/2026</template>1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]!.processo).toBe('1234/26.0T8LSB'); // was '9999/2026' — a real processo replaced
  });

  it('F3b: a <template>-only cell renders no process number, so the marked grid poisons', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td><template>9999/2026</template>Sem número</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    expect(parseInboxPage(html).ok).toBe(false); // was ok:true with a fabricated row
  });

  it('F3c: a <noscript> fallback never fabricates a notification', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td><noscript>7777/2026</noscript>Active o JavaScript</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('F3d: an <iframe> fallback never fabricates a notification', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td><iframe src="x">8888/2026</iframe>sem</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    expect(parseInboxPage(html).ok).toBe(false);
  });

  it('F3e: hidden inputs and anchors inside not-rendered content never fabricate sourceId/documentoRef', () => {
    const html =
      '<table id="ctl00_cph_gvNotificacoes">' +
      '<tr><th>Processo</th><th>Data</th><th>Documento</th></tr>' +
      '<tr><td><noscript><input type="hidden" value="FAKE-ID"></noscript>1234/26.0T8LSB</td>' +
      '<td>2026-06-16</td>' +
      '<td><noscript><a href="fallback.aspx?doc=1">sem js</a></noscript></td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]!.sourceId).toBeUndefined(); // dedup identity must not come from unrendered markup
    expect(res.rows[0]!.ref).not.toBe('FAKE-ID');
    expect(res.rows[0]!.documentoRef).toBeUndefined();
    expect(res.rows[0]!.temDocumento).toBe(false);
  });

  it('F3f: a genuine hidden-input source id in RENDERED markup is still read', () => {
    const html =
      GRID_OPEN +
      HEADER +
      '<tr><td><input type="hidden" value="REAL-ID-1">1234/26.0T8LSB</td><td>2026-06-16</td><td>Lisboa</td></tr>' +
      '</table>';
    const res = parseInboxPage(html);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]!.sourceId).toBe('REAL-ID-1');
    expect(res.rows[0]!.ref).toBe('REAL-ID-1');
  });
});
