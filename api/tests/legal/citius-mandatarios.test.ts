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

    // Row 2 has no attached document.
    expect(res.rows[1]).toMatchObject({
      processo: '5678/26.1T8PRT',
      ato: 'Notificação',
      temDocumento: false,
    });
    expect(res.rows[1]!.documentoRef).toBeUndefined();
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

describe('citius-mandatarios · notificacaoRef (stable content hash)', () => {
  it('is stable across a re-parse of the same page', () => {
    const a = parseInboxPage(load('inbox-get-p1.html'));
    const b = parseInboxPage(load('inbox-get-p1.html'));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.rows.map((r) => r.ref)).toEqual(b.rows.map((r) => r.ref));
    // and recomputing the ref off a parsed row reproduces its own ref
    expect(notificacaoRef(a.rows[0]!)).toBe(a.rows[0]!.ref);
  });

  it('differs across distinct rows', () => {
    const res = parseInboxPage(load('inbox-get-p1.html'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const refs = res.rows.map((r) => r.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('changes when an id-bearing field changes, stable otherwise', () => {
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
  it('the module imports no network machinery (parse-half only)', () => {
    expect(MODULE_SRC).not.toMatch(/from ['"][^'"]*url-fetcher/);
    expect(MODULE_SRC).not.toMatch(/\bguardedFetch\b/);
    expect(MODULE_SRC).not.toMatch(/\bfetchImpl\b/);
    expect(MODULE_SRC).not.toMatch(/\.arrayBuffer\s*\(/);
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
